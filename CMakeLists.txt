cmake_minimum_required(VERSION 3.18)

project (webtransport)


set(CMAKE_POSITION_INDEPENDENT_CODE TRUE)
set(CMAKE_CXX_STANDARD 17)

set(BUILD_TESTING OFF)

set(ABSL_PROPAGATE_CXX_STD ON)
# include abseil
add_subdirectory(third_party/abseil-cpp)

# include boring ssl
add_subdirectory(third_party/boringssl/src)

# include zlib
add_subdirectory(third_party/zlib)

include(FindProtobuf)
find_package(Protobuf REQUIRED)

if(COMMAND cmake_policy)
cmake_policy(SET CMP0003 NEW)
endif(COMMAND cmake_policy)

# google quiche build parameters start, inspired by chromium build



#protobuf_generate_cpp(PROTO_SRCS PROTO_HDRS 
#third_party/quiche/quic/core/proto/cached_network_parameters.proto
#third_party/quiche/quic/core/proto/crypto_server_config.proto
#third_party/quiche/quic/core/proto/source_address_token.proto)






add_library(gquiche SHARED 
#plattform impl
platform/quiche_platform_impl/quiche_export_impl.h
platform/quiche_platform_impl/quiche_logging_impl.h
platform/quiche_platform_impl/quiche_logging_impl.cc
platform/quiche_platform_impl/quiche_containers_impl.h
platform/quiche_platform_impl/quiche_bug_tracker_impl.h
platform/quiche_platform_impl/quiche_mutex_impl.h
platform/quiche_platform_impl/quiche_time_utils_impl.h
platform/quiche_platform_impl/quiche_time_utils_impl.cc
platform/quiche_platform_impl/quic_testvalue_impl.h
platform/quiche_platform_impl/quiche_prefetch_impl.h
platform/net/quiche/common/platform/impl/quiche_flags_impl.h
platform/net/quiche/common/platform/impl/quiche_flags_impl.cc
platform/quiche_platform_impl/quiche_mem_slice_impl.h
platform/quiche_platform_impl/quiche_flag_utils_impl.h
platform/net/quic/platform/impl/quic_flags_impl.h
platform/net/quiche/common/platform/impl/quiche_iovec_impl.h
platform/net/quic/platform/impl/quic_hostname_utils_impl.h
platform/net/quic/platform/impl/quic_hostname_utils_impl.cc
platform/net/quic/platform/impl/quic_client_stats_impl.h
platform/net/quic/platform/impl/quic_udp_socket_platform_impl.h
platform/net/quic/platform/impl/quic_server_stats_impl.h
platform/net/quic/platform/impl/quic_stack_trace_impl.h
platform/net/quic/platform/impl/quic_epoll_clock.h
platform/net/quic/platform/impl/quic_epoll_clock.cc
platform/net/quic/platform/impl/simple_libuv_epoll_server.cc
platform/net/quic/platform/impl/simple_libuv_epoll_server.h
#protofiles
#${PROTO_SRCS}
#${CMAKE_CURRENT_BINARY_DIR}/third_party/quiche/quic/core/proto/cached_network_parameters.pb.h
#${CMAKE_CURRENT_BINARY_DIR}/third_party/quiche/quic/core/proto/crypto_server_config.pb.h
#${CMAKE_CURRENT_BINARY_DIR}/third_party/quiche/quic/core/proto/source_address_token.pb.h
#${CMAKE_CURRENT_BINARY_DIR}/third_party/quiche/quic/core/proto/cached_network_parameters.pb.cc
#${CMAKE_CURRENT_BINARY_DIR}/third_party/quiche/quic/core/proto/crypto_server_config.pb.cc
#${CMAKE_CURRENT_BINARY_DIR}/third_party/quiche/quic/core/proto/source_address_token.pb.cc
# normal files
third_party/quiche/common/platform/api/quiche_bug_tracker.h
third_party/quiche/common/platform/api/quiche_export.h
third_party/quiche/common/platform/api/quiche_flag_utils.h
third_party/quiche/common/platform/api/quiche_flags.h
third_party/quiche/common/platform/api/quiche_iovec.h
third_party/quiche/common/platform/api/quiche_logging.h
third_party/quiche/common/platform/api/quiche_mem_slice.h
third_party/quiche/common/platform/api/quiche_mutex.cc
third_party/quiche/common/platform/api/quiche_mutex.h
third_party/quiche/common/platform/api/quiche_prefetch.h
third_party/quiche/common/platform/api/quiche_reference_counted.h
third_party/quiche/common/platform/api/quiche_thread_local.h
third_party/quiche/common/platform/api/quiche_time_utils.h
third_party/quiche/common/platform/api/quiche_url_utils.h
third_party/quiche/common/platform/default/quiche_platform_impl/quiche_prefetch_impl.h
third_party/quiche/common/platform/default/quiche_platform_impl/quiche_mutex_impl.cc
third_party/quiche/common/platform/default/quiche_platform_impl/quiche_mutex_impl.h
third_party/quiche/common/print_elements.h
third_party/quiche/common/quiche_buffer_allocator.cc
third_party/quiche/common/quiche_buffer_allocator.h
third_party/quiche/common/quiche_circular_deque.h
third_party/quiche/common/quiche_data_reader.cc
third_party/quiche/common/quiche_data_reader.h
third_party/quiche/common/quiche_data_writer.cc
third_party/quiche/common/quiche_data_writer.h
third_party/quiche/common/quiche_endian.h
third_party/quiche/common/quiche_linked_hash_map.h
third_party/quiche/common/quiche_mem_slice_storage.h
third_party/quiche/common/quiche_mem_slice_storage.cc
third_party/quiche/common/quiche_text_utils.cc
third_party/quiche/common/quiche_text_utils.h
third_party/quiche/common/simple_buffer_allocator.cc
# third_party/quiche/epoll_server/simple_epoll_server.cc
# third_party/quiche/epoll_server/simple_epoll_server.h
third_party/quiche/http2/adapter/data_source.h
third_party/quiche/http2/adapter/event_forwarder.cc
third_party/quiche/http2/adapter/event_forwarder.h
third_party/quiche/http2/adapter/header_validator.cc
third_party/quiche/http2/adapter/header_validator.h
third_party/quiche/http2/adapter/http2_adapter.h
third_party/quiche/http2/adapter/http2_protocol.cc
third_party/quiche/http2/adapter/http2_protocol.h
third_party/quiche/http2/adapter/http2_session.h
third_party/quiche/http2/adapter/http2_util.cc
third_party/quiche/http2/adapter/http2_util.h
third_party/quiche/http2/adapter/http2_visitor_interface.h
third_party/quiche/http2/adapter/oghttp2_adapter.cc
third_party/quiche/http2/adapter/oghttp2_adapter.h
third_party/quiche/http2/adapter/oghttp2_session.cc
third_party/quiche/http2/adapter/oghttp2_session.h
third_party/quiche/http2/adapter/oghttp2_util.cc
third_party/quiche/http2/adapter/oghttp2_util.h
third_party/quiche/http2/adapter/window_manager.cc
third_party/quiche/http2/adapter/window_manager.h
third_party/quiche/http2/core/http2_trace_logging.cc
third_party/quiche/http2/core/http2_trace_logging.h
third_party/quiche/http2/core/priority_write_scheduler.h
third_party/quiche/http2/core/write_scheduler.h
third_party/quiche/http2/decoder/decode_buffer.cc
third_party/quiche/http2/decoder/decode_buffer.h
third_party/quiche/http2/decoder/decode_http2_structures.cc
third_party/quiche/http2/decoder/decode_http2_structures.h
third_party/quiche/http2/decoder/decode_status.cc
third_party/quiche/http2/decoder/decode_status.h
third_party/quiche/http2/decoder/frame_decoder_state.cc
third_party/quiche/http2/decoder/frame_decoder_state.h
third_party/quiche/http2/decoder/http2_frame_decoder.cc
third_party/quiche/http2/decoder/http2_frame_decoder.h
third_party/quiche/http2/decoder/http2_frame_decoder_listener.cc
third_party/quiche/http2/decoder/http2_frame_decoder_listener.h
third_party/quiche/http2/decoder/http2_structure_decoder.cc
third_party/quiche/http2/decoder/http2_structure_decoder.h
third_party/quiche/http2/decoder/payload_decoders/altsvc_payload_decoder.cc
third_party/quiche/http2/decoder/payload_decoders/altsvc_payload_decoder.h
third_party/quiche/http2/decoder/payload_decoders/continuation_payload_decoder.cc
third_party/quiche/http2/decoder/payload_decoders/continuation_payload_decoder.h
third_party/quiche/http2/decoder/payload_decoders/data_payload_decoder.cc
third_party/quiche/http2/decoder/payload_decoders/data_payload_decoder.h
third_party/quiche/http2/decoder/payload_decoders/goaway_payload_decoder.cc
third_party/quiche/http2/decoder/payload_decoders/goaway_payload_decoder.h
third_party/quiche/http2/decoder/payload_decoders/headers_payload_decoder.cc
third_party/quiche/http2/decoder/payload_decoders/headers_payload_decoder.h
third_party/quiche/http2/decoder/payload_decoders/ping_payload_decoder.cc
third_party/quiche/http2/decoder/payload_decoders/ping_payload_decoder.h
third_party/quiche/http2/decoder/payload_decoders/priority_payload_decoder.cc
third_party/quiche/http2/decoder/payload_decoders/priority_payload_decoder.h
third_party/quiche/http2/decoder/payload_decoders/priority_update_payload_decoder.cc
third_party/quiche/http2/decoder/payload_decoders/priority_update_payload_decoder.h
third_party/quiche/http2/decoder/payload_decoders/push_promise_payload_decoder.cc
third_party/quiche/http2/decoder/payload_decoders/push_promise_payload_decoder.h
third_party/quiche/http2/decoder/payload_decoders/rst_stream_payload_decoder.cc
third_party/quiche/http2/decoder/payload_decoders/rst_stream_payload_decoder.h
third_party/quiche/http2/decoder/payload_decoders/settings_payload_decoder.cc
third_party/quiche/http2/decoder/payload_decoders/settings_payload_decoder.h
third_party/quiche/http2/decoder/payload_decoders/unknown_payload_decoder.cc
third_party/quiche/http2/decoder/payload_decoders/unknown_payload_decoder.h
third_party/quiche/http2/decoder/payload_decoders/window_update_payload_decoder.cc
third_party/quiche/http2/decoder/payload_decoders/window_update_payload_decoder.h
third_party/quiche/http2/hpack/decoder/hpack_block_decoder.cc
third_party/quiche/http2/hpack/decoder/hpack_block_decoder.h
third_party/quiche/http2/hpack/decoder/hpack_decoder.cc
third_party/quiche/http2/hpack/decoder/hpack_decoder.h
third_party/quiche/http2/hpack/decoder/hpack_decoder_listener.cc
third_party/quiche/http2/hpack/decoder/hpack_decoder_listener.h
third_party/quiche/http2/hpack/decoder/hpack_decoder_state.cc
third_party/quiche/http2/hpack/decoder/hpack_decoder_state.h
third_party/quiche/http2/hpack/decoder/hpack_decoder_string_buffer.cc
third_party/quiche/http2/hpack/decoder/hpack_decoder_string_buffer.h
third_party/quiche/http2/hpack/decoder/hpack_decoder_tables.cc
third_party/quiche/http2/hpack/decoder/hpack_decoder_tables.h
third_party/quiche/http2/hpack/decoder/hpack_decoding_error.cc
third_party/quiche/http2/hpack/decoder/hpack_decoding_error.h
third_party/quiche/http2/hpack/decoder/hpack_entry_decoder.cc
third_party/quiche/http2/hpack/decoder/hpack_entry_decoder.h
third_party/quiche/http2/hpack/decoder/hpack_entry_decoder_listener.cc
third_party/quiche/http2/hpack/decoder/hpack_entry_decoder_listener.h
third_party/quiche/http2/hpack/decoder/hpack_entry_type_decoder.cc
third_party/quiche/http2/hpack/decoder/hpack_entry_type_decoder.h
third_party/quiche/http2/hpack/decoder/hpack_string_decoder.cc
third_party/quiche/http2/hpack/decoder/hpack_string_decoder.h
third_party/quiche/http2/hpack/decoder/hpack_string_decoder_listener.cc
third_party/quiche/http2/hpack/decoder/hpack_string_decoder_listener.h
third_party/quiche/http2/hpack/decoder/hpack_whole_entry_buffer.cc
third_party/quiche/http2/hpack/decoder/hpack_whole_entry_buffer.h
third_party/quiche/http2/hpack/decoder/hpack_whole_entry_listener.cc
third_party/quiche/http2/hpack/decoder/hpack_whole_entry_listener.h
third_party/quiche/http2/hpack/hpack_static_table_entries.inc
third_party/quiche/http2/hpack/http2_hpack_constants.cc
third_party/quiche/http2/hpack/http2_hpack_constants.h
third_party/quiche/http2/hpack/huffman/hpack_huffman_decoder.cc
third_party/quiche/http2/hpack/huffman/hpack_huffman_decoder.h
third_party/quiche/http2/hpack/huffman/hpack_huffman_encoder.cc
third_party/quiche/http2/hpack/huffman/hpack_huffman_encoder.h
third_party/quiche/http2/hpack/huffman/huffman_spec_tables.cc
third_party/quiche/http2/hpack/huffman/huffman_spec_tables.h
third_party/quiche/http2/hpack/varint/hpack_varint_decoder.cc
third_party/quiche/http2/hpack/varint/hpack_varint_decoder.h
third_party/quiche/http2/hpack/varint/hpack_varint_encoder.cc
third_party/quiche/http2/hpack/varint/hpack_varint_encoder.h
third_party/quiche/http2/http2_constants.cc
third_party/quiche/http2/http2_constants.h
third_party/quiche/http2/http2_structures.cc
third_party/quiche/http2/http2_structures.h
third_party/quiche/http2/platform/api/http2_bug_tracker.h
third_party/quiche/http2/platform/api/http2_flag_utils.h
third_party/quiche/http2/platform/api/http2_flags.h
third_party/quiche/http2/platform/api/http2_logging.h
#third_party/quiche/http2/platform/api/http2_macros.h
third_party/quiche/quic/core/chlo_extractor.cc
third_party/quiche/quic/core/chlo_extractor.h
third_party/quiche/quic/core/congestion_control/bandwidth_sampler.cc
third_party/quiche/quic/core/congestion_control/bandwidth_sampler.h
third_party/quiche/quic/core/congestion_control/bbr2_drain.cc
third_party/quiche/quic/core/congestion_control/bbr2_drain.h
third_party/quiche/quic/core/congestion_control/bbr2_misc.cc
third_party/quiche/quic/core/congestion_control/bbr2_misc.h
third_party/quiche/quic/core/congestion_control/bbr2_probe_bw.cc
third_party/quiche/quic/core/congestion_control/bbr2_probe_bw.h
third_party/quiche/quic/core/congestion_control/bbr2_probe_rtt.cc
third_party/quiche/quic/core/congestion_control/bbr2_probe_rtt.h
third_party/quiche/quic/core/congestion_control/bbr2_sender.cc
third_party/quiche/quic/core/congestion_control/bbr2_sender.h
third_party/quiche/quic/core/congestion_control/bbr2_startup.cc
third_party/quiche/quic/core/congestion_control/bbr2_startup.h
third_party/quiche/quic/core/congestion_control/bbr_sender.cc
third_party/quiche/quic/core/congestion_control/bbr_sender.h
third_party/quiche/quic/core/congestion_control/cubic_bytes.cc
third_party/quiche/quic/core/congestion_control/cubic_bytes.h
third_party/quiche/quic/core/congestion_control/general_loss_algorithm.cc
third_party/quiche/quic/core/congestion_control/general_loss_algorithm.h
third_party/quiche/quic/core/congestion_control/hybrid_slow_start.cc
third_party/quiche/quic/core/congestion_control/hybrid_slow_start.h
third_party/quiche/quic/core/congestion_control/loss_detection_interface.h
third_party/quiche/quic/core/congestion_control/pacing_sender.cc
third_party/quiche/quic/core/congestion_control/pacing_sender.h
third_party/quiche/quic/core/congestion_control/prr_sender.cc
third_party/quiche/quic/core/congestion_control/prr_sender.h
third_party/quiche/quic/core/congestion_control/rtt_stats.cc
third_party/quiche/quic/core/congestion_control/rtt_stats.h
third_party/quiche/quic/core/congestion_control/send_algorithm_interface.cc
third_party/quiche/quic/core/congestion_control/send_algorithm_interface.h
third_party/quiche/quic/core/congestion_control/tcp_cubic_sender_bytes.cc
third_party/quiche/quic/core/congestion_control/tcp_cubic_sender_bytes.h
third_party/quiche/quic/core/congestion_control/uber_loss_algorithm.cc
third_party/quiche/quic/core/congestion_control/uber_loss_algorithm.h
third_party/quiche/quic/core/congestion_control/windowed_filter.h
third_party/quiche/quic/core/crypto/aead_base_decrypter.cc
third_party/quiche/quic/core/crypto/aead_base_decrypter.h
third_party/quiche/quic/core/crypto/aead_base_encrypter.cc
third_party/quiche/quic/core/crypto/aead_base_encrypter.h
third_party/quiche/quic/core/crypto/aes_128_gcm_12_decrypter.cc
third_party/quiche/quic/core/crypto/aes_128_gcm_12_decrypter.h
third_party/quiche/quic/core/crypto/aes_128_gcm_12_encrypter.cc
third_party/quiche/quic/core/crypto/aes_128_gcm_12_encrypter.h
third_party/quiche/quic/core/crypto/aes_128_gcm_decrypter.cc
third_party/quiche/quic/core/crypto/aes_128_gcm_decrypter.h
third_party/quiche/quic/core/crypto/aes_128_gcm_encrypter.cc
third_party/quiche/quic/core/crypto/aes_128_gcm_encrypter.h
third_party/quiche/quic/core/crypto/aes_256_gcm_decrypter.cc
third_party/quiche/quic/core/crypto/aes_256_gcm_decrypter.h
third_party/quiche/quic/core/crypto/aes_256_gcm_encrypter.cc
third_party/quiche/quic/core/crypto/aes_256_gcm_encrypter.h
third_party/quiche/quic/core/crypto/aes_base_decrypter.cc
third_party/quiche/quic/core/crypto/aes_base_decrypter.h
third_party/quiche/quic/core/crypto/aes_base_encrypter.cc
third_party/quiche/quic/core/crypto/aes_base_encrypter.h
third_party/quiche/quic/core/crypto/boring_utils.h
third_party/quiche/quic/core/crypto/cert_compressor.cc
third_party/quiche/quic/core/crypto/cert_compressor.h
third_party/quiche/quic/core/crypto/certificate_view.cc
third_party/quiche/quic/core/crypto/certificate_view.h
third_party/quiche/quic/core/crypto/chacha20_poly1305_decrypter.cc
third_party/quiche/quic/core/crypto/chacha20_poly1305_decrypter.h
third_party/quiche/quic/core/crypto/chacha20_poly1305_encrypter.cc
third_party/quiche/quic/core/crypto/chacha20_poly1305_encrypter.h
third_party/quiche/quic/core/crypto/chacha20_poly1305_tls_decrypter.cc
third_party/quiche/quic/core/crypto/chacha20_poly1305_tls_decrypter.h
third_party/quiche/quic/core/crypto/chacha20_poly1305_tls_encrypter.cc
third_party/quiche/quic/core/crypto/chacha20_poly1305_tls_encrypter.h
third_party/quiche/quic/core/crypto/chacha_base_decrypter.cc
third_party/quiche/quic/core/crypto/chacha_base_decrypter.h
third_party/quiche/quic/core/crypto/chacha_base_encrypter.cc
third_party/quiche/quic/core/crypto/chacha_base_encrypter.h
third_party/quiche/quic/core/crypto/channel_id.cc
third_party/quiche/quic/core/crypto/channel_id.h
third_party/quiche/quic/core/crypto/client_proof_source.cc
third_party/quiche/quic/core/crypto/client_proof_source.h
third_party/quiche/quic/core/crypto/crypto_framer.cc
third_party/quiche/quic/core/crypto/crypto_framer.h
third_party/quiche/quic/core/crypto/crypto_handshake.cc
third_party/quiche/quic/core/crypto/crypto_handshake.h
third_party/quiche/quic/core/crypto/crypto_handshake_message.cc
third_party/quiche/quic/core/crypto/crypto_handshake_message.h
third_party/quiche/quic/core/crypto/crypto_message_parser.h
third_party/quiche/quic/core/crypto/crypto_protocol.h
third_party/quiche/quic/core/crypto/crypto_secret_boxer.cc
third_party/quiche/quic/core/crypto/crypto_secret_boxer.h
third_party/quiche/quic/core/crypto/crypto_utils.cc
third_party/quiche/quic/core/crypto/crypto_utils.h
third_party/quiche/quic/core/crypto/curve25519_key_exchange.cc
third_party/quiche/quic/core/crypto/curve25519_key_exchange.h
third_party/quiche/quic/core/crypto/key_exchange.cc
third_party/quiche/quic/core/crypto/key_exchange.h
third_party/quiche/quic/core/crypto/null_decrypter.cc
third_party/quiche/quic/core/crypto/null_decrypter.h
third_party/quiche/quic/core/crypto/null_encrypter.cc
third_party/quiche/quic/core/crypto/null_encrypter.h
third_party/quiche/quic/core/crypto/p256_key_exchange.cc
third_party/quiche/quic/core/crypto/p256_key_exchange.h
third_party/quiche/quic/core/crypto/proof_source_x509.cc
third_party/quiche/quic/core/crypto/proof_source_x509.h
third_party/quiche/quic/core/crypto/proof_source.cc
third_party/quiche/quic/core/crypto/proof_source.h
third_party/quiche/quic/core/crypto/proof_verifier.h
third_party/quiche/quic/core/crypto/quic_client_session_cache.cc
third_party/quiche/quic/core/crypto/quic_client_session_cache.h
third_party/quiche/quic/core/crypto/quic_compressed_certs_cache.cc
third_party/quiche/quic/core/crypto/quic_compressed_certs_cache.h
third_party/quiche/quic/core/crypto/quic_crypter.cc
third_party/quiche/quic/core/crypto/quic_crypter.h
third_party/quiche/quic/core/crypto/quic_crypto_client_config.cc
third_party/quiche/quic/core/crypto/quic_crypto_client_config.h
third_party/quiche/quic/core/crypto/quic_crypto_proof.cc
third_party/quiche/quic/core/crypto/quic_crypto_proof.h
third_party/quiche/quic/core/crypto/quic_crypto_server_config.cc
third_party/quiche/quic/core/crypto/quic_crypto_server_config.h
third_party/quiche/quic/core/crypto/quic_decrypter.cc
third_party/quiche/quic/core/crypto/quic_decrypter.h
third_party/quiche/quic/core/crypto/quic_encrypter.cc
third_party/quiche/quic/core/crypto/quic_encrypter.h
third_party/quiche/quic/core/crypto/quic_hkdf.cc
third_party/quiche/quic/core/crypto/quic_hkdf.h
third_party/quiche/quic/core/crypto/quic_random.cc
third_party/quiche/quic/core/crypto/quic_random.h
third_party/quiche/quic/core/crypto/tls_client_connection.cc
third_party/quiche/quic/core/crypto/tls_client_connection.h
third_party/quiche/quic/core/crypto/tls_connection.cc
third_party/quiche/quic/core/crypto/tls_connection.h
third_party/quiche/quic/core/crypto/tls_server_connection.cc
third_party/quiche/quic/core/crypto/tls_server_connection.h
third_party/quiche/quic/core/crypto/transport_parameters.cc
third_party/quiche/quic/core/crypto/transport_parameters.h
third_party/quiche/quic/core/crypto/web_transport_fingerprint_proof_verifier.cc
third_party/quiche/quic/core/crypto/web_transport_fingerprint_proof_verifier.h
third_party/quiche/quic/core/quic_epoll_alarm_factory.h
third_party/quiche/quic/core/quic_epoll_alarm_factory.cc
third_party/quiche/quic/core/frames/quic_ack_frame.cc
third_party/quiche/quic/core/frames/quic_ack_frame.h
third_party/quiche/quic/core/frames/quic_ack_frequency_frame.cc
third_party/quiche/quic/core/frames/quic_ack_frequency_frame.h
third_party/quiche/quic/core/frames/quic_blocked_frame.cc
third_party/quiche/quic/core/frames/quic_blocked_frame.h
third_party/quiche/quic/core/frames/quic_connection_close_frame.cc
third_party/quiche/quic/core/frames/quic_connection_close_frame.h
third_party/quiche/quic/core/frames/quic_crypto_frame.cc
third_party/quiche/quic/core/frames/quic_crypto_frame.h
third_party/quiche/quic/core/frames/quic_frame.cc
third_party/quiche/quic/core/frames/quic_frame.h
third_party/quiche/quic/core/frames/quic_goaway_frame.cc
third_party/quiche/quic/core/frames/quic_goaway_frame.h
third_party/quiche/quic/core/frames/quic_handshake_done_frame.cc
third_party/quiche/quic/core/frames/quic_handshake_done_frame.h
third_party/quiche/quic/core/frames/quic_inlined_frame.h
third_party/quiche/quic/core/frames/quic_max_streams_frame.cc
third_party/quiche/quic/core/frames/quic_max_streams_frame.h
third_party/quiche/quic/core/frames/quic_message_frame.cc
third_party/quiche/quic/core/frames/quic_message_frame.h
third_party/quiche/quic/core/frames/quic_mtu_discovery_frame.h
third_party/quiche/quic/core/frames/quic_new_connection_id_frame.cc
third_party/quiche/quic/core/frames/quic_new_connection_id_frame.h
third_party/quiche/quic/core/frames/quic_new_token_frame.cc
third_party/quiche/quic/core/frames/quic_new_token_frame.h
third_party/quiche/quic/core/frames/quic_padding_frame.cc
third_party/quiche/quic/core/frames/quic_padding_frame.h
third_party/quiche/quic/core/frames/quic_path_challenge_frame.cc
third_party/quiche/quic/core/frames/quic_path_challenge_frame.h
third_party/quiche/quic/core/frames/quic_path_response_frame.cc
third_party/quiche/quic/core/frames/quic_path_response_frame.h
third_party/quiche/quic/core/frames/quic_ping_frame.cc
third_party/quiche/quic/core/frames/quic_ping_frame.h
third_party/quiche/quic/core/frames/quic_retire_connection_id_frame.cc
third_party/quiche/quic/core/frames/quic_retire_connection_id_frame.h
third_party/quiche/quic/core/frames/quic_rst_stream_frame.cc
third_party/quiche/quic/core/frames/quic_rst_stream_frame.h
third_party/quiche/quic/core/frames/quic_stop_sending_frame.cc
third_party/quiche/quic/core/frames/quic_stop_sending_frame.h
third_party/quiche/quic/core/frames/quic_stop_waiting_frame.cc
third_party/quiche/quic/core/frames/quic_stop_waiting_frame.h
third_party/quiche/quic/core/frames/quic_stream_frame.cc
third_party/quiche/quic/core/frames/quic_stream_frame.h
third_party/quiche/quic/core/frames/quic_streams_blocked_frame.cc
third_party/quiche/quic/core/frames/quic_streams_blocked_frame.h
third_party/quiche/quic/core/frames/quic_window_update_frame.cc
third_party/quiche/quic/core/frames/quic_window_update_frame.h
third_party/quiche/quic/core/handshaker_delegate_interface.h
third_party/quiche/quic/core/http/capsule.cc
third_party/quiche/quic/core/http/capsule.h
third_party/quiche/quic/core/http/http_constants.cc
third_party/quiche/quic/core/http/http_constants.h
third_party/quiche/quic/core/http/http_decoder.cc
third_party/quiche/quic/core/http/http_decoder.h
third_party/quiche/quic/core/http/http_encoder.cc
third_party/quiche/quic/core/http/http_encoder.h
third_party/quiche/quic/core/http/http_frames.h
third_party/quiche/quic/core/http/quic_client_promised_info.cc
third_party/quiche/quic/core/http/quic_client_promised_info.h
third_party/quiche/quic/core/http/quic_client_push_promise_index.cc
third_party/quiche/quic/core/http/quic_client_push_promise_index.h
third_party/quiche/quic/core/http/quic_header_list.cc
third_party/quiche/quic/core/http/quic_header_list.h
third_party/quiche/quic/core/http/quic_headers_stream.cc
third_party/quiche/quic/core/http/quic_headers_stream.h
third_party/quiche/quic/core/http/quic_receive_control_stream.cc
third_party/quiche/quic/core/http/quic_receive_control_stream.h
third_party/quiche/quic/core/http/quic_send_control_stream.cc
third_party/quiche/quic/core/http/quic_send_control_stream.h
third_party/quiche/quic/core/http/quic_server_initiated_spdy_stream.cc
third_party/quiche/quic/core/http/quic_server_initiated_spdy_stream.h
third_party/quiche/quic/core/http/quic_server_session_base.cc
third_party/quiche/quic/core/http/quic_server_session_base.h
third_party/quiche/quic/core/http/quic_spdy_client_session.cc
third_party/quiche/quic/core/http/quic_spdy_client_session.h
third_party/quiche/quic/core/http/quic_spdy_client_session_base.cc
third_party/quiche/quic/core/http/quic_spdy_client_session_base.h
third_party/quiche/quic/core/http/quic_spdy_client_stream.cc
third_party/quiche/quic/core/http/quic_spdy_client_stream.h
third_party/quiche/quic/core/http/quic_spdy_server_stream_base.cc
third_party/quiche/quic/core/http/quic_spdy_server_stream_base.h
third_party/quiche/quic/core/http/quic_spdy_session.cc
third_party/quiche/quic/core/http/quic_spdy_session.h
third_party/quiche/quic/core/http/quic_spdy_stream.cc
third_party/quiche/quic/core/http/quic_spdy_stream.h
third_party/quiche/quic/core/http/quic_spdy_stream_body_manager.cc
third_party/quiche/quic/core/http/quic_spdy_stream_body_manager.h
# third_party/quiche/quic/core/http/spdy_server_push_utils.cc
third_party/quiche/quic/core/http/spdy_server_push_utils.h
third_party/quiche/quic/core/http/spdy_utils.cc
third_party/quiche/quic/core/http/spdy_utils.h
third_party/quiche/quic/core/http/web_transport_http3.cc
third_party/quiche/quic/core/http/web_transport_http3.h
third_party/quiche/quic/core/http/web_transport_stream_adapter.cc
third_party/quiche/quic/core/http/web_transport_stream_adapter.h
third_party/quiche/quic/core/legacy_quic_stream_id_manager.cc
third_party/quiche/quic/core/legacy_quic_stream_id_manager.h
third_party/quiche/quic/core/packet_number_indexed_queue.h
third_party/quiche/quic/core/proto/cached_network_parameters_proto.h
third_party/quiche/quic/core/proto/crypto_server_config_proto.h
third_party/quiche/quic/core/proto/source_address_token_proto.h
third_party/quiche/quic/core/qpack/qpack_blocking_manager.cc
third_party/quiche/quic/core/qpack/qpack_blocking_manager.h
third_party/quiche/quic/core/qpack/qpack_decoded_headers_accumulator.cc
third_party/quiche/quic/core/qpack/qpack_decoded_headers_accumulator.h
third_party/quiche/quic/core/qpack/qpack_decoder.cc
third_party/quiche/quic/core/qpack/qpack_decoder.h
third_party/quiche/quic/core/qpack/qpack_decoder_stream_receiver.cc
third_party/quiche/quic/core/qpack/qpack_decoder_stream_receiver.h
third_party/quiche/quic/core/qpack/qpack_decoder_stream_sender.cc
third_party/quiche/quic/core/qpack/qpack_decoder_stream_sender.h
third_party/quiche/quic/core/qpack/qpack_encoder.cc
third_party/quiche/quic/core/qpack/qpack_encoder.h
third_party/quiche/quic/core/qpack/qpack_encoder_stream_receiver.cc
third_party/quiche/quic/core/qpack/qpack_encoder_stream_receiver.h
third_party/quiche/quic/core/qpack/qpack_encoder_stream_sender.cc
third_party/quiche/quic/core/qpack/qpack_encoder_stream_sender.h
third_party/quiche/quic/core/qpack/qpack_header_table.cc
third_party/quiche/quic/core/qpack/qpack_header_table.h
third_party/quiche/quic/core/qpack/qpack_index_conversions.cc
third_party/quiche/quic/core/qpack/qpack_index_conversions.h
third_party/quiche/quic/core/qpack/qpack_instruction_decoder.cc
third_party/quiche/quic/core/qpack/qpack_instruction_decoder.h
third_party/quiche/quic/core/qpack/qpack_instruction_encoder.cc
third_party/quiche/quic/core/qpack/qpack_instruction_encoder.h
third_party/quiche/quic/core/qpack/qpack_instructions.cc
third_party/quiche/quic/core/qpack/qpack_instructions.h
third_party/quiche/quic/core/qpack/qpack_progressive_decoder.cc
third_party/quiche/quic/core/qpack/qpack_progressive_decoder.h
third_party/quiche/quic/core/qpack/qpack_receive_stream.cc
third_party/quiche/quic/core/qpack/qpack_receive_stream.h
third_party/quiche/quic/core/qpack/qpack_required_insert_count.cc
third_party/quiche/quic/core/qpack/qpack_required_insert_count.h
third_party/quiche/quic/core/qpack/qpack_send_stream.cc
third_party/quiche/quic/core/qpack/qpack_send_stream.h
third_party/quiche/quic/core/qpack/qpack_static_table.cc
third_party/quiche/quic/core/qpack/qpack_static_table.h
third_party/quiche/quic/core/qpack/qpack_stream_receiver.h
third_party/quiche/quic/core/qpack/qpack_stream_sender_delegate.h
third_party/quiche/quic/core/qpack/value_splitting_header_list.cc
third_party/quiche/quic/core/qpack/value_splitting_header_list.h
third_party/quiche/quic/core/quic_ack_listener_interface.cc
third_party/quiche/quic/core/quic_ack_listener_interface.h
third_party/quiche/quic/core/quic_alarm.cc
third_party/quiche/quic/core/quic_alarm.h
third_party/quiche/quic/core/quic_alarm_factory.h
third_party/quiche/quic/core/quic_arena_scoped_ptr.h
third_party/quiche/quic/core/quic_bandwidth.cc
third_party/quiche/quic/core/quic_bandwidth.h
third_party/quiche/quic/core/quic_blocked_writer_interface.h
third_party/quiche/quic/core/quic_buffered_packet_store.cc
third_party/quiche/quic/core/quic_buffered_packet_store.h
third_party/quiche/quic/core/quic_chaos_protector.cc
third_party/quiche/quic/core/quic_chaos_protector.h
third_party/quiche/quic/core/quic_clock.cc
third_party/quiche/quic/core/quic_clock.h
third_party/quiche/quic/core/quic_coalesced_packet.cc
third_party/quiche/quic/core/quic_coalesced_packet.h
third_party/quiche/quic/core/quic_config.cc
third_party/quiche/quic/core/quic_config.h
third_party/quiche/quic/core/quic_connection.cc
third_party/quiche/quic/core/quic_connection.h
third_party/quiche/quic/core/quic_connection_context.cc
third_party/quiche/quic/core/quic_connection_context.h
third_party/quiche/quic/core/quic_connection_id.cc
third_party/quiche/quic/core/quic_connection_id.h
third_party/quiche/quic/core/quic_connection_id_manager.cc
third_party/quiche/quic/core/quic_connection_id_manager.h
third_party/quiche/quic/core/quic_connection_stats.cc
third_party/quiche/quic/core/quic_connection_stats.h
third_party/quiche/quic/core/quic_constants.cc
third_party/quiche/quic/core/quic_constants.h
third_party/quiche/quic/core/quic_control_frame_manager.cc
third_party/quiche/quic/core/quic_control_frame_manager.h
third_party/quiche/quic/core/quic_crypto_client_handshaker.cc
third_party/quiche/quic/core/quic_crypto_client_handshaker.h
third_party/quiche/quic/core/quic_crypto_client_stream.cc
third_party/quiche/quic/core/quic_crypto_client_stream.h
third_party/quiche/quic/core/quic_crypto_handshaker.cc
third_party/quiche/quic/core/quic_crypto_handshaker.h
third_party/quiche/quic/core/quic_crypto_server_stream.cc
third_party/quiche/quic/core/quic_crypto_server_stream.h
third_party/quiche/quic/core/quic_crypto_server_stream_base.cc
third_party/quiche/quic/core/quic_crypto_server_stream_base.h
third_party/quiche/quic/core/quic_crypto_stream.cc
third_party/quiche/quic/core/quic_crypto_stream.h
third_party/quiche/quic/core/quic_data_reader.cc
third_party/quiche/quic/core/quic_data_reader.h
third_party/quiche/quic/core/quic_data_writer.cc
third_party/quiche/quic/core/quic_data_writer.h
third_party/quiche/quic/core/quic_datagram_queue.cc
third_party/quiche/quic/core/quic_datagram_queue.h
third_party/quiche/quic/core/quic_default_packet_writer.cc
third_party/quiche/quic/core/quic_default_packet_writer.h
third_party/quiche/quic/core/quic_dispatcher.cc
third_party/quiche/quic/core/quic_dispatcher.h
third_party/quiche/quic/core/quic_error_codes.cc
third_party/quiche/quic/core/quic_error_codes.h
third_party/quiche/quic/core/quic_epoll_connection_helper.h
third_party/quiche/quic/core/quic_epoll_connection_helper.cc
third_party/quiche/quic/core/quic_flags_list.h
third_party/quiche/quic/core/quic_flow_controller.cc
third_party/quiche/quic/core/quic_flow_controller.h
third_party/quiche/quic/core/quic_framer.cc
third_party/quiche/quic/core/quic_framer.h
third_party/quiche/quic/core/quic_idle_network_detector.cc
third_party/quiche/quic/core/quic_idle_network_detector.h
third_party/quiche/quic/core/quic_interval.h
third_party/quiche/quic/core/quic_interval_deque.h
third_party/quiche/quic/core/quic_interval_set.h
third_party/quiche/quic/core/quic_legacy_version_encapsulator.cc
third_party/quiche/quic/core/quic_legacy_version_encapsulator.h
third_party/quiche/quic/core/quic_lru_cache.h
third_party/quiche/quic/core/quic_mtu_discovery.cc
third_party/quiche/quic/core/quic_mtu_discovery.h
third_party/quiche/quic/core/quic_network_blackhole_detector.cc
third_party/quiche/quic/core/quic_network_blackhole_detector.h
third_party/quiche/quic/core/quic_one_block_arena.h
third_party/quiche/quic/core/quic_packet_creator.cc
third_party/quiche/quic/core/quic_packet_creator.h
third_party/quiche/quic/core/quic_packet_number.cc
third_party/quiche/quic/core/quic_packet_number.h
third_party/quiche/quic/core/quic_packet_reader.cc
third_party/quiche/quic/core/quic_packet_reader.h
third_party/quiche/quic/core/quic_packet_writer.h
third_party/quiche/quic/core/quic_packets.cc
third_party/quiche/quic/core/quic_packets.h
third_party/quiche/quic/core/quic_path_validator.cc
third_party/quiche/quic/core/quic_path_validator.h
third_party/quiche/quic/core/quic_protocol_flags_list.h
third_party/quiche/quic/core/quic_received_packet_manager.cc
third_party/quiche/quic/core/quic_received_packet_manager.h
third_party/quiche/quic/core/quic_sent_packet_manager.cc
third_party/quiche/quic/core/quic_sent_packet_manager.h
third_party/quiche/quic/core/quic_server_id.cc
third_party/quiche/quic/core/quic_server_id.h
third_party/quiche/quic/core/quic_session.cc
third_party/quiche/quic/core/quic_session.h
third_party/quiche/quic/core/quic_socket_address_coder.cc
third_party/quiche/quic/core/quic_socket_address_coder.h
third_party/quiche/quic/core/quic_stream.cc
third_party/quiche/quic/core/quic_stream.h
third_party/quiche/quic/core/quic_stream_frame_data_producer.h
third_party/quiche/quic/core/quic_stream_id_manager.cc
third_party/quiche/quic/core/quic_stream_id_manager.h
third_party/quiche/quic/core/quic_stream_send_buffer.cc
third_party/quiche/quic/core/quic_stream_send_buffer.h
third_party/quiche/quic/core/quic_stream_sequencer.cc
third_party/quiche/quic/core/quic_stream_sequencer.h
third_party/quiche/quic/core/quic_stream_sequencer_buffer.cc
third_party/quiche/quic/core/quic_stream_sequencer_buffer.h
third_party/quiche/quic/core/quic_sustained_bandwidth_recorder.cc
third_party/quiche/quic/core/quic_sustained_bandwidth_recorder.h
third_party/quiche/quic/core/quic_tag.cc
third_party/quiche/quic/core/quic_tag.h
third_party/quiche/quic/core/quic_time.cc
third_party/quiche/quic/core/quic_time.h
third_party/quiche/quic/core/quic_time_wait_list_manager.cc
third_party/quiche/quic/core/quic_time_wait_list_manager.h
third_party/quiche/quic/core/quic_time_accumulator.h
third_party/quiche/quic/core/quic_transmission_info.cc
third_party/quiche/quic/core/quic_transmission_info.h
third_party/quiche/quic/core/quic_types.cc
third_party/quiche/quic/core/quic_types.h
third_party/quiche/quic/core/quic_unacked_packet_map.cc
third_party/quiche/quic/core/quic_unacked_packet_map.h
third_party/quiche/quic/core/quic_utils.cc
third_party/quiche/quic/core/quic_utils.h
third_party/quiche/quic/core/quic_version_manager.cc
third_party/quiche/quic/core/quic_version_manager.h
third_party/quiche/quic/core/quic_versions.cc
third_party/quiche/quic/core/quic_versions.h
third_party/quiche/quic/core/quic_write_blocked_list.cc
third_party/quiche/quic/core/quic_write_blocked_list.h
third_party/quiche/quic/core/session_notifier_interface.h
third_party/quiche/quic/core/stream_delegate_interface.h
third_party/quiche/quic/core/tls_chlo_extractor.cc
third_party/quiche/quic/core/tls_chlo_extractor.h
third_party/quiche/quic/core/tls_client_handshaker.h
third_party/quiche/quic/core/tls_client_handshaker.cc
third_party/quiche/quic/core/tls_client_handshaker.h
third_party/quiche/quic/core/tls_handshaker.cc
third_party/quiche/quic/core/tls_handshaker.h
third_party/quiche/quic/core/tls_server_handshaker.cc
third_party/quiche/quic/core/tls_server_handshaker.h
third_party/quiche/quic/core/uber_quic_stream_id_manager.cc
third_party/quiche/quic/core/uber_quic_stream_id_manager.h
third_party/quiche/quic/core/uber_received_packet_manager.cc
third_party/quiche/quic/core/uber_received_packet_manager.h
third_party/quiche/quic/core/quic_udp_socket_posix.cc
third_party/quiche/quic/core/quic_udp_socket.h
third_party/quiche/quic/platform/api/quic_bug_tracker.h
third_party/quiche/quic/platform/api/quic_client_stats.h
third_party/quiche/quic/platform/api/quic_containers.h
third_party/quiche/quic/platform/api/quic_error_code_wrappers.h
third_party/quiche/quic/platform/api/quic_export.h
third_party/quiche/quic/platform/api/quic_exported_stats.h
third_party/quiche/quic/platform/api/quic_flag_utils.h
third_party/quiche/quic/platform/api/quic_flags.h
third_party/quiche/quic/platform/api/quic_hostname_utils.cc
third_party/quiche/quic/platform/api/quic_hostname_utils.h
third_party/quiche/quic/platform/api/quic_ip_address.cc
third_party/quiche/quic/platform/api/quic_ip_address.h
third_party/quiche/quic/platform/api/quic_ip_address_family.h
third_party/quiche/quic/platform/api/quic_logging.h
#third_party/quiche/quic/platform/api/quic_mem_slice.h
#third_party/quiche/quic/platform/api/quic_mem_slice_storage.cc
#third_party/quiche/quic/platform/api/quic_mem_slice_storage.h
third_party/quiche/quic/platform/api/quic_server_stats.h
third_party/quiche/quic/platform/api/quic_socket_address.cc
third_party/quiche/quic/platform/api/quic_socket_address.h
third_party/quiche/quic/platform/api/quic_stack_trace.h
third_party/quiche/quic/platform/api/quic_thread.h
#third_party/quiche/quic/quic_transport/quic_transport_client_session.cc
#third_party/quiche/quic/quic_transport/quic_transport_client_session.h
third_party/quiche/quic/quic_transport/quic_transport_protocol.h
#third_party/quiche/quic/quic_transport/quic_transport_server_session.cc
#third_party/quiche/quic/quic_transport/quic_transport_server_session.h
third_party/quiche/quic/quic_transport/quic_transport_session_interface.h
third_party/quiche/quic/quic_transport/quic_transport_stream.cc
third_party/quiche/quic/quic_transport/quic_transport_stream.h
third_party/quiche/quic/tools/quic_simple_crypto_server_stream_helper.cc
third_party/quiche/quic/tools/quic_simple_crypto_server_stream_helper.h
third_party/quiche/spdy/core/hpack/hpack_constants.cc
third_party/quiche/spdy/core/hpack/hpack_constants.h
third_party/quiche/spdy/core/hpack/hpack_decoder_adapter.cc
third_party/quiche/spdy/core/hpack/hpack_decoder_adapter.h
third_party/quiche/spdy/core/hpack/hpack_encoder.cc
third_party/quiche/spdy/core/hpack/hpack_encoder.h
third_party/quiche/spdy/core/hpack/hpack_entry.cc
third_party/quiche/spdy/core/hpack/hpack_entry.h
third_party/quiche/spdy/core/hpack/hpack_header_table.cc
third_party/quiche/spdy/core/hpack/hpack_header_table.h
third_party/quiche/spdy/core/hpack/hpack_output_stream.cc
third_party/quiche/spdy/core/hpack/hpack_output_stream.h
third_party/quiche/spdy/core/hpack/hpack_static_table.cc
third_party/quiche/spdy/core/hpack/hpack_static_table.h
third_party/quiche/spdy/core/http2_frame_decoder_adapter.cc
third_party/quiche/spdy/core/http2_frame_decoder_adapter.h
third_party/quiche/spdy/core/recording_headers_handler.cc
third_party/quiche/spdy/core/recording_headers_handler.h
third_party/quiche/spdy/core/spdy_alt_svc_wire_format.cc
third_party/quiche/spdy/core/spdy_alt_svc_wire_format.h
third_party/quiche/spdy/core/spdy_bitmasks.h
third_party/quiche/spdy/core/spdy_frame_builder.cc
third_party/quiche/spdy/core/spdy_frame_builder.h
#third_party/quiche/spdy/core/spdy_frame_reader.cc
#third_party/quiche/spdy/core/spdy_frame_reader.h
third_party/quiche/spdy/core/spdy_framer.cc
third_party/quiche/spdy/core/spdy_framer.h
third_party/quiche/spdy/core/spdy_header_block.cc
third_party/quiche/spdy/core/spdy_header_block.h
third_party/quiche/spdy/core/spdy_header_storage.cc
third_party/quiche/spdy/core/spdy_header_storage.h
third_party/quiche/spdy/core/spdy_headers_handler_interface.h
third_party/quiche/spdy/core/spdy_intrusive_list.h
third_party/quiche/spdy/core/spdy_no_op_visitor.cc
third_party/quiche/spdy/core/spdy_no_op_visitor.h
third_party/quiche/spdy/core/spdy_pinnable_buffer_piece.cc
third_party/quiche/spdy/core/spdy_pinnable_buffer_piece.h
third_party/quiche/spdy/core/spdy_prefixed_buffer_reader.cc
third_party/quiche/spdy/core/spdy_prefixed_buffer_reader.h
third_party/quiche/spdy/core/spdy_protocol.cc
third_party/quiche/spdy/core/spdy_protocol.h
third_party/quiche/spdy/core/spdy_simple_arena.cc
third_party/quiche/spdy/core/spdy_simple_arena.h
third_party/quiche/spdy/core/zero_copy_output_buffer.h
)

