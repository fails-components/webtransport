// Copyright (c) 2022 Marten Richter or other contributers (see commit). All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

// portions taken from libquiche, original copyright, see LICENSE.chromium
// Copyright (c)  The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

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

using namespace Nan;

namespace quic
{

  const size_t kNumSessionsToCreatePerSocketEvent = 16;

  Http3Server::Http3Server(Http3EventLoop *eventloop, std::string host, int port, std::unique_ptr<ProofSource> proof_source,
                           const char *secret)
      : port_(port), host_(host), fd_(-1), overflow_supported_(false),
        eventloop_(eventloop),
        http3_server_backend_(eventloop),
        packet_reader_(new QuicPacketReader()),
        packets_dropped_(0),
        version_manager_({ParsedQuicVersion::RFCv1()}),
        crypto_config_(secret,
                       QuicRandom::GetInstance(),
                       std::move(proof_source),
                       KeyExchangeSource::Default()),
        expected_server_connection_id_length_(kQuicDefaultConnectionIdLength)
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

    overflow_supported_ = socket_api.EnableDroppedPacketCount(fd_);
    socket_api.EnableReceiveTimestamp(fd_);

    sockaddr_storage addr = address.generic_address();
    // @BENBENZ: fix on mac OSX (was needed or a EINVAL is returned) (from api::Bind in quic_udp_socket_posix.cc)
    int addr_len = address.host().IsIPv4() ? sizeof(sockaddr_in) : sizeof(sockaddr_in6);
    int rc = bind(fd_, reinterpret_cast<sockaddr *>(&addr), addr_len);
    if (rc < 0)
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

    eventloop_->getQuicEventLoop()->RegisterSocket(fd_, kEpollFlags, this);
    eventloop_->SetNonblocking(fd_); // eventuelly should be part of register socket.
    dispatcher_.reset(CreateQuicDispatcher());
    dispatcher_->InitializeWithWriter(new QuicDefaultPacketWriter(fd_));

