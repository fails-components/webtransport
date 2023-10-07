import { createSocket } from 'node:dgram'
import { lookup } from 'node:dns/promises'

import { logger } from '../utils.js'

const log = logger(`webtransport:Http3WebTransportServerSocket(${process.pid})`)

export class Http3WebTransportServerSocket {
  /**
   * @param {import('../types.js').Http3WebTransportInit} args
   */
  constructor(args) {
    this.port = Number(args?.port || 443)
    this.host = args?.host || 'localhost'
    /** @type {import('../session.js').Http3Server} */
    // @ts-ignore
    this.jsobj = undefined // the transport will set this
    // @ts-ignore
    this.cobj = undefined // the transport will set this

    /** @type {import('node:dns').LookupAddress|undefined} */
    this.address = undefined

    this.chlosSched = false

    lookup(this.host)
      .then((result) => {
        this.address = result
        // @ts-ignore
        this.serverInt = createSocket({
          type: result.family === 4 ? 'udp4' : 'udp6'
        })

        this.serverInt.on('listening', () => {
          const addr = this.serverInt.address()
          const retObj = {
            port: addr?.port,
            host: addr?.address
          }
          this.jsobj.onServerListening(retObj)
        })

        this.serverInt.on('error', () => {
          this.jsobj.onServerError()
        })

        this.serverInt.on('close', () => {
          this.jsobj.onServerClose()
        })
        this.doProcessBufferedChlos = this.doProcessBufferedChlos.bind(this)

        this.serverInt.on('message', (mess) => {
          const haschlos = this.cobj.recvPaket({
            ...mess,
            selfaddress: this.serverInt.address()
          })
          if (!this.chlosSched && haschlos) {
            setImmediate(this.doProcessBufferedChlos)
            this.chlosSched = true
          }
        })
      })
      .catch((error) => {
        log('Problem resolving hostname:', error)
        // hostname not known
        this.jsobj.onServerError()
      })
  }

  doProcessBufferedChlos() {
    this.cobj.processBufferedChlos()
    this.chlosSched = false
  }

  startServer() {
    this.serverInt.bind(this.port, this.address?.address)
  }

  stopServer() {
    this.serverInt.close()
    // TODO call close on all sessions
  }
}
