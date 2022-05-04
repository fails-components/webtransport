// modifications
// Copyright (c) 2022 Marten Richter or other contributers (see commit). All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

// original copyright, see LICENSE.chromium
// Copyright (c) 2018 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "src/http3clientsession.h"

#include <utility>

namespace quic {

Http3ClientSession::Http3ClientSession(
    const QuicConfig& config, const ParsedQuicVersionVector& supported_versions,
    QuicConnection* connection, const QuicServerId& server_id,
    QuicCryptoClientConfig* crypto_config,
    QuicClientPushPromiseIndex* push_promise_index, bool drop_response_body)
    : Http3ClientSession(config, supported_versions, connection, server_id,
                              crypto_config, push_promise_index,
                              drop_response_body,
                              /*enable_web_transport=*/false) {}

Http3ClientSession::Http3ClientSession(
    const QuicConfig& config, const ParsedQuicVersionVector& supported_versions,
    QuicConnection* connection, const QuicServerId& server_id,
    QuicCryptoClientConfig* crypto_config,
    QuicClientPushPromiseIndex* push_promise_index, bool drop_response_body,
    bool enable_web_transport)
    : QuicSpdyClientSession(config, supported_versions, connection, server_id,
                            crypto_config, push_promise_index),
      drop_response_body_(drop_response_body),
      enable_web_transport_(enable_web_transport) {}

std::unique_ptr<QuicSpdyClientStream>
Http3ClientSession::CreateClientStream() {
  return std::make_unique<Http3ClientStream>(
      GetNextOutgoingBidirectionalStreamId(), this, BIDIRECTIONAL,
      drop_response_body_);
}

bool Http3ClientSession::ShouldNegotiateWebTransport() {
  return enable_web_transport_;
}

HttpDatagramSupport Http3ClientSession::LocalHttpDatagramSupport() {
  return enable_web_transport_ ? HttpDatagramSupport::kDraft04
                               : HttpDatagramSupport::kNone;
}

}  // namespace quic
