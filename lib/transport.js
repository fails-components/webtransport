import { Http3EventLoop } from './event-loop.js'
import { wtrouter } from './native.js'

export class Http3WebTransport {
  /**
   * @param {*} args
   * @param {'server' | 'client'} purpose
   */
  constructor(args, purpose) {
    const eventloop = Http3EventLoop.getGlobalEventLoop(this, {
      quicheLogVerbose: args.quicheLogVerbose
    }).eventloopInt

    if (purpose === 'server')
      this.transportInt = new wtrouter.Http3WebTransportServer(args, eventloop)
    else if (purpose === 'client')
      this.transportInt = new wtrouter.Http3WebTransportClient(args, eventloop)
    else throw new Error('unknown purpose')
    this.transportInt.jsobj = this

    this.sessions = {}
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
