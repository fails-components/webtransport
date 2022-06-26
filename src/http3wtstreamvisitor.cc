// Copyright (c) 2022 Marten Richter or other contributers (see commit). All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "src/http3wtstreamvisitor.h"
#include "src/http3server.h"

namespace quic
{

    Http3WTStream::Visitor::~Visitor()
    {
        while (stream_->chunks_.size() > 0)
        {
            auto cur = stream_->chunks_.front();

            // now we have to inform the server TODO
            stream_->eventloop_->informAboutStreamWrite(stream_, cur.bufferhandle, false);

            stream_->chunks_.pop_front();
        }
        Http3WTStream *strobj = stream_;
        stream_->stream_ = nullptr;
        strobj->eventloop_->informUnref(strobj);
    }

    void Http3WTStream::Visitor::OnWriteSideInDataRecvdState() // called if everything is written to the client and it is closed
    {
        if (stream_->send_fin_)
            stream_->eventloop_->informAboutStreamNetworkFinish(stream_, NetworkTask::streamFinal);
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
        lasterror = error;
        stream_->eventloop_->informStreamRecvSignal(stream_, error, NetworkTask::resetStream); // may be move below
    }

    void Http3WTStream::Visitor::OnStopSendingReceived(WebTransportStreamError error)
    {
        stream_->stop_sending_received_ = true;
        stream_->eventloop_->informStreamRecvSignal(stream_, error, NetworkTask::stopSending); // may be move below
        // we should also finallize the stream, so send a fin
        stream_->send_fin_ = true;
        OnCanWrite();
    }

    void Http3WTStream::cancelWrite(Nan::Persistent<v8::Object> *handle)
    {
        eventloop_->informAboutStreamWrite(this, handle, false);
    }

    void Http3WTStream::doCanRead()
    {
        if (pause_reading_)
            return; // back pressure folks!
        // first figure out if we have readable data
        size_t readable = stream_->ReadableBytes();
        if (readable > 0)
        {
            // ok create a string obj to hold the data
            std::string *data = new std::string();
            data->resize(readable);
            WebTransportStream::ReadResult result = stream_->Read(&(*data)[0], readable);
            data->resize(result.bytes_read);
            QUIC_DVLOG(1) << "Attempted reading on WebTransport bidirectional stream "
                          << ", bytes read: " << result.bytes_read;
            eventloop_->informAboutStreamRead(this, data, result.fin);
        }
    }

    void Http3WTStream::doCanWrite()
    {
        /* if (/* stop_sending_received_ || * pause_reading_)
         {
             return;
         } */
        if (fin_was_sent_) return;

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
            eventloop_->informAboutStreamWrite(this, cur.bufferhandle, true);

            chunks_.pop_front();
        }

        if (send_fin_)
        {
            bool success = stream_->SendFin();
            QUICHE_DCHECK(success);
            fin_was_sent_ = true;
        }
    }

}