import { randomBytes } from 'node:crypto'
import { ParserBase, lengthVarInt } from '../parserbase.js'
import {
  ParserBaseHttp2,
  readVarInt,
  writeVarInt,
  readUint32
} from '../parserbasehttp2.js'
import { logger } from '../../utils.js'

const log = logger(`webtransport:http2:node:websocketparser(${process?.pid})`)
/**
 * @typedef {import('node:http2').Http2Stream} Http2Stream
 */

/**
 * @param{{offset: Number, buffer: Buffer, size: Number}} bs
 */
function readByte(bs) {
  const val = bs.buffer.readUInt8(bs.offset)
  bs.offset++
  return val
}

/**
 * @param{{offset: Number, buffer: Buffer, size: Number}} bs
 */
function readWord(bs) {
  let val = bs.buffer.readUInt8(bs.offset)
  bs.offset++
  val = (val << 8) | bs.buffer.readUInt8(bs.offset)
  bs.offset++
  return val
}

/**
 * @param{{offset: Number, buffer: Buffer, size: Number}} bs
 * @param{{offset: Number, mask: Uint8Array}} ms
 */
export function readVarIntMasked(bs, ms) {
  let val = bs.buffer.readUInt8(bs.offset) ^ ms.mask[ms.offset % 4]
  bs.offset++
  ms.offset++
  const prefix = val >>> 6
  const intlength = 1 << prefix

  if (bs.offset + intlength - 1 > bs.size) {
    return undefined
  }
  val = val & 0x3f
  for (let i = 0; i < intlength - 1; i++) {
    val = (val << 8) | (bs.buffer.readUInt8(bs.offset) ^ ms.mask[ms.offset % 4])
    bs.offset++
    ms.offset++
  }
  return val
}

/**
 * @param{{offset: Number, buffer: Buffer, size: Number}} bs
 */
function readQWord(bs) {
  let val = bs.buffer.readUInt8(bs.offset)
  bs.offset++
  val = (val << 8) | bs.buffer.readUInt8(bs.offset)
  bs.offset++
  val = (val << 8) | bs.buffer.readUInt8(bs.offset)
  bs.offset++
  val = (val << 8) | bs.buffer.readUInt8(bs.offset)
  bs.offset++
  val = (val << 8) | bs.buffer.readUInt8(bs.offset)
  bs.offset++
  val = (val << 8) | bs.buffer.readUInt8(bs.offset)
  bs.offset++
  val = (val << 8) | bs.buffer.readUInt8(bs.offset)
  bs.offset++
  val = (val << 8) | bs.buffer.readUInt8(bs.offset)
  bs.offset++
  return val
}

/**
 * @param{{offset: Number, mask: Uint8Array}} ms
 * @param{Buffer} buffer
 * @param{number} offset
 * @param{number} length
 */
function applyMask(ms, buffer, offset, length) {
  // Note offset: includes the byteOffset into the buffer
  if (length > 24) {
    let run = 0
    // alignment preamble, inspired from ws bufferutil
    const data = new Uint8Array(buffer.buffer)
    while (run < length && (offset + run) % 8) {
      data[run + offset] ^= ms.mask[(run + ms.offset) % 4]
      run++
    }
    // construct workmask
    const workmask = new Uint8Array(8)
    workmask[0] = ms.mask[(0 + run + ms.offset) % 4]
    workmask[1] = ms.mask[(1 + run + ms.offset) % 4]
    workmask[2] = ms.mask[(2 + run + ms.offset) % 4]
    workmask[3] = ms.mask[(3 + run + ms.offset) % 4]
    workmask[4] = ms.mask[(4 + run + ms.offset) % 4]
    workmask[5] = ms.mask[(5 + run + ms.offset) % 4]
    workmask[6] = ms.mask[(6 + run + ms.offset) % 4]
    workmask[7] = ms.mask[(7 + run + ms.offset) % 4]
    const data64 = new BigUint64Array(
      buffer.buffer,
      run + offset,
      Math.floor((length - run) / 8)
    )
    const workmask64 = new BigUint64Array(workmask.buffer)
    let run64 = 0
    while (run + 8 < length) {
      data64[run64] ^= workmask64[0]
      run += 8
      run64++
    }
    // alignment end
    while (run < length) {
      data[run + offset] ^= ms.mask[(run + ms.offset) % 4]
      run++
    }
  } else {
    const workmask = new Uint8Array(4)
    workmask[0] = ms.mask[(0 + ms.offset) % 4]
    workmask[1] = ms.mask[(1 + ms.offset) % 4]
    workmask[2] = ms.mask[(2 + ms.offset) % 4]
    workmask[3] = ms.mask[(3 + ms.offset) % 4]
    const data = new Uint8Array(buffer.buffer, offset, length)
    for (let run = 0 /* Math.round(length / 4) * 4 */; run < length; run++) {
      data[run] ^= workmask[run % 4]
    }
    ms.offset += length
  }
}
/*
function readDWord(bs) {
  let val = bs.buffer.readUInt8(bs.offset)
  bs.offset++
  val = (val << 8) | bs.buffer.readUInt8(bs.offset)
  bs.offset++
  val = (val << 8) | bs.buffer.readUInt8(bs.offset)
  bs.offset++
  val = (val << 8) | bs.buffer.readUInt8(bs.offset)
  bs.offset++
  return val
}
*/

