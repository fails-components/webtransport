// Copyright (c) 2022 Marten Richter or other contributers (see commit). All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

/**
 * @param {import('../lib/dom').WebTransport} session
 */
export async function incomingBidirectionalEchoTest(session) {
  try {
    const bidiReader = session.incomingBidirectionalStreams.getReader()
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
    console.log('incoming bidiReader exited with', error)
  }
}

/**
 * @param {import('../lib/dom').WebTransport} session
 */
export async function outgoingBidirectionalEchoTest(session) {
  try {
    const mybidistream = await session.createBidirectionalStream()
    await mybidistream.readable.pipeTo(mybidistream.writable)
  } catch (error) {
    console.log('outgoing bidiReader exited with', error)
  }
}

/**
 * @param {import('../lib/dom').WebTransport} session
 */
export async function unidirectionalEchoTest(session) {
  try {
    const unidiReader = session.incomingUnidirectionalStreams.getReader()
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
        const uniwritable = await session.createUnidirectionalStream()
        await unidistream.pipeTo(uniwritable)
        console.log('unidiReader finished piping')
      }
    }
  } catch (error) {
    console.log('unidiReader exited with', error)
  }
}

/**
 * @param {import('../lib/dom').WebTransport} session
 */
export async function datagramEchoTest(session) {
  try {
    session.datagrams.readable.pipeTo(session.datagrams.writable)
  } catch (error) {
    console.log('datagram echo exited with', error)
  }
}

/**
 * @param {import('../lib').Http3Server} server
 */
export async function runEchoServer(server) {
  try {
    const sessionStream = await server.sessionStream('/echo')
    const sessionReader = sessionStream.getReader()
    while (true) {
      const { done, value } = await sessionReader.read()
      if (done) {
        console.log('Server is gone')
        break
      }
      console.log('got a newsession')
      await value.ready
      console.log('server session is ready')
      const helpfunc = async () => {
        try {
          const err = await value.closed
          console.log('server session was closed', err)
        } catch (error) {
          console.log('server session close error:', error)
        }
      }
      helpfunc()
      // install BidirectionalEchoTest
      incomingBidirectionalEchoTest(value)
      // now send a bidirectional stream out
      outgoingBidirectionalEchoTest(value)
      unidirectionalEchoTest(value)
      console.log('install datagram echo')
      datagramEchoTest(value)
    }
  } catch (error) {
    console.log('problem in runEchoServer', error)
  }
}

/**
 * @param {ArrayLike<any>} array1
 * @param {ArrayLike<any>} array2
 */
function testArraysEqual(array1, array2) {
  if (array1.length !== array2.length)
    throw new Error('Array not equal in length')
  for (let i = 0; i < array1.length; i++) {
    if (array1[i] !== array2[i]) throw new Error('Array not equal in value')
  }
}

/**
 * @param {import('../lib/dom').WebTransport} transport
 */
