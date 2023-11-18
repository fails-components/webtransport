import { Http3EventLoop } from './event-loop.js'
import { wtrouter } from './native.js'
import { WebTransportError } from './error.js'
import { logger } from './utils.js'

const log = logger(`webtransport:http3webtransport(${process.pid})`)

/**
 * @typedef {import('./types').HttpWebTransportInit} HttpWebTransportInit
 */

export class HttpWebTransport {
  /**
   * @param {HttpWebTransportInit} args
   * @param {'server' | 'client'} purpose
   */
  constructor(args, purpose) {
    /** @type {HttpWebTransportInit | undefined} */
    this.args = args
    /** @type {'server' | 'client' | undefined} */
    this.purpose = purpose
    this.sessions = {}
  }

  createTransportInt() {
    if (this.transportInt != null) {
      return
    }
    const eventloop = Http3EventLoop.getGlobalEventLoop(this, {
      quicheLogVerbose: this.args?.quicheLogVerbose
        ? this.args.quicheLogVerbose
        : -1
    }).eventloopInt

    try {
      if (this.purpose === 'server') {
        this.transportInt = new wtrouter.Http3WebTransportServer(
          this.args,
          eventloop
        )
      } else if (this.purpose === 'client') {
        this.transportInt = new wtrouter.Http3WebTransportClient(
          this.args,
          eventloop
        )
      } else {
        throw new Error('unknown purpose')
      }
    } catch (/** @type {any} */ err) {
      const error = new WebTransportError('Opening handshake failed.')
      error.stack = err.stack

      throw error
    }

    delete this.purpose
    delete this.args
    this.transportInt.jsobj = this
  }

  /**
   * @typedef {object} TransportCallbackEvent
   * @property {{ jsobj: { customCallback: (args: any) => void }}} object
   * @property {string} purpose
   *
   * @param {TransportCallbackEvent} args
   */
  static transportCallback(args) {
    log('callback', args?.purpose)
    log.trace(args)
    if (!args || !args.object || !args.object.jsobj)
      throw new Error('Transport callback without jsobj')
    const visitor = args.object.jsobj
    if (args.purpose) {
      if (visitor.customCallback) {
        visitor.customCallback(args)
      } else {
        throw new Error('unknown purpose')
      }
    }
  }
}
