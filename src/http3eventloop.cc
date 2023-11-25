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
#include "src/napialarmfactory.h"
#include "quiche/quic/tools/quic_simple_crypto_server_stream_helper.h"
#include "quiche/quic/core/crypto/proof_source_x509.h"
#include "quiche/common/platform/api/quiche_reference_counted.h"
#include "quiche/quic/core/quic_default_clock.h"
#include "quiche/quic/bindings/quic_libevent.h"
#include "quiche/common/platform/api/quiche_command_line_flags.h"

#include "absl/log/initialize.h"
#include "absl/strings/string_view.h"

using namespace Napi;

namespace quic
{

  // hack since the header is faulty
  QUICHE_NO_EXPORT QuicEventLoopFactory *GetDefaultEventLoop();

  static const int kErrorBufferSize = 256;

  const size_t kNumSessionsToCreatePerSocketEvent = 16;
  bool Http3EventLoop::hasSetLogging = false;

  Http3EventLoop::~Http3EventLoop()
  {
    printf("Destructor eventloop\n");
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
    NapiAlarmJS::InitExports(env, exports, constr);

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
    Http3ProgressReport report;
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
    Http3ProgressReport report;
    report.type = Http3ProgressReport::StreamRecvSignal;
    report.streamobj = streamobj;
    report.wtscode = error_code;
    report.nettask = task;
    if (progress_)
      progress_->Send(&report, 1);
  }

  void Http3EventLoop::informAboutStreamRead(Http3WTStream *streamobj, uint32_t buffergrow, bool fin, bool success)
  {
    Http3ProgressReport report;
    report.type = Http3ProgressReport::StreamRead;
    report.streamobj = streamobj;
    report.fin = fin;
    report.buffergrow = buffergrow;
    report.success = success;
    if (progress_)
      progress_->Send(&report, 1);
  }

  void Http3EventLoop::informAboutStreamWrite(Http3WTStream *streamobj, Napi::ObjectReference *bufferhandle, bool success)
  {
    Http3ProgressReport report;
    report.type = Http3ProgressReport::StreamWrite;
    report.streamobj = streamobj;
    report.bufferhandle = bufferhandle;
    report.success = success;
    if (progress_)
      progress_->Send(&report, 1);
  }

  void Http3EventLoop::informAboutStreamNetworkFinish(Http3WTStream *streamobj, NetworkTask task)
  {
    Http3ProgressReport report;
    report.type = Http3ProgressReport::StreamNetworkFinish;
    report.streamobj = streamobj;
    report.nettask = task;
    if (progress_)
      progress_->Send(&report, 1);
  }

  void Http3EventLoop::informAboutStreamReset(Http3WTStream *streamobj)
  {
    Http3ProgressReport report;
    report.type = Http3ProgressReport::StreamReset;
    report.streamobj = streamobj;
    if (progress_)
      progress_->Send(&report, 1);
  }

  void Http3EventLoop::informDatagramReceived(Http3WTSession *sessionobj, absl::string_view datagram)
  {
    Http3ProgressReport report;
    report.type = Http3ProgressReport::DatagramReceived;
    report.sessionobj = sessionobj;
    report.para = new std::string(datagram);
    if (progress_)
      progress_->Send(&report, 1);
  }

  void Http3EventLoop::informDatagramSend(Http3WTSession *sessionobj, Napi::ObjectReference *bufferhandle)
  {
    Http3ProgressReport report;
    report.type = Http3ProgressReport::DatagramSend;
    report.sessionobj = sessionobj;
    report.bufferhandle = bufferhandle;
    if (progress_)
      progress_->Send(&report, 1);
  }

  void Http3EventLoop::informGoawayReceived(Http3WTSession *sessionobj)
  {
    Http3ProgressReport report;
    report.type = Http3ProgressReport::GoawayReceived;
    report.sessionobj = sessionobj;
    if (progress_)
      progress_->Send(&report, 1);
  }

  void  Http3EventLoop::informSessionStats(Http3WTSession *sessionobj, webtransport::SessionStats * sessstats)
  {
    Http3ProgressReport report;
    report.type = Http3ProgressReport::SessionStats;
    report.sessionobj = sessionobj;
    report.sessionStats = sessstats;
  
    report.timestamp = new absl::Duration();
    report.timestamp[0] = absl::Now() - absl::UnixEpoch();
    if (progress_)
      progress_->Send(&report, 1);
  }

