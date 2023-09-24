import { wtrouter, quicheInit } from './native.js'
import { WebTransportError } from './error.js'
import { Http3WebTransportServerSocket } from './http3/serversocket.js'
import { Http3WebTransportClientSocket } from './http3/clientsocket.js'
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
  static quicheInited = false
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

    if (!this.args) return

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
    ) {
      if (!HttpWebTransport.quicheInited) {
        quicheInit({
          quicheLogVerbose: this.args?.quicheLogVerbose
            ? this.args.quicheLogVerbose
            : -1
        })
        HttpWebTransport.quicheInited = true
      }
    }

    try {
      let socket
      if (this.purpose === 'server') {
        // @ts-ignore
        const reliability = this.args?.reliability || 'unreliableOnly'
        switch (reliability) {
          case 'unreliableOnly':
            socket = new Http3WebTransportServerSocket(this.args)
            this.transportInt = new wtrouter.Http3WebTransportServer(this.args)
            this.transportInt.stopServer = socket.stopServer.bind(socket)
            socket.init()
            break
          case 'reliableOnly':
            // @ts-ignore
            this.transportInt = new Http2WebTransportServer(this.args)
            break
          case 'both':
            {
              socket = new Http3WebTransportServerSocket(this.args)
              const server3 = new wtrouter.Http3WebTransportServer(this.args)
              server3.stopServer = socket.stopServer.bind(socket)
              socket.init()
              this.transportInt = new TransportIntServerProxy([
                // @ts-ignore
                new Http2WebTransportServer(this.args),
                server3
              ])
            }
            break
        }
      } else if (this.purpose === 'client') {
        // @ts-ignore
        if (this.args?.forceReliable) {
          // internal option for unit tests only
          // @ts-ignore
          this.transportInt = new Http2WebTransportClient(this.args)
        } else {
          socket = new Http3WebTransportClientSocket(this.args)
          this.transportInt = new wtrouter.Http3WebTransportClient(this.args)
          this.transportInt.closeClientInt = this.transportInt.closeClient
          this.transportInt.closeClient = socket.closeClient.bind(socket)
          socket.init()
          if (!this.args?.requireUnreliable) {
            const args = this.args
            this.transportIntSwitchToReliable = () => {
              if (this.transportInt != null) {
                this.transportInt.closeClient()
              }
              // @ts-ignore
              this.transportInt = new Http2WebTransportClient(args)
              this.transportInt.jsobj = this
              if (this.transportInt.createTransport) {
                this.transportInt.createTransport()
              }
            }
          }
        }
      } else {
        throw new Error('unknown purpose')
      }
      if (socket) {
        socket.cobj = this.transportInt
        // @ts-ignore
        socket.jsobj = this
        this.transportInt.socket = socket
      }
    } catch (/** @type {any} */ err) {
      const error = new WebTransportError('Opening handshake failed.')
      error.stack = err.stack

      throw error
    }

    delete this.purpose
    delete this.args
    this.transportInt.jsobj = this
    if (this.transportInt.createTransport) {
      this.transportInt.createTransport()
    }
  }
}
