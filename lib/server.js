import { Http3WebTransport } from './transport.js'
import { ReadableStream } from 'node:stream/web'
import { Http3WTSession } from './session.js'

/**
 * @typedef {import('./types').WebTransportSession} WebTransportSession
 * @typedef {import('./types').NativeHttp3WTSession} NativeHttp3WTSession
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
   * @typedef {object} Http3WTSessionVisitor
   * @property {'Http3WTSessionVisitor'} purpose
   * @property {any} object
   * @property {NativeHttp3WTSession} session
   * @property {string} path
   *
   * @param {Http3WTSessionVisitor} args
   */
  customCallback(args) {
    // console.log('incoming callback server', args)
    if (args.purpose) {
      switch (args.purpose) {
        case 'Http3WTSessionVisitor':
          // create Http3 Visitor
          if (args.object) {
            const sesobj = new Http3WTSession({
              object: args.session,
              parentobj: this
            })
            if (this.sessionController[args.path])
              this.sessionController[args.path].enqueue(sesobj)
          } else throw new Error('Http3WTSessionVisitor')

          break

        default: {
          throw new Error('unknown purpose')
        }
      }
    }
  }
}
