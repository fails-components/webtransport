import { createSocket } from 'node:dgram'
import { lookup } from 'node:dns/promises'

import { logger } from '../utils.js'
import { Http3WebTransportSocket } from './socket.js'

const log = logger(`webtransport:Http3WebTransportClientSocket(${process.pid})`)

export class Http3WebTransportClientSocket extends Http3WebTransportSocket {
  /**
   * @param {import('../types.js').HttpWebTransportInit} args
   */
  constructor(args) {
    super(args)
    let port = args?.port
    if (typeof port === 'undefined') port = 443
    this.port = Number(port)
    this.host = args?.host || 'localhost'
    this.localPort = args?.localPort
    this.forceIpv6 = args?.forceIpv6 || false
    /** @type {import('../session.js').HttpClient} */
    // @ts-ignore
    this.jsobj = undefined // the transport will set this

    this.args = args
  }

  init() {
    lookup(this.host)
      .then((result) => {
        this.address = result
        this.cobj.setHostname({
          ...this.args,
          serveraddress: result.address,
          port: Number(this.args.port)
        })
        // @ts-ignore
        delete this.args
        this.socketInt = createSocket({
          type: result.family === 4 ? 'udp4' : 'udp6',
          ipv6Only: this.forceIpv6
        })

        this.socketInt.on('error', (evt) => {
          this.jsobj.onClientError({ errorcode: 100, error: evt.toString() })
        })

        this.socketInt.on('close', () => {
          //
        })
        this.socketInt.on('message', (msg, rinfo) => {
          this.cobj.recvPaket({
            msg,
            rinfo,
            selfaddress: this.socketInt.address()
          })
        })
        this.socketInt.bind(this.localPort)
        setImmediate(() => this.cobj.onCanWrite())
      })
      .catch((error) => {
        log('Problem client:', error)
        // hostname not known
        this.jsobj.onClientError({
          errorcode: 100,
          error: 'Problem resolving hostname'
        })
      })
  }

  closeClient() {
    process.nextTick(() => {
      // TODO call close on all sessions
      this.cobj.closeClientInt()
      // close socket after sending close frames
      this.socketInt.close()
      this.closed = true
    })
  }
}
