import { Http2WebTransportStream } from './stream.js'
import { logger } from '../utils.js'
import { PriorityScheduler } from './priorityscheduler.js'

const pid = typeof process !== 'undefined' ? process.pid : 0
const log = logger(`webtransport:parserbase(${pid})`)

/**
 * @param{Number|bigint} int
 * @returns {Number}
 */
export function lengthVarInt(int) {
  if (BigInt(int) < 64n) return 1
  if (BigInt(int) < 16384n) return 2
  if (BigInt(int) < 1073741824n) return 4
  /* if (BigInt(int) < 4611686018427387904 ) */
  return 8
}

export class ParserBase {
  static PADDING = 0x190b4d38
  static WT_RESET_STREAM = 0x190b4d39
  static WT_STOP_SENDING = 0x190b4d3a
  static WT_STREAM_WOFIN = 0x190b4d3b
  static WT_STREAM_WFIN = 0x190b4d3c
  static WT_MAX_DATA = 0x190b4d3d
  static WT_MAX_STREAM_DATA = 0x190b4d3e
  static WT_MAX_STREAMS_BIDI = 0x190b4d3f
  static WT_MAX_STREAMS_UNIDI = 0x190b4d40
  static WT_DATA_BLOCKED = 0x190b4d41
  static WT_STREAM_DATA_BLOCKED = 0x190b4d42
  static WT_STREAMS_BLOCKED_UNIDI = 0x190b4d43
  static WT_STREAMS_BLOCKED_BIDI = 0x190b4d44
  static CLOSE_WEBTRANSPORT_SESSION = 0x2843
  static DRAIN_WEBTRANSPORT_SESSION = 0x78ae
  static DATAGRAM = 0x00

  /**
   * @param {import('../types').ParserInit} arg
   */
  constructor({
    nativesession,
    isclient,
    initialStreamSendWindowOffsetBidi,
    initialStreamSendWindowOffsetUnidi,
    initialStreamReceiveWindowOffset,
    streamShouldAutoTuneReceiveWindow,
    streamReceiveWindowSizeLimit
  }) {
    this.session = nativesession
    this.isclient = isclient
    /** @type {boolean} */
    this.blocked = false

    this.initialStreamSendWindowOffsetUnidi = initialStreamSendWindowOffsetUnidi
    this.initialStreamSendWindowOffsetBidi = initialStreamSendWindowOffsetBidi
    this.initialStreamReceiveWindowOffset = initialStreamReceiveWindowOffset
    this.streamShouldAutoTuneReceiveWindow = streamShouldAutoTuneReceiveWindow
    this.streamReceiveWindowSizeLimit = streamReceiveWindowSizeLimit

    /** @type {Map<bigint,Http2WebTransportStream>} */
    this.wtstreams = new Map()

    this.scheduler = new PriorityScheduler()
  }

  /**
   * @abstract
   * @param {Buffer|Uint8Array} data
   */
  // eslint-disable-next-line no-unused-vars
  parseData(data) {
    throw new Error('Implement parseData in derived Class')
  }

  /**
   * @abstract
   * @param{{type: Number, headerVints: Array<Number|bigint>, payload: Uint8Array|undefined, end?: () => void}} bs
   */
  // eslint-disable-next-line no-unused-vars
  writeCapsule({ type, headerVints, payload, end }) {
    throw new Error('Implement writeCapsule in derived Class')
  }

  /**
   * @param{{code: Number, reason: string}}arg
   */
  sendClose({ code, reason }) {
    const encoder = new TextEncoder()
    const payload = encoder.encode('AAAA' + reason)
    payload[0] = (code >> 24) & 0xff
    payload[1] = (code >> 16) & 0xff
    payload[2] = (code >> 8) & 0xff
    payload[3] = code & 0xff
    this.writeCapsule({
      type: ParserBase.CLOSE_WEBTRANSPORT_SESSION,
      headerVints: [],
      payload,
      end: () => {
        this.closeHttp2Stream(code)
      }
    })
  }

  /**
   * @param {bigint} streamid
   * @param {{sendOrder: bigint,sendGroupId: bigint}} priority
   */
  newStream(streamid, priority) {
    const incoming = this.isclient ? !(streamid & 0x1n) : !!(streamid & 0x1n)
    const streamIdManager =
      streamid & 0x2n
        ? this.session.streamIdMngrUni
        : this.session.streamIdMngrBi

    if (incoming) {
      // only check incoming streams
      const res = streamIdManager.maybeIncreaseLargestPeerStreamId(streamid)
      if (res.error) {
        // ok someone overstayed its welcome
        this.session.closeConnection({
          code: 20, // QUIC_STREAM_STREAM_CREATION_ERROR , // probably the right one...
          reason: res.error
        })

        return undefined
      }
    }
    const unidirectional = !!(streamid & 0x2n)
    const stream = new Http2WebTransportStream({
      streamid,
      unidirectional,
      incoming,
      capsuleParser: this,
      sendWindowOffset: unidirectional
        ? this.initialStreamSendWindowOffsetUnidi
        : this.initialStreamSendWindowOffsetBidi,
      receiveWindowOffset: this.initialStreamReceiveWindowOffset,
      shouldAutoTuneReceiveWindow: this.streamShouldAutoTuneReceiveWindow,
      receiveWindowSizeLimit: this.streamReceiveWindowSizeLimit,
      sessionFlowController: this.session.flowController,
      streamIdManager
    })
    this.wtstreams.set(streamid, stream)
    this.scheduler.Register(streamid, priority)
    this.session.jsobj.onStream({
      bidirectional: !(streamid & 0x2n),
      incoming,
      stream
    })
    return stream
  }

