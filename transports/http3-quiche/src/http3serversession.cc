// modifications
// Copyright (c) 2022 Marten Richter or other contributers (see commit). All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

// original copyright, see LICENSE.chromium
// Copyright (c) 2012 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "src/http3serversession.h"

#include <utility>

#include "absl/memory/memory.h"
#include "quiche/quic/core/http/quic_server_initiated_spdy_stream.h"
#include "quiche/quic/core/http/quic_spdy_session.h"
#include "quiche/quic/core/quic_connection.h"
#include "quiche/quic/core/quic_types.h"
#include "quiche/quic/core/quic_utils.h"
#include "quiche/quic/platform/api/quic_flags.h"
#include "quiche/quic/platform/api/quic_logging.h"
#include "src/http3serverstream.h"

namespace quic
{

  Http3ServerSession::Http3ServerSession(
      const QuicConfig &config, const ParsedQuicVersionVector &supported_versions,
      QuicConnection *connection, QuicSession::Visitor *visitor,
      QuicCryptoServerStreamBase::Helper *helper,
      const QuicCryptoServerConfig *crypto_config,
      QuicCompressedCertsCache *compressed_certs_cache,
      Http3ServerBackend *http3_server_backend)
      : QuicServerSessionBase(config, supported_versions, connection, visitor,
                              helper, crypto_config, compressed_certs_cache,
                              http3_server_backend->SupportsWebTransport()
                                 ? QuicPriorityType::kWebTransport
                                 : QuicPriorityType::kHttp),
        http3_server_backend_(http3_server_backend)
  {
    QUICHE_DCHECK(http3_server_backend_);
  }

  Http3ServerSession::~Http3ServerSession() { DeleteConnection(); }

  std::unique_ptr<QuicCryptoServerStreamBase>
  Http3ServerSession::CreateQuicCryptoServerStream(
      const QuicCryptoServerConfig *crypto_config,
      QuicCompressedCertsCache *compressed_certs_cache)
  {
    return CreateCryptoServerStream(crypto_config, compressed_certs_cache, this,
                                    stream_helper());
  }

  void Http3ServerSession::OnStreamFrame(const QuicStreamFrame &frame)
  {
    if (!IsIncomingStream(frame.stream_id) && !WillNegotiateWebTransport())
    {
      QUIC_LOG(WARNING) << "Client shouldn't send data on server push stream";
      connection()->CloseConnection(
          QUIC_INVALID_STREAM_ID, "Client sent data on server push stream",
          ConnectionCloseBehavior::SEND_CONNECTION_CLOSE_PACKET);
      return;
    }
    QuicSpdySession::OnStreamFrame(frame);
  }

  QuicSpdyStream *Http3ServerSession::CreateIncomingStream(QuicStreamId id)
  {
    if (!ShouldCreateIncomingStream(id))
    {
      return nullptr;
    }

    QuicSpdyStream *stream = new Http3ServerStream(
        id, this, BIDIRECTIONAL, http3_server_backend_);
    ActivateStream(absl::WrapUnique(stream));
    return stream;
  }

  QuicSpdyStream *Http3ServerSession::CreateIncomingStream(
      PendingStream *pending)
  {
    QuicSpdyStream *stream =
        new Http3ServerStream(pending, this, http3_server_backend_);
    ActivateStream(absl::WrapUnique(stream));
    return stream;
  }

  QuicSpdyStream *Http3ServerSession::CreateOutgoingBidirectionalStream()
  {
    if (!WillNegotiateWebTransport())
    {
      QUIC_BUG(Http3ServerSession CreateOutgoingBidirectionalStream without
                   WebTransport support)
          << "Http3ServerSession::CreateOutgoingBidirectionalStream called "
             "in a session without WebTransport support.";
      return nullptr;
    }
    if (!ShouldCreateOutgoingBidirectionalStream())
    {
      return nullptr;
    }

    QuicServerInitiatedSpdyStream *stream = new QuicServerInitiatedSpdyStream(
        GetNextOutgoingBidirectionalStreamId(), this, BIDIRECTIONAL);
    ActivateStream(absl::WrapUnique(stream));
    return stream;
  }

  Http3ServerStream *
  Http3ServerSession::CreateOutgoingUnidirectionalStream()
  {
    if (!ShouldCreateOutgoingUnidirectionalStream())
    {
      return nullptr;
    }

    Http3ServerStream *stream = new Http3ServerStream(
        GetNextOutgoingUnidirectionalStreamId(), this, WRITE_UNIDIRECTIONAL,
        http3_server_backend_);
    ActivateStream(absl::WrapUnique(stream));
    return stream;
  }

  void Http3ServerSession::OnCanCreateNewOutgoingStream(bool unidirectional) {
    if (SupportsWebTransport()) {
      auto itty = svisitors_.begin();
      for (auto itty = svisitors_.begin(); itty != svisitors_.end(); itty++) {
        if (unidirectional) {
          (*itty).second->OnCanCreateNewOutgoingUnidirectionalStream();
        } else {
          (*itty).second->OnCanCreateNewOutgoingBidirectionalStream();
        }
      }
    }
  }
} // namespace quic
