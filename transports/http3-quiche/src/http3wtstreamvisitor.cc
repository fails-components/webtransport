// Copyright (c) 2022 Marten Richter or other contributers (see commit). All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "src/http3wtstreamvisitor.h"
#include "src/http3server.h"

namespace quic
{
    void Http3WTStreamJS::init(Http3WTStream *wtstream)
    {
        wtstream_ = std::unique_ptr<Http3WTStream>(wtstream);
    }

    Http3WTStream::Visitor::~Visitor()
    {
        // printf("stream ~Visitor %d %x %x\n", getpid(), this, stream_);
        while (stream_->chunks_.size() > 0)
        {
            auto cur = stream_->chunks_.front();

            // now we have to inform the server TODO
            stream_->getJS()->processStreamWrite(cur.bufferhandle, false);

            stream_->chunks_.pop_front();
        }

        if (!stream_->stop_sending_received_)
        {
            stream_->getJS()->processStreamRecvSignal(0, NetworkTask::stopSending);
        }
        if (!stream_->stream_was_reset_)
        {
            stream_->getJS()->processStreamRecvSignal(0, NetworkTask::resetStream);
        }
        Http3WTStreamJS *strobj = stream_->getJS();
        if (strobj)
        {
            stream_->stream_ = nullptr;
            strobj->Unref();
        }
        else
        {
            stream_->stream_ = nullptr;
        }
    }

    void Http3WTStream::Visitor::OnWriteSideInDataRecvdState() // called if everything is written to the client and it is closed
    {
        if (stream_->send_fin_)
            stream_->getJS()->processStreamNetworkFinish(NetworkTask::streamFinal);
    }

    void Http3WTStream::Visitor::OnResetStreamReceived(WebTransportStreamError error)
    {
        // should this be removed
        /*

        // Send FIN in response to a stream reset.  We want to test that we can
        // operate one side of the stream cleanly while the other is reset, thus
        // replying with a FIN rather than a RESET_STREAM is more appropriate here.
        stream_->send_fin_ = true;
        OnCanWrite();*/
        stream_->stream_was_reset_ = true;
        lasterror = error;
        stream_->getJS()->processStreamRecvSignal(error, NetworkTask::resetStream); // may be move below
    }

    void Http3WTStream::Visitor::OnStopSendingReceived(WebTransportStreamError error)
    {
        stream_->stop_sending_received_ = true;
        stream_->getJS()->processStreamRecvSignal(error, NetworkTask::stopSending); // may be move below
        // we should also finallize the stream, so send a fin
        stream_->send_fin_ = true;
        OnCanWrite();
    }

    void Http3WTStream::cancelWrite(Napi::ObjectReference *handle)
    {
        getJS()->processStreamWrite(handle, false);
    }

    void Http3WTStream::doCanRead()
    {
        // if (pause_reading_) return ; // back pressure folks!
        WebTransportStream::PeekResult pr;
        pr = stream_->PeekNextReadableRegion();

        if (pr.fin_next && pr.peeked_data.size() == 0) {
            bool fin = stream_->SkipBytes(0);
            if (fin) {
                getJS()->signalFinOnly();
                return;
            }
        }

        if (pause_reading_ && !drain_reads_)
        {
            can_read_pending_ = true;
            return; // back pressure folks!
        }
        bool read = false;
        while (!pr.peeked_data.empty())
        {
            Http3WTStreamJS::StreamReadBuffer rbuf(js_);
            rbuf.getBuffer(stream_->ReadableBytes());

            size_t remainSize = rbuf.bufferSize();
            uint32_t writepos = 0;

            while (!pr.peeked_data.empty() && remainSize > 0) {
                size_t len = std::min(remainSize, pr.peeked_data.size());
                if (len > 0) memcpy(((char *)rbuf.bufferData()) + writepos,pr.peeked_data.data(), len);
                bool fin = stream_->SkipBytes(len);
                QUIC_DVLOG(1) << "Attempted reading on WebTransport stream "
                              << ", bytes read: " << len;       
                writepos += len;
                remainSize -= len;
                pr =  stream_->PeekNextReadableRegion();
                if (fin) {
                    rbuf.setFin();
                    break;
                }
            }
            rbuf.commitBuffer(writepos, pr.has_data());
        }
    }

    void Http3WTStream::doCanWrite()
    {
        /* if (/* stop_sending_received_ || * pause_reading_)
         {
             return;
         } */
        if (fin_was_sent_)
            return;

        while (chunks_.size() > 0)
        {
            auto cur = chunks_.front();
            bool success = stream_->Write(absl::string_view(cur.buffer, cur.len));
            QUIC_DVLOG(1) << "Attempted writing on WebTransport bidirectional stream "
                          << ", success: " << (success ? "yes" : "no");
            if (!success)
            {
                return;
            }
            // now we have to inform the server TODO
            getJS()->processStreamWrite(cur.bufferhandle, true);

            chunks_.pop_front();
        }

        if (send_fin_)
        {
            bool success = stream_->SendFin();
            if (success) {
                fin_was_sent_ = true;
                getJS()->processStreamNetworkFinish(NetworkTask::streamFinal);
            }
        }
    }

