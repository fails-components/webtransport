import { ReadableStream, WritableStream } from 'node:stream/web'
import { HttpWTStream } from './stream.js'
import { WebTransportError } from './error.js'
import { logger } from './utils.js'

const log = logger(`webtransport:http3wtsession(${process.pid})`)

/**
 * WebTransport session events
 * @typedef {import('./types').WebTransportSessionEventHandler} WebTransportSessionEventHandler
 * @typedef {import('./types').SessionReadyEvent} SessionReadyEvent
 * @typedef {import('./types').SessionCloseEvent} SessionCloseEvent
 * @typedef {import('./types').DatagramReceivedEvent} DatagramReceivedEvent
 * @typedef {import('./types').DatagramSendEvent} DatagramSendEvent
 * @typedef {import('./types').GoawayReceivedEvent} GoawayReceivedEvent
 * @typedef {import('./types').DatagramStatsEvent} DatagramStatsEvent
 * @typedef {import('./types').SessionStatsEvent} SessionStatsEvent
 * @typedef {import('./types').NewStreamEvent} NewStreamEvent
 *
 * @typedef {import('./dom').WebTransportCloseInfo} WebTransportCloseInfo
 * @typedef {import('./dom').WebTransportBidirectionalStream} WebTransportBidirectionalStream
 * @typedef {import('./dom').WebTransportSendStream} WebTransportSendStream
 * @typedef {import('./dom').WebTransportReceiveStream} WebTransportReceiveStream
 * @typedef {import('./dom').WebTransportDatagramDuplexStream} WebTransportDatagramDuplexStream
 * @typedef {import('./dom').WebTransportReliabilityMode} WebTransportReliabilityMode
 * @typedef {import('./dom').WebTransportCongestionControl} WebTransportCongestionControl
 * @typedef {import('./dom').WebTransportStats} WebTransportStats
 * @typedef {import('./dom').WebTransportDatagramStats} WebTransportDatagramStats
 *
 * @typedef {import('./types').NativeHttpWTSession} NativeHttpWTSession
 *
 * Public API
 * @typedef {import('./types').WebTransportSession} WebTransportSession
 *
 * @typedef {import('./server').HttpServer} HttpServer
 * @typedef {import('./client').HttpClient} HttpClient
 *
 * @typedef {import('stream/web').WritableStreamDefaultController} WritableStreamDefaultController
 */

/**
 * @implements {WebTransportSessionEventHandler}
 * @implements {WebTransportSession}
 */
