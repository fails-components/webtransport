/* eslint-env mocha */

import WebTransport from './fixtures/webtransport.js'
import { expect } from './fixtures/chai.js'
import { readStream } from './fixtures/read-stream.js'
import { readCertHash } from './fixtures/read-cert-hash.js'
import { pTimeout, TimeoutError } from './fixtures/p-timeout.js'
import { quicheLoaded } from './fixtures/quiche.js'

/**
 * @template T
 * @typedef {import('../lib/types').Deferred<T>} Deferred<T>
 */

describe('datagrams', function () {
  /** @type {import('../lib/dom').WebTransport | undefined} */
  let client
  let forceReliable = false
  if (process.env.USE_HTTP2 === 'true') forceReliable = true
  const browser = process.env.BROWSER

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
  it('client sends datagrams to the server', async () => {
    // client context - connects to the server, sends some datagrams and reads the response
    client = new WebTransport(
      `${process.env.SERVER_URL}/datagrams_client_send`,
      wtOptions
    )
    await client.ready

    let writer
    if (client.datagrams.createWritable) {
      writer = client.datagrams.createWritable().getWriter()
    } else {
      console.log(
        'createWriteable for datagrams unsupported, fallback to old writable'
      )
      writer = client.datagrams.writable.getWriter()
    }
    let closed = false

    // write datagrams until the server receives one and closes the connection
    // eslint-disable-next-line promise/catch-or-return
    Promise.resolve().then(async () => {
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
      wtOptions
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

  it('receives datagrams from the server (byte stream)', async () => {
    // client context - pipes the server's datagrams back to them
    client = new WebTransport(
      `${process.env.SERVER_URL}/datagrams_server_send`,
      { ...wtOptions, datagramsReadableMode: 'bytes' }
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

  if (browser !== 'chromium') {
    // chromium defaults to byte stream
    it('receives zero datagrams from the server', async () => {
      // client context - pipes the server's datagrams back to them
      client = new WebTransport(
        `${process.env.SERVER_URL}/datagrams_server_send_zero`,
        wtOptions
      )
      await client.ready

      // datagram transport is unreliable, at least one datagram should made it through
      const expected = 1

      const received = await pTimeout(
        readStream(client.datagrams.readable, 0 /* this is length */),
        1000
      )
      expect(received).to.have.lengthOf(expected)
    })
  }

  if (browser !== 'firefox') {
    // firefox defaults to non byte stream
    it('receives zero datagrams from the server (byte stream)', async () => {
      // client context - pipes the server's datagrams back to them
      client = new WebTransport(
        `${process.env.SERVER_URL}/datagrams_server_send_zero`,
        { ...wtOptions, datagramsReadableMode: 'bytes' }
      )
      await client.ready

      // datagram transport is unreliable, since we use a byte stream all datagrams should be droped
      const expected = 0
      let timeout = false

      await pTimeout(
        readStream(client.datagrams.readable, expected),
        1000
      ).catch((error) => {
        if (!(error instanceof TimeoutError)) {
          throw error
        } else {
          timeout = true
        }
      })
      expect(timeout).to.equal(true)
    })
  }
})
