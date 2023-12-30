/* eslint-env mocha */

import { getReaderValue } from './fixtures/reader-value.js'
import { expect } from './fixtures/chai.js'
import { readStream } from './fixtures/read-stream.js'
import { writeStream } from './fixtures/write-stream.js'
import { readCertHash } from './fixtures/read-cert-hash.js'
import WebTransport from './fixtures/webtransport.js'
import * as ui8 from 'uint8arrays'
import {
  KNOWN_BYTES,
  KNOWN_BYTES_LENGTH,
  KNOWN_BYTES_LONG,
  KNOWN_BYTES_LONG_LENGTH
} from './fixtures/known-bytes.js'

/**
 * @template T
 * @typedef {import('../lib/types').Deferred<T>} Deferred<T>
 */
describe('bidirectional streams', function () {
  let forceReliable = false
  if (process.env.USE_HTTP2 === 'true') forceReliable = true
  /** @type {import('../lib/dom').WebTransport | undefined} */
  let client

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
      wtOptions
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

  it('sends and receives data over an outgoing bidirectional stream with big buffers', async () => {
    // client context - connects to the server, opens a bidi stream, sends some data and reads the response
    client = new WebTransport(
      `${process.env.SERVER_URL}/bidirectional_client_initiated_echo`,
      wtOptions
    )
    await client.ready

    const stream = await client.createBidirectionalStream()
    await writeStream(stream.writable, KNOWN_BYTES_LONG)

    const output = await readStream(stream.readable, KNOWN_BYTES_LONG_LENGTH)
    const send = ui8.concat(KNOWN_BYTES_LONG)
    const received = ui8.concat(output)
    let failure = 0
    for (let i = 0; i < Math.max(send.byteLength, received.byteLength); i++) {
      if (send[i] !== received[i] && failure < 100) {
        console.log('d: ', i, ' ,', send[i], ', ', received[i])
        failure++
      }
    }

    expect(ui8.concat(KNOWN_BYTES_LONG)).to.deep.equal(
      ui8.concat(output),
      'Did not receive the same bytes we sent'
    )
  })

  it('sends and receives data over an incoming bidirectional stream', async () => {
    // client context - waits for the server to open a bidi stream then pipes it back to them
    client = new WebTransport(
      `${process.env.SERVER_URL}/bidirectional_server_initiated_echo`,
      wtOptions
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
