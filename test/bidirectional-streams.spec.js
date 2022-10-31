import { createServer } from './fixtures/server.js'
import { getReaderValue } from './fixtures/reader-value.js'
import { WebTransport } from '../lib/index.js'
import { expect } from 'chai'
import { readStream } from './fixtures/read-stream.js'
import { writeStream } from './fixtures/write-stream.js'
import { defer } from '../lib/utils.js'

/**
 * @template T
 * @typedef {import('../lib/types').Deferred<T>} Deferred<T>
 */

const SERVER_PATH = '/unidirectional-streams'

describe('bidirectional streams', function () {
  /** @type {import('../lib/server').Http3Server} */
  let server
  /** @type {import('./fixtures/certificate.js').Certificate} */
  let certificate
  /** @type {import('../lib/dom').WebTransport | undefined} */
  let client
  /** @type {string} */
  let url

  beforeEach(async () => {
    ({ server, certificate } = await createServer())
    server.startServer()
    await server.ready

    const address = server.address()

    if (address == null || address.port == null) {
      throw new Error('No address')
    }

    url = `https://${address.host}:${address.port}`
  })

  afterEach(async () => {
    if (client != null) {
      client.close()
    }

    if (server != null) {
      server.stopServer()
      await server.closed
    }
  })

  it('sends and receives data over an outgoing bidirectional stream', async () => {
    // server context - waits for the client to open a bidi stream and pipes it back to them
    Promise.resolve().then(async () => {
      const session = await getReaderValue(server.sessionStream(SERVER_PATH))
      const bidiStream = await getReaderValue(session.incomingBidirectionalStreams)
      // redirect input to output
      await bidiStream.readable.pipeTo(bidiStream.writable)
    })

    // client context - connects to the server, opens a bidi stream, sends some data and reads the response
    client = new WebTransport(`${url}${SERVER_PATH}`, {
      serverCertificateHashes: [{
        algorithm: 'sha-256',
        value: certificate.hash
      }]
    })
    await client.ready

    const input = [
      Uint8Array.from([0, 1, 2, 3, 4]),
      Uint8Array.from([5, 6, 7, 8, 9]),
      Uint8Array.from([10, 11, 12, 13, 14])
    ]

    const stream = await client.createBidirectionalStream()
    await writeStream(stream.writable, input)

    const output = await readStream(stream.readable)
    expect(output).to.deep.equal(input, 'Did not receive the same bytes we sent')
  })

  it('sends and receives data over an incoming bidirectional stream', async () => {
    /** @type {Deferred<Uint8Array[]>} */
    const serverData = defer()
    const input = [
      Uint8Array.from([0, 1, 2, 3, 4]),
      Uint8Array.from([5, 6, 7, 8, 9]),
      Uint8Array.from([10, 11, 12, 13, 14])
    ]

    // server context - waits for the client to connect, opens a bidi stream, sends some data and reads the response
    Promise.resolve().then(async () => {
      const session = await getReaderValue(server.sessionStream(SERVER_PATH))
      const stream = await session.createBidirectionalStream()

      await writeStream(stream.writable, input)

      const output = await readStream(stream.readable)
      serverData.resolve(output)
    })

    // client context - waits for the server to open a bidi stream then pipes it back to them
    client = new WebTransport(`${url}${SERVER_PATH}`, {
      serverCertificateHashes: [{
        algorithm: 'sha-256',
        value: certificate.hash
      }]
    })
    await client.ready

    const bidiStream = await getReaderValue(client.incomingBidirectionalStreams)
    // redirect input to output
    await bidiStream.readable.pipeTo(bidiStream.writable)

    const received = await serverData.promise
    expect(received).to.deep.equal(input, 'Did not receive the same bytes we sent')
  })
})
