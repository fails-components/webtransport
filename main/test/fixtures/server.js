import { generateWebTransportCertificate } from './certificate.js'
import { Http2Server, Http3Server } from '../../lib/index.node.js'
import { pTimeout } from './p-timeout.js'
import { getReaderStream, getReaderValue } from './reader-value.js'
import { writeStream } from './write-stream.js'
import { readStream } from './read-stream.js'
import * as ui8 from 'uint8arrays'
import { KNOWN_BYTES, KNOWN_BYTES_LENGTH } from './known-bytes.js'

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
  if (process.env.USE_HTTP2 === 'true') {
    server = new Http2Server({
      /*   port: 8080,
      host: '0.0.0.0', */
      port: 0,
      host: '127.0.0.1',
      secret: 'mysecret',
      cert: certificate.cert, // unclear if it is the correct format
      privKey: certificate.private
    })
  } else {
    server = new Http3Server({
      /*   port: 8080,
      host: '0.0.0.0', */
      port: 0,
      host: '127.0.0.1',
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
              const writer = session.datagrams.writable.getWriter()
              let closed = false

              // write datagrams until the client receives one and closes the connection
              // eslint-disable-next-line promise/catch-or-return
              Promise.resolve().then(async () => {
                // eslint-disable-next-line no-unmodified-loop-condition
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
                await session.close()
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
                await session.close()
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

// tell the calling process how to contact us
if (process.send)
  process.send({
    address: `https://${address.host}:${address.port}`,
    certificate: certificate.fingerprint
  })
else {
  console.error('No IPC channel')
  console.log({
    address: `https://${address.host}:${address.port}`,
    certificate: certificate.fingerprint
  })
}
