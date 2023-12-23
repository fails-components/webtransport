import { ReadableStream, WritableStream } from './webstreams.js'
import { logger } from './utils.js'
import { WebTransportError } from './error.js'

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
 * @typedef {import('./types').ReadBuffer} ReadBuffer
 *
 * @typedef {import('./dom').WebTransportReceiveStream} WebTransportReceiveStream
 * @typedef {import('./dom').WebTransportSendStream} WebTransportSendStream
 *
 * @typedef {import('./session').HttpWTSession} HttpWTSession
 *
 * @typedef {import('stream/web').WritableStreamDefaultController} WritableStreamDefaultController
 */

export class HttpWTStream {
  /**
   * @param {object} args
   * @param {NativeHttpWTStream} args.object
   * @param {HttpWTSession} args.parentobj
   * @param {object} args.transport
   * @param {boolean} args.bidirectional
   * @param {boolean} args.incoming
   */
  constructor(args) {
    this.objint = args.object
    this.objint.jsobj = this
    this.parentobj = args.parentobj
    this.transport = args.transport
    this.bidirectional = args.bidirectional
    this.incoming = args.incoming
    this.closed = false

    /** @type {Promise<void> | null} */
    this.pendingoperation = null
    this.pendingres = null

    /** @type {WebTransportReceiveStream} */
    this.readable // eslint-disable-line no-unused-expressions
    /** @type {WebTransportSendStream} */
    this.writable // eslint-disable-line no-unused-expressions

    /** @type {Promise<void> | null} */
    this.pendingoperationRead = null
    this.pendingresRead = null

    if (this.bidirectional || this.incoming) {
      /** @type {WebTransportReceiveStream} */
      // @ts-expect-error `getStats` property is missing from ReadableStream
      this.readable = new ReadableStream(
        {
          start: (
            /** @type {import("stream/web").ReadableByteStreamController} */ controller
          ) => {
            this.readableController = controller
            this.objint.startReading()
          },
          pull: async (
            /** @type {import("stream/web").ReadableByteStreamController} */ controller
          ) => {
            if (this.readableclosed) {
              return Promise.resolve()
            }

            this.pendingoperationRead = new Promise((resolve, reject) => {
              this.pendingresRead = resolve
            })
            this.objint.startReading()
            await this.pendingoperationRead
          },
          cancel: (/** @type {{ code: number; }} */ reason) => {
            /** @type {Promise<void>} */
            const promise = new Promise((resolve, reject) => {
              this.cancelres = resolve
            })
            let code = 0
            if (reason && reason.code) {
              if (reason.code < 0) code = 0
              else if (reason.code > 255) code = 255
              else code = reason.code
            }
            this.readableclosed = true
            this.objint.stopSending(code)
            return promise
          },
          type: 'bytes',
          autoAllocateChunkSize: 4096 // lets take this as buffer size
        }
        // TODO fix stretegy
      )
      this.readable.getStats = () => {
        return Promise.resolve({
          timestamp: 0,
          bytesReceived: 0n,
          bytesRead: 0n
        })
      }
      // @ts-ignore
      this.parentobj.addReceiveStream(this.readable, this.readableController)
    }
    if (this.bidirectional || !this.incoming) {
      /** @type {WebTransportSendStream} */
      // @ts-expect-error `getStats` property is missing from WritableStream
      this.writable = new WritableStream(
        {
          start: (controller) => {
            this.writableController = controller
          },
          write: (chunk, controller) => {
            if (this.writableclosed) {
              return Promise.resolve()
            }
            let wchunk = chunk
            if (wchunk instanceof ArrayBuffer) {
              wchunk = new Uint8Array(wchunk)
            }
            if (wchunk instanceof Uint8Array) {
              this.pendingoperation = new Promise((resolve, reject) => {
                this.pendingres = resolve
              })
              this.parentobj
                .waitForDatagramsSend()
                .finally(() => {
                  this.objint.writeChunk(wchunk)
                })
                .catch((/** @type {any} */ err) => {
                  log.error(err)
                })
              return this.pendingoperation
            } else {
              log.trace('chunk info:', chunk)
              throw new Error(
                'chunk is not of instanceof Uint8Array or Arraybuffer'
              )
            }
          },
          close: () => {
            if (this.writableclosed) {
              return Promise.resolve()
            }
            this.objint.streamFinal()
            this.pendingoperation = new Promise((resolve, reject) => {
              this.pendingres = resolve
            })
            return this.pendingoperation
          },
          abort: (reason) => {
            if (this.writableclosed) {
              return new Promise((resolve, reject) => {
                resolve()
              })
            }
            let code = 0
            if (reason && reason.code) {
              if (reason.code < 0) code = 0
              else if (reason.code > 255) code = 255
              else code = reason.code
            }
            /** @type {Promise<void>} */
            const promise = new Promise((resolve, reject) => {
              this.abortres = resolve
            })
            this.objint.resetStream(code)
            return promise
          }
        },
        { highWaterMark: 4 }
      )
      this.writable.getStats = () => {
        return Promise.resolve({
          timestamp: 0,
          bytesWritten: 0n,
          bytesSent: 0n,
          bytesAcknowledged: 0n
        })
      }
      // @ts-ignore
      this.parentobj.addSendStream(this.writable, this.writableController)
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
   * @returns {ReadBuffer}
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

  /**
   * @param {ReadBuffer} args
   */
  commitReadBuffer({ buffer, byob, drained, readBytes, fin }) {
    if (byob && readBytes !== undefined) {
      byob.respond(readBytes)
    } else if (buffer) {
      this.readableController.enqueue(buffer)
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
      if (!this.readableclosed) {
        this.readableController.close()
        this.readableclosed = true
      }
    }
    return retObj
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
          this.finalDrain()
          if (parentcleanup)
            this.parentobj.removeReceiveStream(
              this.readable,
              this.readableController
            )
          this.readableclosed = true
          this.readableController.error(
            new WebTransportError('Resetstream with code:' + (args.code || 0))
          )
        } else {
          log.error('resetStream without readable')
        }
        break

      case 'stopSending':
        if (this.writable) {
          if (parentcleanup)
            this.parentobj.removeSendStream(
              this.writable,
              this.writableController
            )

          this.writableclosed = true
          this.writableController.error(
            new WebTransportError('StopSending with code:' + (args.code || 0))
          )
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

  finalDrain() {
    this.finaldrain_ = true
    this.objint.drainReads()
  }

  /**
   * @param {StreamWriteEvent} args
   */
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

  /**
   * @param {StreamNetworkFinishEvent} args
   */
  onStreamNetworkFinish(args) {
    log('callback', args?.nettask)
    log.trace('networkfinish args', args)
    switch (args.nettask) {
      case 'stopSending':
        if (this.cancelres) {
          const res = this.cancelres
          this.cancelres = null
          res()
        }
        this.stopSendingRecv = true
        break
      case 'resetStream':
        if (this.abortres) {
          const res = this.abortres
          this.abortres = null
          res()
          if (this.readable)
            this.parentobj.removeReceiveStream(
              this.readable,
              this.readableController
            )
          if (this.writable)
            this.parentobj.removeSendStream(
              this.writable,
              this.writableController
            )
          this.readableclosed = true
          this.parentobj.removeStreamObj(this)
        }

        break

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
