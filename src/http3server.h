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
#include "src/http3eventloop.h"
#include "quiche/quic/core/crypto/quic_crypto_server_config.h"
#include "quiche/quic/core/quic_udp_socket.h"
#include "quiche/quic/core/quic_dispatcher.h"
#include "quiche/quic/core/quic_packet_reader.h"
#include "quiche/quic/platform/api/quic_socket_address.h"

using namespace Nan;

namespace quic
{

    class Http3EventLoop;
    

    class Http3Server : public QuicSocketEventListener, public Nan::ObjectWrap, public LifetimeHelper
    {
    public:
        Http3Server(Http3EventLoop * eventloop, std::string host, int port, 
            std::unique_ptr<ProofSource> proof_source,
                           const char *secret);

        Http3Server(const Http3Server &) = delete;
        Http3Server &operator=(const Http3Server &) = delete;

        ~Http3Server();


        bool CreateUDPSocketAndListen(const QuicSocketAddress &address);

       


        // From QuicSocketEventListener
        void OnSocketEvent(QuicEventLoop* event_loop, QuicUdpSocketFd fd,
                             QuicSocketEventMask events) override;

        static NAN_METHOD(New);

        static NAN_METHOD(startServer);

        static NAN_METHOD(stopServer);

        static NAN_METHOD(addPath);

        
        static inline Nan::Persistent<v8::Function> &constructor()
        {
            static Nan::Persistent<v8::Function> my_constructor;
            return my_constructor;
        }

        void doUnref() override {
            Unref();
        }
       


    private:

        bool startServerInt();
        bool stopServerInt();



        QuicUdpSocketFd fd_;
        bool overflow_supported_;
        int port_;
        std::string host_;
        QuicPacketCount packets_dropped_;
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

        Http3EventLoop * eventloop_;

        

    };

}

#endif