export class HttpWTSession {
  /**
   * @param {object} args
   * @param {import('./types').NativeHttpWTSession} [args.object]
   * @param {HttpServer | HttpClient} args.parentobj
   * @param {any | undefined} [args.header= undefined]
   */
  constructor(args) {
    if (args.object) {
      this.objint = args.object
      this.objint.jsobj = this
    }
    this.parentobj = args.parentobj
    /** @type {import('./types').WebTransportSessionState} */
    this.state = 'connecting'

    /** @type {((value?: any) => void) | null | undefined} */
    this.readyResolve = null
    /** @type {(() => void) | null | undefined} */
    this.closeHook = null
    /** @type {(any | null | undefined)} */
    this.header = args.header

    /** @type {Promise<void>} */
    this.ready = new Promise((resolve, reject) => {
      this.readyResolve = resolve
      this.readyReject = reject
    })
    /** @type {WebTransportReliabilityMode} */
    this.reliability = 'pending'
    /** @type {WebTransportCongestionControl} */
    this.congestionControl = 'default'
    /** @type {Promise<WebTransportCloseInfo>} */
    this.closed = new Promise((resolve, reject) => {
      this.closedResolve = resolve
      this.closedReject = reject
    })

    /** @type {Promise<undefined>} */
    this.draining = new Promise((resolve, reject) => {
      this.drainingResolve = resolve
      this.drainingReject = reject
    })

    /** @type {ReadableStream<WebTransportBidirectionalStream>} */
    this.incomingBidirectionalStreams = new ReadableStream({
      /** @param {ReadableStreamDefaultController<WebTransportBidirectionalStream>} controller */
      start: (controller) => {
        this.incomBiDiController = controller
      }
    })
    /** @type {ReadableStream<WebTransportReceiveStream>} */
    this.incomingUnidirectionalStreams = new ReadableStream({
      /** @param {ReadableStreamDefaultController<WebTransportReceiveStream>} controller */
      start: (controller) => {
        this.incomUniDiController = controller
      }
    })

    /** @type {Array<() => void>} */
    this.writeDatagramRes = []
    /** @type {Array<(err?: Error) => void>} */
    this.writeDatagramRej = []
    /** @type {Array<Promise<void>>} */
    this.writeDatagramProm = []

    /** @type {WebTransportDatagramDuplexStream} */
    this.datagrams = {
      /** @type {ReadableStream<Uint8Array>} */
      readable: new ReadableStream({
        start: (
          /** @type {import("stream/web").ReadableByteStreamController} */ controller
        ) => {
          this.incomDatagramController = controller
        },
        type: 'bytes'
      }),
      writable: new WritableStream({
        start: (controller) => {
          this.outgoDatagramController = controller
        },
        write: (chunk, controller) => {
          if (this.state === 'closed') throw new Error('Session is closed')
          if (chunk instanceof Uint8Array) {
            /** @type {Promise<void>} */
            const ret = new Promise((resolve, reject) => {
              this.writeDatagramRes.push(resolve)
              this.writeDatagramRej.push(reject)
            })
            this.writeDatagramProm.push(ret)
            log.trace('b4 datagram write', chunk)
            if (this.objint == null) {
              throw new Error('this.objint is not set')
            }
            this.objint.writeDatagram(chunk)
            return ret
          } else throw new Error('chunk is not of type Uint8Array')
        },
        close: () => {
          // do nothing
        }
      })
    }

    /** @type {Array<(stream: WebTransportBidirectionalStream) => void>} */
    this.resolveBiDi = []
    /** @type {Array<(stream: WebTransportSendStream) => void>} */
    this.resolveUniDi = []
    /** @type {Array<(err?: Error) => void>} */
    this.rejectBiDi = []
    /** @type {Array<(err?: Error) => void>} */
    this.rejectUniDi = []

    /** @type {Array<(stats: WebTransportStats) => void>} */
    this.resolveSessionStats = []
    /** @type {Array<(err?: Error) => void>} */
    this.rejectSessionStats = []

    /** @type {Array<(stats: WebTransportDatagramStats) => void>} */
    this.resolveDatagramStats = []
    /** @type {Array<(err?: Error) => void>} */
    this.rejectDatagramStats = []

    /** @type {Set<WebTransportSendStream>} */
    this.sendStreams = new Set()
    /** @type {Set<WebTransportReceiveStream>} */
    this.receiveStreams = new Set()
    /** @type {Set<HttpWTStream>} */
    this.streamObjs = new Set()

    /** @type {Set<WritableStreamDefaultController>} */
    this.sendStreamsController = new Set()
    /** @type {Set<ReadableStreamDefaultController>} */
    this.receiveStreamsController = new Set()
  }

  /**
   * @param {NativeHttpWTSession} object
   */
  setSessionObj(object) {
    if (object) {
      this.objint = object
      this.objint.jsobj = this
    }
  }

  getStats() {
    if (this.objint == null) {
      throw new Error('this.objint not set')
    }
    const prom = new Promise((resolve, reject) => {
      this.resolveSessionStats.push(resolve)
      this.rejectSessionStats.push(reject)
    })
    this.objint.orderSessionStats()
    return prom
  }

  /**
   * @param {SessionStatsEvent} evt
   */
  onSessionStats({
    timestamp,
    expiredOutgoing = BigInt(0),
    lostOutgoing = BigInt(0),
    // non Datagram
    minRtt = 0,
    smoothedRtt = 0,
    rttVariation = 0,
    estimatedSendRateBps
  }) {
    const res = this.resolveSessionStats.pop()
    this.rejectSessionStats.pop()
    if (res)
      res({
        timestamp,
        bytesSent: BigInt(0),
        packetsSent: BigInt(0),
        packetsLost: BigInt(0),
        numOutgoingStreamsCreated: 0,
        numIncomingStreamsCreated: 0,
        bytesReceived: BigInt(0),
        packetsReceived: BigInt(0),
        smoothedRtt,
        rttVariation,
        minRtt,
        estimatedSendRate: estimatedSendRateBps,
        datagrams: {
          timestamp,
          expiredOutgoing,
          droppedIncoming: BigInt(0),
          lostOutgoing
        }
      })
  }

  /**
   * @param {DatagramStatsEvent} evt
   */
  onDatagramStats({
    timestamp,
    expiredOutgoing = BigInt(0),
    lostOutgoing = BigInt(0)
  }) {
    const res = this.resolveDatagramStats.pop()
    this.rejectDatagramStats.pop()
    if (res)
      res({
        timestamp,
        expiredOutgoing,
        droppedIncoming: BigInt(0),
        lostOutgoing
      })
  }

  async waitForDatagramsSend() {
    while (this.writeDatagramProm.length > 0) {
      try {
        await Promise.allSettled(this.writeDatagramProm)
      } catch (error) {
        log.error('datagram promise failed ', error)
      }
    }
  }

  notifySessionDraining() {
    if (this.objint == null) {
      throw new Error('this.objint not set')
    }
    this.objint.notifySessionDraining()
  }

