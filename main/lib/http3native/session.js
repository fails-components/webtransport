/**
 * @typedef {import('../dom.js').WebTransportSendGroup} WebTransportSendGroup
 * @typedef {import('../dom.js').WebTransportSendStreamOptions} WebTransportSendStreamOptions
 */
import { Http3WebTransportStream } from './stream.js'
import { logger } from '../utils.js'
import { lengthVarInt } from '../http2/parserbase.js'
import { writeVarInt, readVarInt } from '../http2/parserbasehttp2.js'
const pid = typeof process !== 'undefined' ? process.pid : 0
const log = logger(`webtransport:http3webtransportsession(${pid})`)

let processnextTick = (/** @type {{ (args: any[]): any }} */ func) =>
  setTimeout(func, 0)

export class Http3WebTransportSession {
  /**
   * @param {{stream: QuicStream, session: QuicSession, isclient:boolean, headersReceivedProm?: Promise<void>,
   *  initialStreamSendWindowOffset: number}} args
   * */
  constructor({
    stream,
    session,
    isclient,
    headersReceivedProm,
    initialStreamSendWindowOffset
  }) {
    /** @type {import('../session').HttpWTSession} */
    // @ts-ignore
    this.jsobj = undefined // the creator will set this
    this.stream = stream
    this.session = session
    this.isclient = isclient
    this.initialStreamSendWindowOffset = initialStreamSendWindowOffset
    if (isclient) {
      headersReceivedProm
        .then((headers) => {
          if (Number(headers[':status']) === 200) {
            const beReady = {}
            if (stream && headers['wt-protocol']) {
              const match = headers['wt-protocol'].match(/\s*"([^"]+)"\s*/)
              if (match) {
                // @ts-ignore
                beReady.protocol = match[1]
              }
            }
            // on ready
            this.jsobj.onReady(beReady)
          } else {
            this.jsobj.onClose({
              errorcode: headers[':status'],
              error: 'Session stream errored'
            })
          }
        })
        .catch((error) => {
          this.jsobj.onClose({
            errorcode: 500, // fix the number
            error: 'Session stream errored:' + error
          })
        })
    } else {
      processnextTick(() => {
        this.jsobj.onReady({})
      })
    }
    this.session.onerror = () => {
      // @ts-ignore
      if (session.jsobj?.state === 'connecting') {
        session.jsobj.onClientConnected({
          success: false
        })
      } else {
        /* session.close({
          code: 0,
          reason: 'Session stream error'
        })*/
      }
    }
    this.session.onstream = (stream) => {
      stream.onheaders = (headers) => {
        if (isclient) {
          // well we do not support this kind of response
          // actually it should not happen on client side
          stream.destroy({
            reason:
              'Streams, which are not webtransport initiated by server are unsupported'
          })
        } else {
          // currently it is not supported the other way round either, if we have already a session
          stream.destroy({
            reason:
              'Streams, for additional request than the current session are not supported'
          })
        }
      }
      stream.onsessionid = (sessionid) => {
        // deinstall handlers
        stream.onheaders = undefined
        stream.onsessionid = undefined
        if (sessionid === this.stream.id) {
          try {
            const jsstream = new Http3WebTransportStream({
              stream,
              unidirectional: stream.direction === 'uni',
              incoming: true
            })
            this.jsobj.onStream({
              bidirectional: stream.direction !== 'uni',
              incoming: true,
              stream: jsstream,
              sendGroupId: 0n,
              sendOrder: 0
            })
          } catch (error) {
            log('Error receiving wt stream:', error)
          }
        } else {
          stream.destroy({
            reason: 'Only one session is supported'
          })
        }
      }
    }

    /**
     * @param {number} code
     * @param {string|undefined} reason
     *
     * */
    this.stream.onwtsessionclose = (code, reason) => {
      this.jsobj.onClose({
        errorcode: code,
        error: reason ?? ''
      })
    }

