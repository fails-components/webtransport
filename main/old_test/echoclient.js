// Copyright (c) 2022 Marten Richter or other contributers (see commit). All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import { echoTestsConnection } from './testsuite.js'
import { WebTransport } from '../lib/index.js'

/**
 * @param {{ hostname: string, port: number }} args
 * @param {{ serverCertificateHashes: Array<{ algorithm: string, value: string }> }} hashes
 */
async function startClientTests(args, hashes) {
  const url = 'https://' + args.hostname + ':' + args.port + '/echo'
  console.log('startconnection')
  const hashargs = {
    ...hashes,
    serverCertificateHashes: hashes.serverCertificateHashes.map((el) => ({
      algorithm: el.algorithm,
      value: Buffer.from(el.value.split(':').map((el) => parseInt(el, 16)))
    }))
  }
  console.log('hashagrs', hashargs)
  const transport = new WebTransport(url, hashargs)
  transport.closed
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

  await transport.ready
  console.log('webtransport is ready', transport)
  echoTestsConnection(transport)
}

// edit the next lines for your test setting
startClientTests(
  { hostname: '192.168.1.108', port: 8081 },
  {
    serverCertificateHashes: [
      {
        algorithm: 'sha-256',
        value:
          '78:CB:61:68:30:4D:9F:CF:9F:7E:D8:20:B6:4E:4E:85:62:FE:F7:70:84:64:73:38:4C:D7:76:D5:4B:CF:98:38'
      }
    ]
  }
)
