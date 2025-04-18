import { generateWebTransportCertificate } from './certificate.js'
import { Http2Server, Http3Server } from '@fails-components/webtransport'
import { pTimeout } from './p-timeout.js'
import { getReaderStream, getReaderValue } from './reader-value.js'
import { writeStream } from './write-stream.js'
import { readStream } from './read-stream.js'
import * as ui8 from 'uint8arrays'
import {
  KNOWN_BYTES,
  KNOWN_BYTES_LENGTH,
  KNOWN_BYTES_LONG_LENGTH
} from './known-bytes.js'

export async function createServer() {
  const attrs = [
    { shortName: 'C', value: 'DE' },
    { shortName: 'ST', value: 'Berlin' },
    { shortName: 'L', value: 'Berlin' },
    { shortName: 'O', value: 'WebTransport Test Server' },
    { shortName: 'CN', value: '127.0.0.1' }
  ]

  const certificate = await generateWebTransportCertificate(attrs, {
    days: 13
  })

  if (certificate == null) {
    throw new Error('Certificate generation failed')
  }

  /** @type {Http2Server|Http3Server} */
  let server
  let hostandport = {
    port: 0,
    host: '127.0.0.1'
  }
  if (process.env.LOCAL_SERVER === 'true') {
    hostandport = { port: 8080, host: '0.0.0.0' }
  }
  if (process.env.USE_HTTP2 === 'true') {
    server = new Http2Server({
      ...hostandport,
      secret: 'mysecret',
      cert: certificate.cert, // unclear if it is the correct format
      privKey: certificate.private
    })
  } else {
    server = new Http3Server({
      ...hostandport,
      secret: 'mysecret',
      cert: certificate.cert, // unclear if it is the correct format
      privKey: certificate.private
    })
  }

  let adjustlimit = 1
  if (process.env.USE_HTTP2 === 'true') {
    adjustlimit = 0
  }

  server.ready
    .then(async () => {
      server.setRequestCallback(async (args) => {
        const url = args.header[':path']
        const [path] = url.split('?')

        if (server.sessionController[path] == null) {
          return {
            ...args,
            path,
            status: 404
          }
        }
        const protocols = args.header['wt-available-protocols']
          ? args.header['wt-available-protocols']
              .split(',')
              .map((el) => el.trim())
          : undefined
        // we chose for testing always the last one
        const selectedProtocol = protocols && protocols[protocols.length - 1]

        return {
          ...args,
          path,
          userData: {
            search: url.substring(path.length)
          },
          header: {
            ...args.header,
            ':path': path
          },
          status: 200,
          selectedProtocol
        }
      })

      // set up listeners for the different server paths used by the tests
      console.log('server ready')
      await Promise.all(
        [
          // echo server, initiated by remote
          async () => {
            for await (const session of getReaderStream(
              server.sessionStream('/bidirectional_client_initiated_echo')
            )) {
              try {
                const bidiStream = await getReaderValue(
                  session.incomingBidirectionalStreams
                )

                // redirect input to output
                await bidiStream.readable.pipeTo(bidiStream.writable)
              } catch {
                // in some tests the client closes the stream
              }
            }
          },

          // echo server, initiated by local
          async () => {
            for await (const session of getReaderStream(
              server.sessionStream('/bidirectional_server_initiated_echo')
            )) {
              try {
                const stream = await session.createBidirectionalStream()

                await writeStream(stream.writable, KNOWN_BYTES)

                const received = await readStream(
                  stream.readable,
                  KNOWN_BYTES_LENGTH
                )
                // await stream.readable.cancel() // cancel so that the client can progress

                // if we did not get the data we sent, close the session with a reason
                if (
                  !ui8.equals(ui8.concat(KNOWN_BYTES), ui8.concat(received))
                ) {
                  session.close({
                    closeCode: 500,
                    reason: 'data did not match'
                  })
                } else {
                  session.close()
                }
              } catch {
                // in some tests the client closes the stream
              }
            }
          },

          // echo server, initiated by local, with zero length transmission
          async () => {
            for await (const session of getReaderStream(
              server.sessionStream(
                '/bidirectional_server_initiated_echo_with_zero_send'
              )
            )) {
              try {
                const stream = await session.createBidirectionalStream()

                await writeStream(stream.writable, [
                  new Uint8Array(),
                  ...KNOWN_BYTES
                ])

                const received = await readStream(
                  stream.readable,
                  KNOWN_BYTES_LENGTH
                )
                // await stream.readable.cancel() // cancel so that the client can progress

                // if we did not get the data we sent, close the session with a reason
                if (
                  !ui8.equals(ui8.concat(KNOWN_BYTES), ui8.concat(received))
                ) {
                  session.close({
                    closeCode: 500,
                    reason: 'data did not match'
                  })
                } else {
                  session.close()
                }
              } catch {
                // in some tests the client closes the stream
              }
            }
          },

          // echo server, initiated by local
          async () => {
            for await (const session of getReaderStream(
              server.sessionStream('/bidirectional_server_fin_send')
            )) {
              try {
                // adapted from issue of achingbrain
                const stream = await session.createBidirectionalStream()

                const writer = stream.writable.getWriter()

                await writer.ready

                writer.write(Uint8Array.from([0, 1, 2, 3])).catch((err) => {
                  console.info('error writing to stream', err)
                })

                await writer.close()
              } catch {
                // in some tests the client closes the stream
              }
            }
          },

          // echo datagrams, initiated by remote
          async () => {
            for await (const session of getReaderStream(
              server.sessionStream('/datagrams_client_send')
            )) {
              // datagram transport is unreliable, at least one message should make it through
              const expected = 1

              try {
                const received = await pTimeout(
                  readStream(session.datagrams.readable, expected),
                  1000
                )

                // if we did not get the data we sent, close the session with a reason
                if (received.length !== expected) {
                  throw new Error('Did not receive enough bytes')
                }

                session.close()
              } catch (/** @type {any} */ err) {
                session.close({
                  closeCode: 500,
                  reason: err.message
                })
              }
            }
          },

          // echo datagrams, initiated by local
          async () => {
            for await (const session of getReaderStream(
              server.sessionStream('/datagrams_server_send')
            )) {
              const writer = session.datagrams.createWritable().getWriter()
              let closed = false

              // write datagrams until the client receives one and closes the connection
              // eslint-disable-next-line promise/catch-or-return
              Promise.resolve().then(async () => {
                while (!closed) {
                  try {
                    await writer.ready
                    await writer.write(Uint8Array.from([0, 1, 2, 3, 4]))
                    await new Promise((resolve) => setTimeout(resolve, 1)) // do not flood everything
                  } catch {
                    // the session can be closed while we are writing
                  }
                }
              })

              await session.closed
              closed = true
            }
          },

          // receive 100+ bidi streams and block
          async () => {
            for await (const session of getReaderStream(
              server.sessionStream('/streamlimits_getbidis_wua')
            )) {
              try {
                await session.ready
                const bidistreams = []
                while (bidistreams.length < 100 - adjustlimit) {
                  bidistreams.push(
                    await getReaderValue(session.incomingBidirectionalStreams)
                  )
                }
                await getReaderValue(session.incomingUnidirectionalStreams)
                await getReaderValue(session.incomingUnidirectionalStreams)
                for (let i = 0; i < 50 + adjustlimit; i++) {
                  /* const curstream = */ bidistreams.shift()
                  // await curstream.writable.close() // canceled by client
                }
                while (bidistreams.length < 100 - adjustlimit) {
                  bidistreams.push(
                    await getReaderValue(session.incomingBidirectionalStreams)
                  )
                }
                await getReaderValue(session.incomingUnidirectionalStreams)
                await session.close()
                // eslint-disable-next-line no-unused-vars
              } catch (error) {
                // do not crash server, if a problem occurs...
              }
            }
          },
          // receive 100+ bidi streams and do not block
          async () => {
            for await (const session of getReaderStream(
              server.sessionStream('/streamlimits_getbidis')
            )) {
              try {
                await session.ready
                const bidistreams = []
                while (bidistreams.length < 150) {
                  bidistreams.push(
                    await getReaderValue(session.incomingBidirectionalStreams)
                  )
                }
                await getReaderValue(session.incomingUnidirectionalStreams)
                await session.close()
                // eslint-disable-next-line no-unused-vars
              } catch (error) {
                // do not crash server, if a problem occurs...
              }
            }
          },
          async () => {
            for await (const session of getReaderStream(
              server.sessionStream('/streamlimits_getunidis_wua')
            )) {
              try {
                await session.ready
                const unidistreams = []
                while (unidistreams.length < 100 - adjustlimit) {
                  unidistreams.push(
                    await getReaderValue(session.incomingUnidirectionalStreams)
                  )
                }
                await getReaderValue(session.incomingBidirectionalStreams)
                await getReaderValue(session.incomingBidirectionalStreams)
                for (let i = 0; i < 50 + adjustlimit; i++) {
                  unidistreams.shift()
                }
                while (unidistreams.length < 100 - adjustlimit) {
                  unidistreams.push(
                    await getReaderValue(session.incomingUnidirectionalStreams)
                  )
                }
                await getReaderValue(session.incomingBidirectionalStreams)
                await session.close()
                // eslint-disable-next-line no-unused-vars
              } catch (error) {
                // do not crash server, if a problem occurs...
              }
            }
          },
          // receive 100+ unidi streams and do not block
          async () => {
            for await (const session of getReaderStream(
              server.sessionStream('/streamlimits_getunidis')
            )) {
              try {
                await session.ready
                const unidistreams = []
                while (unidistreams.length < 150) {
                  unidistreams.push(
                    await getReaderValue(session.incomingUnidirectionalStreams)
                  )
                }
                await getReaderValue(session.incomingBidirectionalStreams)
                await session.close()
                // eslint-disable-next-line no-unused-vars
              } catch (error) {
                // do not crash server, if a problem occurs...
              }
            }
          },
          // cleanly close remote sessions
          async () => {
            for await (const session of getReaderStream(
              server.sessionStream('/session_close')
            )) {
              await session.close()
            }
          },

          // cleanly close remote sessions
          async () => {
            for await (const session of getReaderStream(
              server.sessionStream('/session_close_with_reason')
            )) {
              session.close({
                closeCode: 7,
                reason: 'this is the reason'
              })
            }
          },

          // support user data
          async () => {
            for await (const session of getReaderStream(
              server.sessionStream('/session_with_userdata')
            )) {
              try {
                const stream = await session.createUnidirectionalStream()
                await writeStream(stream, [
                  new TextEncoder().encode(JSON.stringify(session.userData))
                ])
                // session.close() // do not close it here, the stream is closed before a reader is attached on client side
              } catch (err) {
                session.close({
                  closeCode: 1,
                  reason: err.stack
                })
              }
            }
          },

          // send data over unidirectional stream, initiated by remote
          async () => {
            for await (const session of getReaderStream(
              server.sessionStream('/unidirectional_client_send')
            )) {
              try {
                const stream = await getReaderValue(
                  session.incomingUnidirectionalStreams
                )
                const received = await readStream(stream, KNOWN_BYTES_LENGTH)
                // await stream.cancel() // cancel so that the client can progress
                // if we did not get the data we sent, close the session with a reason
                if (
                  !ui8.equals(ui8.concat(KNOWN_BYTES), ui8.concat(received))
                ) {
                  session.close({
                    closeCode: 500,
                    reason: 'data did not match'
                  })
                } else {
                  session.close()
                }
                // eslint-disable-next-line no-unused-vars
              } catch (error) {
                // in some tests the client closes the stream
              }
            }
          },
          async () => {
            for await (const session of getReaderStream(
              server.sessionStream('/send_order_bidi_two')
            )) {
              try {
                const streamA = await getReaderValue(
                  session.incomingBidirectionalStreams
                )
                const streamAstart = performance.now()
                const streamB = await getReaderValue(
                  session.incomingBidirectionalStreams
                )
                const streamBstart = performance.now()
                const confirmStream = (stream, startStart) => {
                  return async () => {
                    const streamTime = performance.now()
                    const writer = stream.writable.getWriter()
                    const floats = new Float64Array(1)
                    floats[0] = streamTime - startStart
                    await writer.write(floats.buffer)
                  }
                }
                const finalLength = 100 * KNOWN_BYTES_LONG_LENGTH
                await Promise.all([
                  readStream(streamA.readable, finalLength).then(
                    confirmStream(streamA, streamAstart)
                  ),
                  readStream(streamB.readable, finalLength).then(
                    confirmStream(streamB, streamBstart)
                  )
                ])
                // eslint-disable-next-line no-unused-vars
              } catch (error) {
                // in some tests the client closes the stream
              }
            }
          },
          async () => {
            for await (const session of getReaderStream(
              server.sessionStream('/send_order_bidi_two_10MB')
            )) {
              try {
                const streamA = await getReaderValue(
                  session.incomingBidirectionalStreams
                )
                const streamB = await getReaderValue(
                  session.incomingBidirectionalStreams
                )
                let lengthA = 0
                let lengthB = 0
                const confirmStream = (stream) => {
                  return async () => {
                    const writer = stream.writable.getWriter()
                    const sizes = new BigUint64Array(2)
                    sizes[0] = BigInt(lengthA)
                    sizes[1] = BigInt(lengthB)
                    await writer.write(sizes.buffer)
                  }
                }
                const finalLength = 10 * 1024 * 1024
                const reportLengthA = (length) => (lengthA = length)
                const reportLengthB = (length) => (lengthB = length)
                await Promise.all([
                  readStream(streamA.readable, finalLength, {
                    outputreportCB: reportLengthA
                  }).then(confirmStream(streamA)),
                  readStream(streamB.readable, finalLength, {
                    outputreportCB: reportLengthB
                  }).then(confirmStream(streamB))
                ])
                // eslint-disable-next-line no-unused-vars
              } catch (error) {
                // in some tests the client closes the stream
              }
            }
          },

          // send data over unidirectional stream, initiated by local
          async () => {
            for await (const session of getReaderStream(
              server.sessionStream('/unidirectional_server_send')
            )) {
              const stream = await session.createUnidirectionalStream()

              await writeStream(stream, KNOWN_BYTES)
            }
          },

          // delays reading from stream after client writes
          async () => {
            for await (const session of getReaderStream(
              server.sessionStream('/unidirectional_server_delay_before_read')
            )) {
              const stream = await getReaderValue(
                session.incomingUnidirectionalStreams
              )

              // wait before we read from the stream, should trigger backpressure
              // on the client
              await new Promise((resolve) => setTimeout(resolve, 1000))

              const received = await readStream(stream, KNOWN_BYTES_LENGTH)
              // await stream.cancel() // cancel so that the client can progress

              // if we did not get expected data, close the session with a reason
              if (!ui8.equals(ui8.concat(KNOWN_BYTES), ui8.concat(received))) {
                console.log('ERROR', KNOWN_BYTES, received)
                session.close({
                  closeCode: 500,
                  reason: 'data did not match'
                })
              } else {
                await new Promise((resolve) => setTimeout(resolve, 2000)) // time out is needed, since it can be received before the read is complete
                // and we want the client to close the session after it has processeed the read
                session.close()
              }
            }
          }
        ].map((fn) => fn())
      )
    })
    .catch((/** @type {any} */ err) => {
      console.error('server crashed', err)
    })

  return {
    server,
    certificate
  }
}

const { server, certificate } = await createServer()
server.startServer()
await server.ready

const address = server.address()

if (address == null) {
  throw new Error('Could not determine server address')
}

let host = address.host
if (process.env.LOCAL_SERVER === 'true') {
  host = host.replace('0.0.0.0', '127.0.0.1')
}

// tell the calling process how to contact us
if (process.send)
  process.send({
    address: `https://${host}:${address.port}`,
    certificate: certificate.fingerprint
  })
else {
  console.error('No IPC channel')
  console.log({
    address: `https://${host}:${address.port}`,
    certificate: certificate.fingerprint
  })
}
