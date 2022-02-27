// Copyright 2017 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.
#ifndef NET_TOOLS_EPOLL_SERVER_PLATFORM_IMPL_EPOLL_BUG_IMPL_H_
#define NET_TOOLS_EPOLL_SERVER_PLATFORM_IMPL_EPOLL_BUG_IMPL_H_
#include "net/tools/epoll_server/platform/impl/epoll_logging_impl.h"
#define EPOLL_BUG_IMPL(bug_id) EPOLL_LOG_IMPL(DFATAL)
#define EPOLL_BUG_V2_IMPL(bug_id) EPOLL_LOG_IMPL(DFATAL)

#include "common/platform/api/quiche_logging.h"

#define DCHECK(var1) QUICHE_DCHECK(var1)
#define DCHECK_GE(var1, var2) QUICHE_DCHECK_GE(var1, var2)
#define DCHECK_GT(var1, var2) QUICHE_DCHECK_GT(var1, var2)
#define DCHECK_EQ(var1, var2) QUICHE_DCHECK_EQ(var1, var2)
#define DCHECK_NE(var1, var2) QUICHE_DCHECK_NE(var1, var2)
#define CHECK(var1) QUICHE_CHECK(var1)
#define CHECK_EQ(var1, var2) QUICHE_CHECK_EQ(var1, var2)
#define CHECK_NE(var1, var2) QUICHE_CHECK_NE(var1, var2)

#endif  // NET_TOOLS_EPOLL_SERVER_PLATFORM_IMPL_EPOLL_BUG_IMPL_H_