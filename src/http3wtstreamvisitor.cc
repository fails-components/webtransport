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
            stream_->server_->informAboutStreamWrite(stream_->parentobjnum_, stream_->stream_->GetStreamId(), cur.bufferhandle, false);

            stream_->chunks_.pop_front();
        }
        stream_->server_->informStreamClosed(stream_->parentobjnum_, stream_->stream_->GetStreamId());
        
        Http3WTStream *strobj = stream_;
        std::function<void()> task = [strobj]()
        { strobj->Unref(); };
        stream_->server_->Schedule(task);

        stream_->stream_ =  nullptr;
    }

    void Http3WTStream::doCanRead()
    {
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
                          << stream_->GetStreamId()
                          << ", bytes read: " << result.bytes_read;
            server_->informAboutStreamRead(parentobjnum_, stream_->GetStreamId(), data, result.fin);
        }
    }

    void Http3WTStream::doCanWrite()
    {
        if (stop_sending_received_ || pause_reading_)
        {
            return;
        }

        while (chunks_.size() > 0)
        {
            auto cur = chunks_.front();
            bool success = stream_->Write(absl::string_view(cur.buffer, cur.len));
            QUIC_DVLOG(1) << "Attempted writing on WebTransport bidirectional stream "
                          << stream_->GetStreamId()
                          << ", success: " << (success ? "yes" : "no");
            server_->informAboutStreamWrite(parentobjnum_, stream_->GetStreamId(), cur.bufferhandle, success);
            if (!success)
            {
                return;
            }
            // now we have to inform the server TODO

            chunks_.pop_front();
        }

        if (send_fin_)
        {
            bool success = stream_->SendFin();
            QUICHE_DCHECK(success);
        }
    }

}