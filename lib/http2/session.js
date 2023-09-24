/**
 * @typedef {import('http2').Http2Stream} Http2Stream
 */

import { Http2CapsuleParser } from './capsuleparser.js'
import { HttpWTSession } from '../session.js'
import { HttpWTStream } from '../stream.js'

export class Http2WebTransportSession {
  /**
   * @param {Object} obj
   * @param {Http2Stream} obj.stream
   * @param {boolean} obj.isclient
   */
  constructor({ stream, isclient }) {
    // @ts-ignore
    this.jsobj = undefined // the creator will set this
    this.stream = stream
    this.capsParser = new Http2CapsuleParser({
      stream,
      nativesession: this,
      sessioncallback: HttpWTSession.callback,
      streamcallback: HttpWTStream.callback,
      isclient
    })
    this.unidiId = 0
    this.bidiId = 0
    this.isclient = isclient
  }

  /**
   * @param {Uint8Array} chunk
   */
  writeDatagram(chunk) {
    this.capsParser.writeCapsule({
      type: Http2CapsuleParser.DATAGRAM,
      headerVints: [],
      payload: undefined
    })
  }

  orderUnidiStream() {
    let streamid = 0x2 | (this.unidiId << 2)
    if (this.isclient) streamid = streamid | 0x1
    this.capsParser.writeCapsule({
      type: Http2CapsuleParser.WT_STREAM_WOFIN,
      headerVints: [streamid],
      payload: undefined
    })
    this.capsParser.newStream(streamid)
    this.unidiId++
  }

  orderBidiStream() {
    let streamid = 0x0 | (this.bidiId << 2)
    if (this.isclient) streamid = streamid | 0x1
    this.capsParser.writeCapsule({
      type: Http2CapsuleParser.WT_STREAM_WOFIN,
      headerVints: [streamid],
      payload: undefined
    })
    this.capsParser.newStream(streamid)
    this.bidiId++
  }

  // orderStats() {}
  notifySessionDraining() {}
  /**
   * @param {{ code: number, reason: string }} arg
   */
  close({ code, reason }) {
    // what to do with the reason
    this.stream.close(code)
  }
}
