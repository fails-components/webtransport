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
#include "quic/core/quic_default_packet_writer.h"
#include "quic/core/quic_epoll_alarm_factory.h"
#include "quic/core/quic_epoll_connection_helper.h"
#include "quic/tools/quic_simple_crypto_server_stream_helper.h"
#include "quic/core/quic_epoll_clock.h"
#include "quic/core/crypto/proof_source_x509.h"
#include "common/platform/api/quiche_reference_counted.h"

using namespace Nan;

namespace quic
{

  const size_t kNumSessionsToCreatePerSocketEvent = 16;

  Http3Server::Http3Server(Callback *callback, Callback *cbstream, Callback *cbsession, 
                           std::string host, int port, std::unique_ptr<ProofSource> proof_source,
                           const char *secret)
      : port_(port), host_(host), fd_(-1), overflow_supported_(false),
        packet_reader_(new QuicPacketReader()),
        packets_dropped_(0),
        version_manager_({ParsedQuicVersion::RFCv1()}),
        crypto_config_(secret,
                       QuicRandom::GetInstance(),
                       std::move(proof_source),
                       KeyExchangeSource::Default()),
        expected_server_connection_id_length_(kQuicDefaultConnectionIdLength),
        AsyncProgressQueueWorker(callback),
        progress_(nullptr), cbstream_(cbstream), cbsession_(cbsession)
  {
    epoll_server_.SetAsyncCallback(this);
  }

  Http3Server::~Http3Server()
  {
    delete cbstream_;
    delete cbsession_;
  }

  NAN_MODULE_INIT(Http3Server::Init)
  {
    v8::Local<v8::FunctionTemplate> tpl = Nan::New<v8::FunctionTemplate>(New);
    tpl->SetClassName(Nan::New("Http3WebTransport").ToLocalChecked());
    tpl->InstanceTemplate()->SetInternalFieldCount(2);
    Nan::SetPrototypeMethod(tpl, "createHttp3Server", createHttp3Server);
    Nan::SetPrototypeMethod(tpl, "startServer", startServer);
    Nan::SetPrototypeMethod(tpl, "addPath", addPath);
    // Nan::SetPrototypeMethod(tpl, "getHandle", GetHandle);
    // Nan::SetPrototypeMethod(tpl, "getValue", GetValue);
    constructor().Reset(Nan::GetFunction(tpl).ToLocalChecked());
    Nan::Set(target, Nan::New("Http3WebTransport").ToLocalChecked(),
             Nan::GetFunction(tpl).ToLocalChecked());

    // http3wtsessionvisitor
    v8::Local<v8::FunctionTemplate> tplwt = Nan::New<v8::FunctionTemplate>(Http3WTSession::New);
    tplwt->SetClassName(Nan::New("Http3WTSession").ToLocalChecked());
    tplwt->InstanceTemplate()->SetInternalFieldCount(1);
    Nan::SetPrototypeMethod(tplwt, "orderBidiStream", Http3WTSession::orderBidiStream);
    Nan::SetPrototypeMethod(tplwt, "orderUnidiStream", Http3WTSession::orderUnidiStream);
    Nan::SetPrototypeMethod(tplwt, "writeDatagram", Http3WTSession::writeDatagram);
    Nan::SetPrototypeMethod(tplwt, "close", Http3WTSession::close);

    Http3WTSession::constructor().Reset(Nan::GetFunction(tplwt).ToLocalChecked());
    Nan::Set(target, Nan::New("Http3WTSession").ToLocalChecked(),
             Nan::GetFunction(tplwt).ToLocalChecked());

    // http3wtstreamvisitor
    v8::Local<v8::FunctionTemplate> tplwtsv = Nan::New<v8::FunctionTemplate>(Http3WTStream::New);
    tplwtsv->SetClassName(Nan::New("Http3WTStream").ToLocalChecked());
    tplwtsv->InstanceTemplate()->SetInternalFieldCount(1);
    Nan::SetPrototypeMethod(tplwtsv, "writeChunk", Http3WTStream::writeChunk);
    Nan::SetPrototypeMethod(tplwtsv, "closeStream", Http3WTStream::closeStream);
    Nan::SetPrototypeMethod(tplwtsv, "resetStream", Http3WTStream::resetStream);
    Nan::SetPrototypeMethod(tplwtsv, "startReading", Http3WTStream::startReading);
    Nan::SetPrototypeMethod(tplwtsv, "stopReading", Http3WTStream::stopReading);

    Http3WTStream::constructor().Reset(Nan::GetFunction(tplwtsv).ToLocalChecked());
    Nan::Set(target, Nan::New("Http3WTStream").ToLocalChecked(),
             Nan::GetFunction(tplwtsv).ToLocalChecked());
  }

