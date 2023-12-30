import { ParserBaseHttp2, readVarInt, writeVarInt } from '../parserbasehttp2.js'
import { lengthVarInt } from '../parserbase.js'

export class Http2CapsuleParser extends ParserBaseHttp2 {
  /**
   * @param {import('../../types.js').ParserHttp2Init} stream
   */
  constructor({
    stream,
    nativesession,
    isclient,
    initialStreamSendWindowOffset,
    initialStreamReceiveWindowOffset,
    streamShouldAutoTuneReceiveWindow,
    streamReceiveWindowSizeLimit
  }) {
    super({
      stream,
      nativesession,
      isclient,
      initialStreamSendWindowOffset,
      initialStreamReceiveWindowOffset,
      streamShouldAutoTuneReceiveWindow,
      streamReceiveWindowSizeLimit
    })
    this.mode = 's' // capsule start
    /** @type {Buffer|undefined} */
    this.saveddata = undefined
    /** @type {Number|undefined} */
    this.rtype = undefined
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
            const capsulestart =
              bufferstate.offset + bufferstate.buffer.byteOffset
            const capsulemaxlength =
              bufferstate.buffer.byteLength - bufferstate.offset
            // we are at capsule start
            if (bufferstate.size < 2 + bufferstate.offset) {
              this.saveddata = Buffer.from(
                bufferstate.buffer.buffer,
                capsulestart,
                capsulemaxlength
              )
              return
            }
            const type = Number(readVarInt(bufferstate))
            if (
              typeof type === 'undefined' ||
              bufferstate.size < 1 + bufferstate.offset
            ) {
              this.saveddata = Buffer.from(
                bufferstate.buffer.buffer,
                capsulestart,
                capsulemaxlength
              )
              return
            }
            const length = Number(readVarInt(bufferstate))
            if (typeof length === 'undefined') {
              this.saveddata = Buffer.from(
                bufferstate.buffer.buffer,
                capsulestart,
                capsulemaxlength
              )
              return
            }
            let checklength = length // we want to read most times the full capsule
            const offsetend = Math.min(
              bufferstate.offset + length,
              bufferstate.size
            )
            const offsetbegin = bufferstate.offset
            if (
              type === Http2CapsuleParser.PADDING ||
              type === Http2CapsuleParser.WT_STREAM_WOFIN ||
              type ===
                Http2CapsuleParser.WT_STREAM_WFIN /* || type === Http2CapsuleParser.DATAGRAM */
            ) {
              checklength = Math.min(length, 64) // stream id + some Data
            }
            if (
              checklength >
                4 * Number(this.session.flowController.receiveWindowSize) ||
              length > 8 * Number(this.session.flowController.receiveWindowSize)
            ) {
              // too long abort, could be an attack vector
              this.session.closeConnection({
                code: 63, // QUIC_FLOW_CONTROL_SENT_TOO_MUCH_DATA, // probably the right one...
                reason: 'Frame length too big :' + length
              })
              return
            }
            if (bufferstate.size < checklength + bufferstate.offset) {
              this.saveddata = Buffer.from(
                bufferstate.buffer.buffer,
                capsulestart,
                capsulemaxlength
              )
              return
            }
            let streamid
            switch (type) {
              case Http2CapsuleParser.PADDING:
                // only padding do nothing
                break
              case Http2CapsuleParser.WT_RESET_STREAM:
              case Http2CapsuleParser.WT_STOP_SENDING:
                {
                  const streamid = readVarInt(bufferstate)
                  const stream = this.wtstreams.get(streamid)
                  const code = readVarInt(bufferstate)
                  if (stream && typeof code !== 'undefined')
                    stream.jsobj.onStreamRecvSignal({
                      code,
                      nettask:
                        type === Http2CapsuleParser.WT_RESET_STREAM
                          ? 'resetStream'
                          : 'stopSending'
                    })
                }
                break
              case Http2CapsuleParser.WT_STREAM_WOFIN:
              case Http2CapsuleParser.WT_STREAM_WFIN:
                streamid = Number(readVarInt(bufferstate))
                if (typeof streamid !== 'undefined') {
                  let object = this.wtstreams.get(streamid)
                  if (!object) {
                    object = this.newStream(streamid)
                  }
                  // TODO submit data
                  if (offsetend - bufferstate.offset >= 0) {
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
                      fin:
                        type === Http2CapsuleParser.WT_STREAM_WFIN &&
                        bufferstate.size >= length + offsetbegin
                    })
                  }
                }
                break
              case Http2CapsuleParser.WT_MAX_DATA:
                this.onMaxData(readVarInt(bufferstate))
                break
              case Http2CapsuleParser.WT_MAX_STREAM_DATA:
                this.onMaxStreamData(
                  readVarInt(bufferstate),
                  readVarInt(bufferstate)
                )
                break
              case Http2CapsuleParser.WT_MAX_STREAMS_BIDI:
                // this.recvSession({ maxstreams: readVarInt(bufferstate), type })
                break
              case Http2CapsuleParser.WT_MAX_STREAMS_UNIDI:
                // this.recvSession({ maxstreams: readVarInt(bufferstate), type })
                break
              case Http2CapsuleParser.WT_DATA_BLOCKED:
                this.onDataBlocked(readVarInt(bufferstate))
                break
              case Http2CapsuleParser.WT_STREAM_DATA_BLOCKED:
                this.onStreamDataBlocked(
                  readVarInt(bufferstate),
                  readVarInt(bufferstate)
                )
                break
              case Http2CapsuleParser.WT_STREAMS_BLOCKED_UNIDI:
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
              case Http2CapsuleParser.WT_STREAMS_BLOCKED_BIDI:
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
              case Http2CapsuleParser.DATAGRAM:
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

