// modifications
// Copyright (c) 2022 Marten Richter or other contributers (see commit). All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

// original copyright, see LICENSE.chromium
// Copyright (c) 2012 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "src/http3backendresponse.h"

namespace quic
{

  Http3BackendResponse::ServerPushInfo::ServerPushInfo(
      std::string request_url,
      quiche::HttpHeaderBlock headers,
      spdy::SpdyPriority priority,
      std::string body)
      : request_url(request_url),
        headers(std::move(headers)),
        priority(priority),
        body(body) {}

  Http3BackendResponse::ServerPushInfo::ServerPushInfo(const ServerPushInfo &other)
      : request_url(other.request_url),
        headers(other.headers.Clone()),
        priority(other.priority),
        body(other.body) {}

  Http3BackendResponse::Http3BackendResponse() : response_type_(REGULAR_RESPONSE) {}

  Http3BackendResponse::~Http3BackendResponse() = default;

} // namespace quic
