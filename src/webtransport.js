// Copyright (c) 2022 Marten Richter or other contributers (see commit). All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import { existsSync } from 'fs'
import { createRequire } from 'module'
import { ReadableStream, WritableStream } from 'node:stream/web'
import * as path from 'path'
import * as url from 'url'
import { arch, argv, platform } from 'node:process'

const binplatform = platform + '_' + arch

const require = createRequire(import.meta.url)
const dirname = url.fileURLToPath(new URL('.', import.meta.url))
let wtpath = '../build_' + binplatform + '/Release/webtransport.node'
if (
  process.env.NODE_ENV !== 'production' &&
  existsSync(
    path.join(dirname, '../build_' + binplatform + '/Debug/webtransport.node')
  )
) {
  wtpath = '../build_' + binplatform + '/Debug/webtransport.node'
}

const wtrouter = require(wtpath)

class Http3WTStream {
  constructor(args) {
    this.objint = args.object
    this.objint.jsobj = this
    this.parentobj = args.parentobj
    this.transport = args.transport
    this.bidirectional = args.bidirectional
    this.incoming = args.incoming
    this.closed = false

    this.pendingoperation = null
    this.pendingres = null

    if (this.bidirectional || this.incoming) {
      this.readable = new ReadableStream(
        {
          start: (controller) => {
            this.readableController = controller
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
            const promise = new Promise((res, rej) => {
              this.cancelres = res
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
            this.parentobj.addSendStream(this.writable, controller)
          },
          write: (chunk, controller) => {
            if (this.writableclosed) {
              return Promise.resolve()
            }
            if (chunk instanceof Uint8Array) {
              this.pendingoperation = new Promise((res, rej) => {
                this.pendingres = res
              })
              const dataprom = this.parentobj.waitForDatagramsSend()
              dataprom.finally(() => {
                this.objint.writeChunk(chunk)
              })
              return this.pendingoperation
            } else throw new Error('chunk is not of instanceof Uint8Array ')
          },
          close: (controller) => {
            if (this.writableclosed) {
              return Promise.resolve()
            }
            this.objint.streamFinal()
            this.pendingoperation = new Promise((res, rej) => {
              this.pendingres = res
            })
            return this.pendingoperation
          },
          abort: (reason) => {
            if (this.writableclosed) {
              return new Promise((res, rej) => {
                res()
              })
            }
            let code = 0
            if (reason && reason.code) {
              if (reason.code < 0) code = 0
              else if (reason.code > 255) code = 255
              else code = reason.code
            }
            const promise = new Promise((res, rej) => {
              this.abortres = res
            })
            this.objint.resetStream(code)
            return promise
          }
        },
        { highWaterMark: 4 }
      )
    }
  }

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
      res()
    }
  }

  onStreamRead(args) {
    if (args.data && !this.readableclosed) {
//      console.log('stream read received', Date.now())
      this.readableController.enqueue(args.data)
      if (this.readableController.desiredSize < 0) this.objint.stopReading()
    }
    if (args.fin) {
      this.readableController.close()
      this.readableclosed = true
    }
  }

  onStreamWrite(args) {
    // we ignore success
    if (this.pendingoperation) {
      const res = this.pendingres
      this.pendingoperation = null
      this.pendingres = null
      res()
    }
  }

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

  onStreamNetworkFinish(args) {
    // console.log('networkfinish args', args)
    switch (args.nettask) {
      case 'stopSending':
        {
          if (this.cancelres) {
            const res = this.cancelres
            this.cancelres = null
            res()
          }
        }
        break
      case 'resetStream':
        {
          if (this.abortres) {
            const res = this.abortres
            this.abortres = null
            res()
          }
        }
        break

      case "streamFinal":
        {
          if (this.pendingoperation) {
            const res = this.pendingres
            this.pendingoperation = null
            this.pendingres = null
            res()
          }
        } break
      default:
        console.log('onStreamNetworkFinish unknown task')
    }
    // we could differentiate....
    
  }

