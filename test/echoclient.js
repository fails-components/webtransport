// Copyright (c) 2022 Marten Richter or other contributers (see commit). All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

export class WebTransportTest {
    constructor(args) {
      this.hostname = (args && args.hostname)
      this.port = (args && args.port)
    }
  
    async startConnection() {
      const url = 'https://' + this.hostname + ':' + this.port + '/echo'
      console.log('startconnection')
      // eslint-disable-next-line no-undef
      this.transport = new WebTransport(url)
      this.transport.closed
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
  
      await this.transport.ready
      console.log('webtransport is ready', this.transport)
      this.echoTestsConnection()
    }
  
    async echoTestsConnection() {
      // some echo tests for testing the webtransport library, not for production
      const stream = await this.transport.createBidirectionalStream()
      const writer = stream.writable.getWriter()
      const data1 = new Uint8Array([65, 66, 67])
      const data2 = new Uint8Array([68, 69, 70])
      writer.write(data1)
      writer.write(data2)
      try {
        await writer.close()
        console.log('All data has been sent.')
      } catch (error) {
        console.error(`An error occurred: ${error}`)
      }
      const reader = stream.readable.getReader()
      let i = 2
      while (true && i > 0) {
        const { done, value } = await reader.read()
        if (done) {
          break
        }
        // value is a Uint8Array
        console.log(value)
        i--
      }
      console.log('webtransport sending bidistream success')
      const bidiReader = this.transport.incomingBidirectionalStreams.getReader()
      const incombidi = await bidiReader.read()
      if (incombidi.value) {
        const bidistream = incombidi.value
        console.log('got a bidistream')
        const write = bidistream.writable.getWriter()
        const data3 = new Uint8Array([71, 72, 73])
        const data4 = new Uint8Array([74, 75, 76])
        write.write(data3)
        write.write(data4)
        try {
          await write.close()
          console.log('All data has been sent for incoming bidi stream.')
        } catch (error) {
          console.error(`An error occurred: ${error}`)
        }
        const readbd = bidistream.readable.getReader()
        let i = 2
        while (true && i > 0) {
          const { done, value } = await readbd.read()
          if (done) {
            break
          }
          // value is a Uint8Array
          console.log('incom bd', value)
          i--
        }
      }
      console.log('now unidirectional tests')
      const unidioutstream = await this.transport.createUnidirectionalStream()
      const unidiwrite = unidioutstream.getWriter()
      const data5 = new Uint8Array([77, 78, 79])
      const data6 = new Uint8Array([80, 81, 82])
      unidiwrite.write(data5)
      unidiwrite.write(data6)
      const unidiReader = this.transport.incomingUnidirectionalStreams.getReader()
      const incomunidi = await unidiReader.read()
      if (incomunidi.value) {
        const unidistream = incomunidi.value
        console.log('got a unidistream')
        const readud = unidistream.getReader()
        let i = 2
        while (true && i > 0) {
          const { done, value } = await readud.read()
          if (done) {
            break
          }
          // value is a Uint8Array
          console.log('incom ud', value)
          i--
        }
      }
      console.log('finally test datagrams')
      const datawrite = await this.transport.datagrams.writable.getWriter()
      const data7 = new Uint8Array([83, 84, 85])
      const data8 = new Uint8Array([86, 87, 88])
      datawrite.write(data7)
      datawrite.write(data8)
      const readdg = await this.transport.datagrams.readable.getReader()
      i = 10
      while (true && i > 0) {
        const { done, value } = await readdg.read()
        if (done) {
          break
        }
        // value is a Uint8Array
        console.log('incom dg', value)
        i--
      }
    }
  }
  