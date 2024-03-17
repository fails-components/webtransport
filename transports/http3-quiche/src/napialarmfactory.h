// modifications
// Copyright (c) 2022 Marten Richter or other contributers (see commit). All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

// original copyright used only portions, see LICENSE.chromium
// Copyright (c) 2021 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef NAPI_ALARM_FACTORY_H_
#define NAPI_ALARM_FACTORY_H_

#include "src/librarymain.h"
#include "quiche/quic/core/quic_clock.h"
#include "quiche/quic/core/quic_alarm.h"
#include "quiche/quic/core/quic_alarm_factory.h"
#include <napi.h>

namespace quic
{

  class NapiAlarm;

  class EnvGetter
  {
  public:
    virtual Napi::Env getEnv() = 0;
    virtual Napi::Object getValue() = 0;
  };

  class NapiAlarmFactory : public QuicAlarmFactory
  {
  public:
    NapiAlarmFactory(QuicClock *clock, EnvGetter *envg) : clock_(clock), envg_(envg)
    {
    }

    // QuicAlarmFactory interface.
    QuicAlarm *CreateAlarm(QuicAlarm::Delegate *delegate) override;
    QuicArenaScopedPtr<QuicAlarm> CreateAlarm(
        QuicArenaScopedPtr<QuicAlarm::Delegate> delegate,
        QuicConnectionArena *arena) override;

  private:
    QuicClock *clock_;
    EnvGetter *envg_;
  };

  class NapiAlarmJS : public Napi::ObjectWrap<NapiAlarmJS>
  {
  friend class NapiAlarm;
  public:
    NapiAlarmJS(const Napi::CallbackInfo &info) : Napi::ObjectWrap<NapiAlarmJS>(info), alarm_()
    {
      if (FAILSsetTimeoutAlarm_.IsEmpty()) {
        FAILSsetTimeoutAlarm_ = Napi::Persistent(Env().Global().Get("FAILSsetTimeoutAlarm").As<Napi::Function>());
        FAILSsetTimeoutAlarm_.SuppressDestruct();
      }
      if (clearTimeout_.IsEmpty()) {
        clearTimeout_ = Napi::Persistent(Env().Global().Get("clearTimeout").As<Napi::Function>());
        clearTimeout_.SuppressDestruct();
      }
    }

    void setAlarm(NapiAlarm *alarm)
    {
      alarm_ = alarm;
    }

    void fireJS(const Napi::CallbackInfo &info);
    static void InitExports(Napi::Env env, Napi::Object exports, Http3Constructors *constr)
    {
      Napi::Function tplna =
          DefineClass(env, "NapiAlarmJS",
                      {InstanceMethod<&NapiAlarmJS::fireJS>("fireJS")});
      constr->napialarm = Napi::Persistent(tplna);
      exports.Set("NapiAlarmJS", tplna);
    }

    NapiAlarm *alarm()
    {
      return alarm_;
    }

  protected:
    NapiAlarm* alarm_; // unowned
    static Napi::FunctionReference FAILSsetTimeoutAlarm_;
    static Napi::FunctionReference clearTimeout_;
  };

  class NapiAlarm : public QuicAlarm
  {
  public:
    NapiAlarm(NapiAlarmJS *alarmjs, QuicClock *clock, QuicArenaScopedPtr<QuicAlarm::Delegate> delegate)
        : alarmjs_(alarmjs), clock_(clock), QuicAlarm(std::move(delegate)), timerset_(false)
    {
      alarmjs->setAlarm(this);
      alarmjs->Ref();
    }

    ~NapiAlarm()
    {
      if (timerset_)
      {
        NapiAlarmJS::clearTimeout_.Call({alarmref_.Value()});
        alarmref_.Unref();
        timerset_ = false;
      }
      if (alarmjs_)
      {
        alarmjs_->setAlarm(nullptr);
        alarmjs_->Unref();
        alarmjs_ = nullptr;
      }

    }

    void FireJS()
    {
      Fire();
    }

  protected:
    void SetImpl() override
    {
      if (!alarmjs_)
        return;
      absl::Duration timeout =
          absl::Microseconds((deadline() - clock_->Now()).ToMicroseconds());
      double timedelay = absl::ToDoubleMilliseconds(timeout);
      if (timerset_)
      {
        alarmref_.Unref();
        timerset_ = false;
      }
      auto val =  Napi::Value::From(alarmjs_->Env(), timedelay);
      // Workaround for problem on windows plattform
      if (val.ToNumber().DoubleValue() != timedelay) { 
        // printf("val %lg %lg\n", val.ToNumber().DoubleValue(), timedelay);
        val =  Napi::Value::From(alarmjs_->Env(), timedelay);
        // printf("val2 %lg %lg\n", val.ToNumber().DoubleValue(), timedelay);
      }

      Napi::Value timeoutobj = NapiAlarmJS::FAILSsetTimeoutAlarm_.Call({
          alarmjs_->Value().As<Napi::Object>(),
          val,
      });
      alarmref_ = Napi::Reference<Napi::Object>::New(timeoutobj.As<Napi::Object>(), 1);
      timerset_ = true;
    }

    void CancelImpl() override
    {
      if (timerset_)
      {
        NapiAlarmJS::clearTimeout_.Call({alarmref_.Value()});
        alarmref_.Unref();
        timerset_ = false;
      }
    }

  private:
    NapiAlarmJS *alarmjs_;
    Napi::ObjectReference alarmref_;
    QuicClock *clock_;
    bool timerset_;
  };

}

#endif