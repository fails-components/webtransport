import { Http2CapsuleParser } from './capsuleparser'
import { HttpWTStream } from '../stream'
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

export class Http2WebTransportStream {
  /**
   * @param {{streamid: Number, capsuleParser: Http2CapsuleParser}} args
   * */
  constructor({ streamid, capsuleParser }) {
    /** @type {HttpWTStream} */
    // @ts-ignore
    this.jsobj = undefined // the creator will set this
    this.readbuffer = new Uint8Array(64 * 1024)
    this.readpos_ = 0
    this.writepos_ = 0
    this.bufferlen_ = 0
    this.readbufsize_ = this.readbuffer.byteLength
    this.streamid = streamid
    /** @type {Array<ReadDataInt>} */
    this.incomdata = []

    this.capsuleParser = capsuleParser
    /** @type {Array<Uint8Array>} */
    this.outgochunks = []
  }

  /**
   * @param {Object} obj
   * @param {Uint8Array} obj.data
   * @param {Boolean} obj.fin
   * @param {(args: StreamRecvSignalEvent | StreamReadEvent | StreamWriteEvent  | StreamNetworkFinishEvent) => void} obj.callback
   */
  recvData({ data, fin, callback }) {
    this.incomdata.push({ data, fin })
    this.processRead()
    if (this.incomdata.length > 0) {
      // TODO tell the peer to stop sending by sending a capsule
      // TODO SEND WT_STREAM_DATA_BLOCKED:
    }
  }

  processRead() {
    let bytesRead = 0
    let fin = false

    while (this.incomdata.length > 0 && this.bufferlen_ < this.readbufsize_) {
      const cur = this.incomdata[0]
      let len

      if (this.writepos_ >= this.readpos_) {
        len = Math.min(this.readbufsize_ - this.writepos_, cur.data.byteLength)

        const destview = new Uint8Array(
          this.readbuffer.buffer,
          0 + this.writepos_,
          len
        )
        const srcview = new Uint8Array(
          cur.data.buffer,
          cur.data.byteOffset,
          len
        )
        destview.set(srcview)

        this.writepos_ = (this.writepos_ + len) % this.readbufsize_
        this.bufferlen_ = this.bufferlen_ + len
        bytesRead += len
      } else {
        // readpos_ > writepos_
        len = Math.min(this.writepos_ - this.readpos_, cur.data.byteLength)
        const destview = new Uint8Array(
          this.readbuffer.buffer,
          0 + this.writepos_,
          len
        )
        const srcview = new Uint8Array(
          cur.data.buffer,
          cur.data.byteOffset,
          len
        )
        destview.set(srcview)

        this.writepos_ = (this.writepos_ + len) % this.readbufsize_
        this.bufferlen_ = this.bufferlen_ + len
        bytesRead += len
      }
      if (cur.data.byteLength !== len) {
        this.incomdata[0] = {
          data: new Uint8Array(
            cur.data.buffer,
            cur.data.byteOffset + len,
            cur.data.byteLength
          ),
          fin: cur.fin
        }
      } else {
        fin = fin || cur.fin
        this.incomdata.pop()
      }
    }

    if (bytesRead > 0)
      HttpWTStream.callback({
        object: this,
        purpose: 'StreamRead',
        buffergrow: bytesRead,
        fin,
        success: true
      })
  }

  /**
   * @param {Number} bytesread
   * @param {Number} pos
   */
  updateReadPos(bytesread, pos) {
    this.readpos_ = pos
    this.bufferlen_ -= bytesread
  }

  startReading() {}
  stopReading() {}
  /**
   * @param {Number} code
   */
  stopSending(code) {
    this.capsuleParser.writeCapsule({
      type: Http2CapsuleParser.WT_STOP_SENDING,
      headerVints: [this.streamid, code],
      payload: undefined
    })
  }

  /**
   * @param {Number} code
   */
  resetStream(code) {
    this.capsuleParser.writeCapsule({
      type: Http2CapsuleParser.WT_RESET_STREAM,
      headerVints: [this.streamid, code],
      payload: undefined
    })
  }

  /**
   * @param {Uint8Array} buf
   */
  writeChunk(buf) {
    this.outgochunks.push(buf)
    this.drainWrites()
  }

  drainWrites() {
    while (this.outgochunks.length > 0 && !this.capsuleParser.blocked) {
      const cur = this.outgochunks.pop()
      this.capsuleParser.writeCapsule({
        type: Http2CapsuleParser.WT_STREAM_WOFIN,
        headerVints: [this.streamid],
        payload: cur
      })
    }
  }

  streamFinal() {
    this.capsuleParser.writeCapsule({
      type: Http2CapsuleParser.WT_STREAM_WFIN,
      headerVints: [this.streamid],
      payload: undefined
    })
  }
}
