// modifications
// Copyright (c) 2022 Marten Richter or other contributers (see commit). All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

// original copyright, see LICENSE.chromium
// Copyright (c) 2012 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef QUICHE_QUIC_TOOLS_QUIC_SIMPLE_SERVER_STREAM_H_
#define QUICHE_QUIC_TOOLS_QUIC_SIMPLE_SERVER_STREAM_H_

#include "absl/strings/string_view.h"
#include "quiche/quic/core/http/quic_spdy_server_stream_base.h"
#include "quiche/quic/core/quic_packets.h"
#include "src/http3serverbackend.h"
#include "src/http3backendresponse.h"
#include "quiche/spdy/core/spdy_framer.h"

namespace quic
{

  // All this does right now is aggregate data, and on fin, send an HTTP
  // response.
  class Http3ServerStream : public QuicSpdyServerStreamBase /*,
                                 public Http3ServerBackend::RequestHandler*/
  {
  public:
    Http3ServerStream(QuicStreamId id,
                      QuicSpdySession *session,
                      StreamType type,
                      Http3ServerBackend *http3_server_backend);
    Http3ServerStream(PendingStream *pending,
                      QuicSpdySession *session,
                      Http3ServerBackend *http3_server_backend);
    Http3ServerStream(const Http3ServerStream &) = delete;
    Http3ServerStream &operator=(const Http3ServerStream &) = delete;
    ~Http3ServerStream() override;

    // QuicSpdyStream
    void OnInitialHeadersComplete(bool fin,
                                  size_t frame_len,
                                  const QuicHeaderList &header_list) override;
    void OnTrailingHeadersComplete(bool fin,
                                   size_t frame_len,
                                   const QuicHeaderList &header_list) override;
    void OnCanWrite() override;

    // QuicStream implementation called by the sequencer when there is
    // data (or a FIN) to be read.
    void OnBodyAvailable() override;

    void OnInvalidHeaders() override;

    // Make this stream start from as if it just finished parsing an incoming
    // request whose headers are equivalent to |push_request_headers|.
    // Doing so will trigger this toy stream to fetch response and send it back.
    virtual void PushResponse(spdy::Http2HeaderBlock push_request_headers);

    // The response body of error responses.
    static const char *const kErrorResponseBody;
    static const char *const kNotFoundResponseBody;

    // Implements QuicSimpleServerBackend::RequestHandler callbacks
    /* QuicConnectionId connection_id() const override;
    QuicStreamId stream_id() const override;
    std::string peer_host() const override;*/
    void OnResponseBackendComplete(const Http3BackendResponse *response);

  protected:
    // Sends a basic 200 response using SendHeaders for the headers and WriteData
    // for the body.
    virtual void SendResponse();

    // Sends a basic 500 response using SendHeaders for the headers and WriteData
    // for the body.
    virtual void SendErrorResponse();
    virtual void SendErrorResponse(int resp_code);

    // Sends a basic 404 response using SendHeaders for the headers and WriteData
    // for the body.
    void SendNotFoundResponse();

    // Sends the response header and body, but not the fin.
    void SendIncompleteResponse(spdy::Http2HeaderBlock response_headers,
                                absl::string_view body);

    void SendHeadersAndBody(spdy::Http2HeaderBlock response_headers,
                            absl::string_view body);
    void SendHeadersAndBodyAndTrailers(spdy::Http2HeaderBlock response_headers,
                                       absl::string_view body,
                                       spdy::Http2HeaderBlock response_trailers);

    spdy::Http2HeaderBlock *request_headers() { return &request_headers_; }

    const std::string &body() { return body_; }

    // Writes the body bytes for the GENERATE_BYTES response type.
    void WriteGeneratedBytes();

    // The parsed headers received from the client.
    spdy::Http2HeaderBlock request_headers_;
    int64_t content_length_;
    std::string body_;

  private:
    uint64_t generate_bytes_length_;
    // Whether response headers have already been sent.
    bool response_sent_ = false;

    Http3ServerBackend *http3_server_backend_; // Not owned.
  };

} // namespace quic

#endif
