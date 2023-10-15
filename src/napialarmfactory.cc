// modifications
// Copyright (c) 2022 Marten Richter or other contributers (see commit). All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

// original copyright used only portions, see LICENSE.chromium
// Copyright (c) 2021 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "src/napialarmfactory.h"
#include "quiche/quic/core/quic_alarm.h"

namespace quic
{

  void NapiAlarmJS::fireJS(const Napi::CallbackInfo &info)
  {
    alarm_->FireJS();
  }

  QuicAlarm *NapiAlarmFactory::CreateAlarm(
      QuicAlarm::Delegate *delegate)
  {
    Http3Constructors *constr = envg_->getEnv().GetInstanceData<Http3Constructors>();
    Napi::Object alarmobj = constr->napialarm.New({});
    NapiAlarmJS *napialarmjs = Napi::ObjectWrap<NapiAlarmJS>::Unwrap(alarmobj);

    NapiAlarm *alarm = new NapiAlarm(napialarmjs, clock_,
                                     QuicArenaScopedPtr<QuicAlarm::Delegate>(delegate));
    return alarm;
  }

  QuicArenaScopedPtr<QuicAlarm> NapiAlarmFactory::CreateAlarm(
      QuicArenaScopedPtr<QuicAlarm::Delegate> delegate,
      QuicConnectionArena *arena)
  {
    Http3Constructors *constr = envg_->getEnv().GetInstanceData<Http3Constructors>();
    Napi::Object alarmobj = constr->napialarm.New({});
    NapiAlarmJS *napialarmjs = Napi::ObjectWrap<NapiAlarmJS>::Unwrap(alarmobj);
    if (arena != nullptr)
    {
      return arena->New<NapiAlarm>(napialarmjs, clock_, std::move(delegate));
    }
    return QuicArenaScopedPtr<QuicAlarm>(
        new NapiAlarm(napialarmjs, clock_, std::move(delegate)));
  }

}