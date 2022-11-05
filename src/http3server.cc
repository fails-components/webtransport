// Copyright (c) 2022 Marten Richter or other contributers (see commit). All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

// portions taken from libquiche, original copyright, see LICENSE.chromium
// Copyright (c)  The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "absl/cleanup/cleanup.h"
#include "src/http3server.h"
#include "src/http3dispatcher.h"
#include "src/http3wtsessionvisitor.h"
#include "src/http3eventloop.h"
#include "quiche/quic/core/quic_default_packet_writer.h"
#include "quiche/quic/core/quic_default_connection_helper.h"
#include "quiche/quic/core/quic_default_clock.h"
#include "quiche/quic/tools/quic_simple_crypto_server_stream_helper.h"
#include "quiche/quic/core/crypto/proof_source_x509.h"
#include "quiche/common/platform/api/quiche_reference_counted.h"

using namespace Napi;

namespace quic
{

  const size_t kNumSessionsToCreatePerSocketEvent = 16;

  Http3Server::Http3Server(Http3EventLoop *eventloop, std::string host, int port, std::unique_ptr<ProofSource> proof_source,
                           const char *secret, QuicConfig config)
      : port_(port), host_(host), fd_(-1), overflow_supported_(false),
        config_(config),
        eventloop_(eventloop),
        http3_server_backend_(eventloop),
        packet_reader_(new QuicPacketReader()),
        packets_dropped_(0),
        version_manager_({ParsedQuicVersion::RFCv1()}),
        crypto_config_(secret,
                       QuicRandom::GetInstance(),
                       std::move(proof_source),
                       KeyExchangeSource::Default()),
        expected_server_connection_id_length_(kQuicDefaultConnectionIdLength),
        js_(nullptr),
        connection_id_generator_(expected_server_connection_id_length_)
  {
  }

  Http3Server::~Http3Server()
  {
    // printf("server destruct %x\n", this);
  }

  bool Http3Server::CreateUDPSocketAndListen(const QuicSocketAddress &address)
  {
    QuicUdpSocketApi socket_api;
    fd_ = socket_api.Create(address.host().AddressFamilyToInt(),
                            /*receive_buffer_size =*/kDefaultSocketReceiveBuffer,
                            /*send_buffer_size =*/kDefaultSocketReceiveBuffer);
    if (fd_ == kQuicInvalidSocketFd)
    {
      QUIC_LOG(ERROR) << "CreateSocket() failed: " << strerror(errno);
      return false;
    }
    auto closer = absl::MakeCleanup([this]
                                    { { QuicUdpSocketApi api;api.Destroy(fd_); } });

    overflow_supported_ = socket_api.EnableDroppedPacketCount(fd_);
    socket_api.EnableReceiveTimestamp(fd_);

    if (!socket_api.Bind(fd_, address))
    {
      QUIC_LOG(ERROR) << "Bind failed: " << strerror(errno) << "\n";
      return false;
    }
    QUIC_LOG(INFO) << "Listening on " << address.ToString() << "\n";
    port_ = address.port();
    if (port_ == 0)
    {
      QuicSocketAddress address;
      if (address.FromSocket(fd_) != 0)
      {
        QUIC_LOG(ERROR) << "Unable to get self address.  Error: "
                        << strerror(errno) << "\n";
      }
      port_ = address.port();
    }

    const int kEpollFlags = kSocketEventReadable | kSocketEventWritable;

    if (eventloop_->getQuicEventLoop()->RegisterSocket(fd_, kEpollFlags, this))
    {
      // eventloop_->SetNonblocking(fd_); // eventuelly should be part of register socket.
      dispatcher_.reset(CreateQuicDispatcher());
      dispatcher_->InitializeWithWriter(new QuicDefaultPacketWriter(fd_));
      std::move(closer).Cancel();

      eventloop_->informServerStatus(this, NetListening);
      return true;
    }

    eventloop_->informServerStatus(this, NetError);
    return false;
  }

