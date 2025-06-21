// Copyright (c) 2022 Marten Richter or other contributers (see commit). All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

// portions taken from libquiche or Chromium, original copyright, see LICENSE.chromium
// Copyright (c) 2012 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "src/http3client.h"
#include "src/http3clientsession.h"
#include "src/http3wtsessionvisitor.h"
#include "src/http3sessioncache.h"

#include <memory>
#include <utility>
#include <vector>

#include "absl/strings/match.h"
#include "absl/strings/string_view.h"
#include "absl/cleanup/cleanup.h"
#include "openssl/x509.h"
#include "quiche/quic/core/crypto/proof_verifier.h"
#include "quiche/quic/core/http/quic_spdy_client_stream.h"
#include "quiche/quic/core/http/spdy_utils.h"
#include "quiche/quic/core/http/web_transport_http3.h"
#include "quiche/quic/core/web_transport_interface.h"
#include "quiche/quic/core/quic_default_packet_writer.h"
#include "quiche/quic/core/quic_default_connection_helper.h"
#include "quiche/quic/core/quic_default_clock.h"
#include "quiche/quic/core/quic_packet_writer_wrapper.h"
#include "quiche/quic/core/quic_server_id.h"
#include "quiche/quic/core/quic_utils.h"
#include "quiche/quic/platform/api/quic_flags.h"
#include "quiche/quic/platform/api/quic_logging.h"
#include "quiche/quic/platform/api/quic_stack_trace.h"
// #include "quiche/quic/test_tools/crypto_test_utils.h"
#include "quiche/quic/core/quic_udp_socket.h"
#include "quiche/quic/tools/quic_url.h"
#include "quiche/common/quiche_text_utils.h"
#include "quiche/web_transport/web_transport_headers.h"

using quiche::HttpHeaderBlock;

namespace quic
{

    // taken from chromium to behave like the browser
    // A version of WebTransportFingerprintProofVerifier that enforces
    // Chromium-specific policies.
    class ChromiumWebTransportFingerprintProofVerifier
        : public quic::WebTransportFingerprintProofVerifier
    {
    public:
        using WebTransportFingerprintProofVerifier::
            WebTransportFingerprintProofVerifier;

    protected:
        bool IsKeyTypeAllowedByPolicy(
            const quic::CertificateView &certificate) override
        {
            if (certificate.public_key_type() == quic::PublicKeyType::kRsa)
            {
                return false;
            }
            return WebTransportFingerprintProofVerifier::IsKeyTypeAllowedByPolicy(
                certificate);
        }
    };

    class NodeJSProofVerifier : public quic::ProofVerifier
    {
    public:

        NodeJSProofVerifier(EnvGetter *envg) : envg_(envg)
        {

        }

        QuicAsyncStatus VerifyProof(
            const std::string& hostname, const uint16_t port,
            const std::string& server_config, QuicTransportVersion transport_version,
            absl::string_view chlo_hash, const std::vector<std::string>& certs,
            const std::string& cert_sct, const std::string& signature,
            const ProofVerifyContext* context, std::string* error_details,
            std::unique_ptr<ProofVerifyDetails>* details,
            std::unique_ptr<ProofVerifierCallback> callback) {
                auto env = envg_->getEnv();
                Napi::HandleScope scope(env);
                
                Napi::Object retObj = Napi::Object::New(env);
                retObj.Set("hostname", hostname);
                retObj.Set("port", port);
                retObj.Set("serverconfig", server_config);

                Napi::Array jscerts = Napi::Array::New(env, certs.size());
                for (size_t i = 0; i < certs.size(); i++) {
                    jscerts.Set(i, Napi::Buffer<uint8_t>::Copy(env,
                            reinterpret_cast<const uint8_t*>(certs[i].data()),
                             certs[i].size()));
                }
                retObj.Set("certs", jscerts);
                retObj.Set("signature", signature);

                Napi::Value verifyres = env.Global().Get("FAILSVerifyProof").As<Napi::Function>().Call({
                    retObj });
                if (verifyres.As<Napi::Boolean>().Value()) {
                    return QUIC_SUCCESS;

                } else {
                    return QUIC_FAILURE;
                }
        }

        QuicAsyncStatus VerifyCertChain(
            const std::string& hostname, const uint16_t port,
            const std::vector<std::string>& certs, const std::string& ocsp_response,
            const std::string& cert_sct, const ProofVerifyContext* context,
            std::string* error_details, std::unique_ptr<ProofVerifyDetails>* details,
            uint8_t* out_alert, std::unique_ptr<ProofVerifierCallback> callback) {
                auto env = envg_->getEnv();
                Napi::HandleScope scope(env);
                
                Napi::Object retObj = Napi::Object::New(env);
                retObj.Set("hostname", hostname);
                retObj.Set("port", port);
                // todo certs

                Napi::Array jscerts = Napi::Array::New(env, certs.size());
                for (size_t i = 0; i < certs.size(); i++) {
                    jscerts.Set(i, Napi::Buffer<uint8_t>::Copy(env,
                            reinterpret_cast<const uint8_t*>(certs[i].data()),
                             certs[i].size()));
                }
                retObj.Set("certs", jscerts);
                Napi::Value verifyres = env.Global().Get("FAILSVerifyProof").As<Napi::Function>().Call({
                    retObj });
                if (verifyres.As<Napi::Boolean>().Value()) {
                    return QUIC_SUCCESS;
                } else {
                    return QUIC_FAILURE;
                }
        }

        std::unique_ptr<ProofVerifyContext> CreateDefaultContext() {
            return nullptr;
        }
  
    private:
        EnvGetter *envg_;
    };

    QuicStreamId GetNthClientInitiatedBidirectionalStreamId(
        QuicTransportVersion version, int n)
    {
        int num = n;
        if (!VersionUsesHttp3(version))
        {
            num++;
        }
        return QuicUtils::GetFirstBidirectionalStreamId(version,
                                                        Perspective::IS_CLIENT) +
               QuicUtils::StreamIdDelta(version) * num;
    }

