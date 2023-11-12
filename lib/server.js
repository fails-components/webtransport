import { Http3EventLoop } from './event-loop.js'
import { ReadableStream } from 'node:stream/web'
import { HttpWTSession } from './session.js'
import { wtrouter } from './native.js'
import { WebTransportError } from './error.js'
import { Http2WebTransportServer } from './http2/server.js'
import { isIPv4 } from 'net'
import { defer, logger } from './utils.js'

const log = logger(`webtransport:httpserver(${process?.pid})`)

/**
 * @typedef {import('./types').WebTransportSession} WebTransportSession
 * @typedef {import('./types').NativeHttpWTSession} NativeHttpWTSession
 * @typedef {import('./types').HttpServerEventHandler} HttpServerEventHandler
 * @typedef {import('./types').HttpWTServerSessionVisitorEvent} HttpWTServerSessionVisitorEvent
 * @typedef {import('./types').ServerStatusEvent} ServerStatusEvent
 * @typedef {import('./types').ServerSessionRequestEvent} ServerSessionRequestEvent
 * @typedef {import('./types').HttpServerInit} HttpServerInit
 */

// @ts-ignore
class TransportIntServerProxy {
  /**
   * @param {Array<any>} transportInts
   * */
  constructor(transportInts) {
    this.transportsInts = new Set(transportInts)
  }

  startServer() {
    this.transportsInts.forEach((transport) => transport.startServer())
  }

  stopServer() {
    this.transportsInts.forEach((transport) => transport.stopServer())
  }

  /**
   * @param {boolean} hasHandler
   */
  setJSRequestHandler(hasHandler) {
    this.transportsInts.forEach((transport) =>
      transport.setJSRequestHandler(hasHandler)
    )
  }

  /**
   * @param {string} path
   */
  addPath(path) {
    this.transportsInts.forEach((transport) => transport.addPath(path))
  }
}

/**
 * @implements {HttpServerEventHandler}
 */
export class HttpServer {
  /**
   *
   * @param {HttpServerInit} args
   */
  constructor(args) {
    this.args = args
    /** @type {Record<string, ReadableStream>} */
    this.sessionStreams = {}

    /** @type {Record<string, ReadableStreamDefaultController<HttpWTSession>>} */
    this.sessionController = {}

    this.port = null
    this.host = null

    // FIX ME TYPE
    /** @type {any} */
    this.requestHandler = null

    this._ready = defer()
    this.ready = this._ready.promise

    this._closed = defer()
    this.closed = this._closed.promise
    /**
     * @type {string[]}
     */
    this._pendingPaths = []

    /**
     * @type {undefined|boolean}
     */
    this._pendingRequestCallback = undefined
  }

  startServer() {
    this.createTransportInt()
    this.transportInt.startServer()
    while (this._pendingPaths.length > 0) {
      const path = this._pendingPaths.shift()
      this.transportInt.addPath(path)
    }
    if (typeof this._pendingRequestCallback !== 'undefined') {
      this.transportInt.setJSRequestHandler(this._pendingRequestCallback)
      delete this._pendingRequestCallback
    }
  }

  stopServer() {
    this.transportInt.stopServer()
    for (const i in this.sessionController) {
      this.sessionController[i].close() // inform the controller, that we are closing
      delete this.sessionController[i]
    }
    this.stopped = true
  }

  /**
   * @returns {{ port: number, host: string, family: 'IPv4' | 'IPv6' } | null}
   */
  address() {
    if (this.port == null || this.host == null) {
      console.info('returning null')
      return null
    }

    return {
      port: this.port,
      host: this.host,
      family: isIPv4(this.host) ? 'IPv4' : 'IPv6'
    }
  }

  /**
   * @param {any} callback
   */
  setRequestCallback(callback) {
    this.requestHandler = callback

    this.transportInt.setJSRequestHandler(!!callback)
    if (this.transportInt) this.transportInt.setJSRequestHandler(!!callback)
    else this._pendingRequestCallback = !!callback
  }

  /**
   * @param {string} path
   * @param {object} [args]
   * @param {boolean} [args.noAutoPaths]
   * @returns {ReadableStream<WebTransportSession>}
   */
  sessionStream(path, args) {
    if (path in this.sessionStreams) {
      return this.sessionStreams[path]
    }
    this.sessionStreams[path] = new ReadableStream({
      start: async (controller) => {
        this.sessionController[path] = controller
      }
    })
    if (!args || !args.noAutoPaths) {
      if (this.transportInt) this.transportInt.addPath(path)
      else this._pendingPaths.push(path)
    }
    return this.sessionStreams[path]
  }