  /**
   * @param {HttpWTStream} stream
   */
  addStreamObj(stream) {
    this.streamObjs.add(stream)
  }

  /**
   * @param {HttpWTStream} stream
   */
  removeStreamObj(stream) {
    this.streamObjs.delete(stream)
  }

  /**
   * @param {WebTransportSendStream} stream
   * @param {WritableStreamDefaultController} controller
   */
  addSendStream(stream, controller) {
    this.sendStreams.add(stream)
    this.sendStreamsController.add(controller)
  }

  /**
   * @param {WebTransportSendStream} stream
   * @param {WritableStreamDefaultController} controller
   */
  removeSendStream(stream, controller) {
    this.sendStreams.delete(stream)
    this.sendStreamsController.delete(controller)
  }

  /**
   * @param {WebTransportReceiveStream } stream
   * @param {ReadableStreamDefaultController} controller
   */
  addReceiveStream(stream, controller) {
    this.receiveStreams.add(stream)
    this.receiveStreamsController.add(controller)
  }

  /**
   * @param {WebTransportReceiveStream } stream
   * @param {ReadableStreamDefaultController} controller
   */
  removeReceiveStream(stream, controller) {
    this.receiveStreams.delete(stream)
    this.receiveStreamsController.delete(controller)
  }

  /**
   * @returns {Promise<WebTransportBidirectionalStream>}
   */
  createBidirectionalStream() {
    if (this.objint == null) {
      throw new Error('this.objint not set')
    }
    /** @type {Promise<WebTransportBidirectionalStream>} */
    const prom = new Promise((resolve, reject) => {
      this.resolveBiDi.push(resolve)
      this.rejectBiDi.push(reject)
    })
    this.objint.orderBidiStream()
    return prom
  }

  /**
   *@returns {Promise<WebTransportSendStream>}
   */
  createUnidirectionalStream() {
    if (this.objint == null) {
      throw new Error('this.objint not set')
    }
    /** @type {Promise<WebTransportSendStream>} */
    const prom = new Promise((resolve, reject) => {
      this.resolveUniDi.push(resolve)
      this.rejectUniDi.push(reject)
    })
    this.objint.orderUnidiStream()
    return prom
  }

  /**
   * @param {object} [closeInfo]
   * @param {number} closeInfo.closeCode
   * @param {string} closeInfo.reason
   * @returns {void}
   */
  close(closeInfo) {
    log('closeinfo', closeInfo)
    if (this.state === 'closed' || this.state === 'failed') return
    if (this.objint) {
      this.objint.close({
        code: closeInfo?.closeCode ?? 0,
        reason: closeInfo?.reason.substring(0, 1023) ?? ''
      })
    }
  }

  onReady(/* error */) {
    this.state = 'connected'
    this.reliability = 'supports-unreliable'
    if (this.readyResolve) this.readyResolve()
    delete this.readyResolve
  }

  /**
   * @param {SessionCloseEvent} args
   */
  onClose(args) {
    delete this.objint // not valid any more

    if (this.state !== 'connected') {
      log.error(
        'session was closed before state was "connected" - it was "%s"',
        this.state
      )
      this.state = 'failed'

      // make sure the event loop can still exit
      if (this.closeHook) {
        this.closeHook()
        delete this.closeHook
      }

      // closed before connected
      const error = new WebTransportError('Opening handshake failed.')
      this.readyReject(error)
      this.closedReject(error)
      return
    }

    log('onClose')
    const error = new WebTransportError('Session closed')

    for (const rej of this.rejectBiDi) rej(error)
    for (const rej of this.rejectUniDi) rej(error)
    for (const rej of this.writeDatagramRej) rej(error)
    for (const rej of this.rejectSessionStats) rej(error)
    for (const rej of this.rejectDatagramStats) rej(error)

    this.writeDatagramRej = []
    this.writeDatagramRes = []
    this.writeDatagramProm = []
    this.resolveBiDi = []
    this.resolveUniDi = []
    this.rejectBiDi = []
    this.rejectUniDi = []

    this.resolveSessionStats = []
    this.rejectSessionStats = []
    this.resolveDatagramStats = []
    this.rejectDatagramStats = []

    this.incomBiDiController.close()
    this.incomUniDiController.close()
    this.incomDatagramController.close()
    // this.outgoDatagramController.error(errorcode)
    this.state = 'closed'

    const wtError = new WebTransportError(
      `Session closed (on process ${process.pid}) with code ` +
        args.errorcode +
        ' and reason' +
        args.error
    )

    this.sendStreamsController.forEach((ele) => ele.error(wtError))
    this.receiveStreamsController.forEach((ele) => ele.error(wtError))

    this.streamObjs.forEach((ele) => (ele.readableclosed = true))

    this.sendStreams.clear()
    this.receiveStreams.clear()
    this.sendStreamsController.clear()
    this.receiveStreamsController.clear()
    this.streamObjs.clear()

    if (this.closedResolve)
      this.closedResolve({
        closeCode: args.errorcode,
        reason: args.error ? args.error : ''
      })
    if (this.closeHook) {
      this.closeHook()
      delete this.closeHook
    }
  }

