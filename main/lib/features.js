let canByteStream_ = true
try {
  // @ts-ignore
  // eslint-disable-next-line no-unused-vars
  const teststream = new ReadableStream({
    // @ts-ignore
    start: (
      // eslint-disable-next-line no-unused-vars
      /** @type {import("stream/web").ReadableByteStreamController} */ controller
    ) => {},
    type: 'bytes'
  })
  // eslint-disable-next-line no-unused-vars
} catch (error) {
  canByteStream_ = false
}

export const canByteStream = canByteStream_
