/**
 * Bytes send by tests
 */
export const KNOWN_BYTES = [
  Uint8Array.from([0, 1, 2, 3, 4]),
  Uint8Array.from([5, 6, 7, 8, 9]),
  Uint8Array.from([10, 11, 12, 13, 14]),
  Uint8Array.from([15, 16, 17, 18, 19]),
  Uint8Array.from([20, 21, 22, 23, 24])
]

export const KNOWN_BYTES_LENGTH = KNOWN_BYTES.reduce(
  (accumulator, currentValue) => accumulator + currentValue.length,
  0
)

const createBytesChunk = function (/** @type {number} */ length) {
  const workArray = new Array(length / 2)
  for (let i = 0; i < length / 4; i++) {
    workArray[2 * i + 1] = length % 0xffff
    workArray[2 * i] = i
  }
  const helper = new Uint16Array(workArray)
  const toreturn = new Uint8Array(
    helper.buffer,
    helper.byteOffset,
    helper.byteLength
  )
  return toreturn
}

export const KNOWN_BYTES_LONG = [
  createBytesChunk(60000), // 96, 234
  createBytesChunk(12), // 0, 12
  createBytesChunk(50000), // 195, 80
  createBytesChunk(1600), // 6, 64
  createBytesChunk(20000), // 78, 32
  createBytesChunk(30000) // 117, 48
]

export const KNOWN_BYTES_LONG_LENGTH = KNOWN_BYTES_LONG.reduce(
  (accumulator, currentValue) => accumulator + currentValue.length,
  0
)
