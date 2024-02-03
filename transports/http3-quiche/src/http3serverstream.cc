// modifications
// Copyright (c) 2022 Marten Richter or other contributers (see commit). All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

// original copyright, see LICENSE.chromium
// Copyright (c) 2012 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "src/http3serverstream.h"

#include <list>
#include <utility>

#include "absl/strings/match.h"
#include "absl/strings/numbers.h"
#include "absl/strings/str_cat.h"
#include "absl/strings/string_view.h"
#include "quiche/quic/core/http/quic_spdy_stream.h"
#include "quiche/quic/core/http/spdy_utils.h"
#include "quiche/quic/core/http/web_transport_http3.h"
#include "quiche/quic/core/quic_utils.h"
#include "quiche/quic/platform/api/quic_bug_tracker.h"
#include "quiche/quic/platform/api/quic_flags.h"
#include "quiche/quic/platform/api/quic_logging.h"
#include "src/http3serversession.h"
#include "quiche/spdy/core/spdy_protocol.h"

using spdy::Http2HeaderBlock;

namespace quic
{

  Http3ServerStream::Http3ServerStream(
      QuicStreamId id,
      QuicSpdySession *session,
      StreamType type,
      Http3ServerBackend *http3_server_backend)
      : QuicSpdyServerStreamBase(id, session, type),
        content_length_(-1),
        generate_bytes_length_(0),
        http3_server_backend_(http3_server_backend)
  {
    QUICHE_DCHECK(http3_server_backend_);
  }

  Http3ServerStream::Http3ServerStream(
      PendingStream *pending, QuicSpdySession *session,
      Http3ServerBackend *http3_server_backend)
      : QuicSpdyServerStreamBase(pending, session),
        content_length_(-1),
        generate_bytes_length_(0),
        http3_server_backend_(http3_server_backend)
  {
    QUICHE_DCHECK(http3_server_backend_);
  }

  Http3ServerStream::~Http3ServerStream()
  {
    // http3_server_backend_->CloseBackendResponseStream(this);
    for (auto prom : pending_proms_)
    {
      std::unique_ptr<Http3ServerBackend::WebTransportResponse> response =
          std::make_unique<Http3ServerBackend::WebTransportResponse>();
      response->response_headers[":status"] = "500"; // internal server error, probably implementation on js side
      prom->resolve(std::move(response));
    }
  }

  void Http3ServerStream::OnInitialHeadersComplete(
      bool fin,
      size_t frame_len,
      const QuicHeaderList &header_list)
  {
    QuicSpdyStream::OnInitialHeadersComplete(fin, frame_len, header_list);
    // QuicSpdyStream::OnInitialHeadersComplete() may have already sent error
    // response.
    if (!response_sent_ &&
        !SpdyUtils::CopyAndValidateHeaders(header_list, &content_length_,
                                           &request_headers_))
    {
      QUIC_DVLOG(1) << "Invalid headers";
      SendErrorResponse();
    }
    ConsumeHeaderList();
    if (!fin && !response_sent_)
    {
      // CONNECT and other CONNECT-like methods (such as CONNECT-UDP) require
      // sending the response right after parsing the headers even though the FIN
      // bit has not been received on the request stream.
      auto it = request_headers_.find(":method");
      if (it != request_headers_.end() &&
          absl::StartsWith(it->second, "CONNECT"))
      {
        SendResponse();
      }
    }
  }

  void Http3ServerStream::OnTrailingHeadersComplete(
      bool /*fin*/,
      size_t /*frame_len*/,
      const QuicHeaderList & /*header_list*/)
  {
    QUIC_BUG(quic_bug_10962_1) << "Server does not support receiving Trailers.";
    SendErrorResponse();
  }

  void Http3ServerStream::OnBodyAvailable()
  {
    while (HasBytesToRead())
    {
      struct iovec iov;
      if (GetReadableRegions(&iov, 1) == 0)
      {
        // No more data to read.
        break;
      }
      QUIC_DVLOG(1) << "Stream " << id() << " processed " << iov.iov_len
                    << " bytes.";
      body_.append(static_cast<char *>(iov.iov_base), iov.iov_len);

      if (content_length_ >= 0 &&
          body_.size() > static_cast<uint64_t>(content_length_))
      {
        QUIC_DVLOG(1) << "Body size (" << body_.size() << ") > content length ("
                      << content_length_ << ").";
        SendErrorResponse();
        return;
      }
      MarkConsumed(iov.iov_len);
    }
    if (!sequencer()->IsClosed())
    {
      sequencer()->SetUnblocked();
      return;
    }

    // If the sequencer is closed, then all the body, including the fin, has been
    // consumed.
    OnFinRead();

    if (write_side_closed() || fin_buffered())
    {
      return;
    }

    SendResponse();
  }

