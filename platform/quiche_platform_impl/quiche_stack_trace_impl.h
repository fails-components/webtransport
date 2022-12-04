// Copyright (c) 2017 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef NET_QUICHE_PLATFORM_IMPL_QUICHE_STACK_TRACE_IMPL_H_
#define NET_QUICHE_PLATFORM_IMPL_QUICHE_STACK_TRACE_IMPL_H_

#include <string>

// QuicStack is very slow and can actually easily stall the main event loop, therefore we replace it with a dummy.
/*
#include "third_party/quiche/quiche/common/platform/default/quiche_platform_impl/quiche_stack_trace_impl.h"
*/

namespace quiche {

// Returns a human-readable stack trace.  Mostly used in error logging and
// related features.
inline std::string QuicheStackTraceImpl() { return std::string("no stack trace"); }

// Indicates whether the unit test for QuicheStackTrace() should be run.  The
// unit test calls QuicheStackTrace() from a specific function and checks
// whether that specific function is in the stack trace.  This function should
// return false if:
//   (1) QuicheStackTrace() is unimplemented,
//   (2) QuicheStackTrace() does not work on the current platform, or
//   (3) QuicheStackTrace() works, but the symbols are not guaranteed to be
//       available.
inline bool QuicheShouldRunStackTraceTestImpl() {
  return false;
}

}  // namespace quiche

#endif  // NET_QUIC_PLATFORM_IMPL_QUIC_STACK_TRACE_IMPL_H_