/**
 * @template T
 * @typedef {import('../../lib/webstreams').ReadableStream<T>} ReadableStream<T>
 */

/**
 * @template T
 * @param {ReadableStream<T>} readableStream
 * @returns {Promise<T>}
 */
export async function getReaderValue(readableStream) {
  const reader = readableStream.getReader()

  try {
    const { done, value } = await reader.read()

    if (done) {
      throw new Error('Stream ended')
    }

    if (!value) {
      throw new Error('Stream value was undefined')
    }

    return value
  } finally {
    reader.releaseLock()
  }
}

/**
 * @template T
 * @param {ReadableStream<T>} readableStream
 * @returns {AsyncGenerator<T>}
 */
export async function* getReaderStream(readableStream) {
  const reader = readableStream.getReader()

  try {
    while (true) {
      const { done, value } = await reader.read()

      if (done) {
        return
      }

      if (!value) {
        throw new Error('Stream value was undefined')
      }

      yield value
    }
  } finally {
    reader.releaseLock()
  }
}
