// Copyright (c) 2022 Marten Richter or other contributers (see commit). All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import { getRoot } from 'bindings'
import { createRequire } from 'module'
import { ReadableStream, WritableStream } from 'node:stream/web'

const require = createRequire(import.meta.url)
let wtpath = '../build/Release/webtransport.node'
if (process.env.NODE_ENV !== 'production') {
  wtpath = '../build/Debug/webtransport.node'
}
const wtrouter = require(wtpath)

class Http3WTStream {
  constructor(args) {
    this.id = args.id
    this.objint = args.object
    this.objint.jsobj = new WeakRef(this)
    this.parentid = args.parentid
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
          start: async (controller) => {
            this.readableController = controller
            this.parentobj.addReceiveStream(this.readable, controller)
            this.objint.startReading()
          },
          pull: async (controller) => {
            if (this.closed) {
              return new Promise((res, rej) => {})
            }
            this.objint.startReading()
          },
          cancel: (controller) => {
            const promise = new Promise((res, rej) => {
              this.abortres = res
            })
            this.objint.closeStream()
          }
        },
        { highWaterMark: 4 }
      )
    }
    if (this.bidirectional || !this.incoming) {
      this.writable = new WritableStream(
        {
          start: async (controller) => {
            this.writableController = controller
            this.parentobj.addSendStream(this.writable, controller)
          },
          write: (chunk, controller) => {
            if (this.closed) {
              return new Promise((res, rej) => {})
            }
            if (chunk instanceof Uint8Array) {
              this.pendingoperation = new Promise((res, rej) => {
                this.pendingres = res
              })
              this.objint.writeChunk(chunk)
              return this.pendingoperation
            } else throw new Error('chunk is not of instanceof Uint8Array ')
          },
          close: (controller) => {
            if (this.closed) {
              return new Promise((res, rej) => {
                res()
              })
            }
            this.objint.closeStream()
            this.pendingoperation = new Promise((res, rej) => {
              this.pendingres = res
            })
            return this.pendingoperation
          },
          abort: (reason) => {
            if (this.closed) {
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
          }
        },
        { highWaterMark: 4 }
      )
    }
  }

  onStreamClosed(args) {
    if (this.readable) this.readableController.close()
    if (this.pendingoperation) {
      const res = this.pendingres
      this.pendingoperation = null
      this.pendingres = null
      res()
    }
    if (this.writable && args.code !== 0) this.writable.error(args.code || 0)
    console.log('stream closed', args)
    if (this.readable) this.parentobj.removeReceiveStream(this.readable, this.readableController)
    if (this.writable) this.parentobj.removeSendStream(this.writable, this.writableController)

    this.closed = true
  }

  onStreamRead(args) {
    if (args.data && !this.readableclosed) {
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
       if (this.readable) this.parentobj.removeReceiveStream(this.readable, this.readableController)
       if (this.writable) this.parentobj.removeSendStream(this.writable, this.writableController)
    }
  }


  static callback(args) {
    console.log('Stream callback called', args)
    if (!args || !args.object || !args.object.jsobj)
      throw new Error('Stream callback without jsobj')
    const visitor = args.object.jsobj.deref()
    if (args.purpose) {
      switch (args.purpose) {
        case 'StreamClosed':
          {
            visitor.onStreamClosed(args)
          }
          break
        case 'StreamRead':
          {
            if (visitor && args.hasOwnProperty('data')) {
              visitor.onStreamRead(args)
            } else throw new Error('Malformed StreamRead')
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
        default: {
          throw new Error('unknown purpose Streamcb')
        }
      }
    } else throw new Error('no purpose Streamcb')
  }
}

