import { logger } from '../utils.js'

/**
 * @typedef {import('../types').StreamIdClient} StreamIdClient
 */

function GetMaxStreamCount() {
  return (0xffffffffn >> 2n) + 1n
}

const pid = typeof process !== 'undefined' ? process.pid : 0
const log = logger(`webtransport:streamidmanager(${pid})`)
// Ported from libquiche, QuicStreamIdManager so their license applies to the original in C++ and this javascript translation
// Copyright (c) 2018 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

export class StreamIdManager {
  /**
   * @param {{delegate: StreamIdClient
   * unidirectional: boolean,
   * isclient: boolean,
   * maxAllowedOutgoingStreams: number,
   * maxAllowedIncomingStreams: number}} arg
   */
  constructor({
    delegate,
    unidirectional,
    isclient,
    maxAllowedOutgoingStreams,
    maxAllowedIncomingStreams
  }) {
    this.delegate = delegate
    this.unidirectional = unidirectional
    this.isclient = isclient

    this.outgoingMaxStreams = BigInt(maxAllowedOutgoingStreams)

    // The ID to use for the next outgoing stream.
    this.nextOutgoingStreamId = this.getFirstOutgoingStreamId()

    // The number of outgoing streams that have ever been opened, including those
    // that have been closed. This number must never be larger than
    // outgoing_max_streams_.
    this.outgoingStreamCount = 0n

    // FOR INCOMING STREAMS

    // The actual maximum number of streams that can be opened by the peer.
    this.incomingActualMaxStreams = BigInt(maxAllowedIncomingStreams)
    // Max incoming stream number that has been advertised to the peer and is <=
    // incoming_actual_max_streams_. It is set to incoming_actual_max_streams_
    // when a MAX_STREAMS is sent.
    this.incomingAdvertisedMaxStreams = BigInt(maxAllowedIncomingStreams)

    // Initial maximum on the number of open streams allowed.
    this.incomingInitialMaxOpenStreams = BigInt(maxAllowedIncomingStreams)

    // The number of streams that have been created, including open ones and
    // closed ones.
    this.incomingStreamCount = 0n

    // Set of stream ids that are less than the largest stream id that has been
    // received, but are nonetheless available to be created.
    this.availableStreams = new Set()

    this.largestPeerCreatedStreamId = BigInt(Number.MAX_SAFE_INTEGER)

    // If true, then the stream limit will never be increased.
    this.stopIncreasingIncomingMaxStreams = false
  }

  /**
   * @param {bigint} streamCount
   */
  onStreamsBlockedFrame(streamCount) {
    if (streamCount > this.incomingAdvertisedMaxStreams) {
      // Peer thinks it can send more streams that we've told it.
      return {
        error:
          "StreamsBlockedFrame's stream count " +
          streamCount +
          ' exceeds incoming max stream ' +
          this.incomingAdvertisedMaxStreams
      }
    }
    if (this.incomingAdvertisedMaxStreams === this.incomingActualMaxStreams) {
      // We have told peer about current max.
      return { success: true }
    }
    if (
      streamCount < this.incomingActualMaxStreams &&
      this.delegate.canSendMaxStreams()
    ) {
      // Peer thinks it's blocked on a stream count that is less than our current
      // max. Inform the peer of the correct stream count.
      this.sendMaxStreamsFrame()
    }
    return { success: true }
  }

  /**
   * @param {bigint} maxOpenStreams
   */
  maybeAllowNewOutgoingStreams(maxOpenStreams) {
    if (maxOpenStreams <= this.outgoingMaxStreams) {
      // Only update the stream count if it would increase the limit.
      return false
    }

    // This implementation only supports 32 bit Stream IDs, so limit max streams
    // if it would exceed the max 32 bits can express.
    const maxStreamCount = GetMaxStreamCount()
    if (maxOpenStreams < maxStreamCount)
      this.outgoingMaxStreams = maxOpenStreams
    else this.outgoingMaxStreams = maxStreamCount

    return true
  }

  /**
   * @param {bigint} maxOpenStreams
   */
  setMaxOpenIncomingStreams(maxOpenStreams) {
    if (this.incomingStreamCount > 0)
      throw new Error(
        'non-zero incoming stream count ' +
          this.incomingStreamCount +
          +' when setting max incoming stream to ' +
          maxOpenStreams
      )
    if (this.incomingInitialMaxOpenStreams !== maxOpenStreams)
      log(
        this.unidirectional ? 'unidirectional ' : 'bidirectional: ',
        'incoming stream limit changed from ',
        this.incomingInitialMaxOpenStreams,
        ' to ',
        maxOpenStreams
      )
    this.incomingActualMaxStreams = maxOpenStreams
    this.incomingAdvertisedMaxStreams = maxOpenStreams
    this.incomingInitialMaxOpenStreams = maxOpenStreams
  }