  NAN_METHOD(Http3Server::createHttp3Server)
  {
    // ok this creates an http3server object from javascript side
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

    const int kEpollFlags = UV_READABLE | UV_WRITABLE | UV_DISCONNECT;

    epoll_server_.set_timeout_in_us(-1); // negative values would mean wait forever
    epoll_server_.RegisterFD(fd_, this, kEpollFlags);
    dispatcher_.reset(CreateQuicDispatcher());
    dispatcher_->InitializeWithWriter(new QuicDefaultPacketWriter(fd_));

    return true;
  }

  void Http3Server::Destroy()
  {
    Unref();
    if (!quit_.HasBeenNotified())
    {
      quit_.Notify();
    }
    // if (!silent_close_) {
    //  Before we shut down the epoll server, give all active sessions a chance
    //  to notify clients that they're closing.
    dispatcher_->Shutdown();
    //}

    epoll_server_.Shutdown();

    close(fd_);
    fd_ = -1;
  }

  QuicDispatcher *Http3Server::CreateQuicDispatcher()
  {

    QuicEpollAlarmFactory alarm_factory(&epoll_server_);
    http3_server_backend_.setServer(this);
    return new Http3Dispatcher(
        &config_, &crypto_config_, &version_manager_,
        std::unique_ptr<QuicEpollConnectionHelper>(new QuicEpollConnectionHelper(
            &epoll_server_, QuicAllocator::BUFFER_POOL)),
        std::unique_ptr<QuicCryptoServerStreamBase::Helper>(
            new QuicSimpleCryptoServerStreamHelper()),
        std::unique_ptr<QuicEpollAlarmFactory>(
            new QuicEpollAlarmFactory(&epoll_server_)),
        &http3_server_backend_, expected_server_connection_id_length_);
  }

  void Http3Server::Execute(const AsyncProgressQueueWorker::ExecutionProgress &progress)
  {
    progress_ = &progress;
    // main event loop
    while (!quit_.HasBeenNotified())
    {
      epoll_server_.WaitForEventsAndExecuteCallbacks();
    }
    progress_ = nullptr;
  }

  void Http3Server::OnAsyncExecution()
  {
     ExecuteScheduledActions();
  }

  void Http3Server::ExecuteScheduledActions()
  {
    quiche::QuicheCircularDeque<std::function<void()>> actions;
    {
      QuicWriterMutexLock lock(&scheduled_actions_lock_);
      actions.swap(scheduled_actions_);
    }
    while (!actions.empty())
    {
      actions.front()();
      actions.pop_front();
    }
  }

  void Http3Server::Schedule(std::function<void()> action)
  {
    QUICHE_DCHECK(!quit_.HasBeenNotified());
    QuicWriterMutexLock lock(&scheduled_actions_lock_);
    scheduled_actions_.push_back(std::move(action));
    epoll_server_.TriggerAsync();
  }

  void Http3Server::informAboutStream(bool incom, bool bidir, Http3WTSession *sessionobj, Http3WTStream *stream)
  {
    struct Http3ProgressReport report;
    if (incom)
    {
      if (bidir)
      {
        report.type = Http3ProgressReport::IncomBiDiStream;
      }
      else
      {
        report.type = Http3ProgressReport::IncomUniDiStream;
      }
    }
    else
    {
      if (bidir)
      {
        report.type = Http3ProgressReport::OutgoBiDiStream;
      }
      else
      {
        report.type = Http3ProgressReport::OutgoUniDiStream;
      }
    }
    report.sessionobj = sessionobj;
    report.stream = stream;
    if (progress_)
      progress_->Send(&report, 1);
  }

  void Http3Server::informStreamClosed(Http3WTStream *streamobj, WebTransportStreamError code)
  {
    struct Http3ProgressReport report;
    report.type = Http3ProgressReport::StreamClosed;
    report.streamobj = streamobj;
    report.wtscode = code;
    if (progress_)
      progress_->Send(&report, 1);
  }

