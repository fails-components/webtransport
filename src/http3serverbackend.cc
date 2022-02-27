// modifications
// Copyright (c) 2022 Marten Richter or other contributers (see commit). All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

// original copyright, see LICENSE.chromium
// Copyright (c) 2012 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "src/http3serverbackend.h"
#include "src/http3wtsessionvisitor.h"
#include "src/http3server.h"

#include <utility>

#include "absl/strings/match.h"
#include "absl/strings/numbers.h"
#include "absl/strings/str_cat.h"
#include "absl/strings/string_view.h"
#include "quic/core/http/spdy_utils.h"
#include "quic/platform/api/quic_bug_tracker.h"
#include "quic/platform/api/quic_logging.h"
//#include "quic/tools/web_transport_test_visitors.h"
#include "common/platform/api/quiche_file_utils.h"
#include "common/quiche_text_utils.h"

#include "src/http3server.h"

using spdy::Http2HeaderBlock;

namespace quic
{

  /*
  void QuicMemoryCacheBackend::GenerateDynamicResponses() {
    QuicWriterMutexLock lock(&response_mutex_);
    // Add a generate bytes response.
    spdy::Http2HeaderBlock response_headers;
    response_headers[":status"] = "200";
    generate_bytes_response_ = std::make_unique<QuicBackendResponse>();
    generate_bytes_response_->set_headers(std::move(response_headers));
    generate_bytes_response_->set_response_type(
        QuicBackendResponse::GENERATE_BYTES);
  }
  */

  Http3ServerBackend::WebTransportResponse
  Http3ServerBackend::ProcessWebTransportRequest(
      const spdy::Http2HeaderBlock &request_headers,
      WebTransportSession *session)
  {
    if (!SupportsWebTransport())
    {
      WebTransportResponse response;
      response.response_headers[":status"] = "400";
      return response;
    }

    auto path_it = request_headers.find(":path");
    if (path_it == request_headers.end())
    {
      WebTransportResponse response;
      response.response_headers[":status"] = "400";
      return response;
    }
    std::string path(path_it->second);

    if (paths_.find(path) != paths_.end())
    { // to do handle our web transport paths
      WebTransportResponse response;
      response.response_headers[":status"] = "200";
      response.visitor =
          std::make_unique<Http3WTSessionVisitor>(session, server_); // replace
      server_->informAboutNewSession(static_cast<Http3WTSessionVisitor *>(response.visitor.get()), path);
      return response;
    }

    WebTransportResponse response;
    response.response_headers[":status"] = "404";
    return response;
  }

  Http3ServerBackend::~Http3ServerBackend()
  {
    {
    }
  }

} // namespace quic
