/**
 * @typedef {import('http2').Http2Stream} Http2Stream
 */

import { Http2CapsuleParser } from './capsuleparser.js'

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
      isclient
    })
    this.unidiId = 0
    this.bidiId = 0
    this.isclient = isclient
    if (isclient) {
      stream.on('response', (headers) => {
        process.nextTick(() => {
          if (headers[':status'] === 200) {
            // on ready
            this.jsobj.onReady({})
          } else {
            this.jsobj.onClose({
              errorcode: headers[':status'],
              error: 'Session stream errored'
            })
          }
        })
      })
    } else {
      process.nextTick(() => {
        this.jsobj.onReady({})
      })
    }
  }

  /**
   * @param {Uint8Array} chunk
   */
  writeDatagram(chunk) {
    this.capsParser.writeCapsule({
      type: Http2CapsuleParser.DATAGRAM,
      headerVints: [],
      payload: chunk
    })
    process.nextTick(() => {
      this.jsobj.onDatagramSend({})
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

  orderSessionStats() {
    this.jsobj.onSessionStats({
      timestamp: 0,
      expiredOutgoing: 0n,
      lostOutgoing: 0n,
      // non Datagram
      minRtt: 0,
      smoothedRtt: 0,
      rttVariation: 0,
      estimatedSendRateBps: 0n
    })
  }

  orderDatagramStats() {
    this.jsobj.onDatagramStats({
      timestamp: 0,
      expiredOutgoing: 0n,
      lostOutgoing: 0n
    })
  }

  /*
   * @returns {void}
   */
  notifySessionDraining() {}
  /**
   * @param {{ code: number, reason: string }} arg
   */
  close({ code, reason }) {
    // what to do with the reason
    this.stream.close(code)
  }
}