  bool Http3Server::stopServerInt()
  {

    eventloop_->getQuicEventLoop()->UnregisterSocket(fd_);

    // if (!silent_close_) {
    //  Before we shut down the epoll server, give all active sessions a chance
    //  to notify clients that they're closing.
    dispatcher_->Shutdown();
    //}

    QuicUdpSocketApi api;
    api.Destroy(fd_);
    fd_ = -1;
    eventloop_->informServerStatus(this, NetClose);
    eventloop_->informUnref(this->getJS()); // must be done on the other thread...
    return true;
  }

  QuicDispatcher *Http3Server::CreateQuicDispatcher()
  {
    http3_server_backend_.setServer(this);
    return new Http3Dispatcher(
        &config_, &crypto_config_, &version_manager_,
        std::unique_ptr<QuicDefaultConnectionHelper>(new QuicDefaultConnectionHelper()),
        std::unique_ptr<QuicCryptoServerStreamBase::Helper>(
            new QuicSimpleCryptoServerStreamHelper()),
        std::unique_ptr<QuicAlarmFactory>(
            eventloop_->getQuicEventLoop()->CreateAlarmFactory()),
        &http3_server_backend_, expected_server_connection_id_length_, connection_id_generator_);
  }

  Http3ServerJS::Http3ServerJS(const Napi::CallbackInfo &info) : Napi::ObjectWrap<Http3ServerJS>(info)
  {
    int port = 443;
    std::string secret;
    std::string cert;
    std::string privkey;
    std::string host("localhost");

    QuicConfig sconfig;
    if (!info[0].IsUndefined())
    {
      Napi::Object lobj = info[0].ToObject();
      if (!lobj.IsEmpty())
      {
        if (lobj.Has("port") && !(lobj).Get("port").IsEmpty())
        {
          Napi::Value portValue = (lobj).Get("port");
          port = portValue.As<Napi::Number>().Int32Value();
        }
        if (lobj.Has("secret") && !(lobj).Get("secret").IsEmpty())
        {
          Napi::Value secretValue = (lobj).Get("secret");
          secret = secretValue.ToString().Utf8Value();
        }
        else
        {
          Napi::Error::New(Env(), "No secret set for Http3Server").ThrowAsJavaScriptException();
          return;
        }
        if (lobj.Has("host") && !(lobj).Get("host").IsEmpty())
        {
          Napi::Value hostValue = (lobj).Get("host");
          host = hostValue.ToString().Utf8Value();
        }
        if (lobj.Has("cert") && !(lobj).Get("cert").IsEmpty())
        {
          Napi::Value certValue = (lobj).Get("cert");
          cert = certValue.ToString().Utf8Value();
        }
        else
        {
          Napi::Error::New(Env(), "No cert set for Http3Server").ThrowAsJavaScriptException();
          return;
        }
        if (lobj.Has("privKey") && !(lobj).Get("privKey").IsEmpty())
        {
          Napi::Value keyValue = (lobj).Get("privKey");
          privkey = keyValue.ToString().Utf8Value();
        }
        else
        {
          Napi::Error::New(Env(), "No privKey set for Http3Server").ThrowAsJavaScriptException();
          return;
        }
        if (lobj.Has("maxConnections") && !(lobj).Get("maxConnections").IsEmpty())
        {
          Napi::Value maxconnValue = (lobj).Get("maxConnections");
          int maxconn = maxconnValue.As<Napi::Number>().Int32Value();
          sconfig.SetMaxBidirectionalStreamsToSend(maxconn);
          sconfig.SetMaxUnidirectionalStreamsToSend(maxconn);
        }

        if (lobj.Has("initialStreamFlowControlWindow") && !(lobj).Get("initialStreamFlowControlWindow").IsEmpty())
        {
          Napi::Value initialStreamFlowControlWindowValue = (lobj).Get("initialStreamFlowControlWindow");
          int initialStreamFlowControlWindow = initialStreamFlowControlWindowValue.As<Napi::Number>().Int32Value();
          sconfig.SetInitialStreamFlowControlWindowToSend(initialStreamFlowControlWindow);
        }

        if (lobj.Has("initialSessionFlowControlWindow") && !(lobj).Get("initialSessionFlowControlWindow").IsEmpty())
        {
          Napi::Value initialSessionFlowControlWindowValue = (lobj).Get("initialSessionFlowControlWindow");
          int initialSessionFlowControlWindow = initialSessionFlowControlWindowValue.As<Napi::Number>().Int32Value();
          sconfig.SetInitialSessionFlowControlWindowToSend(initialSessionFlowControlWindow);
        }
      }
      // Callback *callback, int port, std::unique_ptr<ProofSource> proof_source,  const char *secret

      std::stringstream certstream(cert, std::ios_base::in);
      quiche::QuicheReferenceCountedPointer<ProofSource::Chain> chain(new ProofSource::Chain(CertificateView::LoadPemFromStream(&certstream)));

      std::stringstream privkeystream(privkey, std::ios_base::in);

      auto certprivkey = CertificatePrivateKey::LoadPemFromStream(&privkeystream);
      if (certprivkey == nullptr)
      {
        Napi::Error::New(Env(), "LoadPemFromStream privKey  failed for Http3Server").ThrowAsJavaScriptException();
        return;
      }

      std::unique_ptr<ProofSourceX509> proofsource = ProofSourceX509::Create(chain, std::move(*certprivkey));
      if (proofsource == nullptr)
      {
        Napi::Error::New(Env(), "LoadPemFromStream cert failed for Http3Server").ThrowAsJavaScriptException();
        return;
      }
      Http3EventLoop *eventloop = nullptr;
      if (!info[1].IsUndefined())
      {
        Napi::Object lobj = info[1].ToObject();
        eventloop = dynamic_cast<Http3EventLoop *>(Napi::ObjectWrap<Http3EventLoop>::Unwrap(lobj));
      }
      else
      {
        Napi::Error::New(Env(), "No eventloop arguments passed to Http3Server").ThrowAsJavaScriptException();
        return;
      }

      server_ = std::make_unique<Http3Server>(eventloop, host, port, std::move(proofsource), secret.c_str(), sconfig);

      server_->setJS(this);
      return;
    }
    else
    {
      Napi::Error::New(Env(), "No arguments passed to Http3Server").ThrowAsJavaScriptException();
      return;
    }
  }

