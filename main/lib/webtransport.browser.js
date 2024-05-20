import { WebTransportBase } from './webtransportbase.js'
import { HttpWTSession } from './session.js'
import { HttpClient } from './client.js'
import { Http2WebTransportBrowser } from './http2/browser/browser.js'
import { logger } from './utils.js'

const log = logger(`webtransport:browser()`)

/**
 * @typedef {import('./dom').WebTransport} WebTransport
 * @typedef {import('./dom').WebTransportCloseInfo} WebTransportCloseInfo
 * @typedef {import('./dom').WebTransportBidirectionalStream} WebTransportBidirectionalStream
 * @typedef {import('./dom').WebTransportSendStream} WebTransportSendStream
 * @typedef {import('./dom').WebTransportSendStreamOptions} WebTransportSendStreamOptions
 * @typedef {import('./dom').WebTransportReceiveStream} WebTransportReceiveStream
 * @typedef {import('./error').WebTransportError} WebTransportError
 */

/**
 * @template T
 * @typedef {import('node:stream/web').ReadableStream<T>} ReadableStream<T>
 */

let serverCertificateHashesNotSupported = false
let webtransportSupported = false

// @ts-ignore
if (globalThis.WebTransport) {
  webtransportSupported = true
  try {
    // @ts-ignore
    // eslint-disable-next-line no-undef
    const transport = new WebTransport('https://127.0.0.1:23333/test', {
      serverCertificateHashes: []
    })
    transport.ready
      .then(() => {
        try {
          transport.close()
          // eslint-disable-next-line no-empty, no-unused-vars
        } catch (error) {}
      })
      .catch(() => {})
  } catch (error) {
    // @ts-ignore
    if (error?.name === 'NotSupportedError') {
      // note: we also do not support this, but http2 is a different transport
      // so we assume that the UDP and TCP part have different capabilities
      log('serverCertificateHashesNotSupported')
      serverCertificateHashesNotSupported = true
    }
  }
}

/**
 * @typedef {import('./dom').WebTransport} WebTransportInterface
 *
 * @implements {WebTransportInterface}
 */
export class WebTransportPonyfill extends WebTransportBase {
  /**
   * @param{{client: HttpClient, sessionint: HttpWTSession, ourl: URL}} args
   */
  startUpConnection({ client, sessionint, ourl }) {
    const path = ourl.pathname + (ourl.search ?? '')
    client
      .handleConnection({ createTransport: true, path })
      .then(() => client.createWTSession(sessionint, path))
      .catch((error) => {
        client.closeHookSession()
        sessionint.readyReject(error)
        sessionint.closedReject(error)
      })
  }

  get supportsReliableOnly() {
    return true
  }

  /**
   * @param{import('./types.js').HttpWebTransportInit} args
   * @return {{sessionint: HttpWTSession, client: HttpClient}}
   */
  createClient(args) {
    this.curtype = 'websocket'
    const client = new HttpClient({
      // eslint-disable-next-line no-unused-vars
      createReliableClient: (client) => {
        // @ts-ignore
        return new Http2WebTransportBrowser({ ...args })
      },
      ...args
    })
    const sessionint = new HttpWTSession({
      /* object: args.session, */
      parentobj: client
    })
    return { client, sessionint }
  }
}