  void Http3ServerStream::SendResponse()
  {
    if (request_headers_.empty())
    {
      QUIC_DVLOG(1) << "Request headers empty.";
      SendErrorResponse();
      return;
    }

    if (content_length_ > 0 &&
        static_cast<uint64_t>(content_length_) != body_.size())
    {
      QUIC_DVLOG(1) << "Content length (" << content_length_ << ") != body size ("
                    << body_.size() << ").";
      SendErrorResponse();
      return;
    }

    if (!request_headers_.contains(":authority"))
    {
      QUIC_DVLOG(1) << "Request headers do not contain :authority.";
      SendErrorResponse();
      return;
    }

    if (!request_headers_.contains(":path"))
    {
      // CONNECT and other CONNECT-like methods (such as CONNECT-UDP) do not all
      // require :path to be present.
      auto it = request_headers_.find(":method");
      if (it == request_headers_.end() ||
          !absl::StartsWith(it->second, "CONNECT"))
      {
        QUIC_DVLOG(1) << "Request headers do not contain :path.";
        SendErrorResponse();
        return;
      }
    }

    if (http3_server_backend_ == nullptr)
    {
      QUIC_DVLOG(1) << "Backend is missing.";
      SendErrorResponse();
      return;
    }

    if (web_transport() != nullptr)
    {
      // to do synchronize lifetime of object, so maybe store promises
      Http3ServerBackend::WebTransportRespPromisePtr response =
          http3_server_backend_->ProcessWebTransportRequest(
              request_headers_, web_transport());
      pending_proms_.insert(response);
      response->finally([this, response](Http3ServerBackend::WebTransportResponse *resp)
                        { 
      pending_proms_.erase(response);
      if (resp->response_headers[":status"] == "200")
      {
        WriteHeaders(std::move(resp->response_headers), false, nullptr);
        if (resp->visitor != nullptr)
        {     
          static_cast<Http3ServerSession *>(session())->AddVisitor(id(), resp->visitor.get());
          web_transport()->SetVisitor(std::move(resp->visitor)); 
        }
        web_transport()->HeadersReceived(request_headers_);
      }
      else
      {
        WriteHeaders(std::move(resp->response_headers), true, nullptr);
      }
      return; });
      return;
    }

    // Fetch the response from the backend interface and wait for callback once
    // response is ready
    // skip backend
    OnResponseBackendComplete(nullptr);
    // http3_server_backend_->FetchResponseFromBackend(request_headers_, body_,
    //                                                       this);
  }

  void Http3ServerStream::OnResponseBackendComplete(
      const Http3BackendResponse *response)
  {
    if (response == nullptr)
    {
      QUIC_DVLOG(1) << "Response not found in cache.";
      SendNotFoundResponse();
      return;
    }

    // Send Early Hints first.
    for (const auto &headers : response->early_hints())
    {
      QUIC_DVLOG(1) << "Stream " << id() << " sending an Early Hints response: "
                    << headers.DebugString();
      WriteHeaders(headers.Clone(), false, nullptr);
    }

    if (response->response_type() == Http3BackendResponse::CLOSE_CONNECTION)
    {
      QUIC_DVLOG(1) << "Special response: closing connection.";
      OnUnrecoverableError(QUIC_NO_ERROR, "Toy server forcing close");
      return;
    }

    if (response->response_type() == Http3BackendResponse::IGNORE_REQUEST)
    {
      QUIC_DVLOG(1) << "Special response: ignoring request.";
      return;
    }

    if (response->response_type() == Http3BackendResponse::BACKEND_ERR_RESPONSE)
    {
      QUIC_DVLOG(1) << "Quic Proxy: Backend connection error.";
      /*502 Bad Gateway
        The server was acting as a gateway or proxy and received an
        invalid response from the upstream server.*/
      SendErrorResponse(502);
      return;
    }

    // Examing response status, if it was not pure integer as typical h2
    // response status, send error response. Notice that
    // QuicHttpResponseCache push urls are strictly authority + path only,
    // scheme is not included (see |QuicHttpResponseCache::GetKey()|).
    std::string request_url = request_headers_[":authority"].as_string() +
                              request_headers_[":path"].as_string();
    int response_code;
    const Http2HeaderBlock &response_headers = response->headers();
    if (!ParseHeaderStatusCode(response_headers, &response_code))
    {
      auto status = response_headers.find(":status");
      if (status == response_headers.end())
      {
        QUIC_LOG(WARNING)
            << ":status not present in response from cache for request "
            << request_url;
      }
      else
      {
        QUIC_LOG(WARNING) << "Illegal (non-integer) response :status from cache: "
                          << status->second << " for request " << request_url;
      }
      SendErrorResponse();
      return;
    }

    if (response->response_type() == Http3BackendResponse::INCOMPLETE_RESPONSE)
    {
      QUIC_DVLOG(1)
          << "Stream " << id()
          << " sending an incomplete response, i.e. no trailer, no fin.";
      SendIncompleteResponse(response->headers().Clone(), response->body());
      return;
    }

    if (response->response_type() == Http3BackendResponse::GENERATE_BYTES)
    {
      QUIC_DVLOG(1) << "Stream " << id() << " sending a generate bytes response.";
      std::string path = request_headers_[":path"].as_string().substr(1);
      if (!absl::SimpleAtoi(path, &generate_bytes_length_))
      {
        QUIC_LOG(ERROR) << "Path is not a number.";
        SendNotFoundResponse();
        return;
      }
      Http2HeaderBlock headers = response->headers().Clone();
      headers["content-length"] = absl::StrCat(generate_bytes_length_);

      WriteHeaders(std::move(headers), false, nullptr);
      QUICHE_DCHECK(!response_sent_);
      response_sent_ = true;

      WriteGeneratedBytes();

      return;
    }

    QUIC_DVLOG(1) << "Stream " << id() << " sending response.";
    SendHeadersAndBodyAndTrailers(response->headers().Clone(), response->body(),
                                  response->trailers().Clone());
  }

