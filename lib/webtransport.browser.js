import { WebTransportBase } from './webtransportbase.js'
import { HttpWTSession } from './session.js'
import { HttpClient } from './client.js'
import { Http2WebTransportBrowser } from './http2/browser/browser.js'

/**
 * @typedef {import('./dom').WebTransport} WebTransport
 * @typedef {import('./dom').WebTransportCloseInfo} WebTransportCloseInfo
 * @typedef {import('./dom').WebTransportBidirectionalStream} WebTransportBidirectionalStream
 * @typedef {import('./dom').WebTransportReceiveStream} WebTransportReceiveStream
 * @typedef {import('./error').WebTransportError} WebTransportError
 */

/**
 * @template T
 * @typedef {import('node:stream/web').ReadableStream<T>} ReadableStream<T>
 */

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
    client
      .handleConnection({ createTransport: true, path: ourl.pathname })
      .then(() => client.createWTSession(sessionint, ourl.pathname))
      .catch((error) => {
        client.closeHookSession()
        sessionint.readyReject(error)
        sessionint.closedReject(error)
      })
  }

  /**
   * @param{import('./types.js').HttpWebTransportInit} args
   * @return {{sessionint: HttpWTSession, client: HttpClient}}
   */
  createClient(args) {
    const client = new HttpClient({
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

    /** @type {WebTransport|WebTransportPonyfill} */
    // @ts-ignore
    // eslint-disable-next-line no-undef
    this.curtransport = new WebTransport(url, args)

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

    this.curtransport.ready
      .then((val) => {
        this.allowFallback = false
        this.readyRes(val)
      })
      .catch((error) => {
        if (this.allowFallback && !this.closeset) {
          if (!this.initiatedFallback) {
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
          if (!this.initiatedFallback) {
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
    /** @type {import('./dom').WebTransportDatagramDuplexStream} */
    // @ts-ignore
    this.datagrams = {}
    // @ts-ignore
    // eslint-disable-next-line no-undef
    this.datagrams.readable = new ReadableStream({
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
    // eslint-disable-next-line no-undef
    this.datagrams.writable = new WritableStream({
      start: async (controller) => {
        await this.ready
        this.datagramsWriter = this.curtransport.datagrams.writable.getWriter()
      },
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
    // eslint-disable-next-line no-undef
    this.incomingBidirectionalStreams = new ReadableStream({
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
    // eslint-disable-next-line no-undef
    this.incomingUnidirectionalStreams = new ReadableStream({
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

  async createBidirectionalStream() {
    await this.ready
    return await this.curtransport.createBidirectionalStream()
  }

  async createUnidirectionalStream() {
    await this.ready
    return await this.curtransport.createUnidirectionalStream()
  }
}