    this.stream.onerror = () => {
      // @ts-ignore
      if (this.jsobj?.state === 'connecting') {
        this.jsobj.onClientConnected({
          success: false
        })
      } else {
        this.close({
          code: 0,
          reason: 'Session stream error'
        })
      }
    }
    /**
     * @param {Uint8Array} datagram
     *
     * */
    this.session.ondatagram = (datagram) => {
      const buffer = {
        offset: 0,
        buffer: Buffer.from(datagram.buffer),
        size: datagram.byteLength
      }
      const sessionId = readVarInt(buffer)
      if (sessionId !== this.stream.id / 4n) return
      this.jsobj.onDatagramReceived({
        datagram: new Uint8Array(
          datagram.buffer,
          buffer.offset,
          datagram.byteLength - buffer.offset
        )
      })
    }
    /** @type {Array<{sendOrder: number, sendGroupId: bigint}>} */
    this.orderUniStreams = []
    /** @type {Array<{sendOrder: number, sendGroupId: bigint}>} */
    this.orderBiStreams = []
  }

  /**
   * @param {WebTransportSendStreamOptions} opts
   */
  orderBidiStream({ sendGroup, sendOrder, waitUntilAvailable }) {
    // must be replaced with mechanism for flow control
    // const canopen = this.streamIdMngrBi.canOpenNextOutgoingStream()
    // const maxset = this.streamIdMngrBi.isMaxStreamSet() // we block if the maxsetting did not arrive

    if (!this.stream.session) return false // session has been destroyed

    // eslint-disable-next-line no-constant-condition
    if (/* canopen || */ waitUntilAvailable /* || !maxset */ || true) {
      this.stream.session
        .createBidirectionalStream({
          incremental: true,
          highWaterMark: this.initialStreamSendWindowOffset,
          webtransportSession: this.stream /* that is the session stream */
        })
        .then((/** @type {QuicStream} */ qstream) => {
          const stream = new Http3WebTransportStream({
            stream: qstream,
            unidirectional: false,
            incoming: false
          })
          this.jsobj.onStream({
            bidirectional: true,
            incoming: false,
            stream,
            // @ts-ignore
            sendGroupId: sendGroup?._sendGroupId || 0n,
            sendOrder: sendOrder ?? 0
          })
        })
        .catch((error) => {
          log('error creating bidirectional stream', error)
        })
      return true
    }
    return false
  }

  /**
   * @param {WebTransportSendStreamOptions} opts
   */
  orderUnidiStream({ sendGroup, sendOrder, waitUntilAvailable }) {
    // must be replaced with mechanism for flow control
    // const canopen = this.streamIdMngrUni.canOpenNextOutgoingStream()
    // const maxset = this.streamIdMngrUni.isMaxStreamSet() // we block if the maxsetting did not arrive

    if (!this.stream.session) return false // session has been destroyed

    // eslint-disable-next-line no-constant-condition
    if (/* canopen || */ waitUntilAvailable /* || !maxset */ || true) {
      this.stream.session
        .createUnidirectionalStream({
          incremental: true,
          highWaterMark: this.initialStreamSendWindowOffset,
          webtransportSession: this.stream /* that is the session stream */
        })
        .then((/** @type {QuicStream} */ qstream) => {
          const stream = new Http3WebTransportStream({
            stream: qstream,
            unidirectional: true,
            incoming: false
          })
          this.jsobj.onStream({
            bidirectional: false,
            incoming: false,
            stream,
            // @ts-ignore
            sendGroupId: sendGroup?._sendGroupId || 0n,
            sendOrder: sendOrder ?? 0
          })
        })
        .catch((error) => {
          log('error creating bidirectional stream', error)
        })
      return true
    }
    return false
  }

  orderSessionStats() {
    const stats = this.session.stats
    this.jsobj.onSessionStats({
      timestamp: 0,
      expiredOutgoing: 0n,
      lostOutgoing: stats.datagramsLost,
      // non Datagram
      minRtt: stats.minRtt,
      smoothedRtt: stats.smoothedRtt,
      rttVariation: stats.rttVar,
      estimatedSendRateBps: 0n
    })
  }

  orderDatagramStats() {
    const stats = this.session.stats
    this.jsobj.onDatagramStats({
      timestamp: 0,
      expiredOutgoing: 0n,
      lostOutgoing: stats.datagramsLost
    })
  }

  getMaxDatagramSize() {
    return Number(this.session.remoteTransportParams?.maxDatagramFrameSize)
  }

  /**
   * @param {Uint8Array} chunk
   * @return {Promise<{ code: "success" | "blocked" | "internalError" | "tooBig", message?: string | undefined; }>}
   */
  async writeDatagram(chunk) {
    if (chunk.byteLength > this.getMaxDatagramSize()) return { code: 'tooBig' }
    const sessionId = this.stream.id / 4n // quarter stream id
    const byteLengthSessId = lengthVarInt(sessionId)
    // in case, node js changes handling of datagrams we can remove the varint stuff
    const toSend = new Uint8Array(chunk.byteLength + byteLengthSessId)
    writeVarInt(
      { offset: 0, buffer: Buffer.from(toSend.buffer), size: byteLengthSessId },
      sessionId
    )

    const dest = new Uint8Array(toSend.buffer, byteLengthSessId)
    dest.set(chunk) // copy over

    this.session.sendDatagram(toSend)
    // FIX me may be report errors
    return { code: 'success' }
  }

  /**
   * @param {{ code: number, reason: string }} arg
   */
  close({ code, reason }) {
    this.stream.closeWebtransportSessionStream(code, reason)
    this.stream.closed
      .then(() => {
        this.session.close({ code, reason })
      })
      .catch(() => {
        this.session.close({ code, reason })
      })
  }

  /**
   * @param {{ code: number, reason: string }} arg
   */
  closeConnection({ code, reason }) {
    // called in case of failure in parsing or flowcontrol
    this.jsobj.onClose({
      errorcode: code,
      error: reason
    })
    this.close({ code, reason })
  }

  /*
   * @returns {void}
   */
  notifySessionDraining() {}
}
