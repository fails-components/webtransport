// Copyright 2017 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.
#ifndef NET_TOOLS_EPOLL_SERVER_PLATFORM_IMPL_EPOLL_LOGGING_IMPL_H_
#define NET_TOOLS_EPOLL_SERVER_PLATFORM_IMPL_EPOLL_LOGGING_IMPL_H_

#include "platform/quiche_platform_impl/quiche_logging_impl.h"
/*
#define EPOLL_CHROMIUM_LOG_INFO VLOG(1)
#define EPOLL_CHROMIUM_LOG_WARNING DLOG(WARNING)
#define EPOLL_CHROMIUM_LOG_ERROR DLOG(ERROR)
#define EPOLL_CHROMIUM_LOG_FATAL LOG(FATAL)
#define EPOLL_CHROMIUM_LOG_DFATAL LOG(DFATAL) */
#define EPOLL_LOG_IMPL(severity) QUICHE_LOG_IMPL(severity)
#define EPOLL_VLOG_IMPL(verbose_level) QUICHE_VLOG_IMPL(verbose_level)
#define EPOLL_DVLOG_IMPL(verbose_level) QUICHE_DVLOG_IMPL(verbose_level)
#define EPOLL_PLOG_IMPL(severity) QUICHE_DVLOG_IMPL(1)
#endif  // NET_TOOLS_EPOLL_SERVER_PLATFORM_IMPL_EPOLL_LOGGING_IMPL_H_
