import { Http2WebTransportStream } from './stream.js'

/**
 * @typedef {import('node:http2').Http2Stream} Http2Stream
 */

/**
 * @param{{offset: Number, buffer: Buffer, size: Number}} bs
 */
function readVarInt(bs) {
  let val = bs.buffer.readUInt8(bs.offset)
  bs.offset++
  const prefix = val >>> 6
  const intlength = 1 << prefix

  if (bs.offset + intlength - 1 > bs.size) {
    return undefined
  }
  val = val & 0x3f
  for (let i = 0; i < intlength - 1; i++) {
    val = (val << 8) | bs.buffer.readUInt8(bs.offset)
    bs.offset++
  }
  return val
}

/**
 * @param{Number} int
 * @returns {Number}
 */
function lengthVarInt(int) {
  if (int < 64) return 1
  if (int < 16384) return 2
  if (int < 1073741824) return 4
  /* if (int < 4611686018427387904 ) */
  return 8
}

/**
 * @param{{offset: Number, buffer: Buffer, size: Number}} bs
 * @param{Number} int
 */
function writeVarInt(bs, int) {
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
  bs.buffer.writeUInt8(msb | ((int >>> ((numbytes - 1) * 8)) & 0xff), bs.offset)
  bs.offset++

  for (let i = numbytes - 2; i >= 0; i--) {
    bs.buffer.writeUInt8((int >>> (i * 8)) & 0xff, bs.offset)
    bs.offset++
  }
}

export class Http2CapsuleParser {
  static PADDING = 0x190b4d38
  static WT_RESET_STREAM = 0x190b4d39
  static WT_STOP_SENDING = 0x190b4d3a
  static WT_STREAM_WOFIN = 0x190b4d3b
  static WT_STREAM_WFIN = 0x190b4d3c
  static WT_MAX_DATA = 0x190b4d3d
  static WT_MAX_STREAM_DATA = 0x190b4d3e
  static WT_MAX_STREAMS_BIDI = 0x190b4d3f
  static WT_MAX_STREAMS_UNIDI = 0x190b4d40
  static WT_DATA_BLOCKED = 0x190b4d41
  static WT_STREAM_DATA_BLOCKED = 0x190b4d42
  static WT_STREAMS_BLOCKED_UNIDI = 0x190b4d43
  static WT_STREAMS_BLOCKED_BIDI = 0x190b4d44
  static DATAGRAM = 0x00

  /**
   * @param {import('../types').Http2CapsuleParserInit} stream
   */
  constructor({
    stream,
    nativesession,
    sessioncallback,
    streamcallback,
    isclient
  }) {
    this.stream = stream
    this.session = nativesession
    this.sessioncallback = sessioncallback
    this.streamcallback = streamcallback
    this.mode = 's' // capsule start
    this.isclient = isclient
    /** @type {Buffer|undefined} */
    this.saveddata = undefined
    /** @type {Number|undefined} */
    this.rtype = undefined
    /** @type {boolean} */
    this.blocked = false

    this.stream.on('readable', () => {
      let data
      while ((data = this.stream.read()) !== null) {
        this.parseData(data)
      }
    })

    this.stream.on('end', () => {
      // readable end
    })

    this.stream.on(
      'error',
      /**
       * @param {Error} error
       */ (error) => {
        // readable error
        this.sessioncallback({
          object: this.session,
          purpose: 'SessionClose',
          errorcode: 0,
          error: error.toString()
        })
      }
    )

    this.stream.on('drain', () => {
      // writable, can write more data
      this.blocked = false
      this.drainWrites()
    })

    this.stream.on('close', () => {
      // writable close
      this.sessioncallback({
        object: this.session,
        purpose: 'SessionClose',
        errorcode: 0,
        error: 'Session stream closed'
      })
    })

    this.wtstreams = new Map()
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
            // we are at capsule start
            if (bufferstate.size < 2 + bufferstate.offset) {
              this.saveddata = cdata
              return
            }
            const type = readVarInt(bufferstate)
            if (
              typeof type === 'undefined' ||
              bufferstate.size < 1 + bufferstate.offset
            ) {
              this.saveddata = cdata
              return
            }
            const length = readVarInt(bufferstate)
            if (typeof length === 'undefined') {
              this.saveddata = cdata
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
            if (bufferstate.size < checklength + bufferstate.offset) {
              this.saveddata = cdata
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
                  const object = this.wtstreams.get(streamid)
                  const code = readVarInt(bufferstate)
                  if (object && typeof code !== 'undefined')
                    this.streamcallback({
                      code,
                      purpose: 'StreamRecvSignal',
                      nettask:
                        type === Http2CapsuleParser.WT_RESET_STREAM
                          ? 'resetStream'
                          : 'stopSending',
                      object
                    })
                }
                break
              case Http2CapsuleParser.WT_STREAM_WOFIN:
              case Http2CapsuleParser.WT_STREAM_WFIN:
                streamid = readVarInt(bufferstate)
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
                      fin:
                        type === Http2CapsuleParser.WT_STREAM_WFIN &&
                        bufferstate.size >= length + offsetbegin,
                      callback: this.streamcallback
                    })
                  }
                }
                break
              case Http2CapsuleParser.WT_MAX_DATA:
                // this.recvSession({ maxdata: readVarInt(bufferstate), type })
                break
              case Http2CapsuleParser.WT_MAX_STREAM_DATA:
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
              case Http2CapsuleParser.WT_MAX_STREAMS_BIDI:
                // this.recvSession({ maxstreams: readVarInt(bufferstate), type })
                break
              case Http2CapsuleParser.WT_MAX_STREAMS_UNIDI:
                // this.recvSession({ maxstreams: readVarInt(bufferstate), type })
                break
              case Http2CapsuleParser.WT_DATA_BLOCKED: // TODO
                // this.recvSession({ maxdata: readVarInt(bufferstate), type })
                break
              case Http2CapsuleParser.WT_STREAM_DATA_BLOCKED: // TODO
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
                this.sessioncallback({
                  object: this.session,
                  purpose: 'DatagramReceived',
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
                  bufferstate.buffer,
                  bufferstate.buffer.byteOffset + bufferstate.offset,
                  clength
                ),
                fin:
                  this.rtype === Http2CapsuleParser.WT_STREAM_WFIN &&
                  this.remainlength >= clength,
                callback: this.streamcallback
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
   * @param {Number} streamid
   */
  newStream(streamid) {
    const stream = new Http2WebTransportStream({
      streamid,
      capsuleParser: this
    })
    this.wtstreams.set(streamid, stream)
    this.sessioncallback({
      bidirectional: !(streamid & 0x2),
      incoming: this.isclient ? !(streamid & 0x1) : !!(streamid & 0x1),
      stream,
      purpose: 'Http3WTStreamVisitor',
      object: this.session
    })
    return stream
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
    let blocked = !this.stream.write(cdata)
    if (payload) blocked = blocked || !this.stream.write(payload)
    // do something if blocked
    if (blocked) this.blocked = true
    return blocked
  }

  drainWrites() {
    for (const stream of this.wtstreams.values()) {
      stream.drainWrites()
    }
  }
}
