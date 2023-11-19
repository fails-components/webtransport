import { createSocket } from 'node:dgram'
import { lookup } from 'node:dns/promises'

import { logger } from '../utils.js'
import { Http3WebTransportSocket } from './socket.js'

const log = logger(`webtransport:Http3WebTransportServerSocket(${process.pid})`)

export class Http3WebTransportServerSocket extends Http3WebTransportSocket {
  /**
   * @param {import('../types.js').Http3WebTransportInit|undefined} args
   */
  constructor(args) {
    super(args)
    this.port = Number(args?.port || 443)
    this.host = args?.host || 'localhost'
    /** @type {import('../session.js').Http3Server} */
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

        this.socketInt.on('error', () => {
          this.jsobj.onServerError()
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
        this.jsobj.onServerError()
      })
  }

  stopServer() {
    this.cobj.destroy()
    this.socketInt.close()
    this.closed = true
    // TODO call close on all sessions
  }
}