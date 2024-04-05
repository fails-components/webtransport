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

  Http3Server::Http3Server(Http3ServerJS *js, std::unique_ptr<ProofSource> proof_source,
                           const char *secret, QuicConfig config)
      : config_(config),
        http3_server_backend_(),
        packet_reader_(new QuicPacketReader()),
        packets_dropped_(0),
        version_manager_({ParsedQuicVersion::RFCv1()}),
        crypto_config_(secret,
                       QuicRandom::GetInstance(),
                       std::move(proof_source),
                       KeyExchangeSource::Default()),
        expected_server_connection_id_length_(kQuicDefaultConnectionIdLength),
        js_(js),
        connection_id_generator_(expected_server_connection_id_length_)
  {
    // may be put somewhereelse
    dispatcher_.reset(CreateQuicDispatcher());
    dispatcher_->InitializeWithWriter(new SocketJSWriter(getJS()));
    // may be put somewhereelse
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
  }

  Http3Server::~Http3Server()
  {
    // printf("server destruct %x\n", this);
  }

  // TODO make call from JS
  void Http3Server::Destroy()
  {

    // if (!silent_close_) {
    //  Before we shut down the epoll server, give all active sessions a chance
    //  to notify clients that they're closing.
    dispatcher_->Shutdown();
    //}
  }

  QuicDispatcher *Http3Server::CreateQuicDispatcher()
  {
    http3_server_backend_.setServer(this);
    return new Http3Dispatcher(
        &config_, &crypto_config_, &version_manager_,
        std::unique_ptr<QuicDefaultConnectionHelper>(new QuicDefaultConnectionHelper()),
        std::unique_ptr<QuicCryptoServerStreamBase::Helper>(
            new QuicSimpleCryptoServerStreamHelper()),
        std::unique_ptr<QuicAlarmFactory>(new NapiAlarmFactory(QuicDefaultClock::Get(), getJS())),
        &http3_server_backend_, expected_server_connection_id_length_, connection_id_generator_);
  }

  Http3ServerJS::Http3ServerJS(const Napi::CallbackInfo &info) : Napi::ObjectWrap<Http3ServerJS>(info)
  {
    std::string secret;
    std::string cert;
    std::string privkey;

    QuicConfig sconfig;
    if (!info[0].IsUndefined())
    {
      Napi::Object lobj = info[0].ToObject();
      if (!lobj.IsEmpty())
      {
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
        if (lobj.Has("initialBidirectionalStreams") && !(lobj).Get("initialBidirectionalStreams").IsEmpty())
        {
          Napi::Value initialBidirectionalStreamsValue = (lobj).Get("initialBidirectionalStreams");
          int initialBidirectionalStreams = initialBidirectionalStreamsValue.As<Napi::Number>().Int32Value();
          sconfig.SetMaxBidirectionalStreamsToSend(initialBidirectionalStreams);
        }

        if (lobj.Has("initialUnidirectionalStreams") && !(lobj).Get("initialUnidirectionalStreams").IsEmpty())
        {
          Napi::Value initialUnidirectionalStreamsValue = (lobj).Get("initialUnidirectionalStreams");
          int initialUnidirectionalStreams = initialUnidirectionalStreamsValue.As<Napi::Number>().Int32Value();
          sconfig.SetMaxUnidirectionalStreamsToSend(initialUnidirectionalStreams);
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

        if (lobj.Has("streamFlowControlWindowSizeLimit") && !(lobj).Get("streamFlowControlWindowSizeLimit").IsEmpty())
        {
          Napi::Value streamFlowControlWindowSizeLimitValue = (lobj).Get("streamFlowControlWindowSizeLimit");
          int streamFlowControlWindowSizeLimitWindow = streamFlowControlWindowSizeLimitValue.As<Napi::Number>().Int32Value();
          sconfig.SetInitialMaxStreamDataBytesOutgoingBidirectionalToSend(streamFlowControlWindowSizeLimitWindow);
          sconfig.SetInitialMaxStreamDataBytesIncomingBidirectionalToSend(streamFlowControlWindowSizeLimitWindow);
          sconfig.SetInitialMaxStreamDataBytesUnidirectionalToSend(streamFlowControlWindowSizeLimitWindow);
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

      server_ = std::make_unique<Http3Server>(this, std::move(proofsource), secret.c_str(), sconfig);

      return;
    }
    else
    {
      Napi::Error::New(Env(), "No arguments passed to Http3Server").ThrowAsJavaScriptException();
      return;
    }
  }

  Http3ServerJS::~Http3ServerJS()
  {
  }

  void Http3ServerJS::destroy(const Napi::CallbackInfo &info)
  {
    server_->Destroy();
    server_.reset();
  }

  Napi::Value Http3ServerJS::recvPaket(const Napi::CallbackInfo &info)
  {
    QuicTime now = QuicDefaultClock::Get()->Now();
    // Got a packet replace OnSocketEvent for readable
    if (info[0].IsUndefined())
    {
      Napi::Error::New(Env(), "No obj passed to recvPaket").ThrowAsJavaScriptException();
      return Env().Undefined();
    }
    Napi::Object lobj = info[0].ToObject();
    if (lobj.IsEmpty())
    {
      Napi::Error::New(Env(), "Obj for recvPaket is empty").ThrowAsJavaScriptException();
      return Env().Undefined();
    }

    if (!lobj.Has("selfaddress"))
    {
      Napi::Error::New(Env(), "No Selfaddress for recvPaket").ThrowAsJavaScriptException();
      return Env().Undefined();
    }

    Napi::Object selfaddress = (lobj).Get("selfaddress").As<Napi::Object>();
    if (selfaddress.IsEmpty())
    {
      Napi::Error::New(Env(), "Selfaddress for recvPaket empty").ThrowAsJavaScriptException();
      return Env().Undefined();
    }
    int port = selfaddress.Get("port").As<Napi::Number>().Int32Value();
    std::string selfipaddress = selfaddress.Get("address").As<Napi::String>();

    QuicIpAddress self_ip;
    self_ip.FromString(selfipaddress);
    QuicSocketAddress self_address(self_ip, port);

    if (!lobj.Has("rinfo"))
    {
      Napi::Error::New(Env(), "No rinfo for recvPaket").ThrowAsJavaScriptException();
      return Env().Undefined();
    }

    Napi::Object rinfo = (lobj).Get("rinfo").As<Napi::Object>();
    if (rinfo.IsEmpty())
    {
      Napi::Error::New(Env(), "Rinfo for recvPaket empty").ThrowAsJavaScriptException();
      return Env().Undefined();
    }
    int peerport = rinfo.Get("port").As<Napi::Number>().Int32Value();
    std::string peeripaddress = rinfo.Get("address").As<Napi::String>();

    QuicIpAddress peer_ip;
    peer_ip.FromString(peeripaddress);
    QuicSocketAddress peer_address(peer_ip, peerport);

    Napi::Object bufferlocal = lobj.Get("msg").As<Napi::Object>();

    QuicReceivedPacket packet(
        bufferlocal.As<Napi::Buffer<char>>().Data(), rinfo.Get("size").As<Napi::Number>().Uint32Value(), now,
        /*owns_buffer=*/false, 0 /*ttl*/, false /*has_ttl*/, nullptr /*headers*/, 0 /*headers_length*/,
        /*owns_header_buffer=*/false, ECN_NOT_ECT);

    Http3Server *obj = getObj();
    bool hasbufferedchlos = obj->ProcessPacket(self_address, peer_address, packet);
    return Napi::Boolean::New(Env(), hasbufferedchlos);
  }

  bool Http3Server::ProcessPacket(const QuicSocketAddress &self_address,
                                  const QuicSocketAddress &peer_address,
                                  const QuicReceivedPacket &packet)
  {
    dispatcher_.get()->ProcessPacket(self_address, peer_address, packet);
    return dispatcher_->HasChlosBuffered();
  }

  void Http3ServerJS::processBufferedChlos(const Napi::CallbackInfo &info)
  {
    Http3Server *obj = getObj();
    obj->ProcessBufferedChlos();
  }

  void Http3Server::ProcessBufferedChlos()
  {
    dispatcher_->ProcessBufferedChlos(kNumSessionsToCreatePerSocketEvent);
  }



  void Http3ServerJS::onCanWrite(const Napi::CallbackInfo &info)
  {
    server_->OnCanWrite();
  }

  void Http3Server::OnCanWrite()
  {
    dispatcher_->OnCanWrite();
  }

  /*void Http3Server::OnSocketEvent(QuicEventLoop *event_loop, QuicUdpSocketFd fd,
                                  QuicSocketEventMask events)
  {
    // QUICHE_DCHECK_EQ(fd, fd_);

    /* if (events & kSocketEventReadable)
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
      else if (!event_loop->SupportsEdgeTriggered())
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
  }*/

  void Http3ServerJS::processNewSession(Http3WTSession *session, const std::string &path, Napi::Reference<Napi::Value> *header, Napi::Reference<Napi::Value> *userData)
  {
    Napi::HandleScope scope(Env());

    Http3Constructors *constr = Env().GetInstanceData<Http3Constructors>();
    Napi::Object sessionobj = constr->session.New({});
    Http3WTSessionJS *sessionjs = Napi::ObjectWrap<Http3WTSessionJS>::Unwrap(sessionobj);
    sessionjs->setObj(session);
    sessionjs->Ref();
    session->setJS(sessionjs);

    Napi::Object objVal = Value().Get("jsobj").As<Napi::Object>();

    Napi::Object retObj = Napi::Object::New(Env());
    retObj.Set("session", sessionobj);
    retObj.Set("path", path);
    if (header)
    {
      retObj.Set("header", header->Value());
      header->Unref();
    }
    if (userData)
    {
      retObj.Set("userData", userData->Value());
      userData->Unref();
    }
    objVal.Get("onHttpWTSessionVisitor")
        .As<Napi::Function>()
        .Call(objVal, {retObj});
  }

  void Http3ServerJS::processNewSessionRequest(WebTransportSession *session, const spdy::Http2HeaderBlock &reqhead, WebTransportRespPromisePtr *promise)
  {
    Napi::HandleScope scope(Env());

    Napi::Object objVal = Value().Get("jsobj").As<Napi::Object>();

    Napi::Object retObj = Napi::Object::New(Env());

    // header

    Napi::Object headObj = Napi::Object::New(Env());
    for (auto pair : reqhead)
    {
      // we iterate over all header fields
      headObj.Set(std::string(pair.first), std::string(pair.second));
    }
    retObj.Set("header", headObj);
    // delete reqheadcopy; // we own it and must free it!

    // promise
    Napi::External<WebTransportRespPromisePtr> promObj =
        Napi::External<WebTransportRespPromisePtr>::New(Env(), promise,
                                                        [](Napi::Env /*env*/, WebTransportRespPromisePtr *ref)
                                                        {
                                                          delete ref; // we own it and must delete it
                                                        });
    retObj.Set("promise", promObj);

    Napi::External<WebTransportSession> wtsObj =
        Napi::External<WebTransportSession>::New(Env(), session,
                                                 [](Napi::Env /*env*/, WebTransportSession *ref)
                                                 {
                                                   // we do not own it! And do not delete it.
                                                   // does it outlife everything?
                                                 });
    retObj.Set("session", wtsObj);

    objVal.Get("onSessionRequest")
        .As<Napi::Function>()
        .Call(objVal, {retObj});
  }

  void Http3ServerJS::addPath(const Napi::CallbackInfo &info)
  {
    Http3Server *obj = getObj();

    if (!info[0].IsUndefined())
    {

      std::string lpath(info[0].ToString().Utf8Value());
      obj->http3_server_backend_.addPath(lpath);
    }
    else
      return Napi::Error::New(Env(), "No path set for addPath").ThrowAsJavaScriptException();
  }

  void Http3ServerJS::finishSessionRequest(const Napi::CallbackInfo &info)
  {
    Http3Server *obj = getObj();

    if (!info[0].IsUndefined())
    {
      // needs two properties
      int status = -1;
      std::string path = "";
      Napi::Object lobj = info[0].ToObject();
      if (!lobj.IsEmpty())
      {
        if (lobj.Has("status") && !(lobj).Get("status").IsEmpty())
        {
          Napi::Value statusValue = (lobj).Get("status");
          status = statusValue.As<Napi::Number>().Int32Value();
        }
        else
          return Napi::Error::New(Env(), "No status code passed for finishSessionRequest").ThrowAsJavaScriptException();

        if (lobj.Has("path") && !(lobj).Get("path").IsEmpty())
        {
          Napi::Value pathValue = (lobj).Get("path");
          path = pathValue.ToString().Utf8Value();
        }
        else
          return Napi::Error::New(Env(), "No path passed for finishSessionRequest").ThrowAsJavaScriptException();
        WebTransportSession *session = nullptr;
        if (lobj.Has("session") && !(lobj).Get("session").IsEmpty())
        {
          Napi::Value sessionVal = (lobj).Get("session");
          if (!sessionVal.IsExternal())
            return Napi::Error::New(Env(), "Session is not external for finishSessionRequest").ThrowAsJavaScriptException();
          Napi::External<WebTransportSession> sessionExt = sessionVal.As<Napi::External<WebTransportSession>>();
          session = sessionExt.Data();
        }
        else
          return Napi::Error::New(Env(), "No session passed for finishSessionRequest").ThrowAsJavaScriptException();

        if (lobj.Has("promise") && !(lobj).Get("promise").IsEmpty())
        {
          Napi::Value promiseVal = (lobj).Get("promise");
          if (!promiseVal.IsExternal())
            return Napi::Error::New(Env(), "Promise is not external for finishSessionRequest").ThrowAsJavaScriptException();
          Napi::External<Http3ServerBackend::WebTransportRespPromisePtr> promise = promiseVal.As<Napi::External<Http3ServerBackend::WebTransportRespPromisePtr>>();

          Http3ServerBackend::WebTransportRespPromisePtr *prom = promise.Data();
          Napi::Reference<Napi::Value> *headerValue = nullptr;
          Napi::Reference<Napi::Value> *userDataValue = nullptr;
          if (status == 200)
          {

            if (lobj.Has("header") && !(lobj).Get("header").IsEmpty())
            {
              napi_ref ref;
              napi_status status = napi_create_reference(Env(), lobj.Get("header"), 1, &ref);
              NAPI_THROW_IF_FAILED(Env(), status, Reference<Napi::Value>());
              headerValue = new Napi::Reference<Napi::Value>(Env(), ref);
            }
            else
              return Napi::Error::New(Env(), "No header passed for finishSessionRequest").ThrowAsJavaScriptException();
            if (lobj.Has("userData") && !(lobj).Get("userData").IsEmpty())
            {
              napi_ref ref;
              napi_status status = napi_create_reference(Env(), lobj.Get("userData"), 1, &ref);
              NAPI_THROW_IF_FAILED(Env(), status, Reference<Napi::Value>());
              userDataValue = new Napi::Reference<Napi::Value>(Env(), ref);
            }
          }
          if (status != 200)
          {
            std::unique_ptr<Http3ServerBackend::WebTransportResponse> response = std::make_unique<Http3ServerBackend::WebTransportResponse>();
            response->response_headers[":status"] = std::to_string(status);
            (*prom)->resolve(std::move(response));
          }
          else
          {
            std::unique_ptr<Http3ServerBackend::WebTransportResponse> response = std::make_unique<Http3ServerBackend::WebTransportResponse>();
            response->response_headers[":status"] = std::to_string(status);
            Http3WTSession *wtsession = new Http3WTSession();
            wtsession->init(session);
            response->visitor =
                std::make_unique<Http3WTSession::Visitor>(wtsession);
            processNewSession(static_cast<Http3WTSession *>(wtsession), path, headerValue, userDataValue);
            (*prom)->resolve(std::move(response));
          }
        }
        else
          return Napi::Error::New(Env(), "No promise passed for finishSessionRequest").ThrowAsJavaScriptException();
      }
      else
        return Napi::Error::New(Env(), "No object passed for finishSessionRequest").ThrowAsJavaScriptException();
    }
  }

  void Http3ServerJS::setJSRequestHandler(const Napi::CallbackInfo &info)
  {
    Http3Server *obj = getObj();

    if (!info[0].IsUndefined())
    {

      bool hashandler = info[0].ToBoolean();
      obj->http3_server_backend_.setJSHandler(hashandler);
    }
    else
      return Napi::Error::New(Env(), "No bool set for setJSRequestHandler").ThrowAsJavaScriptException();
  }
}
