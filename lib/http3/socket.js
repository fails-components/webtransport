// import { logger } from '../utils.js'
// const log = logger(`webtransport:Http3WebTransportSocket(${process.pid})`)

globalThis.setTimeoutAlarm = (
  /** @type {{ fireJS: () => void; }} */ alarm,
  /** @type {number} */ delay
) => {
  return setTimeout(alarm.fireJS.bind(alarm), delay)
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
