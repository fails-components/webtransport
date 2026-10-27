import { FlowController } from './flowcontroller.js'
import { ParserBase } from './parserbase.js'
import { logger } from '../utils.js'
import { WebTransportError } from '../error.js'
// @ts-ignore
import { getWriter } from './backports/writer.cjs'

const pid = typeof process !== 'undefined' ? process.pid : 0
const log = logger(`webtransport:http2webtransportstream(${pid})`)
/**
 * WebTransport stream events
 * @typedef {import('../types').StreamWriter} StreamWriter
 * @typedef {import('../types').OnStreamErrorCallback} OnStreamErrorCallback
 * @typedef {import('./session').Http2WebTransportSession} Http2WebTransportSession
 *
 * @typedef {import('../types').ReadDataInt} ReadDataInt
 * @typedef {import('../types').FlowControlable} FlowControlable
 * @typedef {import('./streamidmanager.js').StreamIdManager} StreamIdManager
 */

let processnextTick = (/** @type {{ (): void;  }} */ func) =>
  setTimeout(func, 0)
// @ts-ignore
if (typeof process !== 'undefined') processnextTick = process.nextTick

/**
 * @param {{ readerWait: PromiseWithResolvers<void>|undefined; readerWaitTimeOut: boolean; }} inner
 */
function handleReaderWake(inner) {
  const wait = inner.readerWait
  inner.readerWait = undefined
  inner.readerWaitTimeOut = false
  wait?.resolve()
}