  /**
   * @param {ServerSessionRequestEvent} args
   */
  onSessionRequest(args) {
    if (args.promise && args.header) {
      if (!this.requestHandler) throw new Error('Request handler not set')
      this.requestHandler({ header: args.header })
        .then((/** @type {any} */ result) => {
          log('oSR', result)
          args.object.finishSessionRequest({
            promise: args.promise,
            header: args.header,
            session: args.session,
            head: args.head,
            ...result
          })
        })
        .catch((/** @type {any} */ err) => {
          log.error(err)
        })
    } else throw new Error('onSessionRequest')
  }

  /**
   * @param {HttpWTServerSessionVisitorEvent} args
   */
  onHttpWTSessionVisitor(args) {
    // create Http3 Visitor
    const sesobj = new HttpWTSession({
      object: args.session,
      header: args.header,
      parentobj: this
    })
    args.session.jsobj = sesobj
    if (this.sessionController[args.path])
      this.sessionController[args.path].enqueue(sesobj)
  }

  /**
   */
  onServerError() {
    this._ready.reject()
  }

  /**
   */
  onServerListening() {
    this._ready.resolve()
  }

  /**
   */
  onServerClose() {
    this._closed.resolve()
  }

  /**
   * @param {ServerStatusEvent} evt
   */
  onServerStatus(evt) {
    if (evt.host) this.host = evt.host
    if (evt.port) this.port = evt.port

    switch (evt.status) {
      case 'close':
        this.onServerClose()
        break
      case 'listening':
        this.onServerListening()
        break
      case 'error':
        this.onServerError()
        break
      default: {
        throw new Error('unknown status')
      }
    }
  }

  /**
   * @param{{path: string} |undefined} [args]
   **/
  createTransportInt(args) {
    if (this.transportInt != null) {
      return
    }
    let eventloop
    if (
      this.args &&
      // @ts-ignore
      (this.args?.reliability === 'unreliableOnly' ||
        // @ts-ignore
        typeof this.args?.reliability === 'undefined' ||
        // @ts-ignore
        this.args?.reliability === 'both')
    )
      eventloop = Http3EventLoop.getGlobalEventLoop(this, {
        quicheLogVerbose: this.args?.quicheLogVerbose
          ? this.args.quicheLogVerbose
          : -1
      }).eventloopInt

    try {
      // @ts-ignore
      const reliability = this.args?.reliability || 'unreliableOnly'
      switch (reliability) {
        case 'unreliableOnly':
          this.transportInt = new wtrouter.Http3WebTransportServer(
            this.args,
            eventloop
          )
          break
        case 'reliableOnly':
          // @ts-ignore
          this.transportInt = new Http2WebTransportServer(this.args)
          break
        case 'both':
          this.transportInt = new TransportIntServerProxy([
            // @ts-ignore
            new Http2WebTransportServer(this.args),
            new wtrouter.Http3WebTransportServer(this.args, eventloop)
          ])
          break
      }
    } catch (/** @type {any} */ err) {
      const error = new WebTransportError('Opening handshake failed.')
      error.stack = err.stack

      throw error
    }

    this.transportInt.jsobj = this
    if (this.transportInt.createTransport) {
      this.transportInt.createTransport()
    }
  }

  /**
   * @param {HttpWTServerSessionVisitorEvent | ServerStatusEvent | ServerSessionRequestEvent} args
   */
  customCallback(args) {
    log('callback', args?.purpose)
    log.trace(args)
    if (args.purpose) {
      switch (args.purpose) {
        case 'SessionRequest':
          this.onSessionRequest(args)
          break
        case 'Http2WTSessionVisitor':
        case 'Http3WTSessionVisitor':
          this.onHttpWTSessionVisitor(args)
          break
        case 'ServerStatus':
          this.onServerStatus(args)
          break
        default: {
          throw new Error('unknown purpose')
        }
      }
    }
  }
}

export class Http3Server extends HttpServer {
  /**
   *
   * @param {HttpServerInit} args
   */
  constructor(args) {
    super({ ...args, reliability: 'unreliableOnly' })
  }
}

export class Http2Server extends HttpServer {
  /**
   *
   * @param {HttpServerInit} args
   */
  constructor(args) {
    super({ ...args, reliability: 'reliableOnly' })
  }
}
