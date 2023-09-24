import { HttpWebTransport } from './transport.js'
import { WebTransportError } from './error.js'
import { logger } from './utils.js'

const log = logger(`webtransport:httpclient(${process.pid})`)

/**
 * @typedef {import('./session').HttpWTSession} HttpWTSession
 * @typedef {import('./types').HttpClientInit} HttpClientInit
 *
 * Http3Client events
 * @typedef {import('./types').HttpClientEventHandler} HttpClientEventHandler
 * @typedef {import('./types').ClientConnectedEvent} ClientConnectedEvent
 * @typedef {import('./types').ClientWebtransportSupportEvent} ClientWebtransportSupportEvent
 * @typedef {import('./types').HttpWTSessionVisitorEvent} HttpWTSessionVisitorEvent
 */

/**
 * @implements {HttpClientEventHandler}
 */
export class HttpClient extends HttpWebTransport {
  /**
   * @param {HttpClientInit} args
   */
  constructor(args) {
    super(args, 'client')

    /** @type {{ resolve: (value?: any) => void, reject: (err?: Error) => void} | null | undefined} */
    this.sessionProm = null

    /** @type {Promise<void> | undefined} */
    this.sessionobj = new Promise((resolve, reject) => {
      this.sessionProm = { resolve, reject }
    }).catch(() => {}) // add default handler if no one cares
    /** @type {HttpWTSession | null | undefined} */
    this.sessionobjint = null
    this.closeHookSession = this.closeHookSession.bind(this)

    /** @type {{ resolve: (value?: any) => void, reject: (err?: Error) => void} | null | undefined} */
    this.webtransportProm = null
    /** @type {{ resolve: (value?: any) => void, reject: (err?: Error) => void} | null | undefined} */
    this.quicconnectedProm = null

    this._quicConnectTimeout = args.quicConnectTimeout ?? 8000
    this._webTransportConnectTimeout = args.webTransportConnectTimeout ?? 2000
  }

  /**
   * @param {Object} args
   * @param {boolean} args.createTransport
   */
  async handleConnection({ createTransport }) {
    if (createTransport) this.createTransportInt()

    this.quicconnected = new Promise((resolve, reject) => {
      this.quicconnectedProm = { resolve, reject }
    })
    this.webtransport = new Promise((resolve, reject) => {
      this.webtransportProm = { resolve, reject }
    })

    const timeout = setTimeout(() => {
      if (this.quicconnectedProm) {
        log.error('quic connection timeout')
        this.quicconnectedProm.reject(
          new WebTransportError('Opening handshake failed.')
        )
        delete this.quicconnectedProm
      }
    }, this._quicConnectTimeout)
    try {
      await this.quicconnected
    } finally {
      clearTimeout(timeout)
    }
  }

  /**
   * @param {HttpWTSession} sessionobj
   * @param {string} path
   * @returns
   */
  async createWTSession(sessionobj, path) {
    // now create Webtransport session
    const timeout = setTimeout(() => {
      if (this.webtransportProm) {
        log.error('webtransport connection timeout')
        this.webtransportProm.reject(
          new WebTransportError('Opening handshake failed.')
        )
        delete this.webtransportProm
      }
    }, this._webTransportConnectTimeout)
    await this.webtransport // wait for webtransport support
    clearTimeout(timeout)

    // ok now we open the session
    this.sessionobjint = sessionobj
    this.transportInt.openWTSession(path)

    // we wait for a new session
    const sessobj = await this.sessionobj

    delete this.sessionobj

    return sessobj
  }

  closeHookSession() {
    if (this.transportInt != null) {
      this.transportInt.closeClient()
    }

    this.stopped = true
  }

  /**
   * @param {ClientConnectedEvent} args
   */
  onClientConnected(args) {
    if (this.quicconnectedProm) {
      if (args.success) this.quicconnectedProm.resolve()
      else
        this.quicconnectedProm.reject(
          new WebTransportError('Opening handshake failed.')
        )
      delete this.quicconnectedProm
    } else
      throw new WebTransportError('Client connected with no pending promise')
  }

  /**
   * @param {ClientWebtransportSupportEvent} args
   */
  onClientWebTransportSupport(args) {
    if (this.webtransportProm) {
      this.webtransportProm.resolve()
      delete this.webtransportProm
    }
  }

  /**
   * @param {HttpWTSessionVisitorEvent} args
   */
  onHttpWTSessionVisitor(args) {
    // create Http Visitor
    if (args.session && this.sessionProm && this.sessionobjint) {
      this.sessionobjint.setSessionObj(args.session, !!args.reliable)
      args.session.jsobj.closeHook = this.closeHookSession
      delete this.sessionobjint
      this.sessionProm.resolve(args.session)
      delete this.sessionProm
    } else {
      throw new WebTransportError(
        'Http3WTSessionVisitor no object session or nor sessionprom'
      )
    }
  }

  /**
   * @param {ClientConnectedEvent | ClientWebtransportSupportEvent | HttpWTSessionVisitorEvent} args
   */
  customCallback(args) {
    log('callback', args?.purpose)
    log.trace(args)
    if (args.purpose) {
      switch (args.purpose) {
        case 'ClientConnected':
          this.onClientConnected(args)
          break
        case 'ClientWebtransportSupport':
          this.onClientWebTransportSupport(args)
          break
        case 'Http2WTSessionVisitor':
          this.onHttpWTSessionVisitor({ ...args, reliable: true })
          break
        case 'Http3WTSessionVisitor':
          this.onHttpWTSessionVisitor({ ...args, reliable: false })
          break
        default: {
          // @ts-ignore
          throw new WebTransportError('unknown purpose: ' + args.purpose)
        }
      }
    }
  }
}
