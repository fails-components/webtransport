// Copyright (c) 2022 Marten Richter or other contributers (see commit). All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import { readFileSync } from 'fs'
import { Http3Server } from '../src/webtransport.js'
import { runEchoServer } from './testsuite.js'


const crt = readFileSync('certs/out/leaf_cert.pem')
const privKey = readFileSync('certs/out/leaf_cert.key')



try {
  const http3server = new Http3Server({
    port: 8080,
    host: '0.0.0.0',
    secret: 'mysecret',
    cert: crt,
    privKey: privKey
  })
  
  runEchoServer(http3server)
  http3server.startServer() // you can call destroy to remove the server
} catch (error) {
  console.log('http3error', error)
}
