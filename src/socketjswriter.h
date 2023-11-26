// Copyright (c) 2022 Marten Richter or other contributers (see commit). All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

// portions taken from libquiche, original copyright, see LICENSE.chromium
// Copyright (c)  The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef WT_SOCKETJS_WRITER_H
#define WT_SOCKETJS_WRITER_H

#include "quiche/quic/core/quic_packet_writer.h"
#include "quiche/quic/core/quic_udp_socket.h"
#include "src/napialarmfactory.h"

#include <napi.h>

namespace quic
{
    class Http3ServerJS;
    class SocketJSWriter : public QuicPacketWriter
    {
    public:
        SocketJSWriter(EnvGetter *eg) : writeBlocked_(false), eg_(eg)
        {
        }

        ~SocketJSWriter()  override {
        }

        void setCanWrite()
        {
            writeBlocked_ = false;
        }

        // QuicPacketWriter
        bool SupportsEcn() const override
        {
            return false;
        }

        bool IsBatchMode() const override
        {
            return false;
        }

        bool IsWriteBlocked() const override
        {
            return writeBlocked_;
        }

        bool SupportsReleaseTime() const override
        {
            return false;
        }

        void SetWritable() override
        {
            writeBlocked_ = false;
        }

        absl::optional<int> MessageTooBigErrorCode() const override
        {
            return kSocketErrorMsgSize;
        }

        QuicByteCount GetMaxPacketSize(
            const QuicSocketAddress & /*peer_address*/) const override
        {
            return kMaxOutgoingPacketSize;
        }

        WriteResult WritePacket(const char *buffer, size_t buf_len,
                                const QuicIpAddress &self_address,
                                const QuicSocketAddress &peer_address,
                                PerPacketOptions *options,
                                const QuicPacketWriterParams &params) override;

        QuicPacketBuffer GetNextWriteLocation(
            const QuicIpAddress &self_address,
            const QuicSocketAddress &peer_address) override
        {
            return {nullptr, nullptr};
        }

        WriteResult Flush() override
        {
            return WriteResult(WRITE_STATUS_OK, 0);
        }

    protected:
        bool writeBlocked_;
        EnvGetter *eg_; // unowned
    };


}

#endif