    Http3Client::Http3Client(Http3ClientJS *js, 
                             std::unique_ptr<ProofVerifier> proof_verifier,
                             std::unique_ptr<SessionCache> session_cache,
                             std::unique_ptr<QuicConnectionHelperInterface> helper,
                             QuicConfig config,
                             const std::vector<std::string>& protocols) :
          initialized_(false),
          store_response_(false),
          latest_response_code_(-1),
          overflow_supported_(false),
          packets_dropped_(0),
          packet_reader_(new QuicPacketReader()),
          config_(config),
          crypto_config_(std::move(proof_verifier), std::move(session_cache)),
          helper_(std::move(helper)),
          alarm_factory_(new NapiAlarmFactory(QuicDefaultClock::Get(), js)),
          supported_versions_({ParsedQuicVersion::RFCv1()}),
          initial_max_packet_length_(0),
          num_sent_client_hellos_(0),
          js_(js),
          connection_error_(QUIC_NO_ERROR),
          connected_or_attempting_connect_(false),
          server_connection_id_length_(kQuicDefaultConnectionIdLength),
          client_connection_id_length_(0),
          max_reads_per_loop_(std::numeric_limits<int>::max()),
          wait_for_encryption_(false),
          connection_in_progress_(false),
          connectionrecheck_(false),
          num_attempts_connect_(0),
          webtransport_server_support_inform_(false),
          connection_debug_visitor_(nullptr),
          priority_(HttpStreamPriority()),
          protocols_(protocols)
    {
       
    }

    Http3Client::~Http3Client()
    {
        // printf("client destruct %x\n", this);
    }

    void Http3Client::setHostname(QuicSocketAddress server_address, const std::string &server_hostname)
    {
        server_id_ = QuicServerId(server_hostname, server_address.port());
        set_server_address(server_address);
        Initialize();
    }

    bool Http3Client::closeClientInt()
    {
        for (std::pair<QuicStreamId, QuicSpdyClientStream *> stream : open_streams_)
        {
            stream.second->set_visitor(nullptr);
        }
        if (connected())
        {
            session_->connection()->CloseConnection(
                QUIC_PEER_GOING_AWAY, "Client being torn down",
                ConnectionCloseBehavior::SEND_CONNECTION_CLOSE_PACKET);
        }
        // We own the push promise index. We need to explicitly kill
        // the session before the push promise index goes out of scope.
        ResetSession();

        this->getJS()->Unref();
        return true;
    }

    void Http3Client::Initialize()
    {
        priority_ = QuicStreamPriority(HttpStreamPriority());
        connect_attempted_ = false;
        auto_reconnect_ = false;
        buffer_body_ = true;
        num_requests_ = 0;
        num_responses_ = 0;
        ClearPerConnectionState();
        // As chrome will generally do this, we want it to be the default when it's
        // not overridden.
        if (!config_.HasSetBytesForConnectionIdToSend())
        {
            config_.SetBytesForConnectionIdToSend(0);
        }
    }

    void Http3Client::SetUserAgentID(const std::string &user_agent_id)
    {
        crypto_config_.set_user_agent_id(user_agent_id);
    }

    void Http3Client::SendRequest(const std::string &uri)
    {
        quiche::HttpHeaderBlock headers;
        if (!PopulateHeaderBlockFromUrl(uri, &headers))
        {
            return;
        }
        SendMessageAsync(headers, "");
    }

    void Http3Client::SendRequestAndRstTogether(const std::string &uri)
    {
        quiche::HttpHeaderBlock headers;
        if (!PopulateHeaderBlockFromUrl(uri, &headers))
        {
            return;
        }

        QuicSpdyClientSession *session = session_.get();
        QuicConnection::ScopedPacketFlusher flusher(session->connection());
        SendMessageAsync(headers, "", /*fin=*/true);

        QuicStreamId stream_id = GetNthClientInitiatedBidirectionalStreamId(
            session->transport_version(), 0);
        session->ResetStream(stream_id, QUIC_STREAM_CANCELLED);
    }

    void Http3Client::GetOrCreateStreamAndSendRequest(
        const quiche::HttpHeaderBlock *headers, absl::string_view body, bool fin)
    {
        std::shared_ptr<quiche::HttpHeaderBlock> spdy_headers;
        bool hasheaders = false;
        if (headers != nullptr)
        {
            spdy_headers = std::make_shared<quiche::HttpHeaderBlock>(headers->Clone());
            hasheaders = true;
        }

        // Maybe it's better just to overload this.  it's just that we need
        // for the GetOrCreateStream function to call something else...which
        // is icky and complicated, but maybe not worse than this.
        RunOnStreamMaybeCreateStream(
            [spdy_headers, hasheaders, body, fin, this](QuicSpdyClientStream *stream)
            {
                if (stream == nullptr)
                {
                    return;
                }
                // QuicSpdyStreamPeer::set_ack_listener(stream, ack_listener);

                size_t ret = 0;
                if (hasheaders)
                {
                    if ((*spdy_headers.get())[":authority"].as_string().empty())
                    {
                        (*spdy_headers.get())[":authority"] = server_id_.host();
                    }
                    ret = stream->SendRequest(std::move(*spdy_headers.get()), body, fin);
                    ++num_requests_;
                }
                else
                {
                    stream->WriteOrBufferBody(std::string(body), fin);
                    ret = body.length();
                }
            });
    }

    void Http3Client::SendMessageAsync(const quiche::HttpHeaderBlock &headers,
                                       absl::string_view body)
    {
        return SendMessageAsync(headers, body, /*fin=*/true);
    }

    void Http3Client::SendMessageAsync(const quiche::HttpHeaderBlock &headers,
                                       absl::string_view body, bool fin)
    {
        // Always force creation of a stream for SendMessage.
        latest_created_stream_ = nullptr;

        GetOrCreateStreamAndSendRequest(&headers, body, fin);
    }

    bool Http3Client::response_complete() const { return response_complete_; }

    int64_t Http3Client::response_body_size() const
    {
        return response_body_size_;
    }

    bool Http3Client::buffer_body() const { return buffer_body_; }

    void Http3Client::set_buffer_body(bool buffer_body)
    {
        buffer_body_ = buffer_body;
    }

    const std::string &Http3Client::response_body() const { return response_; }

