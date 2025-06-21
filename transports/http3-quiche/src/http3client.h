// Copyright (c) 2022 Marten Richter or other contributers (see commit). All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

// portions taken from libquiche, original copyright, see LICENSE.chromium
// Copyright (c) 2012 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef WT_HTTP3_CLIENT_H
#define WT_HTTP3_CLIENT_H

#include <napi.h>

#include <cstdint>
#include <memory>
#include <string>
#include <queue>

#include "src/librarymain.h"
#include "src/napialarmfactory.h"
#include "src/socketjswriter.h"
#include "src/http3wtsessionvisitor.h"
#include "absl/base/attributes.h"
#include "absl/strings/string_view.h"
#include "quiche/quic/core/crypto/crypto_handshake.h"
#include "quiche/quic/core/http/quic_spdy_client_session.h"
#include "quiche/quic/core/http/quic_spdy_client_stream.h"
#include "quiche/quic/core/quic_config.h"
#include "quiche/quic/core/quic_packet_reader.h"
#include "quiche/quic/platform/api/quic_socket_address.h"
#include "quiche/quic/core/proto/cached_network_parameters_proto.h"
#include "quiche/quic/core/deterministic_connection_id_generator.h"
#include "quiche/quic/core/quic_framer.h"
#include "quiche/quic/core/quic_packet_creator.h"
#include "quiche/quic/core/quic_packets.h"
#include "quiche/common/quiche_linked_hash_map.h"
#include "quiche/quic/core/crypto/web_transport_fingerprint_proof_verifier.h"

namespace quic
{

    class ProofVerifier;
    class QuicServerId;
    class SessionCache;
    class QuicPacketWriterWrapper;
    class Http3EventLoop;
    class Http3Client;

    class Http3ClientJS : public Napi::ObjectWrap<Http3ClientJS>,
                          public EnvGetter
    {
        friend class Http3Client;

    public:
        Http3ClientJS(const Napi::CallbackInfo &info);

        ~Http3ClientJS() {
        }

        Napi::Env getEnv() override
        {
            return Env();
        }

        Napi::Object getValue() override
        {
            return Value();
        }

        // js stuff

        void openWTSession(const Napi::CallbackInfo &info);
        void closeClient(const Napi::CallbackInfo &info);

        void recvPaket(const Napi::CallbackInfo &info);
        void onCanWrite(const Napi::CallbackInfo &info);

        void setHostname(const Napi::CallbackInfo &info);

        static void InitExports(Napi::Env env, Napi::Object exports)
        {
            Napi::Function tplcl =
                ObjectWrap<Http3ClientJS>::DefineClass(env, "Http3WebTransportClient",
                                                       {
                                                           InstanceMethod<&Http3ClientJS::setHostname>("setHostname",
                                                                                                       static_cast<napi_property_attributes>(napi_writable | napi_configurable)),
                                                           InstanceMethod<&Http3ClientJS::openWTSession>("openWTSession",
                                                                                                         static_cast<napi_property_attributes>(napi_writable | napi_configurable)),
                                                           InstanceMethod<&Http3ClientJS::recvPaket>("recvPaket",
                                                                                                     static_cast<napi_property_attributes>(napi_writable | napi_configurable)),
                                                           InstanceMethod<&Http3ClientJS::onCanWrite>("onCanWrite",
                                                                                                      static_cast<napi_property_attributes>(napi_writable | napi_configurable)),
                                                           InstanceMethod<&Http3ClientJS::closeClient>("closeClient",
                                                                                                       static_cast<napi_property_attributes>(napi_writable | napi_configurable)),

                                                       });
            exports.Set("Http3WebTransportClient", tplcl);
        }

        Http3Client *getObj()
        {
            return client_.get();
        }

    protected:
        std::unique_ptr<Http3Client> client_;

        void processClientConnected(bool success);
        void processClientWebtransportSupport();
        void processNewClientSession(Http3WTSession *session);
    };

