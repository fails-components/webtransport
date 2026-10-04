/**
 * @param{Number|bigint} int
 * @returns {Number}
 */

export function lengthVarInt(int) {
  if (BigInt(int) < 64n) return 1
  if (BigInt(int) < 16384n) return 2
  if (BigInt(int) < 1073741824n) return 4
  /* if (BigInt(int) < 4611686018427387904 ) */
  return 8
}

/**
 * @param{{offset: Number, buffer: Uint8Array[], size: Number, curBuf: Number, curBufOffset: Number}} bs
 */
export function advanceBuffer(bs) {
  bs.curBufOffset++
  if (bs.curBufOffset === bs.buffer[bs.curBuf].byteLength) {
    bs.curBufOffset = 0
    bs.curBuf++
  }
  bs.offset++
}

/**
 * @param{{offset: Number, buffer: Uint8Array[], size: Number, curBuf: Number, curBufOffset: Number}} bs
 * @param{number} offset
 */
export function advanceBufferToOffset(bs, offset) {
  if (bs.offset >= offset) return
  let remainConsume = offset - bs.offset
  while (remainConsume > 0) {
    const curBufferSpace = bs.buffer[bs.curBuf].byteLength - bs.curBufOffset
    if (curBufferSpace > remainConsume) {
      bs.curBufOffset += remainConsume
      bs.offset += remainConsume
      return // done last buffer to touch
    }
    remainConsume -= curBufferSpace
    bs.offset += curBufferSpace
    bs.curBufOffset = 0
    bs.curBuf++
  }
}

/**
 * @param{{offset: Number, buffer: Uint8Array[], size: Number, curBuf: Number, curBufOffset: Number}} bs
 * @param{number} length
 */
export function advanceBufferBy(bs, length) {
  return advanceBufferToOffset(bs, bs.offset + length)
}

/**
 * @param{{offset: Number, buffer: Uint8Array[], size: Number, curBuf: Number, curBufOffset: Number}} bs
 */
export function detachReadBuffers(bs) {
  while (bs.buffer.length > 1 && bs.buffer[0].byteLength < bs.offset) {
    const curBuf = bs.buffer.shift()
    // @ts-ignore
    const curBufSize = curBuf.byteLength
    bs.size -= curBufSize
    bs.offset -= curBufSize
    bs.curBuf--
  }
}

/**
 * @param{{offset: Number, buffer: Uint8Array[], size: Number, curBuf: Number, curBufOffset: Number}} bs
 * @param {number} length
 */
export function getUint8ArraysfromBuffer(bs, length) {
  /** @type {Uint8Array[]} */
  const retArr = new Array()
  let remainLen = length
  let curBufOffset = bs.curBufOffset // note this does not advance the buffer
  let curBuf = bs.curBuf
  while (remainLen > 0) {
    const curbuf = bs.buffer[curBuf]
    const avail = Math.min(curbuf.byteLength - curBufOffset, remainLen)
    if (avail !== 0) {
      retArr.push(
        new Uint8Array(curbuf.buffer, curbuf.byteOffset + curBufOffset, avail)
      )
    }
    curBufOffset = 0
    curBuf++
    remainLen -= avail
  }
  if (retArr.length === 0) return undefined
  return retArr
}
/**
 * @param{{offset: Number, buffer: Uint8Array[], size: Number, curBuf: Number, curBufOffset: Number}} bs
 * @param {number} length
 */
export function getUint8ArrayfromBuffer(bs, length) {
  const chunks = getUint8ArraysfromBuffer(bs, length)

  if (typeof chunks === 'undefined') return undefined

  const totalLength = chunks.reduce((acc, c) => acc + c.length, 0)
  const result = new Uint8Array(totalLength)

  let offset = 0
  for (let i = 0; i < chunks.length; i++) {
    result.set(chunks[i], offset)
    offset += chunks[i].length
  }
  return result
}

/**
 * @param{{offset: Number, buffer: Uint8Array[], size: Number, curBuf: Number, curBufOffset: Number}} bs
 */

export function readUInt8(bs) {
  return bs.buffer[bs.curBuf][bs.curBufOffset]
}

/**
 * @param{{offset: Number, buffer: Uint8Array[], size: Number, curBuf: Number, curBufOffset: Number}} bs
 * @returns {number}
 */
export function readUInt16BE(bs) {
  const highByte = readUInt8(bs)
  advanceBuffer(bs)
  const lowByte = readUInt8(bs)
  advanceBuffer(bs)

  return (highByte << 8) | lowByte
}

