/**
 * @template T
 * @typedef {import('node:stream/web').ReadableStream<T>} ReadableStream<T>
 */

/**
 * Read a stream contents to the end and return it
 *
 * @template T
 * @param {ReadableStream<T>} readable
 * @param {number} [expected]
 * @returns
 */
export async function readStream(readable, expected) {
  const reader = readable.getReader()

  try {
    /** @type {T[]} */
    const output = []

    while (true) {
      const { done, value } = await reader.read()

      if (done) {
        break
      }

      if (value != null) {
        output.push(value)
      }

      if (expected != null && output.length === expected) {
        break
      }
    }

    return output
  } finally {
    reader.releaseLock()
  }
}
