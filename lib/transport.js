import { Http3EventLoop } from './event-loop.js'
import { wtrouter } from './native.js'
import { WebTransportError } from './error.js'
import { logger } from './utils.js'
import { Http2WebTransportServer } from './http2/server.js'
import { Http2WebTransportClient } from './http2/client.js'

const log = logger(`webtransport:http3webtransport(${process.pid})`)

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
 * @typedef {import('./types').HttpServerInit} HttpServerInit
 * @typedef {import('./types').HttpClientInit} HttpClientInit
 */

export class HttpWebTransport {
  /**
   * @param {HttpServerInit | HttpClientInit} args
   * @param {'server' | 'client'} purpose
   */
  constructor(args, purpose) {
    /** @type {HttpServerInit | HttpClientInit | undefined} */
    this.args = args
    /** @type {'server' | 'client' | undefined} */
    this.purpose = purpose
    this.sessions = {}
  }

  createTransportInt() {
    if (this.transportInt != null) {
      return
    }
    let eventloop
    if (
      // @ts-ignore
      (this.purpose === 'client' && !this.args?.forceReliable) ||
      (this.purpose === 'server' &&
        this.args &&
        // @ts-ignore
        (this.args?.reliability === 'unreliableOnly' ||
          // @ts-ignore
          typeof this.args?.reliability === 'undefined' ||
          // @ts-ignore
          this.args?.reliability === 'both'))
    )
      eventloop = Http3EventLoop.getGlobalEventLoop(this, {
        quicheLogVerbose: this.args?.quicheLogVerbose
          ? this.args.quicheLogVerbose
          : -1
      }).eventloopInt

    try {
      if (this.purpose === 'server') {
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
      } else if (this.purpose === 'client') {
        // @ts-ignore
        if (this.args?.forceReliable) {
          // internal option for unit tests only
          // @ts-ignore
          this.transportInt = new Http2WebTransportClient(this.args)
        } else {
          this.transportInt = new wtrouter.Http3WebTransportClient(
            this.args,
            eventloop
          )
          if (!this.args?.requireUnreliable) {
            this.transportIntSwitchToReliable = () => {
              if (this.transportInt != null) {
                this.transportInt.closeClient()
              }
              // @ts-ignore
              this.transportInt = new Http2WebTransportClient(this.args)
            }
          }
        }
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