  static callback(args) {
    // console.log('Stream callback called', args)
    if (!args || !args.object || !args.object.jsobj)
      throw new Error('Stream callback without jsobj')
    const visitor = args.object.jsobj
    if (args.purpose) {
      switch (args.purpose) {
        case 'StreamRecvSignal':
          {
            visitor.onStreamRecvSignal(args)
          }
          break
        case 'StreamRead':
          {
            if (visitor && args.hasOwnProperty('data')) {
              visitor.onStreamRead(args)
            } else {
              console.log('Stream callback called', visitor, args)
              throw new Error('Malformed StreamRead')
            }
          }
          break
        case 'StreamWrite':
          {
            visitor.onStreamWrite(args)
          }
          break
        case 'StreamReset':
          {
            visitor.onStreamReset(args)
          }
          break
        case 'StreamNetworkFinish':
          {
            visitor.onStreamNetworkFinish(args)
          }
          break
        default: {
          throw new Error('unknown purpose Streamcb')
        }
      }
    } else throw new Error('no purpose Streamcb')
  }
}

class Http3WTSession {
  constructor(args) {
    if (args.object) {
      this.objint = args.object
      this.objint.jsobj = this
    }
    this.parentobj = args.parentobj
    this.state = 'connected'

    this.ready = new Promise((res, rej) => {
      this.readyResolve = res
      this.readyReject = rej
    }).catch(() => {}) // add default handler if no one cares
    this.closed = new Promise((res, rej) => {
      this.closedResolve = res
      this.closedReject = rej
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

    this.datagrams = {}
    this.datagrams.readable = new ReadableStream({
      start: (controller) => {
        this.incomDatagramController = controller
      }
    })
    this.writeDatagramRes = []
    this.writeDatagramRej = []
    this.writeDatagramProm = []
    this.datagrams.writable = new WritableStream({
      start: (controller) => {
        this.outgoDatagramController = controller
      },
      write: (chunk, controller) => {
        if (this.state === 'closed') throw new Error('Session is closed')
        if (chunk instanceof Uint8Array) {
          const ret = new Promise((res, rej) => {
            this.writeDatagramRes.push(res)
            this.writeDatagramRej.push(rej)
          })
          this.writeDatagramProm.push(ret)
//          console.log('b4 datagram write', Date.now())
          this.objint.writeDatagram(chunk)
          return ret
        } else throw new Error('chunk is not of type Uint8Array')
      },
      close: (controller) => {
        // do nothing
      }
    })

    this.resolveBiDi = []
    this.resolveUniDi = []
    this.rejectBiDi = []
    this.rejectUniDi = []

    this.sendStreams = new Set()
    this.receiveStreams = new Set()
    this.streamObjs = new Set()

    this.sendStreamsController = new Set()
    this.receiveStreamsController = new Set()
  }

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

  addStreamObj(stream) {
    this.streamObjs.add(stream)
  }

  removeStreamObj(stream) {
    this.streamObjs.delete(stream)
  }

  addSendStream(stream, controller) {
    this.sendStreams.add(stream)
    this.sendStreamsController.add(controller)
  }

  removeSendStream(stream, controller) {
    this.sendStreams.delete(stream)
    this.sendStreamsController.delete(controller)
  }

  addReceiveStream(stream, controller) {
    this.receiveStreams.add(stream)
    this.receiveStreamsController.add(controller)
  }

  removeReceiveStream(stream, controller) {
    this.receiveStreams.delete(stream)
    this.receiveStreamsController.delete(controller)
  }

  createBidirectionalStream() {
    const prom = new Promise((res, rej) => {
      this.resolveBiDi.push(res)
      this.rejectBiDi.push(rej)
    })
    this.objint.orderBidiStream()
    return prom
  }

  createUnidirectionalStream() {
    const prom = new Promise((res, rej) => {
      this.resolveUniDi.push(res)
      this.rejectUniDi.push(rej)
    })
    this.objint.orderUnidiStream()
    return prom
  }

  close(closeInfo) {
    // console.log('closeinfo', closeInfo)
    if (this.state === 'closed' || this.state === 'failed') return
    if (this.objint) {
      this.objint.close({
        code: closeInfo.closeCode,
        reason: closeInfo.reason.substring(0, 1023)
      })
    }
  }

  onReady(error) {
    if (this.readyResolve) this.readyResolve()
    delete this.readyResolve
  }

  onClose(errorcode, error) {
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

    this.sendStreamsController.forEach((ele) => ele.error(errorcode))
    this.receiveStreamsController.forEach((ele) => ele.error(errorcode))
    this.streamObjs.forEach((ele) => (ele.readableclosed = true))

    this.sendStreams.clear()
    this.receiveStreams.clear()
    this.sendStreamsController.clear()
    this.receiveStreamsController.clear()
    this.streamObjs.clear()

    if (this.closedResolve) this.closedResolve(errorcode)
    if (this.closeHook) {
      this.closeHook()
      delete this.closeHook
    }
  }

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
        curres(strobj)
      } else {
        if (this.resolveUniDi.length === 0)
          throw new Error('Got unidirectional stream without asking for it')
        this.rejectUniDi.shift()
        const curres = this.resolveUniDi.shift()
        curres(strobj.writable)
      }
    }
  }

  onDatagramReceived(args) {
//    console.log('datagram received', Date.now())
    this.incomDatagramController.enqueue(args.datagram)
  }

  onDatagramSend(args) {
    if (this.state === 'closed') return
    this.writeDatagramRej.shift()
    this.writeDatagramProm.shift()
    const res = this.writeDatagramRes.shift()
    res()
  }

  static callback(args) {
    // console.log('Session callback called', args)
    if (!args || !args.object || !args.object.jsobj)
      throw new Error('Session callback without jsobj')
    const visitor = args.object.jsobj
    if (args.purpose) {
      switch (args.purpose) {
        case 'SessionReady':
          {
            visitor.onReady()
          }
          break
        case 'SessionClose':
          {
            visitor.onClose(args.errorcode, args.error)
          }
          break
        case 'DatagramReceived':
          {
            if (visitor && args.hasOwnProperty('datagram'))
              visitor.onDatagramReceived(args)
          }
          break
        case 'DatagramSend':
          {
            if (visitor) visitor.onDatagramSend(args)
          }
          break
        case 'Http3WTStreamVisitor':
          {
            if (
              visitor &&
              args.hasOwnProperty('bidirectional') &&
              args.hasOwnProperty('incoming')
            ) {
              visitor.onStream(args)
            } else throw new Error('Malformed Http3WTStreamVisitor')
          }
          break
        default:
          {
            throw new Error('unknown purpose Sessioncb')
          }
          break
      }
    } else throw new Error('no purpose Sessioncb')
  }
}

