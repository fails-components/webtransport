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

  Http3Server::Http3Server(Callback *callback,
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
        progress_(nullptr), objnum_(1)
  {
    epoll_server_.SetAsyncCallback(this);
  }

  Http3Server::~Http3Server()
  {
  }

  NAN_MODULE_INIT(Http3Server::Init)
  {
    v8::Local<v8::FunctionTemplate> tpl = Nan::New<v8::FunctionTemplate>(New);
    tpl->SetClassName(Nan::New("Http3Server").ToLocalChecked());
    tpl->InstanceTemplate()->SetInternalFieldCount(2);
    Nan::SetPrototypeMethod(tpl, "createHttp3Server", createHttp3Server);
    Nan::SetPrototypeMethod(tpl, "startServer", startServer);
    Nan::SetPrototypeMethod(tpl, "addPath", addPath);
    // Nan::SetPrototypeMethod(tpl, "getHandle", GetHandle);
    // Nan::SetPrototypeMethod(tpl, "getValue", GetValue);
    constructor().Reset(Nan::GetFunction(tpl).ToLocalChecked());
    Nan::Set(target, Nan::New("Http3Server").ToLocalChecked(),
             Nan::GetFunction(tpl).ToLocalChecked());

    // http3wtsessionvisitor
    v8::Local<v8::FunctionTemplate> tplwt = Nan::New<v8::FunctionTemplate>(Http3WTSession::New);
    tplwt->SetClassName(Nan::New("Http3WTSession").ToLocalChecked());
    tplwt->InstanceTemplate()->SetInternalFieldCount(1);
    Nan::SetPrototypeMethod(tplwt, "orderBidiStream", Http3WTSession::orderBidiStream);
    Nan::SetPrototypeMethod(tplwt, "orderUnidiStream", Http3WTSession::orderUnidiStream);
    Nan::SetPrototypeMethod(tplwt, "writeDatagram", Http3WTSession::writeDatagram);

    Http3WTSession::constructor().Reset(Nan::GetFunction(tplwt).ToLocalChecked());
    Nan::Set(target, Nan::New("Http3WTSession").ToLocalChecked(),
             Nan::GetFunction(tplwt).ToLocalChecked());

    // http3wtstreamvisitor
    v8::Local<v8::FunctionTemplate> tplwtsv = Nan::New<v8::FunctionTemplate>(Http3WTStreamVisitor::New);
    tplwtsv->SetClassName(Nan::New("Http3WTStreamVisitor").ToLocalChecked());
    tplwtsv->InstanceTemplate()->SetInternalFieldCount(1);
    Nan::SetPrototypeMethod(tplwtsv, "writeChunk", Http3WTStreamVisitor::writeChunk);
    Nan::SetPrototypeMethod(tplwtsv, "closeStream", Http3WTStreamVisitor::closeStream);
    Nan::SetPrototypeMethod(tplwtsv, "startReading", Http3WTStreamVisitor::startReading);
    Nan::SetPrototypeMethod(tplwtsv, "stopReading", Http3WTStreamVisitor::stopReading);

    Http3WTStreamVisitor::constructor().Reset(Nan::GetFunction(tplwtsv).ToLocalChecked());
    Nan::Set(target, Nan::New("Http3WTStreamVisitor").ToLocalChecked(),
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

  uint32_t Http3Server::getNewObjNum()
  {
    return objnum_++;
  }

  void Http3Server::informAboutStream(bool incom, bool bidir, uint32_t objnum, Http3WTStreamVisitor *stream)
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
    report.objnum = objnum;
    report.streamvisitor = stream;
    report.streamid = stream->getStreamId();
    if (progress_)
      progress_->Send(&report, 1);
  }

  void Http3Server::informStreamClosed(uint32_t objnum, uint32_t strid)
  {
    struct Http3ProgressReport report;
    report.type = Http3ProgressReport::StreamClosed;
    report.objnum = objnum;
    report.streamid = strid;
    if (progress_)
      progress_->Send(&report, 1);
  }

  void Http3Server::informAboutStreamRead(uint32_t objnum, uint32_t strid, std::string *data, bool fin)
  {
    struct Http3ProgressReport report;
    report.type = Http3ProgressReport::StreamRead;
    report.objnum = objnum;
    report.streamid = strid;
    report.para = data;
    report.fin = fin;
    if (progress_)
      progress_->Send(&report, 1);
  }

  void Http3Server::informAboutStreamWrite(uint32_t objnum, uint32_t strid, Nan::Persistent<v8::Object> *bufferhandle, bool success)
  {
    struct Http3ProgressReport report;
    report.type = Http3ProgressReport::StreamWrite;
    report.objnum = objnum;
    report.streamid = strid;
    report.bufferhandle = bufferhandle;
    report.success = success;
    if (progress_)
      progress_->Send(&report, 1);
  }

  void Http3Server::informDatagramReceived(uint32_t objnum, absl::string_view datagram)
  {
    struct Http3ProgressReport report;
    report.type = Http3ProgressReport::DatagramReceived;
    report.objnum = objnum;
    report.para = new std::string(datagram);
    if (progress_)
      progress_->Send(&report, 1);
  }

  void Http3Server::informDatagramSend(uint32_t objnum)
  {
    struct Http3ProgressReport report;
    report.type = Http3ProgressReport::DatagramSend;
    report.objnum = objnum;
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
    report.objnum = session->getObjNum();
    report.para = new std::string(path);
    if (progress_)
      progress_->Send(&report, 1);
  }

  void Http3Server::informSessionClosed(uint32_t objnum, WebTransportSessionError error_code,
                                        absl::string_view error_message)
  {
    struct Http3ProgressReport report;
    report.type = Http3ProgressReport::SessionClosed;
    report.objnum = objnum;
    report.para = new std::string(error_message);
    report.wtecode = error_code;
    if (progress_)
      progress_->Send(&report, 1);
  }

  void Http3Server::informSessionReady(uint32_t objnum)
  {
    struct Http3ProgressReport report;
    report.type = Http3ProgressReport::SessionReady;
    report.objnum = objnum;
    if (progress_)
      progress_->Send(&report, 1);
  }

  void Http3Server::freeData(char *data, void *hint)
  {
    // ok free data is actually using a string object
    std::string *sdata = static_cast<std::string *>(hint);
    delete sdata;
  }

  void Http3Server::processStream(bool incom, bool bidi, uint32_t objnum, Http3WTStreamVisitor *streamvisitor, uint32_t streamid)
  {

    HandleScope scope;

    auto obj = Http3WTStreamVisitor::NewInstance(streamvisitor);
    v8::Local<v8::String> purposeProp = Nan::New("purpose").ToLocalChecked();
    v8::Local<v8::String> purposeVal = Nan::New("Http3WTStreamVisitor").ToLocalChecked();
    v8::Local<v8::String> objProp = Nan::New("object").ToLocalChecked();

    v8::Local<v8::String> streamProp = Nan::New("streamid").ToLocalChecked();
    v8::Local<v8::Uint32> streamVal = Nan::New(streamid);

    v8::Local<v8::String> idProp = Nan::New("id").ToLocalChecked();
    v8::Local<v8::Uint32> id = Nan::New(objnum);

    v8::Local<v8::String> incomProp = Nan::New("incoming").ToLocalChecked();
    v8::Local<v8::Boolean> incomVal = Nan::New(incom);
    v8::Local<v8::String> bidiProp = Nan::New("bidirectional").ToLocalChecked();
    v8::Local<v8::Boolean> bidiVal = Nan::New(bidi);

    auto context = GetCurrentContext();
    v8::Local<v8::Object> retObj = Nan::New<v8::Object>();
    retObj->Set(context, purposeProp, purposeVal).FromJust();
    retObj->Set(context, objProp, obj).FromJust();
    retObj->Set(context, streamProp, streamVal).FromJust();
    retObj->Set(context, idProp, id).FromJust();
    retObj->Set(context, incomProp, incomVal).FromJust();
    retObj->Set(context, bidiProp, bidiVal).FromJust();

    v8::Local<v8::Value> argv[] = {retObj};
    callback->Call(1, argv);
  }

  void Http3Server::processStreamClosed(uint32_t objnum, uint32_t streamid)
  {
    HandleScope scope;
    v8::Local<v8::String> purposeProp = Nan::New("purpose").ToLocalChecked();
    v8::Local<v8::String> purposeVal = Nan::New("StreamClosed").ToLocalChecked();
    v8::Local<v8::String> idProp = Nan::New("id").ToLocalChecked();
    v8::Local<v8::Uint32> id = Nan::New(objnum);
    v8::Local<v8::String> streamProp = Nan::New("streamid").ToLocalChecked();
    v8::Local<v8::Uint32> streamVal = Nan::New(streamid);

    auto context = GetCurrentContext();
    v8::Local<v8::Object> retObj = Nan::New<v8::Object>();
    retObj->Set(context, purposeProp, purposeVal).FromJust();
    retObj->Set(context, idProp, id).FromJust();
    retObj->Set(context, streamProp, streamVal).FromJust();

    v8::Local<v8::Value> argv[] = {retObj};
    callback->Call(1, argv);
  }

  void Http3Server::processStreamRead(uint32_t objnum, uint32_t streamid, std::string *data, bool fin)
  {
    HandleScope scope;
    v8::Local<v8::String> purposeProp = Nan::New("purpose").ToLocalChecked();
    v8::Local<v8::String> purposeVal = Nan::New("StreamRead").ToLocalChecked();
    v8::Local<v8::String> idProp = Nan::New("id").ToLocalChecked();
    v8::Local<v8::Uint32> id = Nan::New(objnum);
    v8::Local<v8::String> streamProp = Nan::New("streamid").ToLocalChecked();
    v8::Local<v8::Uint32> streamVal = Nan::New(streamid);
    v8::Local<v8::String> finProp = Nan::New("fin").ToLocalChecked();
    v8::Local<v8::Boolean> finVal = Nan::New(fin);
    v8::Local<v8::String> dataProp = Nan::New("data").ToLocalChecked();

    v8::Local<v8::Object> dataVal = Nan::NewBuffer(&(*data)[0], data->length(),
                                                   freeData, static_cast<void *>(data))
                                        .ToLocalChecked();

    auto context = GetCurrentContext();
    v8::Local<v8::Object> retObj = Nan::New<v8::Object>();
    retObj->Set(context, purposeProp, purposeVal).FromJust();
    retObj->Set(context, idProp, id).FromJust();
    retObj->Set(context, streamProp, streamVal).FromJust();
    retObj->Set(context, finProp, finVal).FromJust();
    retObj->Set(context, dataProp, dataVal).FromJust();

    v8::Local<v8::Value> argv[] = {retObj};
    callback->Call(1, argv);
  }

  void Http3Server::processStreamWrite(uint32_t objnum, uint32_t strid, Nan::Persistent<v8::Object> *bufferhandle, bool success)
  {
    HandleScope scope;
    v8::Local<v8::String> purposeProp = Nan::New("purpose").ToLocalChecked();
    v8::Local<v8::String> purposeVal = Nan::New("StreamWrite").ToLocalChecked();
    v8::Local<v8::String> idProp = Nan::New("id").ToLocalChecked();
    v8::Local<v8::Uint32> id = Nan::New(objnum);
    v8::Local<v8::String> streamProp = Nan::New("streamid").ToLocalChecked();
    v8::Local<v8::Uint32> streamVal = Nan::New(strid);
    v8::Local<v8::String> successProp = Nan::New("success").ToLocalChecked();
    v8::Local<v8::Boolean> successVal = Nan::New(success);

    bufferhandle->Reset(); // release the outgoing buffer
    delete bufferhandle;   // free the handle object

    auto context = GetCurrentContext();
    v8::Local<v8::Object> retObj = Nan::New<v8::Object>();
    retObj->Set(context, purposeProp, purposeVal).FromJust();
    retObj->Set(context, idProp, id).FromJust();
    retObj->Set(context, streamProp, streamVal).FromJust();
    retObj->Set(context, successProp, successVal).FromJust();

    v8::Local<v8::Value> argv[] = {retObj};
    callback->Call(1, argv);
  }

  void Http3Server::processDatagramBufferFree(Nan::Persistent<v8::Object> *bufferhandle)
  {
    bufferhandle->Reset(); // release the outgoing buffer
    delete bufferhandle;   // free the handle object
  }

  void Http3Server::processDatagramReceived(uint32_t objnum, std::string *datagram)
  {
    HandleScope scope;
    v8::Local<v8::String> purposeProp = Nan::New("purpose").ToLocalChecked();
    v8::Local<v8::String> purposeVal = Nan::New("DatagramReceived").ToLocalChecked();
    v8::Local<v8::String> idProp = Nan::New("id").ToLocalChecked();
    v8::Local<v8::Uint32> id = Nan::New(objnum);
    v8::Local<v8::String> datagramProp = Nan::New("datagram").ToLocalChecked();
    v8::Local<v8::Object> datagramVal = Nan::NewBuffer(&(*datagram)[0], datagram->length(),
                                                       freeData, static_cast<void *>(datagram))
                                            .ToLocalChecked();

    auto context = GetCurrentContext();
    v8::Local<v8::Object> retObj = Nan::New<v8::Object>();
    retObj->Set(context, purposeProp, purposeVal).FromJust();
    retObj->Set(context, idProp, id).FromJust();
    retObj->Set(context, datagramProp, datagramVal).FromJust();

    v8::Local<v8::Value> argv[] = {retObj};
    callback->Call(1, argv);
  }

  void Http3Server::processDatagramSend(uint32_t objnum)
  {
    HandleScope scope;
    v8::Local<v8::String> purposeProp = Nan::New("purpose").ToLocalChecked();
    v8::Local<v8::String> purposeVal = Nan::New("DatagramSend").ToLocalChecked();
    v8::Local<v8::String> idProp = Nan::New("id").ToLocalChecked();
    v8::Local<v8::Uint32> id = Nan::New(objnum);

    auto context = GetCurrentContext();
    v8::Local<v8::Object> retObj = Nan::New<v8::Object>();
    retObj->Set(context, purposeProp, purposeVal).FromJust();
    retObj->Set(context, idProp, id).FromJust();

    v8::Local<v8::Value> argv[] = {retObj};
    callback->Call(1, argv);
  }

  void Http3Server::processNewSession(Http3WTSession *session, uint32_t objnum, const std::string &path)
  {
    HandleScope scope;

    auto obj = Http3WTSession::NewInstance(session);
    v8::Local<v8::String> purposeProp = Nan::New("purpose").ToLocalChecked();
    v8::Local<v8::String> purposeVal = Nan::New("Http3WTSessionVisitor").ToLocalChecked();
    v8::Local<v8::String> objProp = Nan::New("object").ToLocalChecked();

    v8::Local<v8::String> pathProp = Nan::New("path").ToLocalChecked();
    v8::Local<v8::String> stringPath = Nan::New(path).ToLocalChecked();

    v8::Local<v8::String> idProp = Nan::New("id").ToLocalChecked();
    v8::Local<v8::Uint32> id = Nan::New(objnum);

    auto context = GetCurrentContext();
    v8::Local<v8::Object> retObj = Nan::New<v8::Object>();
    retObj->Set(context, purposeProp, purposeVal).FromJust();
    retObj->Set(context, objProp, obj).FromJust();
    retObj->Set(context, pathProp, stringPath).FromJust();
    retObj->Set(context, idProp, id).FromJust();

    v8::Local<v8::Value> argv[] = {retObj};
    callback->Call(1, argv);
  }

  void Http3Server::processSessionReady(uint32_t objnum)
  {
    HandleScope scope;
    v8::Local<v8::String> purposeProp = Nan::New("purpose").ToLocalChecked();
    v8::Local<v8::String> purposeVal = Nan::New("SessionReady").ToLocalChecked();
    v8::Local<v8::String> idProp = Nan::New("id").ToLocalChecked();
    v8::Local<v8::Uint32> id = Nan::New(objnum);

    auto context = GetCurrentContext();
    v8::Local<v8::Object> retObj = Nan::New<v8::Object>();
    retObj->Set(context, purposeProp, purposeVal).FromJust();
    retObj->Set(context, idProp, id).FromJust();

    v8::Local<v8::Value> argv[] = {retObj};
    callback->Call(1, argv);
  }

  void Http3Server::processSessionClose(uint32_t objnum, uint32_t errorcode, const std::string &error)
  {
    HandleScope scope;
    v8::Local<v8::String> purposeProp = Nan::New("purpose").ToLocalChecked();
    v8::Local<v8::String> purposeVal = Nan::New("SessionClose").ToLocalChecked();
    v8::Local<v8::String> idProp = Nan::New("id").ToLocalChecked();
    v8::Local<v8::Uint32> id = Nan::New(objnum);
    v8::Local<v8::String> errorProp = Nan::New("error").ToLocalChecked();
    v8::Local<v8::String> errorVal = Nan::New(error).ToLocalChecked();
    v8::Local<v8::String> errorcProp = Nan::New("errorcode").ToLocalChecked();
    v8::Local<v8::Uint32> errorcVal = Nan::New(errorcode);

    auto context = GetCurrentContext();
    v8::Local<v8::Object> retObj = Nan::New<v8::Object>();
    retObj->Set(context, purposeProp, purposeVal).FromJust();
    retObj->Set(context, idProp, id).FromJust();
    retObj->Set(context, errorProp, errorVal).FromJust();
    retObj->Set(context, errorcProp, errorcVal).FromJust();

    v8::Local<v8::Value> argv[] = {retObj};
    callback->Call(1, argv);
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
        processNewSession(cur.session, cur.objnum, *cur.para);
      }
      break;
      case Http3ProgressReport::SessionReady:
      {
        processSessionReady(cur.objnum);
      }
      break;
      case Http3ProgressReport::SessionClosed:
      {
        processSessionClose(cur.objnum, cur.wtecode, *cur.para);
      }
      break;
      case Http3ProgressReport::IncomBiDiStream:
      {
        processStream(true, true, cur.objnum, cur.streamvisitor, cur.streamid);
      }
      break;
      case Http3ProgressReport::IncomUniDiStream:
      {
        processStream(true, false, cur.objnum, cur.streamvisitor, cur.streamid);
      }
      break;
      case Http3ProgressReport::OutgoBiDiStream:
      {
        processStream(false, true, cur.objnum, cur.streamvisitor, cur.streamid);
      }
      break;
      case Http3ProgressReport::OutgoUniDiStream:
      {
        processStream(false, false, cur.objnum, cur.streamvisitor, cur.streamid);
      }
      break;
      case Http3ProgressReport::StreamClosed:
      {
        processStreamClosed(cur.objnum, cur.streamid);
      }
      break;
      case Http3ProgressReport::StreamRead:
      {
        processStreamRead(cur.objnum, cur.streamid, cur.para, cur.fin);
        cur.para = nullptr; // take ownership of the data
      }
      break;
      case Http3ProgressReport::StreamWrite:
      {
        processStreamWrite(cur.objnum, cur.streamid, cur.bufferhandle, cur.success);
      }
      break;
      case Http3ProgressReport::DatagramReceived:
      {
        processDatagramReceived(cur.objnum, cur.para);
        cur.para = nullptr; // take ownership of the data
      }
      break;
      case Http3ProgressReport::DatagramSend:
      {
        processDatagramSend(cur.objnum);
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
      if (info[1]->IsUndefined() /*|| info[1]->IsFunction()*/)
      {
        return Nan::ThrowError("Callback not passed to Http3Server internal");
      }
      if (!info[0]->IsUndefined())
      {
        v8::Local<v8::Context> context = info.GetIsolate()->GetCurrentContext();
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

        Callback *callback = new Callback(To<v8::Function>(info[1]).ToLocalChecked());
        Http3Server *object = new Http3Server(callback, host, port, std::move(proofsource), secret.c_str());
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
