import { ReadableStream, WritableStream } from './webstreams.js'
import { logger } from './utils.js'
import { WebTransportError } from './error.js'
import { canByteStream } from './features.js'
import { drainableProtocol } from './http2/backports/types.cjs'
import { kSendGroupId } from './session.js'

const pid = typeof process !== 'undefined' ? process.pid : 0
const log = logger(`webtransport:http3wtstream(${pid})`)

export const kErrorReceiveStream = Symbol('kErrorReceiveStream')
export const kErrorSendStream = Symbol('kErrorReceiveStream')

/**
 * WebTransport stream events
 *
 * @typedef {import('./types').NativeHttpWTStream} NativeHttpWTStream
 * @typedef {import('./types').NativeWebTransportStream} NativeWebTransportStream
 * @typedef {import('./types').StreamWriter} StreamWriter
 * @typedef {import('./types').MinimalStreamWriter} MinimalStreamWriter
 * @typedef {import('./types').ReadBuffer} ReadBuffer
 *
 * @typedef {import('./dom').WebTransportReceiveStream} WebTransportReceiveStream
 * @typedef {import('./dom').WebTransportSendStream} WebTransportSendStream
 *
 * @typedef {import('./dom').WebTransportSendGroup} WebTransportSendGroup
 *
 * @typedef {import('./session').StreamControl} StreamControl
 *
 * @typedef {import('stream/web').WritableStreamDefaultController} WritableStreamDefaultController
 */

