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
    this.parentid = args.parentid
    this.parentobj = args.parentobj
    this.transport = args.transport
    this.bidirectional = args.bidirectional
    this.incoming = args.incoming
    this.closed = false

    this.writeChunksRes = []
    this.writeChunksRej = []

    if (this.bidirectional || this.incoming) {
      this.readable = new ReadableStream({
        start: async (controller) => {
          this.readableController = controller
          this.objint.startReading()
        },
        pull: async (controller) => {
          if (this.closed) {
            return new Promise((res,rej)=>{
              rej()
            })
          }
          this.objint.startReading()
        },
        cancel: (controller) => {
          this.objint.closeStream()
        }
      })
    }
    if (this.bidirectional || !this.incoming) {
      this.writable = new WritableStream({
        start: async (controller) => {
          this.writableController = controller
        },
        write: (chunk, controller) => {
          if (this.closed) {
            return new Promise((res,rej)=>{
              rej()
            })
          }
          if (chunk instanceof Uint8Array) {
            const ret = new Promise((res, rej) => {
              this.writeChunksRes.push(res)
              this.writeChunksRej.push(rej)
            })
            this.objint.writeChunk(chunk)
            return ret
          } else throw new Error('chunk is not of instanceof Uint8Array ')
        },
        close: (controller) => {
          if (!this.closed) this.objint.closeStream()
        }
      })
    }
  }

  onStreamClosed(args) {
    if (this.readable) this.readableController.close()
    for (const rej of this.writeChunksRej) rej()
    this.transport.removeStream(this.parentid, this.id)
    this.writeChunksRej = []
    this.writeChunksRes = []
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
    if (args.success) {
      const front = this.writeChunksRes.shift()
      this.writeChunksRej.shift()
      front()
    } else {
      const front = this.writeChunksRej.shift()
      this.writeChunksRes.shift()
      front('writeChunk failed')
    }
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
    if (this.state === 'closed' ||  this.state === 'failed' ) return
    if(this.objint) {
      this.objint.close({code: closeInfo.closeCode, reason: closeInfo.reason.substring(0,1023)}) ;
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
    this.parentobj.addStream(args.id, args.streamid, strobj)
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

export class Http3Server {
  constructor(args) {
    this.serverCallback = this.serverCallback.bind(this)
    this.serverInt = wtrouter.Http3Server(args, this.serverCallback)

    this.sessions = {}
    this.streams = {}

    this.sessionStreams = {}
    this.sessionController = {}
  }

  addStream(sessionid, streamid, stream)
  {
    let sessinfo = this.streams[sessionid]
    if (!sessinfo) {
      sessinfo = {numstreams: 0}
      this.streams[sessionid] = sessinfo

    }
    sessinfo[streamid] = stream
  }

  getStream(sessionid, streamid)
  {
    let sessinfo = this.streams[sessionid]
    if (!sessinfo) throw new Error('unknown session for stream')
    if (!sessinfo[streamid]) throw new Error('unknown streamid for stream')
    return sessinfo[streamid]
  }

  removeStream(sessionid, streamid)
  {
    let sessinfo = this.streams[sessionid]
    if (!sessinfo) throw new Error('unknown session for stream')
    if (!sessinfo[streamid]) throw new Error('unknown streamid for stream')
    delete sessinfo[streamid]
    sessinfo.numstreams--
    if (sessinfo.numstreams === 0) delete this.streams[sessionid]
  }

  serverCallback(args) {
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
        case 'SessionReady':
          {
            const visitor = this.sessions[args.id]
            if (visitor) visitor.onReady()
          }
          break
        case 'SessionClose':
          {
            const visitor = this.sessions[args.id]
            if (visitor)
              visitor.onClose(args.errorcode, args.error)
            delete this.sessions[args.id]
          }
          break
        case 'DatagramReceived':
          {
            const visitor = this.sessions[args.id]
            if (
              args.id &&
              visitor &&
              args.hasOwnProperty('datagram')
            )
              visitor.onDatagramReceived(args)
          }
          break
        case 'DatagramSend':
          {
            const visitor = this.sessions[args.id]
            if (args.id && visitor)
              visitor.onDatagramSend(args)
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
        case 'StreamClosed':
          {
            const visitor = this.getStream(args.id, args.streamid)
            visitor.onStreamClosed(args)
          }
          break
        case 'StreamRead':
          {
            const visitor =  this.getStream(args.id, args.streamid)
            if (
              visitor &&
              args.hasOwnProperty('data')
            ) {
              visitor.onStreamRead(args)
            } else throw new Error('Malformed StreamRead')
          }
          break
        case 'StreamWrite':
          {
            const visitor =  this.getStream(args.id, args.streamid) 
            visitor.onStreamWrite(args)
          }
          break
        default:
          console.log('unknown purpose')
      }
    }
  }

  startServer() {
    this.serverInt.startServer()
  }

  destroy() {
    for (let i of this.sessionController) {
      i.close() // inform the controller, that we are closing
    }
    this.serverInt.Destroy() // destroy the server process
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
    this.serverInt.addPath(path)
    return this.sessionStreams[path]
  }
}
