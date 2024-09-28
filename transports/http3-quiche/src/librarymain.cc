// Copyright (c) 2022 Marten Richter or other contributers (see commit). All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

// portions taken from libquiche, original copyright, see LICENSE.chromium
// Copyright (c)  The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "src/librarymain.h"
#include "src/http3server.h"
#include "src/http3client.h"
#include "src/http3dispatcher.h"
#include "src/http3wtsessionvisitor.h"
#include "src/napialarmfactory.h"
#include "quiche/common/platform/api/quiche_command_line_flags.h"
#include "quiche/common/platform/api/quiche_flags.h"

#include "absl/log/initialize.h"
#include "absl/strings/string_view.h"

using namespace Napi;

namespace quic
{
  bool hasSetLogging = false;

  void quicheInit(const Napi::CallbackInfo &info)
  {
    std::vector<std::string> quiche_cmd_line;
    quiche_cmd_line.push_back(std::string("webtransport.node"));
    if (!info[0].IsUndefined() /*|| info[1].IsFunction()*/)
    {
      Napi::Object lobj = info[0].ToObject();
      if (lobj.IsEmpty())
      {
        Napi::Error::New(info.Env(), "No callback obj for Http3Transport").ThrowAsJavaScriptException();
        return;
      }

      quiche_cmd_line.push_back(std::string("-v"));
      if (lobj.Has("quicheLogVerbose") && lobj.Get("quicheLogVerbose").IsNumber())
      {
        Napi::Value verboseValue = (lobj).Get("quicheLogVerbose");
        quiche_cmd_line.push_back(verboseValue.ToString().Utf8Value());
      }
      else
      {
        quiche_cmd_line.push_back(std::string("-1"));
      }
    }
    else
    {
      Napi::Error::New(info.Env(), "Callback not passed to Webtransport library internals").ThrowAsJavaScriptException();
      return;
    }
    std::vector<const char *> quiche_cmd_line_char;
    for (auto cur = quiche_cmd_line.begin(); cur != quiche_cmd_line.end(); cur++)
    {
      quiche_cmd_line_char.push_back((*cur).c_str());
    }
    SetQuicheReloadableFlag(quic_deliver_stop_sending_to_zombie_streams, true); // enable patch
    if (!hasSetLogging)
    {
      quiche::QuicheParseCommandLineFlags("No use instruction.", quiche_cmd_line.size(), &(*quiche_cmd_line_char.begin()));
      hasSetLogging = true;
    }
  }

  Napi::Object Init(Napi::Env env, Napi::Object exports)
  {
    #ifdef _MSC_VER
    // work around clangcl bug
    napi_value dummy;
    napi_create_double(env,2.0, &dummy);
    #endif
    Http3Constructors *constr = new Http3Constructors();

    Http3ServerJS::InitExports(env, exports);
    Http3ClientJS::InitExports(env, exports);
    Http3WTSessionJS::InitExports(env, exports, constr);
    Http3WTStreamJS::InitExports(env, exports, constr);
    NapiAlarmJS::InitExports(env, exports, constr);
    Napi::Function qinitna = Function::New<quicheInit>(env);
    constr->quicheInit = Napi::Persistent(qinitna);
    exports.Set("quicheInit", qinitna);

    env.SetInstanceData<Http3Constructors>(constr);
    return exports;
  }

  NODE_API_MODULE(webtransport, Init)
}
