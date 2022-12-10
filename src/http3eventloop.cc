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
#include "quiche/quic/core/quic_default_clock.h"
#include "quiche/quic/bindings/quic_libevent.h"

using namespace Napi;

namespace quic
{

#ifdef WIN32

  bool initSockets();
  bool destroySockets();

#endif

  // hack since the header is faulty
  QUICHE_NO_EXPORT QuicEventLoopFactory *GetDefaultEventLoop();

  static const int kErrorBufferSize = 256;

  const size_t kNumSessionsToCreatePerSocketEvent = 16;

  Http3EventLoop::~Http3EventLoop()
  {
    printf("Destructor eventloop\n");
#ifdef WIN32
    destroySockets();
#endif
  }

  void Http3EventLoop::Init(Napi::Env env, Napi::Object exports)
  {
    Napi::Function tpl =
        DefineClass(env, "Http3EventLoop",
                    {InstanceMethod<&Http3EventLoop::startEventLoop>("startEventLoop",
                                                                     static_cast<napi_property_attributes>(napi_writable | napi_configurable)),
                     InstanceMethod<&Http3EventLoop::shutDownEventLoop>("shutDownEventLoop",
                                                                        static_cast<napi_property_attributes>(napi_writable | napi_configurable))});
    exports.Set("Http3EventLoop", tpl);

    Http3Constructors *constr = new Http3Constructors();

    Http3ServerJS::InitExports(env, exports);
    Http3ClientJS::InitExports(env, exports);
    Http3WTSessionJS::InitExports(env, exports, constr);
    Http3WTStreamJS::InitExports(env, exports, constr);
    Napi::ObjectReference *exportref = new Napi::ObjectReference();

    env.SetInstanceData<Http3Constructors>(constr);
  }

  void Http3EventLoop::Destroy()
  {
    printf("eventloop destroy called\n");
    cbstream_.Unref();
    cbsession_.Unref();
    cbtransport_.Unref();
  }

