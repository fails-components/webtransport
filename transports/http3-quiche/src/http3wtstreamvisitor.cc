// Copyright (c) 2022 Marten Richter or other contributers (see commit). All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "src/http3wtstreamvisitor.h"
#include "src/http3server.h"
#include "quiche/web_transport/stream_helpers.h"

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

            cur.bufferhandle->Unref(); // release the outgoing buffer
            delete cur.bufferhandle;   // free the handle object

            stream_->chunks_.pop_front();
        }

        if (!stream_->stop_sending_received_)
        {
            stream_->getJS()->processStreamStopSending(0);
        }
        if (!stream_->stream_was_reset_)
        {
            stream_->getJS()->processStreamResetStream(0);
        }
        Http3WTStreamJS *strobj = stream_->getJS();
        if (strobj)
        {
            stream_->stream_ = nullptr;
            strobj->Unref();
        }
        else
        {
            delete stream_;
            stream_->stream_ = nullptr;
        }
    }

    void Http3WTStream::Visitor::OnWriteSideInDataRecvdState() // called if everything is written to the client and it is closed
    {
        /*
        if (stream_->send_fin_)
            stream_->getJS()->processStreamNetworkFinish(NetworkTask::streamFinal);
        */
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
        stream_->getJS()->processStreamResetStream(error); // may be move below
    }

    void Http3WTStream::Visitor::OnStopSendingReceived(WebTransportStreamError error)
    {
        stream_->stop_sending_received_ = true;
        stream_->getJS()->processStreamStopSending(error); // may be move below
        // we should also finallize the stream, so send a fin
        stream_->send_fin_ = true;
        OnCanWrite();
    }

    void Http3WTStream::Visitor::OnCanRead()
    {
        stream_->getJS()->processStreamOnCanRead();
    }

    std::tuple<bool, std::optional<Napi::ArrayBuffer>> Http3WTStream::pullData() {
      if (!stream_) return {true, std::nullopt}; // everything is gone bail out
      // if (pause_reading_) return ; // back pressure folks!
      WebTransportStream::PeekResult pr;
      pr = stream_->PeekNextReadableRegion();

      if (pr.fin_next && pr.peeked_data.size() == 0) {
        bool fin = stream_->SkipBytes(0);
        if (fin) {
          return {true, std::nullopt};
        }
      }

      bool read = false;
      size_t toread = stream_->ReadableBytes();

      if (toread == 0) {
        return {false, std::nullopt};
      }

      
      Napi::ArrayBuffer bufferVal = Napi::ArrayBuffer::New(getJS()->Env(), toread);
      char* bufferPtr = (char*) bufferVal.Data();

      size_t remainSize = toread;
      uint32_t writepos = 0;
      bool fin = false;

      while (!pr.peeked_data.empty() && remainSize > 0) {
        size_t len = std::min(remainSize, pr.peeked_data.size());
        if (len > 0) memcpy(bufferPtr + writepos, pr.peeked_data.data(), len);
        fin = fin || stream_->SkipBytes(len);
        QUIC_DVLOG(1) << "Attempted reading on WebTransport stream "
                      << ", bytes read: " << len;
        writepos += len;
        remainSize -= len;
        pr = stream_->PeekNextReadableRegion();
        if (fin) {
          break;
        }
      }
      return {fin, bufferVal};
    }

    void Http3WTStream::doCanWrite()
    {
        if (!stream_) return;
        /* if (/* stop_sending_received_ || * pause_reading_)
         {
             return;
         } */
        if (fin_was_sent_)
            return;

        while (chunks_.size() > 0)
        {
            auto cur = chunks_.front();
            absl::Status status = 
                webtransport::WriteIntoStream(*stream_, absl::string_view(cur.buffer, cur.len));
            QUIC_DVLOG(1) << "Attempted writing on WebTransport bidirectional stream "
                          << ", success: " << status;
            if (!status.ok())
            {
                return;
            }
            cur.bufferhandle->Unref(); // release the outgoing buffer
            delete cur.bufferhandle;   // free the handle object
            chunks_.pop_front();
        }

        if (send_fin_)
        {
            absl::Status status = webtransport::SendFinOnStream(*stream_);
            if (status.ok()) {
                fin_was_sent_ = true;
            }
        }
    }

    void Http3WTStream::mayBeSendOnCanWrite() {
        if (!stream_) return;
        if (stream_->CanWrite()) getJS()->processStreamOnCanWrite();
    }

    void Http3WTStream::stopSendingInt(unsigned int reason)
    {
        if (stream_)
        {
            stream_->SendStopSending(reason);
        }
    }

    void Http3WTStream::resetStreamInt(unsigned int reason)
    {
        if (stream_)
        {
            stream_->ResetWithUserCode(reason);
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

    void Http3WTStreamJS::processStreamOnCanRead()
    {
        Napi::HandleScope scope(Env());
        Napi::Object objVal = Value().Get("jsobj").As<Napi::Object>();
       
        objVal.Get("onCanRead").As<Napi::Function>().Call(objVal, {});
    }

    void Http3WTStreamJS::processStreamOnCanWrite()
    {
        Napi::HandleScope scope(Env());
        Napi::Object objVal = Value().Get("jsobj").As<Napi::Object>();
       
        objVal.Get("onCanWrite").As<Napi::Function>().Call(objVal, {});
    }

    void Http3WTStreamJS::processStreamStopSending(WebTransportStreamError error_code)
    {
        Napi::HandleScope scope(Env());

        Napi::Object objVal = Value().Get("jsobj").As<Napi::Object>();
        Napi::Value codeVal = Napi::Number::New(Env(), static_cast<uint32_t>(error_code));

        objVal.Get("onStopSending").As<Napi::Function>().Call(objVal, {codeVal});
    }

    void Http3WTStreamJS::processStreamResetStream(WebTransportStreamError error_code)
    {
        Napi::HandleScope scope(Env());

        Napi::Object objVal = Value().Get("jsobj").As<Napi::Object>();
        Napi::Value codeVal = Napi::Number::New(Env(), static_cast<uint32_t>(error_code));

        objVal.Get("onResetStream").As<Napi::Function>().Call(objVal, {codeVal});
    }

}