  void Http3Server::informAboutStreamRead(Http3WTStream *streamobj, std::string *data, bool fin)
  {
    struct Http3ProgressReport report;
    report.type = Http3ProgressReport::StreamRead;
    report.streamobj = streamobj;
    report.para = data;
    report.fin = fin;
    if (progress_)
      progress_->Send(&report, 1);
  }

  void Http3Server::informAboutStreamWrite(Http3WTStream *streamobj, Nan::Persistent<v8::Object> *bufferhandle, bool success)
  {
    struct Http3ProgressReport report;
    report.type = Http3ProgressReport::StreamWrite;
    report.streamobj = streamobj;
    report.bufferhandle = bufferhandle;
    report.success = success;
    if (progress_)
      progress_->Send(&report, 1);
  }

  void Http3Server::informAboutStreamReset(Http3WTStream *streamobj)
  {
    struct Http3ProgressReport report;
    report.type = Http3ProgressReport::StreamReset;
    report.streamobj = streamobj;
    if (progress_)
      progress_->Send(&report, 1);
  }

  void Http3Server::informDatagramReceived(Http3WTSession *sessionobj, absl::string_view datagram)
  {
    struct Http3ProgressReport report;
    report.type = Http3ProgressReport::DatagramReceived;
    report.sessionobj = sessionobj;
    report.para = new std::string(datagram);
    if (progress_)
      progress_->Send(&report, 1);
  }

  void Http3Server::informDatagramSend(Http3WTSession *sessionobj)
  {
    struct Http3ProgressReport report;
    report.type = Http3ProgressReport::DatagramSend;
    report.sessionobj = sessionobj;
    if (progress_)
      progress_->Send(&report, 1);
  }

  void Http3Server::informDatagramBufferFree(Nan::Persistent<v8::Object> *bufferhandle)
  {
    struct Http3ProgressReport report;
    report.type = Http3ProgressReport::DatagramBufferFree;
    report.bufferhandle = bufferhandle;

    if (progress_)
      progress_->Send(&report, 1);
  }

  void Http3Server::informAboutNewSession(Http3WTSession *session, absl::string_view path)
  {
    struct Http3ProgressReport report;
    report.type = Http3ProgressReport::NewSession;
    report.session = session;
    report.para = new std::string(path);
    if (progress_)
      progress_->Send(&report, 1);
  }

  void Http3Server::informSessionClosed(Http3WTSession *sessionobj, WebTransportSessionError error_code,
                                        absl::string_view error_message)
  {
    struct Http3ProgressReport report;
    report.type = Http3ProgressReport::SessionClosed;
    report.sessionobj = sessionobj;
    report.para = new std::string(error_message);
    report.wtecode = error_code;
    if (progress_)
      progress_->Send(&report, 1);
  }

  void Http3Server::informSessionReady(Http3WTSession *sessionobj)
  {
    struct Http3ProgressReport report;
    report.type = Http3ProgressReport::SessionReady;
    report.sessionobj = sessionobj;
    if (progress_)
      progress_->Send(&report, 1);
  }

  void Http3Server::freeData(char *data, void *hint)
  {
    // ok free data is actually using a string object
    std::string *sdata = static_cast<std::string *>(hint);
    delete sdata;
  }

  void Http3Server::processStream(bool incom, bool bidi, Http3WTSession *sessionobj, Http3WTStream *stream)
  {

    HandleScope scope;

    auto strVal = Http3WTStream::NewInstance(stream);
    v8::Local<v8::String> purposeProp = Nan::New("purpose").ToLocalChecked();
    v8::Local<v8::String> purposeVal = Nan::New("Http3WTStreamVisitor").ToLocalChecked();
    v8::Local<v8::String> strProp = Nan::New("stream").ToLocalChecked();

    v8::Local<v8::String> incomProp = Nan::New("incoming").ToLocalChecked();
    v8::Local<v8::Boolean> incomVal = Nan::New(incom);
    v8::Local<v8::String> bidiProp = Nan::New("bidirectional").ToLocalChecked();
    v8::Local<v8::Boolean> bidiVal = Nan::New(bidi);

    v8::Local<v8::String> objProp = Nan::New("object").ToLocalChecked();
    v8::Local<v8::Object> objVal = sessionobj->handle();

    auto context = GetCurrentContext();
    v8::Local<v8::Object> retObj = Nan::New<v8::Object>();
    retObj->Set(context, purposeProp, purposeVal).FromJust();
    retObj->Set(context, strProp, strVal).FromJust();
    retObj->Set(context, incomProp, incomVal).FromJust();
    retObj->Set(context, bidiProp, bidiVal).FromJust();
    retObj->Set(context, objProp, objVal).FromJust();

    v8::Local<v8::Value> argv[] = {retObj};
    Nan::Call(*cbsession_, 1, argv);
  }