/**
 * @param{{offset: Number, buffer: Buffer, size: Number}} bs
 */
function readMask(bs) {
  const val = new Uint8Array(4)
  val[0] = bs.buffer.readUInt8(bs.offset)
  bs.offset++
  val[1] = bs.buffer.readUInt8(bs.offset)
  bs.offset++
  val[2] = bs.buffer.readUInt8(bs.offset)
  bs.offset++
  val[3] = bs.buffer.readUInt8(bs.offset)
  bs.offset++
  return val
}

export class WebSocketParser extends ParserBaseHttp2 {
  static WS_CONTINUE = 0x0
  static WS_TEXT = 0x1
  static WS_BINARY = 0x2
  static WS_CLOSE = 0x8
  static WS_PING = 0x9
  static WS_PONG = 0xa
  /**
   * @param {import('../../types.js').ParserHttp2Init} stream
   */
  constructor({
    stream,
    nativesession,
    isclient,
    initialStreamSendWindowOffsetUnidi,
    initialStreamSendWindowOffsetBidi,
    initialStreamReceiveWindowOffset,
    streamShouldAutoTuneReceiveWindow,
    streamReceiveWindowSizeLimit
  }) {
    super({
      stream,
      nativesession,
      isclient,
      initialStreamSendWindowOffsetUnidi,
      initialStreamSendWindowOffsetBidi,
      initialStreamReceiveWindowOffset,
      streamShouldAutoTuneReceiveWindow,
      streamReceiveWindowSizeLimit
    })
    this.mode = 's' // frame start
    /** @type {Buffer|undefined} */
    this.saveddata = undefined
    /** @type {Number|undefined} */
    this.rtype = undefined

    this.bidirectionalLimitsSet = false
    this.unidirectionalLimitsSet = false
  }

