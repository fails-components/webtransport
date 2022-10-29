/* eslint-disable no-prototype-builtins */
// Copyright (c) 2022 Marten Richter or other contributers (see commit). All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import { existsSync } from 'fs'
import { createRequire } from 'module'
import { ReadableStream, WritableStream } from 'node:stream/web'
import * as path from 'path'
import * as url from 'url'
import { arch, platform } from 'node:process'

/**
 * @typedef {import('stream/web').WritableStreamDefaultController} WritableStreamDefaultController
 *
 * @typedef {import('./dom').WebTransportBidirectionalStream} WebTransportBidirectionalStream
 * @typedef {import('./dom').WebTransportSendStream} WebTransportSendStream
 * @typedef {import('./dom').WebTransportCloseInfo} WebTransportCloseInfo
 *
 * @typedef {import('./types').NativeHttp3WTStream} NativeHttp3WTStream
 * @typedef {import('./types').NativeHttp3WTSession} NativeHttp3WTSession
 * @typedef {import('./types').NetTask} NetTask
 *
 * WebTransport stream events
 * @typedef {import('./types').WebTransportStreamEventHandler} WebTransportStreamEventHandler
 * @typedef {import('./types').StreamRecvSignalEvent} StreamRecvSignalEvent
 * @typedef {import('./types').StreamReadEvent} StreamReadEvent
 * @typedef {import('./types').StreamWriteEvent} StreamWriteEvent
 * @typedef {import('./types').StreamResetEvent} StreamResetEvent
 * @typedef {import('./types').StreamNetworkFinishEvent} StreamNetworkFinishEvent
 *
 * WebTransport session events
 * @typedef {import('./types').WebTransportSessionEventHandler} WebTransportSessionEventHandler
 * @typedef {import('./types').SessionReadyEvent} SessionReadyEvent
 * @typedef {import('./types').SessionCloseEvent} SessionCloseEvent
 * @typedef {import('./types').DatagramReceivedEvent} DatagramReceivedEvent
 * @typedef {import('./types').DatagramSendEvent} DatagramSendEvent
 * @typedef {import('./types').NewStreamEvent} NewStreamEvent
 *
 * Http3Client events
 * @typedef {import('./types').Http3ClientEventHandler} Http3ClientEventHandler
 * @typedef {import('./types').ClientConnectedEvent} ClientConnectedEvent
 * @typedef {import('./types').ClientWebtransportSupportEvent} ClientWebtransportSupportEvent
 * @typedef {import('./types').Http3WTSessionVisitorEvent} Http3WTSessionVisitorEvent
 *
 * Public API
 * @typedef {import('./types').WebTransportSession} WebTransportSession
 */

const binplatform = platform + '_' + arch

const require = createRequire(import.meta.url)
const dirname = url.fileURLToPath(new URL('.', import.meta.url))
let buildpath = '../build_' + binplatform
if (!existsSync(path.join(dirname, buildpath))) buildpath = '../build' // use precompiled only if own compilation does not exis

let wtpath = buildpath + '/Release/webtransport.node'
if (
  process.env.NODE_ENV !== 'production' &&
  existsSync(path.join(dirname, buildpath + '/Debug/webtransport.node'))
) {
  wtpath = buildpath + '/Debug/webtransport.node'
}
console.log('load webtransport binary:', wtpath)

const wtrouter = require(wtpath)

