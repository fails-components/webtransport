import { ReadableStream, WritableStream } from './webstreams.js'
import { logger } from './utils.js'
import { WebTransportError } from './error.js'
import { canByteStream } from './features.js'
import { drainableProtocol } from './http2/backports/types.cjs'

const pid = typeof process !== 'undefined' ? process.pid : 0
const log = logger(`webtransport:http3wtstream(${pid})`)

/**
 * WebTransport stream events
 * @typedef {import('./types').WebTransportStreamEventHandler} WebTransportStreamEventHandler
 * @typedef {import('./types').StreamRecvSignalEvent} StreamRecvSignalEvent
 * @typedef {import('./types').StreamReadEvent} StreamReadEvent
 * @typedef {import('./types').StreamWriteEvent} StreamWriteEvent
 * @typedef {import('./types').StreamNetworkFinishEvent} StreamNetworkFinishEvent
 *
 * @typedef {import('./types').NativeHttpWTStream} NativeHttpWTStream
 * @typedef {import('./types').NativeWebTransportStream} NativeWebTransportStream
 * @typedef {import('./types').StreamWriter} StreamWriter
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
   * @param {NativeHttpWTStream|NativeWebTransportStream} args.object
   * @param {HttpWTSession} args.parentobj
   * @param {object} args.transport
   * @param {boolean} args.bidirectional
   * @param {boolean} args.incoming
   * @param {WebTransportSendGroup|undefined} args.sendGroup
   * @param {number} args.sendOrder
   */
  constructor(args) {
    let legacyInterface = true
    if ('onstopsending' in args.object) {
      legacyInterface = false
      // the internal object uses node.js compatible callbacks,
      // instead of direct calls to the js obj
      const strobj = /** @type {NativeWebTransportStream} */ (args.object)
      const webstrobj = this
      // TODO copy the callbacks over
      strobj.onstopsending = function (code) {
        webstrobj.onStreamRecvSignal?.({
          nettask: 'stopSending',
          code
        })
      }
      strobj.onreset = function (code) {
        webstrobj.onStreamRecvSignal?.({
          nettask: 'resetStream',
          code
        })
      }
      this.strobj = strobj
    } else {
      const strobj = /** @type {NativeHttpWTStream} */ (args.object)
      this.objint = strobj
      strobj.jsobj = this
    }
    this.parentobj = args.parentobj
    this.transport = args.transport
    this.bidirectional = args.bidirectional
    this.incoming = args.incoming
    this.closed = false

    this._sendGroup = args.sendGroup
    this._sendOrder = args.sendOrder

    if (legacyInterface) this.objint?.sendInitialParameters?.()

    /** @type {Promise<void> | null} */
    this.pendingoperation = null
    this.pendingres = null

    /** @type {WebTransportReceiveStream} */
    this.readable = /** @type {any} */ (undefined)

    /** @type {WebTransportSendStream} */
    this.writable = /** @type {any} */ (undefined)

    /** @type {Promise<void> | null} */
    this.pendingoperationRead = null
    this.pendingresRead = null

    if (this.bidirectional || this.incoming) {
      let readableopts
      if (legacyInterface) {
        readableopts = {
          start: (
            /** @type {import("stream/web").ReadableByteStreamController} */ controller
          ) => {
            this.readableController = controller
            // @ts-ignore
            this.objint.startReading()
          },
          pull: async (
            // eslint-disable-next-line no-unused-vars
            /** @type {import("stream/web").ReadableByteStreamController} */ controller
          ) => {
            if (this.readableclosed) {
              return Promise.resolve()
            }
            // eslint-disable-next-line no-unused-vars
            this.pendingoperationRead = new Promise((resolve, reject) => {
              this.pendingresRead = resolve
            })
            // @ts-ignore
            this.objint.startReading()
            await this.pendingoperationRead
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
            // @ts-ignore
            this.objint.stopSending(code)
          },
          type: 'bytes',
          // @ts-ignore
          autoAllocateChunkSize: 4096 // lets take this as buffer size
        }
      } else {
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
      /** @type {WebTransportSendStream} */
      if (legacyInterface) {
        // @ts-expect-error `getStats` property is missing from WritableStream
        this.writable = new WritableStream(
          {
            start: (/** @type {any} */ controller) => {
              this.writableController = controller
            },
            // eslint-disable-next-line no-unused-vars
            write: (/** @type {any} */ chunk) => {
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
                // eslint-disable-next-line no-unused-vars
                this.pendingoperation = new Promise((resolve, reject) => {
                  this.pendingres = resolve
                })
                // @ts-ignore
                this.objint.writeChunk(wchunk)
                return this.pendingoperation
              } else {
                log.trace('chunk info:', chunk)
                throw new Error(
                  'chunk is not of instance Uint8Array or Arraybuffer'
                )
              }
            },
            close: () => {
              if (this.writableclosed) {
                return Promise.resolve()
              }
              this.writableclosed = true
              // @ts-ignore
              this.objint.streamFinal()
              this.parentobj.removeSendStream(this)
              // eslint-disable-next-line no-unused-vars
              this.pendingoperation = new Promise((resolve, reject) => {
                this.pendingres = resolve
              })
              return this.pendingoperation
            },
            abort: (/** @type {{ code: number; }} */ reason) => {
              if (this.writableclosed) {
                return Promise.resolve()
              }
              this.writableclosed = true
              let code = 0
              if (reason && reason.code) {
                if (reason.code < 0) code = 0
                else if (reason.code > 255) code = 255
                else code = reason.code
              }
              this.parentobj.removeSendStream(this)
              /** @type {Promise<void>} */
              // eslint-disable-next-line no-unused-vars
              const promise = new Promise((resolve, reject) => {
                this.abortres = resolve
              })
              this.objint?.resetStream(code)
              return promise
            }
          },
          { highWaterMark: 4 }
        )
      } else {
        const strobj = /** @type {NativeWebTransportStream} */ (this.strobj)
        /** @type {StreamWriter} */
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
      }
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

    /** @type {(() => void) | null} */
    this.cancelres = null
    /** @type {(() => void) | null} */
    this.pendingres = null
    /** @type {(() => void) | null} */
    this.abortres = null

    this.finaldrain_ = false
  }

  /**
   * @param {{byteSize: number}} args
   * @returns {ReadBuffer|undefined}
   */
  getReadBuffer({ byteSize }) {
    const byob = this.readableController.byobRequest
    if (byob) {
      // @ts-ignore
      const buffer = byob?.view
      // @ts-ignore
      if (!(buffer instanceof Uint8Array)) {
        throw new Error('byob view is not a Uint8Array')
      }
      return { buffer, byob, readBytes: 0, fin: false }
    } else {
      const buffer = new Uint8Array(byteSize)
      return { buffer, byob: undefined, readBytes: 0, fin: false }
    }
  }

  hasByob() {
    return !!this.readableController.byobRequest
  }

  /**
   * @param {ReadBuffer} args
   */
  commitReadBuffer({ buffer, byob, drained, readBytes, fin }) {
    if (!this.readableclosed) {
      if (byob && readBytes !== undefined) {
        byob.respond(readBytes)
      } else if (buffer) {
        this.readableController.enqueue(buffer)
      }
    }
    const retObj = {}

    if (readBytes !== undefined && readBytes > 0 && !this.readableclosed) {
      log.trace('commitReadbuffer', readBytes)
      // console.log('stream read received', args.data, Date.now())
      if (this.pendingoperationRead && drained) {
        if (this.readableController.desiredSize != null && !this.finaldrain_) {
          if (this.readableController.desiredSize < 0) retObj.stopReading = true
        }
        // this.readableController.enqueue(data)
        const res = this.pendingresRead
        this.pendingoperationRead = null
        this.pendingresRead = null
        if (res) res()
      }
    }
    if (fin) {
      if (this.cancelres) {
        const res = this.cancelres
        this.cancelres = null
        res()
      }
      const parentstate = this.parentobj.state
      if (parentstate === 'closed' || parentstate === 'failed') {
        log('no parent cleanup for fin as parent was closed or failed')
      } else {
        this.parentobj.removeReceiveStream(this)
      }
      if (!this.readableclosed) {
        this.readableController.close()
        this.readableclosed = true
      }
    }
    return retObj
  }

  updateSendOrderAndGroup() {
    // @ts-ignore
    ;(this.objint || this.strobj).updateSendOrderAndGroup({
      sendOrder: this._sendOrder,
      // 0n is reserved for no sendgroup
      // @ts-ignore _sendGroupId is internal, FIXME convert to symbol
      sendGroupId: this._sendGroup?._sendGroupId || 0n
    })
  }

  /**
   * @param {import('./types').StreamRecvSignalEvent} args
   * @returns {void}
   */
  onStreamRecvSignal(args) {
    log('callback', args?.nettask)
    log.trace('onStreamRecvSignal', args)
    // check if transport is closed
    let parentcleanup = true
    const parentstate = this.parentobj.state
    if (parentstate === 'closed' || parentstate === 'failed') {
      log('no parent cleanup as parent was closed or failed')
      parentcleanup = false
    }
    switch (args.nettask) {
      case 'resetStream':
        if (this.readable) {
          if (this.objint) {
            this.objint?.drainReads()
          }
          this.finaldrain_ = true
          if (parentcleanup) this.parentobj.removeReceiveStream(this)
          if (!this.readableclosed) {
            this.readableclosed = true
            this.readableController.error(
              new WebTransportError('Resetstream with code:' + (args.code || 0))
            )
          }
        } else {
          log.error('resetStream without readable')
        }
        break

      case 'stopSending':
        if (this.writable) {
          if (parentcleanup) this.parentobj.removeSendStream(this)
          if (!this.writableclosed) {
            this.writableclosed = true
            this.writableController.error(
              new WebTransportError('StopSending with code:' + (args.code || 0))
            )
          }
        } else {
          log.error('stopSending without writable')
        }
        break
      default:
        log.error('unhandled onStreamRecvSignal')
    }

    if (this.pendingoperation) {
      const res = this.pendingres
      this.pendingoperation = null
      this.pendingres = null
      if (res != null) {
        res()
      }
    }
    if (this.pendingoperationRead) {
      const res = this.pendingresRead
      this.pendingoperationRead = null
      this.pendingresRead = null
      if (res != null) {
        res()
      }
    }
  }

  /**
   * @param {StreamWriteEvent} args
   */
  // eslint-disable-next-line no-unused-vars
  onStreamWrite(args) {
    // we ignore success
    if (this.pendingoperation) {
      const res = this.pendingres
      this.pendingoperation = null
      this.pendingres = null
      if (res != null) {
        res()
      }
    }
  }

  // Finishing after we send something, now only fin, todo also remove  or move this
  /**
   * @param {StreamNetworkFinishEvent} args
   */
  onStreamNetworkFinish(args) {
    log('callback', args?.nettask)
    log.trace('networkfinish args', args)
    switch (args.nettask) {
      case 'streamFinal':
        if (this.pendingoperation) {
          const res = this.pendingres
          this.pendingoperation = null
          this.pendingres = null
          if (res != null) {
            res()
          }
        }
        break
      default:
        log.error('onStreamNetworkFinish unknown task', args.nettask)
    }
    // we could differentiate....
  }
}
