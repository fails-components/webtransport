// modifications
// Copyright (c) 2022 Marten Richter or other contributers (see commit). All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

// original copyright used only portions, see LICENSE.chromium
// Copyright (c) 2021 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef HTTP3_WT_STREAM_VISITOR_H_
#define HTTP3_WT_STREAM_VISITOR_H_

#include <nan.h>

#include <string>

#include "common/simple_buffer_allocator.h"
#include "quic/core/web_transport_interface.h"
#include "quic/platform/api/quic_logging.h"
#include "common/quiche_circular_deque.h"

#include "src/http3server.h"

namespace quic
{
    class Http3Server;

    class Http3WTStream : public Nan::ObjectWrap
    {
    public:
        Http3WTStream(WebTransportStream *stream, uint32_t pobjnum, Http3Server *server)
            : stream_(stream), parentobjnum_(pobjnum), server_(server) {}

        ~Http3WTStream();

        class Visitor : public WebTransportStreamVisitor
        {
        public:
            Visitor(Http3WTStream *stream) : stream_(stream) {}

            ~Visitor()
            {
                Http3WTStream *strobj = stream_;
                std::function<void()> task = [strobj]()
                { strobj->Unref(); };
                stream_->server_->Schedule(task);
            }

            void OnCanRead() override {
                stream_->doCanRead();
            }

            void OnCanWrite() override
            {
                stream_->doCanWrite();
            }

            void OnResetStreamReceived(WebTransportStreamError /*error*/) override
            {
                // Send FIN in response to a stream reset.  We want to test that we can
                // operate one side of the stream cleanly while the other is reset, thus
                // replying with a FIN rather than a RESET_STREAM is more appropriate here.
                stream_->send_fin_ = true;
                OnCanWrite();
            }
            void OnStopSendingReceived(WebTransportStreamError /*error*/) override
            {
                stream_->stop_sending_received_ = true;
            }
            void OnWriteSideInDataRecvdState() override {}

            void OnStopReading()
            {
                stream_->doStopReading();
            }

        protected:
            Http3WTStream *stream_;
        };

        void doCanRead();

        void doCanWrite();

        void doStopReading()
        {
            pause_reading_ = true;
        }

        void tryWrite()
        {
            if (stream_->CanWrite())
            {
                doCanWrite();
            }
        }

        void tryRead()
        {
            pause_reading_ = false;
            if (stream_->ReadableBytes() > 0)
            {
                doCanRead();
            }
        }

        uint32_t getStreamId() { return stream_->GetStreamId(); }

        // nan stuff

        static NAN_METHOD(startReading)
        {
            Http3WTStream *obj = Nan::ObjectWrap::Unwrap<Http3WTStream>(info.Holder());
            if (!info[0]->IsUndefined())
            {
                v8::Local<v8::Context> context = info.GetIsolate()->GetCurrentContext();

                std::function<void()> task = [obj]()
                { obj->tryRead(); };
                obj->server_->Schedule(task);
            }
        }

        static NAN_METHOD(stopReading)
        {
            Http3WTStream *obj = Nan::ObjectWrap::Unwrap<Http3WTStream>(info.Holder());
            if (!info[0]->IsUndefined())
            {
                v8::Local<v8::Context> context = info.GetIsolate()->GetCurrentContext();

                std::function<void()> task = [obj]()
                { obj->doStopReading(); };
                obj->server_->Schedule(task);
            }
        }

        static NAN_METHOD(writeChunk)
        {
            Http3WTStream *obj = Nan::ObjectWrap::Unwrap<Http3WTStream>(info.Holder());
            // ok we have to get the buffer
            if (!info[0]->IsUndefined())
            {
                v8::Local<v8::Context> context = info.GetIsolate()->GetCurrentContext();
                v8::Local<v8::Object> bufferlocal = info[0]->ToObject(context).ToLocalChecked();
                Nan::Persistent<v8::Object> *bufferHandle = new Nan::Persistent<v8::Object>(bufferlocal);
                char *buffer = node::Buffer::Data(bufferlocal);
                size_t len = node::Buffer::Length(bufferlocal);

                std::function<void()> task = [obj, bufferHandle, buffer, len]()
                { obj->writeChunkInt(buffer, len, bufferHandle); };
                obj->server_->Schedule(task);
            }
        }

        static NAN_METHOD(closeStream)
        {
            Http3WTStream *obj = Nan::ObjectWrap::Unwrap<Http3WTStream>(info.Holder());
            std::function<void()> task = [obj]()
            { obj->send_fin_ = true; };
        }

        static NAN_METHOD(New)
        {
            if (!info.IsConstructCall())
            {
                return Nan::ThrowError("Http3WTStream() must be called as a constructor");
            }

            if (info.Length() != 1 || !info[0]->IsExternal())
            {
                return Nan::ThrowError("Http3WTStream() can only be called internally");
            }

            Http3WTStream *obj = static_cast<Http3WTStream *>(info[0].As<v8::External>()->Value());
            obj->Wrap(info.This());
            info.GetReturnValue().Set(info.This());
        }

        static v8::Local<v8::Object> NewInstance(Http3WTStream *sv)
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

    protected:
        WebTransportStream *stream() { return stream_; }

        struct WChunks
        {
            char *buffer;
            size_t len;
            Nan::Persistent<v8::Object> *bufferhandle;
        };

        void writeChunkInt(char *buffer, size_t len, Nan::Persistent<v8::Object> *bufferhandle)
        {
            WChunks cur;
            cur.buffer = buffer;
            cur.len = len;
            cur.bufferhandle = bufferhandle;
            chunks_.push_back(cur);
            tryWrite();
        }

    private:
        WebTransportStream *stream_;
        Http3Server *server_;
        uint32_t parentobjnum_;
        bool send_fin_ = false;
        bool stop_sending_received_ = false;
        bool pause_reading_ = false;
        std::deque<WChunks> chunks_;
    };
}

#endif