export class Http2WebTransportStream {
  #inner = {
    __proto__: null,
    /** @type {bigint | undefined} */
    streamid: undefined,
    /** @type {ParserBase | undefined} */
    capsuleParser: undefined,
    /**  @type {FlowController | undefined} */
    flowController: undefined,
    /**  @type {StreamIdManager | undefined} */
    streamIdManager: undefined,
    /**  @type {FlowController | undefined} */
    sessionFlowController: undefined,
    /**  @type {Http2WebTransportSession | undefined} */
    session: undefined,
    /**  @type {FlowControlable| undefined} */
    flowControlable: undefined,
    /** @type {StreamWriter|undefined} */
    writer: undefined,
    /** @type {Array<ReadDataInt>} */
    incomdata: [],
    /** @type {Array<{buf?:Uint8Array,fin:boolean}>} */
    outgochunks: [],
    /** @type {PromiseWithResolvers<void>|undefined} */
    readerWait: undefined,
    /** @type {boolean} */
    readerWaitTimeOut: false,
    final: false,
    finalmessagesend: false,
    iteratorLocked: false,
    stopReading: true,
    drainReads: false,
    recvBytes: 0,
    outgoingClosed: false,
    incomingClosed: false,
    closed: false,
    /* callbacks */
    /** @type {OnStreamErrorCallback | undefined} */
    onreset: undefined,
    /** @type {OnStreamErrorCallback | undefined} */
    onstopsending: undefined,
    /** @type {((arg: {errorCode: Number} | undefined) => void)|undefined} */
    writerOnStopSending: undefined,
    /** @type {(() => void)|undefined} */
    drainWrites: undefined
  }
  /**
   * @param {{streamid: bigint,
   * unidirectional: boolean,
   * incoming: boolean,
   * capsuleParser: ParserBase
   * session: Http2WebTransportSession
   * sendWindowOffset: Number,
   * receiveWindowOffset: Number,
   * shouldAutoTuneReceiveWindow: boolean
   * receiveWindowSizeLimit: Number,
   * sessionFlowController: FlowController,
   * streamIdManager: StreamIdManager}} args
   * */
  constructor({
    streamid,
    unidirectional,
    incoming,
    capsuleParser,
    session,
    sendWindowOffset,
    receiveWindowOffset,
    shouldAutoTuneReceiveWindow,
    receiveWindowSizeLimit,
    sessionFlowController,
    streamIdManager
  }) {
    const inner = this.#inner
    inner.streamid = streamid
    inner.capsuleParser = capsuleParser
    inner.session = session

    inner.flowController = new FlowController({
      tocontrol: this.#flowControlable,
      sendWindowOffset,
      receiveWindowOffset,
      shouldAutoTuneReceiveWindow,
      receiveWindowSizeLimit,
      sessionFlowController
    })
    inner.sessionFlowController = sessionFlowController
    inner.streamIdManager = streamIdManager

    if (unidirectional) {
      if (incoming) {
        inner.outgoingClosed = true
      } else {
        inner.incomingClosed = true
      }
    }

    this.#maySendInitialParameters()
  }

  #maySendInitialParameters() {
    const inner = this.#inner
    // Note inside node.js this should be dropped
    let skip = false //skips the initial parameters at environment with settings
    if (typeof process !== 'undefined') {
      if (process.version) {
        const majorVersion = parseInt(
          process.version.split('.')[0].substring(1)
        )
        if (majorVersion >= 20) skip = true
      }
    }
    if (!skip || inner.capsuleParser?.initialParametersMandatory()) {
      inner.flowController?.sendWindowUpdate()
    }
  }

  /**
   * @param {Object} obj
   * @param {Uint8Array[]|undefined} obj.data
   * @param {Boolean} obj.fin
   */
  recvData({ data, fin }) {
    const inner = this.#inner
    let datasize = 0
    if (data) {
      const newincomdata = data.map((el, ind, array) => ({
        data: el,
        fin: fin && ind + 1 === array.length
      }))
      datasize = data.reduce((acc, curVal) => acc + curVal.byteLength, 0)
      inner.incomdata.push(...newincomdata)
    } else if (fin) {
      inner.incomdata.push({ data: undefined, fin })
    }
    if (datasize > 0) {
      const checkstream =
        inner.flowController?.updateHighestReceivedOffset(datasize)
      const checksession =
        inner.sessionFlowController?.updateHighestReceivedOffset(datasize)
      if (checksession && checkstream) {
        // As the highest received offset has changed, check to see if this is a
        // violation of flow control.

        if (
          inner.flowController?.flowControlViolation() ||
          inner.sessionFlowController?.flowControlViolation()
        ) {
          this.#flowControlable.closeConnection({
            code: 63 /* QUIC_FLOW_CONTROL_SENT_TOO_MUCH_DATA */,
            reason: 'Flow control violation after increasing offset'
          })

          return
        }
      }
    }
    if (inner.incomdata.length > 0) {
      if (!inner.stopReading) this.processRead()
    }
  }

  processRead() {
    const inner = this.#inner
    if (inner.readerWait && !inner.readerWaitTimeOut) {
      inner.readerWaitTimeOut = true
      setTimeout(handleReaderWake, 0, inner)
    }
  }

  // old drain reads
  /*
    const inner = this.#inner
    if (!inner.jsobj) return
    let buffer
    let bufferoffset = 0
    while (
      inner.incomdata.length > 0 &&
      (!inner.stopReading || inner.drainReads)
    ) {
      if (!buffer) {
        const bytes = inner.incomdata.reduce(
          (prevVal, val) => prevVal + ((val && val.data?.byteLength) || 0),
          0
        )
        if (bytes > 0) {
          buffer = inner.jsobj.getReadBuffer({
            byteSize: inner.incomdata.reduce(
              (prevVal, val) => prevVal + ((val && val.data?.byteLength) || 0),
              0
            )
          })
          if (buffer) buffer.readBytes = 0
          bufferoffset = 0
        }
      }
      const cur = inner.incomdata.shift()
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
          inner.incomdata.unshift({
            data: new Uint8Array(
              cur.data.buffer,
              cur.data.byteOffset + len,
              cur.data.byteLength - len
            ),
            fin: cur.fin
          })
          buffer.fin = false // next round
        } else {
          buffer.fin ||= cur.fin
        }
        if (inner.incomdata.length > 0) buffer.drained = false
        if (
          bufferoffset === buffer.buffer.byteLength ||
          inner.incomdata.length === 0
        ) {
          inner.flowController?.addBytesConsumed(buffer.readBytes || 0)
          inner.sessionFlowController?.addBytesConsumed(buffer.readBytes || 0)
          const { stopReading } = inner.jsobj.commitReadBuffer(buffer)
          if (stopReading) this.stopReading_ = true
          buffer = undefined
          bufferoffset = 0
        }
        inner.recvBytes += len
      } else if (cur?.fin) {
        inner.jsobj.commitReadBuffer({ fin: true })
      }
    }
  }


  drainReads() {
    const inner = this.#inner
    inner.drainReads = true
    inner.stopReading = false
    this.processRead()
  }
*/
  /**
   * @param {'resetStream'|'stopSending'} type
   * @param {number} code
   */
  onStreamSignal(type, code) {
    switch (type) {
      case 'resetStream':
        this.#closeIncoming(code)
        break
      case 'stopSending':
        this.#closeOutgoing(code)
        break
    }
  }

  /**
   * @param {number} [code]
   */
  #closeIncoming(code) {
    const inner = this.#inner
    inner.incomingClosed = true
    if (inner.outgoingClosed) this.onClose()

    const stream = this
    if (typeof code !== 'undefined')
      processnextTick(() => {
        if (inner.writerOnStopSending)
          inner.writerOnStopSending({ errorCode: code })
        inner.onstopsending?.call(stream, code)
      })
  }

  /**
   * @param {number} [code]
   */
  #closeOutgoing(code) {
    const inner = this.#inner
    inner.outgoingClosed = true
    if (inner.incomingClosed) this.onClose()

    const stream = this
    if (typeof code !== 'undefined')
      processnextTick(() => {
        // if ( inner.writerOnStopSending)
        //  inner.readerOnReset({ errorCode: code })
        inner.onreset?.call(stream, code)
      })
  }

  onClose() {
    const inner = this.#inner
    if (inner.closed) return
    // ok, inform our session id manager
    if (typeof inner.streamid !== 'undefined') {
      inner.streamIdManager?.onStreamClosed(inner.streamid)
      // also remove from capsule parser
      inner.capsuleParser?.removeStream(inner.streamid)
    }
    inner.closed = true
  }

  /**
   * @param {number|bigint} code
   */
  stopSending(code) {
    const inner = this.#inner
    inner.stopReading = true
    if (typeof inner.streamid !== 'undefined')
      inner.capsuleParser?.writeCapsule({
        type: ParserBase.WT_STOP_SENDING,
        headerVints: [inner.streamid, Number(code)],
        payload: undefined
      })
  }

  onFin() {
    this.#closeIncoming()
  }

  /**
   * @param {number|bigint} code
   */
  resetStream(code) {
    const inner = this.#inner
    this.#closeOutgoing()
    if (typeof inner.streamid !== 'undefined')
      inner.capsuleParser?.writeCapsule({
        type: ParserBase.WT_RESET_STREAM,
        headerVints: [inner.streamid, Number(code)],
        payload: undefined
      })
  }

  drainWrites() {
    const inner = this.#inner
    let finsend = false
    if (
      !inner.capsuleParser ||
      !inner.flowController ||
      !inner.sessionFlowController ||
      typeof inner.streamid === 'undefined'
    )
      return

    const capsuleChunks = []
    let fin = false
    let windowSize
    let bytesToSend = 0n
    if (
      inner.flowController.sendWindowSize() <
      inner.sessionFlowController.sendWindowSize()
    ) {
      windowSize = inner.flowController.sendWindowSize()
    } else {
      windowSize = inner.sessionFlowController.sendWindowSize()
    }
    let outgoChunkSend = true
    while (
      inner.outgochunks.length > 0 &&
      (!inner.capsuleParser?.blocked ||
        inner.final ||
        !inner.capsuleParser?.shouldYieldStream(inner.streamid)) &&
      windowSize > 0n
    ) {
      const cur = inner.outgochunks.shift()
      if (cur) {
        let payload = cur.buf
        if (payload) {
          if (payload.byteLength === 0 && !cur.fin) {
            throw new WebTransportError(
              'Trying to send zero length capsule without a fin'
            )
          }
          if (BigInt(payload?.byteLength) > windowSize) {
            const len = Number(windowSize)
            // ok we have to split
            {
              const src = new Uint8Array(
                payload.buffer,
                payload.byteOffset + len,
                payload.byteLength - len
              )
              const dest = new Uint8Array(payload.byteLength - len)
              dest.set(src)
              inner.outgochunks.unshift({ fin: cur.fin, buf: dest })
              outgoChunkSend = false // remaing part is send later
            }
            cur.fin = false
            payload = cur.buf = new Uint8Array(
              payload.buffer,
              payload.byteOffset,
              len
            )
          }
          const plength = BigInt(payload.byteLength)
          windowSize -= plength
          bytesToSend += plength
          capsuleChunks.push(payload)
        }
        fin ||= !!cur?.fin
      }
    }

    if (fin || bytesToSend > 0n) {
      inner.capsuleParser.writeCapsule({
        type: fin ? ParserBase.WT_STREAM_WFIN : ParserBase.WT_STREAM_WOFIN,
        headerVints: [inner.streamid],
        payload: bytesToSend > 0n ? capsuleChunks : undefined
      })
    }
    finsend ||= fin

    if (bytesToSend > 0n) {
      inner.flowController.addBytesSent(bytesToSend)
      inner.sessionFlowController.addBytesSent(bytesToSend)
    }
    if (outgoChunkSend) {
      inner.drainWrites?.()
    }

    if (finsend) {
      this.#closeOutgoing()
      return
    }

    if (
      inner.capsuleParser.blocked &&
      !inner.final &&
      inner.capsuleParser.shouldYieldStream(inner.streamid) &&
      inner.outgochunks.length > 0
    ) {
      inner.capsuleParser.scheduleDrainWriteStream(inner.streamid)
    }
    /*
    if (
      inner.final &&
      inner.outgochunks.length === 0 &&
      !inner.finalmessagesend
    ) {
      processnextTick(() => {
        inner.jsobj?.onStreamNetworkFinish({
          nettask: 'streamFinal'
        })
      })
      this.finalmessagesend = true
    }
    */
  }

  /**
   * @param {bigint} offset
   */
  updateSendWindowOffset(offset) {
    const inner = this.#inner
    return inner.flowController?.updateSendWindowOffset(offset)
  }

  /**
   *
   * @param {{sendOrder: number, sendGroupId: bigint}} args
   */
  updateSendOrderAndGroup({ sendOrder, sendGroupId }) {
    const inner = this.#inner
    if (!inner.capsuleParser || typeof inner.streamid === 'undefined') return
    inner.capsuleParser.streamUpdateSendOrderAndGroup(inner.streamid, {
      sendOrder,
      sendGroupId
    })
  }

  get #flowControlable() {
    const inner = this.#inner
    if (inner.flowControlable !== undefined) return inner.flowControlable

    /**
     * @param {bigint} windowOffset
     */
    function sendWindowUpdate(windowOffset) {
      if (!inner.capsuleParser || typeof inner.streamid === 'undefined') return
      log('sendwindow offset stream:', windowOffset)
      inner.capsuleParser.writeCapsule({
        type: ParserBase.WT_MAX_STREAM_DATA,
        headerVints: [inner.streamid, windowOffset],
        payload: undefined
      })
    }

    /**
     * @param {bigint} windowOffset
     */
    function sendBlocked(windowOffset) {
      if (!inner.capsuleParser || typeof inner.streamid === 'undefined') return
      inner.capsuleParser.writeCapsule({
        type: ParserBase.WT_STREAM_DATA_BLOCKED,
        headerVints: [inner.streamid, windowOffset],
        payload: undefined
      })
    }

    function connected() {
      return inner.session?.connected() || false
    }

    /**
     * @param {{ code: number, reason: string }} arg
     */
    function closeConnection({ code, reason }) {
      if (inner.session) inner.session.closeConnection({ code, reason })
    }

    function smoothedRtt() {
      if (inner.session) return inner.session.smoothedRtt()
      return 333
    }

    const flowControlable = {
      __proto__: null,
      sendWindowUpdate,
      sendBlocked,
      connected,
      closeConnection,
      smoothedRtt
    }

    return (inner.flowControlable = flowControlable)
  }

  // Copied from node.js and modified
  /**
   * Returns a Writer for pushing data to this stream incrementally.
   * Non-writable streams return an already-closed Writer.
   * @type {StreamWriter}
   */
  get writer() {
    const inner = this.#inner
    if (inner.writer !== undefined) return inner.writer

    const stream = this

    /**
     * @param {(() => void)} fn
     */
    function setDrainCallback(fn) {
      inner.drainWrites = fn
    }
    /**
     * @param {((arg: { errorCode: number; } | undefined) => void) | undefined} fn
     */
    function setStopSendingCallback(fn) {
      inner.writerOnStopSending = fn
    }
    function writeEnded() {
      return inner.final
    }
    function writeDesiredSize() {
      const ochunksize = inner.outgochunks.reduce(
        (accu, el) => accu + (el?.buf?.byteLength || 0),
        0
      )
      const streamSize = Number(inner.flowController?.sendWindowSize() ?? 0)
      const sessSize = Number(
        inner.sessionFlowController?.sendWindowSize() ?? 0
      )
      if (streamSize < sessSize) {
        return streamSize - ochunksize
      }
      return sessSize - ochunksize
    }
    /**
     * @param {Uint8Array<ArrayBufferLike>[]} chunks
     */
    function writeChunks(chunks) {
      const outgochunks = chunks.map((/** @type {Uint8Array} */ buf) => ({
        buf,
        fin: false
      }))
      inner.outgochunks.push(...outgochunks)
      if (!inner.capsuleParser || typeof inner.streamid === 'undefined') return
      inner.capsuleParser.scheduler.Schedule(inner.streamid)
      inner.capsuleParser.scheduleDrainWrites()
      return true
    }

    /**
     * @param {{ errorCode: any; } | Error | undefined} error
     */
    function resetStream(error) {
      const code = error && 'errorCode' in error ? error.errorCode : 0

      stream.#closeOutgoing()
      if (inner.streamid)
        inner.capsuleParser?.writeCapsule({
          type: ParserBase.WT_RESET_STREAM,
          headerVints: [inner.streamid, code],
          payload: undefined
        })
      processnextTick(() => inner.onreset?.call(stream, code))
    }
    function endWrite() {
      inner.final = true
      inner.outgochunks.push({ fin: true })
      if (!inner.capsuleParser || typeof inner.streamid === 'undefined') return
      inner.capsuleParser.scheduleDrainWriteStream(inner.streamid)
      inner.capsuleParser.scheduleDrainWrites()
    }

    function nonWritableStream() {
      return !inner.capsuleParser || inner.outgoingClosed
    }
    function initStreamingSource() {
      // no init as far as I know...
    }

    const writer = getWriter({
      setDrainCallback,
      setStopSendingCallback,
      writeDesiredSize,
      writeEnded,
      writeChunks,
      resetStream,
      endWrite,
      nonWritableStream,
      initStreamingSource
    })
    return (inner.writer = /** @type {StreamWriter} */ (writer))
  }

  // portions from node.js's QuicStream, see node.js license in backports dir
  /**
   * Returns an AsyncIterator that yields Uint8Array[] batches of
   * incoming data. Only one iterator can be obtained per stream.
   * Non-readable streams return an immediately-finished iterator.
   * @yields {Uint8Array[]}
   */
  async *[Symbol.asyncIterator]() {
    const inner = this.#inner
    if (inner.iteratorLocked) {
      throw new Error('Stream is already being read')
    }
    inner.stopReading = false
    inner.iteratorLocked = true
    if (inner.incomingClosed) return // probably unidirectional or already closed
    while (!inner.stopReading || inner.drainReads) {
      if (inner.incomdata.length > 0) {
        const deliverData = inner.incomdata
        inner.incomdata = []
        let fin = false
        const data = deliverData
          .map((el) => {
            fin ||= el.fin
            return el.data
          })
          .filter((el) => typeof el !== 'undefined' && el.byteLength > 0)
        const datalength = data.reduce(
          (curval, chunk) => curval + (chunk?.byteLength || 0),
          0
        )
        if (datalength > 0) {
          yield data
          inner.flowController?.addBytesConsumed(datalength || 0)
          inner.sessionFlowController?.addBytesConsumed(datalength || 0)
        }
        if (fin) {
          return
        }
      }

      if (inner.drainReads) return // to be verified

      if (inner.incomdata.length === 0) {
        const wait = (inner.readerWait = Promise.withResolvers())
        // wait for promise to fulfill
        await wait.promise
      }
    }
  }

  // callbacks setter and getters
  /** @type {OnStreamErrorCallback} */
  get onreset() {
    // @ts-ignore
    return this.#inner.onreset
  }

  set onreset(fn) {
    const inner = this.#inner
    if (fn === undefined) {
      inner.onreset = undefined
    } else {
      // validateFunction(fn, 'onreset')
      // inner.onreset = FunctionPrototypeBind(fn, this)
      // @ts-ignore
      inner.onreset = fn.bind(this)
    }
  }

  /** @type {OnStreamErrorCallback} */
  get onstopsending() {
    // @ts-ignore
    return this.#inner.onstopsending
  }

  set onstopsending(fn) {
    const inner = this.#inner
    if (fn === undefined) {
      inner.onstopsending = undefined
    } else {
      // validateFunction(fn, 'onstopsending')
      // inner.onstopsending = FunctionPrototypeBind(fn, this);
      // @ts-ignore
      inner.onstopsending = fn.bind(this)
    }
  }
}