  void  Http3EventLoop::informDatagramStats(Http3WTSession *sessionobj, webtransport::DatagramStats * datastats)
  {
    Http3ProgressReport report;
    report.type = Http3ProgressReport::DatagramStats;
    report.sessionobj = sessionobj;
    report.datagramStats = datastats;
    report.timestamp = new absl::Duration();
    report.timestamp[0] = absl::Now() - absl::UnixEpoch();
    if (progress_)
      progress_->Send(&report, 1);
  }

  void Http3EventLoop::informUnref(LifetimeHelper *obj)
  {
    Http3ProgressReport report;
    report.type = Http3ProgressReport::Unref;
    report.obj = obj;

    if (progress_)
      progress_->Send(&report, 1);
  }

  void Http3EventLoop::informAboutClientConnected(Http3Client *client, bool success)
  {
    Http3ProgressReport report;
    report.type = Http3ProgressReport::ClientConnected;
    report.clientobj = client;
    report.success = success;
    if (progress_)
      progress_->Send(&report, 1);
  }

  void Http3EventLoop::informClientWebtransportSupport(Http3Client *client)
  {
    Http3ProgressReport report;
    report.type = Http3ProgressReport::ClientWebTransportSupport;
    report.clientobj = client;
    if (progress_)
      progress_->Send(&report, 1);
  }

  void Http3EventLoop::informNewClientSession(Http3Client *client, Http3WTSession *session)
  {
    Http3ProgressReport report;
    report.type = Http3ProgressReport::NewClientSession;
    report.clientobj = client;
    report.session = session;
    if (progress_)
      progress_->Send(&report, 1);
  }

  void Http3EventLoop::informSessionClosed(Http3WTSession *sessionobj, WebTransportSessionError error_code,
                                           absl::string_view error_message)
  {
    Http3ProgressReport report;
    report.type = Http3ProgressReport::SessionClosed;
    report.sessionobj = sessionobj;
    report.para = new std::string(error_message);
    report.wtecode = error_code;
    if (progress_)
      progress_->Send(&report, 1);
  }

