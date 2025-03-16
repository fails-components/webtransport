import { ReadableStream, WritableStream } from './webstreams.js'
import { HttpWTStream } from './stream.js'
import { WebTransportError } from './error.js'
import { logger } from './utils.js'
import { canByteStream } from './features.js'

const pid = typeof process !== 'undefined' ? process.pid : 0
const log = logger(`webtransport:httpwtsession(${pid})`)

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
 * @typedef {import('./dom').WebTransportSendStreamOptions} WebTransportSendStreamOptions
 * @typedef {import('./dom').WebTransportReceiveStream} WebTransportReceiveStream
 * @typedef {import('./dom').WebTransportDatagramDuplexStream} WebTransportDatagramDuplexStream
 * @typedef {import('./dom').WebTransportReliabilityMode} WebTransportReliabilityMode
 * @typedef {import('./dom').WebTransportCongestionControl} WebTransportCongestionControl
 * @typedef {import('./dom').WebTransportSendGroup} WebTransportSendGroup
 * @typedef {import('./dom').WebTransportStats} WebTransportStats
 * @typedef {import('./dom').WebTransportDatagramStats} WebTransportDatagramStats
 *
 * @typedef {import('./types').NativeHttpWTSession} NativeHttpWTSession
 *
 * Public API
 * @typedef {import('./types').WebTransportSessionImpl} WebTransportSession
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
   * @param {Object | undefined} [args.header= undefined]
   * @param {Object | undefined} [args.userData= undefined]
   */
  constructor(args) {
    if (args.object) {
      this.objint = args.object
      this.objint.jsobj = this
      if (this.objint.sendInitialParameters) {
        this.objint.sendInitialParameters()
      }
    }
    this.parentobj = args.parentobj
    /** @type {import('./types').WebTransportSessionState} */
    this.state = 'connecting'

    /** @type {((value?: any) => void) | null | undefined} */
    this.readyResolve = null
    /** @type {(() => void) | null | undefined} */
    this.closeHook = null
    /** @type {(Object | null | undefined)} */
    this.header = args.header
    /** @type {(Object | null | undefined)} */
    this.userData = args.userData

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
    // @ts-ignore
    this.incomingBidirectionalStreams = new ReadableStream({
      /** @param {ReadableStreamDefaultController<WebTransportBidirectionalStream>} controller */
      start: (controller) => {
        this.incomBiDiController = controller
      }
    })
    /** @type {ReadableStream<WebTransportReceiveStream>} */
    // @ts-ignore
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
    const readableopts = {
      start: (
        /** @type {import("stream/web").ReadableByteStreamController} */ controller
      ) => {
        this.incomDatagramController = controller
      },
      type: 'bytes'
    }
    if (!canByteStream) {
      // @ts-ignore
      delete readableopts.type
    }
    /** @type {WebTransportDatagramDuplexStream} */
    this.datagrams = {
      /** @type {ReadableStream<Uint8Array>} */
      // @ts-ignore
      readable: new ReadableStream(readableopts),
      writable: new WritableStream({
        start: (controller) => {
          this.outgoDatagramController = controller
        },
        // eslint-disable-next-line no-unused-vars
        write: (chunk, controller) => {
          if (this.state === 'closed') throw new Error('Session is closed')
          if (chunk instanceof Uint8Array) {
            /** @type {Promise<void>} */
            const ret = new Promise((resolve, reject) => {
              this.writeDatagramRes.push(resolve)
              this.writeDatagramRej.push(reject)
            })
            this.writeDatagramProm.push(ret)
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

    this._sendGroupNum = 1n // 0n is reserved for no sendgroup
  }

  /**
   * @param {NativeHttpWTSession} object
   * @param {boolean} reliable
   */
  setSessionObj(object, reliable) {
    if (object) {
      this.objint = object
      this.objint.jsobj = this
      this.reliable = !!reliable
      if (this.objint.sendInitialParameters) {
        this.objint.sendInitialParameters()
      }
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
   * @param {WebTransportSendStreamOptions} [opts]
   * @returns {Promise<WebTransportBidirectionalStream>}
   */
  createBidirectionalStream(opts) {
    if (this.objint == null) {
      throw new Error('this.objint not set')
    }
    /** @type {Promise<WebTransportBidirectionalStream>} */
    const prom = new Promise((resolve, reject) => {
      this.resolveBiDi.push(resolve)
      this.rejectBiDi.push(reject)
    })
    const notblocked = this.objint.orderBidiStream({
      sendGroup: opts?.sendGroup || null, // maybe replace, when implemented
      sendOrder: opts?.sendOrder || 0n,
      waitUntilAvailable: opts?.waitUntilAvailable || false
    })
    if (!notblocked) {
      const rej = this.rejectBiDi.pop()
      this.resolveBiDi.pop()
      if (rej)
        rej(new DOMException('No streams available', 'QuotaExceededError'))
    }
    return prom
  }

  /**
   * @param {WebTransportSendStreamOptions} [opts]
   * @returns {Promise<WebTransportSendStream>}
   */
  createUnidirectionalStream(opts) {
    if (this.objint == null) {
      throw new Error('this.objint not set')
    }
    /** @type {Promise<WebTransportSendStream>} */
    const prom = new Promise((resolve, reject) => {
      this.resolveUniDi.push(resolve)
      this.rejectUniDi.push(reject)
    })
    const notblocked = this.objint.orderUnidiStream({
      sendGroup: opts?.sendGroup || null, // maybe replace, when implemented
      sendOrder: opts?.sendOrder || 0n,
      waitUntilAvailable: opts?.waitUntilAvailable || false
    })
    if (!notblocked) {
      const rej = this.rejectUniDi.pop()
      this.resolveUniDi.pop()
      if (rej)
        rej(new DOMException('No streams available', 'QuotaExceededError'))
    }
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

  /**
   * @returns {WebTransportSendGroup}
   */
  createSendGroup() {
    if (this.state === 'closed' || this.state === 'failed')
      throw new Error('InvalidState')
    return {
      // @ts-ignore
      _sendGroupId: this._sendGroupNum++,
      getStats: async () => {
        // TODO implement
        return {
          bytesWritten: 0n,
          bytesSent: 0n,
          bytesAcknowledged: 0n
        }
      }
    }
  }

  onReady(/* error */) {
    this.state = 'connected'
    if (!this.reliable) this.reliability = 'supports-unreliable'
    else this.reliability = 'reliable-only'
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
    this.streamObjs.forEach((ele) => ele.finalDrain())

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
      `Session closed (on process ${pid}) with code ` +
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
    } else {
      this.incomDatagramController.enqueue(new Uint8Array(args.datagram))
    }
  }

  /**
   * @param {DatagramSendEvent} args
   */
  // eslint-disable-next-line no-unused-vars
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
  // eslint-disable-next-line no-unused-vars
  onGoAwayReceived(args) {
    if (this.drainingResolve) this.drainingResolve(undefined)
    this.state = 'draining'
  }
}
