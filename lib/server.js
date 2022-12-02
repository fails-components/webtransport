import { Http3WebTransport } from './transport.js'
import { ReadableStream } from 'node:stream/web'
import { Http3WTSession } from './session.js'
import { isIPv4 } from 'net'
import { defer, logger } from './utils.js'

const log = logger('webtransport:http3server')

/**
 * @typedef {import('./types').WebTransportSession} WebTransportSession
 * @typedef {import('./types').NativeHttp3WTSession} NativeHttp3WTSession
 * @typedef {import('./types').Http3ServerEventHandler} Http3ServerEventHandler
 * @typedef {import('./types').Http3WTServerSessionVisitorEvent} Http3WTServerSessionVisitorEvent
 * @typedef {import('./types').ServerStatusEvent} ServerStatusEvent
 * @typedef {import('./types').ServerSessionRequestEvent} ServerSessionRequestEvent
 * @typedef {import('./types').Http3ServerInit} Http3ServerInit
 */

/**
 * @implements {Http3ServerEventHandler}
 */
export class Http3Server extends Http3WebTransport {
  /**
   *
   * @param {Http3ServerInit} args
   */
  constructor(args) {
    super(args, 'server')

    /** @type {Record<string, ReadableStream>} */
    this.sessionStreams = {}

    /** @type {Record<string, ReadableStreamController<Http3WTSession>>} */
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
  }

  startServer() {
    this.createTransportInt()
    this.transportInt.startServer()
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
    if (!args || !args.noAutoPaths) this.transportInt.addPath(path)
    return this.sessionStreams[path]
  }

  /**
   * @param {ServerSessionRequestEvent} args
   */
  onSessionRequest(args) {
    if (args.promise && args.header) {
      if (!this.requestHandler) throw new Error('Request handler not set')
      this.requestHandler({ header: args.header }).then(
        (/** @type {any} */ result) => {
          log('oSR', result)
          this.transportInt.finishSessionRequest({
            promise: args.promise,
            header: args.header,
            session: args.session,
            ...result
          })
        }
      )
    } else throw new Error('onSessionRequest')
  }

  /**
   * @param {Http3WTServerSessionVisitorEvent} args
   */
  onHttp3WTSessionVisitor(args) {
    // create Http3 Visitor
    if (args.object) {
      const sesobj = new Http3WTSession({
        object: args.session,
        header: args.header,
        parentobj: this
      })
      if (this.sessionController[args.path])
        this.sessionController[args.path].enqueue(sesobj)
    } else throw new Error('Http3WTSessionVisitor')
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
        this.onServerListening()
        break
      default: {
        throw new Error('unknown status')
      }
    }
  }

  /**
   * @param {Http3WTServerSessionVisitorEvent | ServerStatusEvent | ServerSessionRequestEvent} args
   */
  customCallback(args) {
    log('incoming callback server', args?.purpose)
    log.trace(args)
    if (args.purpose) {
      switch (args.purpose) {
        case 'SessionRequest':
          this.onSessionRequest(args)
          break
        case 'Http3WTSessionVisitor':
          this.onHttp3WTSessionVisitor(args)
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
