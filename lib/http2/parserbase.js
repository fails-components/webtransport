import { Http2WebTransportStream } from './stream.js'

/**
 * @typedef {import('node:http2').Http2Stream} Http2Stream
 */

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
   * @param {import('../types').Http2CapsuleParserInit} stream
   */
  constructor({ stream, nativesession, isclient }) {
    this.stream = stream
    this.session = nativesession
    this.isclient = isclient
    /** @type {boolean} */
    this.blocked = false

    this.stream.on('readable', () => {
      let data
      while ((data = this.stream.read()) !== null) {
        this.parseData(data)
      }
    })

    this.stream.on('end', () => {
      // readable end
    })

    this.stream.on(
      'error',
      /**
       * @param {Error} error
       */ (error) => {
        // readable error
        this.session.jsobj.onClose({
          errorcode: this.stream.rstCode,
          error: error.toString()
        })
      }
    )

    this.stream.on('drain', () => {
      // writable, can write more data
      this.blocked = false
      this.drainWrites()
    })

    this.stream.on('close', () => {
      // writable close
      this.session.jsobj.onClose({
        errorcode: this.stream.rstCode || 0,
        error: ''
      })
    })

    this.wtstreams = new Map()
  }

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
