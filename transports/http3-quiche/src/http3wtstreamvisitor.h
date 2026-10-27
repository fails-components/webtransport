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
                                                    js_(nullptr)
        {
        }

        ~Http3WTStream() { /*printf("stream destruct %x\n", this);*/ };

        class Visitor : public WebTransportStreamVisitor
        {
        public:
            Visitor(Http3WTStream *stream) : stream_(stream), lasterror(0) {}

            ~Visitor();

            void OnCanRead() override;

            void OnCanWrite() override
            {
                stream_->doCanWrite();
                stream_->mayBeSendOnCanWrite();
            }

            void OnResetStreamReceived(WebTransportStreamError error) override;

            void OnStopSendingReceived(WebTransportStreamError /*error*/) override;

            void OnWriteSideInDataRecvdState() override;

        protected:
            Http3WTStream *stream_;
            WebTransportStreamError lasterror;
        };

        std::tuple<bool, std::optional<Napi::ArrayBuffer>> pullData();

        void doCanWrite();

        void mayBeSendOnCanWrite();

        bool canWrite() { 
            if (!stream_) return false;
            return stream_->CanWrite();
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

    protected:
        // internal functions called by js object

        void streamFinalInt()
        {
            send_fin_ = true;
            if (canWrite()) {
               doCanWrite();
            }
        }

        bool chunksEmpty() {
            return chunks_.empty();
        }

        void stopSendingInt(unsigned int reason);
        void resetStreamInt(unsigned int reason);

        void updateSendOrderAndGroupInt(uint64_t sendOrder, uint64_t sendGroupId);

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
                bufferhandle->Unref(); // release the outgoing buffer
                delete bufferhandle;   // free the handle object
                return;
            }
            if (!stream_)
            {
                bufferhandle->Unref(); // release the outgoing buffer
                delete bufferhandle;   // free the handle object
                return;
            }
            WChunks cur;
            cur.buffer = buffer;
            cur.len = len;
            cur.bufferhandle = bufferhandle;
            chunks_.push_back(cur);
        }

        void cancelWrite(Napi::ObjectReference *handle);

    private:
        Http3WTStreamJS *js_;

        WebTransportStream *stream_;
        bool send_fin_ = false;
        bool fin_was_sent_ = false;
        bool stop_sending_received_ = false;
        bool stream_was_reset_ = false;
        std::deque<WChunks> chunks_;
    };

    class Http3WTStreamJS : public Napi::ObjectWrap<Http3WTStreamJS>
    {
        friend Http3WTStream;
        friend Http3WTStream::Visitor;

    public:
        Http3WTStreamJS(const Napi::CallbackInfo &info) : Napi::ObjectWrap<Http3WTStreamJS>(info)
        {
        }

        void init(Http3WTStream *wtstream);

        // nan stuff

        Napi::Value writeChunks(const Napi::CallbackInfo &info)
        {
            if (!wtstream_->canWrite()) {
                return Napi::Boolean::New(Env(), false);
            }

            Napi::Array bufferArray = info[0].As<Napi::Array>();
            uint32_t length = bufferArray.Length();

            for (uint32_t i = 0; i < length; ++i) {
              Napi::Object bufferlocal = bufferArray.Get(i).As<Napi::Object>();

              Napi::ObjectReference* bufferhandle = new Napi::ObjectReference();
              *bufferhandle = Napi::Persistent(bufferlocal);

              char* buffer = bufferlocal.As<Napi::Buffer<char>>().Data();
              size_t len = bufferlocal.As<Napi::Buffer<char>>().Length();

              wtstream_->writeChunkInt(buffer, len, bufferhandle);
            }
            if (!wtstream_->canWrite()) return Napi::Boolean::New(Env(), true);
            
            
            wtstream_->doCanWrite();

            return Napi::Boolean::New(Env(), true);
        }

        void streamFinal(const Napi::CallbackInfo &info)
        {
            wtstream_->streamFinalInt();
        }

        Napi::Value pullData(const Napi::CallbackInfo& info)
        {
            auto [fin, maybeBuffer] = wtstream_->pullData();
            Napi::Object retObj = Napi::Object::New(Env());
            retObj.Set("fin", fin);
            if (maybeBuffer.has_value()) {
                retObj.Set("data", Napi::Value(info.Env(), *maybeBuffer));
            } else {
                retObj.Set("buffer", info.Env().Undefined());
            }
            return retObj;
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

        void updateSendOrderAndGroup(const Napi::CallbackInfo &info)
        {
            if (!info[0].IsUndefined())
            {
                Napi::Object obj = info[0].ToObject();
                uint64_t sendOrder = 0;
                uint64_t sendGroupId = 0;

                if (obj.Has("sendOrder") && !(obj).Get("sendOrder").IsEmpty())
                {
                    Napi::Value sendOrderValue = (obj).Get("sendOrder");
                    sendOrder = sendOrderValue.As<Napi::Number>().Int64Value();
                }
                if (obj.Has("sendGroupId") && !(obj).Get("sendGroupId").IsEmpty())
                {
                    Napi::Value sendGroupIdValue = (obj).Get("sendGroupId");
                    bool approx;
                    sendGroupId = sendGroupIdValue.As<Napi::BigInt>().Uint64Value(&approx);
                }
                wtstream_->updateSendOrderAndGroupInt(sendOrder, sendGroupId);
            }
        }

        static void InitExports(Napi::Env env, Napi::Object exports, Http3Constructors *constr)
        {
            Napi::Function tplwtsv =
                DefineClass(env, "Http3WTStreamVisitor",
                            {
                                InstanceMethod<&Http3WTStreamJS::writeChunks>("writeChunks",
                                                                             static_cast<napi_property_attributes>(napi_writable | napi_configurable)),
                                InstanceMethod<&Http3WTStreamJS::resetStream>("resetStream",
                                                                              static_cast<napi_property_attributes>(napi_writable | napi_configurable)),
                                InstanceMethod<&Http3WTStreamJS::stopSending>("stopSending", static_cast<napi_property_attributes>(napi_writable | napi_configurable)),
                                InstanceMethod<&Http3WTStreamJS::streamFinal>("streamFinal", static_cast<napi_property_attributes>(napi_writable | napi_configurable)),
                                InstanceMethod<&Http3WTStreamJS::pullData>("pullData",
                                                                               static_cast<napi_property_attributes>(napi_writable | napi_configurable)),
                                InstanceMethod<&Http3WTStreamJS::updateSendOrderAndGroup>("updateSendOrderAndGroup",
                                                                                          static_cast<napi_property_attributes>(napi_writable | napi_configurable)),
                            });
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

        void processStreamOnCanRead();
        void processStreamOnCanWrite();
        void processStreamStopSending(WebTransportStreamError error_code);
        void processStreamResetStream(WebTransportStreamError error_code);
    };
}

#endif