  void Http3EventLoop::informSessionReady(Http3WTSession *sessionobj)
  {
    Http3ProgressReport report;
    report.type = Http3ProgressReport::SessionReady;
    report.sessionobj = sessionobj;
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
   
    if (incom || bidi) { // we have a read stream
      // same size of a pipe in chromium, but the WT Pipe thre is 256 kbyte, the default 64 kbyte
      Napi::ArrayBuffer arraybuf = Napi::ArrayBuffer::New(qw_->Env(),  64 * 1024);
      strobj.Set("readbuffer", arraybuf); // so the lifecycle is bound to the JS Obj!
      stream->setReadBuffer(arraybuf.Data(), arraybuf.ByteLength());
    }
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

  void Http3EventLoop::processStreamRead(Http3WTStream *streamobj, size_t buffergrow, bool fin, bool success)
  {
    if (!checkQw())
      return;
    HandleScope scope(qw_->Env());

    auto stream = streamobj->getJS();
    if (!stream)
      return;
    Napi::Object objVal = stream->Value();

    Napi::Object retObj = Napi::Object::New(qw_->Env());
    retObj.Set("purpose", "StreamRead");
    retObj.Set("fin", fin);
    retObj.Set("buffergrow", buffergrow);
    retObj.Set("object", objVal);
    retObj.Set("success", success);

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

  void Http3EventLoop::processDatagramSend(Http3WTSession *sessionobj, Napi::ObjectReference *bufferhandle)
  {
     bufferhandle->Unref(); // release the outgoing buffer
    delete bufferhandle;   // free the handle object
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

  void Http3EventLoop::processGoawayReceived(Http3WTSession *sessionobj)
  {
    if (!checkQw())
      return;
    HandleScope scope(qw_->Env());
   

    auto session = sessionobj->getJS();
    if (!session)
      return;
    Napi::Object objVal = session->Value();

    Napi::Object retObj = Napi::Object::New(qw_->Env());
    retObj.Set("purpose", "GoawayReceived");
    retObj.Set("object", objVal);
    cbsession_.Call({retObj});
  }

  void Http3EventLoop::processSessionStats(Http3WTSession *sessionobj, absl::Duration* timestamp, webtransport::SessionStats * sessstats)
  {
    if (!checkQw())
      return;
    HandleScope scope(qw_->Env());
   

    auto session = sessionobj->getJS();
    if (!session)
      return;
    Napi::Object objVal = session->Value();

    Napi::Object retObj = Napi::Object::New(qw_->Env());
    retObj.Set("purpose", "SessionStats");
    retObj.Set("object", objVal);
    //  expiredOutgoing: bigint
  // lostOutgoing: bigint

  // non Datagram
 //  minRtt: number
 //  smoothedRtt: number
 //  rttVariation: number
  // estimatedSendRateBps: bigint
    retObj.Set("timestamp", absl::ToDoubleMilliseconds(*timestamp)); // absl::Duration
    // datagram
    retObj.Set("expiredOutgoing", Napi::BigInt::New(qw_->Env(), sessstats->datagram_stats.expired_outgoing)); //uint64_t
    retObj.Set("lostOutgoing", Napi::BigInt::New(qw_->Env(), sessstats->datagram_stats.lost_outgoing)); //uint64_t

    // non Datagram
    retObj.Set("minRtt", absl::ToDoubleMilliseconds(sessstats->min_rtt)); // absl::Duration
    retObj.Set("smoothedRtt", absl::ToDoubleMilliseconds(sessstats->smoothed_rtt)); // absl::Duration
    retObj.Set("rttVariation", absl::ToDoubleMilliseconds(sessstats->rtt_variation)); // absl::Duration
    retObj.Set("estimatedSendRateBps", sessstats->estimated_send_rate_bps); // absl::Duration

    cbsession_.Call({retObj});
    delete sessstats;
    delete timestamp;
  }

  void Http3EventLoop::processDatagramStats(Http3WTSession *sessionobj, absl::Duration* timestamp, webtransport::DatagramStats * datastats)
  {
    if (!checkQw())
      return;
    HandleScope scope(qw_->Env());
   

    auto session = sessionobj->getJS();
    if (!session)
      return;
    Napi::Object objVal = session->Value();

    Napi::Object retObj = Napi::Object::New(qw_->Env());
    retObj.Set("purpose", "DatagramStats");
    retObj.Set("object", objVal);
    retObj.Set("timestamp", absl::ToDoubleMilliseconds(*timestamp)); // absl::Duration
    // datagram
    retObj.Set("expiredOutgoing", Napi::BigInt::New(qw_->Env(), datastats->expired_outgoing)); //uint64_t
    retObj.Set("lostOutgoing", Napi::BigInt::New(qw_->Env(), datastats->lost_outgoing)); //uint64_t

    cbsession_.Call({retObj});
    delete datastats;
    delete timestamp;
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
      case Http3ProgressReport::StreamRecvSignal:
      {
        processStreamRecvSignal(cur.streamobj, cur.wtscode, cur.nettask);
      }
      break;
      case Http3ProgressReport::StreamRead:
      {
        processStreamRead(cur.streamobj, cur.buffergrow, cur.fin, cur.success);
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
        processDatagramSend(cur.sessionobj, cur.bufferhandle);
      }
      break;
      case Http3ProgressReport::GoawayReceived:
      {
        processGoawayReceived(cur.sessionobj);
      }
      break;
      case Http3ProgressReport::SessionStats:
      {
        processSessionStats(cur.sessionobj, cur.timestamp, cur.sessionStats);
        cur.para = nullptr; // take ownership of the data
      }
      break;
      case Http3ProgressReport::DatagramStats:
      {
        processDatagramStats(cur.sessionobj, cur.timestamp, cur.datagramStats);
        cur.para = nullptr; // take ownership of the data
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
    std::vector<std::string> quiche_cmd_line;
    quiche_cmd_line.push_back(std::string("webtransport.node"));
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
      quiche_cmd_line.push_back(std::string("-v"));
      if (lobj.Has("quicheLogVerbose") && lobj.Get("quicheLogVerbose").IsFunction())
      {
         Napi::Value verboseValue = (lobj).Get("quicheLogVerbose");
         quiche_cmd_line.push_back(verboseValue.ToString().Utf8Value());
      } else {
         quiche_cmd_line.push_back(std::string("-1"));
      }
    }
    else
    {
      Napi::Error::New(Env(), "Callback not passed to Http3EventLoop internal").ThrowAsJavaScriptException();
      return;
    }
    std::vector<const char*> quiche_cmd_line_char;
    for (auto cur= quiche_cmd_line.begin(); cur != quiche_cmd_line.end(); cur++) {
      quiche_cmd_line_char.push_back((*cur).c_str());
    } 
    if (!hasSetLogging) {
      quiche::QuicheParseCommandLineFlags("No use instruction.", quiche_cmd_line.size(), &(*quiche_cmd_line_char.begin()));
      hasSetLogging = true;
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
