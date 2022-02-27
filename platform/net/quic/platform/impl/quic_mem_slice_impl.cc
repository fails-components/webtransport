// Copyright 2017 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "net/quic/platform/impl/quic_mem_slice_impl.h"

#include "quic/core/quic_buffer_allocator.h"

namespace quic {



QuicMemSliceImpl::QuicMemSliceImpl() = default;

QuicMemSliceImpl::QuicMemSliceImpl(QuicUniqueBufferPtr buffer, size_t length) {
  io_buffer_ = std::shared_ptr<char[]>(std::move(buffer));
  length_ = length;
}

QuicMemSliceImpl::QuicMemSliceImpl(std::unique_ptr<char[]> buffer,
                                   size_t length) {
  io_buffer_ = std::shared_ptr<char[]>(std::move(buffer));
  length_ = length;
}

/*
QuicMemSliceImpl::QuicMemSliceImpl(scoped_refptr<net::IOBuffer> io_buffer,
                                   size_t length)
    : io_buffer_(std::move(io_buffer)), length_(length) {}
*/

QuicMemSliceImpl::QuicMemSliceImpl(QuicMemSliceImpl&& other)
    : io_buffer_(std::move(other.io_buffer_)), length_(other.length_) {
  other.length_ = 0;
}


QuicMemSliceImpl& QuicMemSliceImpl::operator=(QuicMemSliceImpl&& other) {
  io_buffer_ = std::move(other.io_buffer_);
  length_ = other.length_;
  other.length_ = 0;
  return *this;
}

QuicMemSliceImpl::~QuicMemSliceImpl() = default;

void QuicMemSliceImpl::Reset() {
  io_buffer_ = nullptr;
  length_ = 0;
}

const char* QuicMemSliceImpl::data() const {
  if (io_buffer_ == nullptr) {
    return nullptr;
  }
  return io_buffer_.get();
}

}  // namespace quic