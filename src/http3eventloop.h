// Copyright (c) 2022 Marten Richter or other contributers (see commit). All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

// portions taken from libquiche, original copyright, see LICENSE.chromium
// Copyright (c)  The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef WT_HTTP3_EVENTLOOP_H
#define WT_HTTP3_EVENTLOOP_H

#include <memory>

#include <napi.h>
#include <uv.h>

#include "src/http3serverbackend.h"
#include "quiche/quic/core/crypto/quic_crypto_server_config.h"
#include "quiche/quic/core/quic_udp_socket.h"
#include "quiche/quic/core/quic_dispatcher.h"
#include "quiche/quic/core/quic_packet_reader.h"
#include "quiche/quic/platform/api/quic_socket_address.h"
#include "quiche/quic/core/io/quic_default_event_loop.h"

using namespace Napi;

namespace quic
{

    class Http3Server;
    class Http3Client;
    class Http3WTSession;
    class Http3WTStream;
    class Http3EventLoop;

    class LifetimeHelper
    {
    public:
        virtual void doUnref() = 0;
    };

    enum NetworkTask
    {
        resetStream,
        stopSending,
        streamFinal
    };

    struct Http3Constructors
    {
        Napi::FunctionReference stream;
        Napi::FunctionReference session;

    };

    class Http3ProgressReport // actually struct would be a better fit but make napi happy
    {
    public:
        enum
        {
            ClientConnected,
            ClientWebTransportSupport,
            NewClientSession,
            NewSession,
            SessionReady,
            SessionClosed,
            IncomBiDiStream,
            IncomUniDiStream,
            OutgoBiDiStream,
            OutgoUniDiStream,
            StreamRecvSignal,
            StreamRead,
            StreamWrite,
            StreamReset,
            StreamNetworkFinish,
            DatagramReceived,
            DatagramSend,
            DatagramBufferFree,
            Unref
        } type;
        union
        { // always the originating obj
            Http3WTStream *streamobj;
            Http3WTSession *sessionobj;
            Http3Server *serverobj;
            Http3Client *clientobj;
            LifetimeHelper *obj;
        };
        union
        {
            WebTransportSessionError wtecode;
            NetworkTask nettask;
        };
        union
        {
            Http3WTStream *stream;               // unowned
            Http3WTSession *session;             // unowned
            Napi::ObjectReference *bufferhandle; // we own it and must delete it if present
            bool fin;
            WebTransportStreamError wtscode;
        };
        union
        {
            bool success;
        };

        std::string *para = nullptr; // for session, we own it, and must delete it
    };

