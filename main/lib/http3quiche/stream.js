// @ts-ignore
import { drainableProtocol } from '../index.node.js'
/**
 * @typedef {import('../types').OnStreamErrorCallback} OnStreamErrorCallback
 * @typedef {import('../types').NativeHttpWTStream} NativeHttpWTStream
 * @typedef {import('../types').MinimalStreamWriter} MinimalStreamWriter
 */

/**
 * @export
 * @typedef {Object} MessageReceiver
 * @property {() => void} onCanRead
 * @property {() => void} onCanWrite
 * @property {(code: number) => void} onStopSending
 * @property {(code: number) => void} onResetStream
 */

/**
 * @param {{ readerWait: PromiseWithResolvers<void>|undefined; readerWaitTimeOut: boolean; }} inner
 */
function handleReaderWake(inner) {
  const wait = inner.readerWait
  inner.readerWait = undefined
  inner.readerWaitTimeOut = false
  wait?.resolve()
}

/**
 * @param {{ writerWait: PromiseWithResolvers<void>|undefined; writerWaitTimeOut: boolean; }} inner
 */
function handleWriterWake(inner) {
  const wait = inner.writerWait
  inner.writerWait = undefined
  inner.writerWaitTimeOut = false
  wait?.resolve()
}

export class Http3QuicheStream {
  #inner = {
    __proto__: null,
    /** @type {MessageReceiver | undefined} */
    messageReceiver: undefined,
    /** @type {NativeHttpWTStream | undefined} */
    quicheStream: undefined,

    iteratorLocked: false,

    canread: false,

    /** @type {PromiseWithResolvers<void>|undefined} */
    readerWait: undefined,
    /** @type {boolean} */
    readerWaitTimeOut: false,
    /** @type {PromiseWithResolvers<void>|undefined} */
    writerWait: undefined,
    /** @type {boolean} */
    writerWaitTimeOut: false,
    /** @type {MinimalStreamWriter|undefined} */
    writer: undefined,
    /* callbacks */
    /** @type {OnStreamErrorCallback | undefined} */
    onreset: undefined,
    /** @type {OnStreamErrorCallback | undefined} */
    onstopsending: undefined
  }

  /**
   * @param {Object} options
   * @param {NativeHttpWTStream} options.quicheStream
   */

  constructor({ quicheStream }) {
    const inner = this.#inner

    inner.quicheStream = quicheStream
    quicheStream.jsobj = this.messageReceiver // FIXME the jsobj mechanism, may not be the fastest
  }

  /**
   * @param {number|bigint} code
   */
  stopSending(code) {
    const inner = this.#inner
    inner.quicheStream?.stopSending(Number(code))
  }

  /**
   * @param {number|bigint} code
   */
  resetStream(code) {
    const inner = this.#inner
    inner.quicheStream?.resetStream(Number(code))
  }

  // portions from node.js's QuicStream, see node.js license in backports dir
  /**
   * Returns an AsyncIterator that yields Uint8Array[] batches of
   * incoming data. Only one iterator can be obtained per stream.
   * Non-readable streams return an immediately-finished iterator.
   * @yields {Uint8Array[]}
   */
  async *[Symbol.asyncIterator]() {
    const inner = this.#inner
    if (inner.iteratorLocked) {
      throw new Error('Stream is already being read')
    }
    if (typeof inner.quicheStream === 'undefined')
      throw new Error('quichestream not set')
    inner.iteratorLocked = true
    while (true) {
      inner.canread = false
      const { data, fin } = inner.quicheStream.pullData()
      if (typeof data !== 'undefined') {
        yield [new Uint8Array(data)]
      }

      if (fin) {
        return
      }

      if (!inner.canread) {
        const wait = (inner.readerWait = Promise.withResolvers())
        // wait for promise to fulfill
        await wait.promise
      }
    }
  }

  // callbacks setter and getters
  /** @type {OnStreamErrorCallback} */
  get onreset() {
    // @ts-ignore
    return this.#inner.onreset
  }

  set onreset(fn) {
    const inner = this.#inner
    if (fn === undefined) {
      inner.onreset = undefined
    } else {
      // validateFunction(fn, 'onreset')
      // inner.onreset = FunctionPrototypeBind(fn, this)
      // @ts-ignore
      inner.onreset = fn.bind(this)
    }
  }

  /** @type {OnStreamErrorCallback} */
  get onstopsending() {
    // @ts-ignore
    return this.#inner.onstopsending
  }

  set onstopsending(fn) {
    const inner = this.#inner
    if (fn === undefined) {
      inner.onstopsending = undefined
    } else {
      // validateFunction(fn, 'onstopsending')
      // inner.onstopsending = FunctionPrototypeBind(fn, this);
      // @ts-ignore
      inner.onstopsending = fn.bind(this)
    }
  }

  get writer() {
    const inner = this.#inner
    if (inner.writer !== undefined) return inner.writer

    if (typeof inner.quicheStream === 'undefined')
      throw new Error('quichestream not set')

    const qstream = inner.quicheStream

    // we implement only the minimal set of functions

    /**
     *
     * @param {Uint8Array| Uint8Array[]} input
     */
    const writeSync = function (input) {
      let chunks
      if (input instanceof Uint8Array) {
        chunks = [input]
      } else {
        chunks = input
      }
      return qstream.writeChunks(chunks)
    }

    const endSync = function () {
      inner.quicheStream?.streamFinal()
      return 1
    }

    /**
     *
     * @param {object} input
     * @param {number} input.errorcode
     */
    const fail = function ({ errorcode }) {
      inner.quicheStream?.resetStream(errorcode)
    }

    const writer = {
      fail,
      writeSync,
      endSync,
      end: endSync,
      [drainableProtocol]() {
        if (typeof inner.writerWait !== 'undefined')
          return inner.writerWait.promise
        inner.writerWait = Promise.withResolvers()
        return inner.writerWait.promise
      }
    }
    inner.writer = writer
    return /** @type {MinimalStreamWriter} */ (writer)
  }

  get messageReceiver() {
    const inner = this.#inner
    const stream = this
    if (inner.messageReceiver) return inner.messageReceiver

    const onStopSending = function (/** @type {number} */ code) {
      process.nextTick(() => {
        inner.onstopsending?.call(stream, code)
      })
    }

    const onResetStream = function (/** @type {number} */ code) {
      process.nextTick(() => {
        inner.onreset?.call(stream, code)
      })
    }

    const onCanRead = function () {
      inner.canread = true
      if (inner.readerWait && !inner.readerWaitTimeOut) {
        inner.readerWaitTimeOut = true
        setTimeout(handleReaderWake, 0, inner)
      }
    }

    const onCanWrite = function () {
      if (inner.writerWait && !inner.writerWaitTimeOut) {
        inner.writerWaitTimeOut = true
        setTimeout(handleWriterWake, 0, inner)
      }
    }

    return (inner.messageReceiver = {
      onCanRead,
      onCanWrite,
      onStopSending,
      onResetStream
    })
  }

  /**
   *
   * @param {{sendOrder: number, sendGroupId: bigint}} args
   */
  updateSendOrderAndGroup({ sendOrder, sendGroupId }) {
    const inner = this.#inner
    inner.quicheStream?.updateSendOrderAndGroup({ sendOrder, sendGroupId })
  }
}
