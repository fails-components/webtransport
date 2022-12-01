import { ReadableStream, WritableStream } from 'node:stream/web'
import { Http3WTStream } from './stream.js'
import { WebTransportError } from './error.js'

/**
 * WebTransport session events
 * @typedef {import('./types').WebTransportSessionEventHandler} WebTransportSessionEventHandler
 * @typedef {import('./types').SessionReadyEvent} SessionReadyEvent
 * @typedef {import('./types').SessionCloseEvent} SessionCloseEvent
 * @typedef {import('./types').DatagramReceivedEvent} DatagramReceivedEvent
 * @typedef {import('./types').DatagramSendEvent} DatagramSendEvent
 * @typedef {import('./types').NewStreamEvent} NewStreamEvent
 *
 * @typedef {import('./dom').WebTransportCloseInfo} WebTransportCloseInfo
 * @typedef {import('./dom').WebTransportBidirectionalStream} WebTransportBidirectionalStream
 * @typedef {import('./dom').WebTransportSendStream} WebTransportSendStream
 * @typedef {import('./dom').WebTransportDatagramDuplexStream} WebTransportDatagramDuplexStream
 * @typedef {import('./dom').WebTransportReceiveStream} WebTransportReceiveStream
 *
 * @typedef {import('./types').NativeHttp3WTSession} NativeHttp3WTSession
 *
 * Public API
 * @typedef {import('./types').WebTransportSession} WebTransportSession
 *
 * @typedef {import('./server').Http3Server} Http3Server
 * @typedef {import('./client').Http3Client} Http3Client
 *
 * @typedef {import('stream/web').WritableStreamDefaultController} WritableStreamDefaultController
 */

/**
 * @implements {WebTransportSessionEventHandler}
 * @implements {WebTransportSession}
 */
export class Http3WTSession {
  /**
   * @param {object} args
   * @param {import('./types').NativeHttp3WTSession} [args.object]
   * @param {Http3Server | Http3Client} args.parentobj
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
    /** @type {Promise<WebTransportCloseInfo>} */
    this.closed = new Promise((resolve, reject) => {
      this.closedResolve = resolve
      this.closedReject = reject
    })

    /** @type {ReadableStream<Http3WTStream>} */
    this.incomingBidirectionalStreams = new ReadableStream({
      start: (controller) => {
        this.incomBiDiController = controller
      }
    })

    /** @type {ReadableStream<WebTransportReceiveStream>} */
    this.incomingUnidirectionalStreams = new ReadableStream({
      start: (controller) => {
        this.incomUniDiController = controller
      }
    })

    /** @type {Array<() => void>} */
    this.writeDatagramRes = []
    /** @type {Array<() => void>} */
    this.writeDatagramRej = []
    /** @type {Array<Promise<void>>} */
    this.writeDatagramProm = []

    /** @type {WebTransportDatagramDuplexStream} */
    this.datagrams = {
      readable: new ReadableStream({
        start: (controller) => {
          this.incomDatagramController = controller
        }
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
            // console.log('b4 datagram write', chunk, Date.now())
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

    this.sendStreams = new Set()
    this.receiveStreams = new Set()
    /** @type {Set<Http3WTStream>} */
    this.streamObjs = new Set()

    /** @type {Set<WritableStreamDefaultController>} */
    this.sendStreamsController = new Set()
    /** @type {Set<ReadableStreamDefaultController>} */
    this.receiveStreamsController = new Set()
  }

  /**
   * @param {NativeHttp3WTSession} object
   */
  setSessionObj(object) {
    if (object) {
      this.objint = object
      this.objint.jsobj = this
    }
  }

  async waitForDatagramsSend() {
    while (this.writeDatagramProm.length > 0) {
      try {
        await Promise.allSettled(this.writeDatagramProm)
      } catch (error) {
        console.log('datagram promise failed ', error)
      }
    }
  }

  /**
   * @param {Http3WTStream} stream
   */
  addStreamObj(stream) {
    this.streamObjs.add(stream)
  }

  /**
   * @param {Http3WTStream} stream
   */
  removeStreamObj(stream) {
    this.streamObjs.delete(stream)
  }

  /**
   * @param {WritableStream} stream
   * @param {WritableStreamDefaultController} controller
   */
  addSendStream(stream, controller) {
    this.sendStreams.add(stream)
    this.sendStreamsController.add(controller)
  }

  /**
   * @param {WritableStream} stream
   * @param {WritableStreamDefaultController} controller
   */
  removeSendStream(stream, controller) {
    this.sendStreams.delete(stream)
    this.sendStreamsController.delete(controller)
  }

  /**
   * @param {ReadableStream} stream
   * @param {ReadableStreamDefaultController} controller
   */
  addReceiveStream(stream, controller) {
    this.receiveStreams.add(stream)
    this.receiveStreamsController.add(controller)
  }

  /**
   * @param {ReadableStream} stream
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
    // console.log('closeinfo', closeInfo)
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
    if (this.readyResolve) this.readyResolve()
    delete this.readyResolve
  }

  /**
   * @param {SessionCloseEvent} args
   */
  onClose(args) {
    delete this.objint // not valid any more

    if (this.state !== 'connected') {
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

    // console.log('onClose')
    for (const rej of this.rejectBiDi) rej()
    for (const rej of this.rejectUniDi) rej()
    for (const rej of this.writeDatagramRej) rej()
    this.writeDatagramRej = []
    this.writeDatagramRes = []
    this.writeDatagramProm = []
    this.resolveBiDi = []
    this.resolveUniDi = []
    this.rejectBiDi = []
    this.rejectUniDi = []

    this.incomBiDiController.close()
    this.incomUniDiController.close()
    this.incomDatagramController.close()
    // this.outgoDatagramController.error(errorcode)
    this.state = 'closed'

    this.sendStreamsController.forEach((ele) => ele.error(args.errorcode))
    this.receiveStreamsController.forEach((ele) => ele.error(args.errorcode))
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
    const strobj = new Http3WTStream({
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
    // console.log('datagram received', args.datagram, Date.now())
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
   * @param {SessionReadyEvent | SessionCloseEvent | DatagramReceivedEvent | DatagramSendEvent | NewStreamEvent} args
   */
  static callback(args) {
    // console.log('Session callback called', args)
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