  /**
   * @param {NewStreamEvent} args
   */
  onStream(args) {
    const strobj = new HttpWTStream({
      object: args.stream,
      parentobj: this,
      transport: this.parentobj,
      bidirectional: args.bidirectional,
      incoming: args.incoming
    })
    this.addStreamObj(strobj)
    if (args.incoming) {
      if (args.bidirectional) {
        this.incomBiDiController.enqueue(strobj)
      } else {
        this.incomUniDiController.enqueue(strobj.readable)
      }
    } else {
      if (args.bidirectional) {
        if (this.resolveBiDi.length === 0)
          throw new Error('Got bidirectional stream without asking for it')
        this.rejectBiDi.shift()
        const curres = this.resolveBiDi.shift()

        if (
          curres != null &&
          strobj.readable != null &&
          strobj.writable != null
        ) {
          curres({
            readable: strobj.readable,
            writable: strobj.writable
          })
        }
      } else {
        if (this.resolveUniDi.length === 0)
          throw new Error('Got unidirectional stream without asking for it')
        this.rejectUniDi.shift()
        const curres = this.resolveUniDi.shift()

        if (curres != null && strobj.writable != null) {
          curres(strobj.writable)
        }
      }
    }
  }

  /**
   * @param {DatagramReceivedEvent} args
   */
  onDatagramReceived(args) {
    log.trace('datagram received', args.datagram)
    // console.log('datagram received', args.datagram, Date.now())
    if (this.incomDatagramController.byobRequest) {
      /** @type {ReadableStreamBYOBRequest} */
      const byob = this.incomDatagramController.byobRequest
      /** @type {Uint8Array} */
      // @ts-ignore
      const view = byob?.view
      // @ts-ignore
      if (!(view instanceof Uint8Array))
        throw new Error('byob view is not a Uint8Array')
      if (view.byteLength < args.datagram.byteLength) {
        throw new Error('supplied view is not large enough.')
      }
      const destview = new Uint8Array(
        view.buffer,
        0 + view.byteOffset,
        args.datagram.byteLength
      )
      destview.set(args.datagram)
      byob.respond(args.datagram.byteLength)
    }
    this.incomDatagramController.enqueue(args.datagram)
  }

  /**
   * @param {DatagramSendEvent} args
   */
  onDatagramSend(args) {
    if (this.state === 'closed') return
    this.writeDatagramRej.shift()
    this.writeDatagramProm.shift()
    const res = this.writeDatagramRes.shift()

    if (res != null) {
      res()
    }
  }

  /**
   * @param {GoawayReceivedEvent} args
   */
  onGoAwayReceived(args) {
    if (this.drainingResolve) this.drainingResolve(undefined)
    this.state = 'draining'
  }

  /**
   * @param {SessionReadyEvent | SessionCloseEvent | DatagramReceivedEvent | DatagramSendEvent | GoawayReceivedEvent | SessionStatsEvent | DatagramStatsEvent | NewStreamEvent} args
   */
  static callback(args) {
    log('callback', args?.purpose)
    log.trace(args)

    if (!args || !args.object || !args.object.jsobj)
      throw new Error('Session callback without jsobj')
    const visitor = args.object.jsobj
    if (args.purpose) {
      switch (args.purpose) {
        case 'SessionReady':
          visitor.onReady(args)
          break
        case 'SessionClose':
          visitor.onClose(args)
          break
        case 'DatagramReceived':
          if (visitor && Object.prototype.hasOwnProperty.call(args, 'datagram'))
            visitor.onDatagramReceived(args)
          break
        case 'DatagramSend':
          if (visitor) visitor.onDatagramSend(args)
          break
        case 'GoawayReceived':
          visitor.onGoAwayReceived(args)
          break
        case 'SessionStats':
          visitor.onSessionStats(args)
          break
        case 'DatagramStats':
          visitor.onDatagramStats(args)
          break
        case 'Http2WTStreamVisitor':
        case 'Http3WTStreamVisitor':
          if (
            visitor &&
            Object.prototype.hasOwnProperty.call(args, 'bidirectional') &&
            Object.prototype.hasOwnProperty.call(args, 'incoming')
          ) {
            visitor.onStream(args)
          } else throw new Error('Malformed Http3WTStreamVisitor')
          break
        default:
          throw new Error('unknown purpose Sessioncb')
      }
    } else throw new Error('no purpose Sessioncb')
  }
}