  void Http3Server::processStreamClosed(Http3WTStream *streamobj, WebTransportStreamError code)
  {
    HandleScope scope;
    v8::Local<v8::String> purposeProp = Nan::New("purpose").ToLocalChecked();
    v8::Local<v8::String> purposeVal = Nan::New("StreamClosed").ToLocalChecked();
    v8::Local<v8::String> codeProp = Nan::New("code").ToLocalChecked();
    v8::Local<v8::Int32> codeVal = Nan::New(code);

    v8::Local<v8::String> objProp = Nan::New("object").ToLocalChecked();
    v8::Local<v8::Object> objVal = streamobj->handle();

    auto context = GetCurrentContext();
    v8::Local<v8::Object> retObj = Nan::New<v8::Object>();
    retObj->Set(context, purposeProp, purposeVal).FromJust();
    retObj->Set(context, codeProp, codeVal).FromJust();
    retObj->Set(context, objProp, objVal).FromJust();

    v8::Local<v8::Value> argv[] = {retObj};
    Nan::Call(*cbstream_, 1, argv);
  }

  void Http3Server::processStreamRead(Http3WTStream *streamobj, std::string *data, bool fin)
  {
    HandleScope scope;
    v8::Local<v8::String> purposeProp = Nan::New("purpose").ToLocalChecked();
    v8::Local<v8::String> purposeVal = Nan::New("StreamRead").ToLocalChecked();
    v8::Local<v8::String> finProp = Nan::New("fin").ToLocalChecked();
    v8::Local<v8::Boolean> finVal = Nan::New(fin);
    v8::Local<v8::String> dataProp = Nan::New("data").ToLocalChecked();

    v8::Local<v8::Object> dataVal = Nan::NewBuffer(&(*data)[0], data->length(),
                                                   freeData, static_cast<void *>(data))
                                        .ToLocalChecked();

    v8::Local<v8::String> objProp = Nan::New("object").ToLocalChecked();
    v8::Local<v8::Object> objVal = streamobj->handle();

    auto context = GetCurrentContext();
    v8::Local<v8::Object> retObj = Nan::New<v8::Object>();
    retObj->Set(context, purposeProp, purposeVal).FromJust();
    retObj->Set(context, finProp, finVal).FromJust();
    retObj->Set(context, dataProp, dataVal).FromJust();
    retObj->Set(context, objProp, objVal).FromJust();

    v8::Local<v8::Value> argv[] = {retObj};
    Nan::Call(*cbstream_, 1, argv);
  }

  void Http3Server::processStreamWrite(Http3WTStream *streamobj, Nan::Persistent<v8::Object> *bufferhandle, bool success)
  {
    HandleScope scope;
    v8::Local<v8::String> purposeProp = Nan::New("purpose").ToLocalChecked();
    v8::Local<v8::String> purposeVal = Nan::New("StreamWrite").ToLocalChecked();
    v8::Local<v8::String> successProp = Nan::New("success").ToLocalChecked();
    v8::Local<v8::Boolean> successVal = Nan::New(success);

    v8::Local<v8::String> objProp = Nan::New("object").ToLocalChecked();
    v8::Local<v8::Object> objVal = streamobj->handle();

    bufferhandle->Reset(); // release the outgoing buffer
    delete bufferhandle;   // free the handle object

    auto context = GetCurrentContext();
    v8::Local<v8::Object> retObj = Nan::New<v8::Object>();
    retObj->Set(context, purposeProp, purposeVal).FromJust();
    retObj->Set(context, successProp, successVal).FromJust();
    retObj->Set(context, objProp, objVal).FromJust();

    v8::Local<v8::Value> argv[] = {retObj};
    Nan::Call(*cbstream_, 1, argv);
  }

