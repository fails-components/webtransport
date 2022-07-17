// Copyright (c) 2022 Marten Richter or other contributers (see commit). All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

// this file runs various tests

import { generateWebTransportCertificate } from './certificate.js'
import { Http3Server, WebTransport, testcheck } from '../src/webtransport.js'
import { echoTestsConnection, runEchoServer } from './testsuite.js'

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

  const certificate = await generateWebTransportCertificate(attrs, {
    days: 13
  })

  console.log('start Http3Server and startup echo tests')
  // now ramp up the server
  const http3server = new Http3Server({
    port: 8080,
    host: '127.0.0.1',
    secret: 'mysecret',
    cert: certificate.cert, // unclear if it is the correct format
    privKey: certificate.private
  })

  runEchoServer(http3server)
  http3server.startServer() // you can call destroy to remove the server

  console.log('server started now wait 2 seconds')

  await new Promise((resolve) => setTimeout(resolve, 2000))
  console.log('now startup client')

  const url = 'https://127.0.0.1:8080/echo'

  let client = new WebTransport(url, {
    serverCertificateHashes: [{ algorithm: 'sha-256', value: certificate.hash }]
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

  client.close({ closeCode: 0, reason: 'tests finished' })

  client = null

  console.log('client closes now wait 2 seconds')

  await new Promise((resolve) => setTimeout(resolve, 2000))

  console.log('now stop server')

  http3server.stopServer()
  console.log('tests finished!')
}
run()
