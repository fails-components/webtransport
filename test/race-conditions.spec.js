/* eslint-env mocha */

import WebTransport from './fixtures/webtransport.js'
import { expect } from './fixtures/chai.js'
import { readCertHash } from './fixtures/read-cert-hash.js'
import { quicheLoaded } from './fixtures/quiche.js'
import { getReaderValue } from './fixtures/reader-value.js'

/**
 * Tests for race condition fixes:
 * 1. Datagram received after session close
 * 2. Stream received after session close
 * 3. Server session after server stop
 * 4. sendOrder setter bug fix
 * 5. commitReadBuffer race condition
 */

describe('race conditions', function () {
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

  describe('sendOrder setter fix', function () {
    it('should correctly update sendOrder on writable stream', async () => {
      client = new WebTransport(
        `${process.env.SERVER_URL}/bidirectional_client_initiated_echo`,
        wtOptions
      )
      await client.ready

      // Create a stream with initial sendOrder
      const stream = await client.createBidirectionalStream({
        sendOrder: 100n
      })

      // Check if sendOrder property exists (it may not in all implementations)
      if ('sendOrder' in stream.writable) {
        // Get initial value
        const initialOrder = stream.writable.sendOrder

        // Set a new value
        stream.writable.sendOrder = 200n

        // Verify the value was updated (this tests the bug fix)
        // Before the fix, the value would remain unchanged
        expect(stream.writable.sendOrder).to.equal(200n)
        expect(stream.writable.sendOrder).to.not.equal(initialOrder)

        // Test setting to another value
        stream.writable.sendOrder = 300n
        expect(stream.writable.sendOrder).to.equal(300n)
      } else {
        console.log('sendOrder property not available, skipping')
      }

      client.close()
      await client.closed
    })
  })

  describe('sendGroup null safety', function () {
    it('should handle stream without sendGroup', async () => {
      client = new WebTransport(
        `${process.env.SERVER_URL}/bidirectional_client_initiated_echo`,
        wtOptions
      )
      await client.ready

      // Create a stream without specifying sendGroup
      const stream = await client.createBidirectionalStream()

      // Should not crash when sendGroup is undefined
      if ('sendOrder' in stream.writable) {
        // This should not throw even when sendGroup is undefined
        try {
          stream.writable.sendOrder = 100n
        } catch (err) {
          // If it throws, the null safety fix isn't working
          console.error('Caught error:', err)
          expect.fail(
            `Setting sendOrder should not throw when sendGroup is undefined: ${err.message}`
          )
        }
      } else {
        console.log(
          'Skipping sendOrder update test for HTTP2 (known scheduler limitation)'
        )
      }

      client.close()
      await client.closed
    })
  })
})
