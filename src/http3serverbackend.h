// modifications
// Copyright (c) 2022 Marten Richter or other contributers (see commit). All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

// original copyright, see LICENSE.chromium
// Copyright (c) 2012 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef QUICHE_QUIC_TOOLS_QUIC_SIMPLE_SERVER_BACKEND_H_
#define QUICHE_QUIC_TOOLS_QUIC_SIMPLE_SERVER_BACKEND_H_

#include <memory>

#include "quiche/quic/core/quic_types.h"
#include "quiche/quic/core/web_transport_interface.h"
#include "quiche/spdy/core/http2_header_block.h"

namespace quic
{

  class Http3Server;
  class Http3EventLoop;

  template <typename T>
  class JSlikePromise {
  public:
    void finally(std::function<void(T*)> func) 
    {
      T *res = result.get() ;
      if (res != nullptr) func(res);
      else finallys.push_back(func);
    }

    void resolve(std::unique_ptr<T> res)
    {
      if (result.get() != nullptr) return;//throw std::runtime_error("Promise already settled");
      result = std::move(res);
      for (auto finally : finallys) {
        finally(result.get());
      }
      finallys.clear();
    }

  protected:
    std::unique_ptr<T> result;
    std::list<std::function<void(T*)>> finallys;
  };


  // This interface implements the functionality to fetch a response
  // from the backend (such as cache, http-proxy etc) to serve
  // requests received by a Quic Server
  // no, here only webtransport stuff remained, I do not want to serve http3
  class Http3ServerBackend
  {
  public:
    struct WebTransportResponse
    {
      spdy::Http2HeaderBlock response_headers;
      std::unique_ptr<WebTransportVisitor> visitor;
    };

    using WebTransportRespPromise = JSlikePromise<WebTransportResponse>;
    using WebTransportRespPromisePtr = std::shared_ptr<WebTransportRespPromise>;

    Http3ServerBackend(Http3EventLoop *eventloop) : eventloop_(eventloop),
     server_(nullptr) {}

    ~Http3ServerBackend();

    void setServer(Http3Server *server) { server_ = server; }

    WebTransportRespPromisePtr ProcessWebTransportRequest(
        const spdy::Http2HeaderBlock & /*request_headers*/,
        WebTransportSession * /*session*/);
    bool SupportsWebTransport() { return true; }
    bool UsesDatagramContexts() { return true; }
    bool SupportsExtendedConnect() { return true; }

    void addPath(std::string path) { paths_.insert(path); }

  protected:
    Http3Server *server_; // unowned
    Http3EventLoop *eventloop_; // unowned
    std::set<std::string> paths_;
  };

} // namespace quic

#endif // QUICHE_QUIC_TOOLS_QUIC_SIMPLE_SERVER_BACKEND_H_
