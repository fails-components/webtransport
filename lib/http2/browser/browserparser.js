import { ParserBase, lengthVarInt } from '../parserbase.js'

/**
 * @param{{offset: Number, buffer: Uint8Array, size: Number}} bs
 */
function readVarInt(bs) {
  let val = bs.buffer[bs.offset]
  bs.offset++
  const prefix = val >>> 6
  const intlength = 1 << prefix

  if (bs.offset + intlength - 1 > bs.size) {
    return undefined
  }
  val = val & 0x3f
  for (let i = 0; i < intlength - 1; i++) {
    val = (val << 8) | bs.buffer[bs.offset]
    bs.offset++
  }
  return val
}

/**
 * @param{{offset: Number, buffer: Uint8Array, size: Number}} bs
 * @param{Number} int
 */
export function writeVarInt(bs, int) {
  let numbytes = 8
  let msb = 0xc0
  if (int < 64) {
    numbytes = 1
    msb = 0x0
  } else if (int < 16384) {
    numbytes = 2
    msb = 0x40
  } else if (int < 1073741824) {
    numbytes = 4
    msb = 0x80
  }
  bs.buffer[bs.offset] = msb | ((int >>> ((numbytes - 1) * 8)) & 0xff)
  bs.offset++

  for (let i = numbytes - 2; i >= 0; i--) {
    bs.buffer[bs.offset] = (int >>> (i * 8)) & 0xff
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
  constructor({ ws, nativesession, isclient }) {
    super({ nativesession, isclient })
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
        console.log('Illegal text frame', event.data)
      }
    })
  }

  /**
   * @param {Uint8Array} data
   */
  parseData(data) {
    const bufferstate = { offset: 0, size: data.byteLength, buffer: data }

    const offsetend = bufferstate.size

    const type = readVarInt(bufferstate)

    // all safeguards passed now apply the mask

    switch (type) {
      case ParserBase.PADDING:
        // only padding do nothing
        break
      case ParserBase.WT_RESET_STREAM:
      case ParserBase.WT_STOP_SENDING:
        {
          const streamid = readVarInt(bufferstate)
          const stream = this.wtstreams.get(streamid)
          const code = readVarInt(bufferstate)
          if (stream && typeof code !== 'undefined')
            stream.jsobj.onStreamRecvSignal({
              code,
              nettask:
                type === ParserBase.WT_RESET_STREAM
                  ? 'resetStream'
                  : 'stopSending'
            })
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
            }
            // TODO submit data
            if (offsetend - bufferstate.offset >= 0) {
              object.recvData({
                data: new Uint8Array(
                  bufferstate.buffer.buffer,
                  bufferstate.buffer.byteOffset + bufferstate.offset,
                  offsetend - bufferstate.offset
                ),
                fin: type === ParserBase.WT_STREAM_WFIN
              })
            }
          }
        }
        break
      case ParserBase.WT_MAX_DATA:
        // this.recvSession({ maxdata: readVarInt(bufferstate), type })
        break
      case ParserBase.WT_MAX_STREAM_DATA:
        /* {
                  const streamid = readVarInt(bufferstate)
                  const object = this.wtstreams.get(streamid)
                  if (object)
                    this.recvStream({
                      maxstreamdata: readVarInt(bufferstate),
                      type,
                      object
                    })
                } */
        break
      case ParserBase.WT_MAX_STREAMS_BIDI:
        // this.recvSession({ maxstreams: readVarInt(bufferstate), type })
        break
      case ParserBase.WT_MAX_STREAMS_UNIDI:
        // this.recvSession({ maxstreams: readVarInt(bufferstate), type })
        break
      case ParserBase.WT_DATA_BLOCKED: // TODO
        // this.recvSession({ maxdata: readVarInt(bufferstate), type })
        break
      case ParserBase.WT_STREAM_DATA_BLOCKED: // TODO
        /* {
                  const streamid = readVarInt(bufferstate)
                  const object = this.wtstreams.get(streamid)
                  if (object)
                    this.recvStream({
                      maxstreamdata: readVarInt(bufferstate),
                      type,
                      object
                    })
                } */
        break
      case ParserBase.WT_STREAMS_BLOCKED_UNIDI:
        /* {
                 const streamid = readVarInt(bufferstate)
                  const object = this.wtstreams.get(streamid)
                  if (object)
                    this.recvStream({
                      maxstreams: readVarInt(bufferstate),
                      type,
                      object
                    })
                } */
        break
      case ParserBase.WT_STREAMS_BLOCKED_BIDI:
        /* {
                  const streamid = readVarInt(bufferstate)
                  const object = this.wtstreams.get(streamid)
                  if (object)
                    this.recvStream({
                      maxstreams: readVarInt(bufferstate),
                      type,
                      streamid
                    })
                } */
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
   * @param{{type: Number, headerVints: Array<Number>, payload: Uint8Array|undefined}} bs
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
