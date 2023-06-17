// modifications
// Copyright (c) 2022 Marten Richter or other contributers (see commit). All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

// original copyright, see LICENSE.chromium
// Copyright (c) 2021 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef HTTP3_WT_SESSION_VISITOR_H_
#define HTTP3_WT_SESSION_VISITOR_H_

#include <napi.h>
#include <uv.h>

#include <atomic>

#include <string>

#include "src/http3wtstreamvisitor.h"

#include "quiche/quic/core/web_transport_interface.h"
#include "quiche/quic/platform/api/quic_logging.h"
#include "quiche/common/quiche_circular_deque.h"
#include "quiche/common/platform/api/quiche_mem_slice.h"

#include "src/http3eventloop.h"

namespace quic
{
    // class Http3Server;
    class Http3WTSessionJS;

    class Http3WTSession
    {
        friend Http3WTSessionJS;

    public:
        Http3WTSession()
            : ordBidiStreams(0), ordUnidiStreams(0), session_(nullptr), eventloop_(nullptr), js_(nullptr)
        {
        }

        ~Http3WTSession()
        {
            // printf("session destruct %x\n", this);
        }

        // need to be called immediately after new
        void init(WebTransportSession *session, Http3EventLoop *eventloop)
        {
            session_ = session;
            eventloop_ = eventloop;
            if (session_) {
                session_->SetOnDraining([this]() {
                    eventloop_->informGoawayReceived(this);
                }); 
            }
        }

        class Visitor : public WebTransportVisitor
        {
        public:
            Visitor(Http3WTSession *session) : session_(session) {}

            ~Visitor();

            void OnSessionReady() override;

            void OnSessionClosed(WebTransportSessionError error_code,
                                 const std::string &error_message) override;

            void OnIncomingBidirectionalStreamAvailable() override
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
                    Http3WTStream *wtstream = new Http3WTStream(stream, session_->eventloop_);
                    QUIC_DVLOG(1)
                        << "Http3WTSession received a bidirectional stream "
                        << stream->GetStreamId();
                    stream->SetVisitor(
                        std::make_unique<Http3WTStream::Visitor>(wtstream));
                    session_->eventloop_->informAboutStream(true, true, session_, static_cast<Http3WTStream *>(wtstream));
                    stream->visitor()->OnCanRead();
                }
            }

