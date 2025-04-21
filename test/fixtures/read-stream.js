/**
 * Read a stream contents to the end and return it
 *
 * @template T
 * @param {ReadableStream<T>} readable
 * @param {number} [expected]
 * @returns {T[]}
 */
export async function readStream(readable, expected, { outputreportCB } = {}) {
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
        outputlength += value.length
        outputreportCB?.(outputlength)
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

/**
 * @param {ReadableStream<Uint8Array>} stream
 * @returns {string}
 */
export async function readStringFromStream(stream) {
  const decoder = new TextDecoder()
  let output = ''

  for (const buf of await readStream(stream)) {
    output += decoder.decode(buf, {
      stream: true
    })
  }

  output += decoder.decode()

  return output
}
