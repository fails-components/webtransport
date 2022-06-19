// Copyright (c) 2022 Marten Richter or other contributers (see commit). All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

// portions taken from libquiche, original copyright, see LICENSE.chromium
// Copyright (c)  The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "src/http3server.h"
#include "src/http3client.h"
#include "src/http3eventloop.h"
#include "src/http3dispatcher.h"
#include "src/http3wtsessionvisitor.h"
#include "quiche/quic/tools/quic_simple_crypto_server_stream_helper.h"
#include "quiche/quic/core/crypto/proof_source_x509.h"
#include "quiche/common/platform/api/quiche_reference_counted.h"

using namespace Nan;

namespace quic
{

  const size_t kNumSessionsToCreatePerSocketEvent = 16;

  Http3EventLoop::Http3EventLoop(Callback *cbeventloop, Callback *cbtransport, Callback *cbstream, Callback *cbsession)
      : AsyncProgressQueueWorker(cbeventloop), cbtransport_(cbtransport), 
        progress_(nullptr), cbstream_(cbstream), cbsession_(cbsession),
        scheduled_actions_alarm_(quic_event_loop_.GetAlarmFactory()->CreateAlarm(this))
  {
  }

  Http3EventLoop::~Http3EventLoop()
  {
    printf("Destructor eventloop\n");
    delete cbstream_;
    delete cbsession_;
    delete cbtransport_;
  }

