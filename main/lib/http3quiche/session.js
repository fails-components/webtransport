import { Http3QuicheStream, kOnSessionId } from './stream.js'
/**
 * @typedef {import('../types').NativeWebTransportSessionControl} NativeWebTransportSessionControl
 * @typedef {import('../types').NativeWebTransportSessionStreamCreator} NativeWebTransportSessionStreamCreator
 * @typedef {import('../types').NativeWebTransportStream} NativeWebTransportStream
 * @typedef {import('../types').NativeHttpWTStream} NativeHttpWTStream
 * @typedef {import('../types').NativeHttpWTSession} NativeHttpWTSession
 * @typedef {import('../types').SessionStats} SessionStats
 */

// next typeddef partially copied from node.js, c.f. the applicable license in backports LICENSE.nodejs

/**
 * Called when the peer sends a GOAWAY frame.
 * @callback OnGoawayCallback
 * @this {NativeWebTransportSessionStreamCreator}
 * @returns {void}
 */

/**
 * @callback OnDatagramCallback
 * @this {NativeWebTransportSessionStreamCreator|NativeWebTransportSessionControl}
 * @param {Uint8Array} datagram
 * @returns {void}
 */

/**
 * Called when session id (e.g. for Webtransport streams) is determined
 * @callback OnWTSessionCloseCallback
 * @this {NativeWebTransportSessionControl}
 * @param {number} code error code from the webtransport session
 * @param {string|undefined} reason error message from the webtransport session
 * @returns {void}
 */

/**
 * Called when a session is destroyed with an error.
 * @callback OnSessionErrorCallback
 * @this {NativeWebTransportSessionControl|NativeWebTransportSessionStreamCreator}
 * @param {any} error
 * @returns {void}
 */

/**
 * @callback OnStreamCallback
 * @this {NativeWebTransportSessionStreamCreator}
 * @param {NativeWebTransportStream} stream
 * @returns {void}
 */

/**
 * @export
 * @typedef {Object} MessageReceiverSession
 * @property {(datagram: Uint8Array) => void} onDatagramReceived
 * @property {() => void} onGoAwayReceived,
 * @property {(options: { protocol: string }) => void} onReady
 * @property {(errorcode: number, error: string) => void} onClose,
 * @property {(stream: NativeHttpWTStream, bidirectional: boolean, incoming: boolean, sendGroupId: bigint|undefined, sendOrder: number) => void} onStream
 */

export class Http3QuicheSession {
  #inner = {
    __proto__: null,
    /** @type {MessageReceiverSession | undefined} */
    messageReceiver: undefined,
    /** @type {NativeHttpWTSession| undefined} */
    quicheSession: undefined,

    datagramsIdNext: 1n,

    /** @type {PromiseWithResolvers<void>} */
    closedPromise: Promise.withResolvers(),

    /** @type {NativeWebTransportSessionStreamCreator["remoteTransportParams"]| undefined} */
    remoteTransportParams: undefined,
    /** @type {NativeWebTransportSessionStreamCreator["stats"]| undefined} */
    stats: undefined,

    closed: false,

    /** @type {PromiseWithResolvers<Http3QuicheStream>[]} */
    bidiProm: [],
    /** @type {PromiseWithResolvers<Http3QuicheStream>[]} */
    unidiProm: [],

