import { X509Certificate, createVerify } from 'node:crypto'
import { logger } from './utils.js'
import { rootCertificates } from 'node:tls'
const log = logger(`webtransport:Http3WebTransportSocket(${process.pid})`)

globalThis.FAILSsetTimeoutAlarm = (
  /** @type {{ fireJS: () => void; }} */ alarm,
  /** @type {number} */ delay
) => {
  return setTimeout(alarm.fireJS.bind(alarm), delay)
}

function convertToPem(/** @type {ArrayBuffer} */ cert) {
  return (
    '-----BEGIN CERTIFICATE-----\n' +
    Buffer.from(new Uint8Array(cert)).toString('base64') +
    '\n-----END CERTIFICATE-----\n'
  )
}

globalThis.FAILSVerifyProof = (
  /** @type {{ certs: ArrayBuffer[]; hostname: string; server_config?: string; signature?: string; }} */ obj
) => {
  try {
    console.warn(
      'Non serverCertificateHashes certificate verification is an experimental feature for webtransport node client and not covered by tests and thus may be broken (DO NOT USE IN PRODUCTION)'
    )
    console.log('obj', obj)
    if (obj.certs.length < 1) return false
    const pem = convertToPem(obj.certs[0])
    const leafcert = new X509Certificate(pem)
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
      const nextpem = convertToPem(obj.certs[certnum])
      const nextcert = new X509Certificate(nextpem)

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
   * @param {import('../../../main/lib/types.js').HttpWebTransportInit|undefined} args
   */
  // eslint-disable-next-line no-unused-vars
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
   * @param {import('./types').UDPServerSocketSend} args
   */

  sendPacket({ msg, offset, length, port, address }) {
    if (this.closed) return true
    this.socketInt.send(
      msg, // It seems that we need a copy, so maybe a js side buffer is a better choice, we copy now on c++ side
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
    if (
      !this.closed &&
      // @ts-ignore
      this.socketInt.getSendQueueCount() === 0 &&
      this.blocked
    ) {
      this.cobj.onCanWrite()
    }
  }
}
