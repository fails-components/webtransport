/* eslint-env mocha */

import { getReaderValue } from './fixtures/reader-value.js'
import { expect } from './fixtures/chai.js'
import { readStream } from './fixtures/read-stream.js'
import { writeStream } from './fixtures/write-stream.js'
import { readCertHash } from './fixtures/read-cert-hash.js'
import WebTransport from './fixtures/webtransport.js'
import * as ui8 from 'uint8arrays'
import { KNOWN_BYTES, KNOWN_BYTES_LENGTH } from './fixtures/known-bytes.js'

/**
 * @template T
 * @typedef {import('../lib/types').Deferred<T>} Deferred<T>
 */

describe('bidirectional streams', function () {
  // FIXME: sometimes there are seemingly arbitrary 5s delays in
  // communicating with the server under node.js
  this.timeout(30000)

  /** @type {import('../lib/dom').WebTransport | undefined} */
  let client

  // @ts-ignore
  afterEach(async () => {
    if (client != null) {
      client.close()
      client = undefined
    }
  })

  it('sends and receives data over an outgoing bidirectional stream', async () => {
    // client context - connects to the server, opens a bidi stream, sends some data and reads the response
    client = new WebTransport(
      `${process.env.SERVER_URL}/bidirectional_client_initiated_echo`,
      {
        serverCertificateHashes: [
          {
            algorithm: 'sha-256',
            value: readCertHash(process.env.CERT_HASH)
          }
        ]
      }
    )
    await client.ready

    const stream = await client.createBidirectionalStream()
    await writeStream(stream.writable, KNOWN_BYTES)

    const output = await readStream(stream.readable, KNOWN_BYTES_LENGTH)
    expect(ui8.concat(KNOWN_BYTES)).to.deep.equal(
      ui8.concat(output),
      'Did not receive the same bytes we sent'
    )
  })

  it('sends and receives data over an incoming bidirectional stream', async () => {
    /** @type {Deferred<Uint8Array[]>} */

    // client context - waits for the server to open a bidi stream then pipes it back to them
    client = new WebTransport(
      `${process.env.SERVER_URL}/bidirectional_server_initiated_echo`,
      {
        serverCertificateHashes: [
          {
            algorithm: 'sha-256',
            value: readCertHash(process.env.CERT_HASH)
          }
        ]
      }
    )
    await client.ready

    const bidiStream = await getReaderValue(client.incomingBidirectionalStreams)

    // redirect input to output
    try {
      await bidiStream.readable.pipeTo(bidiStream.writable)
    } catch (error) {
      console.log('Pipe to error (ignore)', error) // Actually all you can get is, that the fin is catched
    }

    // the remote will close the session
    const result = await client.closed

    // should receive the default close info
    expect(result).to.have.property('reason', '')
    expect(result).to.have.property('closeCode', 0)
  })
})