class Http3WTStream {
  /**
   * @param {object} args
   * @param {NativeHttp3WTStream} args.object
   * @param {Http3WTSession} args.parentobj
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

    if (this.bidirectional || this.incoming) {
      this.readable = new ReadableStream(
        {
          start: (controller) => {
            this.readableController = controller
            // @ts-expect-error this.readable could be undefined
            this.parentobj.addReceiveStream(this.readable, controller)
            this.objint.startReading()
          },
          pull: (controller) => {
            if (this.readableclosed) {
              return Promise.resolve()
            }
            this.objint.startReading()
          },
          cancel: (reason) => {
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
          }
        },
        { highWaterMark: 4 }
      )
    }
    if (this.bidirectional || !this.incoming) {
      this.writable = new WritableStream(
        {
          start: (controller) => {
            this.writableController = controller
            // @ts-expect-error this.writable could be undefined
            this.parentobj.addSendStream(this.writable, controller)
          },
          write: (chunk, controller) => {
            if (this.writableclosed) {
              return Promise.resolve()
            }
            if (chunk instanceof Uint8Array) {
              this.pendingoperation = new Promise((resolve, reject) => {
                this.pendingres = resolve
              })
              const dataprom = this.parentobj.waitForDatagramsSend()
              dataprom.finally(() => {
                this.objint.writeChunk(chunk)
              })
              return this.pendingoperation
            } else {
              console.log('chunk info:', chunk)
              throw new Error('chunk is not of instanceof Uint8Array ')
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
    }

    /** @type {(() => void) | null} */
    this.cancelres = null
    /** @type {(() => void) | null} */
    this.pendingres = null
    /** @type {(() => void) | null} */
    this.abortres = null
  }

  /**
   * @param {import('./types').StreamRecvSignalEvent} args
   * @returns {void}
   */
  onStreamRecvSignal(args) {
    // console.log('onStreamRecvSignal', args)
    // check if transport is closed
    const parentstate = this.parentobj.state
    if (parentstate === 'closed' || parentstate === 'failed') return
    switch (args.nettask) {
      case 'resetStream':
        if (this.readable) {
          this.parentobj.removeReceiveStream(
            this.readable,
            this.readableController
          )
          this.readableclosed = true
          this.readableController.error(args.code || 0)
        } else console.log('stopSending wihtout readable')
        break

      case 'stopSending':
        if (this.writable) {
          this.parentobj.removeSendStream(
            this.writable,
            this.writableController
          )

          this.writableclosed = true
          this.writableController.error(args.code || 0)
        } else console.log('stopSending wihtout writable')
        break
      default:
        console.log('unhandled onStreamRecvSignal')
    }

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
   * @param {StreamReadEvent} args
   * @returns {void}
   */
  onStreamRead(args) {
    if (args.data && args.data.length && !this.readableclosed) {
      // console.log('stream read received', args.data, Date.now())
      this.readableController.enqueue(args.data)
      if (this.readableController.desiredSize != null && this.readableController.desiredSize < 0) this.objint.stopReading()
    }
    if (args.fin) {
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
   * @param {StreamResetEvent} args
   */
  onStreamReset(args) {
    if (this.abortres) {
      this.abortres()
      if (this.readable)
        this.parentobj.removeReceiveStream(
          this.readable,
          this.readableController
        )
      if (this.writable)
        this.parentobj.removeSendStream(this.writable, this.writableController)
      this.readableclosed = true
      this.parentobj.removeStreamObj(this)
    }
  }

  /**
   * @param {StreamNetworkFinishEvent} args
   */
  onStreamNetworkFinish(args) {
    // console.log('networkfinish args', args)
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
        console.log('onStreamNetworkFinish unknown task')
    }
    // we could differentiate....
  }

  /**
   * @param {StreamRecvSignalEvent | StreamReadEvent | StreamWriteEvent | StreamResetEvent | StreamNetworkFinishEvent} args
   */
  static callback(args) {
    // console.log('Stream callback called', args)
    if (!args || !args.object || !args.object.jsobj)
      throw new Error('Stream callback without jsobj')
    const visitor = args.object.jsobj
    if (args.purpose) {
      switch (args.purpose) {
        case 'StreamRecvSignal':
          visitor.onStreamRecvSignal(args)
          break
        case 'StreamRead':
          if (visitor && args.hasOwnProperty('data')) {
            visitor.onStreamRead(args)
          } else {
            console.log('Stream callback called', visitor, args)
            throw new Error('Malformed StreamRead')
          }
          break
        case 'StreamWrite':
          visitor.onStreamWrite(args)
          break
        case 'StreamReset':
          visitor.onStreamReset(args)
          break
        case 'StreamNetworkFinish':
          visitor.onStreamNetworkFinish(args)

          break
        default: {
          throw new Error('unknown purpose Streamcb')
        }
      }
    } else throw new Error('no purpose Streamcb')
  }
}

/**
 * @implements {WebTransportSessionEventHandler}
 * @implements {WebTransportSession}
 */
class Http3WTSession {
  /**
   * @param {object} args
   * @param {import('./types').NativeHttp3WTSession} [args.object]
   * @param {Http3Server | Http3Client} args.parentobj
   */
  constructor(args) {
    if (args.object) {
      this.objint = args.object
      this.objint.jsobj = this
    }
    this.parentobj = args.parentobj
    /** @type {import('./types').WebTransportSessionState} */
    this.state = 'connected'

    /** @type {((value?: any) => void) | null | undefined} */
    this.readyResolve = null
    /** @type {(() => void) | null | undefined} */
    this.closeHook = null

    /** @type {Promise<void>} */
    this.ready = new Promise((resolve, reject) => {
      this.readyResolve = resolve
      this.readyReject = reject
    }).catch(() => {}) // add default handler if no one cares
    /** @type {Promise<WebTransportCloseInfo>} */
    this.closed = new Promise((resolve, reject) => {
      this.closedResolve = resolve
      this.closedReject = reject
    }).catch(() => {}) // add default handler if no one cares

    this.incomingBidirectionalStreams = new ReadableStream({
      start: (controller) => {
        this.incomBiDiController = controller
      }
    })

    this.incomingUnidirectionalStreams = new ReadableStream({
      start: (controller) => {
        this.incomUniDiController = controller
      }
    })

    /** @type {Array<() => void>} */
    this.writeDatagramRes = []
    /** @type {Array<() => void>} */
    this.writeDatagramRej = []
    /** @type {Array<Promise<void>>} */
    this.writeDatagramProm = []

    this.datagrams = {
      readable: new ReadableStream({
        start: (controller) => {
          this.incomDatagramController = controller
        }
      }),
      writable: new WritableStream({
        start: (controller) => {
          this.outgoDatagramController = controller
        },
        write: (chunk, controller) => {
          if (this.state === 'closed') throw new Error('Session is closed')
          if (chunk instanceof Uint8Array) {
            /** @type {Promise<void>} */
            const ret = new Promise((resolve, reject) => {
              this.writeDatagramRes.push(resolve)
              this.writeDatagramRej.push(reject)
            })
            this.writeDatagramProm.push(ret)
            // console.log('b4 datagram write', chunk, Date.now())
            if (this.objint == null) {
              throw new Error('this.objint is not set')
            }
            this.objint.writeDatagram(chunk)
            return ret
          } else throw new Error('chunk is not of type Uint8Array')
        },
        close: () => {
          // do nothing
        }
      })
    }

    /** @type {Array<(stream: WebTransportBidirectionalStream) => void>} */
    this.resolveBiDi = []
    /** @type {Array<(stream: WebTransportSendStream) => void>} */
    this.resolveUniDi = []
    /** @type {Array<(err?: Error) => void>} */
    this.rejectBiDi = []
    /** @type {Array<(err?: Error) => void>} */
    this.rejectUniDi = []

    this.sendStreams = new Set()
    this.receiveStreams = new Set()
    /** @type {Set<Http3WTStream>} */
    this.streamObjs = new Set()

    /** @type {Set<WritableStreamDefaultController>} */
    this.sendStreamsController = new Set()
    /** @type {Set<ReadableStreamDefaultController>} */
    this.receiveStreamsController = new Set()
  }

  /**
   * @param {NativeHttp3WTSession} object
   */
  setSessionObj(object) {
    if (object) {
      this.objint = object
      this.objint.jsobj = this
    }
  }

  async waitForDatagramsSend() {
    while (this.writeDatagramProm.length > 0) {
      try {
        await Promise.allSettled(this.writeDatagramProm)
      } catch (error) {
        console.log('datagram promise failed ', error)
      }
    }
  }

  /**
   * @param {Http3WTStream} stream
   */
  addStreamObj(stream) {
    this.streamObjs.add(stream)
  }

  /**
   * @param {Http3WTStream} stream
   */
  removeStreamObj(stream) {
    this.streamObjs.delete(stream)
  }

  /**
   * @param {WritableStream} stream
   * @param {WritableStreamDefaultController} controller
   */
  addSendStream(stream, controller) {
    this.sendStreams.add(stream)
    this.sendStreamsController.add(controller)
  }

  /**
   * @param {WritableStream} stream
   * @param {WritableStreamDefaultController} controller
   */
  removeSendStream(stream, controller) {
    this.sendStreams.delete(stream)
    this.sendStreamsController.delete(controller)
  }

  /**
   * @param {ReadableStream} stream
   * @param {ReadableStreamDefaultController} controller
   */
  addReceiveStream(stream, controller) {
    this.receiveStreams.add(stream)
    this.receiveStreamsController.add(controller)
  }

  /**
   * @param {ReadableStream} stream
   * @param {ReadableStreamDefaultController} controller
   */
  removeReceiveStream(stream, controller) {
    this.receiveStreams.delete(stream)
    this.receiveStreamsController.delete(controller)
  }

  /**
   * @returns {Promise<WebTransportBidirectionalStream>}
   */
  createBidirectionalStream() {
    if (this.objint == null) {
      throw new Error('this.objint not set')
    }
    /** @type {Promise<WebTransportBidirectionalStream>} */
    const prom = new Promise((resolve, reject) => {
      this.resolveBiDi.push(resolve)
      this.rejectBiDi.push(reject)
    })
    this.objint.orderBidiStream()
    return prom
  }

  /**
   *@returns {Promise<WebTransportSendStream>}
   */
  createUnidirectionalStream() {
    if (this.objint == null) {
      throw new Error('this.objint not set')
    }
    /** @type {Promise<WebTransportSendStream>} */
    const prom = new Promise((resolve, reject) => {
      this.resolveUniDi.push(resolve)
      this.rejectUniDi.push(reject)
    })
    this.objint.orderUnidiStream()
    return prom
  }

  /**
   * @param {object} [closeInfo]
   * @param {number} closeInfo.closeCode
   * @param {string} closeInfo.reason
   * @returns {void}
   */
  close(closeInfo) {
    // console.log('closeinfo', closeInfo)
    if (this.state === 'closed' || this.state === 'failed') return
    if (this.objint) {
      this.objint.close({
        code: closeInfo?.closeCode ?? 0,
        reason: closeInfo?.reason.substring(0, 1023) ?? ''
      })
    }
  }

  onReady(/* error */) {
    if (this.readyResolve) this.readyResolve()
    delete this.readyResolve
  }

  /**
   * @param {SessionCloseEvent} args
   */
  onClose(args) {
    delete this.objint // not valid any more
    // console.log('onClose')
    for (const rej of this.rejectBiDi) rej()
    for (const rej of this.rejectUniDi) rej()
    for (const rej of this.writeDatagramRej) rej()
    this.writeDatagramRej = []
    this.writeDatagramRes = []
    this.writeDatagramProm = []
    this.resolveBiDi = []
    this.resolveUniDi = []
    this.rejectBiDi = []
    this.rejectUniDi = []

    this.incomBiDiController.close()
    this.incomUniDiController.close()
    this.incomDatagramController.close()
    // this.outgoDatagramController.error(errorcode)
    this.state = 'closed'

    this.sendStreamsController.forEach((ele) => ele.error(args.errorcode))
    this.receiveStreamsController.forEach((ele) => ele.error(args.errorcode))
    this.streamObjs.forEach((ele) => (ele.readableclosed = true))

    this.sendStreams.clear()
    this.receiveStreams.clear()
    this.sendStreamsController.clear()
    this.receiveStreamsController.clear()
    this.streamObjs.clear()

    if (this.closedResolve) this.closedResolve(args.errorcode)
    if (this.closeHook) {
      this.closeHook()
      delete this.closeHook
    }
  }

  /**
   * @param {NewStreamEvent} args
   */
  onStream(args) {
    const strobj = new Http3WTStream({
      object: args.stream,
      parentobj: this,
      transport: this.parentobj,
      bidirectional: args.bidirectional,
      incoming: args.incoming
    })
    this.addStreamObj(strobj)
    if (args.incoming) {
      if (args.bidirectional) {
        this.incomBiDiController.enqueue(strobj)
      } else {
        this.incomUniDiController.enqueue(strobj.readable)
      }
    } else {
      if (args.bidirectional) {
        if (this.resolveBiDi.length === 0)
          throw new Error('Got bidirectional stream without asking for it')
        this.rejectBiDi.shift()
        const curres = this.resolveBiDi.shift()

        if (curres != null && strobj.readable != null && strobj.writable != null) {
          curres({
            readable: strobj.readable,
            writable: strobj.writable
          })
        }
      } else {
        if (this.resolveUniDi.length === 0)
          throw new Error('Got unidirectional stream without asking for it')
        this.rejectUniDi.shift()
        const curres = this.resolveUniDi.shift()

        if (curres != null && strobj.writable != null) {
          /** @type {WebTransportSendStream} */
          // @ts-expect-error `getStats` property is missing from WritableStream
          // we add it on the next line
          const sendStream = strobj.writable
          sendStream.getStats = () => {
            return Promise.resolve({
              timestamp: 0,
              bytesWritten: 0n,
              bytesSent: 0n,
              bytesAcknowledged: 0n
            })
          }

          curres(sendStream)
        }
      }
    }
  }

  /**
   * @param {DatagramReceivedEvent} args
   */
  onDatagramReceived(args) {
    // console.log('datagram received', args.datagram, Date.now())
    this.incomDatagramController.enqueue(args.datagram)
  }

  /**
   * @param {DatagramSendEvent} args
   */
  onDatagramSend(args) {
    if (this.state === 'closed') return
    this.writeDatagramRej.shift()
    this.writeDatagramProm.shift()
    const res = this.writeDatagramRes.shift()

    if (res != null) {
      res()
    }
  }

  /**
   * @param {SessionReadyEvent | SessionCloseEvent | DatagramReceivedEvent | DatagramSendEvent | NewStreamEvent} args
   */
  static callback(args) {
    // console.log('Session callback called', args)
    if (!args || !args.object || !args.object.jsobj)
      throw new Error('Session callback without jsobj')
    const visitor = args.object.jsobj
    if (args.purpose) {
      switch (args.purpose) {
        case 'SessionReady':
          visitor.onReady(args)
          break
        case 'SessionClose':
          visitor.onClose(args)
          break
        case 'DatagramReceived':
          if (visitor && args.hasOwnProperty('datagram'))
            visitor.onDatagramReceived(args)
          break
        case 'DatagramSend':
          if (visitor) visitor.onDatagramSend(args)
          break
        case 'Http3WTStreamVisitor':
          if (
            visitor &&
            args.hasOwnProperty('bidirectional') &&
            args.hasOwnProperty('incoming')
          ) {
            visitor.onStream(args)
          } else throw new Error('Malformed Http3WTStreamVisitor')
          break
        default:
          throw new Error('unknown purpose Sessioncb')
      }
    } else throw new Error('no purpose Sessioncb')
  }
}

class Http3WebTransport {
  /**
   * @param {*} args
   * @param {'server' | 'client'} purpose
   */
  constructor(args, purpose) {
    const eventloop = Http3EventLoop.getGlobalEventLoop(this).eventloopInt

    if (purpose === 'server')
      this.transportInt = new wtrouter.Http3WebTransportServer(args, eventloop)
    else if (purpose === 'client')
      this.transportInt = new wtrouter.Http3WebTransportClient(args, eventloop)
    else throw new Error('unknown purpose')
    this.transportInt.jsobj = this

    this.sessions = {}
  }

  /**
   * @typedef {object} TransportCallbackEvent
   * @property {{ jsobj: { customCallback: (args: any) => void }}} object
   * @property {string} purpose
   *
   * @param {TransportCallbackEvent} args
   */
  static transportCallback(args) {
    // console.log('incoming callback transport', args)
    if (!args || !args.object || !args.object.jsobj)
      throw new Error('Transport callback without jsobj')
    const visitor = args.object.jsobj
    if (args.purpose) {
      if (visitor.customCallback) {
        visitor.customCallback(args)
      } else {
        throw new Error('unknown purpose')
      }
    }
  }
}

export class Http3Server extends Http3WebTransport {
  /**
   *
   * @param {*} args
   */
  constructor(args) {
    super(args, 'server')

    /** @type {Record<string, ReadableStream>} */
    this.sessionStreams = {}

    /** @type {Record<string, ReadableStreamController<any>>} */
    this.sessionController = {}
  }

  startServer() {
    this.transportInt.startServer()
  }

  stopServer() {
    this.transportInt.stopServer()
    for (const i in this.sessionController) {
      this.sessionController[i].close() // inform the controller, that we are closing
      delete this.sessionController[i]
    }
    this.stopped = true
  }

  /**
   * @param {string} path
   * @returns {ReadableStream<WebTransportSession>}
   */
  sessionStream(path) {
    if (path in this.sessionStreams) {
      return this.sessionStreams[path]
    }
    this.sessionStreams[path] = new ReadableStream({
      start: async (controller) => {
        this.sessionController[path] = controller
      }
    })
    this.transportInt.addPath(path)
    return this.sessionStreams[path]
  }

  /**
   * @typedef {object} Http3WTSessionVisitor
   * @property {'Http3WTSessionVisitor'} purpose
   * @property {any} object
   * @property {NativeHttp3WTSession} session
   * @property {string} path
   *
   * @param {Http3WTSessionVisitor} args
   */
  customCallback(args) {
    // console.log('incoming callback server', args)
    if (args.purpose) {
      switch (args.purpose) {
        case 'Http3WTSessionVisitor':
          // create Http3 Visitor
          if (args.object) {
            const sesobj = new Http3WTSession({
              object: args.session,
              parentobj: this
            })
            if (this.sessionController[args.path])
              this.sessionController[args.path].enqueue(sesobj)
          } else throw new Error('Http3WTSessionVisitor')

          break

        default: {
          throw new Error('unknown purpose')
        }
      }
    }
  }
}

/**
 * @implements {Http3ClientEventHandler}
 */
class Http3Client extends Http3WebTransport {
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
    this.handleConnection()
  }

  async handleConnection() {
    this.quicconnected = new Promise((resolve, reject) => {
      this.quicconnectedProm = { resolve, reject }
    }).catch(() => {}) // add default handler if no one cares
    this.webtransport = new Promise((resolve, reject) => {
      this.webtransportProm = { resolve, reject }
    }).catch(() => {}) // add default handler if no one cares

    try {
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
      console.log('Connecting failed for client:' + error)
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
  onClientConnected (args) {
    if (this.quicconnectedProm) {
      if (args.success) this.quicconnectedProm.resolve()
      else
        this.quicconnectedProm.reject(
          new Error('Connecting quic client failed')
        )
    } else throw new Error('Client connected with no pending promise')
  }

  /**
   * @param {ClientWebtransportSupportEvent} args
   */
  onClientWebTransportSupport (args) {
    if (this.webtransportProm) {
      this.webtransportProm.resolve()
      delete this.webtransportProm
    }
  }

  /**
   * @param {Http3WTSessionVisitorEvent} args
   */
  onHttp3WTSessionVisitor (args) {
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

/**
 * @typedef {import('./dom').WebTransport} WebTransportInterface
 *
 * @implements {WebTransportInterface}
 */
export class WebTransport {
  /**
   * @param {string} url
   * @param {import('./dom').WebTransportOptions} [args]
   */
  constructor(url, args) {
    if (!url) throw new Error('no URL supplied')
    const ourl = (this.urlint = new URL(url))

    if (ourl.protocol !== 'https:') {
      throw new Error('URL is not supported for webtransport')
    }

    const hostname = ourl.hostname
    let port = ourl.port
    if (port === '') port = '443'

    this.client = new Http3Client({ hostname, port, ...args })

    this.sessionint = new Http3WTSession({
      /* object: args.session, */
      parentobj: this.client
    })

    this.ready = this.sessionint.ready
    this.closed = this.sessionint.closed

    this.datagrams = this.sessionint.datagrams

    this.incomingBidirectionalStreams =
      this.sessionint.incomingBidirectionalStreams

    this.incomingUnidirectionalStreams =
      this.sessionint.incomingUnidirectionalStreams

    this.establishSession()
  }

  async establishSession() {
    try {
      await this.client.quicconnected
      await this.client.createWTSession(this.sessionint, this.urlint.pathname)
    } catch (error) {
      this.sessionint.readyReject(
        new Error('Establishing session failed ' + error)
      )
      console.log('Establishing session failed ' + error)
    }
  }

  /**
   * @param {WebTransportCloseInfo} [closeinfo]
   */
  close(closeinfo) {
    return this.sessionint.close(closeinfo)
  }

  createBidirectionalStream() {
    return this.sessionint.createBidirectionalStream()
  }

  createUnidirectionalStream() {
    return this.sessionint.createUnidirectionalStream()
  }
}

class Http3EventLoop {
  /** @type {Http3EventLoop | null} */
  static globalLoop = null

  /**
   * @param {*} [args]
   */
  constructor(args) {
    this.eventloopInt = new wtrouter.Http3EventLoop({
      transportCallback: Http3WebTransport.transportCallback,
      streamCallback: Http3WTStream.callback,
      sessionCallback: Http3WTSession.callback,
      eventloopCallback: Http3EventLoop.callback
    })
    this.eventloopInt.jsobj = this

    this.refObjects = new Set()
    this.loopGuardian = this.loopGuardian.bind(this)
  }

  startEventLoop() {
    console.log('start GlobalEventLoop')
    this.eventloopInt.startEventLoop()
    this.loopGuardianTimer = setInterval(this.loopGuardian, 5000)
  }

  shutdownEventLoop() {
    console.log('shutdown GlobalEventLoop')
    Http3EventLoop.globalLoop = null
    clearInterval(this.loopGuardianTimer)
    this.eventloopInt.shutDownEventLoop()
  }

  loopGuardian() {
    for (const item of this.refObjects) {
      if (typeof item.deref() === 'undefined' || item.deref()?.stopped)
        this.refObjects.delete(item)
    }
    if (this.refObjects.size === 0) {
      const now = Date.now()
      if (!this.refObjectsEmptyTime) this.refObjectsEmptyTime = now
      else if (now - this.refObjectsEmptyTime > 20 * 1000)
        this.shutdownEventLoop()
    } else if (this.refObjectsEmptyTime) delete this.refObjectsEmptyTime
  }

  static callback() {
    console.log('final eventloop callback called')
  }

  /**
   * @returns {Http3EventLoop}
   */
  static createGlobalEventLoop() {
    if (!Http3EventLoop.globalLoop) {
      Http3EventLoop.globalLoop = new Http3EventLoop()
      Http3EventLoop.globalLoop.startEventLoop()
      console.log('createGlobalEventLoop')
    }
    return Http3EventLoop.globalLoop
  }

  /**
   * @param {any} object
   * @returns {Http3EventLoop}
   */
  static getGlobalEventLoop(object) {
    if (!object) throw new Error('getGlobalEventLoop without reference object')
    const loop = Http3EventLoop.globalLoop ?? Http3EventLoop.createGlobalEventLoop()
    loop.refObjects.add(new WeakRef(object))
    return loop
  }
}

export function testcheck() {
  return !Http3EventLoop.globalLoop
}
