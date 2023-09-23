import { HttpWebTransport } from './transport.js'
import { ReadableStream } from 'node:stream/web'
import { HttpWTSession } from './session.js'
import { isIPv4 } from 'net'
import { defer, logger } from './utils.js'

const log = logger(`webtransport:httpxserver(${process.pid})`)

/**
 * @typedef {import('./types').WebTransportSession} WebTransportSession
 * @typedef {import('./types').NativeHttpWTSession} NativeHttpWTSession
 * @typedef {import('./types').HttpServerEventHandler} HttpServerEventHandler
 * @typedef {import('./types').HttpWTServerSessionVisitorEvent} HttpWTServerSessionVisitorEvent
 * @typedef {import('./types').HttpServerListeningEvent} HttpServerListeningEvent
 * @typedef {import('./types').ServerSessionRequestEvent} ServerSessionRequestEvent
 * @typedef {import('./types').HttpServerInit} HttpServerInit
 */

/**
 * @implements {HttpServerEventHandler}
 */
export class HttpServer extends HttpWebTransport {
  /**
   *
   * @param {HttpServerInit} args
   */
  constructor(args) {
    super(args, 'server')

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
    if (this.transportInt.startServer) this.transportInt.startServer()
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
    if (args.object) {
      const sesobj = new HttpWTSession({
        object: args.session,
        header: args.header,
        parentobj: this
      })
      if (this.sessionController[args.path])
        this.sessionController[args.path].enqueue(sesobj)
    } else throw new Error('HttpWTSessionVisitor')
  }

  /**
   * @param {Error} [error]
   */
  onServerError(error) {
    this._ready.reject(error)
  }

  /**
   * @param {HttpServerListeningEvent} evt
   */
  onServerListening(evt) {
    if (evt.host) this.host = evt.host
    if (evt.port) this.port = evt.port
    this._ready.resolve()
  }

  /**
   */
  onServerClose() {
    this._closed.resolve()
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
