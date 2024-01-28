import { ParserBase, lengthVarInt } from '../parserbase.js'
import { logger } from '../../utils.js'

const log = logger(`webtransport:http2:browserparser`)
/**
 * @param{{offset: Number, buffer: Uint8Array, size: Number}} bs
 */
function readVarInt(bs) {
  if (bs.offset + 1 > bs.size) return undefined
  let val = BigInt(bs.buffer[bs.offset])
  bs.offset++
  const prefix = Number(val) >>> 6
  const intlength = 1 << prefix

  if (bs.offset + intlength - 1 > bs.size) {
    return undefined
  }
  val = val & 0x3fn
  for (let i = 0; i < intlength - 1; i++) {
    val = (val << 8n) | BigInt(bs.buffer[bs.offset])
    bs.offset++
  }
  return val
}

/**
 * @param{{offset: Number, buffer: Uint8Array, size: Number}} bs
 * @param{Number|bigint} int
 */
export function writeVarInt(bs, int) {
  let numbytes = 8n
  let msb = 0xc0n
  const bint = BigInt(int)
  if (bint < 64n) {
    numbytes = 1n
    msb = 0x0n
  } else if (bint < 16384n) {
    numbytes = 2n
    msb = 0x40n
  } else if (bint < 1073741824n) {
    numbytes = 4n
    msb = 0x80n
  }
  bs.buffer[bs.offset] = Number(
    msb | ((bint >> ((numbytes - 1n) * 8n)) & 0xffn)
  )
  bs.offset++

  for (let i = numbytes - 2n; i >= 0n; i--) {
    bs.buffer[bs.offset] = Number((bint >> (i * 8n)) & 0xffn)
    bs.offset++
  }
}

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
    initialStreamSendWindowOffset,
    initialStreamReceiveWindowOffset,
    streamShouldAutoTuneReceiveWindow,
    streamReceiveWindowSizeLimit
  }) {
    super({
      nativesession,
      isclient,
      initialStreamSendWindowOffset,
      initialStreamReceiveWindowOffset,
      streamShouldAutoTuneReceiveWindow,
      streamReceiveWindowSizeLimit
    })
    this.ws = ws
    /** @type {Buffer|undefined} */
    this.saveddata = undefined
    /** @type {Number|undefined} */
    this.rtype = undefined

    this.closesend = false

    this.ws.addEventListener('message', (event) => {
      if (event.data instanceof ArrayBuffer) {
        // binary frame
        this.parseData(new Uint8Array(event.data, 0, event.data.byteLength))
      } else {
        // text frame
        log('Illegal text frame', event.data)
      }
    })
  }

  /**
   * @param {Uint8Array} data
   */
  parseData(data) {
    const bufferstate = { offset: 0, size: data.byteLength, buffer: data }

    const offsetend = bufferstate.size

    const type = Number(readVarInt(bufferstate))

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
              object = this.newStream(streamid)
              if (!object) return // stream broken
            }
            // TODO submit data
            if (offsetend - bufferstate.offset >= 0) {
              const fin = type === ParserBase.WT_STREAM_WFIN
              if (fin) object.onFin()
              object.recvData({
                data: new Uint8Array(
                  bufferstate.buffer.buffer,
                  bufferstate.buffer.byteOffset + bufferstate.offset,
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
      case ParserBase.DATAGRAM:
        this.session.jsobj.onDatagramReceived({
          datagram: new Uint8Array(
            bufferstate.buffer.buffer,
            bufferstate.buffer.byteOffset + bufferstate.offset,
            offsetend - bufferstate.offset
          )
        })

        break
      default:
      // do nothing
    }

    bufferstate.offset = offsetend
  }

  /**
   * @param{{type: Number, headerVints: Array<Number|bigint>, payload: Uint8Array|undefined}} bs
   */
  writeCapsule({ type, headerVints, payload }) {
    let plength = 0
    for (const ind in headerVints) plength += lengthVarInt(headerVints[ind])
    plength += lengthVarInt(type)
    const hlength = plength
    if (payload) plength += payload.byteLength

    const cdata = new Uint8Array(plength)
    const bufferstate = { offset: 0, size: cdata.length, buffer: cdata }
    writeVarInt(bufferstate, type)
    for (const ind in headerVints) writeVarInt(bufferstate, headerVints[ind])
    const dest = new Uint8Array(cdata.buffer, cdata.byteOffset + hlength)
    if (payload) dest.set(payload)
    this.ws.send(cdata)

    /* const blocked = this.ws.bufferedAmount > 1024 * 256
    // do something if blocked
    if (blocked) this.blocked = true
    return blocked */
    return false
  }

  /**
   * @param{{code: Number, reason: string}}arg
   */
  sendClose({ code, reason }) {
    this.ws.close(1000, code.toString() + ':' + reason)
  }
}
