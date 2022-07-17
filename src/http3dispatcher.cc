// modifications
// Copyright (c) 2022 Marten Richter or other contributers (see commit). All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

// original copyright, see LICENSE.chromium
// Copyright (c) 2012 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "src/http3dispatcher.h"
#include "src/http3serversession.h"

#include "absl/strings/string_view.h"

namespace quic {

Http3Dispatcher::Http3Dispatcher(
    const QuicConfig* config,
    const QuicCryptoServerConfig* crypto_config,
    QuicVersionManager* version_manager,
    std::unique_ptr<QuicConnectionHelperInterface> helper,
    std::unique_ptr<QuicCryptoServerStreamBase::Helper> session_helper,
    std::unique_ptr<QuicAlarmFactory> alarm_factory,
    Http3ServerBackend* http3_server_backend,
    uint8_t expected_server_connection_id_length)
    : QuicDispatcher(config,
                     crypto_config,
                     version_manager,
                     std::move(helper),
                     std::move(session_helper),
                     std::move(alarm_factory),
                     expected_server_connection_id_length),
      http3_server_backend_(http3_server_backend) {}

Http3Dispatcher::~Http3Dispatcher() = default;



std::unique_ptr<QuicSession> Http3Dispatcher::CreateQuicSession(
    QuicConnectionId connection_id, const QuicSocketAddress& self_address,
    const QuicSocketAddress& peer_address, absl::string_view /*alpn*/,
    const ParsedQuicVersion& version,
    const ParsedClientHello& /*parsed_chlo*/) {
  // The QuicServerSessionBase takes ownership of |connection| below.
  QuicConnection* connection =
      new QuicConnection(connection_id, self_address, peer_address, helper(),
                         alarm_factory(), writer(),
                         /* owns_writer= */ false, Perspective::IS_SERVER,
                         ParsedQuicVersionVector{version});

  auto session = std::make_unique<Http3ServerSession>(
      config(), GetSupportedVersions(), connection, this, session_helper(),
      crypto_config(), compressed_certs_cache(), http3_server_backend_);
  session->Initialize();
  return session;
}

}  // namespace quic
