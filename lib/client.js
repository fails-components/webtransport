import { Http3WebTransport } from './transport.js'

/**
 * @typedef {import('./session').Http3WTSession} Http3WTSession
 *
 * Http3Client events
 * @typedef {import('./types').Http3ClientEventHandler} Http3ClientEventHandler
 * @typedef {import('./types').ClientConnectedEvent} ClientConnectedEvent
 * @typedef {import('./types').ClientWebtransportSupportEvent} ClientWebtransportSupportEvent
 * @typedef {import('./types').Http3WTSessionVisitorEvent} Http3WTSessionVisitorEvent
 */

/**
 * @implements {Http3ClientEventHandler}
 */
export class Http3Client extends Http3WebTransport {
  /**
   * @param {*} args
   */
  constructor(args) {
    super(args, 'client')

    /** @type {{ resolve: (value?: any) => void, reject: (err?: Error) => void} | null | undefined} */
    this.sessionProm = null

    /** @type {Promise<void> | undefined} */
    this.sessionobj = new Promise((resolve, reject) => {
      this.sessionProm = { resolve, reject }
    }).catch(() => {}) // add default handler if no one cares
    /** @type {Http3WTSession | null | undefined} */
    this.sessionobjint = null
    this.closeHookSession = this.closeHookSession.bind(this)

    /** @type {{ resolve: (value?: any) => void, reject: (err?: Error) => void} | null | undefined} */
    this.webtransportProm = null
    /** @type {{ resolve: (value?: any) => void, reject: (err?: Error) => void} | null | undefined} */
    this.quicconnectedProm = null
  }

  async handleConnection() {
    this.quicconnected = new Promise((resolve, reject) => {
      this.quicconnectedProm = { resolve, reject }
    })
    this.webtransport = new Promise((resolve, reject) => {
      this.webtransportProm = { resolve, reject }
    })

    try {
      /* setTimeout(() => {
        if (this.quicconnectedProm) {
          this.quicconnectedProm.reject(new Error('Timeout client connection'))
          delete this.quicconnectedProm
        }
      }, 4000) */
      await this.quicconnected
      // now create Webtransport session
      setTimeout(() => {
        if (this.webtransportProm) {
          this.webtransportProm.reject(
            new Error('Timeout webtransport support')
          )
          delete this.webtransportProm
        }
      }, 2000)
    } catch (error) {
      throw new Error('Cl:' + error)
    }
  }

  /**
   * @param {Http3WTSession} sessionobj
   * @param {string} path
   * @returns
   */
  async createWTSession(sessionobj, path) {
    // TODO
    try {
      await this.webtransport // wait for webtransport support
      // ok now we open the session
      this.sessionobjint = sessionobj
      this.transportInt.openWTSession(path)
      console.log('wait for session')
      // we wait for a new session
      const sessobj = await this.sessionobj

      delete this.sessionobj

      return sessobj
    } catch (error) {
      throw new Error('createWTSession failed ' + error)
    }
  }

  closeHookSession() {
    this.transportInt.closeClient()
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
          new Error('Connecting quic client failed')
        )
      delete this.quicconnectedProm
    } else throw new Error('Client connected with no pending promise')
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
   * @param {Http3WTSessionVisitorEvent} args
   */
  onHttp3WTSessionVisitor(args) {
    // create Http3 Visitor
    if (args.session && this.sessionProm && this.sessionobjint) {
      this.sessionobjint.setSessionObj(args.session)
      args.session.jsobj.closeHook = this.closeHookSession
      delete this.sessionobjint
      this.sessionProm.resolve(args.session)
      delete this.sessionProm
    } else {
      throw new Error(
        'Http3WTSessionVisitor no object session or nor sessionprom'
      )
    }
  }

  /**
   * @param {ClientConnectedEvent | ClientWebtransportSupportEvent | Http3WTSessionVisitorEvent} args
   */
  customCallback(args) {
    // console.log('incoming callback custom client', args)
    if (args.purpose) {
      switch (args.purpose) {
        case 'ClientConnected':
          this.onClientConnected(args)
          break
        case 'ClientWebtransportSupport':
          this.onClientWebTransportSupport(args)
          break
        case 'Http3WTSessionVisitor':
          this.onHttp3WTSessionVisitor(args)
          break
        default: {
          throw new Error('unknown purpose')
        }
      }
    }
  }
}
