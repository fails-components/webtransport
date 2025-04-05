/* eslint-env mocha */

import WebTransport from './fixtures/webtransport.js'
// import { expect } from 'chai'
import { readStream } from './fixtures/read-stream.js'
import { writeStream } from './fixtures/write-stream.js'
import { readCertHash } from './fixtures/read-cert-hash.js'
import { KNOWN_BYTES_LONG } from './fixtures/known-bytes.js'
import * as ui8 from 'uint8arrays'
import { quicheLoaded } from './fixtures/quiche.js'
import { expect } from 'chai'

describe('sendgroup streams', function () {
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

  // currently the test is broken, as we need a throtteling mechanism to work consistently
  it('sends data over two outgoing unidirectional stream with different priority (not the best test)', async () => {
    // client context - connects to the server, opens a uni stream, sends some data and reads the response
    try {
      client = new WebTransport(
        `${process.env.SERVER_URL}/send_order_bidi_two`,
        wtOptions
      )
      await client.ready
    } catch (error) {
      console.log('Peak sendorder error:', error)
      throw error
    }

    const streamLowPrio = await client.createBidirectionalStream({
      sendOrder: 10n
    })
    if (typeof streamLowPrio.writable.sendOrder === 'undefined') {
      console.log(
        'peek writable',
        streamLowPrio.writable,
        streamLowPrio.writable.sendOrder
      )
      console.log('sendOrder is not implemented, skipping')
      return // not implemented
    }
    const streamHighPrio = await client.createBidirectionalStream({
      sendOrder: 50n
    })
    // now we send the data out, the high priority one should be ready as first
    await Promise.all([
      writeStream(streamLowPrio.writable, KNOWN_BYTES_LONG),
      writeStream(streamHighPrio.writable, KNOWN_BYTES_LONG)
    ])
    const sizeOfDouble = 8
    const buffersLowPrio = await readStream(
      streamLowPrio.readable,
      sizeOfDouble
    )
    const buffersHighPrio = await readStream(
      streamHighPrio.readable,
      sizeOfDouble
    )
    const bufferLowPrio = ui8.concat(buffersLowPrio)
    const bufferHighPrio = ui8.concat(buffersHighPrio)
    const timeLowPrio = new Float64Array(
      bufferLowPrio.buffer,
      bufferLowPrio.byteOffset,
      bufferLowPrio.byteLength / Float64Array.BYTES_PER_ELEMENT
    )[0]
    const timeHighPrio = new Float64Array(
      bufferHighPrio.buffer,
      bufferHighPrio.byteOffset,
      bufferHighPrio.byteLength / Float64Array.BYTES_PER_ELEMENT
    )[0]
    expect(Math.floor(timeLowPrio) + 3).to.be.greaterThanOrEqual(
      Math.floor(timeHighPrio)
    )
  })
})
