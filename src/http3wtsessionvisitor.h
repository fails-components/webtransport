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

#include <atomic>

#include <string>

#include "src/librarymain.h"
#include "src/http3wtstreamvisitor.h"
#include "src/http3wtsessionvisitor.h"

#include "quiche/quic/core/web_transport_interface.h"
#include "quiche/quic/platform/api/quic_logging.h"
#include "quiche/common/quiche_circular_deque.h"
#include "quiche/common/platform/api/quiche_mem_slice.h"

namespace quic
{
    // class Http3Server;
    class Http3WTSessionJS;

    class Http3WTSession
    {
        friend Http3WTSessionJS;

    public:
        Http3WTSession()
            : ordBidiStreams(0), ordUnidiStreams(0), session_(nullptr), js_(nullptr)
        {
        }

        ~Http3WTSession()
        {
            printf("session destruct %x\n", this);
        }

        // need to be called immediately after new
        void init(WebTransportSession *session);

        class Visitor : public WebTransportVisitor
        {
        public:
            Visitor(Http3WTSession *session) : session_(session) {}

            ~Visitor();

            void OnSessionReady() override;

            void OnSessionClosed(WebTransportSessionError error_code,
                                 const std::string &error_message) override;

            void OnIncomingBidirectionalStreamAvailable() override;

            void OnIncomingUnidirectionalStreamAvailable() override;

            void OnDatagramReceived(absl::string_view datagram) override;

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

        void TrySendingBidirectionalStreams();

        void TrySendingUnidirectionalStreams();

        Http3WTSessionJS *getJS() { return js_; };
        void setJS(Http3WTSessionJS *js)
        {
            js_ = js;
        };

    private:
        Http3WTSessionJS *js_;

        void notifySessionDrainingInt()
        {
            if (session_)
                session_->NotifySessionDraining();
        }

        void orderSessionStatsInt();

        void orderDatagramStatsInt();

        void closeInt(int code, std::string &reason)
        {
            if (session_)
                session_->CloseSession(code, reason);
        }

        void writeDatagramInt(char *buffer, size_t len, Napi::ObjectReference *bufferhandle);

        WebTransportSession *session_;
        bool echo_stream_opened_ = false;
        uint32_t ordBidiStreams;
        uint32_t ordUnidiStreams;
    };

    class Http3WTSessionJS : public Napi::ObjectWrap<Http3WTSessionJS>
    {
        friend class Http3WTSession;
        friend class Http3WTSession::Visitor;

    public:
        Http3WTSessionJS(const Napi::CallbackInfo &info) : Napi::ObjectWrap<Http3WTSessionJS>(info)
        {
        }

        ~Http3WTSessionJS() {
            printf("~Http3WTSessionJS\n");
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
            wtsession_->tryOpenBidiStream();
        }

        void orderUnidiStream(const Napi::CallbackInfo &info)
        {
            wtsession_->tryOpenUnidiStream();
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
                wtsession_->writeDatagramInt(buffer, len, bufferhandle);
            }
        }

        void notifySessionDraining(const Napi::CallbackInfo &info)
        {
            wtsession_->notifySessionDrainingInt();
        }

        void orderSessionStats(const Napi::CallbackInfo &info)
        {
            wtsession_->orderSessionStatsInt();
        }

        void orderDatagramStats(const Napi::CallbackInfo &info)
        {
            wtsession_->orderDatagramStatsInt();
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

        static void InitExports(Napi::Env env, Napi::Object exports, Http3Constructors *constr)
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
                                                           InstanceMethod<&Http3WTSessionJS::orderSessionStats>("orderSessionStats",
                                                                                                                static_cast<napi_property_attributes>(napi_writable | napi_configurable)),
                                                           InstanceMethod<&Http3WTSessionJS::orderDatagramStats>("orderDatagramStats",
                                                                                                                 static_cast<napi_property_attributes>(napi_writable | napi_configurable)),
                                                           InstanceMethod<&Http3WTSessionJS::close>("close",
                                                                                                    static_cast<napi_property_attributes>(napi_writable | napi_configurable))});
            constr->session = Napi::Persistent(tplwt);
            exports.Set("Http3WTSessionVisitor", tplwt);
        }

    protected:
        std::unique_ptr<Http3WTSession> wtsession_;

        static void freeData(Napi::Env env, void *data, std::string *hint);

        void processStream(bool incom, bool bidi, Http3WTStream *stream);
        void processSessionStats(webtransport::SessionStats sessstats);
        void processDatagramStats(webtransport::DatagramStats datastats);
        void processGoawayReceived();
        void processDatagramSend(Napi::ObjectReference *bufferhandle);
        void processDatagramReceived(std::string *datagram);
        void processSessionReady();
        void processSessionClose(uint32_t errorcode, const std::string &error);
    };

}
#endif