            void OnIncomingUnidirectionalStreamAvailable() override
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
                    Http3WTStream *wtstream = new Http3WTStream(stream, session_->eventloop_);
                    QUIC_DVLOG(1)
                        << "Http3WTSession received a unidirectional stream";
                    stream->SetVisitor(
                        std::make_unique<Http3WTStream::Visitor>(wtstream));
                    session_->eventloop_->informAboutStream(true, false, session_, static_cast<Http3WTStream *>(wtstream));
                    stream->visitor()->OnCanRead();
                }
            }

            void OnDatagramReceived(absl::string_view datagram) override
            {
                // printf("OnDatagramReceived %d %x %x\n", getpid(), this, session_);
                session_->eventloop_->informDatagramReceived(session_, datagram);
                /*auto buffer = MakeUniqueBuffer(&allocator_, datagram.size());
                memcpy(buffer.get(), datagram.data(), datagram.size());
                quiche::QuicheMemSlice slice(std::move(buffer), datagram.size());
                session_->SendOrQueueDatagram(std::move(slice));*/
            }

            void OnCanCreateNewOutgoingBidirectionalStream() override
            {
                // unclear how we can stich this together?
                session_->TrySendingBidirectionalStreams();
            }

            void OnCanCreateNewOutgoingUnidirectionalStream() override
            {
                session_->TrySendingUnidirectionalStreams();
            }

        protected:
            Http3WTSession *session_;
        };

        void
        tryOpenBidiStream()
        {
            ordBidiStreams++;
            TrySendingBidirectionalStreams();
        }

        void tryOpenUnidiStream()
        {
            ordUnidiStreams++;
            TrySendingUnidirectionalStreams();
        }

        void TrySendingBidirectionalStreams()
        {
            if (!session_)
                return;
            while (ordBidiStreams > 0 &&
                   session_->CanOpenNextOutgoingBidirectionalStream())
            {
                QUIC_DVLOG(1)
                    << "Http3WTSessionVisitor opens a bidirectional stream";
                WebTransportStream *stream = session_->OpenOutgoingBidirectionalStream();
                Http3WTStream *wtstream = new Http3WTStream(stream, eventloop_);
                stream->SetVisitor(
                    std::make_unique<Http3WTStream::Visitor>(wtstream));
                eventloop_->informAboutStream(false, true, this, static_cast<Http3WTStream *>(wtstream));
                stream->visitor()->OnCanWrite();
                ordBidiStreams--;
            }
        }

        void TrySendingUnidirectionalStreams()
        {
            if (!session_)
                return;
            // move to some where else?
            while (ordUnidiStreams > 0 &&
                   session_->CanOpenNextOutgoingUnidirectionalStream())
            {
                QUIC_DVLOG(1)
                    << "Http3WTSessionVisitor opened a unidirectional stream";
                WebTransportStream *stream = session_->OpenOutgoingUnidirectionalStream();
                Http3WTStream *wtstream = new Http3WTStream(stream, eventloop_);
                stream->SetVisitor(
                    std::make_unique<Http3WTStream::Visitor>(wtstream));

                eventloop_->informAboutStream(false, false, this, static_cast<Http3WTStream *>(wtstream));
                stream->visitor()->OnCanWrite();
                ordUnidiStreams--;
            }
        }

        Http3WTSessionJS *getJS() { return js_; };
        void setJS(Http3WTSessionJS *js) { 
            js_ = js; 
        };

    private:
        
        Http3WTSessionJS *js_;

        void orderBidiStreamInt()
        {
            std::function<void()> task = [this]()
            { tryOpenBidiStream(); };
            eventloop_->Schedule(task);
        }

        void orderUnidiStreamInt()
        {
            std::function<void()> task = [this]()
            { tryOpenUnidiStream(); };
            eventloop_->Schedule(task);
        }

        void writeDatagramIntJS(char *buffer, size_t len, Napi::ObjectReference *bufferhandle)
        {
            std::function<void()> task = [this, bufferhandle, buffer, len]()
            { writeDatagramInt(buffer, len, bufferhandle); };
            eventloop_->Schedule(task);
        }

        void notifySessionDrainingInt()
        {
            std::function<void()> task = [this]()
            { if (session_) session_->NotifySessionDraining(); };
            eventloop_->Schedule(task);
        }

        void closeInt(int code, std::string &reason)
        {
            std::function<void()> task = [this, code, reason]()
            { if (session_) session_->CloseSession(code, reason); };
            eventloop_->Schedule(task);
        }

        void writeDatagramInt(char *buffer, size_t len, Napi::ObjectReference *bufferhandle)
        {
            // printf("Datagram write %d %x %x\n", getpid(), this, session_ );
            if (!session_)
            {
                // printf("Datagram session gone %d %x %x\n", getpid(), this, session_);
                eventloop_->informDatagramSend(this, bufferhandle);
                return;
            }
            auto status=session_->SendOrQueueDatagram(absl::string_view(buffer, len));
            // printf("Datagram status %d %d %s %x %x\n", getpid(), status.code, status.error_message.c_str(), this, session_);
            eventloop_->informDatagramSend(this, bufferhandle);
        }

        WebTransportSession *session_;
        bool echo_stream_opened_ = false;
        Http3EventLoop *eventloop_;
        uint32_t ordBidiStreams;
        uint32_t ordUnidiStreams;
    };

    class Http3WTSessionJS : public Napi::ObjectWrap<Http3WTSessionJS>, public LifetimeHelper
    {
    public:
        Http3WTSessionJS(const Napi::CallbackInfo &info) : Napi::ObjectWrap<Http3WTSessionJS>(info)
        {
        }

        void setObj(Http3WTSession *wtsession)
        {
            wtsession_ = std::unique_ptr<Http3WTSession>(wtsession);
        }

        Http3WTSession *getObj()
        {
            return wtsession_.get();
        }

        void orderBidiStream(const Napi::CallbackInfo &info)
        {
            wtsession_->orderBidiStreamInt();
        }

        void orderUnidiStream(const Napi::CallbackInfo &info)
        {
            wtsession_->orderUnidiStreamInt();
        }

        void writeDatagram(const Napi::CallbackInfo &info)
        {
            if (!info[0].IsUndefined())
            {
                Napi::Object bufferlocal = info[0].ToObject();
                Napi::ObjectReference *bufferhandle = new Napi::ObjectReference();
                *bufferhandle = Napi::Persistent(bufferlocal);
                char *buffer = bufferlocal.As<Napi::Buffer<char>>().Data();
                size_t len = bufferlocal.As<Napi::Buffer<char>>().Length();
                wtsession_->writeDatagramIntJS(buffer, len, bufferhandle);
            }
        }

        void notifySessionDraining(const Napi::CallbackInfo &info)
        {
            wtsession_->notifySessionDrainingInt();
        }

        void close(const Napi::CallbackInfo &info)
        {
            int code = 0;
            std::string reason("unknown reason");

            if (!info[0].IsUndefined())
            {
                Napi::Object obj = info[0].ToObject();
                if (!obj.IsEmpty())
                {
                    if (obj.Has("code") && !(obj).Get("code").IsEmpty())
                    {
                        Napi::Value codeValue = (obj).Get("code");
                        code = codeValue.As<Napi::Number>().Int32Value();
                    }
                    if (obj.Has("reason") && !(obj).Get("reason").IsEmpty())
                    {
                        Napi::Value reasonValue = (obj).Get("reason");
                        reason = reasonValue.ToString().Utf8Value();
                    }
                }
            }

            wtsession_->closeInt(code, reason);
        }

        static void InitExports(Napi::Env env, Napi::Object exports, Http3Constructors * constr)
        {
            Napi::Function tplwt =
                ObjectWrap<Http3WTSessionJS>::DefineClass(env, "Http3WTSessionVisitor",
                                                          {InstanceMethod<&Http3WTSessionJS::orderBidiStream>("orderBidiStream",
                                                                                                              static_cast<napi_property_attributes>(napi_writable | napi_configurable)),
                                                           InstanceMethod<&Http3WTSessionJS::orderUnidiStream>("orderUnidiStream",
                                                                                                               static_cast<napi_property_attributes>(napi_writable | napi_configurable)),
                                                           InstanceMethod<&Http3WTSessionJS::writeDatagram>("writeDatagram",
                                                                                                            static_cast<napi_property_attributes>(napi_writable | napi_configurable)),
                                                           InstanceMethod<&Http3WTSessionJS::notifySessionDraining>("notifySessionDraining",
                                                                                                            static_cast<napi_property_attributes>(napi_writable | napi_configurable)),
                                                           InstanceMethod<&Http3WTSessionJS::close>("close",
                                                                                                    static_cast<napi_property_attributes>(napi_writable | napi_configurable))});
            constr->session  = Napi::Persistent(tplwt);                                                                                      
            exports.Set("Http3WTSessionVisitor", tplwt);

        }

        void doUnref() override
        {
            Unref();
        }

    protected:
        std::unique_ptr<Http3WTSession> wtsession_;
    };
}
#endif