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

#include <napi.h>

#include "src/librarymain.h"
#include "src/http3serverbackend.h"
#include "src/napialarmfactory.h"
#include "src/socketjswriter.h"
#include "quiche/quic/core/crypto/quic_crypto_server_config.h"
#include "quiche/quic/core/deterministic_connection_id_generator.h"
#include "quiche/quic/core/quic_udp_socket.h"
#include "quiche/quic/core/quic_dispatcher.h"
#include "quiche/quic/core/quic_packet_reader.h"
#include "quiche/quic/platform/api/quic_socket_address.h"

using namespace Napi;

namespace quic
{

    class Http3EventLoop;

    class Http3Server;
    class Http3ServerJS;
    class Http3WTSession;

   

    class Http3ServerJS : public Napi::ObjectWrap<Http3ServerJS>,
                          public EnvGetter
    {
        friend class Http3Server;

    public:
        using WebTransportRespPromise = JSlikePromise<Http3ServerBackend::WebTransportResponse>;
        using WebTransportRespPromisePtr = std::shared_ptr<Http3ServerBackend::WebTransportRespPromise>;
        Http3ServerJS(const Napi::CallbackInfo &info);
        ~Http3ServerJS();

        Http3Server *getObj()
        {
            return server_.get();
        }

        Napi::Env getEnv() override
        {
            return Env();
        }

        Napi::Object getValue() override
        {
            return Value();
        }

        void destroy(const Napi::CallbackInfo &info);

        void addPath(const Napi::CallbackInfo &info);

        Napi::Value recvPaket(const Napi::CallbackInfo &info);

        void onCanWrite(const Napi::CallbackInfo &info);

        void finishSessionRequest(const Napi::CallbackInfo &info);

        void setJSRequestHandler(const Napi::CallbackInfo &info);

        void processBufferedChlos(const Napi::CallbackInfo &info);

        static void InitExports(Napi::Env env, Napi::Object exports)
        {
            Napi::Function tplsrv = DefineClass(env, "Http3WebTransportServer", {InstanceMethod<&Http3ServerJS::destroy>("destroy", static_cast<napi_property_attributes>(napi_writable | napi_configurable)), InstanceMethod<&Http3ServerJS::addPath>("addPath", static_cast<napi_property_attributes>(napi_writable | napi_configurable)), InstanceMethod<&Http3ServerJS::recvPaket>("recvPaket", static_cast<napi_property_attributes>(napi_writable | napi_configurable)), InstanceMethod<&Http3ServerJS::processBufferedChlos>("processBufferedChlos", static_cast<napi_property_attributes>(napi_writable | napi_configurable)), InstanceMethod<&Http3ServerJS::onCanWrite>("onCanWrite", static_cast<napi_property_attributes>(napi_writable | napi_configurable)), InstanceMethod<&Http3ServerJS::finishSessionRequest>("finishSessionRequest", static_cast<napi_property_attributes>(napi_writable | napi_configurable)), InstanceMethod<&Http3ServerJS::setJSRequestHandler>("setJSRequestHandler", static_cast<napi_property_attributes>(napi_writable | napi_configurable))});
            exports.Set("Http3WebTransportServer", tplsrv);
        }

        void processNewSession(Http3WTSession *session, const std::string &path,  const std::string &peer_address, Napi::Reference<Napi::Value> *header, Napi::Reference<Napi::Value> *userData);
        void processNewSessionRequest(WebTransportSession *session, const quiche::HttpHeaderBlock &reqheadcopy,  const std::string &peer_address, WebTransportRespPromisePtr promise);

    protected:
        std::unique_ptr<Http3Server> server_;
    };

    class Http3Server
    {
        friend class Http3ServerJS;

    public:
        Http3Server(Http3ServerJS *js, 
                    std::unique_ptr<ProofSource> proof_source,
                    const char *secret,
                    QuicConfig config);

        Http3Server(const Http3Server &) = delete;
        Http3Server &operator=(const Http3Server &) = delete;

        ~Http3Server();

        void Destroy();

        bool ProcessPacket(const QuicSocketAddress &self_address,
                           const QuicSocketAddress &peer_address,
                           const QuicReceivedPacket &packet);
        void ProcessBufferedChlos();

        void OnCanWrite();

        Http3ServerJS *getJS() { return js_; };

    private:
        Http3ServerJS *js_;

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

        DeterministicConnectionIdGenerator connection_id_generator_;
    };

}

#endif
