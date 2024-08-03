/* eslint-env mocha */

import { readCertHash } from './fixtures/read-cert-hash.js'
import WebTransport from './fixtures/webtransport.js'
import { expect } from './fixtures/chai.js'
import { quicheLoaded } from './fixtures/quiche.js'

/**
 * @template T
 * @typedef {import('../lib/types').Deferred<T>} Deferred<T>
 */
describe('streamlimits', function () {
  this.timeout(6000) // for debugging remove before commit
  let forceReliable = false
  let adjustlimit = 1
  if (process.env.USE_HTTP2 === 'true') {
    forceReliable = true
    adjustlimit = 0
  }
  const browser = process.env.BROWSER
  /*  const handshakemess =
    browser !== 'firefox' ||
    process.env.USE_POLYFILL === 'true' ||
    process.env.USE_PONYFILL === 'true'
      ? 'Opening handshake failed.'
      : 'WebTransport connection rejected' */

  const dowaitUntilAvailable =
    (browser !== 'chromium' && browser !== 'firefox') ||
    process.env.USE_POLYFILL === 'true' ||
    process.env.USE_PONYFILL === 'true' // remove after implementation

  const skipall = browser === 'firefox'

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

  if (dowaitUntilAvailable && !skipall) {
    it('should detect stream limit bidi outgoing with waitUntilAvailable = true', async () => {
      client = new WebTransport(
        `${process.env.SERVER_URL}/streamlimits_getbidis_wua`,
        { ...wtOptions }
      )
      await client.ready
      const bidistreams = []
      let numbidi = 0
      for (let i = 0; i < 150; i++) {
        const curstream = client.createBidirectionalStream({
          waitUntilAvailable: true
        })
        bidistreams.push(curstream)
        curstream
          .then(() => {
            numbidi++
          })
          .catch(() => {})
      }
      await client.createUnidirectionalStream({
        waitUntilAvailable: true
      })
      expect(numbidi).to.equal(100 - adjustlimit)
      await client.createUnidirectionalStream({
        waitUntilAvailable: true
      })
      for (let i = 0; i < 50 + adjustlimit; i++) {
        const curstream = await bidistreams.shift()
        await curstream.readable.cancel()
        await curstream.writable.close()
      }
      await Promise.allSettled(bidistreams)
      await client.createUnidirectionalStream({
        waitUntilAvailable: true
      })
      expect(numbidi).to.equal(150)

      const result = await client.closed
      expect(result).to.have.property('closeCode', 0)
      expect(result).to.have.property('reason', '')
    })
  }

  if (!skipall) {
    it('should detect stream limit bidi outgoing', async () => {
      client = new WebTransport(
        `${process.env.SERVER_URL}/streamlimits_getbidis`,
        { ...wtOptions }
      )
      await client.ready
      const bidistreams = []
      let numbidi = 0
      let numfailed = 0
      for (let i = 0; i < 150; i++) {
        const curstream = client.createBidirectionalStream()
        bidistreams.push(curstream)
        curstream
          .then(() => {
            numbidi++
          })
          .catch(() => {
            numfailed++
          })
      }
      await Promise.allSettled(bidistreams)
      expect(numbidi).to.equal(100 - adjustlimit)
      expect(numfailed).to.equal(50 + adjustlimit)
      numfailed = 0
      for (let i = 0; i < 50 + adjustlimit; i++) {
        const curstream = await bidistreams.shift()
        await curstream.readable.cancel()
        await curstream.writable.close()
      }
      // as close is not a save measure, that the limit is updated
      // actually no save measure exist, waiting for a typical rtt could be a way
      // to ensure that the update of maxstreams arrives
      await new Promise((resolve) => setTimeout(resolve, 200))

      for (let i = 0; i < 50 + adjustlimit; i++) {
        const curstream = client.createBidirectionalStream()
        bidistreams.push(curstream)
        curstream
          .then(() => {
            numbidi++
          })
          .catch(() => {
            numfailed++
          })
      }
      await Promise.allSettled(bidistreams)
      expect(numbidi).to.equal(150)
      expect(numfailed).to.equal(0)

      const result = await client.closed
      expect(result).to.have.property('closeCode', 0)
      expect(result).to.have.property('reason', '')
    })
  }

  if (dowaitUntilAvailable) {
    it('should detect stream limit unidi outgoing with waitUntilAvailable = true', async () => {
      client = new WebTransport(
        `${process.env.SERVER_URL}/streamlimits_getunidis_wua`,
        { ...wtOptions }
      )
      await client.ready
      const unidistreams = []
      let numunidi = 0
      for (let i = 0; i < 150; i++) {
        const curstream = client.createUnidirectionalStream({
          waitUntilAvailable: true
        })
        unidistreams.push(curstream)
        curstream
          .then(() => {
            numunidi++
          })
          .catch(() => {})
      }
      await client.createBidirectionalStream({
        waitUntilAvailable: true
      })
      expect(numunidi).to.equal(100)
      await client.createBidirectionalStream({
        waitUntilAvailable: true
      })
      for (let i = 0; i < 50 + adjustlimit; i++) {
        const curstream = await unidistreams.shift()
        await curstream.close()
      }
      await Promise.allSettled(unidistreams)
      await client.createBidirectionalStream({
        waitUntilAvailable: true
      })
      expect(numunidi).to.equal(150)

      const result = await client.closed
      expect(result).to.have.property('closeCode', 0)
      expect(result).to.have.property('reason', '')
    })
  }

  if (!skipall) {
    it('should detect stream limit unidi outgoing', async () => {
      client = new WebTransport(
        `${process.env.SERVER_URL}/streamlimits_getunidis`,
        { ...wtOptions }
      )
      await client.ready
      const unidistreams = []
      let numunidi = 0
      let numfailed = 0
      for (let i = 0; i < 150; i++) {
        const curstream = client.createUnidirectionalStream()
        unidistreams.push(curstream)
        curstream
          .then(() => {
            numunidi++
          })
          .catch(() => {
            numfailed++
          })
      }
      await Promise.allSettled(unidistreams)
      expect(numunidi).to.equal(100)
      expect(numfailed).to.equal(50)
      numfailed = 0
      for (let i = 0; i < 50 + adjustlimit; i++) {
        const curstream = await unidistreams.shift()
        await curstream.close()
      }
      // as close is not a save measure, that the limit is updated
      // actually no save measure exist, waiting for a typical rtt could be a way
      // to ensure that the update of maxstreams arrives
      await new Promise((resolve) => setTimeout(resolve, 200))
      for (let i = 0; i < 50; i++) {
        const curstream = client.createUnidirectionalStream()
        unidistreams.push(curstream)
        curstream
          .then(() => {
            numunidi++
          })
          .catch(() => {
            numfailed++
          })
      }
      await Promise.allSettled(unidistreams)
      expect(numunidi).to.equal(150)
      expect(numfailed).to.equal(0)

      const result = await client.closed
      expect(result).to.have.property('closeCode', 0)
      expect(result).to.have.property('reason', '')
    })
  }
})