    void Http3Client::SendConnectivityProbing()
    {
        QuicConnection *connection = session_->connection();
        connection->SendConnectivityProbingPacket(connection->writer(),
                                                  connection->peer_address());
    }

    void Http3Client::SetLatestCreatedStream(QuicSpdyClientStream *stream)
    {
        latest_created_stream_ = stream;
        if (latest_created_stream_ != nullptr)
        {
            open_streams_[stream->id()] = stream;
            stream->set_visitor(this);
        }
    }

    void Http3Client::CreateClientStream(std::function<void(QuicSpdyClientStream *)> finish)
    {
        if (!connected())
        {
            finish(nullptr);
        }
        finish_stream_open_.push(finish);

        checkSession(); // check if it is already available
        /*
        if (VersionHasIetfQuicFrames(session_->transport_version()))
        {
            // Process MAX_STREAMS from peer or wait for liveness testing succeeds.
            while (!session_->CanOpenNextOutgoingBidirectionalStream())
            {
                RunEventLoop();
            }
        }
        auto *stream = static_cast<QuicSpdyClientStream *>(
            session_->CreateOutgoingBidirectionalStream());
        if (stream)
        {
            stream->set_visitor(this);
        }
        return stream; */
    }

    void Http3Client::RunOnStreamMaybeCreateStream(std::function<void(QuicSpdyClientStream *)> finish)
    {
        if (!connect_attempted_ || auto_reconnect_)
        {
            if (!connected())
            {
                Connect();
            }
            if (!connected())
            {
                finish(nullptr);
                return;
            }
        }
        if (open_streams_.empty())
        {
            ClearPerConnectionState();
        }
        if (!latest_created_stream_)
        {
            CreateClientStream(
                [this, finish](QuicSpdyClientStream *stream)
                {
                    SetLatestCreatedStream(stream);
                    if (latest_created_stream_)
                    {
                        latest_created_stream_->SetPriority(priority_);
                    }
                    finish(latest_created_stream_);
                });
        }
        else
        {
            finish(latest_created_stream_);
        }
    }

    QuicErrorCode Http3Client::connection_error() const
    {
        // Return the high-level error if there was one.  Otherwise, return the
        // connection error from the last session.
        if (connection_error_ != QUIC_NO_ERROR)
        {
            return connection_error_;
        }
        if (session_ == nullptr)
        {
            return QUIC_NO_ERROR;
        }
        return session_->error();
    }

    const QuicTagValueMap &Http3Client::GetServerConfig()
    {
        const QuicCryptoClientConfig::CachedState *state =
            crypto_config_.LookupOrCreate(server_id_);
        const CryptoHandshakeMessage *handshake_msg = state->GetServerConfig();
        return handshake_msg->tag_value_map();
    }

    bool Http3Client::connected() const
    {
        return session_.get() && session_->connection() &&
               session_->connection()->connected();
    }

    bool Http3Client::clientInitialize()
    {
        num_sent_client_hellos_ = 0;
        connection_error_ = QUIC_NO_ERROR;
        connected_or_attempting_connect_ = false;

        // If an initial flow control window has not explicitly been set, then use the
        // same values that Chrome uses.
        const uint32_t kSessionMaxRecvWindowSize = 15 * 1024 * 1024; // 15 MB
        const uint32_t kStreamMaxRecvWindowSize = 6 * 1024 * 1024;   //  6 MB
        if (config_.GetInitialStreamFlowControlWindowToSend() ==
            kDefaultFlowControlSendWindow)
        {
            config_.SetInitialStreamFlowControlWindowToSend(kStreamMaxRecvWindowSize);
        }
        if (config_.GetInitialSessionFlowControlWindowToSend() ==
            kDefaultFlowControlSendWindow)
        {
            config_.SetInitialSessionFlowControlWindowToSend(
                kSessionMaxRecvWindowSize);
        }

        initialized_ = true;
        return true;
    }

    void Http3Client::Connect()
    {
        if (connected())
        {
            QUIC_BUG(quic_bug_10133_1) << "Cannot connect already-connected client";
            return;
        }
        if (!connect_attempted_)
        {
            clientInitialize();
        }

        // If we've been asked to override SNI, set it now
        if (override_sni_set_)
        {
            // This should only be set before the initial Connect()
            server_id_ = QuicServerId(override_sni_, address().port());
        }
        connection_in_progress_ = true;
        connectionrecheck_ = true;
        wait_for_encryption_ = false;
    }

    bool Http3Client::handleConnecting()
    {
        bool recheck = false;
        if (connection_in_progress_)
        {
            if (!wait_for_encryption_)
            {
                if (!connected() && num_attempts_connect_ <= QuicCryptoClientStream::kMaxClientHellos)
                {
                    if (!connect_attempted_)
                    {
                        clientInitialize();
                    }
                    StartConnect();
                    wait_for_encryption_ = true;
                }
                else if (session_ == nullptr && num_attempts_connect_ > QuicCryptoClientStream::kMaxClientHellos)
                {
                    connection_in_progress_ = false;
                    connect_attempted_ = true;
                    QUIC_BUG(quic_bug_10906_1) << "Missing session after Connect";
                    getJS()->processClientConnected(false);
                }
            }
            if (wait_for_encryption_)
            {
                if (EncryptionBeingEstablished())
                    return true;
                wait_for_encryption_ = false;
                ParsedQuicVersion version = UnsupportedQuicVersion();
                if (session_ != nullptr && !CanReconnectWithDifferentVersion(&version) && !session_->connection()->connected())
                {
                    // We've successfully created a session but we're not connected, and we
                    // cannot reconnect with a different version.  Give up trying.
                    connection_in_progress_ = false;
                    connect_attempted_ = true;
                    getJS()->processClientConnected(false);
                }
                else if (session_ != nullptr && session_->connection()->connected())
                {
                    connect_attempted_ = true;
                    connection_in_progress_ = false;
                    getJS()->processClientConnected(true);
                    webtransport_server_support_inform_ = true;
                    recheck = true;
                }
                else
                {
                    num_attempts_connect_++;
                    recheck = true;
                }
            }
        }
        if (webtransport_server_support_inform_ && connected())
        {
            if (session_->SupportsWebTransport())
            {
                getJS()->processClientWebtransportSupport();
                webtransport_server_support_inform_ = false;
            }
            else
                recheck = true;
        }

        return recheck;
    }

