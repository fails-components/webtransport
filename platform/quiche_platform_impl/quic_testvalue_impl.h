// from envoy so LICENSE.envoy applies
#ifndef QUIC_TESTVALUE_IMPL_H
#define QUIC_TESTVALUE_IMPL_H

// NOLINT(namespace-envoy)

// This file is part of the QUICHE platform implementation, and is not to be
// consumed or referenced directly by other Envoy code. It serves purely as a
// porting layer for QUICHE.

#include "absl/strings/string_view.h"

namespace quic {

// NOLINTNEXTLINE(readability-identifier-naming)
template <class T> void AdjustTestValueImpl(absl::string_view /*label*/, T* /*var*/) {}

} // namespace quic
#endif