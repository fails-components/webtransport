/* eslint-env mocha */

import WebTransport from './fixtures/webtransport.js'
import { expect } from './fixtures/chai.js'
import { readStream } from './fixtures/read-stream.js'
import { writeStream } from './fixtures/write-stream.js'
import { readCertHash } from './fixtures/read-cert-hash.js'
import * as ui8 from 'uint8arrays'
import { KNOWN_BYTES } from './fixtures/known-bytes.js'

/**
 * @template T
 * @typedef {import('../lib/types').Deferred<T>} Deferred<T>
 */

describe('datagrams', function () {
  /** @type {import('../lib/dom').WebTransport | undefined} */
  let client

  afterEach(async () => {
    if (client != null) {
      client.close()
    }
  })

  it('client sends datagrams to the server', async () => {
    // client context - connects to the server, sends some datagrams and reads the response
    client = new WebTransport(`${process.env.SERVER_URL}/datagrams_send`, {
      serverCertificateHashes: [
        {
          algorithm: 'sha-256',
          value: readCertHash(process.env.CERT_HASH)
        }
      ]
    })
    await client.ready

    await writeStream(client.datagrams.writable, KNOWN_BYTES)

    const result = await client.closed

    // should receive the default close info
    expect(result).to.have.property('reason', '')
    expect(result).to.have.property('closeCode', 0)
  })

  it('receives datagrams from the server', async () => {
    // client context - pipes the server's datagrams back to them
    client = new WebTransport(`${process.env.SERVER_URL}/datagrams_receive`, {
      serverCertificateHashes: [
        {
          algorithm: 'sha-256',
          value: readCertHash(process.env.CERT_HASH)
        }
      ]
    })
    await client.ready

    const received = await readStream(
      client.datagrams.readable,
      KNOWN_BYTES.length
    )

    expect(ui8.concat(KNOWN_BYTES)).to.deep.equal(
      ui8.concat(received),
      'Data did not match'
    )
  })
})