export class WebTransportPolyfill {
  /**
   * @param {string} url
   * @param {import('./dom.js').WebTransportOptions} [args]
   */
  constructor(url, args) {
    this.curtype = 'native'
    this.closeset = false
    this.allowFallback = true
    this.initiatedFallback = false
    this.args = args

    this.closed = new Promise((resolve, reject) => {
      this.closeRes = resolve
      this.closeRej = reject
    })

    this.ready = new Promise((resolve, reject) => {
      this.readyRes = resolve
      this.readyRej = reject
    })

    this.draining = new Promise((resolve, reject) => {
      this.drainingRes = resolve
      this.drainingRej = reject
    })

    const initiateFallback = () => {
      this.initiatedFallback = true
      this.curtype = 'websocket'
      this.curtransport = new WebTransportPonyfill(url, args)
      this.curtransport.ready
        .then((val) => this.readyRes(val))
        .catch((error) => this.readyRej(error))
      this.curtransport.closed
        .then((val) => this.closeRes(val))
        .catch((error) => this.closeRej(error))
      this.curtransport.draining
        .then((val) => this.drainingRes(val))
        .catch((error) => this.drainingRej(error))
    }
    if (
      webtransportSupported &&
      (!args?.serverCertificateHashes || !serverCertificateHashesNotSupported)
    ) {
      /** @type {WebTransport|WebTransportPonyfill} */
      // @ts-ignore
      // eslint-disable-next-line no-undef
      this.curtransport = new WebTransport(url, args)
      // if browser takes too long for waiting for client, we use the ponyfill
      setTimeout(() => {
        if (this.allowFallback && !this.closeset) {
          if (
            !this.initiatedFallback &&
            !this.curtransport?.supportsReliableOnly // way how browser signals support for http/2, no polyfill needed in this cases
          ) {
            const oldtransport = this.curtransport
            if (oldtransport)
              oldtransport.ready
                .then(async () => {
                  oldtransport.close()
                })
                .catch(() => {})
            initiateFallback()
          }
        }
      }, 2000)

      this.curtransport.ready
        .then((val) => {
          this.allowFallback = false
          this.readyRes(val)
        })
        .catch((error) => {
          if (this.allowFallback && !this.closeset) {
            if (
              !this.initiatedFallback &&
              !this.curtransport?.supportsReliableOnly // way how browser signals support for http/2, no polyfill needed in this cases
            ) {
              initiateFallback()
            }
          } else {
            this.readyRej(error)
          }
        })
      this.curtransport.closed
        .then((val) => {
          if (this.curtype === 'native') this.closeRes(val)
        })
        .catch((error) => {
          if (this.allowFallback && !this.closeset) {
            if (
              !this.initiatedFallback &&
              !this.curtransport?.supportsReliableOnly // way how browser signals support for http/2, no polyfill needed in this cases
            ) {
              initiateFallback()
            }
          } else {
            this.closeRej(error)
          }
        })
      if (this.curtransport.draining) {
        // @ts-ignore
        this.curtransport.draining
          .then((/** @type {any} */ val) => {
            if (this.curtype === 'native') this.drainingRes(val)
          })
          .catch((/** @type {WebTransportError} */ error) => {
            if (this.curtype === 'native') this.drainingRej(error)
          })
      }
    } else {
      initiateFallback()
    }
    /** @type {import('./dom').WebTransportDatagramDuplexStream} */
    // @ts-ignore
    this.datagrams = {}
    // @ts-ignore
    this.datagrams.readable = new ReadableStream({
      // eslint-disable-next-line no-unused-vars
      start: async (controller) => {
        await this.ready
        this.datagramsReader = this.curtransport.datagrams.readable.getReader()
      },
      pull: async (controller) => {
        const { value, done } = await this.datagramsReader.read()
        if (value) controller.enqueue(value)
        if (done) controller.close()
      },
      cancel: async (reason) => {
        await this.datagramsReader.cancel(reason)
      }
    })
    // @ts-ignore
    this.datagrams.writable = new WritableStream({
      // eslint-disable-next-line no-unused-vars
      start: async (controller) => {
        await this.ready
        this.datagramsWriter = this.curtransport.datagrams.writable.getWriter()
      },
      // eslint-disable-next-line no-unused-vars
      write: async (chunk, controller) => {
        await this.datagramsWriter.write(chunk)
      },
      abort: async (reason) => {
        await this.datagramsWriter.abort(reason)
      },
      close: async () => {
        await this.datagramsWriter.close()
      }
    })
    this.incomingBidirectionalStreams = new ReadableStream({
      // eslint-disable-next-line no-unused-vars
      start: async (controller) => {
        await this.ready
        this.incomingBidirectionalStreamsReader =
          this.curtransport.incomingBidirectionalStreams.getReader()
      },
      pull: async (controller) => {
        const { value, done } =
          await this.incomingBidirectionalStreamsReader.read()
        if (value) controller.enqueue(value)
        if (done) controller.close()
      },
      cancel: async (reason) => {
        await this.incomingBidirectionalStreamsReader.cancel(reason)
      }
    })
    this.incomingUnidirectionalStreams = new ReadableStream({
      // eslint-disable-next-line no-unused-vars
      start: async (controller) => {
        await this.ready
        this.incomingUnidirectionalStreamsReader =
          this.curtransport.incomingUnidirectionalStreams.getReader()
      },
      pull: async (controller) => {
        const { value, done } =
          await this.incomingUnidirectionalStreamsReader.read()
        if (value) controller.enqueue(value)
        if (done) controller.close()
      },
      cancel: async (reason) => {
        await this.incomingUnidirectionalStreamsReader.cancel(reason)
      }
    })
  }

  get congestionControl() {
    // @ts-ignore
    return this.curtransport?.congestionControl || undefined
  }

  get reliability() {
    // @ts-ignore
    return this.curtransport?.reliability || undefined
  }

  get supportsReliableOnly() {
    return true
  }

  getStats() {
    // @ts-ignore
    return this.curtransport.getStats()
  }

  /**
   * @param {WebTransportCloseInfo} [closeinfo]
   */
  close(closeinfo) {
    this.closeset = true
    this.curtransport.close(closeinfo)
  }

  /**
   * @param {WebTransportSendStreamOptions} [opts]
   * @returns {Promise<WebTransportBidirectionalStream>}
   */
  async createBidirectionalStream(opts) {
    await this.ready
    return await this.curtransport.createBidirectionalStream(opts)
  }

  /**
   * @param {WebTransportSendStreamOptions} [opts]
   * @returns {Promise<WebTransportSendStream>}
   */
  async createUnidirectionalStream(opts) {
    await this.ready
    return await this.curtransport.createUnidirectionalStream(opts)
  }
}
