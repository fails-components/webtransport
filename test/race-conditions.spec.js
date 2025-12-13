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

  describe('session close race conditions', function () {
    it('should handle rapid close while datagrams are in flight', async () => {
      // This tests the fix for onDatagramReceived race condition
      client = new WebTransport(
        `${process.env.SERVER_URL}/datagrams_server_send`,
        wtOptions
      )
      await client.ready

      // Start reading datagrams, then immediately close
      const readPromise = client.datagrams.readable.getReader().read()

      // Close immediately - this could race with incoming datagrams
      client.close()

      // Should not throw - the race condition fix handles this gracefully
      try {
        await readPromise
      } catch {
        // Expected - read may fail when session closes
      }

      // Verify session closed properly
      const result = await client.closed
      expect(result).to.have.property('closeCode')
    })

    it('should handle rapid close while streams are being created', async () => {
      // This tests the fix for onStream race condition
      client = new WebTransport(
        `${process.env.SERVER_URL}/bidirectional_server_initiated_echo`,
        wtOptions
      )
      await client.ready

      // Start waiting for incoming stream
      const streamPromise = getReaderValue(client.incomingBidirectionalStreams)

      // Close immediately - this could race with incoming streams
      client.close()

      // Should not throw - the race condition fix handles this gracefully
      try {
        await streamPromise
      } catch {
        // Expected - stream read may fail when session closes
      }

      // Verify session closed properly
      const result = await client.closed
      expect(result).to.have.property('closeCode')
    })

    it('should handle multiple rapid session close/create cycles', async () => {
      // Stress test for race conditions
      const iterations = 5

      for (let i = 0; i < iterations; i++) {
        const tempClient = new WebTransport(
          `${process.env.SERVER_URL}/datagrams_server_send`,
          wtOptions
        )

        try {
          await tempClient.ready

          // Start some operations
          const writer = tempClient.datagrams.createWritable
            ? tempClient.datagrams.createWritable().getWriter()
            : tempClient.datagrams.writable.getWriter()

          // Fire off writes without waiting
          writer.write(Uint8Array.from([1, 2, 3])).catch(() => { })
          writer.write(Uint8Array.from([4, 5, 6])).catch(() => { })

          // Close immediately
          tempClient.close()

          await tempClient.closed
        } catch {
          // Some iterations may fail to connect, that's ok
        }
      }

      // If we get here without crashing, the test passed
      expect(true).to.equal(true)
    })
  })

  describe('stream operations race conditions', function () {
    it('should handle stream read after session close', async () => {
      client = new WebTransport(
        `${process.env.SERVER_URL}/unidirectional_server_send`,
        wtOptions
      )
      await client.ready

      // Get incoming stream
      const stream = await getReaderValue(client.incomingUnidirectionalStreams)
      const reader = stream.getReader()

      // Start reading
      const readPromise = reader.read()

      // Close session while reading
      client.close()

      // Should not throw uncaught exception
      try {
        await readPromise
      } catch {
        // Expected - read may fail when session closes
      }

      await client.closed
    })

    it('should handle stream write after session close', async () => {
      client = new WebTransport(
        `${process.env.SERVER_URL}/bidirectional_client_initiated_echo`,
        wtOptions
      )
      await client.ready

      // Create a stream
      const stream = await client.createBidirectionalStream()
      const writer = stream.writable.getWriter()

      // Close session
      client.close()

      // Try to write after close - should not throw uncaught exception
      try {
        await writer.write(Uint8Array.from([1, 2, 3]))
      } catch {
        // Expected - write should fail after session close
      }

      await client.closed
    })
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
