// Copyright 2020 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef NET_QUICHE_PLATFORM_IMPL_QUICHE_UDP_SOCKET_PLATFORM_IMPL_H_
#define NET_QUICHE_PLATFORM_IMPL_QUICHE_UDP_SOCKET_PLATFORM_IMPL_H_

#ifndef WIN32
#include <sys/socket.h>
#endif

#include <cstddef>
#include <cstdint>

namespace quiche {

const size_t kCmsgSpaceForGooglePacketHeaderImpl = 0;

inline bool GetGooglePacketHeadersFromControlMessageImpl(
    struct ::cmsghdr* cmsg,
    char** packet_headers,
    size_t* packet_headers_len) {
  return false;
}

inline void SetGoogleSocketOptionsImpl(int fd) {}

}  // namespace quic

#endif  // NET_QUIC_PLATFORM_IMPL_QUIC_UDP_SOCKET_PLATFORM_IMPL_H_