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
  this.timeout(7000)
  /** @type {import('../lib/dom').WebTransport | undefined} */
  let client
  let forceReliable = false
  if (process.env.USE_HTTP2 === 'true') forceReliable = true

  const websocketEmu =
    process.env.USE_POLYFILL === 'true' || process.env.USE_PONYFILL === 'true'

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
  it('sends data over two outgoing bidirectional streams with different priority (not the best test)', async () => {
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
      sendOrder: 10
    })
    if (typeof streamLowPrio.writable.sendOrder === 'undefined') {
      console.log('sendOrder is not implemented, skipping')
      return // not implemented
    }
    const streamHighPrio = await client.createBidirectionalStream({
      sendOrder: 50
    })
    const verylongarray = new Array(100).fill(KNOWN_BYTES_LONG).flat(1)
    // now we send the data out, the high priority one should be ready as first
    await Promise.all([
      writeStream(streamLowPrio.writable, verylongarray),
      writeStream(streamHighPrio.writable, verylongarray)
    ])
    const sizeOfDouble = Float64Array.BYTES_PER_ELEMENT
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
    if (!websocketEmu) {
      expect(Math.floor(timeLowPrio)).to.be.greaterThanOrEqual(
        Math.floor(timeHighPrio)
      )
    }
  })

  it('sends data over two outgoing bidirectional streams with different priority (10 MB)', async () => {
    // suggested by vvasiliev
    // client context - connects to the server, opens a uni stream, sends some data and reads the response
    try {
      client = new WebTransport(
        `${process.env.SERVER_URL}/send_order_bidi_two_10MB`,
        wtOptions
      )
      await client.ready
    } catch (error) {
      console.log('Peak sendorder error:', error)
      throw error
    }

    const streamLowPrio = await client.createBidirectionalStream({
      sendOrder: 10
    })
    if (typeof streamLowPrio.writable.sendOrder === 'undefined') {
      console.log('sendOrder is not implemented, skipping')
      return // not implemented
    }
    const streamHighPrio = await client.createBidirectionalStream({
      sendOrder: 50
    })
    const dataSize = 10 * 1024 * 1024
    const verylongarray = new Uint8Array(dataSize)
    // now we send the data out, the high priority one should be ready as first
    await Promise.all([
      writeStream(streamLowPrio.writable, [verylongarray]),
      writeStream(streamHighPrio.writable, [verylongarray])
    ])
    const sizeOfData = BigUint64Array.BYTES_PER_ELEMENT * 2
    const buffersLowPrio = await readStream(streamLowPrio.readable, sizeOfData)
    const buffersHighPrio = await readStream(
      streamHighPrio.readable,
      sizeOfData
    )
    const bufferLowPrio = ui8.concat(buffersLowPrio)
    const bufferHighPrio = ui8.concat(buffersHighPrio)
    // eslint-disable-next-line no-unused-vars
    const [afterLowArrivedLowCounter, afterLowArrivedHighCounter] =
      new BigUint64Array(
        bufferLowPrio.buffer,
        bufferLowPrio.byteOffset,
        bufferLowPrio.byteLength / BigUint64Array.BYTES_PER_ELEMENT
      )
    const [afterHighArrivedLowCounter, afterHighArrivedHighCounter] =
      new BigUint64Array(
        bufferHighPrio.buffer,
        bufferHighPrio.byteOffset,
        bufferHighPrio.byteLength / BigUint64Array.BYTES_PER_ELEMENT
      )
    if (!websocketEmu) {
      expect(Number(afterHighArrivedLowCounter)).to.be.below(
        Number(afterHighArrivedHighCounter)
      )
      expect(Number(afterHighArrivedLowCounter)).to.be.below(dataSize / 2)
    }
  })
})