    return true;
  }

  bool Http3Server::stopServerInt()
  {

    eventloop_->getQuicEventLoop()->UnregisterSocket(fd_);

    // if (!silent_close_) {
    //  Before we shut down the epoll server, give all active sessions a chance
    //  to notify clients that they're closing.
    dispatcher_->Shutdown();
    //}

    close(fd_);
    fd_ = -1;
    eventloop_->informUnref(this); // must be done on the other thread...
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
            eventloop_->getQuicEventLoop()->GetAlarmFactory()),
        &http3_server_backend_, expected_server_connection_id_length_);
  }

  NAN_METHOD(Http3Server::New)
  {
    if (info.IsConstructCall())
    {
      int port = 443;
      v8::Isolate *isolate = info.GetIsolate();
      std::string secret;
      std::string cert;
      std::string privkey;
      std::string host("localhost");

      v8::Local<v8::Context> context = info.GetIsolate()->GetCurrentContext();

      if (!info[0]->IsUndefined())
      {
        v8::MaybeLocal<v8::Object> obj = info[0]->ToObject(context);
        v8::Local<v8::String> portProp = Nan::New("port").ToLocalChecked();
        v8::Local<v8::String> secretProp = Nan::New("secret").ToLocalChecked();
        v8::Local<v8::String> certProp = Nan::New("cert").ToLocalChecked();
        v8::Local<v8::String> hostProp = Nan::New("host").ToLocalChecked();
        v8::Local<v8::String> keyProp = Nan::New("privKey").ToLocalChecked();
        if (!obj.IsEmpty())
        {
          v8::Local<v8::Object> lobj = obj.ToLocalChecked();
          if (Nan::HasOwnProperty(lobj, portProp).FromJust() && !Nan::Get(lobj, portProp).IsEmpty())
          {
            v8::Local<v8::Value> portValue = Nan::Get(lobj, portProp).ToLocalChecked();
            port = Nan::To<int>(portValue).FromJust();
          }
          if (Nan::HasOwnProperty(lobj, secretProp).FromJust() && !Nan::Get(lobj, secretProp).IsEmpty())
          {
            v8::Local<v8::Value> secretValue = Nan::Get(lobj, secretProp).ToLocalChecked();
            secret = *v8::String::Utf8Value(isolate, secretValue->ToString(context).ToLocalChecked());
          }
          else
          {
            return Nan::ThrowError("No secret set for Http3Server");
          }
          if (Nan::HasOwnProperty(lobj, hostProp).FromJust() && !Nan::Get(lobj, hostProp).IsEmpty())
          {
            v8::Local<v8::Value> hostValue = Nan::Get(lobj, hostProp).ToLocalChecked();
            host = *v8::String::Utf8Value(isolate, hostValue->ToString(context).ToLocalChecked());
          }
          if (Nan::HasOwnProperty(lobj, certProp).FromJust() && !Nan::Get(lobj, certProp).IsEmpty())
          {
            v8::Local<v8::Value> certValue = Nan::Get(lobj, certProp).ToLocalChecked();
            cert = *v8::String::Utf8Value(isolate, certValue->ToString(context).ToLocalChecked());
          }
          else
          {
            return Nan::ThrowError("No cert set for Http3Server");
          }
          if (Nan::HasOwnProperty(lobj, keyProp).FromJust() && !Nan::Get(lobj, keyProp).IsEmpty())
          {
            v8::Local<v8::Value> keyValue = Nan::Get(lobj, keyProp).ToLocalChecked();
            privkey = *v8::String::Utf8Value(isolate, keyValue->ToString(context).ToLocalChecked());
          }
          else
          {
            return Nan::ThrowError("No privKey set for Http3Server");
          }
        }
        // Callback *callback, int port, std::unique_ptr<ProofSource> proof_source,  const char *secret

        std::stringstream certstream(cert, std::ios_base::in);
        quiche::QuicheReferenceCountedPointer<ProofSource::Chain> chain(new ProofSource::Chain(CertificateView::LoadPemFromStream(&certstream)));

        std::stringstream privkeystream(privkey, std::ios_base::in);

        auto certprivkey = CertificatePrivateKey::LoadPemFromStream(&privkeystream);
        if (certprivkey == nullptr)
          return Nan::ThrowError("LoadPemFromStream privKey  failed for Http3Server");

        std::unique_ptr<ProofSourceX509> proofsource = ProofSourceX509::Create(chain, std::move(*certprivkey));
        if (proofsource == nullptr)
          return Nan::ThrowError("LoadPemFromStream cert failed for Http3Server");
        Http3EventLoop *eventloop = nullptr;
        if (!info[1]->IsUndefined())
        {
          v8::MaybeLocal<v8::Object> obj = info[1]->ToObject(context);
          v8::Local<v8::Object> lobj = obj.ToLocalChecked();
          eventloop = Nan::ObjectWrap::Unwrap<Http3EventLoop>(lobj);
        }
        else
        {
          return Nan::ThrowError("No eventloop arguments passed to Http3Server");
        }

        Http3Server *object = new Http3Server(eventloop, host, port, std::move(proofsource), secret.c_str());
        object->Wrap(info.This());
        info.GetReturnValue().Set(info.This());
      }
      else
      {
        return Nan::ThrowError("No arguments passed to Http3Server");
      }
    }
    else
    {
      const int argc = 2;
      v8::Local<v8::Value> argv[argc] = {info[0], info[1]};
      v8::Local<v8::Function> cons = Nan::New(constructor());
      auto instance = Nan::NewInstance(cons, argc, argv);
      if (!instance.IsEmpty())
        info.GetReturnValue().Set(instance.ToLocalChecked());
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

    QuicSocketAddress address(ipaddress, port_);
    if (!CreateUDPSocketAndListen(address))
      return false; // move to this class
    return true;
  }

  void Http3Server::OnSocketEvent(QuicEventLoop *event_loop, QuicUdpSocketFd fd,
                                  QuicSocketEventMask events)
  {
    QUICHE_DCHECK_EQ(fd, fd_);
    QuicSocketEventMask eventsout = 0;
    QuicSocketEventMask revents = 0;

    if (events & kSocketEventReadable)
    {
      QUIC_DVLOG(1) << "kSocketEventReadabl";

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
        // Register kSocketEventReadabl event to consume buffered CHLO(s).
        eventsout |= kSocketEventReadable;
      } else {
        revents |=  kSocketEventReadable;
      }
    }
    if (events & kSocketEventWritable)
    {
      dispatcher_->OnCanWrite();
      if (dispatcher_->HasPendingWrites())
      {
        eventsout |= kSocketEventWritable;
      } else {
        revents |= kSocketEventWritable;
      }
    }
    if (eventsout != 0)
    {
      event_loop->ArtificiallyNotifyEvent(fd, eventsout);
    }
    if (revents != 0)
    {
      event_loop->RearmSocket(fd, revents);
    }
  }

  NAN_METHOD(Http3Server::startServer)
  {
    Http3Server *obj = Nan::ObjectWrap::Unwrap<Http3Server>(info.Holder());
    // got the object we can now start the server
    obj->Ref(); // do not garbage collect
    std::function<void()> task = [obj]()
    { if (!obj->startServerInt())
    {
      printf("startServerInt failed for Http3Server\n");
    } };
    obj->eventloop_->Schedule(task);
  }

  NAN_METHOD(Http3Server::stopServer)
  {
    Http3Server *obj = Nan::ObjectWrap::Unwrap<Http3Server>(info.Holder());
    // got the object we can now start the server
    std::function<void()> task = [obj]()
    { if (!obj->stopServerInt())
    {
      printf("stopServerInt failed for Http3Server\n");
    } };
    obj->eventloop_->Schedule(task);
  }

  NAN_METHOD(Http3Server::addPath)
  {
    Http3Server *obj = Nan::ObjectWrap::Unwrap<Http3Server>(info.Holder());
    v8::Isolate *isolate = info.GetIsolate();
    v8::Local<v8::Context> context = info.GetIsolate()->GetCurrentContext();

    if (!info[0]->IsUndefined())
    {

      std::string lpath(*v8::String::Utf8Value(isolate, info[0]->ToString(context).ToLocalChecked()));
      std::function<void()> task = [obj, lpath]()
      {
        obj->http3_server_backend_.addPath(lpath);
      };
      obj->eventloop_->Schedule(task);
    }
  }

}
