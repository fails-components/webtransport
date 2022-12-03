/* eslint-disable no-prototype-builtins */
// Copyright (c) 2022 Marten Richter or other contributers (see commit). All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import { Http3EventLoop } from './event-loop.js'

/**
 * // Spec
 * @typedef {import('./dom').WebTransportDatagramStats} WebTransportDatagramStats
 * @typedef {import('./dom').WebTransportStats} WebTransportStats
 * @typedef {import('./dom').WebTransportCloseInfo} WebTransportCloseInfo
 * @typedef {import('./dom').WebTransportDatagramDuplexStream} WebTransportDatagramDuplexStream
 * @typedef {import('./dom').WebTransportBidirectionalStream} WebTransportBidirectionalStream
 * @typedef {import('./dom').WebTransportSendStreamStats} WebTransportSendStreamStats
 * @typedef {import('./dom').WebTransportSendStream} WebTransportSendStream
 * @typedef {import('./dom').WebTransportReceiveStreamStats} WebTransportReceiveStreamStats
 * @typedef {import('./dom').WebTransportReceiveStream} WebTransportReceiveStream
 * @typedef {import('./dom').WebTransportHash} WebTransportHash
 * @typedef {import('./dom').WebTransportOptions} WebTransportOptions
 * @typedef {import('./dom').WebTransportReliabilityMode} WebTransportReliabilityMode
 *
 * Public API
 * @typedef {import('./types').WebTransportSession} WebTransportSession
 * @typedef {import('./types').Http3ServerInit} Http3ServerInit
 */

export function testcheck() {
  return !Http3EventLoop.globalLoop
}

export { Http3Server } from './server.js'
export { WebTransport } from './webtransport.js'
