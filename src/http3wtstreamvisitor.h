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

#include <napi.h>
#include <uv.h>

#include <string>

#include "quiche/common/simple_buffer_allocator.h"
#include "quiche/quic/core/web_transport_interface.h"
#include "quiche/quic/platform/api/quic_logging.h"
#include "quiche/common/quiche_circular_deque.h"

#include "src/http3eventloop.h"

namespace quic
{
    class Http3EventLoop;

    class Http3WTStreamJS;

    class Http3WTStream
    {
        friend Http3WTStreamJS;

    public:
        Http3WTStream(WebTransportStream *stream, Http3EventLoop *eventloop) : stream_(stream), eventloop_(eventloop), js_(nullptr)
        {
        }

        ~Http3WTStream(){/*printf("stream destruct %x\n", this);*/};

        class Visitor : public WebTransportStreamVisitor
        {
        public:
            Visitor(Http3WTStream *stream) : stream_(stream), lasterror(0) {}

            ~Visitor();

            void OnCanRead() override
            {
                stream_->doCanRead();
            }

            void OnCanWrite() override
            {
                stream_->doCanWrite();
            }

            void OnResetStreamReceived(WebTransportStreamError error) override;

            void OnStopSendingReceived(WebTransportStreamError /*error*/) override;

            void OnWriteSideInDataRecvdState() override;

            void OnStopReading()
            {
                stream_->doStopReading();
            }

        protected:
            Http3WTStream *stream_;
            WebTransportStreamError lasterror;
        };

        void doCanRead();

        void doCanWrite();

        void doStopReading()
        {
            pause_reading_ = true;
        }

        void tryWrite()
        {
            if (stream_ && stream_->CanWrite())
            {
                doCanWrite();
            }
        }

        void tryRead()
        {
            pause_reading_ = false;
            if (stream_ && ((stream_->ReadableBytes() > 0) || can_read_pending_))
            {
                can_read_pending_ = false;
                doCanRead();
            }
        }

        Http3WTStreamJS  *getJS()
        {
            return js_;
        }

        void setJS(Http3WTStreamJS  *js) { 
            js_ = js; 
        };

        bool gone() {
            return !stream_;
        }

    protected:
        // internal functions called by js object
        void startReadingInt()
        {

            std::function<void()> task = [this]()
            { if (!stream_) return; // we do not have to cancel a promise?
                    tryRead(); };
            eventloop_->Schedule(task);
        }
        void stopReadingInt()
        {
            std::function<void()> task = [this]()
            { doStopReading(); };
            eventloop_->Schedule(task);
        }

        void writeChunkIntJS(char *buffer, size_t len, Napi::ObjectReference *bufferhandle)
        {
            std::function<void()> task = [this, bufferhandle, buffer, len]()
            { writeChunkInt(buffer, len, bufferhandle); };
            eventloop_->Schedule(task);
        }

        void streamFinalInt()
        {
            std::function<void()> task = [this]()
            {
                send_fin_ = true;
                tryWrite();
            };
            eventloop_->Schedule(task);
        }

        void stopSendingInt(unsigned int reason)
        {
            std::function<void()> task = [this, reason]()
            {
                if (stream_)
                {
                    stream_->SendStopSending(reason);
                    eventloop_->informAboutStreamNetworkFinish(this, NetworkTask::stopSending);
                }
            };
            eventloop_->Schedule(task);
        }

        void resetStreamInt(unsigned int reason)
        {
            std::function<void()> task = [this, reason]()
            {
                if (stream_)
                {
                    stream_->ResetWithUserCode(reason);
                    eventloop_->informAboutStreamNetworkFinish(this, NetworkTask::resetStream);
                }
            };
            eventloop_->Schedule(task);
        }

        WebTransportStream *stream() { return stream_; }

        struct WChunks
        {
            char *buffer;
            size_t len;
            Napi::ObjectReference *bufferhandle;
        };

        void writeChunkInt(char *buffer, size_t len, Napi::ObjectReference *bufferhandle)
        {
            if (fin_was_sent_ || send_fin_)
            {
                cancelWrite(bufferhandle);
                return;
            }
            if (!stream_)
            {
                cancelWrite(bufferhandle);
                return;
            }
            WChunks cur;
            cur.buffer = buffer;
            cur.len = len;
            cur.bufferhandle = bufferhandle;
            chunks_.push_back(cur);
            tryWrite();
        }