    class Http3Client : public QuicSpdyStream::Visitor,
                        public ProcessPacketInterface
    {
        friend class Http3ClientJS;

    public:
        Http3Client(Http3ClientJS *js,
            std::unique_ptr<ProofVerifier> proof_verifier,
            std::unique_ptr<SessionCache> session_cache,
            std::unique_ptr<QuicConnectionHelperInterface> helper,
            QuicConfig config,
            const std::vector<std::string>& protocols);

        ~Http3Client() override;

        void setHostname(QuicSocketAddress server_address,
                         const std::string &server_hostname);

        void OnCanWrite();

        // From ProcessPacketInterface. This will be called for each received
        // packet.
        void ProcessPacket(const QuicSocketAddress &self_address,
                           const QuicSocketAddress &peer_address,
                           const QuicReceivedPacket &packet) override;

        // Sets the |user_agent_id| of the |client_|.
        void SetUserAgentID(const std::string &user_agent_id);

        // Wraps data in a quic packet and sends it.
        // ssize_t SendData(const std::string &data, bool last_data);
        /*
        // As above, but |delegate| will be notified when |data| is ACKed.
        ssize_t SendData(
            const std::string& data, bool last_data,
            quiche::QuicheReferenceCountedPointer<QuicAckListenerInterface>
                ack_listener);
      */

        // Clears any outstanding state and sends a simple GET of 'uri' to the
        // server.  Returns 0 if the request failed and no bytes were written.
        void SendRequest(const std::string &uri);
        // Send a request R and a RST_FRAME which resets R, in the same packet.
        void SendRequestAndRstTogether(const std::string &uri);

        // Sends a request containing |headers| and |body| and returns the number of
        // bytes sent (the size of the serialized request headers and body).
        void SendMessageAsync(const quiche::HttpHeaderBlock &headers,
                              absl::string_view body);
        // Sends a request containing |headers| and |body| with the fin bit set to
        // |fin| and returns the number of bytes sent (the size of the serialized
        // request headers and body).
        void SendMessageAsync(const quiche::HttpHeaderBlock &headers,
                              absl::string_view body, bool fin);

        void SendConnectivityProbing();
        void Connect();

        // A spdy session has to call CryptoConnect on top of the regular
        // initialization.
        void InitializeSession();

        // Start the crypto handshake.  This can be done in place of the synchronous
        // Connect(), but callers are responsible for making sure the crypto handshake
        // completes.
        void StartConnect();

        // Returns true if the crypto handshake has yet to establish encryption.
        // Returns false if encryption is active (even if the server hasn't confirmed
        // the handshake) or if the connection has been closed.
        bool EncryptionBeingEstablished();

        void ClearPerRequestState();
        // ssize_t Send(absl::string_view data);
        bool connected() const;
        bool buffer_body() const;
        void set_buffer_body(bool buffer_body);

        // Getters for stream state. Please note, these getters are divided into two
        // groups. 1) returns state which only get updated once a complete response
        // is received. 2) returns state of the oldest active stream which have
        // received partial response (if any).
        // Group 1.
        const quiche::HttpHeaderBlock &response_trailers() const;
        bool response_complete() const;
        int64_t response_body_size() const;
        const std::string &response_body() const;
        // Group 2.
        bool response_headers_complete() const;
        const quiche::HttpHeaderBlock *response_headers() const;
        int64_t response_size() const;
        size_t bytes_read() const;
        size_t bytes_written() const;

        const QuicSocketAddress &address() const;

        // Returns a newly created QuicSpdyClientStream to callback
        void CreateClientStream(std::function<void(QuicSpdyClientStream *)> finish);

        // From QuicSpdyStream::Visitor
        void OnClose(QuicSpdyStream *stream) override;

        // QuicSpdyClientBase::Reponselistener
        void OnCompleteResponse(
            QuicStreamId id, const quiche::HttpHeaderBlock &response_headers,
            const absl::string_view &response_body);

        // Returns nullptr if the maximum number of streams have already been created.
        // QuicSpdyClientStream *GetOrCreateStream();
        // async replacement
        void RunOnStreamMaybeCreateStream(std::function<void(QuicSpdyClientStream *)> finish);

        // Calls GetOrCreateStream(), sends the request on the stream, and
        // stores the request in case it needs to be resent.  If |headers| is
        // null, only the body will be sent on the stream.
        void GetOrCreateStreamAndSendRequest(
            const quiche::HttpHeaderBlock *headers, absl::string_view body, bool fin);

        QuicRstStreamErrorCode stream_error() { return stream_error_; }
        QuicErrorCode connection_error() const;

        // Get the server config map.  Server config must exist.
        const QuicTagValueMap &GetServerConfig();

        void set_auto_reconnect(bool reconnect) { auto_reconnect_ = reconnect; }

        void set_priority(QuicStreamPriority priority) { priority_ = priority; }

        void WaitForWriteToFlush();

        size_t num_requests() const { return num_requests_; }

        size_t num_responses() const { return num_responses_; }

        void set_server_address(const QuicSocketAddress &server_address)
        {
            server_address_ = server_address;
        }

        // Explicitly set the SNI value for this client, overriding the default
        // behavior which extracts the SNI value from the request URL.
        void OverrideSni(const std::string &sni)
        {
            override_sni_set_ = true;
            override_sni_ = sni;
        }

        void Initialize();

        // Given |uri|, populates the fields in |headers| for a simple GET
        // request. If |uri| is a relative URL, the QuicServerId will be
        // use to specify the authority.
        bool PopulateHeaderBlockFromUrl(const std::string &uri,
                                        quiche::HttpHeaderBlock *headers);

        QuicSpdyClientStream *latest_created_stream()
        {
            return latest_created_stream_;
        }

        Http3ClientJS *getJS() { return js_; };

    protected:
        Http3Client();
        Http3Client(const Http3Client &) = delete;
        Http3Client(const Http3Client &&) = delete;
        Http3Client &operator=(const Http3Client &) = delete;
        Http3Client &operator=(const Http3Client &&) = delete;

        // Subclasses may need to explicitly clear the session on destruction
        // if they create it with objects that will be destroyed before this is.
        // You probably want to call this if you override CreateQuicSpdyClientSession.
        void ResetSession() { session_.reset(); }

        void ClearDataToResend();

    private:
        class Http3ClientDataToResend
        {
        public:
            Http3ClientDataToResend(
                std::unique_ptr<quiche::HttpHeaderBlock> headers, absl::string_view body,
                bool fin, Http3Client *client);

            ~Http3ClientDataToResend();

            void Resend();

        protected:
            std::unique_ptr<quiche::HttpHeaderBlock> headers_;
            absl::string_view body_;
            bool fin_;
            Http3Client *client_;
        };

        // PerStreamState of a stream is updated when it is closed.
        struct PerStreamState
        {
            PerStreamState(const PerStreamState &other);
            PerStreamState(QuicRstStreamErrorCode stream_error, bool response_complete,
                           bool response_headers_complete,
                           const quiche::HttpHeaderBlock &response_headers,
                           const absl::string_view response,
                           const quiche::HttpHeaderBlock &response_trailers,
                           uint64_t bytes_read, uint64_t bytes_written,
                           int64_t response_body_size);
            ~PerStreamState();

            QuicRstStreamErrorCode stream_error;
            bool response_complete;
            bool response_headers_complete;
            quiche::HttpHeaderBlock response_headers;
            std::string response;
            quiche::HttpHeaderBlock response_trailers;
            uint64_t bytes_read;
            uint64_t bytes_written;
            int64_t response_body_size;
        };

        // Returns true and set |version| if client can reconnect with a different
        // version.
        bool CanReconnectWithDifferentVersion(ParsedQuicVersion *version) const;

        // Returns true if the corresponding of this client has active requests.
        bool HasActiveRequests();

        ConnectionIdGeneratorInterface &connection_id_generator();

        // Actually clean up |fd|.
        void CleanUpUDPSocketImpl(QuicUdpSocketFd fd);

        bool clientInitialize();

        bool HaveActiveStream();

        bool handleConnecting();

        bool checkSession();

        bool needsToCheckForSession() {
            return finish_stream_open_.size() > 0 && session_->CanOpenNextOutgoingBidirectionalStream();
        }

        // Read oldest received response and remove it from closed_stream_states_.
        // void ReadNextResponse();

        // Clear open_streams_, closed_stream_states_ and reset
        // latest_created_stream_.
        void ClearPerConnectionState();

        // Update latest_created_stream_, add |stream| to open_streams_ and starts
        // tracking its state.
        void SetLatestCreatedStream(QuicSpdyClientStream *stream);

        bool openWTSessionInt(absl::string_view path);

        bool closeClientInt();

        void setJS(Http3ClientJS *js) { js_ = js; };
        Http3ClientJS *js_;

        QuicSpdyClientStream *latest_created_stream_;
        std::map<QuicStreamId, QuicSpdyClientStream *> open_streams_;
        // Received responses of closed streams.
        quiche::QuicheLinkedHashMap<QuicStreamId, PerStreamState>
            closed_stream_states_;

        QuicRstStreamErrorCode stream_error_;

        bool response_complete_;
        bool response_headers_complete_;
        mutable quiche::HttpHeaderBlock response_headers_;

        // Parsed response trailers (if present), copied from the stream in OnClose.
        quiche::HttpHeaderBlock response_trailers_;

        QuicStreamPriority priority_;
        std::string response_;
        // bytes_read_ and bytes_written_ are updated only when stream_ is released;
        // prefer bytes_read() and bytes_written() member functions.
        uint64_t bytes_read_;
        uint64_t bytes_written_;
        // The number of HTTP body bytes received.
        int64_t response_body_size_;
        // True if we tried to connect already since the last call to Disconnect().
        bool connect_attempted_;
        // The client will auto-connect exactly once before sending data.  If
        // something causes a connection reset, it will not automatically reconnect
        // unless auto_reconnect_ is true.
        bool auto_reconnect_;
        // Should we buffer the response body? Defaults to true.
        bool buffer_body_;

        // Keeps track of any data that must be resent upon a subsequent successful
        // connection, in case the client receives a stateless reject.
        std::vector<std::unique_ptr<Http3ClientDataToResend>> data_to_resend_on_connect_;

        // Number of requests/responses this client has sent/received.
        size_t num_requests_;
        size_t num_responses_;

        // If set, this value is used for the connection SNI, overriding the usual
        // logic which extracts the SNI from the request URL.
        bool override_sni_set_ = false;
        std::string override_sni_;

        // from QuicClient

        // |server_id_| is a tuple (hostname, port, is_https) of the server.
        QuicServerId server_id_;

        // Tracks if the client is initialized to connect.
        bool initialized_;

        // Address of the server.
        QuicSocketAddress server_address_;

        // config_ and crypto_config_ contain configuration and cached state about
        // servers.
        QuicConfig config_;
        QuicCryptoClientConfig crypto_config_;

        // Helper to be used by created connections. Must outlive |session_|.
        std::unique_ptr<QuicConnectionHelperInterface> helper_;

        // Alarm factory to be used by created connections. Must outlive |session_|.
        std::unique_ptr<QuicAlarmFactory> alarm_factory_;

        // Writer used to actually send packets to the wire. Must outlive |session_|.
        std::unique_ptr<QuicPacketWriter> writer_;

        // Session which manages streams.
        std::unique_ptr<QuicSpdyClientSession> session_;

        // This vector contains QUIC versions which we currently support.
        // This should be ordered such that the highest supported version is the first
        // element, with subsequent elements in descending order (versions can be
        // skipped as necessary). We will always pick supported_versions_[0] as the
        // initial version to use.
        ParsedQuicVersionVector supported_versions_;

        // The initial value of maximum packet size of the connection.  If set to
        // zero, the default is used.
        QuicByteCount initial_max_packet_length_;

        // The number of hellos sent during the current/latest connection.
        int num_sent_client_hellos_;

        // Used to store any errors that occurred with the overall connection (as
        // opposed to that associated with the last session object).
        QuicErrorCode connection_error_;

        // True when the client is attempting to connect.  Set to false between a call
        // to Disconnect() and the subsequent call to StartConnect().  When
        // connected_or_attempting_connect_ is false, the session object corresponds
        // to the previous client-level connection.
        bool connected_or_attempting_connect_;

        // The debug visitor set on the connection right after it is constructed.
        // Not owned, must be valid for the lifetime of the QuicClientBase instance.
        QuicConnectionDebugVisitor *connection_debug_visitor_;

        // GenerateNewConnectionId creates a random connection ID of this length.
        // Defaults to 8.
        uint8_t server_connection_id_length_;

        // GetClientConnectionId creates a random connection ID of this length.
        // Defaults to 0.
        uint8_t client_connection_id_length_;

        // Stores validated paths.
        std::vector<std::unique_ptr<QuicPathValidationContext>> validated_paths_;

        // True if the kernel supports SO_RXQ_OVFL, the number of packets dropped
        // because the socket would otherwise overflow.
        bool overflow_supported_;

        // If overflow_supported_ is true, this will be the number of packets dropped
        // during the lifetime of the server.
        QuicPacketCount packets_dropped_;

        // If not zero, used to set client's max inbound header size before session
        // initialize.
        size_t max_inbound_header_list_size_ = 0;

        // If true, store the latest response code, headers, and body.
        bool store_response_;
        // HTTP response code from most recent response.
        int latest_response_code_;
        // HTTP/2 headers from most recent response.
        std::string latest_response_headers_;
        // preliminary 100 Continue HTTP/2 headers from most recent response, if any.
        std::string preliminary_response_headers_;
        // HTTP/2 headers from most recent response.
        quiche::HttpHeaderBlock latest_response_header_block_;
        // Body of most recent response.
        std::string latest_response_body_;
        // HTTP/2 trailers from most recent response.
        std::string latest_response_trailers_;

        int max_reads_per_loop_;

        // Point to a QuicPacketReader object on the heap. The reader allocates more
        // space than allowed on the stack.
        std::unique_ptr<QuicPacketReader> packet_reader_;

        DeterministicConnectionIdGenerator connection_id_generator_{
            kQuicDefaultConnectionIdLength};

        // connection workflow
        bool wait_for_encryption_;
        bool connection_in_progress_;
        uint32_t num_attempts_connect_;
        bool webtransport_server_support_inform_;

        bool connectionrecheck_;

        std::queue<std::function<void(QuicSpdyClientStream *)>> finish_stream_open_;
        std::vector<std::string> protocols_;
    };

} // namespace quic

#endif // QUICHE_QUIC_TEST_TOOLS_QUIC_TEST_CLIENT_H_