    void Http3WTStream::stopSendingInt(unsigned int reason)
    {
        if (stream_)
        {
            stream_->SendStopSending(reason);
            getJS()->processStreamNetworkFinish(NetworkTask::stopSending);
        }
    }

    void Http3WTStream::resetStreamInt(unsigned int reason)
    {
        if (stream_)
        {
            stream_->ResetWithUserCode(reason);
            getJS()->processStreamNetworkFinish(NetworkTask::resetStream);
        }
    }

    void Http3WTStream::updateSendOrderAndGroupInt(uint64_t sendOrder, uint64_t sendGroupId) {
        if (stream_)
        {
            webtransport::StreamPriority prio;
            prio.send_group_id = sendGroupId;
            prio.send_order = sendOrder;
            stream_->SetPriority(prio);
        }
    }

    
    void  Http3WTStreamJS::signalFinOnly() {
        Napi::HandleScope scope(Env());
        Napi::Object retObj = Napi::Object::New(Env());
        Napi::Object objVal = Value().Get("jsobj").As<Napi::Object>();
        retObj.Set("fin", true);
        Napi::Value bufferVal = objVal.Get("commitReadBuffer").As<Napi::Function>().Call(objVal, {retObj});
    }

    

    void Http3WTStreamJS::processStreamNetworkFinish(NetworkTask task)
    {
        Napi::HandleScope scope(Env());

        Napi::Object objVal = Value().Get("jsobj").As<Napi::Object>();

        std::string nettaskstr;
        switch (task)
        {
        case NetworkTask::resetStream:
        {
            nettaskstr = "resetStream";
        }
        break;
        case NetworkTask::stopSending:
        {
            nettaskstr = "stopSending";
        }
        break;
        case NetworkTask::streamFinal:
        {
            nettaskstr = "streamFinal";
        }
        break;
        default:
            return;
        };

        Napi::Object retObj = Napi::Object::New(Env());
        retObj.Set("nettask", nettaskstr);

        objVal.Get("onStreamNetworkFinish").As<Napi::Function>().Call(objVal, {retObj});
    }

    void Http3WTStreamJS::processStreamRecvSignal(WebTransportStreamError error_code, NetworkTask task)
    {
        Napi::HandleScope scope(Env());

        Napi::Object objVal = Value().Get("jsobj").As<Napi::Object>();

        std::string nettaskstr;
        switch (task)
        {
        case NetworkTask::resetStream:
        {
            nettaskstr = "resetStream";
        }
        break;
        case NetworkTask::stopSending:
        {
            nettaskstr = "stopSending";
        }
        break;
        case NetworkTask::streamFinal:
        {
            nettaskstr = "streamFinal";
        }
        break;
        default:
            return;
        };

        Napi::Object retObj = Napi::Object::New(Env());
        retObj.Set("purpose", "StreamRecvSignal");
        retObj.Set("code", error_code);
        retObj.Set("nettask", nettaskstr);

        objVal.Get("onStreamRecvSignal").As<Napi::Function>().Call(objVal, {retObj});
    }

    void Http3WTStreamJS::processStreamWrite(Napi::ObjectReference *bufferhandle, bool success)
    {
        Napi::HandleScope scope(Env());

        Napi::Object objVal = Value().Get("jsobj").As<Napi::Object>();
        bufferhandle->Unref(); // release the outgoing buffer
        delete bufferhandle;   // free the handle object

        Napi::Object retObj = Napi::Object::New(Env());
        retObj.Set("success", success);

        objVal.Get("onStreamWrite").As<Napi::Function>().Call(objVal, {retObj});
    }

    void  Http3WTStreamJS::StreamReadBuffer::getBuffer(size_t reqsize) {
        Napi::HandleScope scope(jsobj_->Env());
        Napi::Object objVal = jsobj_->Value().Get("jsobj").As<Napi::Object>();

        Napi::Object argObj = Napi::Object::New(jsobj_->Env());
        argObj.Set("byteSize", reqsize);

        Napi::Value bufferVal = objVal.Get("getReadBuffer").As<Napi::Function>().Call(objVal, {argObj});
        bufferObj = Napi::Persistent(bufferVal.As<Napi::Object>());
        Napi::Object locBuf = bufferVal.As<Napi::Object>();
        fin = locBuf.Get("fin").As<Napi::Boolean>();
        if (locBuf.Has("buffer")) {
            Napi::Uint8Array buffer = locBuf.Get("buffer").As<Napi::Uint8Array>();
            buffer_ = buffer.Data();
            buffersize_ =buffer.ByteLength();
        }
        // buffer
        // byob
        // readBytes
        // fin
    }

    void  Http3WTStreamJS::StreamReadBuffer::commitBuffer(uint32_t readbytes, bool drained) {
        Napi::HandleScope scope(jsobj_->Env());
        Napi::Object objVal = jsobj_->Value().Get("jsobj").As<Napi::Object>();

        bufferObj.Set("fin", fin);
        bufferObj.Set("readBytes", Napi::Value::From(jsobj_->Env(),readbytes));
        bufferObj.Set("drained", drained);
        Napi::Value bufferVal = objVal.Get("commitReadBuffer").As<Napi::Function>().Call(objVal, {bufferObj.Value()});


    }

}
