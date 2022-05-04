// Copyright (c) 2022 Marten Richter or other contributers (see commit). All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import { echoTestsConnection } from './testsuite'

async function startClientTests(args) {
  const url = 'https://' + args.hostname + ':' + args.port + '/echo'
  console.log('startconnection')
  // eslint-disable-next-line no-undef
  const transport = new WebTransport(url)
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

startClientTests()
