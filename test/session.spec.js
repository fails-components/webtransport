/* eslint-env mocha */

import { readCertHash } from './fixtures/read-cert-hash.js'
import WebTransport from './fixtures/webtransport.js'
import { expect } from './fixtures/chai.js'

/**
 * @template T
 * @typedef {import('../lib/types').Deferred<T>} Deferred<T>
 */

describe('session', function () {
  // FIXME: sometimes there are seemingly arbitrary 5s delays in
  // communicating with the server under node.js
  this.timeout(10000)

  /** @type {import('../lib/dom').WebTransport | undefined} */
  let client

  afterEach(async () => {
    if (client != null) {
      client.close()
    }
  })

  it('should detect session closure', async () => {
    client = new WebTransport(`${process.env.SERVER_URL}/session_close`, {
      serverCertificateHashes: [
        {
          algorithm: 'sha-256',
          value: readCertHash(process.env.CERT_HASH)
        }
      ]
    })
    await client.ready

    const result = await client.closed
    expect(result).to.have.property('closeCode', 0)
    expect(result).to.have.property('reason', '')
  })

  it('should detect session closure with close info', async () => {
    // client context - connects to the server, sends some datagrams and reads the response
    client = new WebTransport(
      `${process.env.SERVER_URL}/session_close_with_reason`,
      {
        serverCertificateHashes: [
          {
            algorithm: 'sha-256',
            value: readCertHash(process.env.CERT_HASH)
          }
        ]
      }
    )
    await client.ready

    const result = await client.closed
    expect(result).to.have.property('closeCode', 7)
    expect(result).to.have.property('reason', 'this is the reason')
  })

  it('should error when connecting to a server that does not exist', async () => {
    client = new WebTransport(`https://127.0.0.1:39821`, {
      serverCertificateHashes: [
        {
          algorithm: 'sha-256',
          value: readCertHash(process.env.CERT_HASH)
        }
      ],
      quicConnectTimeout: 100,
      webTransportConnectTimeout: 100
    })

    const [closedResult, readyResult] = await Promise.all([
      client.closed.catch((err) => err),
      client.ready.catch((err) => err)
    ])

    expect(closedResult)
      .to.be.a('WebTransportError')
      .with.property('message', 'Opening handshake failed.')
    expect(readyResult)
      .to.be.a('WebTransportError')
      .with.property('message', 'Opening handshake failed.')
  })

  it('should error when connecting to a path that does not exist', async () => {
    client = new WebTransport(`${process.env.SERVER_URL}/non_existant`, {
      serverCertificateHashes: [
        {
          algorithm: 'sha-256',
          value: readCertHash(process.env.CERT_HASH)
        }
      ]
    })

    const [closedResult, readyResult] = await Promise.all([
      client.closed.catch((err) => err),
      client.ready.catch((err) => err)
    ])

    expect(closedResult)
      .to.be.a('WebTransportError')
      .with.property('message', 'Opening handshake failed.')
    expect(readyResult)
      .to.be.a('WebTransportError')
      .with.property('message', 'Opening handshake failed.')
  })

  it('should error when connecting with a bad certificate', async () => {
    client = new WebTransport(`${process.env.SERVER_URL}/session_close`, {
      serverCertificateHashes: [
        {
          algorithm: 'sha-256',
          value: readCertHash(process.env.CERT_HASH + ':DE:AD:BE:EF')
        }
      ]
    })

    const [closedResult, readyResult] = await Promise.all([
      client.closed.catch((err) => err),
      client.ready.catch((err) => err)
    ])

    expect(closedResult)
      .to.be.a('WebTransportError')
      .with.property('message', 'Opening handshake failed.')
    expect(readyResult)
      .to.be.a('WebTransportError')
      .with.property('message', 'Opening handshake failed.')
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
      ]
    })

    const [closedResult, readyResult] = await Promise.all([
      client.closed.catch((err) => err),
      client.ready.catch((err) => err)
    ])

    expect(closedResult)
      .to.be.a('WebTransportError')
      .with.property('message', 'Opening handshake failed.')
    expect(readyResult)
      .to.be.a('WebTransportError')
      .with.property('message', 'Opening handshake failed.')
  })
})
