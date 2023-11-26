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

#include <string>

#include "src/librarymain.h"
#include "quiche/common/simple_buffer_allocator.h"
#include "quiche/quic/core/web_transport_interface.h"
#include "quiche/quic/platform/api/quic_logging.h"
#include "quiche/common/quiche_circular_deque.h"

namespace quic
{
    class Http3EventLoop;

    class Http3WTStreamJS;

    class Http3WTStream
    {
        friend Http3WTStreamJS;

    public:
        Http3WTStream(WebTransportStream *stream) : stream_(stream),
                                                    js_(nullptr),
                                                    readpos_(0),
                                                    writepos_(0),
                                                    bufferlen_(0),
                                                    readbufsize_(0),
                                                    readbufdata_(nullptr)
        {
        }

        ~Http3WTStream(){printf("stream destruct %x\n", this);};

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

        inline bool readBufferFull()
        {
            return !readbufdata_ || bufferlen_ >= readbufsize_;
        }

        void tryRead()
        {
            pause_reading_ = false;
            if (stream_ && ((stream_->ReadableBytes() > 0) || can_read_pending_) && !readBufferFull())
            {
                can_read_pending_ = false;
                doCanRead();
            }
        }

        Http3WTStreamJS *getJS()
        {
            return js_;
        }

        void setJS(Http3WTStreamJS *js)
        {
            js_ = js;
        };

        bool gone()
        {
            return !stream_;
        }

        void setReadBuffer(void *data, size_t length)
        {
            readbufsize_ = length;
            readbufdata_ = data;
            tryRead();
        }

    protected:
        // internal functions called by js object

        void streamFinalInt()
        {
            send_fin_ = true;
            tryWrite();
        }

        void stopSendingInt(unsigned int reason);
        void resetStreamInt(unsigned int reason);

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

        void updateReadPosInt(size_t readbytes, uint32_t readpos)
        {
            if (!stream_)
            {
                return;
            }
            readpos_ = readpos;
            bufferlen_ -= readbytes;
            tryRead();
        }

        void cancelWrite(Napi::ObjectReference *handle);

    private:
        Http3WTStreamJS *js_;

        WebTransportStream *stream_;
        bool send_fin_ = false;
        bool fin_was_sent_ = false;
        bool stop_sending_received_ = false;
        bool pause_reading_ = false;
        bool can_read_pending_ = false;
        bool stream_was_reset_ = false;
        std::deque<WChunks> chunks_;

        // reading stream
        uint32_t readpos_;
        uint32_t writepos_;
        uint32_t bufferlen_;
        size_t readbufsize_;
        void *readbufdata_;
    };

    class Http3WTStreamJS : public Napi::ObjectWrap<Http3WTStreamJS>
    {
        friend Http3WTStream;
        friend Http3WTStream::Visitor;

    public:
        Http3WTStreamJS(const Napi::CallbackInfo &info) : Napi::ObjectWrap<Http3WTStreamJS>(info)
        {
        }

        ~Http3WTStreamJS() {
            printf("~Http3WTStreamJS\n");
        }

        void init(Http3WTStream *wtstream);

        // nan stuff

        void startReading(const Napi::CallbackInfo &info)
        {
            wtstream_->tryRead();
        }

        void stopReading(const Napi::CallbackInfo &info)
        {
            wtstream_->doStopReading();
        }

        void writeChunk(const Napi::CallbackInfo &info)
        {
            // ok we have to get the buffer

            const Napi::Object bufferlocal = info[0].ToObject();
            Napi::ObjectReference *bufferhandle = new Napi::ObjectReference();
            *bufferhandle = Napi::Persistent(bufferlocal);

            char *buffer = bufferlocal.As<Napi::Buffer<char>>().Data();
            size_t len = bufferlocal.As<Napi::Buffer<char>>().Length();

            wtstream_->writeChunkInt(buffer, len, bufferhandle);
        }

        void updateReadPos(const Napi::CallbackInfo &info)
        {
            // ok we have to get the buffer
            uint32_t readpos = 0;
            size_t readbytes = 0;

            if (!info[0].IsUndefined())
            {
                Napi::Number readbytesl = info[0].ToNumber();
                readbytes = readbytesl.Uint32Value();
            }
            else
            {
                return Napi::Error::New(Env(), "No readbytes passed").ThrowAsJavaScriptException();
            }

            if (!info[1].IsUndefined())
            {
                Napi::Number readposl = info[1].ToNumber();
                readpos = readposl.Uint32Value();
            }
            else
            {
                return Napi::Error::New(Env(), "No readpos passed").ThrowAsJavaScriptException();
            }

            wtstream_->updateReadPosInt(readbytes, readpos);
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

        static void InitExports(Napi::Env env, Napi::Object exports, Http3Constructors *constr)
        {
            Napi::Function tplwtsv =
                DefineClass(env, "Http3WTStreamVisitor",
                            {InstanceMethod<&Http3WTStreamJS::writeChunk>("writeChunk",
                                                                          static_cast<napi_property_attributes>(napi_writable | napi_configurable)),
                             InstanceMethod<&Http3WTStreamJS::updateReadPos>("updateReadPos",
                                                                             static_cast<napi_property_attributes>(napi_writable | napi_configurable)),
                             InstanceMethod<&Http3WTStreamJS::resetStream>("resetStream",
                                                                           static_cast<napi_property_attributes>(napi_writable | napi_configurable)),
                             InstanceMethod<&Http3WTStreamJS::stopSending>("stopSending", static_cast<napi_property_attributes>(napi_writable | napi_configurable)),
                             InstanceMethod<&Http3WTStreamJS::streamFinal>("streamFinal", static_cast<napi_property_attributes>(napi_writable | napi_configurable)),
                             InstanceMethod<&Http3WTStreamJS::startReading>("startReading",
                                                                            static_cast<napi_property_attributes>(napi_writable | napi_configurable)),
                             InstanceMethod<&Http3WTStreamJS::stopReading>("stopReading",
                                                                           static_cast<napi_property_attributes>(napi_writable | napi_configurable))});
            constr->stream = Napi::Persistent(tplwtsv);
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

    protected:
        std::unique_ptr<Http3WTStream> wtstream_;

        void processStreamRead(size_t buffergrow, bool fin, bool success);
        void processStreamWrite(Napi::ObjectReference *bufferhandle, bool success);
        void processStreamNetworkFinish(NetworkTask task);
        void processStreamRecvSignal(WebTransportStreamError error_code, NetworkTask task);
    };
}

#endif
