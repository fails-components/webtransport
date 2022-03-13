//taken from chromiuns platform impl

// Copyright 2020 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "net/quiche/common/platform/impl/quiche_flags_impl.h"

#define QUIC_FLAG(flag, value) bool flag = value;
#define QUIC_FLAGT(type, flag, value) type flag = value;
#include "third_party/quiche/quic/core/quic_flags_list.h"
#include "net/quiche/common/platform/impl/quic_flags_list_add.h"
#undef QUIC_FLAG
#undef QUIC_FLAGT
// fix annoying compiler buf

#include "http2/decoder/decode_buffer.h"
namespace http2{
constexpr size_t DecodeBuffer::kMaxDecodeBufferLength;
}

