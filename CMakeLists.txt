cmake_minimum_required(VERSION 3.18)

project (webtransport)


set(CMAKE_POSITION_INDEPENDENT_CODE TRUE)
set(CXX_STANDARD 17)

set(BUILD_TESTING OFF)

set(ABSL_PROPAGATE_CXX_STD ON)
# include abseil
add_subdirectory(${CMAKE_CURRENT_SOURCE_DIR}/third_party/abseil-cpp)

# include boring ssl
add_subdirectory(${CMAKE_CURRENT_SOURCE_DIR}/third_party/boringssl/src)

# include zlib
add_subdirectory(${CMAKE_CURRENT_SOURCE_DIR}/third_party/zlib)

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
${CMAKE_CURRENT_SOURCE_DIR}/platform/quiche_platform_impl/quiche_export_impl.h
${CMAKE_CURRENT_SOURCE_DIR}/platform/quiche_platform_impl/quiche_logging_impl.h
${CMAKE_CURRENT_SOURCE_DIR}/platform/quiche_platform_impl/quiche_logging_impl.cc
${CMAKE_CURRENT_SOURCE_DIR}/platform/quiche_platform_impl/quiche_containers_impl.h
${CMAKE_CURRENT_SOURCE_DIR}/platform/quiche_platform_impl/quiche_bug_tracker_impl.h
${CMAKE_CURRENT_SOURCE_DIR}/platform/quiche_platform_impl/quic_mutex_impl.h
${CMAKE_CURRENT_SOURCE_DIR}/platform/quiche_platform_impl/quiche_time_utils_impl.h
${CMAKE_CURRENT_SOURCE_DIR}/platform/quiche_platform_impl/quiche_time_utils_impl.cc
${CMAKE_CURRENT_SOURCE_DIR}/platform/quiche_platform_impl/quic_testvalue_impl.h
${CMAKE_CURRENT_SOURCE_DIR}/platform/quiche_platform_impl/quiche_prefetch_impl.h
${CMAKE_CURRENT_SOURCE_DIR}/platform/net/quiche/common/platform/impl/quiche_flags_impl.h
${CMAKE_CURRENT_SOURCE_DIR}/platform/net/quiche/common/platform/impl/quiche_flags_impl.cc
${CMAKE_CURRENT_SOURCE_DIR}/platform/net/quiche/common/platform/impl/quiche_mem_slice_impl.h
${CMAKE_CURRENT_SOURCE_DIR}/platform/net/quiche/common/platform/impl/quiche_mem_slice_impl.cc
${CMAKE_CURRENT_SOURCE_DIR}/platform/quiche_platform_impl/quiche_flag_utils_impl.h
${CMAKE_CURRENT_SOURCE_DIR}/platform/net/quic/platform/impl/quic_flags_impl.h
#${CMAKE_CURRENT_SOURCE_DIR}/platform/net/quic/platform/impl/quic_mem_slice_impl.h
#${CMAKE_CURRENT_SOURCE_DIR}/platform/net/quic/platform/impl/quic_mem_slice_impl.cc
${CMAKE_CURRENT_SOURCE_DIR}/platform/net/quic/platform/impl/quic_iovec_impl.h
${CMAKE_CURRENT_SOURCE_DIR}/platform/net/quic/platform/impl/quic_hostname_utils_impl.h
${CMAKE_CURRENT_SOURCE_DIR}/platform/net/quic/platform/impl/quic_hostname_utils_impl.cc
${CMAKE_CURRENT_SOURCE_DIR}/platform/net/quic/platform/impl/quic_reference_counted_impl.h
${CMAKE_CURRENT_SOURCE_DIR}/platform/net/quic/platform/impl/quic_client_stats_impl.h
${CMAKE_CURRENT_SOURCE_DIR}/platform/net/quic/platform/impl/quic_udp_socket_platform_impl.h
${CMAKE_CURRENT_SOURCE_DIR}/platform/net/quic/platform/impl/quic_server_stats_impl.h
${CMAKE_CURRENT_SOURCE_DIR}/platform/net/quic/platform/impl/quic_stack_trace_impl.h
${CMAKE_CURRENT_SOURCE_DIR}/platform/net/quic/platform/impl/quic_epoll_clock.h
${CMAKE_CURRENT_SOURCE_DIR}/platform/net/quic/platform/impl/quic_epoll_clock.cc
#protofiles
#${PROTO_SRCS}
#${CMAKE_CURRENT_BINARY_DIR}/third_party/quiche/quic/core/proto/cached_network_parameters.pb.h
#${CMAKE_CURRENT_BINARY_DIR}/third_party/quiche/quic/core/proto/crypto_server_config.pb.h
#${CMAKE_CURRENT_BINARY_DIR}/third_party/quiche/quic/core/proto/source_address_token.pb.h
#${CMAKE_CURRENT_BINARY_DIR}/third_party/quiche/quic/core/proto/cached_network_parameters.pb.cc
#${CMAKE_CURRENT_BINARY_DIR}/third_party/quiche/quic/core/proto/crypto_server_config.pb.cc
#${CMAKE_CURRENT_BINARY_DIR}/third_party/quiche/quic/core/proto/source_address_token.pb.cc
# normal files
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/common/platform/api/quiche_bug_tracker.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/common/platform/api/quiche_export.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/common/platform/api/quiche_flag_utils.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/common/platform/api/quiche_flags.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/common/platform/api/quiche_logging.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/common/platform/api/quiche_mem_slice.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/common/platform/api/quiche_prefetch.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/common/platform/api/quiche_thread_local.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/common/platform/api/quiche_time_utils.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/common/platform/api/quiche_url_utils.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/common/platform/default/quiche_platform_impl/quiche_prefetch_impl.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/common/platform/default/quiche_platform_impl/quic_mutex_impl.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/common/platform/default/quiche_platform_impl/quic_mutex_impl.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/common/print_elements.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/common/quiche_circular_deque.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/common/quiche_data_reader.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/common/quiche_data_reader.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/common/quiche_data_writer.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/common/quiche_data_writer.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/common/quiche_endian.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/common/quiche_linked_hash_map.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/common/quiche_mem_slice_storage.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/common/quiche_mem_slice_storage.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/common/quiche_text_utils.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/common/quiche_text_utils.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/epoll_server/simple_epoll_server.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/epoll_server/simple_epoll_server.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/http2/adapter/data_source.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/http2/adapter/event_forwarder.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/http2/adapter/event_forwarder.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/http2/adapter/header_validator.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/http2/adapter/header_validator.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/http2/adapter/http2_adapter.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/http2/adapter/http2_protocol.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/http2/adapter/http2_protocol.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/http2/adapter/http2_session.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/http2/adapter/http2_util.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/http2/adapter/http2_util.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/http2/adapter/http2_visitor_interface.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/http2/adapter/oghttp2_adapter.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/http2/adapter/oghttp2_adapter.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/http2/adapter/oghttp2_session.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/http2/adapter/oghttp2_session.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/http2/adapter/oghttp2_util.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/http2/adapter/oghttp2_util.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/http2/adapter/window_manager.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/http2/adapter/window_manager.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/http2/core/http2_trace_logging.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/http2/core/http2_trace_logging.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/http2/core/priority_write_scheduler.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/http2/core/write_scheduler.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/http2/decoder/decode_buffer.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/http2/decoder/decode_buffer.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/http2/decoder/decode_http2_structures.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/http2/decoder/decode_http2_structures.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/http2/decoder/decode_status.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/http2/decoder/decode_status.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/http2/decoder/frame_decoder_state.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/http2/decoder/frame_decoder_state.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/http2/decoder/http2_frame_decoder.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/http2/decoder/http2_frame_decoder.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/http2/decoder/http2_frame_decoder_listener.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/http2/decoder/http2_frame_decoder_listener.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/http2/decoder/http2_structure_decoder.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/http2/decoder/http2_structure_decoder.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/http2/decoder/payload_decoders/altsvc_payload_decoder.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/http2/decoder/payload_decoders/altsvc_payload_decoder.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/http2/decoder/payload_decoders/continuation_payload_decoder.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/http2/decoder/payload_decoders/continuation_payload_decoder.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/http2/decoder/payload_decoders/data_payload_decoder.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/http2/decoder/payload_decoders/data_payload_decoder.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/http2/decoder/payload_decoders/goaway_payload_decoder.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/http2/decoder/payload_decoders/goaway_payload_decoder.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/http2/decoder/payload_decoders/headers_payload_decoder.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/http2/decoder/payload_decoders/headers_payload_decoder.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/http2/decoder/payload_decoders/ping_payload_decoder.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/http2/decoder/payload_decoders/ping_payload_decoder.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/http2/decoder/payload_decoders/priority_payload_decoder.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/http2/decoder/payload_decoders/priority_payload_decoder.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/http2/decoder/payload_decoders/priority_update_payload_decoder.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/http2/decoder/payload_decoders/priority_update_payload_decoder.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/http2/decoder/payload_decoders/push_promise_payload_decoder.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/http2/decoder/payload_decoders/push_promise_payload_decoder.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/http2/decoder/payload_decoders/rst_stream_payload_decoder.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/http2/decoder/payload_decoders/rst_stream_payload_decoder.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/http2/decoder/payload_decoders/settings_payload_decoder.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/http2/decoder/payload_decoders/settings_payload_decoder.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/http2/decoder/payload_decoders/unknown_payload_decoder.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/http2/decoder/payload_decoders/unknown_payload_decoder.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/http2/decoder/payload_decoders/window_update_payload_decoder.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/http2/decoder/payload_decoders/window_update_payload_decoder.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/http2/hpack/decoder/hpack_block_decoder.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/http2/hpack/decoder/hpack_block_decoder.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/http2/hpack/decoder/hpack_decoder.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/http2/hpack/decoder/hpack_decoder.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/http2/hpack/decoder/hpack_decoder_listener.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/http2/hpack/decoder/hpack_decoder_listener.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/http2/hpack/decoder/hpack_decoder_state.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/http2/hpack/decoder/hpack_decoder_state.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/http2/hpack/decoder/hpack_decoder_string_buffer.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/http2/hpack/decoder/hpack_decoder_string_buffer.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/http2/hpack/decoder/hpack_decoder_tables.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/http2/hpack/decoder/hpack_decoder_tables.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/http2/hpack/decoder/hpack_decoding_error.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/http2/hpack/decoder/hpack_decoding_error.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/http2/hpack/decoder/hpack_entry_decoder.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/http2/hpack/decoder/hpack_entry_decoder.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/http2/hpack/decoder/hpack_entry_decoder_listener.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/http2/hpack/decoder/hpack_entry_decoder_listener.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/http2/hpack/decoder/hpack_entry_type_decoder.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/http2/hpack/decoder/hpack_entry_type_decoder.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/http2/hpack/decoder/hpack_string_decoder.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/http2/hpack/decoder/hpack_string_decoder.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/http2/hpack/decoder/hpack_string_decoder_listener.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/http2/hpack/decoder/hpack_string_decoder_listener.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/http2/hpack/decoder/hpack_whole_entry_buffer.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/http2/hpack/decoder/hpack_whole_entry_buffer.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/http2/hpack/decoder/hpack_whole_entry_listener.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/http2/hpack/decoder/hpack_whole_entry_listener.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/http2/hpack/hpack_static_table_entries.inc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/http2/hpack/http2_hpack_constants.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/http2/hpack/http2_hpack_constants.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/http2/hpack/huffman/hpack_huffman_decoder.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/http2/hpack/huffman/hpack_huffman_decoder.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/http2/hpack/huffman/hpack_huffman_encoder.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/http2/hpack/huffman/hpack_huffman_encoder.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/http2/hpack/huffman/huffman_spec_tables.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/http2/hpack/huffman/huffman_spec_tables.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/http2/hpack/varint/hpack_varint_decoder.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/http2/hpack/varint/hpack_varint_decoder.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/http2/hpack/varint/hpack_varint_encoder.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/http2/hpack/varint/hpack_varint_encoder.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/http2/http2_constants.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/http2/http2_constants.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/http2/http2_structures.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/http2/http2_structures.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/http2/platform/api/http2_bug_tracker.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/http2/platform/api/http2_flag_utils.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/http2/platform/api/http2_flags.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/http2/platform/api/http2_logging.h
#${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/http2/platform/api/http2_macros.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/chlo_extractor.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/chlo_extractor.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/congestion_control/bandwidth_sampler.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/congestion_control/bandwidth_sampler.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/congestion_control/bbr2_drain.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/congestion_control/bbr2_drain.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/congestion_control/bbr2_misc.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/congestion_control/bbr2_misc.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/congestion_control/bbr2_probe_bw.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/congestion_control/bbr2_probe_bw.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/congestion_control/bbr2_probe_rtt.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/congestion_control/bbr2_probe_rtt.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/congestion_control/bbr2_sender.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/congestion_control/bbr2_sender.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/congestion_control/bbr2_startup.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/congestion_control/bbr2_startup.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/congestion_control/bbr_sender.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/congestion_control/bbr_sender.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/congestion_control/cubic_bytes.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/congestion_control/cubic_bytes.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/congestion_control/general_loss_algorithm.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/congestion_control/general_loss_algorithm.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/congestion_control/hybrid_slow_start.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/congestion_control/hybrid_slow_start.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/congestion_control/loss_detection_interface.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/congestion_control/pacing_sender.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/congestion_control/pacing_sender.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/congestion_control/prr_sender.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/congestion_control/prr_sender.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/congestion_control/rtt_stats.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/congestion_control/rtt_stats.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/congestion_control/send_algorithm_interface.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/congestion_control/send_algorithm_interface.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/congestion_control/tcp_cubic_sender_bytes.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/congestion_control/tcp_cubic_sender_bytes.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/congestion_control/uber_loss_algorithm.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/congestion_control/uber_loss_algorithm.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/congestion_control/windowed_filter.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/crypto/aead_base_decrypter.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/crypto/aead_base_decrypter.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/crypto/aead_base_encrypter.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/crypto/aead_base_encrypter.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/crypto/aes_128_gcm_12_decrypter.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/crypto/aes_128_gcm_12_decrypter.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/crypto/aes_128_gcm_12_encrypter.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/crypto/aes_128_gcm_12_encrypter.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/crypto/aes_128_gcm_decrypter.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/crypto/aes_128_gcm_decrypter.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/crypto/aes_128_gcm_encrypter.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/crypto/aes_128_gcm_encrypter.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/crypto/aes_256_gcm_decrypter.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/crypto/aes_256_gcm_decrypter.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/crypto/aes_256_gcm_encrypter.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/crypto/aes_256_gcm_encrypter.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/crypto/aes_base_decrypter.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/crypto/aes_base_decrypter.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/crypto/aes_base_encrypter.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/crypto/aes_base_encrypter.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/crypto/boring_utils.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/crypto/cert_compressor.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/crypto/cert_compressor.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/crypto/certificate_view.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/crypto/certificate_view.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/crypto/chacha20_poly1305_decrypter.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/crypto/chacha20_poly1305_decrypter.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/crypto/chacha20_poly1305_encrypter.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/crypto/chacha20_poly1305_encrypter.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/crypto/chacha20_poly1305_tls_decrypter.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/crypto/chacha20_poly1305_tls_decrypter.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/crypto/chacha20_poly1305_tls_encrypter.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/crypto/chacha20_poly1305_tls_encrypter.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/crypto/chacha_base_decrypter.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/crypto/chacha_base_decrypter.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/crypto/chacha_base_encrypter.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/crypto/chacha_base_encrypter.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/crypto/channel_id.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/crypto/channel_id.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/crypto/client_proof_source.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/crypto/client_proof_source.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/crypto/common_cert_set.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/crypto/common_cert_set.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/crypto/crypto_framer.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/crypto/crypto_framer.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/crypto/crypto_handshake.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/crypto/crypto_handshake.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/crypto/crypto_handshake_message.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/crypto/crypto_handshake_message.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/crypto/crypto_message_parser.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/crypto/crypto_protocol.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/crypto/crypto_secret_boxer.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/crypto/crypto_secret_boxer.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/crypto/crypto_utils.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/crypto/crypto_utils.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/crypto/curve25519_key_exchange.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/crypto/curve25519_key_exchange.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/crypto/key_exchange.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/crypto/key_exchange.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/crypto/null_decrypter.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/crypto/null_decrypter.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/crypto/null_encrypter.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/crypto/null_encrypter.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/crypto/p256_key_exchange.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/crypto/p256_key_exchange.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/crypto/proof_source_x509.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/crypto/proof_source_x509.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/crypto/proof_source.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/crypto/proof_source.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/crypto/proof_verifier.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/crypto/quic_client_session_cache.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/crypto/quic_client_session_cache.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/crypto/quic_compressed_certs_cache.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/crypto/quic_compressed_certs_cache.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/crypto/quic_crypter.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/crypto/quic_crypter.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/crypto/quic_crypto_client_config.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/crypto/quic_crypto_client_config.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/crypto/quic_crypto_proof.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/crypto/quic_crypto_proof.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/crypto/quic_crypto_server_config.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/crypto/quic_crypto_server_config.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/crypto/quic_decrypter.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/crypto/quic_decrypter.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/crypto/quic_encrypter.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/crypto/quic_encrypter.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/crypto/quic_hkdf.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/crypto/quic_hkdf.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/crypto/quic_random.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/crypto/quic_random.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/crypto/tls_client_connection.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/crypto/tls_client_connection.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/crypto/tls_connection.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/crypto/tls_connection.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/crypto/tls_server_connection.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/crypto/tls_server_connection.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/crypto/transport_parameters.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/crypto/transport_parameters.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_epoll_alarm_factory.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_epoll_alarm_factory.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/frames/quic_ack_frame.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/frames/quic_ack_frame.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/frames/quic_ack_frequency_frame.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/frames/quic_ack_frequency_frame.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/frames/quic_blocked_frame.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/frames/quic_blocked_frame.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/frames/quic_connection_close_frame.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/frames/quic_connection_close_frame.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/frames/quic_crypto_frame.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/frames/quic_crypto_frame.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/frames/quic_frame.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/frames/quic_frame.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/frames/quic_goaway_frame.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/frames/quic_goaway_frame.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/frames/quic_handshake_done_frame.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/frames/quic_handshake_done_frame.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/frames/quic_inlined_frame.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/frames/quic_max_streams_frame.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/frames/quic_max_streams_frame.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/frames/quic_message_frame.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/frames/quic_message_frame.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/frames/quic_mtu_discovery_frame.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/frames/quic_new_connection_id_frame.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/frames/quic_new_connection_id_frame.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/frames/quic_new_token_frame.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/frames/quic_new_token_frame.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/frames/quic_padding_frame.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/frames/quic_padding_frame.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/frames/quic_path_challenge_frame.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/frames/quic_path_challenge_frame.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/frames/quic_path_response_frame.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/frames/quic_path_response_frame.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/frames/quic_ping_frame.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/frames/quic_ping_frame.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/frames/quic_retire_connection_id_frame.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/frames/quic_retire_connection_id_frame.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/frames/quic_rst_stream_frame.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/frames/quic_rst_stream_frame.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/frames/quic_stop_sending_frame.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/frames/quic_stop_sending_frame.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/frames/quic_stop_waiting_frame.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/frames/quic_stop_waiting_frame.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/frames/quic_stream_frame.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/frames/quic_stream_frame.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/frames/quic_streams_blocked_frame.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/frames/quic_streams_blocked_frame.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/frames/quic_window_update_frame.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/frames/quic_window_update_frame.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/handshaker_delegate_interface.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/http/capsule.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/http/capsule.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/http/http_constants.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/http/http_constants.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/http/http_decoder.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/http/http_decoder.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/http/http_encoder.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/http/http_encoder.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/http/http_frames.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/http/quic_client_promised_info.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/http/quic_client_promised_info.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/http/quic_client_push_promise_index.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/http/quic_client_push_promise_index.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/http/quic_header_list.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/http/quic_header_list.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/http/quic_headers_stream.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/http/quic_headers_stream.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/http/quic_receive_control_stream.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/http/quic_receive_control_stream.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/http/quic_send_control_stream.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/http/quic_send_control_stream.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/http/quic_server_initiated_spdy_stream.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/http/quic_server_initiated_spdy_stream.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/http/quic_server_session_base.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/http/quic_server_session_base.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/http/quic_spdy_client_session.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/http/quic_spdy_client_session.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/http/quic_spdy_client_session_base.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/http/quic_spdy_client_session_base.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/http/quic_spdy_client_stream.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/http/quic_spdy_client_stream.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/http/quic_spdy_server_stream_base.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/http/quic_spdy_server_stream_base.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/http/quic_spdy_session.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/http/quic_spdy_session.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/http/quic_spdy_stream.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/http/quic_spdy_stream.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/http/quic_spdy_stream_body_manager.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/http/quic_spdy_stream_body_manager.h
# ${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/http/spdy_server_push_utils.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/http/spdy_server_push_utils.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/http/spdy_utils.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/http/spdy_utils.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/http/web_transport_http3.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/http/web_transport_http3.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/http/web_transport_stream_adapter.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/http/web_transport_stream_adapter.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/legacy_quic_stream_id_manager.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/legacy_quic_stream_id_manager.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/packet_number_indexed_queue.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/proto/cached_network_parameters_proto.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/proto/crypto_server_config_proto.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/proto/source_address_token_proto.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/qpack/qpack_blocking_manager.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/qpack/qpack_blocking_manager.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/qpack/qpack_decoded_headers_accumulator.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/qpack/qpack_decoded_headers_accumulator.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/qpack/qpack_decoder.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/qpack/qpack_decoder.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/qpack/qpack_decoder_stream_receiver.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/qpack/qpack_decoder_stream_receiver.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/qpack/qpack_decoder_stream_sender.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/qpack/qpack_decoder_stream_sender.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/qpack/qpack_encoder.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/qpack/qpack_encoder.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/qpack/qpack_encoder_stream_receiver.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/qpack/qpack_encoder_stream_receiver.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/qpack/qpack_encoder_stream_sender.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/qpack/qpack_encoder_stream_sender.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/qpack/qpack_header_table.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/qpack/qpack_header_table.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/qpack/qpack_index_conversions.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/qpack/qpack_index_conversions.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/qpack/qpack_instruction_decoder.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/qpack/qpack_instruction_decoder.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/qpack/qpack_instruction_encoder.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/qpack/qpack_instruction_encoder.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/qpack/qpack_instructions.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/qpack/qpack_instructions.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/qpack/qpack_progressive_decoder.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/qpack/qpack_progressive_decoder.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/qpack/qpack_receive_stream.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/qpack/qpack_receive_stream.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/qpack/qpack_required_insert_count.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/qpack/qpack_required_insert_count.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/qpack/qpack_send_stream.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/qpack/qpack_send_stream.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/qpack/qpack_static_table.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/qpack/qpack_static_table.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/qpack/qpack_stream_receiver.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/qpack/qpack_stream_sender_delegate.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/qpack/value_splitting_header_list.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/qpack/value_splitting_header_list.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_ack_listener_interface.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_ack_listener_interface.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_alarm.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_alarm.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_alarm_factory.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_arena_scoped_ptr.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_bandwidth.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_bandwidth.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_blocked_writer_interface.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_buffer_allocator.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_buffer_allocator.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_buffered_packet_store.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_buffered_packet_store.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_chaos_protector.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_chaos_protector.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_clock.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_clock.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_coalesced_packet.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_coalesced_packet.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_config.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_config.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_connection.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_connection.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_connection_context.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_connection_context.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_connection_id.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_connection_id.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_connection_id_manager.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_connection_id_manager.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_connection_stats.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_connection_stats.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_constants.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_constants.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_control_frame_manager.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_control_frame_manager.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_crypto_client_handshaker.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_crypto_client_handshaker.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_crypto_client_stream.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_crypto_client_stream.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_crypto_handshaker.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_crypto_handshaker.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_crypto_server_stream.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_crypto_server_stream.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_crypto_server_stream_base.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_crypto_server_stream_base.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_crypto_stream.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_crypto_stream.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_data_reader.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_data_reader.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_data_writer.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_data_writer.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_datagram_queue.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_datagram_queue.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_default_packet_writer.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_default_packet_writer.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_dispatcher.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_dispatcher.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_error_codes.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_error_codes.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_epoll_connection_helper.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_epoll_connection_helper.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_flags_list.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_flow_controller.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_flow_controller.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_framer.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_framer.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_idle_network_detector.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_idle_network_detector.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_interval.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_interval_deque.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_interval_set.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_legacy_version_encapsulator.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_legacy_version_encapsulator.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_lru_cache.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_mtu_discovery.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_mtu_discovery.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_network_blackhole_detector.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_network_blackhole_detector.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_one_block_arena.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_packet_creator.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_packet_creator.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_packet_number.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_packet_number.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_packet_reader.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_packet_reader.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_packet_writer.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_packets.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_packets.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_path_validator.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_path_validator.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_protocol_flags_list.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_received_packet_manager.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_received_packet_manager.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_sent_packet_manager.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_sent_packet_manager.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_server_id.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_server_id.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_session.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_session.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_simple_buffer_allocator.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_simple_buffer_allocator.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_socket_address_coder.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_socket_address_coder.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_stream.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_stream.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_stream_frame_data_producer.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_stream_id_manager.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_stream_id_manager.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_stream_send_buffer.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_stream_send_buffer.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_stream_sequencer.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_stream_sequencer.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_stream_sequencer_buffer.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_stream_sequencer_buffer.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_sustained_bandwidth_recorder.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_sustained_bandwidth_recorder.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_tag.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_tag.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_time.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_time.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_time_wait_list_manager.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_time_wait_list_manager.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_time_accumulator.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_transmission_info.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_transmission_info.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_types.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_types.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_unacked_packet_map.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_unacked_packet_map.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_utils.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_utils.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_version_manager.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_version_manager.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_versions.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_versions.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_write_blocked_list.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_write_blocked_list.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/session_notifier_interface.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/stream_delegate_interface.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/tls_chlo_extractor.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/tls_chlo_extractor.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/tls_client_handshaker.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/tls_client_handshaker.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/tls_client_handshaker.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/tls_handshaker.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/tls_handshaker.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/tls_server_handshaker.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/tls_server_handshaker.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/uber_quic_stream_id_manager.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/uber_quic_stream_id_manager.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/uber_received_packet_manager.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/uber_received_packet_manager.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_udp_socket_posix.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/core/quic_udp_socket.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/platform/api/quic_bug_tracker.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/platform/api/quic_client_stats.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/platform/api/quic_containers.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/platform/api/quic_error_code_wrappers.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/platform/api/quic_export.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/platform/api/quic_exported_stats.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/platform/api/quic_flag_utils.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/platform/api/quic_flags.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/platform/api/quic_hostname_utils.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/platform/api/quic_hostname_utils.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/platform/api/quic_iovec.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/platform/api/quic_ip_address.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/platform/api/quic_ip_address.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/platform/api/quic_ip_address_family.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/platform/api/quic_logging.h
#${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/platform/api/quic_mem_slice.h
#${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/platform/api/quic_mem_slice_storage.cc
#${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/platform/api/quic_mem_slice_storage.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/platform/api/quic_mutex.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/platform/api/quic_mutex.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/platform/api/quic_reference_counted.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/platform/api/quic_server_stats.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/platform/api/quic_sleep.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/platform/api/quic_socket_address.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/platform/api/quic_socket_address.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/platform/api/quic_stack_trace.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/platform/api/quic_thread.h
#${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/quic_transport/quic_transport_client_session.cc
#${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/quic_transport/quic_transport_client_session.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/quic_transport/quic_transport_protocol.h
#${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/quic_transport/quic_transport_server_session.cc
#${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/quic_transport/quic_transport_server_session.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/quic_transport/quic_transport_session_interface.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/quic_transport/quic_transport_stream.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/quic_transport/quic_transport_stream.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/quic_transport/web_transport_fingerprint_proof_verifier.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/quic_transport/web_transport_fingerprint_proof_verifier.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/tools/quic_simple_crypto_server_stream_helper.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/quic/tools/quic_simple_crypto_server_stream_helper.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/spdy/core/hpack/hpack_constants.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/spdy/core/hpack/hpack_constants.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/spdy/core/hpack/hpack_decoder_adapter.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/spdy/core/hpack/hpack_decoder_adapter.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/spdy/core/hpack/hpack_encoder.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/spdy/core/hpack/hpack_encoder.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/spdy/core/hpack/hpack_entry.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/spdy/core/hpack/hpack_entry.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/spdy/core/hpack/hpack_header_table.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/spdy/core/hpack/hpack_header_table.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/spdy/core/hpack/hpack_output_stream.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/spdy/core/hpack/hpack_output_stream.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/spdy/core/hpack/hpack_static_table.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/spdy/core/hpack/hpack_static_table.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/spdy/core/http2_frame_decoder_adapter.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/spdy/core/http2_frame_decoder_adapter.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/spdy/core/recording_headers_handler.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/spdy/core/recording_headers_handler.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/spdy/core/spdy_alt_svc_wire_format.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/spdy/core/spdy_alt_svc_wire_format.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/spdy/core/spdy_bitmasks.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/spdy/core/spdy_frame_builder.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/spdy/core/spdy_frame_builder.h
#${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/spdy/core/spdy_frame_reader.cc
#${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/spdy/core/spdy_frame_reader.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/spdy/core/spdy_framer.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/spdy/core/spdy_framer.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/spdy/core/spdy_header_block.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/spdy/core/spdy_header_block.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/spdy/core/spdy_header_storage.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/spdy/core/spdy_header_storage.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/spdy/core/spdy_headers_handler_interface.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/spdy/core/spdy_intrusive_list.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/spdy/core/spdy_no_op_visitor.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/spdy/core/spdy_no_op_visitor.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/spdy/core/spdy_pinnable_buffer_piece.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/spdy/core/spdy_pinnable_buffer_piece.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/spdy/core/spdy_prefixed_buffer_reader.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/spdy/core/spdy_prefixed_buffer_reader.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/spdy/core/spdy_protocol.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/spdy/core/spdy_protocol.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/spdy/core/spdy_simple_arena.cc
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/spdy/core/spdy_simple_arena.h
${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche/spdy/core/zero_copy_output_buffer.h
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


target_include_directories(gquiche
PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/third_party/quiche
PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/third_party/boringssl/src/include
PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/platform
PUBLIC .
PUBLIC ${CMAKE_CURRENT_BINARY_DIR}
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


# google quiche build parameters end

#include_directories(${CMAKE_JS_INC})
file(GLOB SOURCE_FILES "src/*.cc" "src/*.h")
add_library(${PROJECT_NAME} SHARED ${SOURCE_FILES} ${CMAKE_JS_SRC})
set_target_properties(${PROJECT_NAME} PROPERTIES PREFIX "" SUFFIX ".node")
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


add_definitions(-DNAPI_VERSION=3)




