/* eslint-env mocha */

import { getReaderValue } from './fixtures/reader-value.js'
import WebTransport from './fixtures/webtransport.js'
import { expect } from 'chai'
import { readStream } from './fixtures/read-stream.js'
import { writeStream } from './fixtures/write-stream.js'
import { readCertHash } from './fixtures/read-cert-hash.js'
import * as ui8 from 'uint8arrays'
import { KNOWN_BYTES, KNOWN_BYTES_LENGTH } from './fixtures/known-bytes.js'
import { quicheLoaded } from './fixtures/quiche.js'

describe('unidirectional streams', function () {
  /** @type {import('../lib/dom').WebTransport | undefined} */
  let client
  let forceReliable = false
  if (process.env.USE_HTTP2 === 'true') forceReliable = true

  const wtOptions = {
    serverCertificateHashes: [
      {
        algorithm: 'sha-256',
        value: readCertHash(process.env.CERT_HASH)
      }
    ],
    // @ts-ignore
    forceReliable
  }
  if (process.env.NO_CERT_HASHES === 'true')
    // @ts-ignore
    delete wtOptions.serverCertificateHashes

  // @ts-ignore
  beforeEach(async () => {
    if (
      process.env.USE_HTTP2 !== 'true' &&
      process.env.USE_PONYFILL !== 'true' &&
      process.env.USE_POLYFILL !== 'true'
    ) {
      await quicheLoaded
    }
  })

  // @ts-ignore
  afterEach(async () => {
    if (client != null) {
      client.close()
      client = undefined
    }
  })

  it('sends data over an outgoing unidirectional stream', async () => {
    // client context - connects to the server, opens a bidi stream, sends some data and reads the response
    try {
      client = new WebTransport(
        `${process.env.SERVER_URL}/unidirectional_client_send`,
        wtOptions
      )
      await client.ready
    } catch (error) {
      console.log('Peak unidirectional error:', error)
      throw error
    }

    const stream = await client.createUnidirectionalStream()
    // correct test
    await writeStream(stream, KNOWN_BYTES)

    // the remote will close the session
    const result = await client.closed
    client = undefined

    // should receive the default close info
    expect(result).to.have.property('reason', '')
    expect(result).to.have.property('closeCode', 0)
  })

  it('receives data over an incoming unidirectional stream', async () => {
    // client context - waits for the server to open a bidi stream then pipes it back to them
    client = new WebTransport(
      `${process.env.SERVER_URL}/unidirectional_server_send`,
      wtOptions
    )
    await client.ready

    const stream = await getReaderValue(client.incomingUnidirectionalStreams)
    const output = await readStream(stream, KNOWN_BYTES_LENGTH)
    expect(ui8.concat(KNOWN_BYTES)).to.deep.equal(
      ui8.concat(output),
      'Did not receive the same bytes we sent'
    )
  })

  it('handles fin when paused due to backpressure', async function () {
    let addpolyfill = 0
    if (
      process.env.USE_POLYFILL === 'true' ||
      process.env.USE_PONYFILL === 'true'
    )
      addpolyfill = 4000
    this.timeout(6000 + addpolyfill)
    client = new WebTransport(
      `${process.env.SERVER_URL}/unidirectional_server_delay_before_read`,
      wtOptions
    )
    await client.ready

    const clientStream = await client.createUnidirectionalStream()

    const writer = clientStream.getWriter()

    for (const buf of KNOWN_BYTES) {
      await writer.ready
      await writer.write(buf)
    }

    await new Promise((resolve) => setTimeout(resolve, 2000))
    try {
      await writer.ready
      await writer.close()
    } catch (error) {
      console.log('Ignore stop sending', error)
    }

    // the remote will close the session cleanly if everything was ok
    await client.closed
    client = undefined

    // should receive the default close info, not true on chromium
    // expect(result).to.have.property('reason', '')
    // expect(result).to.have.property('closeCode', 0)
  })
})
