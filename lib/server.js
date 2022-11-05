import { Http3WebTransport } from './transport.js'
import { ReadableStream } from 'node:stream/web'
import { Http3WTSession } from './session.js'
import { isIPv4 } from 'net'
import { defer } from './utils.js'

/**
 * @typedef {import('./types').WebTransportSession} WebTransportSession
 * @typedef {import('./types').NativeHttp3WTSession} NativeHttp3WTSession
 * @typedef {import('./types').Http3ServerEventHandler} Http3ServerEventHandler
 * @typedef {import('./types').Http3WTServerSessionVisitorEvent} Http3WTServerSessionVisitorEvent
 * @typedef {import('./types').Http3ServerListeningEvent} Http3ServerListeningEvent
 * @typedef {import('./types').Http3ServerCloseEvent} Http3ServerCloseEvent
 * @typedef {import('./types').Http3ServerErrorEvent} Http3ServerErrorEvent
 */

/**
 * @implements {Http3ServerEventHandler}
 */
export class Http3Server extends Http3WebTransport {
  /**
   *
   * @param {*} args
   */
  constructor(args) {
    super(args, 'server')

    /** @type {Record<string, ReadableStream>} */
    this.sessionStreams = {}

    /** @type {Record<string, ReadableStreamController<any>>} */
    this.sessionController = {}

    this._ready = defer()
    this.ready = this._ready.promise

    this._closed = defer()
    this.closed = this._closed.promise
  }

  startServer() {
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
  address () {
    if (this.transportInt.port == null) {
      console.info('returning numll')
      return null
    }

    return {
      port: this.transportInt.port,
      host: this.transportInt.host,
      family: isIPv4(this.transportInt.host) ? 'IPv4' : 'IPv6'
    }
  }

  /**
   * @param {string} path
   * @returns {ReadableStream<WebTransportSession>}
   */
  sessionStream(path) {
    if (path in this.sessionStreams) {
      return this.sessionStreams[path]
    }
    this.sessionStreams[path] = new ReadableStream({
      start: async (controller) => {
        this.sessionController[path] = controller
      }
    })
    this.transportInt.addPath(path)
    return this.sessionStreams[path]
  }

  /**
   * @param {Http3WTServerSessionVisitorEvent} args
   */
  onHttp3WTSessionVisitor(args) {
    // create Http3 Visitor
    if (args.object) {
      const sesobj = new Http3WTSession({
        object: args.session,
        parentobj: this
      })
      if (this.sessionController[args.path])
        this.sessionController[args.path].enqueue(sesobj)
    } else throw new Error('Http3WTSessionVisitor')
  }

  /**
   * @param {Http3ServerErrorEvent} evt
   */
  onHttp3ServerError(evt) {
    this._ready.reject()
  }

  /**
   * @param {Http3ServerListeningEvent} evt
   */
  onHttp3ServerListening(evt) {
    this._ready.resolve()
  }

  /**
   * @param {Http3ServerCloseEvent} evt
   */
  onHttp3ServerClose(evt) {
    this._closed.resolve()
  }

  /**
   * @param {Http3WTServerSessionVisitorEvent | Http3ServerErrorEvent | Http3ServerListeningEvent | Http3ServerCloseEvent} args
   */
  customCallback(args) {
    // console.log('incoming callback server', args)
    if (args.purpose) {
      switch (args.purpose) {
        case 'Http3WTSessionVisitor':
          this.onHttp3WTSessionVisitor(args)
          break
        case 'Http3ServerListening':
          this.onHttp3ServerListening(args)
          break
        case 'Http3ServerClose':
          this.onHttp3ServerClose(args)
          break
        case 'Http3ServerError':
          this.onHttp3ServerError(args)
          break

        default: {
          throw new Error('unknown purpose')
        }
      }
    }
  }
}
