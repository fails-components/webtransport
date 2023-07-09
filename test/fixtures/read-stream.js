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
    let outputlength = 0

    while (true) {
      const { done, value } = await reader.read()

      if (done) {
        break
      }

      if (value != null) {
        // @ts-ignore
        outputlength += value.length
        output.push(value)
      }

      if (expected != null && outputlength >= expected) {
        break
      }
    }

    return output
  } finally {
    reader.releaseLock()
  }
}
