import { ParserBase } from './parserbase.js'
/**
 * WebTransport stream events
 * @typedef {import('../types').WebTransportStreamEventHandler} WebTransportStreamEventHandler
 * @typedef {import('../types').StreamRecvSignalEvent} StreamRecvSignalEvent
 * @typedef {import('../types').StreamReadEvent} StreamReadEvent
 * @typedef {import('../types').StreamWriteEvent} StreamWriteEvent
 * @typedef {import('../types').StreamNetworkFinishEvent} StreamNetworkFinishEvent
 *
 *  @typedef {import('../types').ReadDataInt} ReadDataInt
 */

let processnextTick = (func) => setTimeout(func, 0)
if (typeof process !== 'undefined') processnextTick = process.nextTick

export class Http2WebTransportStream {
  /**
   * @param {{streamid: Number, capsuleParser: ParserBase}} args
   * */
  constructor({ streamid, capsuleParser }) {
    /** @type {import('../stream').HttpWTStream} */
    // @ts-ignore
    this.jsobj = undefined // the creator will set this
    this.streamid = streamid
    /** @type {Array<ReadDataInt>} */
    this.incomdata = []

    this.capsuleParser = capsuleParser
    /** @type {Array<Uint8Array>} */
    this.outgochunks = []

    this.final = false
    this.stopReading_ = true
    this.drainReads_ = true
    this.recvBytes = 0
  }

  /**
   * @param {Object} obj
   * @param {Uint8Array} obj.data
   * @param {Boolean} obj.fin
   */
  recvData({ data, fin }) {
    this.incomdata.push({ data, fin })
    this.processRead()
    if (this.incomdata.length > 0) {
      // TODO tell the peer to stop sending by sending a capsule
      // TODO SEND WT_STREAM_DATA_BLOCKED:
      if (!this.stopReading_) this.processRead()
      else {
        this.capsuleParser.writeCapsule({
          type: ParserBase.WT_STREAM_DATA_BLOCKED,
          headerVints: [this.streamid, this.recvBytes],
          payload: undefined
        })
      }
    }
  }

  processRead() {
    if (!this.jsobj) return
    let buffer
    let bufferoffset = 0
    while (
      this.incomdata.length > 0 &&
      (!this.stopReading_ || this.drainReads_)
    ) {
      if (!buffer) {
        const bytes = this.incomdata.reduce(
          (prevVal, val) => prevVal + val.data?.byteLength,
          0
        )
        if (bytes > 0) {
          buffer = this.jsobj.getReadBuffer({
            byteSize: this.incomdata.reduce(
              (prevVal, val) => prevVal + val.data?.byteLength,
              0
            )
          })
          buffer.readBytes = 0
          bufferoffset = 0
        }
      }
      const cur = this.incomdata.shift()
      if (cur.data && cur.data.byteLength > 0) {
        const len = Math.min(
          buffer.buffer.byteLength - bufferoffset,
          cur.data.byteLength
        )
        const srcview = new Uint8Array(
          cur.data.buffer,
          cur.data.byteOffset,
          len
        )
        const destview = new Uint8Array(buffer.buffer.buffer, bufferoffset, len)
        destview.set(srcview)
        bufferoffset += len
        buffer.readBytes += len
        buffer.drained = true
        if (cur.data.byteLength !== len) {
          buffer.drained = false
          this.incomdata.unshift({
            data: new Uint8Array(
              cur.data.buffer,
              cur.data.byteOffset + len,
              cur.data.byteLength - len
            ),
            fin: false || cur.fin
          })
          buffer.fin = false // next round
        } else {
          buffer.fin |= cur.fin
        }
        if (this.incomdata.length > 0) buffer.drained = false
        if (
          bufferoffset === buffer.buffer.byteLength ||
          this.incomdata.length === 0
        ) {
          const { stopReading } = this.jsobj.commitReadBuffer(buffer)
          if (stopReading) this.stopReading_ = true
          buffer = undefined
          bufferoffset = 0
        }
        this.recvBytes += len
      } else if (cur.fin) {
        this.jsobj.commitReadBuffer({ fin: true })
      }
    }
  }

  startReading() {
    this.stopReading_ = false
    this.processRead()
  }

  drainReads() {
    this.drainReads_ = true
    this.stopReading_ = false
    this.processRead()
  }

  stopReading() {
    this.stopReading_ = true
  }

  /**
   * @param {Number} code
   */
  stopSending(code) {
    this.capsuleParser.writeCapsule({
      type: ParserBase.WT_STOP_SENDING,
      headerVints: [this.streamid, code],
      payload: undefined
    })
    processnextTick(() =>
      this.jsobj.onStreamNetworkFinish({
        nettask: 'stopSending'
      })
    )
  }

  /**
   * @param {Number} code
   */
  resetStream(code) {
    this.capsuleParser.writeCapsule({
      type: ParserBase.WT_RESET_STREAM,
      headerVints: [this.streamid, code],
      payload: undefined
    })
    processnextTick(() =>
      this.jsobj.onStreamNetworkFinish({
        nettask: 'resetStream'
      })
    )
  }

  /**
   * @param {Uint8Array} buf
   */
  writeChunk(buf) {
    this.outgochunks.push({ buf, fin: false })
    this.drainWrites()
  }

  drainWrites() {
    while (
      this.outgochunks.length > 0 &&
      (!this.capsuleParser.blocked || this.final)
    ) {
      const cur = this.outgochunks.shift()
      const payload = cur.buf
      this.capsuleParser.writeCapsule({
        type: cur?.fin ? ParserBase.WT_STREAM_WFIN : ParserBase.WT_STREAM_WOFIN,
        headerVints: [this.streamid],
        payload
      })
      this.jsobj.onStreamWrite({
        success: true
      })
    }
  }

  streamFinal() {
    this.final = true
    this.outgochunks.push({ fin: true })
    this.drainWrites()
    processnextTick(() =>
      this.jsobj.onStreamNetworkFinish({
        nettask: 'streamFinal'
      })
    )
  }
}
