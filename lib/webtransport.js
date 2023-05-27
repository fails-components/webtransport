import { Http3Client } from './client.js'
import { Http3WTSession } from './session.js'

/** @type {WeakMap<WebTransport, Http3WTSession>} */
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
    this.draining = sessionint.draining

    this.datagrams = sessionint.datagrams

    /** @type {ReadableStream<WebTransportBidirectionalStream>} */
    this.incomingBidirectionalStreams = sessionint.incomingBidirectionalStreams

    /** @type {ReadableStream<WebTransportReceiveStream>} */
    this.incomingUnidirectionalStreams =
      sessionint.incomingUnidirectionalStreams

    sessions.set(this, sessionint)

    client
      .handleConnection()
      .then(() => {
        client.quicconnected
          ?.then(() => {
            return client.createWTSession(sessionint, ourl.pathname)
          })
          .catch((err) => {
            sessionint.readyReject(
              new Error('Establishing session failed ' + err)
            )
            console.log('Establishing session failed ' + err)
            client.closeHookSession()
          })
      })
      .catch((error) => {
        sessionint.readyReject(new Error('Quic connection failed ' + error))
        console.log('Quic connection failed ' + error)
        client.closeHookSession()
      })
  }

  get reliability() {
    const session = sessions.get(this)

    if (session == null) {
      // should never happen as session is only removed when this instance is garbage collected
      throw new Error('Http3WTSession was undefined')
    }
    return session.reliability
  }

  get congestionControl() {
    const session = sessions.get(this)

    if (session == null) {
      // should never happen as session is only removed when this instance is garbage collected
      throw new Error('Http3WTSession was undefined')
    }
    return session.congestionControl
  }

  getStats() {
    const session = sessions.get(this)

    if (session == null) {
      // should never happen as session is only removed when this instance is garbage collected
      throw new Error('Http3WTSession was undefined')
    }
    return session.getStats()
  }

  /**
   * @param {WebTransportCloseInfo} [closeinfo]
   */
  close(closeinfo) {
    const session = sessions.get(this)

    if (session == null) {
      // should never happen as session is only removed when this instance is garbage collected
      throw new Error('Http3WTSession was undefined')
    }

    return session.close(closeinfo)
  }

  createBidirectionalStream() {
    const session = sessions.get(this)

    if (session == null) {
      // should never happen as session is only removed when this instance is garbage collected
      throw new Error('Http3WTSession was undefined')
    }

    return session.createBidirectionalStream()
  }

  createUnidirectionalStream() {
    const session = sessions.get(this)

    if (session == null) {
      // should never happen as session is only removed when this instance is garbage collected
      throw new Error('Http3WTSession was undefined')
    }

    return session.createUnidirectionalStream()
  }
}