  bool Http3Server::startServerInt()
  {

    QuicIpAddress ipaddress;

    ipaddress.FromString(host_);
    if (!ipaddress.IsIPv4() && !ipaddress.IsIPv6())
    {
      struct addrinfo hints, *servinfo, *p;
      int rv;

      memset(&hints, 0, sizeof hints);
      hints.ai_family = AF_UNSPEC; // use AF_INET6 to force IPv6
      hints.ai_socktype = SOCK_STREAM;

      if ((rv = getaddrinfo(host_.c_str(), "http", &hints, &servinfo)) != 0)
      {
        printf("getaddrinfo: %s\n", gai_strerror(rv));
        return false;
      }

      for (p = servinfo; p != nullptr; p = p->ai_next)
      {
        if (p->ai_family == AF_INET)
        {
          struct sockaddr_in *h = (struct sockaddr_in *)p->ai_addr;

          ipaddress = QuicIpAddress(h->sin_addr);
          // printf("ssi mark address %s %d\n",inet_ntoa( h->sin_addr),h->sin_family);
          break;
        }
        else if (p->ai_family == AF_INET6)
        {
          struct sockaddr_in6 *h = (struct sockaddr_in6 *)p->ai_addr;
          ipaddress = QuicIpAddress(h->sin6_addr);
          // printf("ssi mark address %d\n",h->sin6_family);
        }
      }

      freeaddrinfo(servinfo);
    }

    const uint32_t kInitialSessionFlowControlWindow = 1 * 1024 * 1024; // 1 MB
    const uint32_t kInitialStreamFlowControlWindow = 64 * 1024;        // 64 KB
    if (config_.GetInitialStreamFlowControlWindowToSend() ==
        kDefaultFlowControlSendWindow)
    {
      config_.SetInitialStreamFlowControlWindowToSend(
          kInitialStreamFlowControlWindow);
    }
    if (config_.GetInitialSessionFlowControlWindowToSend() ==
        kDefaultFlowControlSendWindow)
    {
      config_.SetInitialSessionFlowControlWindowToSend(
          kInitialSessionFlowControlWindow);
    }

    QuicSocketAddress address(ipaddress, port_);
    if (!CreateUDPSocketAndListen(address))
      return false; // move to this class
    return true;
  }

