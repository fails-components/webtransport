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

#include <nan.h>

#include "src/http3serverbackend.h"
#include "quiche/quic/core/crypto/quic_crypto_server_config.h"
#include "quiche/quic/core/quic_udp_socket.h"
#include "quiche/quic/core/quic_dispatcher.h"
#include "quiche/quic/core/quic_packet_reader.h"
#include "quiche/quic/platform/api/quic_socket_address.h"
#include "quiche/quic/platform/api/quic_epoll.h"

using namespace Nan;

namespace quic
{

    class Http3Server;
    class Http3WTSession;
    class Http3WTStream;

    struct Http3ProgressReport
    {
    public:
        enum
        {
            NewSession,
            SessionReady,
            SessionClosed,
            IncomBiDiStream,
            IncomUniDiStream,
            OutgoBiDiStream,
            OutgoUniDiStream,
            StreamClosed,
            StreamRead,
            StreamWrite,
            StreamReset,
            DatagramReceived,
            DatagramSend,
            DatagramBufferFree
        } type;
        union { // always the originating obj
            Http3WTStream *streamobj;
            Http3WTSession *sessionobj;
            Http3Server *serverobj;
        }; 
        union
        {
            WebTransportSessionError wtecode;
        };
        union
        {
            Http3WTStream *stream;       // unowned
            Http3WTSession *session;     // unowned
            Nan::Persistent<v8::Object> *bufferhandle; // we own it and must delete it if present
            bool fin;
            WebTransportStreamError wtscode;
        };
        union
        {
            bool success;
        };

        std::string *para = nullptr; // for session, we own it, and must delete it
    };

    class Http3EventLoop :  public epoll_server::LibuvEpollAsyncCallbackInterface,
                         public AsyncProgressQueueWorker<Http3ProgressReport>, // may be replace char later
                        public Nan::ObjectWrap
    {
    public:
        Http3EventLoop(Callback *callback, Callback *cbstream, Callback *cbsession);

        Http3EventLoop(const Http3EventLoop &) = delete;
        Http3EventLoop &operator=(const Http3EventLoop &) = delete;

        ~Http3EventLoop();

        static NAN_MODULE_INIT(Init);


        void Execute(const AsyncProgressQueueWorker::ExecutionProgress &progress);

        // call into javascript, if necessary
        void HandleProgressCallback(const Http3ProgressReport *data, size_t count);

        // Server deletion is imminent.  Start cleaning up the epoll server.
        void Destroy() override;

        QuicEpollServer *getEpollServer() {return &epoll_server_;};



        void OnAsyncExecution() override;

        void informAboutNewSession(Http3Server *server, Http3WTSession *session, absl::string_view path);
        void informSessionClosed(Http3WTSession *sessionobj, WebTransportSessionError error_code, absl::string_view error_message);
        void informSessionReady(Http3WTSession *sessionobj);

        void informAboutStream(bool incom, bool bidir, Http3WTSession *sessionobj, Http3WTStream *stream);
        void informStreamClosed(Http3WTStream *streamobj, WebTransportStreamError error_code);
        void informAboutStreamRead(Http3WTStream *streamobj, std::string *data, bool fin);
        void informAboutStreamWrite(Http3WTStream *streamobj, Nan::Persistent<v8::Object> *bufferhandle, bool success);
        void informAboutStreamReset(Http3WTStream *streamobj);

        void informDatagramReceived(Http3WTSession *sessionobj, absl::string_view datagram);
        void informDatagramBufferFree(Nan::Persistent<v8::Object> *bufferhandle);
        void informDatagramSend(Http3WTSession *sessionobj);

        void Schedule(std::function<void()> action);


    private:
        static NAN_METHOD(New);
        static NAN_METHOD(startEventLoop);


        static void freeData(char *data, void *hint);

        static inline Nan::Persistent<v8::Function> &constructor()
        {
            static Nan::Persistent<v8::Function> my_constructor;
            return my_constructor;
        }

        void ExecuteScheduledActions();

        QuicMutex scheduled_actions_lock_;
        quiche::QuicheCircularDeque<std::function<void()>> scheduled_actions_
            QUIC_GUARDED_BY(scheduled_actions_lock_);


        QuicPacketCount packets_dropped_;
        QuicEpollServer epoll_server_;
        

        void processNewSession(Http3Server * serverobj, Http3WTSession *session, const std::string &path);
        void processSessionClose(Http3WTSession *sessionobj, uint32_t errorcode, const std::string &path);
        void processSessionReady(Http3WTSession *sessionobj);

        void processStream(bool incom, bool bidi, Http3WTSession *sessionobj, Http3WTStream *stream);
        void processStreamClosed(Http3WTStream *streamobj, WebTransportStreamError error_code);
        void processStreamRead(Http3WTStream *streamobj, std::string *data, bool fin);
        void processStreamWrite(Http3WTStream *streamobj, Nan::Persistent<v8::Object> *bufferhandle, bool success);
        void processStreamReset(Http3WTStream *streamobj);

        void processDatagramReceived(Http3WTSession *sessionobj, std::string *datagram);
        void processDatagramSend(Http3WTSession *sessionobj);
        void processDatagramBufferFree(Nan::Persistent<v8::Object> *bufferhandle);

        bool startEventLoopInt();

        const AsyncProgressQueueWorker::ExecutionProgress *progress_;

        Callback *cbstream_; 
        Callback *cbsession_; 
    };

}

#endif