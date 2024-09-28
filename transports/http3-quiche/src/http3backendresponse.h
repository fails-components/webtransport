// modifications
// Copyright (c) 2022 Marten Richter or other contributers (see commit). All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

// original copyright, see LICENSE.chromium
// Copyright 2017 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef HTTPS_BACKEND_RESPONSE_H_
#define HTTPS_BACKEND_RESPONSE_H_

#include <memory>

#include "absl/strings/string_view.h"
#include "quiche/spdy/core/spdy_protocol.h"

namespace quic
{

  // Container for HTTP response header/body pairs
  // fetched by the QuicSimpleServerBackend
  class Http3BackendResponse
  {
  public:
    // A ServerPushInfo contains path of the push request and everything needed in
    // comprising a response for the push request.
    // TODO(b/171463363): Remove.
    struct ServerPushInfo
    {
      ServerPushInfo(std::string request_url,
                     quiche::HttpHeaderBlock headers,
                     spdy::SpdyPriority priority,
                     std::string body);
      ServerPushInfo(const ServerPushInfo &other);

      std::string request_url;
      quiche::HttpHeaderBlock headers;
      spdy::SpdyPriority priority;
      std::string body;
    };

    enum SpecialResponseType
    {
      REGULAR_RESPONSE,     // Send the headers and body like a server should.
      CLOSE_CONNECTION,     // Close the connection (sending the close packet).
      IGNORE_REQUEST,       // Do nothing, expect the client to time out.
      BACKEND_ERR_RESPONSE, // There was an error fetching the response from
                            // the backend, for example as a TCP connection
                            // error.
      INCOMPLETE_RESPONSE,  // The server will act as if there is a non-empty
                            // trailer but it will not be sent, as a result, FIN
                            // will not be sent too.
      GENERATE_BYTES        // Sends a response with a length equal to the number
                            // of bytes in the URL path.
    };
    Http3BackendResponse();

    Http3BackendResponse(const Http3BackendResponse &other) = delete;
    Http3BackendResponse &operator=(const Http3BackendResponse &other) = delete;

    ~Http3BackendResponse();

    const std::vector<quiche::HttpHeaderBlock> &early_hints() const
    {
      return early_hints_;
    }
    SpecialResponseType response_type() const { return response_type_; }
    const quiche::HttpHeaderBlock &headers() const { return headers_; }
    const quiche::HttpHeaderBlock &trailers() const { return trailers_; }
    const absl::string_view body() const { return absl::string_view(body_); }

    void AddEarlyHints(const quiche::HttpHeaderBlock &headers)
    {
      quiche::HttpHeaderBlock hints = headers.Clone();
      hints[":status"] = "103";
      early_hints_.push_back(std::move(hints));
    }

    void set_response_type(SpecialResponseType response_type)
    {
      response_type_ = response_type;
    }

    void set_headers(quiche::HttpHeaderBlock headers)
    {
      headers_ = std::move(headers);
    }
    void set_trailers(quiche::HttpHeaderBlock trailers)
    {
      trailers_ = std::move(trailers);
    }
    void set_body(absl::string_view body)
    {
      body_.assign(body.data(), body.size());
    }

  private:
    std::vector<quiche::HttpHeaderBlock> early_hints_;
    SpecialResponseType response_type_;
    quiche::HttpHeaderBlock headers_;
    quiche::HttpHeaderBlock trailers_;
    std::string body_;
  };

} // namespace quic

#endif // QUICHE_QUIC_TOOLS_QUIC_BACKEND_RESPONSE_H_