  void Http3Server::processStreamReset(Http3WTStream *streamobj)
  {
    HandleScope scope;
    v8::Local<v8::String> purposeProp = Nan::New("purpose").ToLocalChecked();
    v8::Local<v8::String> purposeVal = Nan::New("StreamReset").ToLocalChecked();

    v8::Local<v8::String> objProp = Nan::New("object").ToLocalChecked();
    v8::Local<v8::Object> objVal = streamobj->handle();


    auto context = GetCurrentContext();
    v8::Local<v8::Object> retObj = Nan::New<v8::Object>();
    retObj->Set(context, purposeProp, purposeVal).FromJust();
    retObj->Set(context, objProp, objVal).FromJust();

    v8::Local<v8::Value> argv[] = {retObj};
    Nan::Call(*cbstream_, 1, argv);
  }

  void Http3Server::processDatagramBufferFree(Nan::Persistent<v8::Object> *bufferhandle)
  {
    bufferhandle->Reset(); // release the outgoing buffer
    delete bufferhandle;   // free the handle object
  }

  void Http3Server::processDatagramReceived(Http3WTSession *sessionobj, std::string *datagram)
  {
    HandleScope scope;
    v8::Local<v8::String> purposeProp = Nan::New("purpose").ToLocalChecked();
    v8::Local<v8::String> purposeVal = Nan::New("DatagramReceived").ToLocalChecked();
    v8::Local<v8::String> datagramProp = Nan::New("datagram").ToLocalChecked();
    v8::Local<v8::Object> datagramVal = Nan::NewBuffer(&(*datagram)[0], datagram->length(),
                                                       freeData, static_cast<void *>(datagram))
                                            .ToLocalChecked();

    v8::Local<v8::String> objProp = Nan::New("object").ToLocalChecked();
    v8::Local<v8::Object> objVal = sessionobj->handle();

    auto context = GetCurrentContext();
    v8::Local<v8::Object> retObj = Nan::New<v8::Object>();
    retObj->Set(context, purposeProp, purposeVal).FromJust();
    retObj->Set(context, datagramProp, datagramVal).FromJust();
    retObj->Set(context, objProp, objVal).FromJust();

    v8::Local<v8::Value> argv[] = {retObj};
    Nan::Call(*cbsession_, 1, argv);
  }

  void Http3Server::processDatagramSend(Http3WTSession *sessionobj)
  {
    HandleScope scope;
    v8::Local<v8::String> purposeProp = Nan::New("purpose").ToLocalChecked();
    v8::Local<v8::String> purposeVal = Nan::New("DatagramSend").ToLocalChecked();

    v8::Local<v8::String> objProp = Nan::New("object").ToLocalChecked();
    v8::Local<v8::Object> objVal = sessionobj->handle();

    auto context = GetCurrentContext();
    v8::Local<v8::Object> retObj = Nan::New<v8::Object>();
    retObj->Set(context, purposeProp, purposeVal).FromJust();
    retObj->Set(context, objProp, objVal).FromJust();

    v8::Local<v8::Value> argv[] = {retObj};
    Nan::Call(*cbsession_, 1, argv);
  }

  void Http3Server::processNewSession(Http3WTSession *session, const std::string &path)
  {
    HandleScope scope;

    auto obj = Http3WTSession::NewInstance(session);
    v8::Local<v8::String> purposeProp = Nan::New("purpose").ToLocalChecked();
    v8::Local<v8::String> purposeVal = Nan::New("Http3WTSessionVisitor").ToLocalChecked();
    v8::Local<v8::String> objProp = Nan::New("object").ToLocalChecked();

    v8::Local<v8::String> pathProp = Nan::New("path").ToLocalChecked();
    v8::Local<v8::String> stringPath = Nan::New(path).ToLocalChecked();

    auto context = GetCurrentContext();
    v8::Local<v8::Object> retObj = Nan::New<v8::Object>();
    retObj->Set(context, purposeProp, purposeVal).FromJust();
    retObj->Set(context, objProp, obj).FromJust();
    retObj->Set(context, pathProp, stringPath).FromJust();

    v8::Local<v8::Value> argv[] = {retObj};
    Nan::Call(*callback, 1, argv);
  }

