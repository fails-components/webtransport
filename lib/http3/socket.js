import { X509Certificate, createVerify } from 'node:crypto'
import { logger } from '../utils.js'
import { rootCertificates } from 'node:tls'
const log = logger(`webtransport:Http3WebTransportSocket(${process.pid})`)

globalThis.FAILSsetTimeoutAlarm = (
  /** @type {{ fireJS: () => void; }} */ alarm,
  /** @type {number} */ delay
) => {
  return setTimeout(alarm.fireJS.bind(alarm), delay)
}

globalThis.FAILSVerifyProof = (
  /** @type {{ certs: string[]; hostname: string; server_config?: string; signature?: string; }} */ obj
) => {
  try {
    if (obj.certs.length < 1) return false
    const leafcert = new X509Certificate(obj.certs[0])
    if (!leafcert.checkHost(obj.hostname)) return false

    if (obj.server_config) {
      if (!obj.signature) return false
      const verify = createVerify('SHA256')
      verify.write(obj.server_config)
      verify.end()
      if (!verify.verify(leafcert.publicKey, obj.signature, 'hex')) return false
    }

    const curdate = new Date()

    if (
      new Date(leafcert.validFrom) > curdate ||
      new Date(leafcert.validTo) < curdate
    )
      return false

    let curcert = leafcert
    for (let certnum = 1; certnum < obj.certs.length; certnum++) {
      const nextcert = new X509Certificate(obj.certs[certnum])

      if (
        new Date(nextcert.validFrom) > curdate ||
        new Date(nextcert.validTo) < curdate
      )
        return false

      if (!curcert.checkIssued(nextcert)) return false
      if (!curcert.verify(nextcert.publicKey)) return false
      curcert = nextcert
    }
    // curcert must be one of the rootCertificates

    if (
      !rootCertificates.some((rootCA) => {
        const testCert = new X509Certificate(rootCA)
        if (curcert.checkIssued(testCert)) {
          if (!curcert.verify(testCert.publicKey)) return false
          else return true
        } else return false
      })
    )
      return false
  } catch (error) {
    log('VerifyProof error:', error)
    return false
  }
  return true
}

export class Http3WebTransportSocket {
  /**
   * @param {import('../types.js').Http3WebTransportInit|undefined} args
   */
  constructor(args) {
    /** @type {import('node:dgram').Socket} */
    // @ts-ignore
    this.socketInt = undefined // the transport will set this
    // @ts-ignore
    this.cobj = undefined // the transport will set this
    this.chlosSched = false
    this.packetSendCB = this.packetSendCB.bind(this)
    this.doProcessBufferedChlos = this.doProcessBufferedChlos.bind(this)
    this.blocked = false
    this.closed = false
  }

  doProcessBufferedChlos() {
    this.cobj.processBufferedChlos()
    this.chlosSched = false
  }

  /**
   * @param {import('../types').UDPServerSocketSend} args
   */

  sendPacket({ msg, offset, length, port, address }) {
    if (this.closed) return true
    this.socketInt.send(
      Buffer.from(msg), // It seems that we need a copy, so maybe a js side buffer is a better choice
      offset,
      length,
      port,
      address,
      this.packetSendCB
    )
    // @ts-ignore
    const blocked = this.socketInt.getSendQueueCount() > 0
    this.blocked = this.blocked || blocked
    return blocked
  }

  packetSendCB() {
    // @ts-ignore
    if (this.socketInt.getSendQueueCount() === 0 && this.blocked) {
      this.cobj.onCanWrite()
    }
  }
}