            if (bufferstate.size < length + offsetbegin) {
              this.remainlength = length + offsetbegin - bufferstate.size
              this.mode = 'c'
              if (streamid) {
                this.rstreamid = streamid
                this.rfin = type === Http2CapsuleParser.WT_STREAM_WFIN
              }
            }
            bufferstate.offset = offsetend
          }
          break
        case 'c':
          {
            const clength = Math.min(
              bufferstate.size - bufferstate.offset,
              this.remainlength
            )
            if (this.rstreamid) {
              // TODO submitData
              const object = this.wtstreams.get(this.rstreamid)
              // TODO submit data
              object.recvData({
                data: new Uint8Array(
                  bufferstate.buffer.buffer,
                  bufferstate.buffer.byteOffset + bufferstate.offset,
                  clength
                ),
                fin:
                  this.rtype === Http2CapsuleParser.WT_STREAM_WFIN &&
                  this.remainlength === clength
              })
            }

            this.remainlength = this.remainlength - clength
            bufferstate.offset += clength
            if (this.remainlength === 0) {
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
   * @param{{type: Number, headerVints: Array<Number>, payload: Uint8Array|undefined}} bs
   */
  writeCapsule({ type, headerVints, payload }) {
    let length = 0
    for (const ind in headerVints) length += lengthVarInt(headerVints[ind])
    let headlength = length
    if (payload) length += payload.byteLength
    headlength += lengthVarInt(length) + lengthVarInt(type)
    const cdata = Buffer.alloc(headlength)
    const bufferstate = { offset: 0, size: cdata.length, buffer: cdata }
    writeVarInt(bufferstate, type)
    writeVarInt(bufferstate, length)
    for (const ind in headerVints) writeVarInt(bufferstate, headerVints[ind])
    if (!this.stream) return
    let blocked = !this.stream.write(cdata)
    if (payload) blocked = !this.stream.write(payload) || blocked
    // do something if blocked
    if (blocked) this.blocked = true
    return blocked
  }

  /**
   * @param {number} code
   */
  closeHttp2Stream(code) {
    this.stream.close(code)
    this.stream.destroy()
  }
}
