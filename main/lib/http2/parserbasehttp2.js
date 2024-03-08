import { ParserBase } from './parserbase.js'

/**
 * @typedef {import('node:http2').Http2Stream} Http2Stream
 */

/**
 * @param{{offset: Number, buffer: Buffer, size: Number}} bs
 */

export function readUint32(bs) {
  if (bs.offset + 4 > bs.size) return undefined
  const toret = bs.buffer.readUInt32BE(bs.offset)
  bs.offset += 4
  return toret
}

/**
 * @param{{offset: Number, buffer: Buffer, size: Number}} bs
 */
export function readVarInt(bs) {
  if (bs.offset + 1 > bs.size) return undefined
  let val = BigInt(bs.buffer.readUInt8(bs.offset))
  bs.offset++
  const prefix = Number(val) >>> 6
  const intlength = 1 << prefix

  if (bs.offset + intlength - 1 > bs.size) {
    return undefined
  }
  val = val & 0x3fn
  for (let i = 0; i < intlength - 1; i++) {
    val = (val << 8n) | BigInt(bs.buffer.readUInt8(bs.offset))
    bs.offset++
  }
  return val
}

/**
 * @param{{offset: Number, buffer: Buffer, size: Number}} bs
 * @param{Number|bigint} int
 */
export function writeVarInt(bs, int) {
  let numbytes = 8n
  let msb = 0xc0n
  const bint = BigInt(int)
  if (bint < 64) {
    numbytes = 1n
    msb = 0x0n
  } else if (bint < 16384) {
    numbytes = 2n
    msb = 0x40n
  } else if (bint < 1073741824) {
    numbytes = 4n
    msb = 0x80n
  }
  bs.buffer.writeUInt8(
    Number(msb | ((bint >> ((numbytes - 1n) * 8n)) & 0xffn)),
    bs.offset
  )
  bs.offset++

  for (let i = numbytes - 2n; i >= 0; i--) {
    bs.buffer.writeUInt8(Number((bint >> (i * 8n)) & 0xffn), bs.offset)
    bs.offset++
  }
}

export class ParserBaseHttp2 extends ParserBase {
  /**
   * @param {import('../types').ParserHttp2Init} stream
   */
  constructor({
    stream,
    nativesession,
    isclient,
    initialStreamSendWindowOffsetBidi,
    initialStreamSendWindowOffsetUnidi,
    initialStreamReceiveWindowOffset,
    streamShouldAutoTuneReceiveWindow,
    streamReceiveWindowSizeLimit
  }) {
    super({
      nativesession,
      isclient,
      initialStreamSendWindowOffsetBidi,
      initialStreamSendWindowOffsetUnidi,
      initialStreamReceiveWindowOffset,
      streamShouldAutoTuneReceiveWindow,
      streamReceiveWindowSizeLimit
    })
    this.stream = stream
    this.session = nativesession
    this.isclient = isclient

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
        this.session.jsobj.onClose({
          errorcode: this.stream.rstCode,
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
      if (
        !(
          this.session.jsobj.state === 'failed' ||
          this.session.jsobj.state === 'closed'
        )
      ) {
        // writable close
        this.session.jsobj.onClose({
          errorcode: this.stream.rstCode || 0,
          error: ''
        })
      }
    })
  }
}
