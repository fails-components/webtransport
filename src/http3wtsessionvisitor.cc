// Copyright (c) 2022 Marten Richter or other contributers (see commit). All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "src/http3wtsessionvisitor.h"
#include "src/http3server.h"

namespace quic
{

    void Http3WTSession::Visitor::OnSessionClosed(WebTransportSessionError error_code,
                                                const std::string &error_message)
    {

        session_->server_->informSessionClosed(session_->objnum_, error_code, error_message);
    }

    void Http3WTSession::Visitor::OnSessionReady(const spdy::SpdyHeaderBlock &)
    {
        session_->server_->informSessionReady(session_->objnum_);

        if (session_->session_->CanOpenNextOutgoingBidirectionalStream())
        {
            OnCanCreateNewOutgoingBidirectionalStream();
        }
        if (session_->session_->CanOpenNextOutgoingUnidirectionalStream())
        {
            OnCanCreateNewOutgoingUnidirectionalStream();
        }
    }

}