        void cancelWrite(Napi::ObjectReference *handle);

    private:
       
        Http3WTStreamJS *js_;

        WebTransportStream *stream_;
        Http3EventLoop *eventloop_;
        bool send_fin_ = false;
        bool fin_was_sent_ = false;
        bool stop_sending_received_ = false;
        bool pause_reading_ = false;
        bool can_read_pending_ = false;
        bool stream_was_reset_ = false;
        std::deque<WChunks> chunks_;
    };

    class Http3WTStreamJS : public Napi::ObjectWrap<Http3WTStreamJS>, public LifetimeHelper
    {
    public:
        Http3WTStreamJS(const Napi::CallbackInfo &info) : Napi::ObjectWrap<Http3WTStreamJS>(info)
        {
        }

        void init(Http3WTStream *wtstream);

        // nan stuff

        void startReading(const Napi::CallbackInfo &info)
        {
            wtstream_->startReadingInt();
        }

        void stopReading(const Napi::CallbackInfo &info)
        {
            wtstream_->stopReadingInt();
        }

        void writeChunk(const Napi::CallbackInfo &info)
        {
            // ok we have to get the buffer

            const Napi::Object bufferlocal = info[0].ToObject();
            Napi::ObjectReference *bufferhandle = new Napi::ObjectReference();
            *bufferhandle = Napi::Persistent(bufferlocal);

            char *buffer = bufferlocal.As<Napi::Buffer<char>>().Data();
            size_t len = bufferlocal.As<Napi::Buffer<char>>().Length();

            wtstream_->writeChunkIntJS(buffer, len, bufferhandle);
        }

        void streamFinal(const Napi::CallbackInfo &info)
        {
            wtstream_->streamFinalInt();
        }

        void stopSending(const Napi::CallbackInfo &info)
        {
            unsigned int reason = 0;

            if (!info[0].IsUndefined())
            {
                Napi::Number reasonl = info[0].ToNumber();
                reason = reasonl.Int32Value();
            }

            wtstream_->stopSendingInt(reason);
        }

        void resetStream(const Napi::CallbackInfo &info)
        {
            int code = 0;
            unsigned int reason = 0;

            if (!info[0].IsUndefined())
            {
                Napi::Number reasonl = info[0].ToNumber();
                reason = reasonl.Int32Value();
            }

            wtstream_->resetStreamInt(reason);
        }

        static void InitExports(Napi::Env env, Napi::Object exports, Http3Constructors * constr)
        {
            Napi::Function tplwtsv =
                DefineClass(env, "Http3WTStreamVisitor",
                            {InstanceMethod<&Http3WTStreamJS::writeChunk>("writeChunk",
                                                                          static_cast<napi_property_attributes>(napi_writable | napi_configurable)),
                             InstanceMethod<&Http3WTStreamJS::resetStream>("resetStream",
                                                                           static_cast<napi_property_attributes>(napi_writable | napi_configurable)),
                             InstanceMethod<&Http3WTStreamJS::stopSending>("stopSending", static_cast<napi_property_attributes>(napi_writable | napi_configurable)), InstanceMethod<&Http3WTStreamJS::streamFinal>("streamFinal", static_cast<napi_property_attributes>(napi_writable | napi_configurable)), InstanceMethod<&Http3WTStreamJS::startReading>("startReading", static_cast<napi_property_attributes>(napi_writable | napi_configurable)),
                             InstanceMethod<&Http3WTStreamJS::startReading>("startReading",
                                                                           static_cast<napi_property_attributes>(napi_writable | napi_configurable)),
                             InstanceMethod<&Http3WTStreamJS::stopReading>("stopReading",
                                                                           static_cast<napi_property_attributes>(napi_writable | napi_configurable))});
            constr->stream  = Napi::Persistent(tplwtsv); 
            exports.Set("Http3WTStreamVisitor", tplwtsv);
        }

        void setObj(Http3WTStream *wtstream)
        {
            wtstream_ = std::unique_ptr<Http3WTStream>(wtstream);
        }

        Http3WTStream *getObj()
        {
            return wtstream_.get();
        }

        void doUnref() override
        {
            Unref();
        }

    protected:
        std::unique_ptr<Http3WTStream> wtstream_;
    };
}

#endif