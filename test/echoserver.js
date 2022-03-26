// Copyright (c) 2022 Marten Richter or other contributers (see commit). All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import { readFileSync } from 'fs'
import { Http3Server } from '../src/webtransport.js'

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

  const sessionHandle = async () => {
    const sessionStream = await http3server.sessionStream('/echo')
    const sessionReader = sessionStream.getReader()
    while (true) {
      const { done, value } = await sessionReader.read()
      if (done) {
        console.log('Session is gone')
        break
      }
      console.log('got a newsession', value)
      await value.ready
      console.log('session is ready')
      const helpfunc = async () => {
        const err = await value.closed
        console.log('session was closed', err)
      }
      helpfunc()

      const echofunc = async () => {
        try {
          const bidiReader = value.incomingBidirectionalStreams.getReader()
          while (true) {
            const bidistr = await bidiReader.read()
            if (bidistr.done) {
              console.log('bidiReader terminated')
              break
            }
            if (bidistr.value) {
              // ok we got a stream
              const bidistream = bidistr.value
              // echo it
              await bidistream.readable.pipeTo(bidistream.writable)
              console.log('bidiReader finished piping')
            }
          }
        } catch (error) {
          console.log('bidiReader exited with', error)
        }
      }
      echofunc()
      // now send a bidirectional stream out
      const mybidistream = await value.createBidirectionalStream()
      // echo it
      mybidistream.readable.pipeTo(mybidistream.writable)
      console.log('send a bidirectional stream out')
      const echofunc2 = async () => {
        try {
          const unidiReader = value.incomingUnidirectionalStreams.getReader()
          while (true) {
            const unidistr = await unidiReader.read()
            if (unidistr.done) {
              console.log('unidiReader terminated')
              break
            }
            if (unidistr.value) {
              // ok we got a stream
              const unidistream = unidistr.value
              // echo it
              const uniwritable = await value.createUnidirectionalStream()
              await unidistream.pipeTo(uniwritable)
              console.log('unidiReader finished piping')
            }
          }
        } catch (error) {
          console.log('bidiReader2 exited with', error)
        }
      }
      echofunc2()
      console.log('install datagram echo')
      try {
        value.datagrams.readable.pipeTo(value.datagrams.writable)
      } catch (error) {
        console.log('datagram echo exited with', error)
      }
    }
  }
  sessionHandle()

  http3server.startServer() // you can call destroy to remove the server
} catch (error) {
  console.log('http3error', error)
}