    bool Http3Client::checkSession()
    {
        while (finish_stream_open_.size() > 0 && session_->CanOpenNextOutgoingBidirectionalStream())
        {
            auto *stream = static_cast<QuicSpdyClientStream *>(
                session_->CreateOutgoingBidirectionalStream());
            if (stream)
            {
                stream->set_visitor(this);
            }
            finish_stream_open_.front()(stream);
            if (stream != nullptr)
            {
                if (stream->web_transport() != nullptr)
                {
                    WebTransportSessionId id = stream->id();
                    WebTransportHttp3 *wtsession = session_->GetWebTransportSession(id);
                    if (wtsession == nullptr)
                    {
                        getJS()->processNewClientSession(nullptr);
                        // may be throw error
                    }
                    else
                    {
                        // ok we have our session, do we wait for session ready, no set visitor immediatele
                        Http3WTSession *wtsessionobj =
                            new Http3WTSession();
                        wtsessionobj->init(
                            static_cast<WebTransportSession *>(wtsession));
                        getJS()->processNewClientSession(wtsessionobj);
                        auto visitor = std::make_unique<Http3WTSession::Visitor>(wtsessionobj);
                        static_cast<Http3ClientSession *>(session_.get())->AddVisitor(id, visitor.get());
                        wtsession->SetVisitor(std::move(visitor));
                    }
                }
            }
            finish_stream_open_.pop();
        }

        return finish_stream_open_.size() > 0;
    }

    bool Http3Client::openWTSessionInt(absl::string_view path)
    {
        quiche::HttpHeaderBlock headers;
        headers[":scheme"] = "https";
        headers[":authority"] = "localhost";
        headers[":path"] = path;
        headers[":method"] = "CONNECT";
        headers[":protocol"] = "webtransport";
        if (protocols_.size() > 0) {
            absl::StatusOr<std::string> wtavail = webtransport::SerializeSubprotocolRequestHeader(protocols_);
            if (!wtavail.ok()) {
                return false;
            }
            headers["wt-available-protocols"] = *wtavail;
        }
        SendMessageAsync(headers, "", /*fin=*/false);
        return true;
    }

    void Http3Client::StartConnect()
    {
        QUICHE_DCHECK(initialized_);
        QUICHE_DCHECK(!connected());
        QuicPacketWriter *writer = new SocketJSWriter(getJS());
        ParsedQuicVersion mutual_version = UnsupportedQuicVersion();
        const bool can_reconnect_with_different_version =
            CanReconnectWithDifferentVersion(&mutual_version);
        if (connected_or_attempting_connect_)
        {
            // Clear queued up data if client can not try to connect with a different
            // version.
            if (!can_reconnect_with_different_version)
            {
                ClearDataToResend();
            }
            // Before we destroy the last session and create a new one, gather its stats
            // and update the stats for the overall connection.
            // no stats for me!
            // UpdateStats();
        }
        QuicConnectionId newconnid = QuicUtils::CreateRandomConnectionId(server_connection_id_length_);

        const quic::ParsedQuicVersionVector client_supported_versions =
            can_reconnect_with_different_version
                ? ParsedQuicVersionVector{mutual_version}
                : supported_versions_;

        session_ = std::make_unique<Http3ClientSession>(
            config_, client_supported_versions, new QuicConnection(newconnid, QuicSocketAddress(), server_address_, helper_.get(), alarm_factory_.get(), writer,
                                                                   /* owns_writer= */ false, Perspective::IS_CLIENT, client_supported_versions, connection_id_generator_),
            server_id_, &crypto_config_,
            false /*drop_response_body_*/, true /* enable_web_transport */);

        if (can_reconnect_with_different_version)
        {
            session_->set_client_original_supported_versions(supported_versions_);
        }
        if (connection_debug_visitor_ != nullptr)
        {
            session_->connection()->set_debug_visitor(connection_debug_visitor_);
        }
        session_->connection()->set_client_connection_id(
            QuicUtils::CreateRandomConnectionId(client_connection_id_length_));
        if (initial_max_packet_length_ != 0)
        {
            session_->connection()->SetMaxPacketLength(initial_max_packet_length_);
        }
        // Reset |writer()| after |session()| so that the old writer outlives the old
        // session.
        if (writer_.get() != writer)
        {
            writer_.reset(writer);
        }
        // set_writer(writer);
        InitializeSession();
        if (can_reconnect_with_different_version)
        {
            // This is a reconnect using server supported |mutual_version|.
            session_->connection()->SetVersionNegotiated();
        }
        connected_or_attempting_connect_ = true;
    }

    void Http3Client::InitializeSession()
    {
        if (max_inbound_header_list_size_ > 0)
        {
            session_->set_max_inbound_header_list_size(
                max_inbound_header_list_size_);
        }
        session_->Initialize();
        session_->CryptoConnect();
    }

    bool Http3Client::CanReconnectWithDifferentVersion(
        ParsedQuicVersion *version) const
    {
        if (session_ == nullptr || session_->connection() == nullptr ||
            session_->error() != QUIC_INVALID_VERSION)
        {
            return false;
        }

        const auto &server_supported_versions =
            session_->connection()->server_supported_versions();
        if (server_supported_versions.empty())
        {
            return false;
        }

        for (const auto &client_version : supported_versions_)
        {
            if (std::find(server_supported_versions.begin(),
                          server_supported_versions.end(),
                          client_version) != server_supported_versions.end())
            {
                *version = client_version;
                return true;
            }
        }
        return false;
    }

    bool Http3Client::EncryptionBeingEstablished()
    {
        return !session_->IsEncryptionEstablished() &&
               session_->connection()->connected();
    }

    bool Http3Client::HasActiveRequests()
    {
        return session_->HasActiveRequestStreams();
    }

    void Http3Client::ClearPerRequestState()
    {
        stream_error_ = QUIC_STREAM_NO_ERROR;
        response_ = "";
        response_complete_ = false;
        response_headers_complete_ = false;
        response_headers_.clear();
        response_trailers_.clear();
        bytes_read_ = 0;
        bytes_written_ = 0;
        response_body_size_ = 0;
    }