class Http3WebTransport {
  constructor(args, purpose) {
    const eventloop = Http3EventLoop.getGlobalEventLoop(this).eventloopInt

    if (purpose === 'server')
      this.transportInt = wtrouter.Http3WebTransportServer(args, eventloop)
    else if (purpose === 'client')
      this.transportInt = wtrouter.Http3WebTransportClient(args, eventloop)
    else throw new Error('unknown purpose')
    this.transportInt.jsobj = this

    this.sessions = {}
  }

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
  constructor(args) {
    super(args, 'server')
    this.sessionStreams = {}
    this.sessionController = {}
  }

  startServer() {
    this.transportInt.startServer()
  }

  stopServer() {
    this.transportInt.stopServer()
    for (let i in this.sessionController) {
      this.sessionController[i].close() // inform the controller, that we are closing
      delete this.sessionController[i]
    }
    this.stopped = true
  }

  sessionStream(path) {
    if (path in this.sessionStreams) {
      return this.sessionsStreams[path]
    }
    this.sessionStreams[path] = new ReadableStream({
      start: async (controller) => {
        this.sessionController[path] = controller
      }
    })
    this.transportInt.addPath(path)
    return this.sessionStreams[path]
  }

  customCallback(args) {
    // console.log('incoming callback server', args)
    if (args.purpose) {
      switch (args.purpose) {
        case 'Http3WTSessionVisitor':
          {
            // create Http3 Visitor
            if (args.object) {
              const sesobj = new Http3WTSession({
                object: args.session,
                parentobj: this
              })
              if (this.sessionController[args.path])
                this.sessionController[args.path].enqueue(sesobj)
            } else throw new Error('Http3WTSessionVisitor')
          }
          break

        default: {
          throw new Error('unknown purpose')
        }
      }
    }
  }
}

