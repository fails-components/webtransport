import { Http3Client } from './client.js'
import { Http3WTSession } from './session.js'

const sessions = new WeakMap()

/**
 * @typedef {import('./dom').WebTransportCloseInfo} WebTransportCloseInfo
 * @typedef {import('./dom').WebTransportBidirectionalStream} WebTransportBidirectionalStream
 * @typedef {import('./dom').WebTransportReceiveStream} WebTransportReceiveStream
 */

/**
 * @typedef {import('./dom').WebTransport} WebTransportInterface
 *
 * @implements {WebTransportInterface}
 */
 export class WebTransport {
  /**
   * @param {string} url
   * @param {import('./dom').WebTransportOptions} [args]
   */
  constructor(url, args) {
    if (!url) throw new Error('no URL supplied')

    const ourl = new URL(url)

    if (ourl.protocol !== 'https:') {
      throw new Error('URL is not supported for webtransport')
    }

    const hostname = ourl.hostname
    let port = ourl.port
    if (port === '') port = '443'

    const client = new Http3Client({ hostname, port, ...args })

    const sessionint = new Http3WTSession({
      /* object: args.session, */
      parentobj: client
    })

    this.ready = sessionint.ready
    this.closed = sessionint.closed

    this.datagrams = sessionint.datagrams

    /** @type {ReadableStream<WebTransportBidirectionalStream>} */
    this.incomingBidirectionalStreams =
      sessionint.incomingBidirectionalStreams

    /** @type {ReadableStream<WebTransportReceiveStream>} */
    this.incomingUnidirectionalStreams =
      sessionint.incomingUnidirectionalStreams

    sessions.set(this, sessionint)

    client.quicconnected?.then(() => {
      return client.createWTSession(sessionint, ourl.pathname)
    })
      .catch(err => {
        sessionint.readyReject(
          new Error('Establishing session failed ' + err)
        )
        console.log('Establishing session failed ' + err)
      })
  }

  /**
   * @param {WebTransportCloseInfo} [closeinfo]
   */
  close(closeinfo) {
    return sessions.get(this).close(closeinfo)
  }

  createBidirectionalStream() {
    return sessions.get(this).createBidirectionalStream()
  }

  createUnidirectionalStream() {
    return sessions.get(this).createUnidirectionalStream()
  }
}
