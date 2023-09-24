// Copyright (c) 2022 Marten Richter or other contributers (see commit). All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

// this file runs various tests

import { generateWebTransportCertificate } from '../test/fixtures/certificate.js'
import {
  Http3Server,
  Http2Server,
  WebTransport,
  testcheck
} from '../lib/index.js'
import { echoTestsConnection, runEchoServer } from './testsuite.js'

let http2 = false

if (process.argv.some((el) => el === 'http2')) {
  http2 = true
}

async function run() {
  console.log('try connecting to server that does not exist')
  const badClient = new WebTransport('https://127.0.0.1:49823/echo', {
    serverCertificateHashes: [
      {
        algorithm: 'sha-256',
        value: Buffer.from(
          'a589bf4f98a0158aa890328d5d3f519b9e2a5b1e61b09eb10b7a9be0e79bf148',
          'hex'
        )
      }
    ]
  })
  await Promise.all([badClient.ready, badClient.closed])
    .then(() => {
      console.error('Successfully connected to a non-running server?!')
      process.exit(1)
    })
    .catch(() => {
      console.log('Did not connect to non-running server')
    })

  console.log('start generating self signed certificate')

  const attrs = [
    { shortName: 'C', value: 'DE' },
    { shortName: 'ST', value: 'Berlin' },
    { shortName: 'L', value: 'Berlin' },
    { shortName: 'O', value: 'WebTransport Test Server' },
    { shortName: 'CN', value: '127.0.0.1' }
  ]

  const certificate = await generateWebTransportCertificate(attrs, {
    days: 13
  })

  if (certificate == null) {
    throw new Error('Certificate generation failed')
  }

  console.log('start HttpServer and startup echo tests')
  // now ramp up the server
  let httpserver
  if (!http2) {
    httpserver = new Http3Server({
      port: 8080,
      host: '127.0.0.1',
      secret: 'mysecret',
      cert: certificate.cert, // unclear if it is the correct format
      privKey: certificate.private
    })
  } else {
    httpserver = new Http2Server({
      port: 8080,
      host: '127.0.0.1',
      secret: 'mysecret',
      cert: certificate.cert, // unclear if it is the correct format
      privKey: certificate.private
    })
  }

  httpserver.startServer() // you can call destroy to remove the server
  runEchoServer(httpserver)

  console.log('server started now wait 2 seconds')

  await new Promise((resolve) => setTimeout(resolve, 2000))
  console.log('now startup client')

  const url = 'https://127.0.0.1:8080/echo'

  /** @type {import('../lib/dom').WebTransport | null} */
  let client = new WebTransport(url, {
    serverCertificateHashes: [{ algorithm: 'sha-256', value: certificate.hash }]
  })
  client.closed
    .then(() => {
      console.log('The HTTP connection to ', url, 'closed gracefully.')
    })
    .catch((error) => {
      console.error('The HTTP connection to', url, 'closed due to ', error, '.')
    })
  console.log('wait for client to be ready')
  await client.ready
  console.log('client is ready')
  await echoTestsConnection(client)
  console.log('Test if getStats works')
  console.log('getStats returned', await client.getStats())
  console.log('client test finished, now close the client but wait 2 seconds')

  await new Promise((resolve) => setTimeout(resolve, 2000))

  client.close({ closeCode: 0, reason: 'tests finished' })

  client = null

  console.log('client closes now wait 2 seconds')

  await new Promise((resolve) => setTimeout(resolve, 2000))

  console.log('now stop server')

  httpserver.stopServer()
  console.log('tests finished!')
}
run()