  void Http3Server::OnSocketEvent(QuicEventLoop *event_loop, QuicUdpSocketFd fd,
                                  QuicSocketEventMask events)
  {
    QUICHE_DCHECK_EQ(fd, fd_);

    if (events & kSocketEventReadable)
    {
      QUIC_DVLOG(1) << "kSocketEventReadable";

      dispatcher_->ProcessBufferedChlos(kNumSessionsToCreatePerSocketEvent);

      bool more_to_read = true;
      while (more_to_read)
      {
        more_to_read = packet_reader_->ReadAndDispatchPackets(
            fd_, port_, *QuicDefaultClock::Get(), dispatcher_.get(),
            overflow_supported_ ? &packets_dropped_ : nullptr);
      }

      if (dispatcher_->HasChlosBuffered())
      {
        // Register EPOLLIN event to consume buffered CHLO(s).
        bool success =
            event_loop->ArtificiallyNotifyEvent(fd, kSocketEventReadable);
        QUICHE_DCHECK(success);
      }
      if (!event_loop->SupportsEdgeTriggered())
      {
        bool success = event_loop->RearmSocket(fd, kSocketEventReadable);
        QUICHE_DCHECK(success);
      }
    }
    if (events & kSocketEventWritable)
    {
      dispatcher_->OnCanWrite();
      if (!event_loop->SupportsEdgeTriggered() &&
          dispatcher_->HasPendingWrites())
      {
        bool success = event_loop->RearmSocket(fd, kSocketEventWritable);
        QUICHE_DCHECK(success);
      }
    }
  }

  void Http3ServerJS::startServer(const Napi::CallbackInfo &info)
  {
    Http3Server *obj = getObj();
    // got the object we can now start the server
    Ref(); // do not garbage collect
    std::function<void()> task = [obj]()
    { if (!obj->startServerInt())
    {
      printf("startServerInt failed for Http3Server\n");
    } };
    obj->eventloop_->Schedule(task);
  }

  void Http3ServerJS::stopServer(const Napi::CallbackInfo &info)
  {
    Http3Server *obj = getObj();
    // got the object we can now start the server
    std::function<void()> task = [obj]()
    { if (!obj->stopServerInt())
    {
      printf("stopServerInt failed for Http3Server\n");
    } };
    obj->eventloop_->Schedule(task);
  }

  void Http3ServerJS::addPath(const Napi::CallbackInfo &info)
  {
    Http3Server *obj = getObj();

    if (!info[0].IsUndefined())
    {

      std::string lpath(info[0].ToString().Utf8Value());
      std::function<void()> task = [obj, lpath]()
      {
        obj->http3_server_backend_.addPath(lpath);
      };
      obj->eventloop_->Schedule(task);
    }
  }

  Napi::Value Http3ServerJS::port(const Napi::CallbackInfo &info)
  {
    Http3Server *obj = getObj();

    return Napi::Number::New(info.Env(), obj->port_);
  }

  Napi::Value Http3ServerJS::host(const Napi::CallbackInfo &info)
  {
    Http3Server *obj = getObj();

    return Napi::String::New(info.Env(), obj->host_);
  }
}