    void Http3Client::ClearDataToResend()
    {
        data_to_resend_on_connect_.clear();
    }

    bool Http3Client::HaveActiveStream()
    {
        return !open_streams_.empty();
    }

    void Http3ClientJS::recvPaket(const Napi::CallbackInfo &info)
    {
        QuicTime now = QuicDefaultClock::Get()->Now();
        // Got a packet replace OnSocketEvent for readable
        if (info[0].IsUndefined())
        {
            Napi::Error::New(Env(), "No obj passed to recvPaket").ThrowAsJavaScriptException();
        }
        Napi::Object lobj = info[0].ToObject();
        if (lobj.IsEmpty())
        {
            Napi::Error::New(Env(), "Obj for recvPaket is empty").ThrowAsJavaScriptException();
        }
        if (!lobj.Has("selfaddress"))
        {
            Napi::Error::New(Env(), "No Selfaddress for recvPaket").ThrowAsJavaScriptException();
        }
        Napi::Object selfaddress = (lobj).Get("selfaddress").As<Napi::Object>();
        if (selfaddress.IsEmpty())
        {
            Napi::Error::New(Env(), "Selfaddress for recvPaket empty").ThrowAsJavaScriptException();
        }
        int port = selfaddress.Get("port").As<Napi::Number>().Int32Value();
        std::string selfipaddress = selfaddress.Get("address").As<Napi::String>();

        QuicIpAddress self_ip;
        self_ip.FromString(selfipaddress);
        QuicSocketAddress self_address(self_ip, port);

        if (!lobj.Has("rinfo"))
        {
            Napi::Error::New(Env(), "No rinfo for recvPaket").ThrowAsJavaScriptException();
        }

        Napi::Object rinfo = (lobj).Get("rinfo").As<Napi::Object>();
        if (rinfo.IsEmpty())
        {
            Napi::Error::New(Env(), "Rinfo for recvPaket empty").ThrowAsJavaScriptException();
        }
        int peerport = rinfo.Get("port").As<Napi::Number>().Int32Value();
        std::string peeripaddress = rinfo.Get("address").As<Napi::String>();

        QuicIpAddress peer_ip;
        peer_ip.FromString(peeripaddress);
        QuicSocketAddress peer_address(peer_ip, peerport);

        Napi::Object bufferlocal = lobj.Get("msg").As<Napi::Object>();

        QuicReceivedPacket packet(
            bufferlocal.As<Napi::Buffer<char>>().Data(), rinfo.Get("size").As<Napi::Number>().Uint32Value(), now,
            /*owns_buffer=*/false, 0 /*ttl*/, false /*has_ttl*/, nullptr /*headers*/, 0 /*headers_length*/,
            /*owns_header_buffer=*/false, ECN_NOT_ECT);

        client_->ProcessPacket(self_address, peer_address, packet);

        if (client_->connectionrecheck_)
        {
            client_->connectionrecheck_ = client_->handleConnecting();
        }
        if (client_->needsToCheckForSession()) client_->checkSession();
    }

    void Http3ClientJS::onCanWrite(const Napi::CallbackInfo &info)
    {
        if (client_->connectionrecheck_)
        {
            client_->connectionrecheck_ = client_->handleConnecting();
        }
        if (client_->needsToCheckForSession()) client_->checkSession();
        client_->OnCanWrite();
    }

    void Http3Client::OnCanWrite()
    {
        writer_->SetWritable();
        if (connected())
        {
            session_->connection()->OnCanWrite();
        }
    }

/*
    void Http3Client::OnSocketEvent(QuicEventLoop *event_loop, QuicUdpSocketFd fd,
                                    QuicSocketEventMask events)
    {
        /*if (events & kSocketEventReadable)
        {
            QUIC_DVLOG(1) << "Read packets on kSocketEventReadable";
            int times_to_read = max_reads_per_loop_;
            bool more_to_read = true;
            QuicPacketCount packets_dropped = 0;
            while (connected() && more_to_read && times_to_read > 0)
            {
                more_to_read = packet_reader_->ReadAndDispatchPackets(
                    fd, GetLatestClientAddress().port(), *helper_->GetClock(),
                    this, overflow_supported_ ? &packets_dropped : nullptr);
                --times_to_read;
            }
            if (packets_dropped_ < packets_dropped)
            {
                QUIC_LOG(ERROR)
                    << packets_dropped - packets_dropped_
                    << " more packets are dropped in the socket receive buffer.";
                packets_dropped_ = packets_dropped;
            }
            if (connected() && more_to_read)
            {
                // Register EPOLLIN event to consume buffered CHLO(s).
                bool success =
                    event_loop->ArtificiallyNotifyEvent(fd, kSocketEventReadable);
                QUICHE_DCHECK(success);
            }
            else if (!event_loop->SupportsEdgeTriggered())
            {
                bool success = event_loop->RearmSocket(fd, kSocketEventReadable);
                QUICHE_DCHECK(success);
            }
        }*/
        /*if (connected() && (events & kSocketEventWritable))
        {
            writer_->SetWritable();
            session_->connection()->OnCanWrite();
        }

        if (handleConnecting())
        {
            bool success =
                event_loop->ArtificiallyNotifyEvent(fd, kSocketEventReadable);
            QUICHE_DCHECK(success);
        }
    }*/

    void Http3Client::ProcessPacket(
        const QuicSocketAddress &self_address,
        const QuicSocketAddress &peer_address, const QuicReceivedPacket &packet)
    {
        if (connected()) session_->ProcessUdpPacket(self_address, peer_address, packet);
    }

    bool Http3Client::response_headers_complete() const
    {
        for (std::pair<QuicStreamId, QuicSpdyClientStream *> stream : open_streams_)
        {
            if (stream.second->headers_decompressed())
            {
                return true;
            }
        }
        return response_headers_complete_;
    }

    const quiche::HttpHeaderBlock *Http3Client::response_headers() const
    {
        for (std::pair<QuicStreamId, QuicSpdyClientStream *> stream : open_streams_)
        {
            if (stream.second->headers_decompressed())
            {
                response_headers_ = stream.second->response_headers().Clone();
                break;
            }
        }
        return &response_headers_;
    }