  NAN_MODULE_INIT(Http3EventLoop::Init)
  {
    v8::Local<v8::FunctionTemplate> tpl = Nan::New<v8::FunctionTemplate>(Http3EventLoop::New);
    tpl->SetClassName(Nan::New("Http3EventLoop").ToLocalChecked());
    tpl->InstanceTemplate()->SetInternalFieldCount(2);
    Nan::SetPrototypeMethod(tpl, "startEventLoop", Http3EventLoop::startEventLoop);
    Nan::SetPrototypeMethod(tpl, "shutDownEventLoop", Http3EventLoop::shutDownEventLoop);
    Http3EventLoop::constructor().Reset(Nan::GetFunction(tpl).ToLocalChecked());
    Nan::Set(target, Nan::New("Http3EventLoop").ToLocalChecked(),
             Nan::GetFunction(tpl).ToLocalChecked());

    v8::Local<v8::FunctionTemplate> tplsrv = Nan::New<v8::FunctionTemplate>(Http3Server::New);
    tplsrv->SetClassName(Nan::New("Http3WebTransportServer").ToLocalChecked());
    tplsrv->InstanceTemplate()->SetInternalFieldCount(2);
    Nan::SetPrototypeMethod(tplsrv, "startServer", Http3Server::startServer);
    Nan::SetPrototypeMethod(tplsrv, "stopServer", Http3Server::stopServer);
    Nan::SetPrototypeMethod(tplsrv, "addPath", Http3Server::addPath);
    Http3Server::constructor().Reset(Nan::GetFunction(tplsrv).ToLocalChecked());
    Nan::Set(target, Nan::New("Http3WebTransportServer").ToLocalChecked(),
             Nan::GetFunction(tplsrv).ToLocalChecked());

    v8::Local<v8::FunctionTemplate> tplcl = Nan::New<v8::FunctionTemplate>(Http3Client::New);
    tplcl->SetClassName(Nan::New("Http3WebTransportClient").ToLocalChecked());
    tplcl->InstanceTemplate()->SetInternalFieldCount(2);
    Nan::SetPrototypeMethod(tplcl, "openWTSession", Http3Client::openWTSession);
    Nan::SetPrototypeMethod(tplcl, "closeClient", Http3Client::closeClient);
    Http3Client::constructor().Reset(Nan::GetFunction(tplcl).ToLocalChecked());
    Nan::Set(target, Nan::New("Http3WebTransportClient").ToLocalChecked(),
             Nan::GetFunction(tplcl).ToLocalChecked());

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

  void Http3EventLoop::Destroy()
  {
    printf("eventloop destroy called\n");
  }

  void Http3EventLoop::Execute(const AsyncProgressQueueWorker::ExecutionProgress &progress)
  {
    progress_ = &progress;
    // main event loop
    loop_running_ = true;
    while (loop_running_)
    {
      quic_event_loop_.RunEventLoopOnce(QuicTime::Delta::Infinite()); // figure out the unit
    }
    printf("event loop exited\n");
    progress_ = nullptr;
    Unref();
  }

  void Http3EventLoop::OnAlarm()
  {
    ExecuteScheduledActions();
  }

  void Http3EventLoop::ExecuteScheduledActions()
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

  void Http3EventLoop::Schedule(std::function<void()> action)
  {
    // QUICHE_DCHECK(!quit_.HasBeenNotified());
    QuicWriterMutexLock lock(&scheduled_actions_lock_);
    scheduled_actions_.push_back(std::move(action));
    scheduled_actions_alarm_->Set(QuicTime::Zero());
    // epoll_server_.TriggerAsync();
  }

  void Http3EventLoop::informAboutStream(bool incom, bool bidir, Http3WTSession *sessionobj, Http3WTStream *stream)
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

  void Http3EventLoop::informStreamClosed(Http3WTStream *streamobj, WebTransportStreamError code)
  {
    struct Http3ProgressReport report;
    report.type = Http3ProgressReport::StreamClosed;
    report.streamobj = streamobj;
    report.wtscode = code;
    if (progress_)
      progress_->Send(&report, 1);
  }

  void Http3EventLoop::informAboutStreamRead(Http3WTStream *streamobj, std::string *data, bool fin)
  {
    struct Http3ProgressReport report;
    report.type = Http3ProgressReport::StreamRead;
    report.streamobj = streamobj;
    report.para = data;
    report.fin = fin;
    if (progress_)
      progress_->Send(&report, 1);
  }

  void Http3EventLoop::informAboutStreamWrite(Http3WTStream *streamobj, Nan::Persistent<v8::Object> *bufferhandle, bool success)
  {
    struct Http3ProgressReport report;
    report.type = Http3ProgressReport::StreamWrite;
    report.streamobj = streamobj;
    report.bufferhandle = bufferhandle;
    report.success = success;
    if (progress_)
      progress_->Send(&report, 1);
  }

  void Http3EventLoop::informAboutStreamReset(Http3WTStream *streamobj)
  {
    struct Http3ProgressReport report;
    report.type = Http3ProgressReport::StreamReset;
    report.streamobj = streamobj;
    if (progress_)
      progress_->Send(&report, 1);
  }

  void Http3EventLoop::informDatagramReceived(Http3WTSession *sessionobj, absl::string_view datagram)
  {
    struct Http3ProgressReport report;
    report.type = Http3ProgressReport::DatagramReceived;
    report.sessionobj = sessionobj;
    report.para = new std::string(datagram);
    if (progress_)
      progress_->Send(&report, 1);
  }

  void Http3EventLoop::informDatagramSend(Http3WTSession *sessionobj)
  {
    struct Http3ProgressReport report;
    report.type = Http3ProgressReport::DatagramSend;
    report.sessionobj = sessionobj;
    if (progress_)
      progress_->Send(&report, 1);
  }

  void Http3EventLoop::informDatagramBufferFree(Nan::Persistent<v8::Object> *bufferhandle)
  {
    struct Http3ProgressReport report;
    report.type = Http3ProgressReport::DatagramBufferFree;
    report.bufferhandle = bufferhandle;

    if (progress_)
      progress_->Send(&report, 1);
  }

  void Http3EventLoop::informUnref(LifetimeHelper * obj)
  {
    struct Http3ProgressReport report;
    report.type = Http3ProgressReport::Unref;
    report.obj = obj;

    if (progress_)
      progress_->Send(&report, 1);
  }

  void Http3EventLoop::informAboutClientConnected(Http3Client *client, bool success)
  {
    struct Http3ProgressReport report;
    report.type = Http3ProgressReport::ClientConnected;
    report.clientobj = client;
    report.success = success;
    if (progress_)
      progress_->Send(&report, 1);
  }

  void Http3EventLoop::informClientWebtransportSupport(Http3Client *client)
  {
    struct Http3ProgressReport report;
    report.type = Http3ProgressReport::ClientWebTransportSupport;
    report.clientobj = client;
    if (progress_)
      progress_->Send(&report, 1);
  }

  void Http3EventLoop::informAboutNewSession(Http3Server *server, Http3WTSession *session, absl::string_view path)
  {
    struct Http3ProgressReport report;
    report.type = Http3ProgressReport::NewSession;
    report.serverobj = server;
    report.session = session;
    report.para = new std::string(path);
    if (progress_)
      progress_->Send(&report, 1);
  }

  void Http3EventLoop::informNewClientSession(Http3Client *client, Http3WTSession *session)
  {
    struct Http3ProgressReport report;
    report.type = Http3ProgressReport::NewClientSession;
    report.clientobj = client;
    report.session = session;
    if (progress_)
      progress_->Send(&report, 1);
  }

  void Http3EventLoop::informSessionClosed(Http3WTSession *sessionobj, WebTransportSessionError error_code,
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

  void Http3EventLoop::informSessionReady(Http3WTSession *sessionobj)
  {
    struct Http3ProgressReport report;
    report.type = Http3ProgressReport::SessionReady;
    report.sessionobj = sessionobj;
    if (progress_)
      progress_->Send(&report, 1);
  }

  void Http3EventLoop::freeData(char *data, void *hint)
  {
    // ok free data is actually using a string object
    std::string *sdata = static_cast<std::string *>(hint);
    delete sdata;
  }

  void Http3EventLoop::processClientConnected(Http3Client * clientobj, bool success)
  {
    HandleScope scope;

    v8::Local<v8::String> purposeProp = Nan::New("purpose").ToLocalChecked();
    v8::Local<v8::String> purposeVal = Nan::New("ClientConnected").ToLocalChecked();
   
    v8::Local<v8::String> successProp = Nan::New("success").ToLocalChecked();
    v8::Local<v8::Boolean> successVal = Nan::New(success);

    v8::Local<v8::String> objProp = Nan::New("object").ToLocalChecked();
    v8::Local<v8::Object> objVal = clientobj->handle();

    auto context = GetCurrentContext();
    v8::Local<v8::Object> retObj = Nan::New<v8::Object>();
    retObj->Set(context, purposeProp, purposeVal).FromJust();
    retObj->Set(context, successProp, successVal).FromJust();
    retObj->Set(context, objProp, objVal).FromJust();

    v8::Local<v8::Value> argv[] = {retObj};
    Nan::Call(*cbtransport_, 1, argv);

  }

  void Http3EventLoop::processClientWebtransportSupport(Http3Client *clientobj)
  {
    HandleScope scope;

    v8::Local<v8::String> purposeProp = Nan::New("purpose").ToLocalChecked();
    v8::Local<v8::String> purposeVal = Nan::New("ClientWebtransportSupport").ToLocalChecked();
   
    v8::Local<v8::String> objProp = Nan::New("object").ToLocalChecked();
    v8::Local<v8::Object> objVal = clientobj->handle();

    auto context = GetCurrentContext();
    v8::Local<v8::Object> retObj = Nan::New<v8::Object>();
    retObj->Set(context, purposeProp, purposeVal).FromJust();
    retObj->Set(context, objProp, objVal).FromJust();

    v8::Local<v8::Value> argv[] = {retObj};
    Nan::Call(*cbtransport_, 1, argv);

  }

  void Http3EventLoop::processStream(bool incom, bool bidi, Http3WTSession *sessionobj, Http3WTStream *stream)
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

  void Http3EventLoop::processStreamClosed(Http3WTStream *streamobj, WebTransportStreamError code)
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

  void Http3EventLoop::processStreamRead(Http3WTStream *streamobj, std::string *data, bool fin)
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

  void Http3EventLoop::processStreamWrite(Http3WTStream *streamobj, Nan::Persistent<v8::Object> *bufferhandle, bool success)
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

  void Http3EventLoop::processStreamReset(Http3WTStream *streamobj)
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

  void Http3EventLoop::processDatagramBufferFree(Nan::Persistent<v8::Object> *bufferhandle)
  {
    bufferhandle->Reset(); // release the outgoing buffer
    delete bufferhandle;   // free the handle object
  }

  void Http3EventLoop::processDatagramReceived(Http3WTSession *sessionobj, std::string *datagram)
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

  void Http3EventLoop::processDatagramSend(Http3WTSession *sessionobj)
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

  void Http3EventLoop::processNewSession(Http3Server *serverobj, Http3WTSession *session, const std::string &path)
  {
    HandleScope scope;

    auto sessionobj = Http3WTSession::NewInstance(session);
    v8::Local<v8::String> purposeProp = Nan::New("purpose").ToLocalChecked();
    v8::Local<v8::String> purposeVal = Nan::New("Http3WTSessionVisitor").ToLocalChecked();
    v8::Local<v8::String> sessProp = Nan::New("session").ToLocalChecked();

    v8::Local<v8::String> pathProp = Nan::New("path").ToLocalChecked();
    v8::Local<v8::String> stringPath = Nan::New(path).ToLocalChecked();

    v8::Local<v8::String> objProp = Nan::New("object").ToLocalChecked();
    v8::Local<v8::Object> objVal = serverobj->handle();

    auto context = GetCurrentContext();
    v8::Local<v8::Object> retObj = Nan::New<v8::Object>();
    retObj->Set(context, purposeProp, purposeVal).FromJust();
    retObj->Set(context, sessProp, sessionobj).FromJust();
    retObj->Set(context, pathProp, stringPath).FromJust();
    retObj->Set(context, objProp, objVal).FromJust();

    v8::Local<v8::Value> argv[] = {retObj};
    Nan::Call(*cbtransport_, 1, argv);
  }

  
  void  Http3EventLoop::processNewClientSession(Http3Client *clientobj, Http3WTSession *session)
  {
    HandleScope scope;

    
    v8::Local<v8::String> purposeProp = Nan::New("purpose").ToLocalChecked();
    v8::Local<v8::String> purposeVal = Nan::New("Http3WTSessionVisitor").ToLocalChecked();
    v8::Local<v8::String> sessProp = Nan::New("session").ToLocalChecked();


    v8::Local<v8::String> objProp = Nan::New("object").ToLocalChecked();
    v8::Local<v8::Object> objVal = clientobj->handle();

    auto context = GetCurrentContext();
    v8::Local<v8::Object> retObj = Nan::New<v8::Object>();
    retObj->Set(context, purposeProp, purposeVal).FromJust();
    if (session != nullptr) {
      auto sessionobj = Http3WTSession::NewInstance(session);
      retObj->Set(context, sessProp, sessionobj).FromJust();
    }
    retObj->Set(context, objProp, objVal).FromJust();

    v8::Local<v8::Value> argv[] = {retObj};
    Nan::Call(*cbtransport_, 1, argv);
  }

  void Http3EventLoop::processSessionReady(Http3WTSession *sessionobj)
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

  void Http3EventLoop::processSessionClose(Http3WTSession *sessionobj, uint32_t errorcode, const std::string &error)
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

  void Http3EventLoop::HandleProgressCallback(const Http3ProgressReport *data, size_t count)
  {
    for (int i = 0; i < count; i++)
    {
      Http3ProgressReport cur = data[i];
      switch (cur.type)
      {
      case Http3ProgressReport::ClientConnected:
      {
        processClientConnected(cur.clientobj, cur.success);
      }
      break;
      case Http3ProgressReport::ClientWebTransportSupport:
      {
        processClientWebtransportSupport(cur.clientobj);
      } break;
      case Http3ProgressReport::NewClientSession:
      {
        processNewClientSession(cur.clientobj, cur.session);
      }
      break;
      case Http3ProgressReport::NewSession:
      {
        processNewSession(cur.serverobj, cur.session, *cur.para);
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
      case Http3ProgressReport::Unref:
      {
        cur.obj->doUnref();
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

  NAN_METHOD(Http3EventLoop::New)
  {
    if (info.IsConstructCall())
    {
      v8::Isolate *isolate = info.GetIsolate();

      Callback *cbeventloop = nullptr;
      Callback *cbtransport = nullptr;
      Callback *cbstream = nullptr;
      Callback *cbsession = nullptr;

      v8::Local<v8::Context> context = info.GetIsolate()->GetCurrentContext();
      if (!info[0]->IsUndefined() /*|| info[1]->IsFunction()*/)
      {
        v8::MaybeLocal<v8::Object> obj = info[0]->ToObject(context);
        v8::Local<v8::String> etProp = Nan::New("eventloopCallback").ToLocalChecked();
        v8::Local<v8::String> tpProp = Nan::New("transportCallback").ToLocalChecked();
        v8::Local<v8::String> strProp = Nan::New("streamCallback").ToLocalChecked();
        v8::Local<v8::String> sessProp = Nan::New("sessionCallback").ToLocalChecked();
        if (obj.IsEmpty())
          return Nan::ThrowError("No callback obj for Http3Transport");
        v8::Local<v8::Object> lobj = obj.ToLocalChecked();

        if (Nan::HasOwnProperty(lobj, etProp).FromJust() && !Nan::Get(lobj, etProp).IsEmpty())
        {
          cbeventloop = new Callback(To<v8::Function>(Nan::Get(lobj, etProp).ToLocalChecked()).ToLocalChecked());
        }
        else
          return Nan::ThrowError("No eventloop callback");

        if (Nan::HasOwnProperty(lobj, tpProp).FromJust() && !Nan::Get(lobj, tpProp).IsEmpty())
        {
          cbtransport = new Callback(To<v8::Function>(Nan::Get(lobj, tpProp).ToLocalChecked()).ToLocalChecked());
        }
        else
          return Nan::ThrowError("No transport callback");

        if (Nan::HasOwnProperty(lobj, strProp).FromJust() && !Nan::Get(lobj, strProp).IsEmpty())
        {
          cbstream = new Callback(To<v8::Function>(Nan::Get(lobj, strProp).ToLocalChecked()).ToLocalChecked());
        }
        else
          return Nan::ThrowError("No stream callback");

        if (Nan::HasOwnProperty(lobj, sessProp).FromJust() && !Nan::Get(lobj, sessProp).IsEmpty())
        {
          cbsession = new Callback(To<v8::Function>(Nan::Get(lobj, sessProp).ToLocalChecked()).ToLocalChecked());
        }
        else
          return Nan::ThrowError("No session callback");
      }
      else
        return Nan::ThrowError("Callback not passed to Http3EventLoop internal");

      Http3EventLoop *object = new Http3EventLoop(cbeventloop, cbtransport, cbstream, cbsession);
      object->Wrap(info.This());
      info.GetReturnValue().Set(info.This());
    }
    else
    {
      const int argc = 1;
      v8::Local<v8::Value> argv[argc] = {info[0]};
      v8::Local<v8::Function> cons = Nan::New(constructor());
      auto instance = Nan::NewInstance(cons, argc, argv);
      if (!instance.IsEmpty())
        info.GetReturnValue().Set(instance.ToLocalChecked());
    }
  }

  bool Http3EventLoop::startEventLoopInt()
  {

    Ref();                               // do not garbage collect
    // epoll_server_.set_timeout_in_us(-1); // negative values would mean wait forever
    Nan::AsyncQueueWorker(this);
    return true;
  }

  NAN_METHOD(Http3EventLoop::startEventLoop)
  {
    Http3EventLoop *obj = Nan::ObjectWrap::Unwrap<Http3EventLoop>(info.Holder());
    // got the object we can now start the server
   

    if (!obj->startEventLoopInt())
    {
      return Nan::ThrowError("startEventLoopInt");
    }
  }

  bool Http3EventLoop::shutDownEventLoopInt()
  {
        // FIXME kill the uv loop
    std::function<void()> task = [this]()
    {
      loop_running_ = false;
    };
    Schedule(task);
    return true;
  }

  NAN_METHOD(Http3EventLoop::shutDownEventLoop)
  {
     Http3EventLoop *obj = Nan::ObjectWrap::Unwrap<Http3EventLoop>(info.Holder());
    // got the object we can now start the server

    if (!obj->shutDownEventLoopInt())
    {
      return Nan::ThrowError("shutDownEventLoopInt");
    }
  }

  NODE_MODULE(webtransport, Http3EventLoop::Init)

}
