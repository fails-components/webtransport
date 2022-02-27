// Copyright (c) 2022 Marten Richter or other contributers (see commit). All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "src/http3wtsessionvisitor.h"
#include "src/http3server.h"

namespace quic
{

    void Http3WTSessionVisitor::OnSessionClosed(WebTransportSessionError error_code,
                                                const std::string &error_message)
    {

        server_->informSessionClosed(objnum_, error_code, error_message);
    }

    void Http3WTSessionVisitor::OnSessionReady(const spdy::SpdyHeaderBlock &)
    {
        server_->informSessionReady(objnum_);

        if (session_->CanOpenNextOutgoingBidirectionalStream())
        {
            OnCanCreateNewOutgoingBidirectionalStream();
        }
        if (session_->CanOpenNextOutgoingUnidirectionalStream())
        {
            OnCanCreateNewOutgoingUnidirectionalStream();
        }
    }

}