  void Http3Server::processSessionReady(Http3WTSession *sessionobj)
  {
    HandleScope scope;
    v8::Local<v8::String> purposeProp = Nan::New("purpose").ToLocalChecked();
    v8::Local<v8::String> purposeVal = Nan::New("SessionReady").ToLocalChecked();

    v8::Local<v8::String> objProp = Nan::New("object").ToLocalChecked();
    v8::Local<v8::Object> objVal = sessionobj->handle();

    auto context = GetCurrentContext();
    v8::Local<v8::Object> retObj = Nan::New<v8::Object>();
    retObj->Set(context, purposeProp, purposeVal).FromJust();
    retObj->Set(context, objProp, objVal).FromJust();


    v8::Local<v8::Value> argv[] = {retObj};
    Nan::Call(*cbsession_, 1, argv);
  }

  void Http3Server::processSessionClose(Http3WTSession *sessionobj, uint32_t errorcode, const std::string &error)
  {
    HandleScope scope;
    v8::Local<v8::String> purposeProp = Nan::New("purpose").ToLocalChecked();
    v8::Local<v8::String> purposeVal = Nan::New("SessionClose").ToLocalChecked();
    v8::Local<v8::String> errorProp = Nan::New("error").ToLocalChecked();
    v8::Local<v8::String> errorVal = Nan::New(error).ToLocalChecked();
    v8::Local<v8::String> errorcProp = Nan::New("errorcode").ToLocalChecked();
    v8::Local<v8::Uint32> errorcVal = Nan::New(errorcode);

    v8::Local<v8::String> objProp = Nan::New("object").ToLocalChecked();
    v8::Local<v8::Object> objVal = sessionobj->handle();

    auto context = GetCurrentContext();
    v8::Local<v8::Object> retObj = Nan::New<v8::Object>();
    retObj->Set(context, purposeProp, purposeVal).FromJust();
    retObj->Set(context, errorProp, errorVal).FromJust();
    retObj->Set(context, errorcProp, errorcVal).FromJust();

    retObj->Set(context, objProp, objVal).FromJust();

    v8::Local<v8::Value> argv[] = {retObj};
    Nan::Call(*cbsession_, 1, argv);
  }

  void Http3Server::HandleProgressCallback(const Http3ProgressReport *data, size_t count)
  {
    for (int i = 0; i < count; i++)
    {
      Http3ProgressReport cur = data[i];
      switch (cur.type)
      {
      case Http3ProgressReport::NewSession:
      {
        processNewSession(cur.session, *cur.para);
      }
      break;
      case Http3ProgressReport::SessionReady:
      {
        processSessionReady(cur.sessionobj);
      }
      break;
      case Http3ProgressReport::SessionClosed:
      {
        processSessionClose(cur.sessionobj, cur.wtecode, *cur.para);
      }
      break;
      case Http3ProgressReport::IncomBiDiStream:
      {
        processStream(true, true, cur.sessionobj, cur.stream);
      }
      break;
      case Http3ProgressReport::IncomUniDiStream:
      {
        processStream(true, false, cur.sessionobj, cur.stream);
      }
      break;
      case Http3ProgressReport::OutgoBiDiStream:
      {
        processStream(false, true, cur.sessionobj, cur.stream);
      }
      break;
      case Http3ProgressReport::OutgoUniDiStream:
      {
        processStream(false, false, cur.sessionobj, cur.stream);
      }
      break;
      case Http3ProgressReport::StreamClosed:
      {
        processStreamClosed(cur.streamobj, cur.wtscode);
      }
      break;
      case Http3ProgressReport::StreamRead:
      {
        processStreamRead(cur.streamobj, cur.para, cur.fin);
        cur.para = nullptr; // take ownership of the data
      }
      break;
      case Http3ProgressReport::StreamWrite:
      {
        processStreamWrite(cur.streamobj, cur.bufferhandle, cur.success);
      }
      break;
      case Http3ProgressReport::StreamReset:
      {
        processStreamReset(cur.streamobj);
      }
      break;
      case Http3ProgressReport::DatagramReceived:
      {
        processDatagramReceived(cur.sessionobj, cur.para);
        cur.para = nullptr; // take ownership of the data
      }
      break;
      case Http3ProgressReport::DatagramSend:
      {
        processDatagramSend(cur.sessionobj);
      }
      break;
      case Http3ProgressReport::DatagramBufferFree:
      {
        processDatagramBufferFree(cur.bufferhandle);
      }
      break;
      };
      if (cur.para)
        delete cur.para;
    }

    // v8::Local<v8::Value> argv[] = {
    //     Nan::New<v8::Integer>(*reinterpret_cast<int *>(const_cast<char *>(data)))};
    //  progress->Call(1, argv, async_resource);
  }