    /* callbacks */
    /** @type {OnDatagramCallback | undefined} */
    ondatagram: undefined,
    /** @type {OnWTSessionCloseCallback | undefined} */
    onwtsessionclose: undefined,
    /** @type {OnSessionErrorCallback | undefined} */
    onerror: undefined,
    /** @type {OnGoawayCallback | undefined} */
    ongoaway: undefined,
    /**@type {OnStreamCallback | undefined} */
    onstream: undefined,
    /** @type {((protocol: string) => void)| undefined}  */
    onReadyCallback: undefined
  }

  /**
   * @param {NativeHttpWTSession} quicheSession
   * @param {(protocol: string) => void} onReadyCallback
   */
  constructor(quicheSession, onReadyCallback) {
    const inner = this.#inner
    inner.quicheSession = quicheSession
    inner.onReadyCallback = onReadyCallback
    // @ts-ignore
    quicheSession.jsobj = this.messageReceiver
  }

  get messageReceiver() {
    const inner = this.#inner
    const session = this
    if (inner.messageReceiver) return inner.messageReceiver

    const onClose = function (
      /** @type {number} */ errorcode,
      /** @type {string} */ error
    ) {
      process.nextTick(() => {
        inner.onwtsessionclose?.call(session, errorcode, error)
        inner.closedPromise.resolve()
      })
    }

    /**
     * Handles a new stream event.
     * @param {Object} event
     * @param {NativeHttpWTStream|NativeWebTransportStream} event.stream
     * @param {boolean} event.bidirectional
     * @param {boolean} event.incoming
     * @param {bigint} [event.sendGroupId] - Optional
     * @param {number} event.sendOrder
     */

    const onStream = function (
      /** @type {NativeHttpWTStream} */ stream,
      /** @type {boolean} */ bidirectional,
      /** @type {boolean} */ incoming,
      /** @type {bigint|undefined} */ sendGroupId,
      /** @type {number} */ sendOrder
    ) {
      const jsstream = new Http3QuicheStream({
        quicheStream: stream,
        unidirectional: !bidirectional
      })
      jsstream.updateSendOrderAndGroup({
        sendOrder,
        sendGroupId: sendGroupId ?? 0n
      })

      if (incoming) {
        process.nextTick(() => {
          inner.onstream?.call(session, jsstream)
          jsstream[kOnSessionId](null)
        })
      } else {
        if (bidirectional) {
          if (inner.bidiProm.length === 0)
            throw new Error('Got bidirectional stream without asking for it')
          const curprom = inner.bidiProm.shift()

          if (curprom != null) {
            curprom.resolve(jsstream)
          }
        } else {
          if (inner.unidiProm.length === 0)
            throw new Error('Got unidirectional stream without asking for it')
          const curprom = inner.unidiProm.shift()
          if (curprom != null) {
            curprom.resolve(jsstream)
          }
        }
      }
    }

    const onDatagramReceived = function (/** @type {Uint8Array} */ datagram) {
      process.nextTick(() => {
        inner.ondatagram?.call(session, datagram)
      })
    }

    const onGoAwayReceived = function () {
      process.nextTick(() => {
        inner.ongoaway?.call(session)
      })
    }

    /**
     * @param {{ protocol: string }} options
     */
    const onReady = function ({ protocol }) {
      inner.onReadyCallback?.(protocol)
    }

    return (inner.messageReceiver = {
      onDatagramReceived,
      onGoAwayReceived,
      onClose,
      onReady,
      onStream
    })
  }

  /**
   * Only for webtransport session streams
   * Closes the webtransport session stream, and also closes
   * connected datastream internally.
   * @param {number|undefined} code optional error code
   * @param {string|undefined} msg optional error message truncated to 1024 bytes
   */
  closeWebtransportSessionStream(code, msg) {
    const inner = this.#inner
    if (typeof inner.quicheSession === 'undefined') return
    inner.quicheSession.close({
      code: code ?? 0,
      reason: (msg ?? '').substring(0, 1023)
    })
  }

  /**
   * @param {object} [option]
   * @param {bigint|number} [option.code]
   * @param {'transport'|'application'} [option.type]
   * @param {string} [option.reason]
   */
  // eslint-disable-next-line no-unused-vars
  close({ code, type, reason } = {}) {
    const inner = this.#inner
    if (inner.closed) return
    this.closeWebtransportSessionStream(Number(code ?? 0), reason)
    inner.closed = true
  }

  /**
   * @param {Uint8Array} datagram
   * @returns {Promise<bigint>}
   */
  async sendDatagram(datagram) {
    const inner = this.#inner
    /** @type {Promise<void>} */
    if (typeof inner.quicheSession === 'undefined') {
      throw new Error('quicheSession is not set')
    }
    const id = inner.datagramsIdNext++
    const { code, message } = await inner.quicheSession.writeDatagram(datagram)
    if (code !== 'success' && code !== 'blocked' && code !== 'tooBig') {
      throw new Error(code + ':' + message)
    }
    return id
  }

  /**
   * @param {object} opts
   * @param {bigint} [opts.sendGroupId]
   * @param {number} [opts.sendOrder]
   * @param {boolean} [opts.incremental]
   * @param {boolean} [opts.waitUntilAvailable]
   * @param {NativeWebTransportSessionControl} [opts.webtransportSession]
   * @param {number} [opts.budget]
   */
  createBidirectionalStream({
    sendGroupId,
    sendOrder,
    waitUntilAvailable,
    // eslint-disable-next-line no-unused-vars
    incremental,
    webtransportSession,
    // eslint-disable-next-line no-unused-vars
    budget
  } = {}) {
    const inner = this.#inner
    if (!inner.quicheSession || !inner.quicheSession.orderBidiStream)
      return Promise.reject(
        new Error('quicheSession not set in orderBidiStrean')
      )

    if (webtransportSession !== this)
      throw new Error(
        'It is unsupported to create a stream for another session'
      )

    /** @type {PromiseWithResolvers<Http3QuicheStream>} */
    const prom = Promise.withResolvers()
    inner.bidiProm.push(prom)
    const notblocked = inner.quicheSession.orderBidiStream({
      sendGroupId: sendGroupId ?? undefined,
      sendOrder: sendOrder ?? 0,
      waitUntilAvailable: waitUntilAvailable ?? true
    })
    if (!notblocked) {
      inner.bidiProm.pop()
      prom.reject(
        new DOMException('No streams available', 'QuotaExceededError')
      )
    }
    return prom.promise
  }

  /**
   * @param {object} opts
   * @param {bigint} [opts.sendGroupId]
   * @param {number} [opts.sendOrder]
   * @param {boolean} [opts.incremental]
   * @param {boolean} [opts.waitUntilAvailable]
   * @param {NativeWebTransportSessionControl} [opts.webtransportSession]
   * @param {number} [opts.budget]
   */
  createUnidirectionalStream({
    sendGroupId,
    sendOrder,
    waitUntilAvailable,
    // eslint-disable-next-line no-unused-vars
    incremental,
    webtransportSession,
    // eslint-disable-next-line no-unused-vars
    budget
  } = {}) {
    const inner = this.#inner
    if (!inner.quicheSession || !inner.quicheSession.orderUnidiStream)
      return Promise.reject(
        new Error('quicheSession not set in orderUnidiStrean')
      )

    if (webtransportSession !== this)
      throw new Error(
        'It is unsupported to create a stream for another session'
      )

    /** @type {PromiseWithResolvers<Http3QuicheStream>} */
    const prom = Promise.withResolvers()
    inner.unidiProm.push(prom)
    const notblocked = inner.quicheSession.orderUnidiStream({
      sendGroupId: sendGroupId ?? undefined,
      sendOrder: sendOrder ?? 0,
      waitUntilAvailable: waitUntilAvailable ?? true
    })
    if (!notblocked) {
      inner.unidiProm.pop()
      prom.reject(
        new DOMException('No streams available', 'QuotaExceededError')
      )
    }
    return prom.promise
  }

  /**  @type {NativeWebTransportSessionStreamCreator["remoteTransportParams"]} */
  get remoteTransportParams() {
    const inner = this.#inner
    if (inner.remoteTransportParams) return inner.remoteTransportParams
    inner.remoteTransportParams = {
      get maxDatagramFrameSize() {
        return (
          (inner.quicheSession &&
            BigInt(inner.quicheSession.getMaxDatagramSize())) ||
          0n
        )
      }
    }
    return inner.remoteTransportParams
  }

  /** @type {OnDatagramCallback} */
  get ondatagram() {
    // @ts-ignore
    return this.#inner.ondatagram
  }

  set ondatagram(fn) {
    const inner = this.#inner
    if (fn === undefined) {
      inner.ondatagram = undefined
    } else {
      // @ts-ignore
      inner.ondatagram = fn.bind(this)
    }
  }

  /** @type {OnWTSessionCloseCallback} */
  get onwtsessionclose() {
    // @ts-ignore
    return this.#inner.onwtsessionclose
  }

  set onwtsessionclose(fn) {
    const inner = this.#inner
    if (fn === undefined) {
      inner.onwtsessionclose = undefined
    } else {
      // @ts-ignore
      inner.onwtsessionclose = fn.bind(this)
    }
  }

  /** @type {OnSessionErrorCallback} */
  get onerror() {
    // @ts-ignore
    return this.#inner.onerror
  }

  set onerror(fn) {
    const inner = this.#inner
    if (fn === undefined) {
      inner.onerror = undefined
    } else {
      // @ts-ignore
      inner.onerror = fn.bind(this)
    }
  }

  /** @type {OnGoawayCallback} */
  get ongoaway() {
    // @ts-ignore
    return this.#inner.ongoaway
  }

  set ongoaway(fn) {
    const inner = this.#inner
    if (fn === undefined) {
      inner.ongoaway = undefined
    } else {
      // @ts-ignore
      inner.ongoaway = fn.bind(this)
    }
  }

  /** @type {OnStreamCallback} */
  get onstream() {
    // @ts-ignore
    return this.#inner.onstream
  }

  set onstream(fn) {
    const inner = this.#inner
    if (fn === undefined) {
      inner.onstream = undefined
    } else {
      // @ts-ignore
      inner.onstream = fn.bind(this)
    }
  }

  get id() {
    // in principle we could retrieve them, but this object will never be exposed
    return null
  }

  get closed() {
    return this.#inner.closedPromise.promise
  }

  /** @type {NativeWebTransportSessionStreamCreator["stats"]} */
  get stats() {
    const inner = this.#inner
    if (inner.stats) return inner.stats

    /** @type {undefined|number} */
    let lastUpdate = undefined
    /** @type {undefined|SessionStats} */
    let lastStats = undefined

    const mayUpdateStats = function () {
      const now = Date.now()
      if (
        !lastStats ||
        (typeof lastUpdate !== 'undefined' && now - lastUpdate > 1)
      ) {
        lastStats = inner.quicheSession?.getSessionStats()
        lastUpdate = now
      }
    }

    inner.stats = {
      get bytesReceived() {
        return 0n
      },
      get bytesSent() {
        mayUpdateStats()
        return BigInt(lastStats?.applicationBytesAcknowledge ?? 0n)
      },
      get smoothedRtt() {
        mayUpdateStats()
        return BigInt(Math.round(lastStats?.smoothedRtt ?? 0))
      },
      get datagramsLost() {
        mayUpdateStats()
        return BigInt(lastStats?.lostOutgoing ?? 0)
      },
      get minRtt() {
        mayUpdateStats()
        return BigInt(Math.round(lastStats?.minRtt ?? 0))
      },
      get rttVar() {
        mayUpdateStats()
        return BigInt(Math.round(lastStats?.rttVariation ?? 0))
      }
    }
    return inner.stats
  }
}
