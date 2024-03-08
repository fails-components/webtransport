/* eslint-env mocha */

import { readCertHash } from './fixtures/read-cert-hash.js'
import WebTransport from './fixtures/webtransport.js'
import { expect } from './fixtures/chai.js'
import { quicheLoaded } from './fixtures/quiche.js'

/**
 * @template T
 * @typedef {import('../lib/types').Deferred<T>} Deferred<T>
 */

describe('session', function () {
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

  it('should detect session closure', async () => {
    client = new WebTransport(
      `${process.env.SERVER_URL}/session_close`,
      wtOptions
    )
    await client.ready

    const result = await client.closed
    expect(result).to.have.property('closeCode', 0)
    expect(result).to.have.property('reason', '')
  })

  it('should detect session closure with close info', async () => {
    // client context - connects to the server, sends some datagrams and reads the response
    client = new WebTransport(
      `${process.env.SERVER_URL}/session_close_with_reason`,
      wtOptions
    )
    await client.ready

    const result = await client.closed
    expect(result).to.have.property('closeCode', 7)
    expect(result).to.have.property('reason', 'this is the reason')
  })
  if (browser === 'firefox') this.timeout(31000) // really firefox?
  it('should error when connecting to a server that does not exist', async () => {
    client = new WebTransport(`https://127.0.0.1:39821`, {
      quicConnectTimeout: 100,
      webTransportConnectTimeout: 100,
      ...wtOptions
    })

    const [closedResult, readyResult] = await Promise.all([
      client.closed.catch((err) => err),
      client.ready.catch((err) => err)
    ])

    expect(closedResult)
      .to.be.a('WebTransportError')
      .with.property('message', handshakemess)
    expect(readyResult)
      .to.be.a('WebTransportError')
      .with.property('message', handshakemess)
  })

  it('should error when connecting to a path that does not exist', async () => {
    client = new WebTransport(
      `${process.env.SERVER_URL}/non_existant`,
      wtOptions
    )

    const [closedResult, readyResult] = await Promise.all([
      client.closed.catch((err) => err),
      client.ready.catch((err) => err)
    ])

    expect(closedResult)
      .to.be.a('WebTransportError')
      .with.property('message', handshakemess)
    expect(readyResult)
      .to.be.a('WebTransportError')
      .with.property('message', handshakemess)
  })

  if (
    process.env.USE_POLYFILL !== 'true' &&
    process.env.USE_PONYFILL !== 'true' &&
    wtOptions.serverCertificateHashes
  ) {
    // deactivated in polyfill case, no test necessary
    it('should error when connecting with a bad certificate', async () => {
      client = new WebTransport(`${process.env.SERVER_URL}/session_close`, {
        serverCertificateHashes: [
          {
            algorithm: 'sha-256',
            value: readCertHash(process.env.CERT_HASH + ':DE:AD:BE:EF')
          }
        ],
        // @ts-ignore
        forceReliable
      })

      const [closedResult, readyResult] = await Promise.all([
        client.closed.catch((err) => err),
        client.ready.catch((err) => err)
      ])

      expect(closedResult)
        .to.be.a('WebTransportError')
        .with.property('message', handshakemess)
      expect(readyResult)
        .to.be.a('WebTransportError')
        .with.property('message', handshakemess)
    })

    it('should error when connecting with the wrong certificate', async () => {
      client = new WebTransport(`${process.env.SERVER_URL}/session_close`, {
        serverCertificateHashes: [
          {
            algorithm: 'sha-256',
            value: readCertHash(
              'DE:AD:BE:EF:' + process.env.CERT_HASH?.substring(12)
            )
          }
        ],
        // @ts-ignore
        forceReliable
      })

      const [closedResult, readyResult] = await Promise.all([
        client.closed.catch((err) => err),
        client.ready.catch((err) => err)
      ])

      expect(closedResult)
        .to.be.a('WebTransportError')
        .with.property('message', handshakemess)
      expect(readyResult)
        .to.be.a('WebTransportError')
        .with.property('message', handshakemess)
    })
  }
})
