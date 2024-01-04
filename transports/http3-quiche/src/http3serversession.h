// modifications
// Copyright (c) 2022 Marten Richter or other contributers (see commit). All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

// original copyright, see LICENSE.chromium
// Copyright (c) 2012 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

// A toy server specific QuicSession subclass.

#ifndef HTTP3_SERVER_SESSION_H
#define HTTP3_SERVER_SESSION_H

#include <stdint.h>

#include <list>
#include <memory>
#include <set>
#include <string>
#include <utility>
#include <vector>

#include "quiche/quic/core/http/quic_server_session_base.h"
#include "quiche/quic/core/http/quic_spdy_session.h"
#include "quiche/quic/core/quic_crypto_server_stream_base.h"
#include "quiche/quic/core/quic_packets.h"
// #include "quic/tools/quic_backend_response.h"
#include "src/http3serverbackend.h"
#include "src/http3serverstream.h" // todo

namespace quic
{

  class Http3ServerSession : public QuicServerSessionBase
  {
  public:
    // Takes ownership of |connection|.
    Http3ServerSession(const QuicConfig &config,
                       const ParsedQuicVersionVector &supported_versions,
                       QuicConnection *connection,
                       QuicSession::Visitor *visitor,
                       QuicCryptoServerStreamBase::Helper *helper,
                       const QuicCryptoServerConfig *crypto_config,
                       QuicCompressedCertsCache *compressed_certs_cache,
                       Http3ServerBackend *http3_server_backend);
    Http3ServerSession(const Http3ServerSession &) = delete;
    Http3ServerSession &operator=(const Http3ServerSession &) = delete;

    ~Http3ServerSession() override;

    // Override base class to detact client sending data on server push stream.
    void OnStreamFrame(const QuicStreamFrame &frame) override;

   void OnCanCreateNewOutgoingStream(bool unidirectional) override;
   void AddVisitor(const WebTransportSessionId id, webtransport::SessionVisitor *visitor) {
      svisitors_.try_emplace(id, visitor);
    }

  protected:
    // QuicSession methods:
    QuicSpdyStream *CreateIncomingStream(QuicStreamId id) override;
    QuicSpdyStream *CreateIncomingStream(PendingStream *pending) override;
    QuicSpdyStream *CreateOutgoingBidirectionalStream() override;
    Http3ServerStream *CreateOutgoingUnidirectionalStream() override;

    // QuicServerSessionBaseMethod:
    std::unique_ptr<QuicCryptoServerStreamBase> CreateQuicCryptoServerStream(
        const QuicCryptoServerConfig *crypto_config,
        QuicCompressedCertsCache *compressed_certs_cache) override;

    Http3ServerBackend *server_backend()
    {
      return http3_server_backend_;
    }

    WebTransportHttp3VersionSet LocallySupportedWebTransportVersions()
        const override
    {
      return http3_server_backend_->SupportsWebTransport()
                 ? kDefaultSupportedWebTransportVersions
                 : WebTransportHttp3VersionSet();
    }

    HttpDatagramSupport LocalHttpDatagramSupport() override
    {
      if (ShouldNegotiateWebTransport())
      {
        return HttpDatagramSupport::kRfcAndDraft04;
      }
      return QuicServerSessionBase::LocalHttpDatagramSupport();
    }

    Http3ServerBackend *http3_server_backend_; // Not owned.
    absl::flat_hash_map<QuicStreamId, webtransport::SessionVisitor *> svisitors_;
  };

} // namespace quic

#endif // QUICHE_QUIC_TOOLS_QUIC_SIMPLE_SERVER_SESSION_H_
