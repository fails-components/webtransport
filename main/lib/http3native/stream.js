import { logger } from '../utils.js'
import { drainableProtocol } from 'stream/iter'
/*
 * @typedef {import('./types').ReadBuffer} ReadBuffer
 */
const pid = typeof process !== 'undefined' ? process.pid : 0
const log = logger(`webtransport:http3webtransportstream(${pid})`)

export class Http3WebTransportStream {
  /**
   * @param {{stream: QuicStream, unidirectional:boolean, incoming: boolean}} args
   * */
  constructor({ stream, unidirectional, incoming }) {
    /** @type {import('../stream').HttpWTStream} */
    // @ts-ignore
    this.jsobj = undefined // the creator will set this
    this.stream = stream
    this.unidirectional = unidirectional
    this.incoming = incoming

    this.stream.onerror = (error) => {
      if (this.jsobj.parentobj?.objint)
        // @ts-ignore
        this.jsobj.parentobj.objint.closeConnection({
          code: 500, // fix the number
          reason: error.toString()
        })
    }
    this.stream.onreset = (error) => {
      // no idea if this makes sense
      // FIX me is this just closing incoming? or outgoing
      this.incomingClosed_ = true
      if (this.outgoingClosed_) this.onClose()
    }
    this.outgoingClosed_ = false
    this.incomingClosed_ = false
    this.readiterator_ = this.stream[Symbol.asyncIterator]()
    this.final = false
    this.inStartReading = false
  }

  async startReading() {
    if (this.inStartReading) return
    this.inStartReading = true
    let stopReadingLoop = false
    try {
      if (!this.readiterator_ || stopReadingLoop) return
      // we just pull once from the iterator
      const result = await this.readiterator_.next()
      const fin = !!result.done

      const chunks = result.value

      if (!chunks) {
        if (fin) {
          this.jsobj.commitReadBuffer({ fin: true })
          this.readiterator_ = undefined
        }
        this.inStartReading = false
        return
      }

      if (!this.jsobj.hasByob()) {
        // thanks no byob
        for (const [index, chunk] of chunks.entries()) {
          const isLast = index === chunks.length - 1
          this.jsobj.commitReadBuffer({
            buffer: chunk,
            fin: fin && isLast,
            readBytes: chunk.byteLength
          })
          if (isLast && fin) {
            this.readiterator_ = undefined
          }
        }
        this.inStartReading = false
        return
      }

      // the byob case, which is actually inefficient

      /** @type {ReadBuffer} */
      let buffer
      let bufferoffset = 0
      while (chunks.length > 0) {
        if (!buffer) {
          const bytes = chunks.reduce(
            (
              /** @type {number} */ prevVal,
              /** @type {Uint8Array}; }} */ val
            ) => prevVal + ((val && val?.byteLength) || 0),
            0
          )
          if (bytes > 0) {
            buffer = this.jsobj.getReadBuffer({
              byteSize: bytes
            })
            buffer.readBytes = 0
            bufferoffset = 0
          }
        }
        const cur = chunks.shift()
        if (cur.byteLength > 0 && buffer && buffer.buffer) {
          const len = Math.min(
            buffer.buffer.byteLength - bufferoffset,
            cur.byteLength
          )
          const srcview = new Uint8Array(cur.buffer, cur.byteOffset, len)
          const destview = new Uint8Array(
            buffer.buffer.buffer,
            bufferoffset,
            len
          )
          destview.set(srcview)
          bufferoffset += len
          // @ts-ignore
          buffer.readBytes += len
          buffer.drained = true
          if (cur.byteLength !== len) {
            buffer.drained = false
            chunks.unshift(
              new Uint8Array(
                cur.buffer,
                cur.byteOffset + len,
                cur.byteLength - len
              )
            )
            buffer.fin = false // next round
          } else {
            buffer.fin ||= fin && chunks.length == 0
            if (fin && chunks.length == 0) {
              this.readiterator_ = undefined
            }
          }
          if (chunks.length > 0) buffer.drained = false
          if (
            bufferoffset === buffer.buffer.byteLength ||
            chunks.length === 0
          ) {
            const { stopReading } = this.jsobj.commitReadBuffer(buffer)
            if (stopReading) {
              // we should stop for know, no more loop iterations
              stopReadingLoop = true
            }
            buffer = undefined
            bufferoffset = 0
          }
          // this.recvBytes += len
        }
      }
    } catch (error) {
      log('startReading error', error)
      this.readiterator_ = undefined // kill the iterator!
    }
    this.inStartReading = false
  }

  drainReads() {
    while (this.readiterator_) {
      this.startReading()
    }
  }

  stopReading() {
    this.readiterator_ = undefined
  }

  /**
   * @param {Uint8Array} buf
   */
  async writeChunk(buf) {
    if (this.final) {
      this.jsobj.onStreamWrite({ success: false })
    }
    try {
      while (!this.stream.writer.writeSync(buf) && !this.stream.destroyed) {
        // Flow controlled — wait for drain before retrying.
        const drainable = this.stream.writer[drainableProtocol]()
        if (drainable) await drainable
      }
      this.jsobj.onStreamWrite({ success: true })
    } catch (error) {
      log('writeChunk failed: ', error)
      this.jsobj.onStreamWrite({ success: false })
      /* this.stream.onStreamNetworkFinish({
        nettask: 'stopSending'
      }) */
    }
  }

  streamFinal() {
    this.final = true
    try {
      this.stream.writer.endSync()
    } catch (error) {
      log('stream final:', error)
    }
    process.nextTick(() => {
      this.jsobj.onStreamNetworkFinish({
        nettask: 'streamFinal'
      })
    })
  }

  /**
   * @param {Number} code
   */
  stopSending(code) {
    this.incomingClosed_ = true
    if (this.outgoingClosed_) this.onClose()
    try {
      this.stream.stopSending(code)
    } catch (error) {
      log('Problem in stopSending', error)
    }
    process.nextTick(() =>
      this.jsobj.onStreamNetworkFinish({
        nettask: 'stopSending'
      })
    )
  }

  onClose() {
    // no idea what to do
  }
}
