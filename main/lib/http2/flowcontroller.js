import { logger } from '../utils.js'

/**
 * @typedef {import('../types').FlowControlable} FlowControlable
 */

const pid = typeof process !== 'undefined' ? process.pid : 0
const log = logger(`webtransport:flowcontroller(${pid})`)
// Ported from libquiche, QuicFlowController so their license applies to the original in C++ and this javascript translation
// Copyright 2014 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

export class FlowController {
  static kSessionFlowControlMultiplier = 1.5

  /**
   * @param {{tocontrol: FlowControlable
   * sendWindowOffset: number,
   * receiveWindowOffset: number,
   * shouldAutoTuneReceiveWindow: boolean
   * receiveWindowSizeLimit: number,
   * sessionFlowController?: FlowController}} arg
   */

  constructor({
    tocontrol,
    sendWindowOffset,
    receiveWindowOffset,
    receiveWindowSizeLimit,
    shouldAutoTuneReceiveWindow,
    sessionFlowController
  }) {
    this.tocontrol = tocontrol
    this.bytesSent = 0n
    this.sendWindowOffset = BigInt(sendWindowOffset)
    this.bytesConsumed = 0n
    this.highestReceivedByteOffset = 0n
    this.receiveWindowOffset = BigInt(receiveWindowOffset)
    this.receiveWindowSize = BigInt(receiveWindowOffset)
    this.receiveWindowSizeLimit = BigInt(receiveWindowSizeLimit)
    this.autoTuneReceiveWindow = shouldAutoTuneReceiveWindow
    this.sessionFlowController = sessionFlowController
    this.lastBlockedSendWindowOffset = 0n
    this.prevWindowUpdateTime = undefined

    log(
      'Created flow controller ' +
        ', setting initial receive window offset to: ' +
        this.receiveWindowOffset +
        ', max receive window to: ' +
        this.receiveWindowSize +
        ', max receive window limit to: ' +
        this.receiveWindowSizeLimit +
        ', setting send window offset to: ' +
        this.sendWindowOffset
    )
  }

  /**
   * @param {Number} bytesConsumed
   */
  addBytesConsumed(bytesConsumed) {
    this.bytesConsumed += BigInt(bytesConsumed)
    log(' consumed ' + bytesConsumed + ' bytes.')

    this.maybeSendWindowUpdate()
  }

  /**
   * @param {Number} increaseOffset
   */
  updateHighestReceivedOffset(increaseOffset) {
    // Only update if offset has increased.
    /* if (newOffset <= this.highestReceivedByteOffset) {
      return false
    } */

    log(
      ' highest byte offset increased from ' + this.highestReceivedByteOffset,
      ' to ',
      this.highestReceivedByteOffset + BigInt(increaseOffset)
    )
    this.highestReceivedByteOffset += BigInt(increaseOffset)
    return true
  }

  /**
   * @param {Number} nbytesSent
   */
  addBytesSent(nbytesSent) {
    const bytesSent = BigInt(nbytesSent)
    if (this.bytesSent + bytesSent > this.sendWindowOffset) {
      log(
        ' Trying to send an extra ' +
          bytesSent +
          ' bytes, when bytes_sent = ' +
          this.bytesSent +
          ', and send_window_offset_ = ' +
          this.sendWindowOffset
      )
      this.bytesSent = this.sendWindowOffset

      // This is an error on our side, close the connection as soon as possible.
      this.tocontrol.closeConnection({
        code: 63, // QUIC_FLOW_CONTROL_SENT_TOO_MUCH_DATA,
        reason:
          this.sendWindowOffset -
          (this.bytesSent + bytesSent) +
          'bytes over send window offset'
      })
      return
    }
    this.bytesSent += bytesSent
    log(' sent ' + bytesSent + ' bytes.')
  }

  flowControlViolation() {
    if (this.highestReceivedByteOffset > this.receiveWindowOffset) {
      log(
        'Flow control violation on ' +
          ', receive window offset: ' +
          this.receiveWindowOffset +
          ', highest received byte offset: ' +
          this.highestReceivedByteOffset
      )
      return true
    }
    return false
  }

  maybeIncreaseMaxWindowSize() {
    // Core of receive window auto tuning.  This method should be called before a
    // WINDOW_UPDATE frame is sent.  Ideally, window updates should occur close to
    // once per RTT.  If a window update happens much faster than RTT, it implies
    // that the flow control window is imposing a bottleneck.  To prevent this,
    // this method will increase the receive window size (subject to a reasonable
    // upper bound).  For simplicity this algorithm is deliberately asymmetric, in
    // that it may increase window size but never decreases.

    // Keep track of timing between successive window updates.
    const now = Date.now()
    const prev = this.prevWindowUpdateTime
    this.prevWindowUpdateTime = now
    if (!prev) {
      log('first window update for ')
      return
    }

    if (!this.autoTuneReceiveWindow) {
      return
    }

    // TODO port need a replacement for this
    // Get outbound RTT.
    const rtt = this.tocontrol.smoothedRtt()
    if (rtt === 0) {
      log('rtt zero for ')
      return
    }

    // Now we can compare timing of window updates with RTT.
    const sinceLast = now - prev
    const twoRtt = 2 * rtt

    if (sinceLast >= twoRtt) {
      // If interval between window updates is sufficiently large, there
      // is no need to increase receive_window_size_.
      return
    }
    const oldWindow = this.receiveWindowSize
    this.increaseWindowSize()

    if (this.receiveWindowSize > oldWindow) {
      log(
        'New max window increase for ' +
          +' after ' +
          sinceLast +
          ' us, and RTT is ' +
          rtt +
          'us. max wndw: ' +
          this.receiveWindowSize
      )
      if (this.sessionFlowController !== undefined) {
        this.sessionFlowController.ensureWindowAtLeast(
          BigInt(
            FlowController.kSessionFlowControlMultiplier *
              Number(this.receiveWindowSize)
          )
        )
      }
    } else {
      // TODO(ckrasic) - add a varz to track this (?).
      log(
        'Max window at limit for ' +
          ' after ' +
          sinceLast +
          ' us, and RTT is ' +
          rtt +
          'us. Limit size: ' +
          this.receiveWindowSize
      )
    }
  }