    class Http3EventLoop : // may be replace char later
                           public Napi::ObjectWrap<Http3EventLoop>
    {
    private:
        class QueueWorker : public AsyncProgressQueueWorker<Http3ProgressReport>
        {
        public:
            QueueWorker(Http3EventLoop *eventloop, Napi::Function cb) : AsyncProgressQueueWorker(cb),
                                                                        eventloop_(eventloop)
            {
            }

            void Execute(const AsyncProgressQueueWorker::ExecutionProgress &progress)
            {
                eventloop_->Execute(progress);
            }

            void OnProgress(const Http3ProgressReport *data, size_t count) override
            {
                eventloop_->HandleProgressCallback(data, count);
            }

            void OnOK() override
            {
                eventloop_->Destroy();
            }

            void OnError(const Error &e) override
            {
                eventloop_->Destroy();
            }



        protected:
            Http3EventLoop *eventloop_;
        };

    public:
        Http3EventLoop(const Napi::CallbackInfo &info);

        Http3EventLoop(const Http3EventLoop &) = delete;
        Http3EventLoop &operator=(const Http3EventLoop &) = delete;

        ~Http3EventLoop();

        static void Init(Napi::Env env, Napi::Object exports);

        void Execute(const AsyncProgressQueueWorker<Http3ProgressReport>::ExecutionProgress &progress);

        // call into javascript, if necessary
        void HandleProgressCallback(const Http3ProgressReport *data, size_t count);

        // Server deletion is imminent.  Start cleaning up the epoll server.
        void Destroy();

        QuicEventLoop *getQuicEventLoop() { return quic_event_loop_.get(); };

        void informAboutClientConnected(Http3Client *client, bool success);
        void informClientWebtransportSupport(Http3Client *client);
        void informNewClientSession(Http3Client *client, Http3WTSession *session);

        void informAboutNewSession(Http3Server *server, Http3WTSession *session, absl::string_view path);
        void informSessionClosed(Http3WTSession *sessionobj, WebTransportSessionError error_code, absl::string_view error_message);
        void informSessionReady(Http3WTSession *sessionobj);

        void informAboutStream(bool incom, bool bidir, Http3WTSession *sessionobj, Http3WTStream *stream);
        void informStreamRecvSignal(Http3WTStream *streamobj, WebTransportStreamError error_code, NetworkTask task);
        void informAboutStreamRead(Http3WTStream *streamobj, std::string *data, bool fin);
        void informAboutStreamWrite(Http3WTStream *streamobj, Napi::ObjectReference *bufferhandle, bool success);
        void informAboutStreamReset(Http3WTStream *streamobj);
        void informAboutStreamNetworkFinish(Http3WTStream *streamobj, NetworkTask task);

        void informDatagramReceived(Http3WTSession *sessionobj, absl::string_view datagram);
        void informDatagramBufferFree(Napi::ObjectReference *bufferhandle);
        void informDatagramSend(Http3WTSession *sessionobj);

        void informUnref(LifetimeHelper *obj);

        void Schedule(std::function<void()> action);

        void startEventLoop(const Napi::CallbackInfo &info);
        void shutDownEventLoop(const Napi::CallbackInfo &info);

    private:
        std::unique_ptr<QueueWorker> qw;

        static Napi::Value New(const Napi::CallbackInfo &info);

        static void freeData(Napi::Env env, void *data, std::string *hint);

        static inline Napi::FunctionReference &constructor()
        {
            static Napi::FunctionReference my_constructor;
            return my_constructor;
        }

        void ExecuteScheduledActions();

        QuicMutex scheduled_actions_lock_;
        quiche::QuicheCircularDeque<std::function<void()>> scheduled_actions_
            QUIC_GUARDED_BY(scheduled_actions_lock_);

        QuicPacketCount packets_dropped_;
        std::unique_ptr<QuicEventLoop> quic_event_loop_;

        void processClientConnected(Http3Client *clientobj, bool success);
        void processClientWebtransportSupport(Http3Client *client);
        void processNewClientSession(Http3Client *client, Http3WTSession *session);

        void processNewSession(Http3Server *serverobj, Http3WTSession *session, const std::string &path);
        void processSessionClose(Http3WTSession *sessionobj, uint32_t errorcode, const std::string &path);
        void processSessionReady(Http3WTSession *sessionobj);

        void processStream(bool incom, bool bidi, Http3WTSession *sessionobj, Http3WTStream *stream);
        void processStreamRecvSignal(Http3WTStream *streamobj, WebTransportStreamError error_code, NetworkTask task);
        void processStreamRead(Http3WTStream *streamobj, std::string *data, bool fin);
        void processStreamWrite(Http3WTStream *streamobj, Napi::ObjectReference *bufferhandle, bool success);
        void processStreamReset(Http3WTStream *streamobj);
        void processStreamNetworkFinish(Http3WTStream *streamobj, NetworkTask task);

        void processDatagramReceived(Http3WTSession *sessionobj, std::string *datagram);
        void processDatagramSend(Http3WTSession *sessionobj);
        void processDatagramBufferFree(Napi::ObjectReference *bufferhandle);

        bool shutDownEventLoopInt();

        const AsyncProgressQueueWorker<Http3ProgressReport>::ExecutionProgress *progress_;

        Napi::FunctionReference cbstream_;
        Napi::FunctionReference cbsession_;
        Napi::FunctionReference cbtransport_;


        bool loop_running_;
    };
}

#endif