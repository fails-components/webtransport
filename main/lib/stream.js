import { ReadableStream, WritableStream } from './webstreams.js'
import { logger } from './utils.js'
import { WebTransportError } from './error.js'
import { canByteStream } from './features.js'
import { drainableProtocol } from './http2/backports/types.cjs'

const pid = typeof process !== 'undefined' ? process.pid : 0
const log = logger(`webtransport:http3wtstream(${pid})`)

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
 * @typedef {import('./session').HttpWTSession} HttpWTSession
 *
 * @typedef {import('stream/web').WritableStreamDefaultController} WritableStreamDefaultController
 */

export class HttpWTStream {
  /**
   * @param {object} args
   * @param {NativeWebTransportStream} args.object
   * @param {HttpWTSession} args.parentobj
   * @param {object} args.transport
   * @param {boolean} args.bidirectional
   * @param {boolean} args.incoming
   * @param {WebTransportSendGroup|undefined} args.sendGroup
   * @param {number} args.sendOrder
   */
  constructor(args) {
    // the internal object uses node.js compatible callbacks,
    // instead of direct calls to the js obj
    const strobj = args.object
    const webstrobj = this
    // TODO copy the callbacks over
    strobj.onstopsending = function (code) {
      // on stopsending start
      let parentcleanup = true
      const parentstate = webstrobj.parentobj.state
      if (parentstate === 'closed' || parentstate === 'failed') {
        log('no parent cleanup as parent was closed or failed')
        parentcleanup = false
      }
      // stop sending
      if (webstrobj.writable) {
        if (parentcleanup) webstrobj.parentobj.removeSendStream(webstrobj)
        if (!webstrobj.writableclosed) {
          webstrobj.writableclosed = true
          webstrobj.writableController.error(
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
      const parentstate = webstrobj.parentobj.state
      if (parentstate === 'closed' || parentstate === 'failed') {
        log('no parent cleanup as parent was closed or failed')
        parentcleanup = false
      }
      // reset stream
      if (webstrobj.readable) {
        if (parentcleanup) webstrobj.parentobj.removeReceiveStream(webstrobj)
        if (!webstrobj.readableclosed) {
          webstrobj.readableclosed = true
          webstrobj.readableController.error(
            new WebTransportError('Resetstream with code:' + (code || 0))
          )
        }
      } else {
        log.error('resetStream without readable')
      }
      // on reset end
    }
    this.strobj = strobj

    this.parentobj = args.parentobj
    this.transport = args.transport
    this.bidirectional = args.bidirectional
    this.incoming = args.incoming
    this.closed = false

    this._sendGroup = args.sendGroup
    this._sendOrder = args.sendOrder

    /** @type {WebTransportReceiveStream} */
    this.readable = /** @type {any} */ (undefined)

    /** @type {WebTransportSendStream} */
    this.writable = /** @type {any} */ (undefined)

    if (this.bidirectional || this.incoming) {
      let readableopts

      const strobj = /** @type {NativeWebTransportStream} */ (this.strobj)
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
          this.readableController = controller
          // @ts-ignore
          readiterator = strobj[Symbol.asyncIterator]()
          readiteratorFirst = readiterator.next()
        },
        pull: async (
          // eslint-disable-next-line no-unused-vars
          /** @type {import("stream/web").ReadableByteStreamController} */ controller
        ) => {
          if (this.readableclosed) {
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
          this.readableclosed = true
          this.parentobj.removeReceiveStream(this)
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
      this.readable = readable
      this.parentobj.addReceiveStream(this)
    }
    if (this.bidirectional || !this.incoming) {
      this.writableclosed = false

      const strobj = /** @type {NativeWebTransportStream} */ (this.strobj)
      /** @type {StreamWriter|MinimalStreamWriter} */
      let writer
      // @ts-expect-error `getStats` property is missing from WritableStream
      this.writable = new WritableStream(
        {
          start: (/** @type {any} */ controller) => {
            this.writableController = controller
            writer = strobj.writer
          },
          write: async (/** @type {any} */ chunk) => {
            if (this.writableclosed) {
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
            if (this.writableclosed) {
              return Promise.resolve()
            }
            this.writableclosed = true
            const res = writer.endSync()
            if (res < 0) {
              await writer.end()
            }
            this.parentobj.removeSendStream(this)
          },
          abort: (
            /** @type {{ code: number|string; errorCode?: bigint }} */ reason
          ) => {
            if (this.writableclosed) {
              return Promise.resolve()
            }
            this.writableclosed = true
            let code = 0
            let rcode =
              (typeof reason?.code === 'number' && reason?.code) ||
              Number(reason.errorCode || 0n)
            if (rcode < 0) code = 0
            else if (rcode > 255) code = 255
            else code = rcode
            this.parentobj.removeSendStream(this)
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
      Object.defineProperties(this.writable, {
        sendOrder: {
          get: () => {
            return this._sendOrder
          },
          /**
           * @param {number} value
           */
          set: (value) => {
            if (value !== this._sendOrder) {
              this._sendOrder = value
              this.updateSendOrderAndGroup()
            }
          }
        },
        sendGroup: {
          get: () => {
            return this._sendGroup
          },
          /**
           * @param {WebTransportSendGroup} value
           */
          set: (value) => {
            if (value !== this._sendGroup) {
              this._sendGroup = value
              this.updateSendOrderAndGroup()
            }
          }
        }
      })
      this.parentobj.addSendStream(this)
    }
  }

  updateSendOrderAndGroup() {
    this.strobj.updateSendOrderAndGroup({
      sendOrder: this._sendOrder,
      // 0n is reserved for no sendgroup
      // @ts-ignore _sendGroupId is internal, FIXME convert to symbol
      sendGroupId: this._sendGroup?._sendGroupId || 0n
    })
  }
}