class Http3Client extends Http3WebTransport {
  constructor(args) {
    super(args, 'client')

    this.sessionobj = new Promise((resolve, reject) => {
      this.sessionProm = { resolve, reject }
    }).catch(() => {}) // add default handler if no one cares
    this.sessionobjint = null
    this.closeHookSession = this.closeHookSession.bind(this)

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

  customCallback(args) {
    // console.log('incoming callback custom client', args)
    if (args.purpose) {
      switch (args.purpose) {
        case 'ClientConnected':
          {
            if (this.quicconnectedProm) {
              if (args.success) this.quicconnectedProm.resolve()
              else
                this.quicconnectedProm.reject(
                  new Error('Connecting quic client failed')
                )
            } else throw new Error('Client connected with no pending promise')
          }
          break
        case 'ClientWebtransportSupport':
          {
            if (this.webtransportProm) {
              this.webtransportProm.resolve()
              delete this.webtransportProm
            }
          }
          break
        case 'Http3WTSessionVisitor':
          {
            // create Http3 Visitor
            if (args.session && this.sessionProm && this.sessionobjint) {
              this.sessionobjint.setSessionObj(args.session)
              args.session.jsobj.closeHook = this.closeHookSession
              delete this.sessionobjint
              this.sessionProm.resolve(args.session)
              delete this.sessionProm
            } else
              throw new Error(
                'Http3WTSessionVisitor no object session or nor sessionprom'
              )
          }
          break

        default: {
          throw new Error('unknown purpose')
        }
      }
    }
  }
}

export class WebTransport {
  constructor(url, args) {
    if (!url) throw new Error('no URL supplied')
    const ourl = (this.urlint = new URL(url))

    if (ourl.protocol !== 'https:')
      return new Error('URL is not supported for webtransport')
    const hostname = ourl.hostname
    let port = ourl.port
    if (port == '') port = 443

    this.client = new Http3Client({ hostname, port, ...args })

    this.sessionint = new Http3WTSession({
      /* object: args.session,*/
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
      const session = await this.client.createWTSession(
        this.sessionint,
        this.urlint.pathname
      )
    } catch (error) {
      this.sessionint.readyReject(
        new Error('Establishing session failed ' + error)
      )
      console.log('Establishing session failed ' + error)
    }
  }

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
  static globalLoop = null
  constructor(args) {
    this.eventloopInt = wtrouter.Http3EventLoop({
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
    for (let item of this.refObjects) {
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

  static createGlobalEventLoop() {
    if (!Http3EventLoop.globalLoop) {
      Http3EventLoop.globalLoop = new Http3EventLoop()
      Http3EventLoop.globalLoop.startEventLoop()
      console.log('createGlobalEventLoop')
    }
  }

  static getGlobalEventLoop(object) {
    if (!object) throw new Error('getGlobalEventLoop without reference object')
    if (!Http3EventLoop.globalLoop) Http3EventLoop.createGlobalEventLoop()
    Http3EventLoop.globalLoop.refObjects.add(new WeakRef(object))
    return Http3EventLoop.globalLoop
  }
}

export function testcheck() {
  return !Http3EventLoop.globalLoop
}
