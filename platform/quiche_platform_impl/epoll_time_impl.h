// original copyright, see license file in lib quiche
// Copyright 2017 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.
#ifndef NET_TOOLS_EPOLL_SERVER_PLATFORM_IMPL_EPOLL_TIME_IMPL_H_
#define NET_TOOLS_EPOLL_SERVER_PLATFORM_IMPL_EPOLL_TIME_IMPL_H_

#include <chrono>

namespace epoll_server {
inline int64_t WallTimeNowInUsecImpl() {
    auto duration =  std::chrono::system_clock::now().time_since_epoch();
    return std::chrono::duration_cast<std::chrono::microseconds>(duration).count();
}
}  // namespace epoll_server
#endif  // NET_TOOLS_EPOLL_SERVER_PLATFORM_IMPL_EPOLL_TIME_IMPL_H_