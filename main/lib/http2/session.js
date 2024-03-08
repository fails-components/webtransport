/**
 * @typedef {import('http2').Http2Stream} Http2Stream
 * @typedef {import('../dom.js').WebTransportSendGroup} WebTransportSendGroup
 */
import { ParserBase } from './parserbase.js'
import { FlowController } from './flowcontroller.js'
import { logger } from '../utils.js'
import { StreamIdManager } from './streamidmanager.js'

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
   * receiveWindowSizeLimit: Number,
   * initialBidirectionalSendStreams: Number,
   * initialBidirectionalReceiveStreams: Number,
   * initialUnidirectionalSendStreams: Number,
   * initialUnidirectionalReceiveStreams: Number}} args
   * */
  constructor({
    stream,
    ws,
    isclient,
    createParser,
    sendWindowOffset,
    receiveWindowOffset,
    shouldAutoTuneReceiveWindow,
    receiveWindowSizeLimit,
    initialBidirectionalSendStreams,
    initialBidirectionalReceiveStreams,
    initialUnidirectionalSendStreams,
    initialUnidirectionalReceiveStreams
  }) {
    // @ts-ignore
    this.jsobj = undefined // the creator will set this
    if (stream) {
      this.stream = stream
    } else if (ws) {
      this.ws = ws
    } else throw new Error('Neither stream or websocket supplied')
    this.capsParser = createParser(this)
    this.isclient = isclient
    this.flowController = new FlowController({
      tocontrol: this,
      sendWindowOffset,
      receiveWindowOffset,
      shouldAutoTuneReceiveWindow,
      receiveWindowSizeLimit
    })
    this.streamIdMngrUni = new StreamIdManager({
      delegate: this,
      unidirectional: true,
      isclient,
      maxAllowedIncomingStreams: initialUnidirectionalReceiveStreams,
      maxAllowedOutgoingStreams: initialUnidirectionalSendStreams
    })
    this.streamIdMngrBi = new StreamIdManager({
      delegate: this,
      unidirectional: false,
      isclient,
      maxAllowedIncomingStreams: initialBidirectionalReceiveStreams,
      maxAllowedOutgoingStreams: initialBidirectionalSendStreams
    })
    this.orderUniStreams = 0
    this.orderBiStreams = 0
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
    this.streamIdMngrBi.sendMaxStreamsFrameInitial()
    this.streamIdMngrUni.sendMaxStreamsFrameInitial()
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

  trySendingUnidirectionalStreams() {
    while (
      this.orderUniStreams > 0 &&
      this.streamIdMngrUni.canOpenNextOutgoingStream()
    ) {
      const streamid = this.streamIdMngrUni.getNextOutgoingStreamId()
      this.capsParser.writeCapsule({
        type: ParserBase.WT_STREAM_WOFIN,
        headerVints: [streamid],
        payload: undefined
      })
      this.capsParser.newStream(streamid)
      this.orderUniStreams--
    }
  }

  /**
   * @param {{sendGroup:  WebTransportSendGroup|null, sendOrder: number, waitUntilAvailable: boolean}} opts
   */
  orderUnidiStream({ sendGroup, sendOrder, waitUntilAvailable }) {
    const canopen = this.streamIdMngrUni.canOpenNextOutgoingStream()
    const maxset = this.streamIdMngrUni.isMaxStreamSet() // we block if the maxsetting did not arrive

    if (canopen || waitUntilAvailable || !maxset) {
      this.orderUniStreams++
      this.trySendingUnidirectionalStreams()
      return true
    }
    return false
  }

  trySendingBidirectionalStreams() {
    while (
      this.orderBiStreams > 0 &&
      this.streamIdMngrBi.canOpenNextOutgoingStream()
    ) {
      const streamid = this.streamIdMngrBi.getNextOutgoingStreamId()
      this.capsParser.writeCapsule({
        type: ParserBase.WT_STREAM_WOFIN,
        headerVints: [streamid],
        payload: undefined
      })
      this.capsParser.newStream(streamid)
      this.orderBiStreams--
    }
  }

  /**
   * @param {{sendGroup:  WebTransportSendGroup|null, sendOrder: number, waitUntilAvailable: boolean}} opts
   */
  orderBidiStream({ sendGroup, sendOrder, waitUntilAvailable }) {
    const canopen = this.streamIdMngrBi.canOpenNextOutgoingStream()
    const maxset = this.streamIdMngrBi.isMaxStreamSet() // we block if the maxsetting did not arrive

    if (canopen || waitUntilAvailable || !maxset) {
      this.orderBiStreams++
      this.trySendingBidirectionalStreams()
      return true
    }
    return false
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
    // should also close the stream
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

  /**
   * @returns {boolean}
   */
  canSendMaxStreams() {
    return true
  }

  /**
   * @param {bigint} maxStreams
   * @param {boolean} unidirectional
   */
  sendMaxStreams(maxStreams, unidirectional) {
    this.capsParser.writeCapsule({
      type: unidirectional
        ? ParserBase.WT_MAX_STREAMS_UNIDI
        : ParserBase.WT_MAX_STREAMS_BIDI,
      headerVints: [maxStreams],
      payload: undefined
    })
  }
}
