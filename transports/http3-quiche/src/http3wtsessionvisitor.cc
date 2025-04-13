// Copyright (c) 2022 Marten Richter or other contributers (see commit). All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "src/http3wtsessionvisitor.h"

namespace quic
{

    Http3WTSession::Visitor::~Visitor()
    {
        // printf("~Visitor %d %x %x\n", getpid(), this, session_);
        Http3WTSessionJS *sessobj = session_->getJS();
        if (sessobj) {
            session_->getJS()->Unref();
        } else
            delete session_;
        session_ = nullptr;
    }

    void Http3WTSession::Visitor::OnSessionClosed(WebTransportSessionError error_code,
                                                const std::string &error_message)
    {
        // printf("OnSessionClosed %d %x %x\n", getpid(), this, session_);
        session_->session_ = nullptr;
        session_->getJS()->processSessionClose(error_code, error_message);
    }
                        

    void Http3WTSession::Visitor::OnIncomingBidirectionalStreamAvailable()
    {
        if (!session_->session_)
            return;
        while (true)
        {
            WebTransportStream *stream =
                session_->session_->AcceptIncomingBidirectionalStream();
            if (stream == nullptr)
            {
                return;
            }
            Http3WTStream *wtstream = new Http3WTStream(stream);
            QUIC_DVLOG(1)
                << "Http3WTSession received a bidirectional stream "
                << stream->GetStreamId();
            stream->SetVisitor(
                std::make_unique<Http3WTStream::Visitor>(wtstream));
            session_->getJS()->processStream(true, true, 0/*sendOrder*/, 0 /*sendGroup*/, static_cast<Http3WTStream *>(wtstream));
            stream->visitor()->OnCanRead();
        }
    }

    void Http3WTSession::Visitor::OnIncomingUnidirectionalStreamAvailable()
    {
        if (!session_->session_)
            return;
        while (true)
        {
            WebTransportStream *stream =
                session_->session_->AcceptIncomingUnidirectionalStream();
            if (stream == nullptr)
            {
                return;
            }
            Http3WTStream *wtstream = new Http3WTStream(stream);
            QUIC_DVLOG(1)
                << "Http3WTSession received a unidirectional stream";
            stream->SetVisitor(
                std::make_unique<Http3WTStream::Visitor>(wtstream));
            session_->getJS()->processStream(true, false, 0/*sendOrder*/, 0 /*sendGroup*/, static_cast<Http3WTStream *>(wtstream));
            stream->visitor()->OnCanRead();
        }
    }

    void Http3WTSession::Visitor::OnDatagramReceived(absl::string_view datagram)
    {
        // printf("OnDatagramReceived %d %x %x\n", getpid(), this, session_);
        session_->getJS()->processDatagramReceived(new std::string(datagram));
        /*auto buffer = MakeUniqueBuffer(&allocator_, datagram.size());
        memcpy(buffer.get(), datagram.data(), datagram.size());
        quiche::QuicheMemSlice slice(std::move(buffer), datagram.size());
        session_->SendOrQueueDatagram(std::move(slice));*/
    }

    void Http3WTSession::init(WebTransportSession *session)
    {
        session_ = session;
        if (session_)
        {
            session_->SetOnDraining([this]()
                                    { getJS()->processGoawayReceived(); });
        }
    }

    void Http3WTSession::orderSessionStatsInt()
    {
        if (session_)
            getJS()->processSessionStats(session_->GetSessionStats());
    }

    void Http3WTSession::orderDatagramStatsInt()
    {
        if (session_)
            getJS()->processDatagramStats(session_->GetDatagramStats());
    }

    size_t Http3WTSession::getMaxDatagramSizeInt()
    {
        if (!session_) return 0;
        return session_->GetMaxDatagramSize();
    }

    void Http3WTSession::TrySendingBidirectionalStreams()
    {
        if (!session_)
            return;
        while (!ordBidiStreams.empty() &&
               session_->CanOpenNextOutgoingBidirectionalStream())
        {
            QUIC_DVLOG(1)
                << "Http3WTSessionVisitor opens a bidirectional stream";
            WebTransportStream *stream = session_->OpenOutgoingBidirectionalStream();
            webtransport::StreamPriority prio = ordBidiStreams.front();
            stream->SetPriority(prio);
            Http3WTStream *wtstream = new Http3WTStream(stream);
            stream->SetVisitor(
                std::make_unique<Http3WTStream::Visitor>(wtstream));
            getJS()->processStream(false, true, prio.send_order, prio.send_group_id, static_cast<Http3WTStream *>(wtstream));
            stream->visitor()->OnCanWrite();
            ordBidiStreams.pop();
        }
    }

