/**
 * @template T
 * @typedef {import('node:stream/web').ReadableStream<T>} ReadableStream<T>
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
  console.log('reader stream 1')

  try {
    while (true) {
      console.log('reader stream 2')
      const { done, value } = await reader.read()
      console.log('reader stream 3')

      if (done) {
        console.log('reader stream 4')
        return
      }

      if (!value) {
        console.log('reader stream 5')
        throw new Error('Stream value was undefined')
      }

      yield value
    }
  } finally {
    console.log('reader stream 6')
    reader.releaseLock()
  }
}
