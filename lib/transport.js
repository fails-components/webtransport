import { logger } from './utils.js'

const log = logger(`webtransport:http3webtransport(${process?.pid})`)

/**
 * @typedef {import('./types').HttpServerInit} HttpServerInit
 * @typedef {import('./types').HttpClientInit} HttpClientInit
 */

export class HttpWebTransport {
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
