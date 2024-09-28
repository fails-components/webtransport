// modifications
// Copyright (c) 2022 Marten Richter or other contributers (see commit). All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

// original copyright, see LICENSE.chromium
// Copyright (c) 2018 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef HTTP3_CLIENT_STREAM_H
#define HTTP3_CLIENT_STREAM_H

#include "quiche/quic/core/http/quic_spdy_client_stream.h"

namespace quic {

class Http3ClientStream : public QuicSpdyClientStream {
 public:
  Http3ClientStream(QuicStreamId id, QuicSpdyClientSession* session,
                         StreamType type, bool drop_response_body)
      : QuicSpdyClientStream(id, session, type),
        drop_response_body_(drop_response_body) {}
  void OnBodyAvailable() override;

  void set_on_interim_headers(
      std::function<void(const quiche::HttpHeaderBlock&)> on_interim_headers) {
    on_interim_headers_ = std::move(on_interim_headers);
  }

 protected:
  bool ParseAndValidateStatusCode() override;


 private:
  std::function<void(const quiche::HttpHeaderBlock&)> on_interim_headers_;
  const bool drop_response_body_;
};

}  // namespace quic

#endif  // QUICHE_QUIC_TOOLS_QUIC_SIMPLE_CLIENT_STREAM_H_
