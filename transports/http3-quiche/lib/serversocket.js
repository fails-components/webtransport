import { createSocket } from 'node:dgram'
import { lookup } from 'node:dns/promises'

import { logger } from './utils.js'
import { Http3WebTransportSocket } from './socket.js'

const log = logger(`webtransport:Http3WebTransportServerSocket(${process.pid})`)

export class Http3WebTransportServerSocket extends Http3WebTransportSocket {
  /**
   * @param {import('../../../main/lib/types.js').HttpWebTransportInit|undefined} args
   */
  constructor(args) {
    super(args)
    let port = args?.port
    if (typeof port === 'undefined') port = 443
    this.port = Number(port)
    this.host = args?.host || 'localhost'
    /** @type {import('../../../main/lib/session.js').HttpServer} */
    // @ts-ignore
    this.jsobj = undefined // the transport will set this

    /** @type {import('node:dns').LookupAddress|undefined} */
    this.address = undefined
  }

  init() {
    lookup(this.host)
      .then((result) => {
        this.address = result
        this.socketInt = createSocket({
          type: result.family === 4 ? 'udp4' : 'udp6'
        })

        this.socketInt.on('listening', () => {
          const addr = this.socketInt.address()
          const retObj = {
            port: addr?.port,
            host: addr?.address
          }
          this.jsobj.onServerListening(retObj)
        })

        this.socketInt.on('error', (error) => {
          this.jsobj.onServerError(error)
        })

        this.socketInt.on('close', () => {
          this.jsobj.onServerClose()
        })

        this.socketInt.on('message', (msg, rinfo) => {
          // console.log('srv msg', msg, rinfo)
          const haschlos = this.cobj.recvPaket({
            msg,
            rinfo,
            selfaddress: this.socketInt.address()
          })
          if (!this.chlosSched && haschlos) {
            setImmediate(this.doProcessBufferedChlos)
            this.chlosSched = true
          }
        })
        this.socketInt.bind(this.port, this.address?.address)
        this.cobj.onCanWrite()
      })
      .catch((error) => {
        log('Problem server:', error)
        // hostname not known
        this.jsobj.onServerError(error)
      })
  }

  stopServer() {
    this.cobj.destroy()
    this.socketInt.close()
    this.closed = true
    // TODO call close on all sessions
  }
}
