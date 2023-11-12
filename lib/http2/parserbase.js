import { Http2WebTransportStream } from './stream.js'

/**
 * @param{Number} int
 * @returns {Number}
 */
export function lengthVarInt(int) {
  if (int < 64) return 1
  if (int < 16384) return 2
  if (int < 1073741824) return 4
  /* if (int < 4611686018427387904 ) */
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
  static DATAGRAM = 0x00

  /**
   * @param {import('../types').ParserInit} arg
   */
  constructor({ nativesession, isclient }) {
    this.session = nativesession
    this.isclient = isclient
    /** @type {boolean} */
    this.blocked = false

    this.wtstreams = new Map()
  }

  /**
   * @abstract
   * @param {Buffer|Uint8Array} data
   */
  parseData(data) {
    throw new Error('Implement parseData in derived Class')
  }

  /**
   * @abstract
   * @param{{type: Number, headerVints: Array<Number>, payload: Uint8Array|undefined}} bs
   */
  writeCapsule({ type, headerVints, payload }) {
    throw new Error('Implement writeCapsule in derived Class')
  }

  /**
   * @param{{code: Number, reason: string}}arg
   */
  sendClose({ code, reason }) {}

  /**
   * @param {Number} streamid
   */
  newStream(streamid) {
    const stream = new Http2WebTransportStream({
      streamid,
      capsuleParser: this
    })
    this.wtstreams.set(streamid, stream)
    this.session.jsobj.onStream({
      bidirectional: !(streamid & 0x2),
      incoming: this.isclient ? !(streamid & 0x1) : !!(streamid & 0x1),
      stream
    })
    return stream
  }

  drainWrites() {
    for (const stream of this.wtstreams.values()) {
      stream.drainWrites()
    }
  }
}