/**
 * @param{{offset: Number, buffer: Uint8Array[], size: Number, curBuf: Number, curBufOffset: Number}} bs
 * @param {number} length
 * @returns {string}
 */
export function readString(bs, length) {
  const data = getUint8ArrayfromBuffer(bs, length)
  advanceBufferBy(bs, length)
  const utf8decoder = new TextDecoder('utf-8')
  return utf8decoder.decode(data)
}

/**
 * @param{{offset: Number, buffer: Uint8Array[], size: Number, curBuf: Number, curBufOffset: Number}} bs
 * @param{Number} value
 */
export function writeUInt8(bs, value) {
  bs.buffer[bs.curBuf][bs.curBufOffset] = value
}

/**
 * @param{{offset: Number, buffer: Uint8Array[], size: Number, curBuf: Number, curBufOffset: Number}} bs
 */
export function readVarInt(bs) {
  if (bs.offset + 1 > bs.size) return undefined

  let val = BigInt(readUInt8(bs))
  advanceBuffer(bs)
  const prefix = Number(val) >>> 6
  const intlength = 1 << prefix

  if (bs.offset + intlength - 1 > bs.size) {
    return undefined
  }
  val = val & 0x3fn
  for (let i = 0; i < intlength - 1; i++) {
    val = (val << 8n) | BigInt(readUInt8(bs))
    advanceBuffer(bs)
  }
  return val
}
/**
 * @param{{offset: Number, buffer: Uint8Array[], size: Number, curBuf: Number, curBufOffset: Number}} bs
 */
export function readUint32(bs) {
  if (bs.offset + 4 > bs.size) return undefined
  let val = readUInt8(bs)
  advanceBuffer(bs)
  val = (val << 8) | readUInt8(bs)
  advanceBuffer(bs)
  val = (val << 8) | readUInt8(bs)
  advanceBuffer(bs)
  val = (val << 8) | readUInt8(bs)
  advanceBuffer(bs)
  return val
}

/**
 * @param{{offset: Number, buffer: Uint8Array[], size: Number, curBuf: Number, curBufOffset: Number}} bs
 * @param{number} value
 */
export function writeUint16BE(bs, value) {
  writeUInt8(bs, (value >> 8) & 0xff)
  advanceBuffer(bs)
  writeUInt8(bs, value & 0xff)
  advanceBuffer(bs)
}

/**
 * @param{{offset: Number, buffer: Uint8Array[], size: Number, curBuf: Number, curBufOffset: Number}} bs
 * @param{number} value
 */
export function writeUint32BE(bs, value) {
  writeUInt8(bs, (value >>> 24) & 0xff)
  advanceBuffer(bs)
  writeUInt8(bs, (value >>> 16) & 0xff)
  advanceBuffer(bs)
  writeUInt8(bs, (value >>> 8) & 0xff)
  advanceBuffer(bs)
  writeUInt8(bs, value & 0xff)
  advanceBuffer(bs)
}

/**
 * @param{{offset: Number, buffer: Uint8Array[], size: Number, curBuf: Number, curBufOffset: Number}} bs
 * @param{bigint} value
 */
export function writeBigInt64BE(bs, value) {
  const val = BigInt(value)

  writeUInt8(bs, Number((val >> 56n) & 0xffn))
  advanceBuffer(bs)
  writeUInt8(bs, Number((val >> 48n) & 0xffn))
  advanceBuffer(bs)
  writeUInt8(bs, Number((val >> 40n) & 0xffn))
  advanceBuffer(bs)
  writeUInt8(bs, Number((val >> 32n) & 0xffn))
  advanceBuffer(bs)
  writeUInt8(bs, Number((val >> 24n) & 0xffn))
  advanceBuffer(bs)
  writeUInt8(bs, Number((val >> 16n) & 0xffn))
  advanceBuffer(bs)
  writeUInt8(bs, Number((val >> 8n) & 0xffn))
  advanceBuffer(bs)
  writeUInt8(bs, Number(val & 0xffn))
  advanceBuffer(bs)
}

/**
 * @param{{offset: Number, buffer: Uint8Array[], size: Number, curBuf: Number, curBufOffset: Number}} bs
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
  writeUInt8(bs, Number(msb | ((bint >> ((numbytes - 1n) * 8n)) & 0xffn)))
  advanceBuffer(bs)

  for (let i = numbytes - 2n; i >= 0; i--) {
    writeUInt8(bs, Number((bint >> (i * 8n)) & 0xffn))
    advanceBuffer(bs)
  }
}
