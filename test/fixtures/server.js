import { generateWebTransportCertificate } from './certificate.js'
import { Http3Server } from '../../lib/index.js'
import { getReaderStream, getReaderValue } from './reader-value.js'
import { writeStream } from './write-stream.js'
import { readStream } from './read-stream.js'
import * as ui8 from 'uint8arrays'
import { KNOWN_BYTES } from './known-bytes.js'

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

  const server = new Http3Server({
    port: 0,
    host: '127.0.0.1',
    secret: 'mysecret',
    cert: certificate.cert, // unclear if it is the correct format
    privKey: certificate.private
  })

  server.ready.then(async () => {
    // set up listeners for the different server paths used by the tests

    await Promise.all(
      [
        // echo server, initiated by remote
        async () => {
          for await (const session of getReaderStream(
            server.sessionStream('/bidirectional_echo_remote')
          )) {
            const bidiStream = await getReaderValue(
              session.incomingBidirectionalStreams
            )

            // redirect input to output
            await bidiStream.readable.pipeTo(bidiStream.writable)
          }
        },

        // echo server, initiated by local
        async () => {
          for await (const session of getReaderStream(
            server.sessionStream('/bidirectional_echo_local')
          )) {
            const stream = await session.createBidirectionalStream()

            await writeStream(stream.writable, KNOWN_BYTES)

            const received = await readStream(
              stream.readable,
              KNOWN_BYTES.length
            )

            // if we did not get the data we sent, close the session with a reason
            if (!ui8.equals(ui8.concat(KNOWN_BYTES), ui8.concat(received))) {
              session.close({
                closeCode: 500,
                reason: 'data did not match'
              })
            } else {
              session.close()
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
            await session.close({
              closeCode: 7,
              reason: 'this is the reason'
            })
          }
        },

        // echo datagrams, initiated by remote
        async () => {
          for await (const session of getReaderStream(
            server.sessionStream('/datagrams_send')
          )) {
            const received = await readStream(
              session.datagrams.readable,
              KNOWN_BYTES.length
            )

            // if we did not get the data we sent, close the session with a reason
            if (!ui8.equals(ui8.concat(KNOWN_BYTES), ui8.concat(received))) {
              session.close({
                closeCode: 500,
                reason: 'data did not match'
              })
            } else {
              session.close()
            }
          }
        },

        // echo datagrams, initiated by local
        async () => {
          for await (const session of getReaderStream(
            server.sessionStream('/datagrams_receive')
          )) {
            await writeStream(session.datagrams.writable, KNOWN_BYTES)
          }
        },

        // send data over unidirectional stream, initiated by remote
        async () => {
          for await (const session of getReaderStream(
            server.sessionStream('/unidirectional_remote_send')
          )) {
            const stream = await getReaderValue(
              session.incomingUnidirectionalStreams
            )
            const received = await readStream(stream, KNOWN_BYTES.length)

            // if we did not get the data we sent, close the session with a reason
            if (!ui8.equals(ui8.concat(KNOWN_BYTES), ui8.concat(received))) {
              session.close({
                closeCode: 500,
                reason: 'data did not match'
              })
            } else {
              session.close()
            }
          }
        },

        // send data over unidirectional stream, initiated by local
        async () => {
          for await (const session of getReaderStream(
            server.sessionStream('/unidirectional_local_send')
          )) {
            const stream = await session.createUnidirectionalStream()

            await writeStream(stream, KNOWN_BYTES)
          }
        },

        // delays reading from stream after writing, initiated by remote
        async () => {
          for await (const session of getReaderStream(
            server.sessionStream('/unidirectional_delay_before_reading')
          )) {
            const stream = await getReaderValue(
              session.incomingUnidirectionalStreams
            )

            const received = await readStream(stream, KNOWN_BYTES.length)

            // if we did not get expected data, close the session with a reason
            if (!ui8.equals(ui8.concat(KNOWN_BYTES), ui8.concat(received))) {
              session.close({
                closeCode: 500,
                reason: 'data did not match'
              })
            } else {
              session.close()
            }
          }
        }
      ].map((fn) => fn())
    )
  })

  return {
    server,
    certificate
  }
}

/**
 * @param {import('../../lib/server.js').Http3Server} server
 * @param {string} path
 */
export async function getServerSession(server, path) {
  const sessionStream = await server.sessionStream(path)
  const sessionReader = sessionStream.getReader()

  try {
    const { done, value } = await sessionReader.read()

    if (done) {
      throw new Error('Server is gone')
    }

    if (!value) {
      throw new Error('Session was undefined')
    }

    return value
  } finally {
    sessionReader.releaseLock()
  }
}