  void Http3EventLoop::Execute(const AsyncProgressQueueWorker<Http3ProgressReport>::ExecutionProgress &progress)
  {
    progress_ = &progress;
    // main event loop
    loop_running_ = true;
    while (loop_running_)
    {
      // Note QuicTime::Delta::Infinite() causes a busy loop.
      quic_event_loop_->RunEventLoopOnce(QuicTime::Delta::FromSeconds(5));
      ExecuteScheduledActions();
    }
    printf("event loop exited\n");
    progress_ = nullptr;
    Unref();
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
    {
      QuicWriterMutexLock lock(&scheduled_actions_lock_);
      scheduled_actions_.push_back(std::move(action));
    }
    dynamic_cast<LibeventQuicEventLoop *>(quic_event_loop_.get())->WakeUp();
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

  void Http3EventLoop::informStreamRecvSignal(Http3WTStream *streamobj, WebTransportStreamError error_code, NetworkTask task)
  {
    struct Http3ProgressReport report;
    report.type = Http3ProgressReport::StreamRecvSignal;
    report.streamobj = streamobj;
    report.wtscode = error_code;
    report.nettask = task;
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

  void Http3EventLoop::informAboutStreamWrite(Http3WTStream *streamobj, Napi::ObjectReference *bufferhandle, bool success)
  {
    struct Http3ProgressReport report;
    report.type = Http3ProgressReport::StreamWrite;
    report.streamobj = streamobj;
    report.bufferhandle = bufferhandle;
    report.success = success;
    if (progress_)
      progress_->Send(&report, 1);
  }

  void Http3EventLoop::informAboutStreamNetworkFinish(Http3WTStream *streamobj, NetworkTask task)
  {
    struct Http3ProgressReport report;
    report.type = Http3ProgressReport::StreamNetworkFinish;
    report.streamobj = streamobj;
    report.nettask = task;
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

  void Http3EventLoop::informDatagramBufferFree(Napi::ObjectReference *bufferhandle)
  {
    struct Http3ProgressReport report;
    report.type = Http3ProgressReport::DatagramBufferFree;
    report.bufferhandle = bufferhandle;

    if (progress_)
      progress_->Send(&report, 1);
  }

  void Http3EventLoop::informUnref(LifetimeHelper *obj)
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

  void Http3EventLoop::informAboutNewSessionRequest(Http3Server *server, WebTransportSession *session, spdy::Http2HeaderBlock *reqheadcopy, WebTransportRespPromisePtr promise)
  {
    struct Http3ProgressReport report;
    report.type = Http3ProgressReport::NewSessionRequest;
    report.webtsession = session;
    report.serverobj = server;
    report.headerblock = reqheadcopy;
    report.promise = new WebTransportRespPromisePtr(promise);
    if (progress_)
      progress_->Send(&report, 1);
  }

  void Http3EventLoop::informAboutNewSession(Http3Server *server, Http3WTSession *session, absl::string_view path, Napi::Reference<Napi::Value> *header)
  {
    struct Http3ProgressReport report;
    report.type = Http3ProgressReport::NewSession;
    report.serverobj = server;
    report.session = session;
    report.header = header;
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

  void Http3EventLoop::informServerStatus(Http3Server *serverobj, NetworkStatus status, ServerStatusDetails *details)
  {
    struct Http3ProgressReport report;
    report.type = Http3ProgressReport::ServerStatus;
    report.serverobj = serverobj;
    report.status = status;
    report.details = details;
    if (progress_)
      progress_->Send(&report, 1);
  }

  void Http3EventLoop::freeData(Napi::Env env, void *data, std::string *hint)
  {
    // ok free data is actually using a string object
    delete hint;
  }

  void Http3EventLoop::processClientConnected(Http3Client *clientobj, bool success)
  {
    if (!checkQw())
      return;
    HandleScope scope(qw_->Env());
    auto client = clientobj->getJS();

    Napi::Object objVal = client->Value();

    Napi::Object retObj = Napi::Object::New(qw_->Env());
    retObj.Set("purpose", "ClientConnected");
    retObj.Set("success", success);
    retObj.Set("object", objVal);

    cbtransport_.Call({retObj});
  }

  void Http3EventLoop::processClientWebtransportSupport(Http3Client *clientobj)
  {
    if (!checkQw())
      return;
    HandleScope scope(qw_->Env());

    auto client = clientobj->getJS();
    Napi::Object objVal = client->Value();

    Napi::Object retObj = Napi::Object::New(qw_->Env());
    retObj.Set("purpose", "ClientWebtransportSupport");
    retObj.Set("object", objVal);

    cbtransport_.Call({retObj});
  }

  void Http3EventLoop::processStream(bool incom, bool bidi, Http3WTSession *sessionobj, Http3WTStream *stream)
  {
    if (!checkQw())
      return;
    HandleScope scope(qw_->Env());
    Http3Constructors *constr = qw_->Env().GetInstanceData<Http3Constructors>();
    Napi::Object strobj = constr->stream.New({});
    Http3WTStreamJS *strjs = Napi::ObjectWrap<Http3WTStreamJS>::Unwrap(strobj);
    strjs->setObj(stream);
    if (!stream->gone()) strjs->Ref();
    stream->setJS(strjs);

    Napi::Object objVal = sessionobj->getJS()->Value();

    Napi::Object retObj = Napi::Object::New(qw_->Env());
    retObj.Set("purpose", "Http3WTStreamVisitor");
    retObj.Set("stream", strobj);
    retObj.Set("incoming", incom);
    retObj.Set("bidirectional", bidi);
    retObj.Set("object", objVal);

    cbsession_.Call({retObj});
  }

  void Http3EventLoop::processStreamRecvSignal(Http3WTStream *streamobj, WebTransportStreamError error_code, NetworkTask task)
  {
    if (!checkQw())
      return;
    HandleScope scope(qw_->Env());
    auto stream = streamobj->getJS();
    if (!stream)
      return;
    Napi::Object objVal = stream->Value();

    std::string nettaskstr;
    switch (task)
    {
    case NetworkTask::resetStream:
    {
      nettaskstr = "resetStream";
    }
    break;
    case NetworkTask::stopSending:
    {
      nettaskstr = "stopSending";
    }
    break;
    case NetworkTask::streamFinal:
    {
      nettaskstr = "streamFinal";
    }
    break;
    default:
      return;
    };

    Napi::Object retObj = Napi::Object::New(qw_->Env());
    retObj.Set("purpose", "StreamRecvSignal");
    retObj.Set("code", error_code);
    retObj.Set("object", objVal);
    retObj.Set("nettask", nettaskstr);

    cbstream_.Call({retObj});
  }

  void Http3EventLoop::processStreamRead(Http3WTStream *streamobj, std::string *data, bool fin)
  {
    if (!checkQw())
      return;
    HandleScope scope(qw_->Env());

    Napi::Object dataVal =
        Napi::Uint8Array::New(qw_->Env(),
                              data->length(),
                              Napi::ArrayBuffer::New(qw_->Env(), &(*data)[0], data->length(),
                                                     freeData, data),
                              0);

    auto stream = streamobj->getJS();
    if (!stream)
      return;
    Napi::Object objVal = stream->Value();

    Napi::Object retObj = Napi::Object::New(qw_->Env());
    retObj.Set("purpose", "StreamRead");
    retObj.Set("fin", fin);
    retObj.Set("data", dataVal);
    retObj.Set("object", objVal);

    cbstream_.Call({retObj});
  }

  void Http3EventLoop::processStreamWrite(Http3WTStream *streamobj, Napi::ObjectReference *bufferhandle, bool success)
  {
    if (!checkQw())
      return;
    HandleScope scope(qw_->Env());

    auto stream = streamobj->getJS();
    if (!stream)
      return;

    Napi::Object objVal = stream->Value();
    bufferhandle->Unref(); // release the outgoing buffer
    delete bufferhandle;   // free the handle object

    Napi::Object retObj = Napi::Object::New(qw_->Env());
    retObj.Set("purpose", "StreamWrite");
    retObj.Set("success", success);
    retObj.Set("object", objVal);

    cbstream_.Call({retObj});
  }

  void Http3EventLoop::processStreamReset(Http3WTStream *streamobj)
  {
    if (!checkQw())
      return;
    HandleScope scope(qw_->Env());

    auto stream = streamobj->getJS();
    if (!stream)
      return;

    Napi::Object objVal = stream->Value();

    Napi::Object retObj = Napi::Object::New(qw_->Env());
    retObj.Set("purpose", "StreamReset");
    retObj.Set("object", objVal);

    cbstream_.Call({retObj});
  }

  void Http3EventLoop::processStreamNetworkFinish(Http3WTStream *streamobj, NetworkTask task)
  {
    if (!checkQw())
      return;
    HandleScope scope(qw_->Env());

    auto stream = streamobj->getJS();
    if (!stream)
      return;
    Napi::Object objVal = stream->Value();

    std::string nettaskstr;
    switch (task)
    {
    case NetworkTask::resetStream:
    {
      nettaskstr = "resetStream";
    }
    break;
    case NetworkTask::stopSending:
    {
      nettaskstr = "stopSending";
    }
    break;
    case NetworkTask::streamFinal:
    {
      nettaskstr = "streamFinal";
    }
    break;
    default:
      return;
    };

    Napi::Object retObj = Napi::Object::New(qw_->Env());
    retObj.Set("purpose", "StreamNetworkFinish");
    retObj.Set("object", objVal);
    retObj.Set("nettask", nettaskstr);

    cbstream_.Call({retObj});
  }

  void Http3EventLoop::processDatagramBufferFree(Napi::ObjectReference *bufferhandle)
  {
    bufferhandle->Unref(); // release the outgoing buffer
    delete bufferhandle;   // free the handle object
  }

  void Http3EventLoop::processDatagramReceived(Http3WTSession *sessionobj, std::string *datagram)
  {
    if (!checkQw())
      return;
    HandleScope scope(qw_->Env());
    Napi::Object datagramVal =
        Napi::Uint8Array::New(qw_->Env(),
                              datagram->length(),
                              Napi::ArrayBuffer::New(qw_->Env(), &(*datagram)[0], datagram->length(),
                                                     freeData, datagram),
                              0);

    auto session = sessionobj->getJS();
    if (!session)
      return;
    Napi::Object objVal = session->Value();

    Napi::Object retObj = Napi::Object::New(qw_->Env());
    retObj.Set("purpose", "DatagramReceived");
    retObj.Set("datagram", datagramVal);
    retObj.Set("object", objVal);

    cbsession_.Call({retObj});
  }

  void Http3EventLoop::processDatagramSend(Http3WTSession *sessionobj)
  {
    if (!checkQw())
      return;
    HandleScope scope(qw_->Env());
    auto session = sessionobj->getJS();
    if (!session)
      return;
    Napi::Object objVal = session->Value();

    Napi::Object retObj = Napi::Object::New(qw_->Env());
    retObj.Set("purpose", "DatagramSend");
    retObj.Set("object", objVal);

    cbsession_.Call({retObj});
  }

  void Http3EventLoop::processNewSessionRequest(Http3Server *serverobj, WebTransportSession *session, spdy::Http2HeaderBlock *reqheadcopy, WebTransportRespPromisePtr *promise)
  {
    if (!checkQw())
      return;
    HandleScope scope(qw_->Env());

    Napi::Object objVal = serverobj->getJS()->Value();

    Napi::Object retObj = Napi::Object::New(qw_->Env());

    retObj.Set("purpose", "SessionRequest");
    // header

    Napi::Object headObj = Napi::Object::New(qw_->Env());
    for (auto pair : *reqheadcopy)
    {
      // we iterate over all header fields
      headObj.Set(std::string(pair.first), std::string(pair.second));
    }
    retObj.Set("header", headObj);
    delete reqheadcopy; // we own it and must free it!

    // promise
    Napi::External<WebTransportRespPromisePtr> promObj =
        Napi::External<WebTransportRespPromisePtr>::New(qw_->Env(), promise,
                                                        [](Napi::Env /*env*/, WebTransportRespPromisePtr *ref)
                                                        {
                                                          delete ref; // we own it and must delete it
                                                        });
    retObj.Set("promise", promObj);

    Napi::External<WebTransportSession> wtsObj =
        Napi::External<WebTransportSession>::New(qw_->Env(), session,
                                                 [](Napi::Env /*env*/, WebTransportSession *ref)
                                                 {
                                                   // we do not own it! And do not delete it.
                                                   // does it outlife everything?
                                                 });
    retObj.Set("session", wtsObj);

    retObj.Set("object", objVal);

    cbtransport_.Call({retObj});
  }

  void Http3EventLoop::processNewSession(Http3Server *serverobj, Http3WTSession *session, const std::string &path, Napi::Reference<Napi::Value> *header)
  {
    if (!checkQw())
      return;
    HandleScope scope(qw_->Env());

    Http3Constructors *constr = qw_->Env().GetInstanceData<Http3Constructors>();
    Napi::Object sessionobj = constr->session.New({});
    Http3WTSessionJS *sessionjs = Napi::ObjectWrap<Http3WTSessionJS>::Unwrap(sessionobj);
    sessionjs->setObj(session);
    sessionjs->Ref();
    session->setJS(sessionjs);

    Napi::Object objVal = serverobj->getJS()->Value();

    Napi::Object retObj = Napi::Object::New(qw_->Env());
    retObj.Set("purpose", "Http3WTSessionVisitor");
    retObj.Set("session", sessionobj);
    retObj.Set("path", path);
    retObj.Set("object", objVal);
    if (header)
    {
      retObj.Set("header", header->Value());
      header->Unref();
      delete header;
    }

    cbtransport_.Call({retObj});
  }

  void Http3EventLoop::processNewClientSession(Http3Client *clientobj, Http3WTSession *session)
  {
    if (!checkQw())
      return;
    HandleScope scope(qw_->Env());

    Napi::Object retObj = Napi::Object::New(qw_->Env());
    retObj.Set("purpose", "Http3WTSessionVisitor");
    if (session != nullptr)
    {
      Http3Constructors *constr = qw_->Env().GetInstanceData<Http3Constructors>();
      Napi::Object sessionobj = constr->session.New({});
      Http3WTSessionJS *sessionjs = Napi::ObjectWrap<Http3WTSessionJS>::Unwrap(sessionobj);
      sessionjs->setObj(session);
      sessionjs->Ref();
      session->setJS(sessionjs);

      Napi::Object objVal = clientobj->getJS()->Value();
      retObj.Set("session", sessionobj);

      retObj.Set("object", objVal);
    }
    cbtransport_.Call({retObj});
  }

  void Http3EventLoop::processSessionReady(Http3WTSession *sessionobj)
  {
    if (!checkQw())
      return;
    HandleScope scope(qw_->Env());
    auto session = sessionobj->getJS();
    if (!session)
      return;
    Napi::Object objVal = session->Value();

    Napi::Object retObj = Napi::Object::New(qw_->Env());
    retObj.Set("purpose", "SessionReady");
    retObj.Set("object", objVal);

    cbsession_.Call({retObj});
  }

  void Http3EventLoop::processSessionClose(Http3WTSession *sessionobj, uint32_t errorcode, const std::string &error)
  {
    if (!checkQw())
      return;
    HandleScope scope(qw_->Env());

    auto session = sessionobj->getJS();
    if (!session)
      return;

    Napi::Object objVal = session->Value();

    Napi::Object retObj = Napi::Object::New(qw_->Env());
    retObj.Set("purpose", "SessionClose");
    retObj.Set("error", error);
    retObj.Set("errorcode", errorcode);

    retObj.Set("object", objVal);

    cbsession_.Call({retObj});
  }

  void Http3EventLoop::processServerStatus(Http3Server *serverobj, NetworkStatus status, ServerStatusDetails *details)
  {
    if (!checkQw())
      return;
    HandleScope scope(qw_->Env());

    Napi::Object objVal = serverobj->getJS()->Value();

    Napi::Object retObj = Napi::Object::New(qw_->Env());
    retObj.Set("purpose", "ServerStatus");
    retObj.Set("object", objVal);
    Napi::Number portVal = Napi::Number::New(qw_->Env(), details->port);
    retObj.Set("port", portVal);
    Napi::String hostVal = Napi::String::New(qw_->Env(), details->host);
    retObj.Set("host", hostVal);

    delete details; // we own it and must throw it away
    switch (status)
    {
    case NetError:
    {
      retObj.Set("status", "error");
    }
    break;
    case NetListening:
    {
      retObj.Set("status", "listening");
    }
    break;
    case NetClose:
    {
      retObj.Set("status", "close");
    }
    break;
    default:
    {
      Napi::Error::New(Env(), "Unknown status from server").ThrowAsJavaScriptException();
      return;
    }
    break;
    };
    cbtransport_.Call({retObj});
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
      }
      break;
      case Http3ProgressReport::NewClientSession:
      {
        processNewClientSession(cur.clientobj, cur.session);
      }
      break;
      case Http3ProgressReport::NewSessionRequest:
      {
        processNewSessionRequest(cur.serverobj, cur.webtsession, cur.headerblock, cur.promise);
      }
      break;
      case Http3ProgressReport::NewSession:
      {
        processNewSession(cur.serverobj, cur.session, *cur.para, cur.header);
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
      case Http3ProgressReport::ServerStatus:
      {
        processServerStatus(cur.serverobj, cur.status, cur.details);
        cur.para = nullptr; // take ownership of the data
      }
      break;
      case Http3ProgressReport::StreamRecvSignal:
      {
        processStreamRecvSignal(cur.streamobj, cur.wtscode, cur.nettask);
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
      case Http3ProgressReport::StreamNetworkFinish:
      {
        processStreamNetworkFinish(cur.streamobj, cur.nettask);
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
  }

  Http3EventLoop::Http3EventLoop(const Napi::CallbackInfo &info)
      : Napi::ObjectWrap<Http3EventLoop>(info),
        progress_(nullptr),
        quic_event_loop_(GetDefaultEventLoop()->Create(QuicDefaultClock::Get()))
  {
#ifdef WIN32
    initSockets();
#endif

    if (!info[0].IsUndefined() /*|| info[1].IsFunction()*/)
    {
      Napi::Object lobj = info[0].ToObject();
      if (lobj.IsEmpty())
      {
        Napi::Error::New(Env(), "No callback obj for Http3Transport").ThrowAsJavaScriptException();
        return;
      }

      if (lobj.Has("eventloopCallback") && (lobj).Get("eventloopCallback").IsFunction())
      {
        Napi::Function cbeventloop = lobj.Get("eventloopCallback").As<Napi::Function>();
        qw_ = new QueueWorker(this, cbeventloop);
      }
      else
      {
        Napi::Error::New(Env(), "No eventloop callback").ThrowAsJavaScriptException();
        qw_ = nullptr;
        return;
      }

      if (lobj.Has("transportCallback") && (lobj).Get("transportCallback").IsFunction())
      {
        cbtransport_ = Napi::Persistent(lobj.Get("transportCallback").As<Napi::Function>());
      }
      else
      {
        Napi::Error::New(Env(), "No transport callback").ThrowAsJavaScriptException();
        return;
      }

      if (lobj.Has("streamCallback") && lobj.Get("streamCallback").IsFunction())
      {
        cbstream_ = Napi::Persistent(lobj.Get("streamCallback").As<Napi::Function>());
      }
      else
      {
        Napi::Error::New(Env(), "No stream callback").ThrowAsJavaScriptException();
        return;
      }

      if (lobj.Has("sessionCallback") && lobj.Get("sessionCallback").IsFunction())
      {
        cbsession_ = Napi::Persistent(lobj.Get("sessionCallback").As<Napi::Function>());
      }
      else
      {
        Napi::Error::New(Env(), "No session callback").ThrowAsJavaScriptException();
        return;
      }
    }
    else
    {
      Napi::Error::New(Env(), "Callback not passed to Http3EventLoop internal").ThrowAsJavaScriptException();
      return;
    }
  }

  void Http3EventLoop::startEventLoop(const Napi::CallbackInfo &info)
  {
    // got the object we can now start the server
    Ref(); // do not garbage collect
    // epoll_server_.set_timeout_in_us(-1); // negative values would mean wait forever
    if (!checkQw())
      return;
    qw_->Queue(); // from asyncprogressqueue worker
  }

  void Http3EventLoop::shutDownEventLoop(const Napi::CallbackInfo &info)
  {
    // FIXME kill the uv loop
    std::function<void()> task = [this]()
    {
      loop_running_ = false;
    };
    Schedule(task);
  }

  Napi::Object Init(Napi::Env env, Napi::Object exports)
  {
    Http3EventLoop::Init(env, exports);
    return exports;
  }

  NODE_API_MODULE(webtransport, Init)
}
