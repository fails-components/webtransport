// Copyright (c) 2022 Marten Richter or other contributers (see commit). All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

// portions taken from libquiche, original copyright, see LICENSE.chromium
// Copyright (c)  The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef WT_HTTP3_SERVER_H
#define WT_HTTP3_SERVER_H

#include <memory>

#include <nan.h>

#include "src/http3serverbackend.h"
#include "quic/core/crypto/quic_crypto_server_config.h"
#include "quic/core/quic_udp_socket.h"
#include "quic/core/quic_dispatcher.h"
#include "quic/core/quic_packet_reader.h"
#include "quic/platform/api/quic_socket_address.h"
#include "quic/platform/api/quic_epoll.h"

using namespace Nan;

namespace quic
{

    class Http3Server;
    class Http3WTSessionVisitor;
    class Http3WTStreamVisitor;

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
            DatagramReceived,
            DatagramSend,
            DatagramBufferFree
        } type;
        uint32_t objnum;
        union
        {
            WebTransportSessionError wtecode;
            uint32_t streamid;
        };
        union
        {
            Http3WTStreamVisitor *streamvisitor;       // unowned
            Http3WTSessionVisitor *sessionvisitor;     // unowned
            Nan::Persistent<v8::Object> *bufferhandle; // we own it and must delete it if present
            bool fin;
        };
        union
        {
            bool success;
        };

        std::string *para = nullptr; // for session, we own it, and must delete it
    };

    class Http3Server : public QuicEpollCallbackInterface, public epoll_server::LibuvEpollAsyncCallbackInterface,
                         public AsyncProgressQueueWorker<Http3ProgressReport>, // may be replace char later
                        public Nan::ObjectWrap
    {
    public:
        Http3Server(Callback *callback, std::string host, int port, std::unique_ptr<ProofSource> proof_source, const char *secret);

        Http3Server(const Http3Server &) = delete;
        Http3Server &operator=(const Http3Server &) = delete;

        ~Http3Server();

        static NAN_METHOD(createHttp3Server);
        static NAN_MODULE_INIT(Init);

        bool CreateUDPSocketAndListen(const QuicSocketAddress &address);

        void Execute(const AsyncProgressQueueWorker::ExecutionProgress &progress);

        // call into javascript, if necessary
        void HandleProgressCallback(const Http3ProgressReport *data, size_t count);

        // Server deletion is imminent.  Start cleaning up the epoll server.
        void Destroy() override;

        // From EpollCallbackInterface
        std::string Name() const override { return "Http3Server"; }

        void OnRegistration(QuicEpollServer * /*eps*/,
                            int /*fd*/,
                            int /*event_mask*/) override {}
        void OnModification(int /*fd*/, int /*event_mask*/) override {}
        void OnEvent(int /*fd*/, QuicEpollEvent * /*event*/) override;
        void OnUnregistration(int /*fd*/, bool /*replaced*/) override {}

        void OnShutdown(QuicEpollServer * /*eps*/, int /*fd*/) override {}

        void OnAsyncExecution() override;

        void informAboutNewSession(Http3WTSessionVisitor *session, absl::string_view path);
        void informSessionClosed(uint32_t objnum_, WebTransportSessionError error_code, absl::string_view error_message);
        void informSessionReady(uint32_t objnum_);

        void informAboutStream(bool incom, bool bidir, uint32_t objnum_, Http3WTStreamVisitor *stream);
        void informStreamClosed(uint32_t objnum, uint32_t strid);
        void informAboutStreamRead(uint32_t objnum, uint32_t strid, std::string *data, bool fin);
        void informAboutStreamWrite(uint32_t objnum, uint32_t strid, Nan::Persistent<v8::Object> *bufferhandle, bool success);

        void informDatagramReceived(uint32_t objnum, absl::string_view datagram);
        void informDatagramBufferFree(Nan::Persistent<v8::Object> *bufferhandle);
        void informDatagramSend(uint32_t objnum);

        void Schedule(std::function<void()> action);

        uint32_t getNewObjNum();

    private:
        static NAN_METHOD(New);

        static NAN_METHOD(startServer);

        static NAN_METHOD(addPath);

        static void freeData(char *data, void *hint);

        static inline Nan::Persistent<v8::Function> &constructor()
        {
            static Nan::Persistent<v8::Function> my_constructor;
            return my_constructor;
        }

        bool startServerInt();
        void ExecuteScheduledActions();

        QuicMutex scheduled_actions_lock_;
        quiche::QuicheCircularDeque<std::function<void()>> scheduled_actions_
            QUIC_GUARDED_BY(scheduled_actions_lock_);

        QuicNotification quit_;
        QuicUdpSocketFd fd_;
        bool overflow_supported_;
        int port_;
        std::string host_;
        QuicPacketCount packets_dropped_;
        QuicEpollServer epoll_server_;
        std::unique_ptr<QuicPacketReader> packet_reader_;
        std::unique_ptr<QuicDispatcher> dispatcher_;
        // config_ contains non-crypto parameters that are negotiated in the crypto
        // handshake.
        QuicConfig config_;
        // crypto_config_ contains crypto parameters for the handshake.
        QuicCryptoServerConfig crypto_config_;
        // crypto_config_options_ contains crypto parameters for the handshake.
        QuicCryptoServerConfig::ConfigOptions crypto_config_options_;

        // Used to generate current supported versions.
        QuicVersionManager version_manager_;

        Http3ServerBackend http3_server_backend_; // unowned.

        // Connection ID length expected to be read on incoming IETF short headers.
        uint8_t expected_server_connection_id_length_;

        QuicDispatcher *CreateQuicDispatcher();

        void processNewSession(Http3WTSessionVisitor *visitor, uint32_t objnum, const std::string &path);
        void processSessionClose(uint32_t objnum, uint32_t errorcode, const std::string &path);
        void processSessionReady(uint32_t objnum);

        void processStream(bool incom, bool bidi, uint32_t objnum, Http3WTStreamVisitor *streamvisitor, uint32_t streamid);
        void processStreamClosed(uint32_t objnum, uint32_t streamid);
        void processStreamRead(uint32_t objnum, uint32_t streamid, std::string *data, bool fin);
        void processStreamWrite(uint32_t objnum, uint32_t strid, Nan::Persistent<v8::Object> *bufferhandle, bool success);

        void processDatagramReceived(uint32_t objnum, std::string *datagram);
        void processDatagramSend(uint32_t objnum);
        void processDatagramBufferFree(Nan::Persistent<v8::Object> *bufferhandle);

        const AsyncProgressQueueWorker::ExecutionProgress *progress_;
        uint32_t objnum_;
        std::map<uint32_t, Http3WTSessionVisitor *> visitors;
    };

}

#endif