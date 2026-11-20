/// <reference types="node" />
import { WebTransportError } from './error.js'
import { Http3QuicheSession } from './http3quiche/session.js'
import { konClose, kSetCloseHook } from './session.js'
import { logger } from './utils.js'

const pid = typeof process !== 'undefined' ? process.pid : 0
const log = logger(`webtransport:httpclient(${pid})`)

/**
 * @typedef {import('./session').HttpWTSession} HttpWTSession
 * @typedef {import('./types').HttpClientInit} HttpClientInit
 *
 * Http3Client events
 * @typedef {import('./types').HttpClientEventHandler} HttpClientEventHandler
 * @typedef {import('./types').ClientConnectedEvent} ClientConnectedEvent
 * @typedef {import('./types').ClientWebtransportSupportEvent} ClientWebtransportSupportEvent
 * @typedef {import('./types').HttpWTClientSessionVisitorEvent} HttpWTClientSessionVisitorEvent
 * @typedef {import('./types').NativeWebTransportSessionControl} NativeWebTransportSessionControl
 * @typedef {import('./types').NativeWebTransportSessionStreamCreator} NativeWebTransportSessionStreamCreator
 */

/**
 * @implements {HttpClientEventHandler}
 */
export class HttpClient {
  /**
   * @param {HttpClientInit} args
   */
  constructor(args) {
    /** @type {HttpClientInit| undefined} */
    this.args = args

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

    this._quicConnectTimeout = args.quicConnectTimeout ?? 3000
    this._webTransportConnectTimeout = args.webTransportConnectTimeout ?? 1000
  }

  /**
   * @param {Object} args
   * @param {boolean} args.createTransport
   * @param {string} args.path
   */
  async handleConnection({ createTransport, path }) {
    if (createTransport) this.createTransportInt({ path })

    this.quicconnected = new Promise((resolve, reject) => {
      this.quicconnectedProm = { resolve, reject }
    })
    this.webtransport = new Promise((resolve, reject) => {
      this.webtransportProm = { resolve, reject }
    })

    const timeout = setTimeout(() => {
      if (this.quicconnectedProm) {
        log.error('quic connection timeout for path:', path)
        this.quicconnectedProm.reject(
          new WebTransportError(
            'Opening handshake failed.' +
              ((path !== '/' && path !== '/non_existant') ? path : '')
          )
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
   * @param {import('./types').SessionCloseEvent} args
   */
  onClientError(args) {
    if (this.sessionobjint != null) {
      this.sessionobjint[konClose](args)
    }
  }

  /**
   * @param {ClientConnectedEvent} args
   */
  onClientConnected(args) {
    this.transportIntSwitchToReliable = undefined
    if (this.quicconnectedProm) {
      if (args.success) this.quicconnectedProm.resolve()
      else
        this.quicconnectedProm.reject(
          new WebTransportError('Opening handshake failed.')
        )
      delete this.quicconnectedProm
    } else if (args.success)
      throw new WebTransportError('Client connected with no pending promise')
  }

  /**
   * @param {ClientWebtransportSupportEvent} args
   */
  // eslint-disable-next-line no-unused-vars
  onClientWebTransportSupport(args) {
    if (this.webtransportProm) {
      this.webtransportProm.resolve()
      delete this.webtransportProm
    }
  }

  /**
   * @param {HttpWTClientSessionVisitorEvent|undefined} args
   */
  onHttpWTSessionVisitor(args) {
    if (typeof args === 'undefined') {
      if (this.sessionobjint)
        this.sessionobjint[konClose]({
          errorcode: 0,
          error: 'Session stream errored'
        })
      return
    }
    /** @type {NativeWebTransportSessionControl|undefined} */
    let control
    /** @type {NativeWebTransportSessionStreamCreator|undefined} */
    let creator
    let callonReady = true
    if (
      args &&
      'control' in args &&
      'creator' in args &&
      args.control &&
      args.creator
    ) {
      control = args.control
      creator = args.creator
    } else if (args && 'session' in args && args.session) {
      /** @type {string} */
      let selprotocol
      callonReady = false
      let intsessobj = this.sessionobjint
      control = creator = new Http3QuicheSession(
        args.session,
        /** @type {((protocol: string) => void)}  */
        (protocol) => {
          selprotocol = protocol
          intsessobj?.onReady()
          intsessobj = undefined
        }
      )
      args.responseHeader = args.responseHeader || {}
      Object.defineProperties(args.responseHeader, {
        ['wt-protocol']: {
          get: () => {
            return selprotocol && '"' + selprotocol + '"'
          }
        }
      })
    } else {
      return
    }

    if (this.sessionProm && this.sessionobjint) {
      // non legacy mode
      this.sessionobjint.setSessionObj({
        control: control,
        creator: creator,
        reliable: !!args.reliable,
        responseHeader: args.responseHeader,
        isclient: true,
        sendBudget: args.sendBudget
      })
      const sessobj = this.sessionobjint
      if (callonReady) {
        process.nextTick(() => {
          sessobj.onReady()
        })
      }
      this.sessionobjint[kSetCloseHook](this.closeHookSession)
      delete this.sessionobjint
      this.sessionProm.resolve(this.sessionobjint)
      delete this.sessionProm
    }
    return this.sessionobjint
  }

  /**
   * @param{{path: string}} [args]
   **/
  createTransportInt(args) {
    const path = args?.path
    if (this.transportInt != null) {
      return
    }

    try {
      // @ts-ignore
      if (this.args?.forceReliable || !this.args.createUnreliableClient) {
        // internal option for unit tests only
        // @ts-ignore
        this.transportInt = this.args.createReliableClient(this)
      } else {
        // @ts-ignore
        this.transportInt = this.args.createUnreliableClient(this)
        if (!this.args?.requireUnreliable) {
          const args = this.args
          this.transportIntSwitchToReliable = () => {
            if (this.transportInt != null) {
              this.transportInt.closeClient()
            }
            // @ts-ignore
            this.transportInt = args.createReliableClient(this)
            this.transportInt.jsobj = this
            if (this.transportInt.createTransport) {
              this.transportInt.createTransport({ path })
            }
            this.transportIntSwitchToReliable = undefined
          }
        }
      }
    } catch (/** @type {any} */ err) {
      const error = new WebTransportError('Opening handshake failed.')
      error.stack = err.stack

      throw error
    }
    delete this.args
    this.transportInt.jsobj = this
    if (this.transportInt.createTransport) {
      this.transportInt.createTransport({ path })
    }
  }
}
