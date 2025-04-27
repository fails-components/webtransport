/**
 * @typedef {import('http2').Http2Stream} Http2Stream
 * @typedef {import('../dom.js').WebTransportSendGroup} WebTransportSendGroup
 * @typedef {import('../dom.js').WebTransportSendStreamOptions} WebTransportSendStreamOptions
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
    /** @type {Array<Uint8Array>} */
    this.datagramsWaiting_ = []
    /** @type {Array<{sendOrder: bigint, sendGroupId: bigint}>} */
    this.orderUniStreams = []
    /** @type {Array<{sendOrder: bigint, sendGroupId: bigint}>} */
    this.orderBiStreams = []
    if (stream) {
      if (isclient) {
        stream.on('response', (headers) => {
          processnextTick(() => {
            if (headers[':status'] === 200) {
              const beReady = {}
              if (stream && headers['wt-protocol']) {
                // http/2 case
                // @ts-ignore
                beReady.protocol = headers['wt-protocol']
              }
              // on ready
              this.jsobj.onReady(beReady)
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
    let skip = false //skips the initial parameters at environment with settings
    if (process) {
      if (process.version) {
        const majorVersion = parseInt(
          process.version.split('.')[0].substring(1)
        )
        if (majorVersion >= 20) skip = true
      }
    }
    if (!skip || this.capsParser.initialParametersMandatory()) {
      this.flowController.sendWindowUpdate()
      this.streamIdMngrBi.sendMaxStreamsFrameInitial()
      this.streamIdMngrUni.sendMaxStreamsFrameInitial()
    }
  }

  drainWrites() {
    while (!this.capsParser.blocked && this.datagramsWaiting_.length > 0) {
      const outChunk = this.datagramsWaiting_.shift()
      this.capsParser.writeCapsule({
        type: ParserBase.DATAGRAM,
        headerVints: [],
        payload: outChunk
      })
    }
    if (this.datagramsWaiting_.length > 0) {
      this.capsParser.scheduleDrainWrites()
    }
  }

  /**
   * @param {Uint8Array} chunk
   * @return {{ code: "success" | "blocked" | "internalError" | "tooBig", message?: string | undefined; }}
   */
  writeDatagram(chunk) {
    if (chunk.byteLength > this.getMaxDatagramSize()) return { code: 'tooBig' }
    if (this.capsParser.blocked) {
      this.datagramsWaiting_.push(chunk)
      this.capsParser.scheduleDrainWrites()
      return { code: 'blocked' }
    }
    this.capsParser.writeCapsule({
      type: ParserBase.DATAGRAM,
      headerVints: [],
      payload: chunk
    })
    return { code: 'success' }
  }

  trySendingUnidirectionalStreams() {
    while (
      this.orderUniStreams.length > 0 &&
      this.streamIdMngrUni.canOpenNextOutgoingStream()
    ) {
      const streamid = this.streamIdMngrUni.getNextOutgoingStreamId()
      const priority = this.orderUniStreams.pop()
      this.capsParser.writeCapsule({
        type: ParserBase.WT_STREAM_WOFIN,
        headerVints: [streamid],
        payload: undefined
      })
      this.capsParser.newStream(
        streamid,
        priority || { sendGroupId: 0n, sendOrder: 0n }
      )
    }
  }

  /**
   * @param {WebTransportSendStreamOptions} opts
   */
  orderUnidiStream({ sendGroup, sendOrder, waitUntilAvailable }) {
    const canopen = this.streamIdMngrUni.canOpenNextOutgoingStream()
    const maxset = this.streamIdMngrUni.isMaxStreamSet() // we block if the maxsetting did not arrive

    if (canopen || waitUntilAvailable || !maxset) {
      this.orderUniStreams.push({
        // @ts-ignore
        sendGroupId: sendGroup?._sendGroupId || 0n,
        sendOrder: sendOrder ?? 0n
      })
      this.trySendingUnidirectionalStreams()
      return true
    }
    return false
  }

  trySendingBidirectionalStreams() {
    while (
      this.orderBiStreams.length > 0 &&
      this.streamIdMngrBi.canOpenNextOutgoingStream()
    ) {
      const streamid = this.streamIdMngrBi.getNextOutgoingStreamId()
      const priority = this.orderBiStreams.pop()
      this.capsParser.writeCapsule({
        type: ParserBase.WT_STREAM_WOFIN,
        headerVints: [streamid],
        payload: undefined
      })
      this.capsParser.newStream(
        streamid,
        priority || { sendGroupId: 0n, sendOrder: 0n }
      )
    }
  }

  /**
   * @param {WebTransportSendStreamOptions} opts
   */
  orderBidiStream({ sendGroup, sendOrder, waitUntilAvailable }) {
    const canopen = this.streamIdMngrBi.canOpenNextOutgoingStream()
    const maxset = this.streamIdMngrBi.isMaxStreamSet() // we block if the maxsetting did not arrive

    if (canopen || waitUntilAvailable || !maxset) {
      this.orderBiStreams.push({
        // @ts-ignore
        sendGroupId: sendGroup?._sendGroupId || 0n,
        sendOrder: sendOrder ?? 0n
      })
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

  getMaxDatagramSize() {
    return 16384 // this completly arbitry, we do not have a real restriction, but we choose more than quiche, to make things interesting
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
    let toret
    if (this.stream) {
      // we are on node
      // @ts-ignore
      toret = this.stream.session?.WTrtt || 25
    } else if (this.ws) {
      // we are at the Browser, so we use the connection rtt?
      // @ts-ignore
      // eslint-disable-next-line no-undef
      toret = navigator?.connection?.rtt || 25
    }
    toret = Math.ceil(toret / 25) * 25 // to do be to accurate!
    return toret
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
