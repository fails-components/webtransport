import { FlowController } from './flowcontroller.js'
import { ParserBase } from './parserbase.js'
import { logger } from '../utils.js'

const pid = typeof process !== 'undefined' ? process.pid : 0
const log = logger(`webtransport:http2webtransportstream(${pid})`)
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

let processnextTick = (/** @type {{ (): void;  }} */ func) =>
  setTimeout(func, 0)
// @ts-ignore
if (typeof process !== 'undefined') processnextTick = process.nextTick

export class Http2WebTransportStream {
  /**
   * @param {{streamid: Number, capsuleParser: ParserBase
   * sendWindowOffset: Number,
   * receiveWindowOffset: Number,
   * shouldAutoTuneReceiveWindow: boolean
   * receiveWindowSizeLimit: Number,
   * sessionFlowController: FlowController}} args
   * */
  constructor({
    streamid,
    capsuleParser,
    sendWindowOffset,
    receiveWindowOffset,
    shouldAutoTuneReceiveWindow,
    receiveWindowSizeLimit,
    sessionFlowController
  }) {
    /** @type {import('../stream').HttpWTStream} */
    // @ts-ignore
    this.jsobj = undefined // the creator will set this
    this.streamid = streamid
    /** @type {Array<ReadDataInt>} */
    this.incomdata = []

    this.capsuleParser = capsuleParser
    /** @type {Array<{buf?:Uint8Array,fin:boolean}>} */
    this.outgochunks = []

    this.flowController = new FlowController({
      tocontrol: this,
      sendWindowOffset,
      receiveWindowOffset,
      shouldAutoTuneReceiveWindow,
      receiveWindowSizeLimit,
      sessionFlowController
    })
    this.sessionFlowController = sessionFlowController

    this.final = false
    this.stopReading_ = true
    this.drainReads_ = true
    this.recvBytes = 0
  }

  sendInitialParameters() {
    this.flowController.sendWindowUpdate()
  }

  /**
   * @param {Object} obj
   * @param {Uint8Array} obj.data
   * @param {Boolean} obj.fin
   */
  recvData({ data, fin }) {
    this.incomdata.push({ data, fin })
    if (data?.byteLength > 0) {
      const checkstream = this.flowController.updateHighestReceivedOffset(
        data?.byteLength
      )
      const checksession =
        this.sessionFlowController.updateHighestReceivedOffset(data?.byteLength)
      if (checksession && checkstream) {
        // As the highest received offset has changed, check to see if this is a
        // violation of flow control.

        if (
          this.flowController.flowControlViolation() ||
          this.sessionFlowController.flowControlViolation()
        ) {
          this.closeConnection({
            code: 63 /* QUIC_FLOW_CONTROL_SENT_TOO_MUCH_DATA */,
            reason: 'Flow control violation after increasing offset'
          })

          return
        }
      }
    }
    this.processRead()
    if (this.incomdata.length > 0) {
      if (!this.stopReading_) this.processRead()
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
      if (cur?.data && cur.data.byteLength > 0 && buffer && buffer.buffer) {
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
        // @ts-ignore
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
          buffer.fin ||= cur.fin
        }
        if (this.incomdata.length > 0) buffer.drained = false
        if (
          bufferoffset === buffer.buffer.byteLength ||
          this.incomdata.length === 0
        ) {
          this.flowController.addBytesConsumed(buffer.readBytes || 0)
          this.sessionFlowController.addBytesConsumed(buffer.readBytes || 0)
          const { stopReading } = this.jsobj.commitReadBuffer(buffer)
          if (stopReading) this.stopReading_ = true
          buffer = undefined
          bufferoffset = 0
        }
        this.recvBytes += len
      } else if (cur?.fin) {
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
      (!this.capsuleParser.blocked || this.final) &&
      this.flowController.sendWindowSize() > 0 &&
      this.sessionFlowController.sendWindowSize() > 0
    ) {
      const cur = this.outgochunks.shift()
      if (cur) {
        let payload = cur.buf
        if (payload) {
          const sessWindow = this.sessionFlowController.sendWindowSize()
          const streamWindow = this.flowController.sendWindowSize()
          if (
            payload?.byteLength > streamWindow ||
            payload?.byteLength > sessWindow
          ) {
            const len =
              sessWindow > streamWindow
                ? Number(streamWindow)
                : Number(sessWindow)
            // ok we have to split
            {
              const src = new Uint8Array(
                payload.buffer,
                payload.byteOffset + len,
                payload.byteLength - len
              )
              const dest = new Uint8Array(payload.byteLength - len)
              dest.set(src)
              this.outgochunks.unshift({ fin: cur.fin, buf: dest })
            }
            cur.fin = false
            payload = cur.buf = new Uint8Array(
              payload.buffer,
              payload.byteOffset,
              len
            )
          }
        }
        this.capsuleParser.writeCapsule({
          type: cur?.fin
            ? ParserBase.WT_STREAM_WFIN
            : ParserBase.WT_STREAM_WOFIN,
          headerVints: [this.streamid],
          payload
        })

        if (payload) {
          this.flowController.addBytesSent(payload?.byteLength)
          this.sessionFlowController.addBytesSent(payload?.byteLength)
        }
      }
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

  /**
   * @param {bigint} windowOffset
   */
  sendWindowUpdate(windowOffset) {
    this.capsuleParser.writeCapsule({
      type: ParserBase.WT_MAX_STREAM_DATA,
      headerVints: [this.streamid, windowOffset],
      payload: undefined
    })
  }

  /**
   * @param {bigint} windowOffset
   */
  sendBlocked(windowOffset) {
    this.capsuleParser.writeCapsule({
      type: ParserBase.WT_STREAM_DATA_BLOCKED,
      headerVints: [this.streamid, windowOffset],
      payload: undefined
    })
  }

  /**
   * @param {bigint} pos
   */
  reportBlocked(pos) {
    log('Stream id: ', this.streamid, ' was blocked at:', pos)
  }

  connected() {
    return this.jsobj.parentobj.state === 'connected'
  }

  /**
   * @param {{ code: number, reason: string }} arg
   */
  closeConnection({ code, reason }) {
    if (this.jsobj.parentobj?.objint)
      // @ts-ignore
      this.jsobj.parentobj.objint.closeConnection({ code, reason })
  }

  smoothedRtt() {
    if (this.jsobj.parentobj?.objint)
      // @ts-ignore
      return this.jsobj.parentobj.objint.smoothedRtt()
  }
}