    const quiche::HttpHeaderBlock &Http3Client::response_trailers() const
    {
        return response_trailers_;
    }

    int64_t Http3Client::response_size() const { return bytes_read(); }

    size_t Http3Client::bytes_read() const
    {
        for (std::pair<QuicStreamId, QuicSpdyClientStream *> stream : open_streams_)
        {
            size_t bytes_read = stream.second->total_body_bytes_read() +
                                stream.second->header_bytes_read();
            if (bytes_read > 0)
            {
                return bytes_read;
            }
        }
        return bytes_read_;
    }

    size_t Http3Client::bytes_written() const
    {
        for (std::pair<QuicStreamId, QuicSpdyClientStream *> stream : open_streams_)
        {
            size_t bytes_written = stream.second->stream_bytes_written() +
                                   stream.second->header_bytes_written();
            if (bytes_written > 0)
            {
                return bytes_written;
            }
        }
        return bytes_written_;
    }

    void Http3Client::OnCompleteResponse(
        QuicStreamId id, const quiche::HttpHeaderBlock &response_headers,
        const absl::string_view &response_body)
    {
        // implement
    }

    void Http3Client::OnClose(QuicSpdyStream *stream)
    {
        if (stream == nullptr)
        {
            return;
        }
        // Always close the stream, regardless of whether it was the last stream
        // written.
        QUICHE_DCHECK(stream != nullptr);
        QuicSpdyClientStream *client_stream =
            static_cast<QuicSpdyClientStream *>(stream);

        const HttpHeaderBlock &response_headers = client_stream->response_headers();

        OnCompleteResponse(stream->id(), response_headers, client_stream->data());

        // Store response headers and body.
        if (store_response_)
        {
            auto status = response_headers.find(":status");
            if (status == response_headers.end())
            {
                QUIC_LOG(ERROR) << "Missing :status response header";
            }
            else if (!absl::SimpleAtoi(status->second, &latest_response_code_))
            {
                QUIC_LOG(ERROR) << "Invalid :status response header: " << status->second;
            }
            latest_response_headers_ = response_headers.DebugString();
            for (const HttpHeaderBlock &headers :
                 client_stream->preliminary_headers())
            {
                absl::StrAppend(&preliminary_response_headers_, headers.DebugString());
            }
            latest_response_header_block_ = response_headers.Clone();
            latest_response_body_ = client_stream->data();
            latest_response_trailers_ =
                client_stream->received_trailers().DebugString();
        }
        ++num_responses_;
        if (open_streams_.find(stream->id()) == open_streams_.end())
        {
            return;
        }
        if (latest_created_stream_ == stream)
        {
            latest_created_stream_ = nullptr;
        }

        QuicStreamId id = client_stream->id();
        closed_stream_states_.insert(std::make_pair(
            id,
            PerStreamState(
                // Set response_complete to true iff stream is closed while connected.
                client_stream->stream_error(), connected(),
                client_stream->headers_decompressed(),
                client_stream->response_headers(),
                (buffer_body() ? client_stream->data() : ""),
                client_stream->received_trailers(),
                // Use NumBytesConsumed to avoid counting retransmitted stream frames.
                client_stream->total_body_bytes_read() +
                    client_stream->header_bytes_read(),
                client_stream->stream_bytes_written() +
                    client_stream->header_bytes_written(),
                client_stream->data().size())));
        open_streams_.erase(id);
    }

    const QuicSocketAddress &Http3Client::address() const
    {
        return server_address_;
    }

    Http3Client::Http3ClientDataToResend::Http3ClientDataToResend(
        std::unique_ptr<quiche::HttpHeaderBlock> headers, absl::string_view body,
        bool fin, Http3Client *client)
        : headers_(std::move(headers)), body_(body), fin_(fin),
          client_(client) {}

    Http3Client::Http3ClientDataToResend::~Http3ClientDataToResend() = default;

    void Http3Client::Http3ClientDataToResend::Resend()
    {
        client_->GetOrCreateStreamAndSendRequest(headers_.get(), body_, fin_);
        headers_.reset();
    }

    Http3Client::PerStreamState::PerStreamState(const PerStreamState &other)
        : stream_error(other.stream_error),
          response_complete(other.response_complete),
          response_headers_complete(other.response_headers_complete),
          response_headers(other.response_headers.Clone()),
          response(other.response),
          response_trailers(other.response_trailers.Clone()),
          bytes_read(other.bytes_read),
          bytes_written(other.bytes_written),
          response_body_size(other.response_body_size) {}

    Http3Client::PerStreamState::PerStreamState(
        QuicRstStreamErrorCode stream_error, bool response_complete,
        bool response_headers_complete,
        const quiche::HttpHeaderBlock &response_headers,
        const absl::string_view response, const quiche::HttpHeaderBlock &response_trailers,
        uint64_t bytes_read, uint64_t bytes_written, int64_t response_body_size)
        : stream_error(stream_error),
          response_complete(response_complete),
          response_headers_complete(response_headers_complete),
          response_headers(response_headers.Clone()),
          response(response),
          response_trailers(response_trailers.Clone()),
          bytes_read(bytes_read),
          bytes_written(bytes_written),
          response_body_size(response_body_size) {}

    Http3Client::PerStreamState::~PerStreamState() = default;

    bool Http3Client::PopulateHeaderBlockFromUrl(
        const std::string &uri, quiche::HttpHeaderBlock *headers)
    {
        std::string url;
        if (absl::StartsWith(uri, "https://") || absl::StartsWith(uri, "http://"))
        {
            url = uri;
        }
        else if (uri[0] == '/')
        {
            url = "https://" + server_id_.host() + uri;
        }
        else
        {
            url = "https://" + uri;
        }
        return SpdyUtils::PopulateHeaderBlockFromUrl(url, headers);
    }

    /*
        void Http3Client::ReadNextResponse()
        {
            if (closed_stream_states_.empty())
            {
                return;
            }

            PerStreamState state(closed_stream_states_.front().second);

            stream_error_ = state.stream_error;
            response_ = state.response;
            response_complete_ = state.response_complete;
            response_headers_complete_ = state.response_headers_complete;
            response_headers_ = state.response_headers.Clone();
            response_trailers_ = state.response_trailers.Clone();
            bytes_read_ = state.bytes_read;
            bytes_written_ = state.bytes_written;
            response_body_size_ = state.response_body_size;

            closed_stream_states_.pop_front();
        }
        */

