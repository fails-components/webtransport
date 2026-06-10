/**
 * @typedef {import('../dom.js').WebTransportSendGroup} WebTransportSendGroup
 * @typedef {import('../dom.js').WebTransportSendStreamOptions} WebTransportSendStreamOptions
 */
import { Http3WebTransportStream } from './stream.js'
import { logger } from '../utils.js'
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
          processnextTick(() => {
            if (Number(headers[':status']) === 200) {
              const beReady = {}
              if (stream && headers['wt-protocol']) {
                // @ts-ignore
                beReady.protocol = headers['wt-protocol']
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
   * @param {{ code: number, reason: string }} arg
   */
  close({ code, reason }) {
    this.session.close({ code, reason })
    // should also close the stream
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
}