  maybeSendMaxStreamsFrame() {
    const divisor = 2n // may be modify

    if (divisor > 0n) {
      if (
        this.incomingAdvertisedMaxStreams - this.incomingStreamCount >
        this.incomingInitialMaxOpenStreams / divisor
      ) {
        // window too large, no advertisement
        return
      }
    }
    if (
      this.delegate.canSendMaxStreams() &&
      this.incomingAdvertisedMaxStreams < this.incomingActualMaxStreams
    ) {
      this.sendMaxStreamsFrame()
    }
  }

  sendMaxStreamsFrame() {
    if (this.incomingAdvertisedMaxStreams >= this.incomingActualMaxStreams)
      throw new Error(
        'this.incomingAdvertisedMaxStreams >= this.incomingActualMaxStreams' +
          this.incomingAdvertisedMaxStreams +
          'vs.' +
          this.incomingActualMaxStreams
      )
    this.incomingAdvertisedMaxStreams = this.incomingActualMaxStreams
    this.delegate.sendMaxStreams(
      this.incomingAdvertisedMaxStreams,
      this.unidirectional
    )
  }

  sendMaxStreamsFrameInitial() {
    this.delegate.sendMaxStreams(
      this.incomingAdvertisedMaxStreams,
      this.unidirectional
    )
  }

  /**
   * @param {bigint} streamId
   */
  onStreamClosed(streamId) {
    // Nothing to do for outgoing streams.
    if (
      (this.isclient && !(streamId & 0x1n)) ||
      (!this.isclient && streamId & 0x1n)
    )
      return

    // If the stream is inbound, we can increase the actual stream limit and maybe
    // advertise the new limit to the peer.
    if (this.incomingActualMaxStreams === GetMaxStreamCount()) {
      // Reached the maximum stream id value that the implementation
      // supports. Nothing can be done here.
      return
    }
    if (!this.stopIncreasingIncomingMaxStreams) {
      // One stream closed, and another one can be opened.
      this.incomingActualMaxStreams++
      this.maybeSendMaxStreamsFrame()
    }
  }

  getNextOutgoingStreamId() {
    if (this.outgoingStreamCount >= this.outgoingMaxStreams)
      throw new Error(
        'Attempt to allocate a new outgoing stream that would exceed the ' +
          'limit (' +
          +Number(this.outgoingMaxStreams) +
          ')'
      )
    const id = this.nextOutgoingStreamId
    this.nextOutgoingStreamId += 1n << 2n
    this.outgoingStreamCount++
    return id
  }

  canOpenNextOutgoingStream() {
    return this.outgoingStreamCount < this.outgoingMaxStreams
  }

  isMaxStreamSet() {
    return this.outgoingMaxStreams > 0n
  }

  /**
   * @param {bigint} streamId
   */
  maybeIncreaseLargestPeerStreamId(streamId) {
    // |stream_id| must be an incoming stream of the right directionality.

    if (this.availableStreams.has(streamId)) {
      this.availableStreams.delete(streamId)
      // stream_id is available.
      return true
    }

    // Calculate increment of incoming_stream_count_ by creating stream_id.
    const delta = 1n << 2n
    const leastNewStreamId =
      this.largestPeerCreatedStreamId === BigInt(Number.MAX_SAFE_INTEGER)
        ? this.getFirstIncomingStreamId()
        : this.largestPeerCreatedStreamId + delta
    const streamCountIncrement = (streamId - leastNewStreamId) / delta + 1n

    if (
      this.incomingStreamCount + streamCountIncrement >
      this.incomingAdvertisedMaxStreams
    ) {
      log(
        'Failed to create a new incoming stream with id:' +
          streamId +
          ', reaching MAX_STREAMS limit: ' +
          this.incomingAdvertisedMaxStreams +
          '.'
      )
      return {
        error:
          'Stream id ' +
          streamId +
          ' would exceed stream count limit ' +
          this.incomingAdvertisedMaxStreams
      }
    }

    for (let id = leastNewStreamId; id < streamId; id += delta) {
      this.availableStreams.add(id)
    }
    this.incomingStreamCount += streamCountIncrement
    this.largestPeerCreatedStreamId = streamId
    return true
  }

  /**
   * @param {number} id
   */
  isAvailableStream(id) {
    if ((this.isclient && !(id & 0x1)) || (!this.isclient && id & 0x1)) {
      // Stream IDs under next_ougoing_stream_id_ are either open or previously
      // open but now closed.
      return id >= this.nextOutgoingStreamId
    }
    // For peer created streams, we also need to consider available streams.
    return (
      this.largestPeerCreatedStreamId === BigInt(Number.MAX_SAFE_INTEGER) ||
      id > this.largestPeerCreatedStreamId ||
      this.availableStreams.has(id)
    )
  }

  getFirstOutgoingStreamId() {
    let streamid = 0n
    if (!this.isclient) streamid |= 0x1n
    if (this.unidirectional) streamid |= 0x2n
    return streamid
  }

  getFirstIncomingStreamId() {
    let streamid = 0n
    if (this.isclient) streamid |= 0x1n
    if (this.unidirectional) streamid |= 0x2n
    return streamid
  }

  get availableIncomingStreams() {
    return this.incomingAdvertisedMaxStreams - this.incomingStreamCount
  }
}