    void Http3Client::ClearPerConnectionState()
    {
        ClearPerRequestState();
        open_streams_.clear();
        closed_stream_states_.clear();
        latest_created_stream_ = nullptr;
    }

    Http3ClientJS::Http3ClientJS(const Napi::CallbackInfo &info) : Napi::ObjectWrap<Http3ClientJS>(info)
    {
        bool allowPooling = false;
        std::vector<WebTransportHash> serverCertificateHashes;
        std::vector<std::string> protocols;
        std::string privkey;
        QuicConfig cconfig;
        auto env = info.Env();
        if (!info[0].IsUndefined())
        {
            Napi::Object lobj = info[0].ToObject();
            if (!lobj.IsEmpty())
            {

                if (lobj.Has("allowPooling") && !(lobj).Get("allowPooling").IsEmpty())
                {
                    Napi::Value poolValue = (lobj).Get("allowPooling");
                    allowPooling = poolValue.As<Napi::Boolean>().Value();
                }

                if (lobj.Has("serverCertificateHashes") && !(lobj).Get("serverCertificateHashes").IsEmpty())
                {
                    Napi::Value hashValue = (lobj).Get("serverCertificateHashes");
                    if (hashValue.IsArray())
                    {
                        Napi::Array hashArray = hashValue.As<Napi::Array>();
                        int length = hashArray.Length();

                        for (unsigned int i = 0; i < length; i++)
                        {
                            WebTransportHash curhash;
                            Napi::Value hash = hashArray.Get(i);
                            Napi::Object hashobj = hash.ToObject();
                            if (hashobj.Has("value") && !(hashobj).Get("value").IsEmpty())
                            {
                                Napi::Object bufferlocal = (hashobj).Get("value").ToObject();
                                char *buffer = bufferlocal.As<Napi::Buffer<char>>().Data();
                                size_t len = bufferlocal.As<Napi::Buffer<char>>().Length();
                                curhash.value = std::string(buffer, len);
                            }
                            else
                            {
                                Napi::Error::New(env, "serverCertificateHashes wrong format").ThrowAsJavaScriptException();
                                return;
                            }
                            if (hashobj.Has("algorithm") && !(hashobj).Get("algorithm").IsEmpty())
                            {
                                Napi::Value algorithmValue = (hashobj).Get("algorithm");
                                curhash.algorithm = algorithmValue.ToString().Utf8Value();
                            }
                            else
                            {
                                Napi::Error::New(env, "serverCertificateHashes wrong format").ThrowAsJavaScriptException();
                                return;
                            }
                            if (curhash.algorithm.compare(WebTransportHash::kSha256) != 0)
                            {
                                Napi::Error::New(env, "serverCertificateHashes unknown algorithm").ThrowAsJavaScriptException();
                                return;
                            }
                            serverCertificateHashes.push_back(curhash);
                        }
                    }
                    else
                    {
                        Napi::Error::New(env, "serverCertificateHashes is not an array").ThrowAsJavaScriptException();
                        return;
                    }
                }
                if (lobj.Has("initialBidirectionalStreams") && !(lobj).Get("initialBidirectionalStreams").IsEmpty())
                {
                    Napi::Value initialBidirectionalStreamsValue = (lobj).Get("initialBidirectionalStreams");
                    int initialBidirectionalStreams = initialBidirectionalStreamsValue.As<Napi::Number>().Int32Value();
                    cconfig.SetMaxBidirectionalStreamsToSend(initialBidirectionalStreams);
                }

                if (lobj.Has("initialUnidirectionalStreams") && !(lobj).Get("initialUnidirectionalStreams").IsEmpty())
                {
                    Napi::Value initialUnidirectionalStreamsValue = (lobj).Get("initialUnidirectionalStreams");
                    int initialUnidirectionalStreams = initialUnidirectionalStreamsValue.As<Napi::Number>().Int32Value();
                    cconfig.SetMaxUnidirectionalStreamsToSend(initialUnidirectionalStreams);
                }
                if (lobj.Has("initialStreamFlowControlWindow") && !(lobj).Get("initialStreamFlowControlWindow").IsEmpty())
                {
                    Napi::Value initialStreamFlowControlWindowValue = (lobj).Get("initialStreamFlowControlWindow");
                    int initialStreamFlowControlWindow = initialStreamFlowControlWindowValue.As<Napi::Number>().Int32Value();
                    cconfig.SetInitialStreamFlowControlWindowToSend(initialStreamFlowControlWindow);
                }

                if (lobj.Has("initialSessionFlowControlWindow") && !(lobj).Get("initialSessionFlowControlWindow").IsEmpty())
                {
                    Napi::Value initialSessionFlowControlWindowValue = (lobj).Get("initialSessionFlowControlWindow");
                    int initialSessionFlowControlWindow = initialSessionFlowControlWindowValue.As<Napi::Number>().Int32Value();
                    cconfig.SetInitialSessionFlowControlWindowToSend(initialSessionFlowControlWindow);
                }

                if (lobj.Has("streamFlowControlWindowSizeLimit") && !(lobj).Get("streamFlowControlWindowSizeLimit").IsEmpty())
                {
                    Napi::Value streamFlowControlWindowSizeLimitValue = (lobj).Get("streamFlowControlWindowSizeLimit");
                    int streamFlowControlWindowSizeLimitWindow = streamFlowControlWindowSizeLimitValue.As<Napi::Number>().Int32Value();
                    cconfig.SetInitialMaxStreamDataBytesOutgoingBidirectionalToSend(streamFlowControlWindowSizeLimitWindow);
                    cconfig.SetInitialMaxStreamDataBytesIncomingBidirectionalToSend(streamFlowControlWindowSizeLimitWindow);
                    cconfig.SetInitialMaxStreamDataBytesUnidirectionalToSend(streamFlowControlWindowSizeLimitWindow);
                }
                if (lobj.Has("protocols") && !(lobj).Get("protocols").IsEmpty()) {
                    Napi::Value protocolValue = (lobj).Get("protocols");
                    if (protocolValue.IsArray())
                    {
                        Napi::Array protocolArray = protocolValue.As<Napi::Array>();
                        unsigned int length = protocolArray.Length();

                        for (unsigned int i = 0; i < length; i++)
                        {
                            Napi::Value protocolValue = protocolArray.Get(i);
                            Napi::String protocolString = protocolValue.ToString();
                            protocols.push_back(protocolString.Utf8Value());
                        }
                    }
                    else
                    {
                        Napi::Error::New(env, "protocols is not an array").ThrowAsJavaScriptException();
                        return;
                    }
                }
            }
        }

        // Callback *callback, int port, std::unique_ptr<ProofSource> proof_source,  const char *secret

        std::unique_ptr<QuicConnectionHelperInterface> helper =
            std::make_unique<QuicDefaultConnectionHelper>();

        std::unique_ptr<ProofVerifier> verifier;

        if (serverCertificateHashes.size() > 0)
        {
            verifier = std::make_unique<ChromiumWebTransportFingerprintProofVerifier>(helper->GetClock(), 14);

            for (auto cur = serverCertificateHashes.begin();
                 cur != serverCertificateHashes.end(); cur++)
            {
                if (!static_cast<ChromiumWebTransportFingerprintProofVerifier*>(verifier.get())->AddFingerprint(*cur))
                {
                    Napi::Error::New(env, "serverCertificateHashes is not valid fingerprint").ThrowAsJavaScriptException();
                    return;
                }
            }
        }
        else
        {
            verifier = std::make_unique<NodeJSProofVerifier>(this);
        }

        std::unique_ptr<Http3SessionCache> cache;

        client_ = std::make_unique<Http3Client>(this, std::move(verifier), std::move(cache), std::move(helper), cconfig, protocols);
        client_->SetUserAgentID("fails-components/webtransport");

        Ref(); // do not garbage collect

        client_->Connect();
        return;
    }

