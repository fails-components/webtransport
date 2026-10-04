import { ParserBase } from '../parserbase.js'
import {
  lengthVarInt,
  readUint32,
  readVarInt,
  writeVarInt,
  getUint8ArrayfromBuffer,
  getUint8ArraysfromBuffer,
  advanceBufferToOffset,
  detachReadBuffers
} from '../bufferHelper.js'
import { logger } from '../../utils.js'

const log = logger(`webtransport:http2:browserparser`)

export class BrowserParser extends ParserBase {
  static WS_CONTINUE = 0x0
  static WS_TEXT = 0x1
  static WS_BINARY = 0x2
  static WS_CLOSE = 0x8
  static WS_PING = 0x9
  static WS_PONG = 0xa
  /**
   * @param {import('../../types.js').ParserWebsocketInit} stream
   */
  constructor({
    ws,
    nativesession,
    isclient,
    initialStreamSendWindowOffsetUnidi,
    initialStreamSendWindowOffsetBidi,
    initialStreamReceiveWindowOffset,
    streamShouldAutoTuneReceiveWindow,
    streamReceiveWindowSizeLimit
  }) {
    super({
      nativesession,
      isclient,
      initialStreamSendWindowOffsetUnidi,
      initialStreamSendWindowOffsetBidi,
      initialStreamReceiveWindowOffset,
      streamShouldAutoTuneReceiveWindow,
      streamReceiveWindowSizeLimit
    })
    this.ws = ws
    this.bufferstate = {
      /** @type {number} */
      offset: 0,
      /** @type {number} */
      size: 0,
      /** @type {Uint8Array[]} */
      buffer: [],
      /** @type {number} */
      curBuf: 0,
      /** @type {number} */
      curBufOffset: 0
    }
    /** @type {Number|undefined} */
    this.rtype = undefined

    this.closesend = false

    this.ws.addEventListener('message', (event) => {
      if (event.data instanceof ArrayBuffer) {
        // binary frame
        this.parseData([new Uint8Array(event.data, 0, event.data.byteLength)])
      } else {
        // text frame
        log('Illegal text frame', event.data)
      }
    })
  }