export class HttpWTStream {
  #inner = {
    __proto__: null,
    /** @type {NativeWebTransportStream|undefined} */
    strobj: undefined,
    /** @type {StreamControl|undefined} */
    parentobj: undefined,
    /** @type {WebTransportSendGroup| undefined} */
    sendGroup: undefined,
    /** @type {number} */
    sendOrder: 0,
    /** @type {boolean} */
    bidirectional: true,
    /** @type {boolean} */
    incoming: false,
    closed: false,
    writableclosed: false,
    readableclosed: false,
    /** @type {WebTransportReceiveStream|undefined} */
    readable: undefined,
    /** @type {WebTransportSendStream|undefined} */
    writable: undefined,
    /** @type {WritableStreamDefaultController|undefined} */
    writableController: undefined,
    /** @type {ReadableByteStreamController|ReadableStreamController<Uint8Array>|undefined} */
    readableController: undefined
  }

  /**
   * @param {object} args
   * @param {NativeWebTransportStream} args.object
   * @param {StreamControl} args.parentobj
   * @param {boolean} args.bidirectional
   * @param {boolean} args.incoming
   * @param {WebTransportSendGroup|undefined} args.sendGroup
   * @param {number} args.sendOrder
   */
  constructor(args) {
    const inner = this.#inner
    // the internal object uses node.js compatible callbacks,
    // instead of direct calls to the js obj
    const strobj = args.object
    const webstrobj = this
    // TODO copy the callbacks over
    strobj.onstopsending = function (code) {
      // on stopsending start
      let parentcleanup = true
      const parentstate = inner.parentobj?.state
      if (
        parentstate === 'closed' ||
        parentstate === 'failed' ||
        typeof parentstate === 'undefined'
      ) {
        log('no parent cleanup as parent was closed or failed')
        parentcleanup = false
      }
      // stop sending
      if (webstrobj.writable) {
        if (parentcleanup) inner.parentobj?.removeSendStream(webstrobj)
        if (!inner.writableclosed) {
          inner.writableclosed = true
          inner.writableController?.error(
            new WebTransportError('StopSending with code:' + (code || 0))
          )
        }
      } else {
        log.error('stopSending without writable')
      }
      // onstopsending end
    }
    strobj.onreset = function (code) {
      // on reset start
      let parentcleanup = true
      const parentstate = inner.parentobj?.state
      if (
        parentstate === 'closed' ||
        parentstate === 'failed' ||
        typeof parentstate === 'undefined'
      ) {
        log('no parent cleanup as parent was closed or failed')
        parentcleanup = false
      }
      // reset stream
      if (webstrobj.readable) {
        if (parentcleanup) inner.parentobj?.removeReceiveStream(webstrobj)
        if (!inner.readableclosed) {
          inner.readableclosed = true
          inner.readableController?.error(
            new WebTransportError('Resetstream with code:' + (code || 0))
          )
        }
      } else {
        log.error('resetStream without readable')
      }
      // on reset end
    }
    inner.strobj = strobj

    inner.parentobj = args.parentobj
    inner.bidirectional = args.bidirectional
    inner.incoming = args.incoming
    inner.closed = false

    inner.sendGroup = args.sendGroup
    inner.sendOrder = args.sendOrder

    const updateSendOrderAndGroup = function () {
      strobj.updateSendOrderAndGroup({
        sendOrder: inner.sendOrder,
        // 0n is reserved for no sendgroup
        // @ts-ignore kSendGroupId is internal
        sendGroupId: inner.sendGroup?.[kSendGroupId] || 0n
      })
    }

    if (inner.bidirectional || inner.incoming) {
      let readableopts

      /**
       * @type {AsyncIterator<Uint8Array<ArrayBufferLike>[]>}
       */
      let readiterator
      /**
       * @type {Promise<IteratorResult<Uint8Array<ArrayBufferLike>[]>> | undefined}
       */
      let readiteratorFirst
      readableopts = {
        start: (
          /** @type {import("stream/web").ReadableByteStreamController} */ controller
        ) => {
          inner.readableController = controller
          // @ts-ignore
          readiterator = strobj[Symbol.asyncIterator]()
          readiteratorFirst = readiterator.next()
        },
        pull: async (
          // eslint-disable-next-line no-unused-vars
          /** @type {import("stream/web").ReadableByteStreamController} */ controller
        ) => {
          if (inner.readableclosed) {
            return Promise.resolve()
          }
          let readprom
          if (!readiteratorFirst) {
            readprom = readiterator.next()
          } else {
            readprom = readiteratorFirst
            readiteratorFirst = undefined
          }
          const { value, done } = await readprom
          if (value)
            for (const chunk of value) {
              controller.enqueue(chunk)
            }
          if (done) controller.close()
        },
        cancel: (/** @type {{ code: number; }} */ reason) => {
          let code = 0
          if (reason && reason.code) {
            if (reason.code < 0) code = 0
            else if (reason.code > 255) code = 255
            else code = reason.code
          }
          inner.readableclosed = true
          inner.parentobj?.removeReceiveStream(this)
          strobj.stopSending(code)
        } // note type bytes will detach the array buffers, we can not allow this.
      }

      if (!canByteStream) {
        // @ts-ignore
        delete readableopts.type
      }
      /** @type {WebTransportReceiveStream} */
      // @ts-expect-error `getStats` property is missing from ReadableStream
      const readable = new ReadableStream(
        // @ts-ignore
        readableopts
      )
      readable.getStats = () => {
        return Promise.resolve({
          timestamp: 0,
          bytesReceived: 0n,
          bytesRead: 0n
        })
      }
      // @ts-ignore
      inner.readable = readable
      inner.parentobj.addReceiveStream(this)
    }
    if (inner.bidirectional || !inner.incoming) {
      inner.writableclosed = false
      /** @type {StreamWriter|MinimalStreamWriter} */
      let writer
      // @ts-expect-error `getStats` property is missing from WritableStream
      inner.writable = new WritableStream(
        {
          start: (/** @type {any} */ controller) => {
            inner.writableController = controller
            writer = strobj.writer
          },
          write: async (/** @type {any} */ chunk) => {
            if (inner.writableclosed) {
              return Promise.resolve()
            }
            let wchunk = chunk
            if (wchunk instanceof ArrayBuffer) {
              wchunk = new Uint8Array(wchunk)
            }
            if (wchunk instanceof Uint8Array) {
              if (wchunk.byteLength === 0) {
                // or should we throw an error ?, Ask the W3C people!
                return
              }
              while (!writer.writeSync(wchunk)) {
                // @ts-ignore
                const drainable = writer[drainableProtocol]()
                if (drainable) await drainable
              }
            } else {
              throw new Error(
                'chunk is not of instance Uint8Array or Arraybuffer'
              )
            }
          },
          close: async () => {
            if (inner.writableclosed) {
              return Promise.resolve()
            }
            inner.writableclosed = true
            const res = writer.endSync()
            if (res < 0) {
              await writer.end()
            }
            inner.parentobj?.removeSendStream(this)
          },
          abort: (
            /** @type {{ code: number|string; errorCode?: bigint }} */ reason
          ) => {
            if (inner.writableclosed) {
              return Promise.resolve()
            }
            inner.writableclosed = true
            let code = 0
            let rcode =
              (typeof reason?.code === 'number' && reason?.code) ||
              Number(reason.errorCode || 0n)
            if (rcode < 0) code = 0
            else if (rcode > 255) code = 255
            else code = rcode
            inner.parentobj?.removeSendStream(this)
            strobj.resetStream(code)
            writer.fail({ errorcode: code })
          }
        },
        { highWaterMark: 4 }
      )

      this.writable.getStats = () => {
        return Promise.resolve({
          timestamp: 0,
          bytesWritten: 0,
          bytesSent: 0,
          bytesAcknowledged: 0
        })
      }
      Object.defineProperties(inner.writable, {
        sendOrder: {
          get: () => {
            return inner.sendOrder
          },
          /**
           * @param {number} value
           */
          set: (value) => {
            if (value !== inner.sendOrder) {
              inner.sendOrder = value
              updateSendOrderAndGroup()
            }
          }
        },
        sendGroup: {
          get: () => {
            return inner.sendGroup
          },
          /**
           * @param {WebTransportSendGroup} value
           */
          set: (value) => {
            if (value !== inner.sendGroup) {
              inner.sendGroup = value
              updateSendOrderAndGroup()
            }
          }
        }
      })
      inner.parentobj.addSendStream(this)
    }
  }

  /** @param { WebTransportError} wterror */
  [kErrorReceiveStream](wterror) {
    const inner = this.#inner
    if (!inner.readableclosed && inner.readableController) {
      inner.readableController.error(wterror)
    }
  }

  /** @param { WebTransportError} wterror */
  [kErrorSendStream](wterror) {
    const inner = this.#inner
    if (!inner.writableclosed && inner.writableController) {
      inner.writableController.error(wterror)
    }
  }

  /** @type {WebTransportSendStream} */
  get writable() {
    const inner = this.#inner
    // @ts-ignore This is ok, as for bidi stream we will always return a stream,
    // otherwise this is not the right interface and will never face anyone outside the lib
    return inner.writable
  }

  /** @type {WebTransportReceiveStream} */
  get readable() {
    const inner = this.#inner
    // @ts-ignore This is ok, as for bidi stream we will always return a stream,
    // otherwise this is not the right interface and will never face anyone outside the lib
    return inner.readable
  }
}