    void Http3ClientJS::setHostname(const Napi::CallbackInfo &info) {
        int port = 443;
        std::string serveraddress;
        std::string hostname = "localhost";
        auto env = info.Env();
        if (!info[0].IsUndefined())
        {
            Napi::Object lobj = info[0].ToObject();
            if (!lobj.IsEmpty())
            {

               

                if (lobj.Has("port") && !(lobj).Get("port").IsEmpty())
                {
                    Napi::Value portValue = (lobj).Get("port");
                    port = portValue.As<Napi::Number>().Int32Value();
                }
                else
                {
                    Napi::Error::New(env, "no port specified").ThrowAsJavaScriptException();
                    return;
                }

                if (lobj.Has("host") && !(lobj).Get("host").IsEmpty())
                {
                    Napi::Value hostnameValue = (lobj).Get("host");
                    hostname = hostnameValue.ToString().Utf8Value();
                }
                else
                {
                    Napi::Error::New(env, "no hostname specified").ThrowAsJavaScriptException();
                    return;
                }

                if (lobj.Has("serveraddress") && !(lobj).Get("serveraddress").IsEmpty())
                {
                    Napi::Value serveraddressValue = (lobj).Get("serveraddress");
                    serveraddress = serveraddressValue.ToString().Utf8Value();
                }
                else
                {
                    Napi::Error::New(env, "no serveraddress specified").ThrowAsJavaScriptException();
                    return;
                }
            }
        }

        QuicIpAddress server_ip;
        server_ip.FromString(serveraddress);
        QuicSocketAddress address(server_ip, port);

        client_ ->setHostname(address, hostname);                            
    }

    void Http3ClientJS::openWTSession(const Napi::CallbackInfo &info)
    {
        Http3Client *obj = getObj();
        // got the object we can now start the server

        if (!info[0].IsUndefined())
        {
            std::string lpath(info[0].ToString().Utf8Value());

            if (!obj->openWTSessionInt(lpath)) {
                Napi::Error::New(info.Env(), "openWTSessionInt failed, invalid protocols?").ThrowAsJavaScriptException();
            }
        }
        else
        {
            Napi::Error::New(info.Env(), "openWTSession without path").ThrowAsJavaScriptException();
            return;
        }
    }

    void Http3ClientJS::closeClient(const Napi::CallbackInfo &info)
    {
        Http3Client *obj = getObj();
        // got the object we can now start the server

        if (!obj->closeClientInt())
        {
            printf("closeClientInt failed for Http3Client");
            return;
        }
    }

    void Http3ClientJS::processClientConnected(bool success)
    {
        Napi::HandleScope scope(Env());

        Napi::Object objVal = Value().Get("jsobj").As<Napi::Object>();
        Napi::Object retObj = Napi::Object::New(Env());
        retObj.Set("success", success);

        objVal.Get("onClientConnected")
            .As<Napi::Function>()
            .Call(objVal, {retObj.As<Napi::Value>()});
    }

    void Http3ClientJS::processClientWebtransportSupport()
    {
        Http3Client *obj = getObj();
        Napi::HandleScope scope(Env());
        Napi::Object objVal = Value().Get("jsobj").As<Napi::Object>();
        Napi::Object retObj = Napi::Object::New(Env());
        objVal.Get("onClientWebTransportSupport")
            .As<Napi::Function>()
            .Call(objVal, {retObj});
    }

    void Http3ClientJS::processNewClientSession(Http3WTSession *session)
    {
        Napi::HandleScope scope(Env());

        Napi::Object retObj = Napi::Object::New(Env());
        if (session != nullptr)
        {
            Http3Constructors *constr = Env().GetInstanceData<Http3Constructors>();
            Napi::Object sessionobj = constr->session.New({});
            Http3WTSessionJS *sessionjs = Napi::ObjectWrap<Http3WTSessionJS>::Unwrap(sessionobj);
            sessionjs->setObj(session);
            sessionjs->Ref();
            session->setJS(sessionjs);
            Napi::Object objVal = Value().Get("jsobj").As<Napi::Object>();
            retObj.Set("session", sessionobj);
            objVal.Get("onHttpWTSessionVisitor")
                .As<Napi::Function>()
                .Call(objVal, {retObj});
        }
    }

} // namespace quic
