/* eslint-env mocha */

import WebTransport from './fixtures/webtransport.js'
import { expect } from './fixtures/chai.js'
import { readStream } from './fixtures/read-stream.js'
import { writeStream } from './fixtures/write-stream.js'
import { readCertHash } from './fixtures/read-cert-hash.js'
import { pTimeout } from './fixtures/p-timeout.js'
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

  const waitForSettings =
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

  it('client sends datagrams to the server below and over maxDatagramSize', async () => {
    client = new WebTransport(
      `${process.env.SERVER_URL}/datagrams_client_send_count`,
      wtOptions
    )
    await client.ready

    let writable
    if (client.datagrams.createWritable) {
      writable = client.datagrams.createWritable()
    } else {
      console.log(
        'createWriteable for datagrams unsupported, fallback to old writable'
      )
      writable = client.datagrams.writable
    }
    if (waitForSettings) await new Promise((resolve) => setTimeout(resolve, 50)) // we have to wait before initial settings arrive
    expect(client.datagrams.maxDatagramSize).to.be.lessThan(1000_000_000)
    expect(client.datagrams.maxDatagramSize).to.be.greaterThan(0)
    const maxDatagramSize = Math.min(
      client.datagrams.maxDatagramSize,
      1_000_000
    )

    const datagramsOutgoing = Array(10)
      .fill(
        [
          200,
          500,
          maxDatagramSize * 0.5,
          maxDatagramSize * 0.2,
          maxDatagramSize,
          2 * maxDatagramSize,
          3 * maxDatagramSize,
          10 * maxDatagramSize,
          Math.min(100 * maxDatagramSize, 10_000_000),
          10
        ]
          .map((el) => Math.ceil(el))
          .map((el) => new Uint8Array(el))
      )
      .flat()

    const datagramSizesIncom = []

    const expected = datagramsOutgoing.reduce(
      (prevVal, el) => prevVal + el.byteLength,
      0
    )

    await Promise.all([
      writeStream(writable, datagramsOutgoing),
      Promise.any([
        new Promise((resolve) => setTimeout(resolve, 1000)),
        readStream(client.datagrams.readable, expected, {
          outputreportValue: (value) => {
            const array = new Uint32Array(
              value.buffer,
              value.byteOffset,
              value.byteLength / Uint32Array.BYTES_PER_ELEMENT
            )
            if (array.length > 0) {
              datagramSizesIncom.push(array[0])
            }
          }
        })
      ])
    ])

    const datagramsBelowLimit = datagramSizesIncom.filter(
      (el) => el <= client.datagrams.maxDatagramSize
    ).length
    const datagramsOverLimit = datagramSizesIncom.filter(
      (el) => el > client.datagrams.maxDatagramSize
    ).length

    const datagramsBelowLimitOut = datagramsOutgoing
      .map((el) => el.byteLength)
      .filter((el) => el <= client.datagrams.maxDatagramSize).length
    const datagramsOverLimitOut = datagramsOutgoing
      .map((el) => el.byteLength)
      .filter((el) => el > client.datagrams.maxDatagramSize).length

    expect(datagramsOverLimit).to.be.equal(0, 'Datagrams over limit received')
    expect(datagramsBelowLimit).to.be.at.most(
      datagramsBelowLimitOut,
      'More datagrams received than send out'
    )
    expect(datagramsOverLimitOut).to.be.at.least(1)
    expect(datagramsBelowLimit).to.be.at.least(1)
    expect(datagramsBelowLimitOut).to.be.at.least(1)
    expect(datagramsBelowLimit).to.be.at.least(
      Math.ceil(0.3 * datagramsBelowLimitOut),
      'We should least receive a third of the datagrams'
    )
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
  it('server sends datagrams to the client below and over maxDatagramSize', async () => {
    client = new WebTransport(
      `${process.env.SERVER_URL}/datagrams_server_send_count`,
      wtOptions
    )
    await client.ready

    let writable
    if (client.datagrams.createWritable) {
      writable = client.datagrams.createWritable()
    } else {
      console.log(
        'createWriteable for datagrams unsupported, fallback to old writable'
      )
      writable = client.datagrams.writable
    }
    if (waitForSettings) await new Promise((resolve) => setTimeout(resolve, 50)) // we have to wait before initial settings arrive
    expect(client.datagrams.maxDatagramSize).to.be.lessThan(1000_000_000)
    expect(client.datagrams.maxDatagramSize).to.be.greaterThan(0)

    const datagramsOutgoingPlan = Array(10)
      .fill([
        { bytesize: 200 },
        { bytesize: 500 },
        { dasize: 0.5 },
        { dasize: 0.2 },
        { dasize: 1.0 },
        { dasize: 2 },
        { dasize: 3 },
        { dasize: 10 },
        { dasize: 100 },
        { bytesize: 10 }
      ])
      .flat()

    const datagramsOutgoing = datagramsOutgoingPlan.map((el) => {
      const uint32arr = new Uint32Array(2)
      uint32arr[0] = el.bytesize
      uint32arr[1] = el.dasize
      return new Uint8Array(uint32arr.buffer)
    })

    let datagramsBelowLimit = 0
    let datagramsOverLimit = 0

    await Promise.all([
      writeStream(writable, datagramsOutgoing),
      Promise.any([
        new Promise((resolve) => setTimeout(resolve, 1000)),
        readStream(client.datagrams.readable, 1000_000_000, {
          outputreportValue: (value) => {
            const array = new Uint32Array(
              value.buffer,
              value.byteOffset,
              value.byteLength / Uint32Array.BYTES_PER_ELEMENT
            )
            if (array.length > 0) {
              const mDatagramSize = array[0]
              const sendBytelength = array[1]
              expect(sendBytelength).to.be.equal(value.byteLength)
              if (value.byteLength > mDatagramSize) datagramsOverLimit++
              else datagramsBelowLimit++
            }
          }
        })
      ])
    ])

    let datagramsBelowLimitOut = 0
    let datagramsOverLimitOut = 0
    datagramsOutgoingPlan.forEach((el) => {
      if (el.dasize > 1) datagramsOverLimitOut++
      else datagramsBelowLimitOut++
    })

    expect(datagramsOverLimit).to.be.equal(0, 'Datagrams over limit received')
    expect(datagramsBelowLimit).to.be.at.most(
      datagramsBelowLimitOut,
      'More datagrams received than send out'
    )
    expect(datagramsBelowLimit).to.be.at.least(1)
    expect(datagramsOverLimitOut).to.be.at.least(1)
    expect(datagramsBelowLimitOut).to.be.at.least(1)
    expect(datagramsBelowLimit).to.be.at.least(
      Math.ceil(0.3 * datagramsBelowLimitOut),
      'We should least receive a third of the datagrams'
    )
  })
})
