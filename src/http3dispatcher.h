// modifications
// Copyright (c) 2022 Marten Richter or other contributers (see commit). All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

// original copyright, see LICENSE.chromium
// Copyright (c) 2012 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef HTTP3_DISPATCHER
#define HTTP3_DISPATCHER

#include "src/http3serverbackend.h"
#include "absl/strings/string_view.h"
#include "quiche/quic/core/http/quic_server_session_base.h"
#include "quiche/quic/core/quic_dispatcher.h"

namespace quic
{

  class Http3Dispatcher : public QuicDispatcher
  {
  public:
    Http3Dispatcher(
        const QuicConfig *config,
        const QuicCryptoServerConfig *crypto_config,
        QuicVersionManager *version_manager,
        std::unique_ptr<QuicConnectionHelperInterface> helper,
        std::unique_ptr<QuicCryptoServerStreamBase::Helper> session_helper,
        std::unique_ptr<QuicAlarmFactory> alarm_factory,
        Http3ServerBackend *http3_server_backend,
        uint8_t expected_server_connection_id_length);

    ~Http3Dispatcher() override;

  protected:
    std::unique_ptr<QuicSession> CreateQuicSession(
        QuicConnectionId connection_id, const QuicSocketAddress &self_address,
        const QuicSocketAddress &peer_address, absl::string_view alpn,
        const ParsedQuicVersion &version,
        const ParsedClientHello &parsed_chlo) override;

    Http3ServerBackend *server_backend()
    {
      return http3_server_backend_;
    }

  private:
    Http3ServerBackend *http3_server_backend_; // Unowned.
  };

} // namespace quic

#endif
