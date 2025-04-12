/** @type {WeakMap<WebTransportBase, import('./session.js').HttpWTSession>} */

/**
 * @typedef {import('./dom.js').WebTransportCloseInfo} WebTransportCloseInfo
 * @typedef {import('./dom.js').WebTransportBidirectionalStream} WebTransportBidirectionalStream
 * @typedef {import('./dom.js').WebTransportReceiveStream} WebTransportReceiveStream
 * @typedef {import('./dom.js').WebTransportSendStream} WebTransportSendStream
 * @typedef {import('./dom.js').WebTransportSendStreamOptions} WebTransportSendStreamOptions
 * @typedef {import('./session.js').HttpWTSession} HttpWTSession
 * @typedef { import('./session.js').HttpClient} HttpClient
 */

/**
 * @template T
 * @typedef {import('node:stream/web').ReadableStream<T>} ReadableStream<T>
 */

/**
 * @typedef {import('./dom.js').WebTransport} WebTransportInterface
 *
 * @implements {WebTransportInterface}
 */
export class WebTransportBase {
  /**
   * @param {string} url
   * @param {import('./dom.js').WebTransportOptions} [args]
   */
  constructor(url, args) {
    if (!url) throw new Error('no URL supplied')

    const ourl = new URL(url)

    if (ourl.protocol !== 'https:') {
      throw new Error('URL is not supported for webtransport')
    }

    const host = ourl.hostname
    let port = ourl.port
    if (port === '') port = '443'
    const { sessionint, client } = this.createClient({ host, port, ...args })
    this.ready = sessionint.ready
    this.closed = sessionint.closed
    this.draining = sessionint.draining

    this.datagrams = sessionint.datagrams

    this.incomingBidirectionalStreams = sessionint.incomingBidirectionalStreams

    this.incomingUnidirectionalStreams =
      sessionint.incomingUnidirectionalStreams

    this.sessionint = sessionint

    this.startUpConnection({ client, sessionint, ourl })
  }

  /**
   * @param{import('./types.js').HttpWebTransportInit} args
   * @return {{sessionint: HttpWTSession, client: HttpClient}}
   * @abstract
   */
  // eslint-disable-next-line no-unused-vars
  createClient(args) {
    throw new Error('Implement createClient')
  }

  /**
   * @param{{client: HttpClient, sessionint: HttpWTSession, ourl: URL}} args
   * @abstract
   */
  // eslint-disable-next-line no-unused-vars
  startUpConnection({ client, sessionint, ourl }) {
    throw new Error('Implement startUpConnection')
  }

  get reliability() {
    const session = this.sessionint

    if (!session) {
      // should never happen as session is only removed when this instance is garbage collected
      throw new Error('Http3WTSession was undefined')
    }
    return session.reliability
  }

  get congestionControl() {
    const session = this.sessionint

    if (!session) {
      // should never happen as session is only removed when this instance is garbage collected
      throw new Error('Http3WTSession was undefined')
    }
    return session.congestionControl
  }

  get supportsReliableOnly() {
    throw new Error('Implement supportsReliableOnly')
    // eslint-disable-next-line no-unreachable
    return false
  }

  getStats() {
    const session = this.sessionint

    if (!session) {
      // should never happen as session is only removed when this instance is garbage collected
      throw new Error('Http3WTSession was undefined')
    }
    return session.getStats()
  }

  /**
   * @param {WebTransportCloseInfo} [closeinfo]
   */
  close(closeinfo) {
    const session = this.sessionint

    if (!session) {
      // should never happen as session is only removed when this instance is garbage collected
      throw new Error('Http3WTSession was undefined')
    }

    return session.close(closeinfo)
  }

  /**
   * @param {WebTransportSendStreamOptions} [opts]
   * @returns {Promise<WebTransportBidirectionalStream>}
   */
  createBidirectionalStream(opts) {
    const session = this.sessionint

    if (!session) {
      // should never happen as session is only removed when this instance is garbage collected
      throw new Error('Http3WTSession was undefined')
    }

    return session.createBidirectionalStream(opts)
  }

  /**
   * @param {WebTransportSendStreamOptions} [opts]
   * @returns {Promise<WebTransportSendStream>}
   */
  createUnidirectionalStream(opts) {
    const session = this.sessionint

    if (!session) {
      // should never happen as session is only removed when this instance is garbage collected
      throw new Error('Http3WTSession was undefined')
    }

    return session.createUnidirectionalStream(opts)
  }

  get protocol() {
    const session = this.sessionint
    if (!session) return undefined

    return session.protocol
  }
}