export async function echoTestsConnection(transport) {
  // some echo tests for testing the webtransport library, not for production
  const stream = await transport.createBidirectionalStream()
  const writer = stream.writable.getWriter()
  const data1 = new Uint8Array([65, 66, 67])
  const data2 = new Uint8Array([68, 69, 70])
  writer.write(data1)
  writer.write(data2)
  const reader = stream.readable.getReader()
  let i = data1.length + data2.length
  let pos = 0
  const refArray1 = new Uint8Array(i)
  refArray1.set(data1)
  refArray1.set(data2, data1.length)

  const resultArray1 = new Uint8Array(i)
  console.log('TEST 1: start')

  while (true && i > 0) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }
    // value is a Uint8Array
    console.log('incoming bidi stream', value, Date.now())
    resultArray1.set(value, pos)
    i -= value.length
    pos += value.length
  }
  console.log('all bidi received, next close writer')
  try {
    await writer.close()
    console.log('All data has been sent.')
  } catch (error) {
    console.error(`An error occurred: ${error}`)
    throw new Error('outgoing bidi stream test failed')
  }
  console.log('next close reader')
  try {
    await reader.cancel(0)
    console.log('All data has been read.')
  } catch (error) {
    console.error(`An error occurred: ${error}`)
    throw new Error('outgoing bidi stream test failed')
  }
  testArraysEqual(refArray1, resultArray1)

  console.log('webtransport sending bidistream success')
  console.log('TEST 1: finish')
  console.log('TEST 2: start')
  const bidiReader = transport.incomingBidirectionalStreams.getReader()
  const incombidi = await bidiReader.read()
  if (incombidi.value) {
    const bidistream = incombidi.value
    console.log('got a bidistream')
    const write = bidistream.writable.getWriter()
    const data3 = new Uint8Array([71, 72, 73])
    const data4 = new Uint8Array([74, 75, 76])
    write.write(data3)
    write.write(data4)

    const readbd = bidistream.readable.getReader()
    let i = data3.length + data4.length
    let pos = 0

    const refArray2 = new Uint8Array(i)
    refArray2.set(data3)
    refArray2.set(data4, data3.length)

    const resultArray2 = new Uint8Array(i)
    while (true && i > 0) {
      const { done, value } = await readbd.read()
      if (done) {
        break
      }
      // value is a Uint8Array
      console.log('incom bd', value, Date.now())
      resultArray2.set(value, pos)
      i -= value.length
      pos += value.length
    }
    try {
      await write.close()
      console.log('All data has been sent for incoming bidi stream.')
    } catch (error) {
      console.error(`An error occurred: ${error}`)
      throw new Error('incoming bidi stream test failed')
    }
    try {
      await readbd.cancel(0)
      console.log('All data has been read for incoming bidi stream.')
    } catch (error) {
      console.error(`An error occurred: ${error}`)
      throw new Error('outgoing bidi stream test failed')
    }
    testArraysEqual(refArray2, resultArray2)
  }
  console.log('TEST 2: finish')

  console.log('TEST 3: start')
  console.log('now unidirectional tests')
  const unidioutstream = await transport.createUnidirectionalStream()
  const unidiwrite = unidioutstream.getWriter()
  const data5 = new Uint8Array([77, 78, 79])
  const data6 = new Uint8Array([80, 81, 82])
  unidiwrite.write(data5)
  unidiwrite.write(data6)
  const unidiReader = transport.incomingUnidirectionalStreams.getReader()
  const incomunidi = await unidiReader.read()

  i = data5.length + data6.length

  const refArray3 = new Uint8Array(i)
  refArray3.set(data5)
  refArray3.set(data6, data5.length)

  let readud

  if (incomunidi.value) {
    const unidistream = incomunidi.value
    console.log('got a unidistream')
    readud = unidistream.getReader()
    let pos = 0

    const resultArray3 = new Uint8Array(i)

    while (true && i > 0) {
      const { done, value } = await readud.read()
      if (done) {
        break
      }
      // value is a Uint8Array
      console.log('incom ud', value, Date.now())
      resultArray3.set(value, pos)
      i -= value.length
      pos += value.length
    }
    testArraysEqual(refArray3, resultArray3)
  }
  try {
    await unidiwrite.close()
    console.log('All data has been sent for incoming unidi stream.')
  } catch (error) {
    console.error(`An error occurred: ${error}`)
    throw new Error('incoming unidi stream test failed')
  }
  if (readud) {
    try {
      await readud.cancel(0)
      console.log('All data has been read for incoming unidi stream.')
    } catch (error) {
      console.error(`An error occurred: ${error}`)
      throw new Error('incoming unidi stream test failed')
    }
  }
  console.log('TEST 3: finish')
  console.log('TEST 4: start')
  console.log('finally test datagrams')
  const datawrite = await transport.datagrams.writable.getWriter()
  const data7 = new Uint8Array([83, 84, 85])
  const data8 = new Uint8Array([86, 87, 88])

  i = data7.length + data8.length
  const refArray4 = new Uint8Array(i)
  refArray4.set(data7)
  refArray4.set(data8, data7.length)

  datawrite.write(data7)
  datawrite.write(data8)
  const readdg = await transport.datagrams.readable.getReader()
  pos = 0
  const resultArray4 = new Uint8Array(i)

  while (true && i > 0) {
    const { done, value } = await readdg.read()
    if (done) {
      break
    }
    // value is a Uint8Array
    console.log('incom dg', value, Date.now())
    resultArray4.set(value, pos)
    i -= value.length
    pos += value.length
  }
  testArraysEqual(refArray4, resultArray4)
  try {
    await datawrite.close()
    console.log('All data has been sent for datagram stream.')
  } catch (error) {
    console.error(`An error occurred: ${error}`)
    throw new Error('datagram stream test failed')
  }
  console.log('test datagrams finished')
  console.log('TEST 4: finish')
  console.log('start close stream tests')
}
