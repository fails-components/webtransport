// Copyright (c) 2022 Marten Richter or other contributers (see commit). All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

// portions taken from libquiche, original copyright, see LICENSE.chromium
// Copyright (c)  The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "src/socketjswriter.h"

namespace quic
{
    WriteResult SocketJSWriter::WritePacket(const char *buffer, size_t buf_len,
                                            const QuicIpAddress &self_address,
                                            const QuicSocketAddress &peer_address,
                                            PerPacketOptions *options,
                                            const QuicPacketWriterParams &params)
    {
        Napi::Object retObj = Napi::Object::New(eg_->getEnv());

        Napi::Buffer<char> nbuffer = Napi::Buffer<char>::New(eg_->getEnv(), buf_len);
        memcpy(nbuffer.Data(), buffer, buf_len);

        retObj.Set("msg", nbuffer);
        retObj.Set("length", buf_len);
        retObj.Set("offset", 0);
        retObj.Set("port", peer_address.port());
        retObj.Set("address", peer_address.host().ToString());

        Napi::Object objVal = eg_->getValue().Get("socket").As<Napi::Object>();
        Napi::Value fretVal = objVal.Get("sendPacket").As<Napi::Function>().Call(objVal, {retObj});

        if (!fretVal.As<Napi::Boolean>().Value())
        {
            // Not blocked
            return WriteResult(WRITE_STATUS_OK, 0);
        }
        else
        {
            // Blocked
            return WriteResult(WRITE_STATUS_BLOCKED, 0);
        }
    }

}