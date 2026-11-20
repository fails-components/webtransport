/**
 * @typedef {import('http2').Http2Stream} Http2Stream
 * @typedef {import('../dom.js').WebTransportSendGroup} WebTransportSendGroup
 * @typedef {import('../dom.js').WebTransportSendStreamOptions} WebTransportSendStreamOptions
 */
import { ParserBase } from './parserbase.js'
import { FlowController } from './flowcontroller.js'
import { StreamIdManager } from './streamidmanager.js'
import { CapsuleWebTransportStream, kSetStreamId } from './stream.js'

/**
 * @typedef {import('../types').NativeWebTransportSessionControl} NativeWebTransportSessionControl
 * @typedef {import('../types').NativeWebTransportSessionStreamCreator} NativeWebTransportSessionStreamCreator
 * @typedef {import('../types').NativeWebTransportStream} NativeWebTransportStream
 * @typedef {import('./flowcontroller.js').FlowControlable} FlowControlable
 */

// next partially copied from node.js, c.f. the applicable license in backports LICENSE.nodejs

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
 * @typedef {Object} CapsParserControlable
 * @property {() => void} drainWrites
 * @property {(arg: { code: number, reason: string }) => void} closeConnection
 * @property {(arg: { code: number, reason: string }) => void} receiveClose
 * @property {(datagram: Uint8Array) => void} receiveDatagram
 * @property {(error: any) => void} receiveError
 * @property {() => void} receivedGoaway
 * @property {(stream: any) => void} receiveNewStream
 * @property {bigint} receiveWindowSize
 * @property {StreamIdManager} streamIdMngrUni
 * @property {StreamIdManager} streamIdMngrBi
 * @property {FlowController} flowController
 * @property {StreamControlable} streamSessionControl
 * @property {() => void} trySendingUnidirectionalStreams
 * @property {() => void} trySendingBidirectionalStreams
 */

/**
 * @typedef {Object} StreamControlable
 * @property {boolean} connected
 * @property {(arg: { code: number, reason: string }) => void} closeConnection
 * @property {bigint} smoothedRtt
 */

/**
 * @typedef {Object} StreamIdClient
 * @property {() => boolean} canSendMaxStreams
 * @property {(maxStreams: bigint, unidirectional: boolean) => void} sendMaxStreams
 */

/**
 * @callback CreateParserFunction
 * @param {CapsuleWebTransportSession} nativesession
 * @param {CapsParserControlable} sessionControlable
 * @returns {ParserBase}
 */

export class CapsuleWebTransportSession {
  #inner = {
    __proto__: null,
    /** @type {Http2Stream| undefined} */
    stream: undefined,
    /** @type {WebSocket| undefined} */
    ws: undefined,
    /** @type {ParserBase| undefined} */
    capsParser: undefined,
    /** @type {CapsParserControlable| undefined} */
    capsParserControlable: undefined,
    /** @type {boolean} */
    isclient: false,
    /** @type {FlowController| undefined} */
    flowController: undefined,
    /** @type {FlowControlable| undefined} */
    flowControlable: undefined,
    /** @type {StreamIdManager| undefined} */
    streamIdMngrUni: undefined,
    /** @type {StreamIdManager| undefined} */
    streamIdMngrBi: undefined,
    /** @type {StreamIdClient| undefined} */
    streamIdClient: undefined,
    /** @type {StreamControlable|undefined} */
    streamControlable: undefined,

    /** @type {Array<{datagram: Uint8Array, id: bigint, promise: PromiseWithResolvers<bigint>}>} */
    datagramsWaiting: [],
    datagramsIdNext: 1n,
    /** @type {Array<{priority: {sendOrder: number, sendGroupId: bigint}, stream: CapsuleWebTransportStream}>} */
    orderUniStreams: [],
    /** @type {Array<{priority: {sendOrder: number, sendGroupId: bigint}, stream: CapsuleWebTransportStream}>} */
    orderBiStreams: [],

    /** @type {PromiseWithResolvers<void>} */
    closedPromise: Promise.withResolvers(),

    /** @type {NativeWebTransportSessionStreamCreator["stats"]| undefined} */
    stats: undefined,

    /** @type {NativeWebTransportSessionStreamCreator["remoteTransportParams"]| undefined} */
    remoteTransportParams: undefined,

    closed: false,