    void Http3WTSession::Visitor::OnSessionReady()
    {
        if (!session_->session_) return;

        session_->getJS()->processSessionReady(session_->session_->GetNegotiatedSubprotocol());

        if (session_->session_->CanOpenNextOutgoingBidirectionalStream())
        {
            OnCanCreateNewOutgoingBidirectionalStream();
        }
        if (session_->session_->CanOpenNextOutgoingUnidirectionalStream())
        {
            OnCanCreateNewOutgoingUnidirectionalStream();
        }
    }

    void Http3WTSession::TrySendingUnidirectionalStreams()
    {
        if (!session_)
            return;
        // move to some where else?
        while (!ordUnidiStreams.empty() &&
               session_->CanOpenNextOutgoingUnidirectionalStream())
        {
            QUIC_DVLOG(1)
                << "Http3WTSessionVisitor opened a unidirectional stream";
            WebTransportStream *stream = session_->OpenOutgoingUnidirectionalStream();
            webtransport::StreamPriority prio = ordUnidiStreams.front();
            stream->SetPriority(prio);
            Http3WTStream *wtstream = new Http3WTStream(stream);
            stream->SetVisitor(
                std::make_unique<Http3WTStream::Visitor>(wtstream));

            getJS()->processStream(false, false, prio.send_order, prio.send_group_id, static_cast<Http3WTStream *>(wtstream));
            stream->visitor()->OnCanWrite();
            ordUnidiStreams.pop();
        }
    }

    webtransport::DatagramStatus Http3WTSession::writeDatagramInt(char *buffer, size_t len, Napi::ObjectReference *bufferhandle)
    {
        // printf("Datagram write %d %x %x\n", getpid(), this, session_ );
        if (!session_)
        {
            // printf("Datagram session gone %d %x %x\n", getpid(), this, session_);
            bufferhandle->Unref(); // release the outgoing buffer
            delete bufferhandle;   // free the handle object
            webtransport::DatagramStatus status(webtransport::DatagramStatusCode::kInternalError, "Session not present");
            return status;
        }
        webtransport::DatagramStatus status = session_->SendOrQueueDatagram(absl::string_view(buffer, len));
        // printf("Datagram status %d %d %s %x %x\n", getpid(), status.code, status.error_message.c_str(), this, session_);
        bufferhandle->Unref(); // release the outgoing buffer
        delete bufferhandle;   // free the handle object
        return status;
    }

    void Http3WTSessionJS::processStream(bool incom, bool bidi, uint64_t sendOrder, uint64_t sendGroupId, Http3WTStream *stream)
    {
        Napi::HandleScope scope(Env());
        Http3Constructors *constr = Env().GetInstanceData<Http3Constructors>();
        Napi::Object strobj = constr->stream.New({});
        Http3WTStreamJS *strjs = Napi::ObjectWrap<Http3WTStreamJS>::Unwrap(strobj);
        strjs->setObj(stream);
        if (!stream->gone())
            strjs->Ref();

        stream->setJS(strjs);

        Napi::Object objVal = Value().Get("jsobj").As<Napi::Object>();

        Napi::Object retObj = Napi::Object::New(Env());
        retObj.Set("stream", strobj);
        retObj.Set("incoming", incom);
        retObj.Set("bidirectional", bidi);
        retObj.Set("sendOrder", sendOrder);
        retObj.Set("sendGroupId", sendGroupId);

        objVal.Get("onStream").As<Napi::Function>().Call(objVal, {retObj});
    }

    void Http3WTSessionJS::processGoawayReceived()
    {
        Napi::HandleScope scope(Env());

        Napi::Object objVal = Value().Get("jsobj").As<Napi::Object>();

        Napi::Object retObj = Napi::Object::New(Env());
        objVal.Get("onGoAwayReceived").As<Napi::Function>().Call(objVal, {retObj});
    }