  increaseWindowSize() {
    this.receiveWindowSize *= 2n
    this.receiveWindowSize =
      this.receiveWindowSize > this.receiveWindowSizeLimit
        ? this.receiveWindowSizeLimit
        : this.receiveWindowSize
  }

  windowUpdateThreshold() {
    return this.receiveWindowSize / 2n
  }

  maybeSendWindowUpdate() {
    if (!this.tocontrol.connected()) {
      return
    }
    // Send WindowUpdate to increase receive window if
    // (receive window offset - consumed bytes) < (max window / 2).
    // This is behaviour copied from SPDY.

    const availableWindow = this.receiveWindowOffset - this.bytesConsumed
    const threshold = this.windowUpdateThreshold()

    if (!this.prevWindowUpdateTime) {
      // Treat the initial window as if it is a window update, so if 1/2 the
      // window is used in less than 2 RTTs, the window is increased.
      this.prevWindowUpdateTime = Date.now()
    }

    if (availableWindow >= threshold) {
      log(
        'Not sending WindowUpdate for ' +
          ', available window: ' +
          availableWindow +
          ' >= threshold: ' +
          threshold
      )
      return
    }

    this.maybeIncreaseMaxWindowSize()
    this.updateReceiveWindowOffsetAndSendWindowUpdate(availableWindow)
  }

  /**
   * @param {bigint} availableWindow
   */
  updateReceiveWindowOffsetAndSendWindowUpdate(availableWindow) {
    // Update our receive window.
    this.receiveWindowOffset += this.receiveWindowSize - availableWindow

    log(
      'Sending WindowUpdate frame for ' +
        ', consumed bytes: ' +
        this.bytesConsumed +
        ', available window: ' +
        availableWindow +
        ', and threshold: ' +
        this.windowUpdateThreshold() +
        ', and receive window size: ' +
        this.receiveWindowSize +
        '. New receive window offset is: ' +
        this.receiveWindowOffset
    )

    this.sendWindowUpdate()
  }

  maybeSendBlocked() {
    if (
      this.sendWindowSize() !== 0 ||
      this.lastBlockedSendWindowOffset >= this.sendWindowOffset
    ) {
      return
    }
    log(
      ' is flow control blocked. ' +
        'Send window: ' +
        this.sendWindowSize() +
        ', bytes sent: ' +
        this.bytesSent +
        ', send limit: ' +
        this.sendWindowOffset
    )
    // The entire send_window has been consumed, we are now flow control
    // blocked.

    // Keep track of when we last sent a BLOCKED frame so that we only send one
    // at a given send offset.
    this.lastBlockedSendWindowOffset = this.sendWindowOffset
    this.tocontrol.sendBlocked(this.lastBlockedSendWindowOffset)
  }

  /**
   * @param {bigint} newSendWindowOffset
   */
  updateSendWindowOffset(newSendWindowOffset) {
    // Only update if send window has increased.
    if (newSendWindowOffset <= this.sendWindowOffset) {
      return false
    }

    log(
      'UpdateSendWindowOffset for ' +
        ' with new offset ' +
        newSendWindowOffset +
        ' current offset: ' +
        this.sendWindowOffset +
        ' bytes_sent: ' +
        this.bytesSent
    )

    // The flow is now unblocked but could have also been unblocked
    // before.  Return true iff this update caused a change from blocked
    // to unblocked.
    const wasPreviouslyBlocked = this.isBlocked()
    this.sendWindowOffset = newSendWindowOffset
    return wasPreviouslyBlocked
  }

  /**
   * @param {bigint} windowSize
   */
  ensureWindowAtLeast(windowSize) {
    if (this.receiveWindowSizeLimit >= windowSize) {
      return
    }

    const availableWindow = this.receiveWindowOffset - this.bytesConsumed
    this.increaseWindowSize()
    this.updateReceiveWindowOffsetAndSendWindowUpdate(availableWindow)
  }

  isBlocked() {
    return this.sendWindowSize() === 0n
  }

  sendWindowSize() {
    if (this.bytesSent > this.sendWindowOffset) {
      return 0
    }
    return this.sendWindowOffset - this.bytesSent
  }

  /**
   * @param {bigint} size
   */
  updateReceiveWindowSize(size) {
    log('UpdateReceiveWindowSize for ' + ': ' + size)
    if (this.receiveWindowSize !== this.receiveWindowOffset) {
      log(
        'receive_window_size_:' +
          this.receiveWindowSize +
          ' != receive_window_offset:' +
          this.receiveWindowOffset
      )
      return
    }
    this.receiveWindowSize = size
    this.receiveWindowOffset = size
  }

  sendWindowUpdate() {
    this.tocontrol.sendWindowUpdate(this.receiveWindowOffset)
  }
}
