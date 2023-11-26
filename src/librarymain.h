// modifications
// Copyright (c) 2022 Marten Richter or other contributers (see commit). All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

// original copyright used only portions, see LICENSE.chromium
// Copyright (c) 2021 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef LIBARAY_MAIN_H_
#define LIBARAY_MAIN_H_

#include <napi.h>

namespace quic
{
  enum NetworkTask
  {
    resetStream,
    stopSending,
    streamFinal
  };

  enum NetworkStatus
  {
    NetError,
    NetClose,
    NetListening
  };

  struct Http3Constructors
  {
    Napi::FunctionReference stream;
    Napi::FunctionReference session;
    Napi::FunctionReference napialarm;
    Napi::FunctionReference quicheInit;
  };


}
#endif