    void Http3WTSessionJS::processSessionStats(webtransport::SessionStats sessstats)
    {
        Napi::HandleScope scope(Env());

        Napi::Object objVal = Value().Get("jsobj").As<Napi::Object>();

        Napi::Object retObj = Napi::Object::New(Env());
        //  expiredOutgoing: bigint
        // lostOutgoing: bigint

        // non Datagram
        //  minRtt: number
        //  smoothedRtt: number
        //  rttVariation: number
        // estimatedSendRateBps: bigint
        retObj.Set("timestamp", absl::ToDoubleMilliseconds(absl::Duration())); // absl::Duration
        // datagram
        retObj.Set("expiredOutgoing", Napi::BigInt::New(Env(), sessstats.datagram_stats.expired_outgoing)); // uint64_t
        retObj.Set("lostOutgoing", Napi::BigInt::New(Env(), sessstats.datagram_stats.lost_outgoing));       // uint64_t

        // non Datagram
        retObj.Set("minRtt", absl::ToDoubleMilliseconds(sessstats.min_rtt));             // absl::Duration
        retObj.Set("smoothedRtt", absl::ToDoubleMilliseconds(sessstats.smoothed_rtt));   // absl::Duration
        retObj.Set("rttVariation", absl::ToDoubleMilliseconds(sessstats.rtt_variation)); // absl::Duration
        retObj.Set("estimatedSendRateBps", sessstats.estimated_send_rate_bps);           // absl::Duration

        objVal.Get("onSessionStats").As<Napi::Function>().Call(objVal, {retObj});
    }

    void Http3WTSessionJS::processDatagramStats(webtransport::DatagramStats datastats)
    {
        Napi::HandleScope scope(Env());

        Napi::Object objVal = Value().Get("jsobj").As<Napi::Object>();

        Napi::Object retObj = Napi::Object::New(Env());
        retObj.Set("timestamp", absl::ToDoubleMilliseconds(absl::Duration())); // absl::Duration
        // datagram
        retObj.Set("expiredOutgoing", Napi::BigInt::New(Env(), datastats.expired_outgoing)); // uint64_t
        retObj.Set("lostOutgoing", Napi::BigInt::New(Env(), datastats.lost_outgoing));       // uint64_t

        objVal.Get("onDatagramStats").As<Napi::Function>().Call(objVal, {retObj});
    }

    void Http3WTSessionJS::processDatagramSend(Napi::ObjectReference *bufferhandle)
    {
        bufferhandle->Unref(); // release the outgoing buffer
        delete bufferhandle;   // free the handle object

        Napi::HandleScope scope(Env());
        Napi::Object objVal = Value().Get("jsobj").As<Napi::Object>();

        Napi::Object retObj = Napi::Object::New(Env());

        objVal.Get("onDatagramSend").As<Napi::Function>().Call(objVal, {retObj});
    }

    void Http3WTSessionJS::processSessionReady(std::optional<std::string> protocol)
    {
        Napi::HandleScope scope(Env());
        Napi::Object objVal = Value().Get("jsobj").As<Napi::Object>();

        Napi::Object retObj = Napi::Object::New(Env());

        if (protocol.has_value()) {
            retObj.Set("protocol", protocol.value());
        }
        objVal.Get("onReady").As<Napi::Function>().Call(objVal, {retObj});
    }

    void Http3WTSessionJS::processSessionClose(uint32_t errorcode, const std::string &error)
    {
        Napi::HandleScope scope(Env());

        Napi::Object objVal = Value().Get("jsobj").As<Napi::Object>();

        Napi::Object retObj = Napi::Object::New(Env());
        retObj.Set("error", error);
        retObj.Set("errorcode", errorcode);

        objVal.Get("onClose").As<Napi::Function>().Call(objVal, {retObj});
    }

    void Http3WTSessionJS::processDatagramReceived(std::string *datagram)
    {
        Napi::HandleScope scope(Env());
        Napi::Object datagramVal =
            Napi::Uint8Array::New(Env(),
                                  datagram->length(),
                                  Napi::ArrayBuffer::New(Env(), &(*datagram)[0], datagram->length(),
                                                         freeData, datagram),
                                  0);

        Napi::Object objVal = Value().Get("jsobj").As<Napi::Object>();

        Napi::Object retObj = Napi::Object::New(Env());
        retObj.Set("datagram", datagramVal);

        objVal.Get("onDatagramReceived").As<Napi::Function>().Call(objVal, {retObj});
    }

    void Http3WTSessionJS::freeData(Napi::Env env, void *data, std::string *hint)
    {
        // ok free data is actually using a string object
        delete hint;
    }
}