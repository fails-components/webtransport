
/**
 * Write contents to a stream and close it
 *
 * @template T
 * @param {WritableStream<T>} writable
 * @param {T[]} input
 * @returns
 */
 export async function writeStream (writable, input) {
  const writer = writable.getWriter()

  for (const buf of input) {
    await writer.write(buf)
  }

  await writer.close()
}
