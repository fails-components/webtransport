/* eslint-env mocha */

import WebTransport from './fixtures/webtransport.js'
import { expect } from './fixtures/chai.js'
import { readStream } from './fixtures/read-stream.js'
import { readCertHash } from './fixtures/read-cert-hash.js'
import { pTimeout } from './fixtures/p-timeout.js'

/**
 * @template T
 * @typedef {import('../lib/types').Deferred<T>} Deferred<T>
 */

describe('datagrams', function () {
  /** @type {import('../lib/dom').WebTransport | undefined} */
  let client
  let forceReliable = false
  if (process.env.USE_HTTP2 === 'true') forceReliable = true

  // @ts-ignore
  afterEach(async () => {
    if (client != null) {
      client.close()
      client = undefined
    }
  })
  it('client sends datagrams to the server', async () => {
    // client context - connects to the server, sends some datagrams and reads the response
    client = new WebTransport(
      `${process.env.SERVER_URL}/datagrams_client_send`,
      {
        serverCertificateHashes: [
          {
            algorithm: 'sha-256',
            value: readCertHash(process.env.CERT_HASH)
          }
        ],
        // @ts-ignore
        forceReliable
      }
    )
    await client.ready

    const writer = client.datagrams.writable.getWriter()
    let closed = false

    // write datagrams until the server receives one and closes the connection
    // eslint-disable-next-line promise/catch-or-return
    Promise.resolve().then(async () => {
      // eslint-disable-next-line no-unmodified-loop-condition
      while (!closed) {
        try {
          await writer.ready
          await writer.write(Uint8Array.from([0, 1, 2, 3, 4]))
          await new Promise((resolve) => setTimeout(resolve, 100))
        } catch {
          // the session can be closed while we are writing
        }
      }
    })

    const result = await client.closed
    closed = true

    // should receive the default close info
    expect(result).to.have.property('reason', '')
    expect(result).to.have.property('closeCode', 0)
  })

  it('receives datagrams from the server', async () => {
    // client context - pipes the server's datagrams back to them
    client = new WebTransport(
      `${process.env.SERVER_URL}/datagrams_server_send`,
      {
        serverCertificateHashes: [
          {
            algorithm: 'sha-256',
            value: readCertHash(process.env.CERT_HASH)
          }
        ],
        // @ts-ignore
        forceReliable
      }
    )
    await client.ready

    // datagram transport is unreliable, at least one message should make it through
    const expected = 1

    const received = await pTimeout(
      readStream(client.datagrams.readable, expected),
      1000
    )
    expect(received).to.have.lengthOf(expected)
  })
})
