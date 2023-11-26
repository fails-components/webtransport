import { wtrouter, quicheInit } from './native.js'
import { WebTransportError } from './error.js'
import { Http3WebTransportServerSocket } from './http3/serversocket.js'
import { Http3WebTransportClientSocket } from './http3/clientsocket.js'

/**
 * @typedef {import('./types').Http3WebTransportInit} Http3WebTransportInit
 */

export class Http3WebTransport {
  static quicheInited = false
  /**
   * @param {Http3WebTransportInit} args
   * @param {'server' | 'client'} purpose
   */
  constructor(args, purpose) {
    /** @type {Http3WebTransportInit|undefined} */
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

    if (!Http3WebTransport.quicheInited) {
      quicheInit({
        quicheLogVerbose: this.args?.quicheLogVerbose
          ? this.args.quicheLogVerbose
          : -1
      })
      Http3WebTransport.quicheInited = true
    }

    try {
      let socket
      if (this.purpose === 'server') {
        socket = new Http3WebTransportServerSocket(this.args)
        this.transportInt = new wtrouter.Http3WebTransportServer(this.args)
        this.transportInt.stopServer = socket.stopServer.bind(socket)
        socket.init()
      } else if (this.purpose === 'client') {
        socket = new Http3WebTransportClientSocket(this.args)
        this.transportInt = new wtrouter.Http3WebTransportClient(this.args)
        this.transportInt.closeClientInt = this.transportInt.closeClient
        this.transportInt.closeClient = socket.closeClient.bind(socket)
        socket.init()
      } else {
        throw new Error('unknown purpose')
      }
      socket.cobj = this.transportInt
      // @ts-ignore
      socket.jsobj = this
      this.transportInt.socket = socket
    } catch (/** @type {any} */ err) {
      const error = new WebTransportError('Opening handshake failed.')
      error.stack = err.stack

      throw error
    }

    delete this.purpose
    delete this.args
    this.transportInt.jsobj = this
  }
}