  /**
   * @param {Uint8Array[]} data
   */
  parseData(data) {
    const bufferstate = this.bufferstate
    bufferstate.buffer.push(...data)
    bufferstate.size += data.reduce((sum, chunk) => sum + chunk.byteLength, 0)

    const offsetend = bufferstate.size

    const rtype = readVarInt(bufferstate)
    if (typeof rtype === 'undefined') return
    const type = Number(rtype)

    switch (type) {
      case ParserBase.PADDING:
        // only padding do nothing
        break
      case ParserBase.WT_RESET_STREAM:
      case ParserBase.WT_STOP_SENDING:
        {
          const streamid = readVarInt(bufferstate)
          if (typeof streamid !== 'undefined') {
            const stream = this.wtstreams.get(streamid)
            const code = readVarInt(bufferstate)
            if (stream && typeof code !== 'undefined') {
              stream.onStreamSignal(
                type === ParserBase.WT_RESET_STREAM
                  ? 'resetStream'
                  : 'stopSending'
              )
              stream.jsobj.onStreamRecvSignal({
                code: Number(code),
                nettask:
                  type === ParserBase.WT_RESET_STREAM
                    ? 'resetStream'
                    : 'stopSending'
              })
            }
          }
        }
        break
      case ParserBase.WT_STREAM_WOFIN:
      case ParserBase.WT_STREAM_WFIN:
        {
          const streamid = readVarInt(bufferstate)

          if (typeof streamid !== 'undefined') {
            let object = this.wtstreams.get(streamid)
            if (!object) {
              object = this.newStream(streamid, {
                sendOrder: 0,
                sendGroupId: 0n
              })
              if (!object) return // stream broken
            }
            // TODO submit data
            if (offsetend - bufferstate.offset >= 0) {
              const fin = type === ParserBase.WT_STREAM_WFIN
              if (fin) object.onFin()
              object.recvData({
                data: getUint8ArraysfromBuffer(
                  bufferstate,
                  offsetend - bufferstate.offset
                ),
                fin
              })
            }
          }
        }
        break
      case ParserBase.WT_MAX_DATA:
        this.onMaxData(readVarInt(bufferstate))
        break
      case ParserBase.WT_MAX_STREAM_DATA:
        {
          const streamid = readVarInt(bufferstate)
          const offset = readVarInt(bufferstate)
          if (typeof streamid !== 'undefined' && typeof offset !== 'undefined')
            this.onMaxStreamData(streamid, offset)
        }
        break
      case ParserBase.WT_MAX_STREAMS_BIDI:
        this.onMaxStreamBiDi(readVarInt(bufferstate))
        break
      case ParserBase.WT_MAX_STREAMS_UNIDI:
        this.onMaxStreamUniDi(readVarInt(bufferstate))
        break
      case ParserBase.WT_DATA_BLOCKED:
        this.onDataBlocked(readVarInt(bufferstate))
        break
      case ParserBase.WT_STREAM_DATA_BLOCKED:
        {
          const streamid = readVarInt(bufferstate)
          const offset = readVarInt(bufferstate)
          if (typeof streamid !== 'undefined' && typeof offset !== 'undefined')
            this.onStreamDataBlocked(streamid, offset)
        }
        break
      case ParserBase.WT_STREAMS_BLOCKED_UNIDI:
        this.onStreamsBlockedUnidi(readVarInt(bufferstate))
        break
      case ParserBase.WT_STREAMS_BLOCKED_BIDI:
        this.onStreamsBlockedBidi(readVarInt(bufferstate))
        break
      case ParserBase.WT_CLOSE_SESSION:
        {
          const code = readUint32(bufferstate) || 0
          const decoder = new TextDecoder()
          const reason =
            offsetend - bufferstate.offset > 0
              ? decoder.decode(
                  getUint8ArrayfromBuffer(
                    bufferstate,
                    offsetend - bufferstate.offset
                  )
                )
              : ''
          this.onCloseWebTransportSession({ code, reason })
        }
        break
      case ParserBase.WT_DRAIN_SESSION:
        this.onDrain()
        break
      case ParserBase.DATAGRAM:
        this.session.jsobj.onDatagramReceived({
          datagram:
            getUint8ArrayfromBuffer(
              bufferstate,
              offsetend - bufferstate.offset
            ) || new Uint8Array(0)
        })

        break
      default:
      // do nothing
    }
    advanceBufferToOffset(bufferstate, offsetend)
    detachReadBuffers(bufferstate)
  }

  /**
   * @param{{type: Number, headerVints: Array<Number|bigint>, payload: Uint8Array|undefined, end?: () => void}} bs
   */
  writeCapsule({ type, headerVints, payload, end }) {
    let plength = 0
    for (const ind in headerVints) plength += lengthVarInt(headerVints[ind])
    plength += lengthVarInt(type)
    const hlength = plength
    if (payload) plength += payload.byteLength

    const cdata = new Uint8Array(plength)
    const bufferstate = {
      offset: 0,
      size: cdata.length,
      buffer: [cdata],
      curBuf: 0,
      curBufOffset: 0
    }
    writeVarInt(bufferstate, type)
    for (const ind in headerVints) writeVarInt(bufferstate, headerVints[ind])
    const dest = new Uint8Array(cdata.buffer, cdata.byteOffset + hlength)
    if (payload) dest.set(payload)
    this.ws.send(cdata)
    if (end) end()

    /* const blocked = this.ws.bufferedAmount > 1024 * 256
    // do something if blocked
    if (blocked) this.blocked = true
    return blocked */
    return false
  }

  /**
   * @param {number} code
   */
  // eslint-disable-next-line no-unused-vars
  closeHttp2Stream(code) {
    this.ws.close(1000)
  }

  initialParametersMandatory() {
    return true
  }
}
