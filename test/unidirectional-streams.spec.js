/* eslint-env mocha */

import { getReaderValue } from './fixtures/reader-value.js'
import WebTransport from './fixtures/webtransport.js'
import { expect } from 'chai'
import { readStream } from './fixtures/read-stream.js'
import { writeStream } from './fixtures/write-stream.js'
import { readCertHash } from './fixtures/read-cert-hash.js'
import * as ui8 from 'uint8arrays'
import { KNOWN_BYTES } from './fixtures/known-bytes.js'

describe('unidirectional streams', function () {
  /** @type {import('../lib/dom').WebTransport | undefined} */
  let client

  afterEach(async () => {
    if (client != null) {
      client.close()
      client = undefined
    }
  })

  it('sends data over an outgoing unidirectional stream', async () => {
    // client context - connects to the server, opens a bidi stream, sends some data and reads the response
    try {
      console.log('unidirectional mark1')
      client = new WebTransport(
        `${process.env.SERVER_URL}/unidirectional_client_send`,
        {
          serverCertificateHashes: [
            {
              algorithm: 'sha-256',
              value: readCertHash(process.env.CERT_HASH)
            }
          ]
        }
      )
      console.log('unidirectional mark2')
      await client.ready
      console.log('unidirectional mark3')
    } catch (error) {
      console.log('Peak unidirectional error:', error)
      throw error
    }

    const stream = await client.createUnidirectionalStream()
    await writeStream(stream, KNOWN_BYTES)

    // the remote will close the session
    const result = await client.closed

    // should receive the default close info
    expect(result).to.have.property('reason', '')
    expect(result).to.have.property('closeCode', 0)
  })

  it('receives data over an incoming unidirectional stream', async () => {
    // client context - waits for the server to open a bidi stream then pipes it back to them
    client = new WebTransport(
      `${process.env.SERVER_URL}/unidirectional_server_send`,
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

    const stream = await getReaderValue(client.incomingUnidirectionalStreams)
    const output = await readStream(stream, KNOWN_BYTES.length)
    expect(ui8.concat(KNOWN_BYTES)).to.deep.equal(
      ui8.concat(output),
      'Did not receive the same bytes we sent'
    )
  })

  it('handles fin when paused due to backpressure', async function () {
    this.timeout(6000)
    client = new WebTransport(
      `${process.env.SERVER_URL}/unidirectional_server_delay_before_read`,
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

    const clientStream = await client.createUnidirectionalStream()

    const writer = clientStream.getWriter()

    for (const buf of KNOWN_BYTES) {
      await writer.ready
      await writer.write(buf)
    }

    await new Promise((resolve) => setTimeout(resolve, 2000))

    await writer.ready
    await writer.close()

    // the remote will close the session cleanly if everything was ok
    await client.closed

    // should receive the default close info, not true on chromium
    // expect(result).to.have.property('reason', '')
    // expect(result).to.have.property('closeCode', 0)
  })
})
