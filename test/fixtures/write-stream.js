/**
 * Write contents to a stream and close it
 *
 * @template T
 * @param {WritableStream<T>} writable
 * @param {T[]} input
 * @param {any} closehelper
 * @returns
 */
export async function writeStream(writable, input, closehelper) {
  const writer = writable.getWriter()

  for (const buf of input) {
    await writer.ready
    await writer.write(buf)
  }

  await writer.ready
  await writer.releaseLock()
  try {
    if (!closehelper) {
      // correct test
      await writable.close()
    } else {
      await Promise.race([writable.close(), closehelper])
    }
  } catch (error) {
    console.log('Did we get a STOP_SENDING? ignore', error)
  }
}
