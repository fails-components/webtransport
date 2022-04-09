// Copyright (c) 2011 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.
#ifndef EPOLL_BASE_NET_EXPORT_H_
#define EPOLL_BASE_NET_EXPORT_H_
// Defines EPOLL_EXPORT so that functionality implemented by the net module can
// be exported to consumers, and EPOLL_EXPORT_PRIVATE that allows unit tests to
// access features not intended to be used directly by real consumers.
#if defined(COMPONENT_BUILD)
#if defined(WIN32)

#define EPOLL_EXPORT __declspec(dllimport)
#define EPOLL_EXPORT_PRIVATE __declspec(dllimport)

#else  // defined(WIN32)

#define EPOLL_EXPORT
#define EPOLL_EXPORT_PRIVATE

#endif
#else  /// defined(COMPONENT_BUILD)
#define EPOLL_EXPORT
#define EPOLL_EXPORT_PRIVATE
#endif
#endif  // NET_BASE_NET_EXPORT_H_