    /** @type {OnDatagramCallback | undefined} */
    ondatagram: undefined,
    /** @type {OnWTSessionCloseCallback | undefined} */
    onwtsessionclose: undefined,
    /** @type {OnSessionErrorCallback | undefined} */
    onerror: undefined,
    /** @type {OnGoawayCallback | undefined} */
    ongoaway: undefined,
    /**@type {OnStreamCallback | undefined} */
    onstream: undefined
  }
  /**
   * @param {{stream?: Http2Stream, ws?: WebSocket, isclient:boolean,
   * createParser: CreateParserFunction
   * sendWindowOffset: Number,
   * receiveWindowOffset: Number,
   * shouldAutoTuneReceiveWindow: boolean
   * receiveWindowSizeLimit: Number,
   * initialBidirectionalSendStreams: Number,
   * initialBidirectionalReceiveStreams: Number,
   * initialUnidirectionalSendStreams: Number,
   * initialUnidirectionalReceiveStreams: Number}} args
   * */
  constructor({
    stream,
    ws,
    isclient,
    createParser,
    sendWindowOffset,
    receiveWindowOffset,
    shouldAutoTuneReceiveWindow,
    receiveWindowSizeLimit,
    initialBidirectionalSendStreams,
    initialBidirectionalReceiveStreams,
    initialUnidirectionalSendStreams,
    initialUnidirectionalReceiveStreams
  }) {
    const inner = this.#inner
    if (stream) {
      inner.stream = stream
    } else if (ws) {
      inner.ws = ws
    } else throw new Error('Neither stream or websocket supplied')
    inner.capsParser = createParser(this, this.#capsParserControlable)
    inner.isclient = isclient
    inner.flowController = new FlowController({
      tocontrol: this.#flowControlable,
      sendWindowOffset,
      receiveWindowOffset,
      shouldAutoTuneReceiveWindow,
      receiveWindowSizeLimit
    })
    inner.streamIdMngrUni = new StreamIdManager({
      delegate: this.#streamIdClient,
      unidirectional: true,
      isclient,
      maxAllowedIncomingStreams: initialUnidirectionalReceiveStreams,
      maxAllowedOutgoingStreams: initialUnidirectionalSendStreams
    })
    inner.streamIdMngrBi = new StreamIdManager({
      delegate: this.#streamIdClient,
      unidirectional: false,
      isclient,
      maxAllowedIncomingStreams: initialBidirectionalReceiveStreams,
      maxAllowedOutgoingStreams: initialBidirectionalSendStreams
    })

    this.#maySendInitialParameters()

    /*
    if (stream) {
      processnextTick(() => {
        this.jsobj.onReady({})
      })
    }
      */
  }

  #maySendInitialParameters() {
    const inner = this.#inner
    let skip = false //skips the initial parameters at environment with settings
    if (typeof process !== 'undefined') {
      if (process.version) {
        const majorVersion = parseInt(
          process.version.split('.')[0].substring(1)
        )
        if (majorVersion >= 20) skip = true
      }
    }
    if (
      !inner.capsParser ||
      !inner.flowController ||
      !inner.streamIdMngrBi ||
      !inner.streamIdMngrUni
    )
      throw new Error('No capsParser etc set in sendInitialParameters')
    if (!skip || inner.capsParser.initialParametersMandatory()) {
      inner.flowController.sendWindowUpdate()
      inner.streamIdMngrBi.sendMaxStreamsFrameInitial()
      inner.streamIdMngrUni.sendMaxStreamsFrameInitial()
    }
  }

  /**
   * @param {Uint8Array} datagram
   * @returns {Promise<bigint>}
   */
  sendDatagram(datagram) {
    const inner = this.#inner
    if (!inner.capsParser) throw new Error('No capsParser in writeDatagrams')
    if (datagram.byteLength > this.#getMaxDatagramSize())
      throw new Error('Datagramsize exceeds maxDatagramSize')
    const id = inner.datagramsIdNext++
    if (inner.capsParser.blocked) {
      /** @type {PromiseWithResolvers<bigint>} */
      const promise = Promise.withResolvers()
      inner.datagramsWaiting.push({ datagram, id, promise })
      inner.capsParser.scheduleDrainWrites()
      return promise.promise
    }
    inner.capsParser.writeCapsule({
      type: ParserBase.DATAGRAM,
      headerVints: [],
      payload: [datagram]
    })
    return Promise.resolve(id)
  }

  #trySendingUnidirectionalStreams() {
    const inner = this.#inner
    if (!inner.streamIdMngrUni || !inner.capsParser) return
    while (
      inner.orderUniStreams.length > 0 &&
      inner.streamIdMngrUni.canOpenNextOutgoingStream()
    ) {
      const streamid = inner.streamIdMngrUni.getNextOutgoingStreamId()
      const item = inner.orderUniStreams.pop()
      if (!item) {
        throw new Error('Expected item in orderUniStreams')
      }
      const { priority, stream } = item
      stream[kSetStreamId](streamid)
      inner.capsParser.writeCapsule({
        type: ParserBase.WT_STREAM_WOFIN,
        headerVints: [streamid],
        payload: undefined
      })
      inner.capsParser.registerNewStream(
        stream,
        streamid,
        priority || { sendGroupId: 0n, sendOrder: 0 },
        false
      )
    }
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
    budget
  } = {}) {
    const inner = this.#inner
    if (!inner.streamIdMngrUni) return Promise.reject()
    const canopen = inner.streamIdMngrUni.canOpenNextOutgoingStream()
    const maxset = inner.streamIdMngrUni.isMaxStreamSet() // we block if the maxsetting did not arrive

    if (webtransportSession !== this)
      throw new Error(
        'It is unsupported to create a stream for another session'
      )
    if (!inner.flowController)
      throw new Error('flowController not inited, when creating stream')
    if (!inner.capsParser)
      throw new Error('CapsuleParser not inited, when creating stream')
    if (canopen || waitUntilAvailable || !maxset) {
      const stream = new CapsuleWebTransportStream({
        unidirectional: true,
        incoming: false,
        sessionControl: this.#streamControlable,
        budget,
        capsuleParser: inner.capsParser,
        sessionFlowController: inner.flowController,
        streamIdManager: inner.streamIdMngrUni,
        sendGroupId: sendGroupId ?? 0n,
        sendOrder: sendOrder ?? 0
      })

      inner.orderUniStreams.push({
        priority: { sendGroupId: sendGroupId ?? 0n, sendOrder: sendOrder ?? 0 },
        stream
      })
      this.#trySendingUnidirectionalStreams()
      return Promise.resolve(stream)
    }
    return Promise.reject()
  }

  #trySendingBidirectionalStreams() {
    const inner = this.#inner
    if (!inner.streamIdMngrBi || !inner.capsParser) return
    while (
      inner.orderBiStreams.length > 0 &&
      inner.streamIdMngrBi.canOpenNextOutgoingStream()
    ) {
      const streamid = inner.streamIdMngrBi.getNextOutgoingStreamId()
      const item = inner.orderBiStreams.pop()
      if (!item) {
        throw new Error('Expected item in orderBiStreams')
      }
      const { priority, stream } = item
      inner.capsParser.writeCapsule({
        type: ParserBase.WT_STREAM_WOFIN,
        headerVints: [streamid],
        payload: undefined
      })
      stream[kSetStreamId](streamid)
      inner.capsParser.registerNewStream(
        stream,
        streamid,
        priority || { sendGroupId: 0n, sendOrder: 0 },
        false
      )
    }
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
    budget
  } = {}) {
    const inner = this.#inner
    if (!inner.streamIdMngrBi) return Promise.reject()
    const canopen = inner.streamIdMngrBi.canOpenNextOutgoingStream()
    const maxset = inner.streamIdMngrBi.isMaxStreamSet() // we block if the maxsetting did not arrive

    if (webtransportSession !== this)
      throw new Error(
        'It is unsupported to create a stream for another session'
      )
    if (!inner.flowController)
      throw new Error('flowController not inited, when creating stream')
    if (!inner.capsParser)
      throw new Error('CapsuleParser not inited, when creating stream')
    if (canopen || waitUntilAvailable || !maxset) {
      const stream = new CapsuleWebTransportStream({
        unidirectional: false,
        incoming: false,
        sessionControl: this.#streamControlable,
        budget,
        capsuleParser: inner.capsParser,
        sessionFlowController: inner.flowController,
        streamIdManager: inner.streamIdMngrBi,
        sendGroupId: sendGroupId ?? 0n,
        sendOrder: sendOrder ?? 0
      })

      inner.orderBiStreams.push({
        priority: { sendGroupId: sendGroupId ?? 0n, sendOrder: sendOrder ?? 0 },
        stream
      })
      this.#trySendingBidirectionalStreams()
      return Promise.resolve(stream)
    }
    return Promise.reject()
  }

  #getMaxDatagramSize() {
    return 16384 // this completly arbitry, we do not have a real restriction, but we choose more than quiche, to make things interesting
  }

  /*
   * @returns {void}
   */
  notifySessionDraining() {}
  /**
   * Only for webtransport session streams
   * Closes the webtransport session stream, and also closes
   * connected datastream internally.
   * @param {number|undefined} code optional error code
   * @param {string|undefined} msg optional error message truncated to 1024 bytes
   */
  closeWebtransportSessionStream(code, msg) {
    const inner = this.#inner
    if (!inner.capsParser) return
    inner.capsParser.sendClose({ code: code ?? 0, reason: msg ?? '' }) // this includes for ws closing the session!
    // should also close the stream
    inner.datagramsWaiting.forEach((el) =>
      el.promise.reject(new Error(msg ?? 'Webtransport Session was closed'))
    )
    inner.closed = true
    inner.closedPromise.resolve()
  }

  // this comes from quic session, may be we should also close the underlying stream ?
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
   * @type {FlowControlable}
   */
  get #flowControlable() {
    const inner = this.#inner
    if (inner.flowControlable) return inner.flowControlable

    const session = this

    /**
     * @param {bigint} windowOffset
     */
    const sendBlocked = function (windowOffset) {
      if (!inner.capsParser) return
      inner.capsParser.writeCapsule({
        type: ParserBase.WT_DATA_BLOCKED,
        headerVints: [windowOffset],
        payload: undefined
      })
    }

    const connected = function () {
      return !inner.closed
    }

    /**
     * @param {bigint} windowOffset
     */
    const sendWindowUpdate = function (windowOffset) {
      if (!inner.capsParser) return
      inner.capsParser.writeCapsule({
        type: ParserBase.WT_MAX_DATA,
        headerVints: [windowOffset],
        payload: undefined
      })
    }

    /**
     * @param {{ code: number, reason: string }} arg
     */
    const closeConnection = function ({ code, reason }) {
      session.#closeConnection({ code, reason })
    }

    const smoothedRtt = function () {
      return session.#smoothedRtt()
    }

    inner.flowControlable = {
      closeConnection,
      connected,
      sendBlocked,
      sendWindowUpdate,
      smoothedRtt
    }
    return inner.flowControlable
  }

  get #capsParserControlable() {
    const inner = this.#inner
    if (inner.capsParserControlable) return inner.capsParserControlable

    const session = this

    /**
     * @param {Uint8Array} datagram
     */
    const receiveDatagram = function (datagram) {
      session.ondatagram?.(datagram)
    }

    const receivedGoaway = function () {
      session.ongoaway?.()
    }

    /**
     * @param {CapsuleWebTransportStream} stream
     */
    const receiveNewStream = function (stream) {
      inner.onstream?.call(session, stream)
    }

    /**
     * @param {{ code: number, reason: string }} arg
     */
    const closeConnection = function ({ code, reason }) {
      session.#closeConnection({ code, reason })
    }

    /**
     * @param {{ code: number, reason: string }} arg
     */
    const receiveClose = function ({ code, reason }) {
      // called in case of failure in parsing or flowcontrol
      inner.onwtsessionclose?.call(session, code, reason)
    }

    /**
     * @param {any} error
     * @returns
     */
    const receiveError = function (error) {
      inner.onerror?.call(session, error)
    }

    const trySendingBidirectionalStreams = function () {
      session.#trySendingBidirectionalStreams()
    }
    const trySendingUnidirectionalStreams = function () {
      session.#trySendingUnidirectionalStreams()
    }

    const drainWrites = function () {
      if (!inner.capsParser) return
      while (!inner.capsParser.blocked && inner.datagramsWaiting.length > 0) {
        const outChunk = inner.datagramsWaiting.shift()
        if (outChunk?.datagram) {
          inner.capsParser.writeCapsule({
            type: ParserBase.DATAGRAM,
            headerVints: [],
            payload: [outChunk.datagram]
          })
          outChunk.promise.resolve(outChunk.id)
        } else {
          // should never happen
          outChunk?.promise.reject(new Error('internal error'))
        }
      }
      if (inner.datagramsWaiting.length > 0) {
        inner.capsParser.scheduleDrainWrites()
      }
    }

    const controlable = (inner.capsParserControlable = {
      closeConnection,
      drainWrites,
      receiveClose,
      receiveDatagram,
      receiveError,
      receivedGoaway,
      receiveNewStream,
      trySendingBidirectionalStreams,
      trySendingUnidirectionalStreams,
      get receiveWindowSize() {
        return inner.flowController?.receiveWindowSize ?? 0n
      },
      /**
       * @type {StreamIdManager}
       */
      get streamIdMngrBi() {
        // @ts-ignore
        return inner.streamIdMngrBi
      },
      /**
       * @type {StreamIdManager}
       */
      get streamIdMngrUni() {
        // @ts-ignore
        return inner.streamIdMngrUni
      },
      /**
       * @type {FlowController}
       */
      get flowController() {
        // @ts-ignore
        return inner.flowController
      },
      /**
       * @type {StreamControlable}
       */
      get streamSessionControl() {
        return inner.streamControlable ?? session.#streamControlable
      }
    })

    return controlable
  }

  get #streamControlable() {
    const inner = this.#inner
    if (inner.streamControlable) return inner.streamControlable

    const session = this

    /**
     * @param {{ code: number, reason: string }} arg
     */
    const closeConnection = function ({ code, reason }) {
      session.#closeConnection({ code, reason })
    }

    const controlable = (inner.streamControlable = {
      closeConnection,
      get connected() {
        return !inner.closed
      },
      get smoothedRtt() {
        return BigInt(session.#smoothedRtt())
      }
    })
    return controlable
  }

  /**
   * @param {{ code: number, reason: string }} arg
   */
  #closeConnection({ code, reason }) {
    // called in case of failure in parsing or flowcontrol
    this.#inner.onwtsessionclose?.call(this, code, reason)
    this.closeWebtransportSessionStream(code, reason)
  }

  #smoothedRtt() {
    const inner = this.#inner
    let toret
    if (inner.stream) {
      // we are on node
      // @ts-ignore
      toret = inner.stream.session?.WTrtt || 25
    } else if (inner.ws) {
      // we are at the Browser, so we use the connection rtt?
      // @ts-ignore
      // eslint-disable-next-line no-undef
      toret = navigator?.connection?.rtt || 25
    }
    toret = Math.ceil(toret / 25) * 25 // to do be to accurate!
    return toret
  }

  get #streamIdClient() {
    const inner = this.#inner
    if (inner.streamIdClient) return inner.streamIdClient

    //const session = this

    /**
     * @returns {boolean}
     */
    const canSendMaxStreams = function () {
      return true
    }

    /**
     * @param {bigint} maxStreams
     * @param {boolean} unidirectional
     */
    const sendMaxStreams = function (maxStreams, unidirectional) {
      if (!inner.capsParser) return
      inner.capsParser.writeCapsule({
        type: unidirectional
          ? ParserBase.WT_MAX_STREAMS_UNIDI
          : ParserBase.WT_MAX_STREAMS_BIDI,
        headerVints: [maxStreams],
        payload: undefined
      })
    }

    const streamIdClient = (inner.streamIdClient = {
      sendMaxStreams,
      canSendMaxStreams
    })
    return streamIdClient
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
      // validateFunction(fn, 'ondatagram')
      // inner.ondatagram = FunctionPrototypeBind(fn, this);
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
      // validateFunction(fn, 'onwtsessionclose')
      // inner.onwtsessionclose = FunctionPrototypeBind(fn, this);
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
      // validateFunction(fn, 'onerror')
      // inner.onerror = FunctionPrototypeBind(fn, this);
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
      // validateFunction(fn, 'ongoaway')
      // inner.ongoaway = FunctionPrototypeBind(fn, this);
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
      // validateFunction(fn, 'onstream')
      // inner.onstream = FunctionPrototypeBind(fn, this);
      // @ts-ignore
      inner.onstream = fn.bind(this)
    }
  }

  get closed() {
    return this.#inner.closedPromise.promise
  }

  get id() {
    return null
  }

  /** @type {NativeWebTransportSessionStreamCreator["stats"]} */
  get stats() {
    const inner = this.#inner
    if (inner.stats) return inner.stats
    const session = this

    inner.stats = {
      get bytesReceived() {
        return inner.flowController?.bytesConsumed ?? 0n
      },
      get bytesSent() {
        return inner.flowController?.bytesSent ?? 0n
      },
      get smoothedRtt() {
        return BigInt(session.#smoothedRtt())
      },
      get datagramsLost() {
        return 0n
      },
      get minRtt() {
        return 0n
      },
      get rttVar() {
        return 0n
      }
    }
    return inner.stats
  }

  /**  @type {NativeWebTransportSessionStreamCreator["remoteTransportParams"]} */
  get remoteTransportParams() {
    const inner = this.#inner
    if (inner.remoteTransportParams) return inner.remoteTransportParams
    const session = this
    inner.remoteTransportParams = {
      get maxDatagramFrameSize() {
        return BigInt(session.#getMaxDatagramSize())
      }
    }
    return inner.remoteTransportParams
  }
}
