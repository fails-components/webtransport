// modified for fails webtransport by Marten Richter

//original Copyright by

// Copyright 2021 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

// This file does not actually implement logging, it merely provides enough of
// logging code for QUICHE to compile.  QUICHE embedders are encouraged to
// override this file with their own logic.  If at some point logging becomes a
// part of Abseil, this file will likely start using that instead.



#ifndef QUICHE_COMMON_PLATFORM_NODE_QUICHE_PLATFORM_IMPL_QUICHE_LOGGING_IMPL_H_
#define QUICHE_COMMON_PLATFORM_NODE_QUICHE_PLATFORM_IMPL_QUICHE_LOGGING_IMPL_H_

#include <cstdlib>
#include <iostream>
#include <sstream>
#include <string>

#include "absl/base/attributes.h"

namespace quiche {

class DevZeroBuf : public std::streambuf {
    public:
        std::streamsize xsputn (const char * s, std::streamsize n) override {
            return n;
        }
        int overflow (int c) override {
            return 1;
        }
};

class DevZeroStream : public std::ostream {
    public:
        DevZeroStream() : std::ostream (&buf) {}
    private:
        DevZeroBuf buf;
};

class StdoutLogSink {
 public:
  constexpr StdoutLogSink(): condition(true) {}

  constexpr StdoutLogSink(bool cond): condition(cond) {}

  constexpr StdoutLogSink(int level): condition(level<=logverbose) {}
  constexpr StdoutLogSink(const char*, bool cond): condition(cond) {}
  constexpr StdoutLogSink(int level, bool cond): condition(level<=logverbose && cond) {}

  template<typename T>
  constexpr StdoutLogSink(T& ptr): condition(ptr) {}


  constexpr std::ostream& stream() { return (condition && !nolog) ? std::cout: dump; }

  // This operator has lower precedence than << but higher than ?:, which is
  // useful for implementing QUICHE_DISREGARD_LOG_STREAM below.
  void operator&(std::ostream&) {}


  protected:
    bool condition;
    static DevZeroStream dump;
    const int logverbose=1;
    const bool nolog= true;

};


// We need to actually implement LOG(FATAL), otherwise some functions will fail
// to compile due to the "failed to return value from non-void function" error.
class FatalLogSink : public StdoutLogSink {
 public:
  ABSL_ATTRIBUTE_NORETURN ~FatalLogSink() { abort(); }
};

}  // namespace quiche

#define QUICHE_DVLOG_IMPL(verbose_level) \
  ::quiche::StdoutLogSink(#verbose_level).stream()
#define QUICHE_DVLOG_IF_IMPL(verbose_level, condition) \
  ::quiche::StdoutLogSink(#verbose_level, condition).stream()
#define QUICHE_DLOG_IMPL(severity) ::quiche::StdoutLogSink(#severity).stream()
#define QUICHE_DLOG_IF_IMPL(severity, condition) \
  ::quiche::StdoutLogSink(#severity, condition).stream()
#define QUICHE_VLOG_IMPL(verbose_level) \
  ::quiche::StdoutLogSink(#verbose_level).stream()
#define QUICHE_LOG_FIRST_N_IMPL(severity, n) \
  ::quiche::StdoutLogSink(#severity, n).stream()
#define QUICHE_LOG_EVERY_N_SEC_IMPL(severity, seconds) \
  ::quiche::StdoutLogSink(#severity, seconds).stream()
#define QUICHE_LOG_IF_IMPL(severity, condition) \
  ::quiche::StdoutLogSink(#severity, condition).stream()

#define QUICHE_LOG_IMPL(severity) QUICHE_LOG_IMPL_##severity()
#define QUICHE_LOG_IMPL_FATAL() ::quiche::FatalLogSink().stream()
#define QUICHE_LOG_IMPL_DFATAL() ::quiche::StdoutLogSink().stream()
#define QUICHE_LOG_IMPL_ERROR() ::quiche::StdoutLogSink().stream()
#define QUICHE_LOG_IMPL_WARNING() ::quiche::StdoutLogSink().stream()
#define QUICHE_LOG_IMPL_INFO() ::quiche::StdoutLogSink().stream()

#define QUICHE_PREDICT_FALSE_IMPL(x) (x)
#define QUICHE_PREDICT_TRUE_IMPL(x) (x)

#define QUICHE_PLOG_IMPL(severity) ::quiche::StdoutLogSink(#severity)

#define QUICHE_DLOG_INFO_IS_ON_IMPL() false
#define QUICHE_LOG_INFO_IS_ON_IMPL() false
#define QUICHE_LOG_WARNING_IS_ON_IMPL() false
#define QUICHE_LOG_ERROR_IS_ON_IMPL() false

// This is necessary because we sometimes call QUICHE_DCHECK inside constexpr
// functions, and then write non-constexpr expressions into the resulting log.
#define QUICHE_DISREGARD_LOG_STREAM(stream) \
  true ? (void)0 : ::quiche::StdoutLogSink() & (stream)

#define QUICHE_CHECK_IMPL(condition) ::quiche::StdoutLogSink(condition).stream()
#define QUICHE_CHECK_EQ_IMPL(val1, val2) \
  ::quiche::StdoutLogSink((val1)==(val2)).stream()
#define QUICHE_CHECK_NE_IMPL(val1, val2) \
  ::quiche::StdoutLogSink((val1)!=(val2)).stream()
#define QUICHE_CHECK_LE_IMPL(val1, val2) \
  ::quiche::StdoutLogSink((val1)<=(val2)).stream()
#define QUICHE_CHECK_LT_IMPL(val1, val2) \
  ::quiche::StdoutLogSink((val1)<(val2)).stream()
#define QUICHE_CHECK_GE_IMPL(val1, val2) \
  ::quiche::StdoutLogSink((val1)>=(val2)).stream()
#define QUICHE_CHECK_GT_IMPL(val1, val2) \
  ::quiche::StdoutLogSink((val1)>(val2)).stream()

#define QUICHE_DCHECK_IMPL(condition) \
  QUICHE_DISREGARD_LOG_STREAM(::quiche::StdoutLogSink(condition).stream())
#define QUICHE_DCHECK_EQ_IMPL(val1, val2) \
  ::quiche::StdoutLogSink((val1)==(val2)).stream()
#define QUICHE_DCHECK_NE_IMPL(val1, val2) \
  ::quiche::StdoutLogSink((val1)!=(val2)).stream()
#define QUICHE_DCHECK_LE_IMPL(val1, val2) \
  ::quiche::StdoutLogSink((val1)<=(val2)).stream()
#define QUICHE_DCHECK_LT_IMPL(val1, val2) \
  ::quiche::StdoutLogSink((val1)<(val2)).stream()
#define QUICHE_DCHECK_GE_IMPL(val1, val2) \
  ::quiche::StdoutLogSink((val1)>=(val2)).stream()
#define QUICHE_DCHECK_GT_IMPL(val1, val2) \
  ::quiche::StdoutLogSink((val1)>(val2)).stream()

#define QUICHE_NOTREACHED_IMPL() QUICHE_DCHECK_IMPL(false)

#endif  // QUICHE_COMMON_PLATFORM_DEFAULT_QUICHE_PLATFORM_IMPL_QUICHE_LOGGING_IMPL_H_