  void Http3ServerStream::OnCanWrite()
  {
    QuicSpdyStream::OnCanWrite();
    WriteGeneratedBytes();
  }

  void Http3ServerStream::WriteGeneratedBytes()
  {
    static size_t kChunkSize = 1024;
    while (!HasBufferedData() && generate_bytes_length_ > 0)
    {
      size_t len = std::min<size_t>(kChunkSize, generate_bytes_length_);
      std::string data(len, 'a');
      generate_bytes_length_ -= len;
      bool fin = generate_bytes_length_ == 0;
      WriteOrBufferBody(data, fin);
    }
  }

  void Http3ServerStream::SendNotFoundResponse()
  {
    QUIC_DVLOG(1) << "Stream " << id() << " sending not found response.";
    Http2HeaderBlock headers;
    headers[":status"] = "404";
    headers["content-length"] = absl::StrCat(strlen(kNotFoundResponseBody));
    SendHeadersAndBody(std::move(headers), kNotFoundResponseBody);
  }

  void Http3ServerStream::SendErrorResponse()
  {
    SendErrorResponse(0);
  }

  void Http3ServerStream::SendErrorResponse(int resp_code)
  {
    QUIC_DVLOG(1) << "Stream " << id() << " sending error response.";
    if (!reading_stopped())
    {
      StopReading();
    }
    Http2HeaderBlock headers;
    if (resp_code <= 0)
    {
      headers[":status"] = "500";
    }
    else
    {
      headers[":status"] = absl::StrCat(resp_code);
    }
    headers["content-length"] = absl::StrCat(strlen(kErrorResponseBody));
    SendHeadersAndBody(std::move(headers), kErrorResponseBody);
  }

  void Http3ServerStream::SendIncompleteResponse(
      Http2HeaderBlock response_headers,
      absl::string_view body)
  {
    QUIC_DLOG(INFO) << "Stream " << id() << " writing headers (fin = false) : "
                    << response_headers.DebugString();
    WriteHeaders(std::move(response_headers), /*fin=*/false, nullptr);
    QUICHE_DCHECK(!response_sent_);
    response_sent_ = true;

    QUIC_DLOG(INFO) << "Stream " << id()
                    << " writing body (fin = false) with size: " << body.size();
    if (!body.empty())
    {
      WriteOrBufferBody(body, /*fin=*/false);
    }
  }

  void Http3ServerStream::SendHeadersAndBody(
      Http2HeaderBlock response_headers,
      absl::string_view body)
  {
    SendHeadersAndBodyAndTrailers(std::move(response_headers), body,
                                  Http2HeaderBlock());
  }

  void Http3ServerStream::SendHeadersAndBodyAndTrailers(
      Http2HeaderBlock response_headers,
      absl::string_view body,
      Http2HeaderBlock response_trailers)
  {
    // Send the headers, with a FIN if there's nothing else to send.
    bool send_fin = (body.empty() && response_trailers.empty());
    QUIC_DLOG(INFO) << "Stream " << id() << " writing headers (fin = " << send_fin
                    << ") : " << response_headers.DebugString();
    WriteHeaders(std::move(response_headers), send_fin, nullptr);
    QUICHE_DCHECK(!response_sent_);
    response_sent_ = true;
    if (send_fin)
    {
      // Nothing else to send.
      return;
    }

    // Send the body, with a FIN if there's no trailers to send.
    send_fin = response_trailers.empty();
    QUIC_DLOG(INFO) << "Stream " << id() << " writing body (fin = " << send_fin
                    << ") with size: " << body.size();
    if (!body.empty() || send_fin)
    {
      WriteOrBufferBody(body, send_fin);
    }
    if (send_fin)
    {
      // Nothing else to send.
      return;
    }

    // Send the trailers. A FIN is always sent with trailers.
    QUIC_DLOG(INFO) << "Stream " << id() << " writing trailers (fin = true): "
                    << response_trailers.DebugString();
    WriteTrailers(std::move(response_trailers), nullptr);
  }

  void Http3ServerStream::OnInvalidHeaders()
  {
    QUIC_DVLOG(1) << "Invalid headers";
    SendErrorResponse(400);
  }

  const char *const Http3ServerStream::kErrorResponseBody = "bad";
  const char *const Http3ServerStream::kNotFoundResponseBody =
      "file not found";

} // namespace quic