FILE(TO_NATIVE_PATH ${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche PROTOMODEL_PATH)
FILE(TO_NATIVE_PATH ${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche PROTOBINDING_PATH)


add_custom_command(
OUTPUT
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/proto/cached_network_parameters.pb.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/proto/crypto_server_config.pb.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/proto/source_address_token.pb.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/proto/cached_network_parameters.pb.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/proto/crypto_server_config.pb.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/proto/source_address_token.pb.cc
COMMAND ${PROTOBUF_PROTOC_EXECUTABLE} --proto_path=${PROTOMODEL_PATH} --cpp_out=${PROTOBINDING_PATH} ${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/proto/cached_network_parameters.proto
COMMAND ${PROTOBUF_PROTOC_EXECUTABLE} --proto_path=${PROTOMODEL_PATH} --cpp_out=${PROTOBINDING_PATH} ${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/proto/crypto_server_config.proto 
COMMAND ${PROTOBUF_PROTOC_EXECUTABLE} --proto_path=${PROTOMODEL_PATH} --cpp_out=${PROTOBINDING_PATH} ${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/proto/source_address_token.proto
)

target_sources(gquiche PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/proto/cached_network_parameters.pb.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/proto/crypto_server_config.pb.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/proto/source_address_token.pb.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/proto/cached_network_parameters.pb.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/proto/crypto_server_config.pb.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/proto/source_address_token.pb.cc)


#set(Protobuf_IMPORT_DIRS "${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche")

#protobuf_generate(
#  TARGET
#    gquiche
#  LANGUAGE
#    cpp
#  GENERATE_EXTENSIONS
#    .pb.h 
#    .pb.cc
#  OUT_VAR PROTO_SRCS
#  IMPORT_DIRS 
#    "${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche"
#  PROTOC_OUT_DIR
#    ${CMAKE_CURRENT_SOURCE_DIR}
#  PROTOS
#    quic/core/proto/cached_network_parameters.proto
#    quic/core/proto/crypto_server_config.proto
#    quic/core/proto/source_address_token.proto
#)

#target_sources(gquiche PRIVATE ${PROTO_SRCS})

set_property(TARGET gquiche PROPERTY CXX_STANDARD 17)

target_include_directories(gquiche
PUBLIC third_party/quiche
PUBLIC third_party/boringssl/src/include
PUBLIC third_party/abseil-cpp
PUBLIC platform
PUBLIC .
PUBLIC ${CMAKE_CURRENT_BINARY_DIR}
PUBLIC ${CMAKE_JS_INC}
)
target_link_libraries(gquiche 
absl::base 
absl::int128
absl::strings 
absl::str_format
absl::flat_hash_map
absl::any 
absl::synchronization 
protobuf
ssl crypto)

if(APPLE)
        target_compile_definitions (gquiche PRIVATE __APPLE_USE_RFC_3542)
endif()


# google quiche build parameters end

#include_directories(${CMAKE_JS_INC})
file(GLOB SOURCE_FILES "src/*.cc" "src/*.h")
add_library(${PROJECT_NAME} SHARED ${SOURCE_FILES} ${CMAKE_JS_SRC})
set_target_properties(${PROJECT_NAME} PROPERTIES PREFIX "" SUFFIX ".node")
set_property(TARGET ${PROJECT_NAME} PROPERTY CXX_STANDARD 17)
target_include_directories(${PROJECT_NAME} 
PUBLIC third_party/boringssl/src/include
PUBLIC ${CMAKE_JS_INC})
target_link_libraries(${PROJECT_NAME} gquiche ssl crypto ${CMAKE_JS_LIB} )
set_target_properties(${PROJECT_NAME}  PROPERTIES LINKER_LANGUAGE CXX)

execute_process(COMMAND node -p "require('node-addon-api').include"
        WORKING_DIRECTORY ${CMAKE_SOURCE_DIR}
        OUTPUT_VARIABLE NODE_ADDON_API_DIR
        )
string(REPLACE "\n" "" NODE_ADDON_API_DIR ${NODE_ADDON_API_DIR})
string(REPLACE "\"" "" NODE_ADDON_API_DIR ${NODE_ADDON_API_DIR})
target_include_directories(${PROJECT_NAME}
 PRIVATE ${NODE_ADDON_API_DIR})


#add_definitions(-DNAPI_VERSION=3)




