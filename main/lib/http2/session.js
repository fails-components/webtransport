/**
 * @typedef {import('http2').Http2Stream} Http2Stream
 */
import { ParserBase } from './parserbase.js'
import { FlowController } from './flowcontroller.js'
import { logger } from '../utils.js'

const pid = typeof process !== 'undefined' ? process.pid : 0
const log = logger(`webtransport:http2webtransportsession(${pid})`)

let processnextTick = (/** @type {{ (args: any[]): any }} */ func) =>
  setTimeout(func, 0)
// @ts-ignore
if (typeof process !== 'undefined') processnextTick = process.nextTick

export class Http2WebTransportSession {
  /**
   * @param {{stream?: Http2Stream, ws?: WebSocket, isclient:boolean,
   * createParser:import('../types.js').CreateParserFunction
   * sendWindowOffset: Number,
   * receiveWindowOffset: Number,
   * shouldAutoTuneReceiveWindow: boolean
   * receiveWindowSizeLimit: Number}} args
   * */
  constructor({
    stream,
    ws,
    isclient,
    createParser,
    sendWindowOffset,
    receiveWindowOffset,
    shouldAutoTuneReceiveWindow,
    receiveWindowSizeLimit
  }) {
    // @ts-ignore
    this.jsobj = undefined // the creator will set this
    if (stream) {
      this.stream = stream
    } else if (ws) {
      this.ws = ws
    } else throw new Error('Neither stream or websocket supplied')
    this.capsParser = createParser(this)
    this.unidiId = 0
    this.bidiId = 0
    this.isclient = isclient
    this.flowController = new FlowController({
      tocontrol: this,
      sendWindowOffset,
      receiveWindowOffset,
      shouldAutoTuneReceiveWindow,
      receiveWindowSizeLimit
    })
    if (stream) {
      if (isclient) {
        stream.on('response', (headers) => {
          processnextTick(() => {
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
        processnextTick(() => {
          this.jsobj.onReady({})
        })
      }
    }
  }

  sendInitialParameters() {
    this.flowController.sendWindowUpdate()
    this.capsParser.writeCapsule({
      type: ParserBase.WT_MAX_STREAMS_BIDI,
      headerVints: [0xffffff],
      payload: undefined
    })
    this.capsParser.writeCapsule({
      type: ParserBase.WT_MAX_STREAMS_UNIDI,
      headerVints: [0xffffff],
      payload: undefined
    })
  }

  /**
   * @param {Uint8Array} chunk
   */
  writeDatagram(chunk) {
    this.capsParser.writeCapsule({
      type: ParserBase.DATAGRAM,
      headerVints: [],
      payload: chunk
    })
    processnextTick(() => {
      this.jsobj.onDatagramSend({})
    })
  }

  orderUnidiStream() {
    let streamid = 0x2 | (this.unidiId << 2)
    if (this.isclient) streamid = streamid | 0x1
    this.capsParser.writeCapsule({
      type: ParserBase.WT_STREAM_WOFIN,
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
      type: ParserBase.WT_STREAM_WOFIN,
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
    this.capsParser.sendClose({ code, reason }) // this includes for ws closing the session!
    // what to do with the reason
    if (this.stream) {
      this.capsParser.closeHttp2Stream(code)
    }
  }

  /**
   * @param {bigint} windowOffset
   */
  sendWindowUpdate(windowOffset) {
    this.capsParser.writeCapsule({
      type: ParserBase.WT_MAX_DATA,
      headerVints: [windowOffset],
      payload: undefined
    })
  }

  /**
   * @param {bigint} pos
   */
  reportBlocked(pos) {
    log('Session was blocked at:', pos)
  }

  /**
   * @param {bigint} windowOffset
   */
  sendBlocked(windowOffset) {
    this.capsParser.writeCapsule({
      type: ParserBase.WT_DATA_BLOCKED,
      headerVints: [windowOffset],
      payload: undefined
    })
  }

  connected() {
    return this.jsobj.state === 'connected'
  }

  /**
   * @param {{ code: number, reason: string }} arg
   */
  closeConnection({ code, reason }) {
    console.trace()
    // called in case of failure in parsing or flowcontrol
    this.jsobj.onClose({
      errorcode: code,
      error: reason
    })
    this.close({ code, reason })
  }

  smoothedRtt() {
    if (this.stream) {
      // we are on node
      // @ts-ignore
      return this.stream.session?.WTrtt || 26
    } else if (this.ws) {
      // we are at the Browser, so we use the connection rtt?
      // @ts-ignore
      return navigator?.connection?.rtt || 26
    }
  }
}
