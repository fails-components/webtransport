import { Http3EventLoop } from './event-loop.js'
import { wtrouter } from './native.js'
import { WebTransportError } from './error.js'

/**
 * @typedef {import('./types').Http3WebTransportInit} Http3WebTransportInit
 */

export class Http3WebTransport {
  /**
   * @param {Http3WebTransportInit} args
   * @param {'server' | 'client'} purpose
   */
  constructor(args, purpose) {
    /** @type {Http3WebTransportInit | undefined} */
    this.args = args
    /** @type {'server' | 'client' | undefined} */
    this.purpose = purpose
    this.sessions = {}
  }

  createTransportInt() {
    if (this.transportInt != null) {
      return
    }

    const eventloop = Http3EventLoop.getGlobalEventLoop(this).eventloopInt

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
    // console.log('incoming callback transport', args)
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
