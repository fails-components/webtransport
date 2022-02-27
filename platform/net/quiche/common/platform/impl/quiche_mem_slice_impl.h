// Copyright 2017 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef NET_QUIC_PLATFORM_IMPL_QUICHE_MEM_SLICE_IMPL_H_
#define NET_QUIC_PLATFORM_IMPL_QUICHE_MEM_SLICE_IMPL_H_

#include <memory>
#include <vector>


#include "quic/core/quic_buffer_allocator.h"
#include "quic/platform/api/quic_export.h"

namespace quiche {

// QuicMemSliceImpl TODO(fayang)
class QUIC_EXPORT_PRIVATE QuicheMemSliceImpl {
 public:
  // Constructs an empty QuicMemSliceImpl.
  QuicheMemSliceImpl();
  // Constructs a QuicMemSliceImp by let |allocator| allocate a data buffer of
  // |length|.
  QuicheMemSliceImpl(quic::QuicUniqueBufferPtr buffer, size_t length);
  QuicheMemSliceImpl(std::unique_ptr<char[]> buffer, size_t length);

  // QuicheMemSliceImpl(scoped_refptr<net::IOBuffer> io_buffer, size_t length);

  QuicheMemSliceImpl(const QuicheMemSliceImpl& other) = delete;
  QuicheMemSliceImpl& operator=(const QuicheMemSliceImpl& other) = delete;

  // Move constructors. |other| will not hold a reference to the data buffer
  // after this call completes.
  QuicheMemSliceImpl(QuicheMemSliceImpl&& other);
  QuicheMemSliceImpl& operator=(QuicheMemSliceImpl&& other);

  ~QuicheMemSliceImpl();

  // Release the underlying reference. Further access the memory will result in
  // undefined behavior.
  void Reset();

  // Returns a char pointer to underlying data buffer.
  const char* data() const;
  // Returns the length of underlying data buffer.
  size_t length() const { return length_; }

  bool empty() const { return length_ == 0; }

  // scoped_refptr<net::IOBuffer>* impl() { return &io_buffer_; }

  size_t* impl_length() { return &length_; }

 private:
  std::shared_ptr<char[]> io_buffer_;
  // Length of io_buffer_.
  size_t length_ = 0;
};

}  // namespace quic

#endif  