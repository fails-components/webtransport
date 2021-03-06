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

#include <nan.h>

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

    class Http3WTSession : public Nan::ObjectWrap,  public LifetimeHelper
    {
    public:
        Http3WTSession(WebTransportSession *session, Http3EventLoop *eventloop)
            : session_(session), eventloop_(eventloop), ordBidiStreams(0), ordUnidiStreams(0), allocator_(eventloop)
        {
        }

        ~Http3WTSession()
        {
            // printf("session destruct %x\n", this);
        }

        class Visitor : public WebTransportVisitor
        {
        public:
            Visitor(Http3WTSession *session) : session_(session) {}

            ~Visitor()
            {
                Http3WTSession *sessobj = session_;
                session_->eventloop_->informUnref(sessobj);
            }

            void OnSessionReady(const spdy::SpdyHeaderBlock &) override;

            void OnSessionClosed(WebTransportSessionError error_code,
                                 const std::string &error_message) override;

            void OnIncomingBidirectionalStreamAvailable() override
            {
                if (!session_->session_) return;
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
                if (!session_->session_) return;
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
            if (!session_) return;
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
            if (!session_) return;
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

        void doUnref() override {
            Unref();
        }

        // nan stuff

        static NAN_METHOD(New)
        {
            if (!info.IsConstructCall())
            {
                return Nan::ThrowError("Http3WTSession() must be called as a constructor");
            }

            if (info.Length() != 1 || !info[0]->IsExternal())
            {
                return Nan::ThrowError("Http3WTSession() can only be called internally");
            }

            Http3WTSession *obj = static_cast<Http3WTSession *>(info[0].As<v8::External>()->Value());
            obj->Wrap(info.This());
            info.GetReturnValue().Set(info.This());
        }

        static v8::Local<v8::Object> NewInstance(Http3WTSession *sv)
        {
            Nan::EscapableHandleScope scope;

            const unsigned argc = 1;
            v8::Local<v8::Value> argv[argc] = {Nan::New<v8::External>(sv)};
            v8::Local<v8::Function> constr = Nan::New<v8::Function>(constructor());
            v8::Local<v8::Object> instance = Nan::NewInstance(constr, argc, argv).ToLocalChecked();

            sv->Ref();

            return scope.Escape(instance);
        }

        static inline Nan::Persistent<v8::Function> &constructor()
        {
            static Nan::Persistent<v8::Function> myconstr;
            return myconstr;
        }

        static NAN_METHOD(orderBidiStream)
        {
            Http3WTSession *obj = Nan::ObjectWrap::Unwrap<Http3WTSession>(info.Holder());
            std::function<void()> task = [obj]()
            { obj->tryOpenBidiStream(); };
            obj->eventloop_->Schedule(task);
        }

        static NAN_METHOD(orderUnidiStream)
        {
            Http3WTSession *obj = Nan::ObjectWrap::Unwrap<Http3WTSession>(info.Holder());
            std::function<void()> task = [obj]()
            { obj->tryOpenUnidiStream(); };
            obj->eventloop_->Schedule(task);
        }

        static NAN_METHOD(writeDatagram)
        {
            Http3WTSession *obj = Nan::ObjectWrap::Unwrap<Http3WTSession>(info.Holder());
            if (!info[0]->IsUndefined())
            {
                v8::Local<v8::Context> context = info.GetIsolate()->GetCurrentContext();
                v8::Local<v8::Object> bufferlocal = info[0]->ToObject(context).ToLocalChecked();
                Nan::Persistent<v8::Object> *bufferHandle = new Nan::Persistent<v8::Object>(bufferlocal);
                char *buffer = node::Buffer::Data(bufferlocal);
                size_t len = node::Buffer::Length(bufferlocal);

                std::function<void()> task = [obj, bufferHandle, buffer, len]()
                { obj->writeDatagramInt(buffer, len, bufferHandle); };
                obj->eventloop_->Schedule(task);
            }
        }

        static NAN_METHOD(close)
        {
            Http3WTSession *obj = Nan::ObjectWrap::Unwrap<Http3WTSession>(info.Holder());
            int code = 0;
            std::string reason("unknown reason");
            v8::Isolate *isolate = info.GetIsolate();

            if (!info[0]->IsUndefined())
            {
                v8::Local<v8::Context> context = info.GetIsolate()->GetCurrentContext();
                v8::MaybeLocal<v8::Object> obj = info[0]->ToObject(context);
                v8::Local<v8::String> codeProp = Nan::New("code").ToLocalChecked();
                v8::Local<v8::String> reasonProp = Nan::New("reason").ToLocalChecked();
                if (!obj.IsEmpty())
                {
                    v8::Local<v8::Object> lobj = obj.ToLocalChecked();
                    if (Nan::HasOwnProperty(lobj, codeProp).FromJust() && !Nan::Get(lobj, codeProp).IsEmpty())
                    {
                        v8::Local<v8::Value> codeValue = Nan::Get(lobj, codeProp).ToLocalChecked();
                        code = Nan::To<int>(codeValue).FromJust();
                    }
                    if (Nan::HasOwnProperty(lobj, reasonProp).FromJust() && !Nan::Get(lobj, reasonProp).IsEmpty())
                    {
                        v8::Local<v8::Value> reasonValue = Nan::Get(lobj, reasonProp).ToLocalChecked();
                        reason = *v8::String::Utf8Value(isolate, reasonValue->ToString(context).ToLocalChecked());
                    }
                }
            }

            std::function<void()> task = [obj,code,reason]()
            { obj->session_->CloseSession(code, reason); };
            obj->eventloop_->Schedule(task);
        }


    private:
        class DatagramAllocator : public quiche::QuicheBufferAllocator
        {
        public:
            DatagramAllocator(Http3EventLoop *eventloop) : eventloop_(eventloop)
            {
            }

            char *New(size_t size) { return nullptr; }                   // fake it comes from javascript
            char *New(size_t size, bool flag_enable) { return nullptr; } // fake it comes from javascript

            void Delete(char *buffer)
            {
                eventloop_->informDatagramBufferFree(buffers_[buffer]);
                buffers_.erase(buffer);
            }

            void registerBuffer(char *buffer, Nan::Persistent<v8::Object> *bufferhandle)
            {
                buffers_[buffer] = bufferhandle;
            }

        protected:
            Http3EventLoop *eventloop_;
            std::map<char *, Nan::Persistent<v8::Object> *> buffers_;
        };

        void writeDatagramInt(char *buffer, size_t len, Nan::Persistent<v8::Object> *bufferhandle)
        {
            if (!session_) {
                eventloop_->informDatagramSend(this);
                return;
            }
            allocator_.registerBuffer(buffer, bufferhandle);
            auto ubuffer = quiche::QuicheUniqueBufferPtr(buffer,
                                                         quiche::QuicheBufferDeleter(&allocator_));

            quiche::QuicheMemSlice slice(quiche::QuicheBuffer(std::move(ubuffer), len));
            session_->SendOrQueueDatagram(std::move(slice));
            eventloop_->informDatagramSend(this);
        }
        WebTransportSession *session_;
        DatagramAllocator allocator_;
        bool echo_stream_opened_ = false;
        Http3EventLoop *eventloop_;
        uint32_t ordBidiStreams;
        uint32_t ordUnidiStreams;
    };
}
#endif