class Http3WTSession {
  constructor(args) {
    this.id = args.id
    this.objint = args.object
    this.parentobj = args.parentobj
    this.state = 'connected'

    this.ready = new Promise((res, rej) => {
      this.readyResolve = res
      this.readyReject = rej
    })
    this.closed = new Promise((res, rej) => {
      this.closedResolve = res
      this.closedReject = rej
    })

    this.incomingBidirectionalStreams = new ReadableStream({
      start: async (controller) => {
        this.incomBiDiController = controller
      }
    })

    this.incomingUnidirectionalStreams = new ReadableStream({
      start: async (controller) => {
        this.incomUniDiController = controller
      }
    })

    this.datagrams = {}
    this.datagrams.readable = new ReadableStream({
      start: async (controller) => {
        this.incomDatagramController = controller
      }
    })
    this.writeDatagramRes = []
    this.writeDatagramRej = []
    this.datagrams.writable = new WritableStream({
      start: async (controller) => {
        this.outgoDatagramController = controller
      },
      write: (chunk, controller) => {
        if (chunk instanceof Uint8Array) {
          const ret = new Promise((res, rej) => {
            this.writeDatagramRes.push(res)
            this.writeDatagramRej.push(rej)
          })
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

    this.sendStreamsController = new Set()
    this.receiveStreamsController = new Set()
  }

  addSendStream(stream, controller)
  {
    this.sendStreams.add(stream)
    this.sendStreamsController.add(controller)
  }

  removeSendStream(stream, controller)
  {
    this.sendStreams.delete(stream)
    this.sendStreamsController.delete(controller)
  }

  addReceiveStream(stream, controller)
  {
    this.receiveStreams.add(stream)
    this.receiveStreamsController.add(controller)
  }

  removeReceiveStream(stream, controller)
  {
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
    for (const rej of this.rejectBiDi) rej()
    for (const rej of this.rejectUniDi) rej()
    for (const rej of this.writeDatagramRej) rej()
    this.writeDatagramRej = []
    this.writeDatagramRes = []
    this.resolveBiDi = []
    this.resolveUniDi = []
    this.rejectBiDi = []
    this.rejectUniDi = []

    this.incomBiDiController.close()
    this.incomUniDiController.close()
    this.incomDatagramController.close()
    this.state = 'closed'

    this.sendStreamsController.forEach((ele) => ele.error(errorcode))
    this.receiveStreamsController.forEach((ele) => ele.error(errorcode))

    this.sendStreams.clear()
    this.receiveStreams.clear()
    this.sendStreamsController.clear()
    this.receiveStreamsController.clear()

    delete this.parentobj.sessions[this.id]

    if (this.closedResolve) this.closedResolve(errorcode)
  }

  onStream(args) {
    const strobj = new Http3WTStream({
      id: args.streamid,
      object: args.object,
      parentid: args.id,
      parentobj: this,
      transport: this.parentobj,
      bidirectional: args.bidirectional,
      incoming: args.incoming
    })
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
    this.incomDatagramController.enqueue(args.datagram)
  }

  onDatagramSend(args) {
    this.writeDatagramRej.shift()
    const res = this.writeDatagramRes.shift()
    res()
  }
}

class Http3WebTransport {
  constructor(args) {
    this.transportCallback = this.transportCallback.bind(this)
    this.transportInt = wtrouter.Http3WebTransport(
      args,
      this.transportCallback,
      Http3WTStream.callback
    )

    this.sessions = {}
  }

  transportCallback(args) {
    console.log('incoming callback', args)
    if (args.purpose && args.id) {
      switch (args.purpose) {
        case 'SessionReady':
          {
            const visitor = this.sessions[args.id]
            if (visitor) visitor.onReady()
          }
          break
        case 'SessionClose':
          {
            const visitor = this.sessions[args.id]
            if (visitor) visitor.onClose(args.errorcode, args.error)
            delete this.sessions[args.id]
          }
          break
        case 'DatagramReceived':
          {
            const visitor = this.sessions[args.id]
            if (args.id && visitor && args.hasOwnProperty('datagram'))
              visitor.onDatagramReceived(args)
          }
          break
        case 'DatagramSend':
          {
            const visitor = this.sessions[args.id]
            if (args.id && visitor) visitor.onDatagramSend(args)
          }
          break
        case 'Http3WTStreamVisitor':
          {
            const visitor = this.sessions[args.id]
            if (
              visitor &&
              args.streamid &&
              args.id &&
              args.hasOwnProperty('bidirectional') &&
              args.hasOwnProperty('incoming')
            ) {
              visitor.onStream(args)
            } else throw new Error('Malformed Http3WTStreamVisitor')
          }
          break
        default: {
          if (this.customCallback) {
            this.customCallback(args)
          } else {
            throw new Error('unknown purpose')
          }
        }
      }
    }
  }
}

export class Http3Server extends Http3WebTransport {
  constructor(args) {
    super(args)
    this.sessionStreams = {}
    this.sessionController = {}
  }

  startServer() {
    this.transportInt.startServer()
  }

  destroy() {
    for (let i of this.sessionController) {
      i.close() // inform the controller, that we are closing
    }
    this.transportInt.Destroy() // destroy the server process
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
    // console.log('incoming callback', args)
    if (args.purpose && args.id) {
      switch (args.purpose) {
        case 'Http3WTSessionVisitor':
          {
            // create Http3 Visitor
            if (args.object) {
              const sesobj = new Http3WTSession({
                id: args.id,
                object: args.object,
                parentobj: this
              })
              this.sessions[args.id] = sesobj
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
