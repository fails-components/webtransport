import { ParserBase } from './parserbase.js'

/**
 * @typedef {import('node:http2').Http2Stream} Http2Stream
 */

/**
 * @param{{offset: Number, buffer: Buffer, size: Number}} bs
 */
export function readVarInt(bs) {
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
 * @param{{offset: Number, buffer: Buffer, size: Number}} bs
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
  bs.buffer.writeUInt8(msb | ((int >>> ((numbytes - 1) * 8)) & 0xff), bs.offset)
  bs.offset++

  for (let i = numbytes - 2; i >= 0; i--) {
    bs.buffer.writeUInt8((int >>> (i * 8)) & 0xff, bs.offset)
    bs.offset++
  }
}

export class ParserBaseHttp2 extends ParserBase {
  /**
   * @param {import('../types').ParserHttp2Init} stream
   */
  constructor({ stream, nativesession, isclient }) {
    super({ nativesession, isclient })
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
