/* eslint-env mocha */

import { readCertHash } from './fixtures/read-cert-hash.js'
import WebTransport from './fixtures/webtransport.js'
import { expect } from './fixtures/chai.js'

/**
 * @template T
 * @typedef {import('../lib/types').Deferred<T>} Deferred<T>
 */

describe('streamlimits', function () {
  let forceReliable = false
  if (process.env.USE_HTTP2 === 'true') forceReliable = true
  const browser = process.env.BROWSER
  const handshakemess =
    browser !== 'firefox' ||
    process.env.USE_POLYFILL === 'true' ||
    process.env.USE_PONYFILL === 'true'
      ? 'Opening handshake failed.'
      : 'WebTransport connection rejected'

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

  it('should detect stream limit bidi outgoing', async () => {
    client = new WebTransport(
      `${process.env.SERVER_URL}/streamlimits_getbidis`,
      { ...wtOptions }
    )
    await client.ready
    const bidistreams = []
    let numbidi = 0
    for (let i = 0; i < 150; i++) {
      const curstream = client.createBidirectionalStream()
      bidistreams.push(curstream)
      curstream
        .then(() => {
          numbidi++
        })
        .catch(() => {})
    }
    await client.createUnidirectionalStream()
    expect(numbidi).to.equal(99)
    await client.createUnidirectionalStream()
    for (let i = 0; i < 51; i++) {
      const curstream = await bidistreams.shift()
      await curstream.readable.cancel()
      await curstream.writable.close()
    }
    await client.createUnidirectionalStream()
    expect(numbidi).to.equal(150)

    const result = await client.closed
    expect(result).to.have.property('closeCode', 0)
    expect(result).to.have.property('reason', '')
  })

  it('should detect stream limit unidi outgoing', async () => {
    client = new WebTransport(
      `${process.env.SERVER_URL}/streamlimits_getunidis`,
      { ...wtOptions }
    )
    await client.ready
    const unidistreams = []
    let numunidi = 0
    for (let i = 0; i < 150; i++) {
      const curstream = client.createUnidirectionalStream()
      unidistreams.push(curstream)
      curstream
        .then(() => {
          numunidi++
        })
        .catch(() => {})
    }
    await client.createBidirectionalStream()
    expect(numunidi).to.equal(100)
    await client.createBidirectionalStream()
    for (let i = 0; i < 51; i++) {
      const curstream = await unidistreams.shift()
      await curstream.close()
    }
    await client.createBidirectionalStream()
    expect(numunidi).to.equal(150)

    const result = await client.closed
    expect(result).to.have.property('closeCode', 0)
    expect(result).to.have.property('reason', '')
  })
})
