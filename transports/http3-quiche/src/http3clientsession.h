// modifications
// Copyright (c) 2022 Marten Richter or other contributers (see commit). All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

// original copyright, see LICENSE.chromium
// Copyright (c) 2018 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef HTTP3_CLIENT_SESSION_H
#define HTTP3_CLIENT_SESSION_H

#include <functional>
#include <utility>

#include "quiche/quic/core/http/quic_spdy_client_session.h"
#include "src/http3clientstream.h"

namespace quic
{

  class Http3ClientSession : public QuicSpdyClientSession
  {
  public:
    Http3ClientSession(const QuicConfig &config,
                       const ParsedQuicVersionVector &supported_versions,
                       QuicConnection *connection,
                       const QuicServerId &server_id,
                       QuicCryptoClientConfig *crypto_config,
                       bool drop_response_body);
    Http3ClientSession(const QuicConfig &config,
                       const ParsedQuicVersionVector &supported_versions,
                       QuicConnection *connection,
                       const QuicServerId &server_id,
                       QuicCryptoClientConfig *crypto_config,
                       bool drop_response_body, bool enable_web_transport);

    std::unique_ptr<QuicSpdyClientStream> CreateClientStream() override;
    WebTransportHttp3VersionSet LocallySupportedWebTransportVersions()
        const override;
    HttpDatagramSupport LocalHttpDatagramSupport() override;

    void set_on_interim_headers(
        std::function<void(const spdy::Http2HeaderBlock &)> on_interim_headers)
    {
      on_interim_headers_ = std::move(on_interim_headers);
    }

  private:
    std::function<void(const spdy::Http2HeaderBlock &)> on_interim_headers_;
    const bool drop_response_body_;
    const bool enable_web_transport_;
  };

} // namespace quic

#endif // QUICHE_QUIC_TOOLS_QUIC_SIMPLE_CLIENT_SESSION_H_