  void Http3Server::OnEvent(int fd, QuicEpollEvent *event)
  {
    QUICHE_DCHECK_EQ(fd, fd_);
    event->out_ready_mask = 0;

    if (event->in_events & UV_READABLE)
    {
      QUIC_DVLOG(1) << "UV_READABLE";

      dispatcher_->ProcessBufferedChlos(kNumSessionsToCreatePerSocketEvent);

      bool more_to_read = true;
      while (more_to_read)
      {
        more_to_read = packet_reader_->ReadAndDispatchPackets(
            fd_, port_, QuicEpollClock(&epoll_server_), dispatcher_.get(),
            overflow_supported_ ? &packets_dropped_ : nullptr);
      }

      if (dispatcher_->HasChlosBuffered())
      {
        // Register UV_READABLE event to consume buffered CHLO(s).
        event->out_ready_mask |= UV_READABLE;
      }
    }
    if (event->in_events & UV_WRITABLE)
    {
      dispatcher_->OnCanWrite();
      if (dispatcher_->HasPendingWrites())
      {
        event->out_ready_mask |= UV_WRITABLE;
      }
    }
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

      Callback *callback = nullptr;
      Callback *cbstream = nullptr;
      Callback *cbsession = nullptr;



      v8::Local<v8::Context> context = info.GetIsolate()->GetCurrentContext();
      if (!info[1]->IsUndefined() /*|| info[1]->IsFunction()*/)
      {
        v8::MaybeLocal<v8::Object> obj = info[1]->ToObject(context);
        v8::Local<v8::String> tpProp = Nan::New("transportCallback").ToLocalChecked();
        v8::Local<v8::String> strProp = Nan::New("streamCallback").ToLocalChecked();
        v8::Local<v8::String> sessProp = Nan::New("sessionCallback").ToLocalChecked();
        if (obj.IsEmpty())  return Nan::ThrowError("No callback obj for Http3Transport");
        v8::Local<v8::Object> lobj = obj.ToLocalChecked();

        if (Nan::HasOwnProperty(lobj, tpProp).FromJust() && !Nan::Get(lobj, tpProp).IsEmpty())
        {
          callback = new Callback(To<v8::Function>(Nan::Get(lobj, tpProp).ToLocalChecked()).ToLocalChecked());
        } else return Nan::ThrowError("No transport callback");

        if (Nan::HasOwnProperty(lobj, strProp).FromJust() && !Nan::Get(lobj, strProp).IsEmpty())
        {
          cbstream = new Callback(To<v8::Function>(Nan::Get(lobj, strProp).ToLocalChecked()).ToLocalChecked());
        } else return Nan::ThrowError("No stream callback");

        if (Nan::HasOwnProperty(lobj, sessProp).FromJust() && !Nan::Get(lobj, sessProp).IsEmpty())
        {
          cbsession = new Callback(To<v8::Function>(Nan::Get(lobj, sessProp).ToLocalChecked()).ToLocalChecked());
        } else return Nan::ThrowError("No session callback");

      } else  return Nan::ThrowError("Callback not passed to Http3Transport internal");
      
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

        
        Http3Server *object = new Http3Server(callback, cbstream, cbsession, host, port, std::move(proofsource), secret.c_str());
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
    Nan::AsyncQueueWorker(this);
    return true;
  }

  NAN_METHOD(Http3Server::startServer)
  {
    Http3Server *obj = Nan::ObjectWrap::Unwrap<Http3Server>(info.Holder());
    // got the object we can now start the server
    obj->Ref(); // do not garbage collect
    if (!obj->startServerInt())
    {
      return Nan::ThrowError("startServerInt failed for Http3Server");
    }
  }

  NAN_METHOD(Http3Server::addPath)
  {
    Http3Server *obj = Nan::ObjectWrap::Unwrap<Http3Server>(info.Holder());
    v8::Isolate *isolate = info.GetIsolate();
    v8::Local<v8::Context> context = info.GetIsolate()->GetCurrentContext();

    if (!info[0]->IsUndefined())
    {

      std::string lpath(*v8::String::Utf8Value(isolate, info[0]->ToString(context).ToLocalChecked()));

      obj->http3_server_backend_.addPath(lpath);
    }
  }

  NODE_MODULE(webtransport, Http3Server::Init)

}
