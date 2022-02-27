// Copyright 2017 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "net/quiche/common/platform/impl/quiche_mem_slice_impl.h"

#include "quic/core/quic_buffer_allocator.h"

namespace quiche {



QuicheMemSliceImpl::QuicheMemSliceImpl() = default;

QuicheMemSliceImpl::QuicheMemSliceImpl(quic::QuicUniqueBufferPtr buffer, size_t length) {
  io_buffer_ = std::shared_ptr<char[]>(std::move(buffer));
  length_ = length;
}

QuicheMemSliceImpl::QuicheMemSliceImpl(std::unique_ptr<char[]> buffer,
                                   size_t length) {
  io_buffer_ = std::shared_ptr<char[]>(std::move(buffer));
  length_ = length;
}

/*
QuicMemSliceImpl::QuicMemSliceImpl(scoped_refptr<net::IOBuffer> io_buffer,
                                   size_t length)
    : io_buffer_(std::move(io_buffer)), length_(length) {}
*/

QuicheMemSliceImpl::QuicheMemSliceImpl(QuicheMemSliceImpl&& other)
    : io_buffer_(std::move(other.io_buffer_)), length_(other.length_) {
  other.length_ = 0;
}


QuicheMemSliceImpl& QuicheMemSliceImpl::operator=(QuicheMemSliceImpl&& other) {
  io_buffer_ = std::move(other.io_buffer_);
  length_ = other.length_;
  other.length_ = 0;
  return *this;
}

QuicheMemSliceImpl::~QuicheMemSliceImpl() = default;

void QuicheMemSliceImpl::Reset() {
  io_buffer_ = nullptr;
  length_ = 0;
}

const char* QuicheMemSliceImpl::data() const {
  if (io_buffer_ == nullptr) {
    return nullptr;
  }
  return io_buffer_.get();
}

}  // namespace quic