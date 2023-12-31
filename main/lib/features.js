let canByteStream_ = true
try {
  // @ts-ignore
  // eslint-disable-next-line no-unused-vars
  const teststream = new ReadableStream({
    // @ts-ignore
    start: (
      /** @type {import("stream/web").ReadableByteStreamController} */ controller
    ) => {},
    type: 'bytes'
  })
} catch (error) {
  canByteStream_ = false
}

export const canByteStream = canByteStream_
