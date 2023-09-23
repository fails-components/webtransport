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