  drainWrites() {
    while (!this.blocked) {
      const frontId = this.scheduler.PopFront()
      if (typeof frontId === 'undefined') break
      const stream = this.wtstreams.get(frontId)
      if (!stream) break
      stream.drainWrites()
    }
  }

  /**
   * @param {bigint|undefined} val
   */
  onMaxData(val) {
    if (val && this.session.flowController.updateSendWindowOffset(val))
      this.drainWrites()
  }

  /**
   * @param {bigint} streamid
   * @param {bigint} offset
   */
  onMaxStreamData(streamid, offset) {
    const object = this.wtstreams.get(streamid)
    if (object && offset) {
      if (object.flowController.updateSendWindowOffset(offset))
        object.drainWrites()
    }
  }

  /**
   * @param {bigint|undefined} maxOpenStreams
   */
  onMaxStreamUniDi(maxOpenStreams) {
    if (typeof maxOpenStreams === 'undefined') return
    this.session.streamIdMngrUni.maybeAllowNewOutgoingStreams(maxOpenStreams)
    this.session.trySendingUnidirectionalStreams()
  }

  /**
   * @param {bigint|undefined} maxOpenStreams
   */
  onMaxStreamBiDi(maxOpenStreams) {
    if (typeof maxOpenStreams === 'undefined') return
    this.session.streamIdMngrBi.maybeAllowNewOutgoingStreams(maxOpenStreams)
    this.session.trySendingBidirectionalStreams()
  }

  /**
   * @param {bigint|undefined} val
   */
  onDataBlocked(val) {
    log('Session received blocked frame ' + val)
    // this.session.flowController.reportBlocked(val)
  }

  /**
   * @param {bigint} streamid
   * @param {bigint} offset
   */
  onStreamDataBlocked(streamid, offset) {
    log('Stream ' + streamid + ' received blocked frame ' + offset)
    // const object = this.wtstreams.get(streamid)
    // if (object && offset) object.flowController.reportBlocked(offset)
  }

  /**
   * @param {bigint|undefined} maxstreams
   */
  onStreamsBlockedBidi(maxstreams) {
    if (typeof maxstreams === 'undefined') return
    const ret = this.session.streamIdMngrBi.onStreamsBlockedFrame(maxstreams)
    if (ret.error) {
      this.session.closeConnection({
        code: 105, // QUIC_STREAMS_BLOCKED_DATA , // probably the right one...
        reason: ret.error
      })
    }
  }

  /**
   * @param {bigint|undefined} maxstreams
   */
  onStreamsBlockedUnidi(maxstreams) {
    if (typeof maxstreams === 'undefined') return
    const ret = this.session.streamIdMngrUni.onStreamsBlockedFrame(maxstreams)
    if (ret.error) {
      this.session.closeConnection({
        code: 105, // QUIC_STREAMS_BLOCKED_DATA , // probably the right one...
        reason: ret.error
      })
    }
  }

  /**
   * @param {{code:  number, reason: string}} opts
   */
  onCloseWebTransportSession({ code, reason }) {
    this.session.jsobj.onClose({
      errorcode: code,
      error: reason
    })
    this.closeHttp2Stream(code) // is this necessary
  }

  onDrain() {
    this.session.jsobj.onGoAwayReceived()
  }

  /**
   *
   * @param {bigint} streamid
   */
  shouldYieldStream(streamid) {
    return this.scheduler.ShouldYield(streamid)
  }

  /**
   *
   * @param {bigint} streamid
   */
  scheduleDrainWriteStream(streamid) {
    this.scheduler.Schedule(streamid)
  }

  /**
   *
   * @param {bigint} streamid
   */
  removeStream(streamid) {
    this.scheduler.Unregister(streamid)
    //this.wtstreams.delete(streamid) // why does this create troubles
  }

  /**
   * @param {number} code
   */
  // eslint-disable-next-line no-unused-vars
  closeHttp2Stream(code) {
    throw new Error('Implement closeHttp2Stream in derived Class')
  }
}
