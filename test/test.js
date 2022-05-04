// Copyright (c) 2022 Marten Richter or other contributers (see commit). All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

// this file runs various tests

import { generate as generateCertificate } from 'selfsigned'
import { Http3Server, WebTransport, testcheck } from '../src/webtransport.js'
import { echoTestsConnection, runEchoServer } from './testsuite.js'
import { X509Certificate } from 'crypto'

async function run() {
  setTimeout(() => {
    if (!testcheck()) {
      console.log('tests took too long, probably hanging')
      process.exit(1)
    } else {
      console.log('global event loop gone, everything alright')
      process.exit(0)
    }
  }, 40 * 1000)
  console.log('start generating self signed certificate')

  const attrs = [
    { shortName: 'C', value: 'DE' },
    { shortName: 'ST', value: 'Berlin' },
    { shortName: 'L', value: 'Berlin' },
    { shortName: 'O', value: 'WebTransport Test Server' },
    { shortName: 'CN', value: '127.0.0.1' }
  ]
  let certificate = generateCertificate(attrs, {
    keySize: 2048,
    days: 30,
    algorithm: 'sha256'
  })

  const x509cert = new X509Certificate(certificate.cert)

  const certhash = Buffer.from(
    x509cert.fingerprint256.split(':').map((el) => parseInt(el, 16))
  )

  console.log('start Http3Server and startup echo tests')
  // now ramp up the server
  let http3server
  try {
    http3server = new Http3Server({
      port: 8080,
      host: '127.0.0.1',
      secret: 'mysecret',
      cert: certificate.cert, // unclear if it is the correct format
      privKey: certificate.private
    })
    certificate = null

    runEchoServer(http3server)
    http3server.startServer() // you can call destroy to remove the server
  } catch (error) {
    console.log('http3error', error)
  }
  console.log('server started now wait 2 seconds')

  await new Promise((resolve) => setTimeout(resolve, 2000))
  console.log('now startup client')

  const url = 'https://127.0.0.1:8080/echo'

  let client = new WebTransport(url, {
    serverCertificateHashes: [{ algorithm: 'sha-256', value: certhash }]
  })
  client.closed
    .then(() => {
      console.log('The HTTP/3 connection to ', url, 'closed gracefully.')
    })
    .catch((error) => {
      console.error(
        'The HTTP/3 connection to',
        url,
        'closed due to ',
        error,
        '.'
      )
    })

  console.log('wait for client to be ready')
  await client.ready
  console.log('client is ready')
  await echoTestsConnection(client)
  console.log('client test finished, now close the client but wait 2 seconds')

  await new Promise((resolve) => setTimeout(resolve, 2000))

  try {
    client.close({ closeCode: 5, reason: 'tests finished' })
  } catch (error) {
    console.log('client close problem', error)
  }
  client = null

  console.log('client closes now wait 2 seconds')

  await new Promise((resolve) => setTimeout(resolve, 2000))

  console.log('now stop server')

  http3server.stopServer()
  console.log('tests finished!')
}
run()