  /**
   * @param {Buffer} data
   */
  parseData(data) {
    let cdata = data
    if (this.saveddata) {
      cdata = Buffer.concat([this.saveddata, cdata])
      delete this.saveddata
    }
    const bufferstate = { offset: 0, size: cdata.length, buffer: cdata }
    while (bufferstate.size - bufferstate.offset > 0) {
      switch (this.mode) {
        case 's':
          {
            const framestart =
              bufferstate.offset + bufferstate.buffer.byteOffset
            const framemaxlength =
              bufferstate.buffer.byteLength - bufferstate.offset
            // we are at frame start
            if (bufferstate.size < 2 + bufferstate.offset) {
              this.saveddata = Buffer.from(
                bufferstate.buffer.buffer,
                framestart,
                framemaxlength
              )
              return
            }
            let curbyte = readByte(bufferstate)
            const fin = (curbyte & 0x80) >>> 7
            const rsv = (curbyte & 0x30) >>> 4
            if (rsv !== 0) {
              log('Rsv bits set, should not happen!')
            }
            const opcode = curbyte & 0x0f
            curbyte = readByte(bufferstate)
            const mask = (curbyte & 0x80) >>> 7
            const mlength = mask ? 4 : 0
            let plength = curbyte & 0x7f
            if (plength === 126) {
              if (bufferstate.size < 2 + bufferstate.offset) {
                this.saveddata = Buffer.from(
                  bufferstate.buffer.buffer,
                  framestart,
                  framemaxlength
                )
                return
              }
              plength = readWord(bufferstate)
            } else if (plength === 127) {
              if (bufferstate.size < 8 + bufferstate.offset) {
                this.saveddata = Buffer.from(
                  bufferstate.buffer.buffer,
                  framestart,
                  framemaxlength
                )
                return
              }
              plength = readQWord(bufferstate)
            }
            if (bufferstate.size < mlength + bufferstate.offset) {
              this.saveddata = Buffer.from(
                bufferstate.buffer.buffer,
                framestart,
                framemaxlength
              )
              return
            }
            if (mask) {
              this.maskcontext = {
                mask: readMask(bufferstate),
                offset: 0
              }
            } else {
              this.maskcontext = undefined
            }
            if (!fin && opcode !== WebSocketParser.WS_CONTINUE) {
              this.lastopcode = opcode
            }
            if (fin) this.lastopcode = undefined
            if (
              opcode === WebSocketParser.WS_CLOSE ||
              opcode === WebSocketParser.WS_PING ||
              opcode === WebSocketParser.WS_PONG
            ) {
              const length = plength

              if (
                length >
                4 * Number(this.session.flowController.receiveWindowSize)
              ) {
                // too long abort, could be an attack vector
                this.session.closeConnection({
                  code: 63, // QUIC_FLOW_CONTROL_SENT_TOO_MUCH_DATA, // probably the right one...
                  reason: 'Frame length too big :' + length
                })
                return
              } else {
                if (bufferstate.size < length + bufferstate.offset) {
                  this.saveddata = Buffer.from(
                    bufferstate.buffer.buffer,
                    framestart,
                    framemaxlength
                  )
                  return
                }
              }
              switch (opcode) {
                case WebSocketParser.WS_CLOSE:
                  if (!this.closesend) {
                    if (this.maskcontext)
                      applyMask(
                        this.maskcontext,
                        bufferstate.buffer,
                        bufferstate.buffer.byteOffset + bufferstate.offset,
                        length
                      )
                    this.sendCloseInt(
                      new Uint8Array(
                        bufferstate.buffer.buffer,
                        bufferstate.buffer.byteOffset + bufferstate.offset,
                        length
                      )
                    )
                    let code = 0
                    let error = 'Session websocket closed'
                    if (length > 2) {
                      const bufhelp = Buffer.from(
                        bufferstate.buffer.buffer,
                        bufferstate.buffer.byteOffset + bufferstate.offset,
                        length
                      )
                      code = bufhelp.readUint16BE(0)
                      const terror = bufhelp.toString('utf8', 2)
                      let tokens = terror.split(':')
                      if (tokens.length > 1) {
                        code = parseInt(tokens[0])
                        tokens = tokens.slice(1)
                      }
                      error = tokens.join(':')
                    }
                    this.session.jsobj.onClose({
                      errorcode: code,
                      error
                    })
                  } else {
                    // just the answer
                  }
                  break
                case WebSocketParser.WS_PING:
                  if (this.maskcontext)
                    applyMask(
                      this.maskcontext,
                      bufferstate.buffer,
                      bufferstate.buffer.byteOffset + bufferstate.offset,
                      length
                    )
                  this.sendPong(
                    new Uint8Array(
                      bufferstate.buffer.buffer,
                      bufferstate.buffer.byteOffset + bufferstate.offset,
                      length
                    )
                  )
                  break
                default: // aka pong
              }
              bufferstate.offset += length
            } else if (
              opcode === WebSocketParser.WS_BINARY ||
              (opcode === WebSocketParser.WS_CONTINUE &&
                this.lastopcode === WebSocketParser.WS_BINARY)
            ) {
              let typelength
              let type
              let continuep

              if (plength === 0) {
                log('warning empty data frame')
                // empty frame ?
                bufferstate.offset += plength
                continue
              }

              if (opcode === WebSocketParser.WS_BINARY) {
                if (bufferstate.size < 2 + bufferstate.offset) {
                  this.saveddata = Buffer.from(
                    bufferstate.buffer.buffer,
                    framestart,
                    framemaxlength
                  )
                  return
                }
                continuep = false
                typelength = -bufferstate.offset
                // we are at capsule start
                if (this.maskcontext)
                  type = readVarIntMasked(bufferstate, this.maskcontext)
                else type = readVarInt(bufferstate)
                typelength += bufferstate.offset
                if (
                  typeof type === 'undefined' ||
                  bufferstate.size < 1 + bufferstate.offset
                ) {
                  this.saveddata = Buffer.from(
                    bufferstate.buffer.buffer,
                    framestart,
                    framemaxlength
                  )
                  return
                }
                this.curtype = type
              } else {
                // for the case of a continuation packet
                continuep = true
                typelength = 0
                type = this.curtype
              }
              const length = plength - typelength

              let checklength = length // we want to read most times the full capsule
              const offsetend = Math.min(
                bufferstate.offset + length,
                bufferstate.size
              )
              const offsetbegin = bufferstate.offset
              if (
                type === ParserBase.PADDING ||
                type === ParserBase.WT_STREAM_WOFIN ||
                type ===
                  ParserBase.WT_STREAM_WFIN /* || type === ParserBase.DATAGRAM */
              ) {
                checklength = Math.min(length, 64) // stream id + some Data
              }
              if (bufferstate.size < checklength + bufferstate.offset) {
                this.saveddata = Buffer.from(
                  bufferstate.buffer.buffer,
                  framestart,
                  framemaxlength
                )
                return
              }
              // all safeguards passed now apply the mask
              if (this.maskcontext)
                applyMask(
                  this.maskcontext,
                  bufferstate.buffer,
                  bufferstate.buffer.byteOffset + bufferstate.offset,
                  offsetend - bufferstate.offset
                )
              let streamid
              let wbufferstate
              if (
                type !== ParserBase.WT_STREAM_WOFIN ||
                type !== ParserBase.WT_STREAM_WOFIN
              ) {
                if (fin) {
                  wbufferstate = bufferstate
                  if (this.contframes) {
                    this.contframes.push(
                      new Uint8Array(
                        bufferstate.buffer.buffer,
                        bufferstate.buffer.byteOffset + bufferstate.offset,
                        offsetend - bufferstate.offset
                      )
                    )
                    // we need to concat all buffers super
                    const nsize = this.contframes.reduce(
                      (length, val) => length + val.byteLength,
                      0
                    )
                    const jbuffer = Buffer.allocUnsafe(nsize)
                    this.contframes.reduce((offset, val) => {
                      Buffer.from(
                        val.buffer,
                        val.byteOffset,
                        val.byteLength
                      ).copy(jbuffer, offset)
                      return offset + val.byteLength
                    }, 0)
                    wbufferstate = { offset: 0, size: nsize, buffer: jbuffer }
                  }
                } else {
                  if (!this.contframes)
                    /**
                     * @type {Uint8Array[]}
                     */
                    this.contframes = []
                  this.contframes.push(
                    new Uint8Array(
                      bufferstate.buffer.buffer,
                      bufferstate.buffer.byteOffset + bufferstate.offset,
                      offsetend - bufferstate.offset
                    )
                  )
                }
              }

              switch (type) {
                case ParserBase.PADDING:
                  // only padding do nothing
                  break
                case ParserBase.WT_RESET_STREAM:
                case ParserBase.WT_STOP_SENDING:
                  if (wbufferstate) {
                    const streamid = readVarInt(wbufferstate)
                    if (typeof streamid !== 'undefined') {
                      const stream = this.wtstreams.get(streamid)
                      const code = readVarInt(wbufferstate)
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
                  if (!continuep) {
                    streamid = readVarInt(bufferstate)
                    this.cstreamid = streamid
                  } else {
                    streamid = this.cstreamid
                  }
                  if (typeof streamid !== 'undefined') {
                    let object = this.wtstreams.get(streamid)
                    if (!object) {
                      object = this.newStream(streamid)
                      if (!object) return // stream broken
                    }
                    // TODO submit data
                    if (offsetend - bufferstate.offset >= 0) {
                      const fin =
                        type === ParserBase.WT_STREAM_WFIN &&
                        bufferstate.size >= length + offsetbegin
                      if (fin) object.onFin()
                      object.recvData({
                        data:
                          offsetend - bufferstate.offset > 0
                            ? new Uint8Array(
                                bufferstate.buffer.buffer,
                                bufferstate.buffer.byteOffset +
                                  bufferstate.offset,
                                offsetend - bufferstate.offset
                              )
                            : undefined,
                        fin
                      })
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
                    if (
                      typeof streamid !== 'undefined' &&
                      typeof offset !== 'undefined'
                    )
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
                    if (
                      typeof streamid !== 'undefined' &&
                      typeof offset !== 'undefined'
                    )
                      this.onStreamDataBlocked(streamid, offset)
                  }
                  break
                case ParserBase.WT_STREAMS_BLOCKED_UNIDI:
                  this.onStreamsBlockedUnidi(readVarInt(bufferstate))
                  break
                case ParserBase.WT_STREAMS_BLOCKED_BIDI:
                  this.onStreamsBlockedBidi(readVarInt(bufferstate))
                  break
                case ParserBase.CLOSE_WEBTRANSPORT_SESSION:
                  {
                    const code = readUint32(bufferstate) || 0
                    const decoder = new TextDecoder()
                    const reason = decoder.decode(
                      new Uint8Array(
                        bufferstate.buffer.buffer,
                        bufferstate.buffer.byteOffset + bufferstate.offset,
                        offsetend - bufferstate.offset
                      )
                    )
                    this.onCloseWebTransportSession({ code, reason })
                  }
                  break
                case ParserBase.DRAIN_WEBTRANSPORT_SESSION:
                  this.onDrain()
                  break
                case ParserBase.DATAGRAM:
                  if (wbufferstate) {
                    this.session.jsobj.onDatagramReceived({
                      datagram: new Uint8Array(
                        wbufferstate.buffer.buffer,
                        wbufferstate.buffer.byteOffset + wbufferstate.offset,
                        offsetend - wbufferstate.offset
                      )
                    })
                  }
                  break
                default:
                // do nothing
              }

              if (bufferstate.size < length + offsetbegin) {
                this.remainlength = length + offsetbegin - bufferstate.size
                this.mode = 'c'
                if (streamid) {
                  this.rstreamid = streamid
                  this.rfin = type === ParserBase.WT_STREAM_WFIN
                }
              }
              bufferstate.offset = offsetend
            } else {
              const length = plength
              if (bufferstate.offset + length > bufferstate.size) {
                this.mode = 'c'
                this.rstreamid = undefined
                this.remainlength =
                  bufferstate.offset + length - bufferstate.size
                bufferstate.offset = bufferstate.size
              } else {
                bufferstate.offset += length
              }
            }
          }
          break
        case 'c':
          {
            const clength = Math.min(
              bufferstate.size - bufferstate.offset,
              this.remainlength
            )
            if (this.rstreamid) {
              // not in j mode
              // TODO submitData
              const object = this.wtstreams.get(this.rstreamid)
              const fin =
                this.rtype === ParserBase.WT_STREAM_WFIN &&
                this.remainlength === clength
              if (object) {
                if (fin) object.onFin()
                if (this.maskcontext)
                  applyMask(
                    this.maskcontext,
                    bufferstate.buffer,
                    bufferstate.buffer.byteOffset + bufferstate.offset,
                    clength
                  )
                // TODO submit data
                object.recvData({
                  data: new Uint8Array(
                    bufferstate.buffer.buffer,
                    bufferstate.buffer.byteOffset + bufferstate.offset,
                    clength
                  ),
                  fin
                })
              }
            }

            this.remainlength = this.remainlength - clength
            bufferstate.offset += clength
            if (this.remainlength === 0) {
              this.maskcontext = undefined
              this.mode = 's'
              delete this.rfin
              delete this.rstreamid
            }
          }
          break
      }
    }
  }

  /**
   * @param{{code: Number, reason: string}}arg
   */
  sendClose({ code, reason }) {
    super.sendClose({ code, reason })
    this.sendCloseInt()
  }

  /**
   * @param {Uint8Array} [payload]
   */
  sendCloseInt(payload) {
    this.writeWSFrame({ opcode: WebSocketParser.WS_CLOSE, payload })
    this.closesend = true
  }

  /**
   * @param {Uint8Array} payload
   */
  sendPong(payload) {
    this.writeWSFrame({ opcode: WebSocketParser.WS_PONG, payload })
  }

  /**
   * @param{{type: Number, headerVints: Array<Number|bigint>, payload: Uint8Array|undefined, end?: () => void}} bs
   */
  writeCapsule({ type, headerVints, payload, end }) {
    let plength = 0
    for (const ind in headerVints) plength += lengthVarInt(headerVints[ind])
    plength += lengthVarInt(type)
    let headlength = plength + 2
    let mask = 0
    if (this.isclient) {
      headlength += 4
      mask = 1
    }
    if (payload) plength += payload.byteLength
    if (plength > 0xffff) {
      headlength += 8
    } else if (plength > 125) {
      headlength += 2
    }

    const cdata = Buffer.alloc(headlength)
    const bufferstate = { offset: 0, size: cdata.length, buffer: cdata }
    const maskstate = this.writeHeader(bufferstate, {
      opcode: WebSocketParser.WS_BINARY,
      plength,
      mask
    })
    const beginmask = bufferstate.offset

    writeVarInt(bufferstate, type)

    for (const ind in headerVints) writeVarInt(bufferstate, headerVints[ind])
    const endmask = bufferstate.offset
    if (maskstate) {
      applyMask(
        maskstate,
        bufferstate.buffer,
        bufferstate.offset + bufferstate.buffer.byteOffset,
        endmask - beginmask
      )
      if (payload)
        applyMask(
          maskstate,
          Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength),
          payload.byteOffset,
          payload.byteLength
        )
    }
    let blocked = false
    if (payload) {
      blocked = !this.stream.write(cdata)
      blocked = !this.stream.write(payload, end) || blocked
    } else {
      blocked = !this.stream.write(cdata, end)
    }
    // do something if blocked
    if (blocked) this.blocked = true
    return blocked
  }

  /**
   * @param {{ offset: number; size?: number; buffer: Buffer; }} bs
   * @param {{ opcode: number; plength: number; mask: number; }} args
   */
  writeHeader(bs, { opcode, plength, mask }) {
    bs.buffer.writeUint8(0x80 | (opcode & 0x0f), bs.offset)
    bs.offset++
    let splength = plength
    if (plength > 0xffff) {
      splength = 127
    } else if (plength > 125) {
      splength = 126
    }

    bs.buffer.writeUint8((mask && 0x80) | (splength & 0x7f), bs.offset)
    bs.offset++
    if (plength > 0xffff) {
      bs.buffer.writeBigInt64BE(BigInt(plength), bs.offset)
      bs.offset += 8
    } else if (plength > 125) {
      bs.buffer.writeUint16BE(plength, bs.offset)
      bs.offset += 2
    }
    let maskstate
    if (mask) {
      maskstate = { offset: 0, mask: randomBytes(4) }
      bs.buffer.writeUint32BE(maskstate.mask.readUInt32BE(0), bs.offset)
      bs.offset += 4
    }
    return maskstate
  }

  /**
   * @param {{ opcode: number; payload: Uint8Array|undefined; }} args
   */
  writeWSFrame({ opcode, payload }) {
    const plength = payload?.byteLength || 0
    let headlength = 2
    let mask = 0
    if (this.isclient) {
      headlength += 4
      mask = 1
    }
    if (plength > 0xffff) {
      headlength += 8
    } else if (plength > 125) {
      headlength += 2
    }
    const cdata = Buffer.alloc(headlength)
    const bufferstate = { offset: 0, size: cdata.length, buffer: cdata }
    const maskstate = this.writeHeader(bufferstate, { opcode, plength, mask })

    if (bufferstate.offset !== headlength)
      throw new Error('Headlength does not match pos')

    let blocked = !this.stream.write(cdata)
    if (maskstate && payload)
      applyMask(
        maskstate,
        Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength),
        0,
        payload.byteLength
      )
    if (payload) blocked = !this.stream.write(payload) || blocked
    // do something if blocked
    if (blocked) this.blocked = true
    return blocked
  }

  /**
   * @param {number} code
   */
  closeHttp2Stream(code) {
    const stream = this.stream
    if (stream.close) {
      stream.setTimeout(1000, () =>
        stream.close(0x00 /* aka NGHTTP2_NO_ERROR */)
      )
    } else if (stream.end) stream.end()
    else throw new Error('http2:session not close method')
  }
}
