import { ReadableStream, WritableStream } from './webstreams.js'
import {
  HttpWTStream,
  kErrorReceiveStream,
  kErrorSendStream
} from './stream.js'
import { WebTransportError } from './error.js'
import { logger } from './utils.js'
import { canByteStream } from './features.js'
import { readVarInt, writeVarInt, lengthVarInt } from './http2/bufferHelper.js'

const pid = typeof process !== 'undefined' ? process.pid : 0
const log = logger(`webtransport:httpwtsession(${pid})`)

/**
 * WebTransport session events
 * @typedef {import('./types').SessionReadyEvent} SessionReadyEvent
 * @typedef {import('./types').SessionCloseEvent} SessionCloseEvent
 * @typedef {import('./types').DatagramReceivedEvent} DatagramReceivedEvent
 * @typedef {import('./types').NativeWebTransportStream} NativeWebTransportStream
 * @typedef {import('./types').NativeWebTransportSessionStreamCreator} NativeWebTransportSessionStreamCreator
 * @typedef {import('./types').NativeWebTransportSessionControl} NativeWebTransportSessionControl
 * @typedef {import('./types').WebTransportSessionState} WebTransportSessionState
 *
 * @typedef {import('./dom').WebTransportCloseInfo} WebTransportCloseInfo
 * @typedef {import('./dom').WebTransportBidirectionalStream} WebTransportBidirectionalStream
 * @typedef {import('./dom').WebTransportSendStream} WebTransportSendStream
 * @typedef {import('./dom').WebTransportSendStreamOptions} WebTransportSendStreamOptions
 * @typedef {import('./dom').WebTransportReceiveStream} WebTransportReceiveStream
 * @typedef {import('./dom').WebTransportDatagramDuplexStream} WebTransportDatagramDuplexStream
 * @typedef {import('./dom').WebTransportReliabilityMode} WebTransportReliabilityMode
 * @typedef {import('./dom').WebTransportCongestionControl} WebTransportCongestionControl
 * @typedef {import('./dom').WebTransportSendGroup} WebTransportSendGroup
 * @typedef {import('./dom').WebTransportConnectionStats} WebTransportConnectionStats
 * @typedef {import('./dom').WebTransportDatagramStats} WebTransportDatagramStats
 * @typedef {import('./dom').WebTransportSendOptions} WebTransportSendOptions
 * @typedef {import('./dom').WebTransportDatagramsWritable} WebTransportDatagramsWritable
 * @typedef {import('./dom').DatagramsReadableMode} DatagramsReadableMode
 *
 * @typedef {import('./types').NativeHttpWTSession} NativeHttpWTSession
 *
 * Public API
 * @typedef {import('./dom').WebTransportSession} WebTransportSession
 *
 * @typedef {import('./server').HttpServer} HttpServer
 * @typedef {import('./client').HttpClient} HttpClient
 *
 * @typedef {import('stream/web').WritableStreamDefaultController} WritableStreamDefaultController
 */

/**
 * @typedef {Object} StreamControl
 * @property {(streamobj: HttpWTStream) => void} addSendStream
 * @property {(streamobj: HttpWTStream) => void} removeSendStream
 * @property {(streamobj: HttpWTStream) => void} addReceiveStream
 * @property {(streamobj: HttpWTStream) => void} removeReceiveStream
 * @property {import('./types').WebTransportSessionState} state
 */

export const konClose = Symbol('konClose')
export const konInitialError = Symbol('konInitialError')
export const kState = Symbol('kState')
export const kSetCloseHook = Symbol('kSetCloseHook')
export const kSendGroupId = Symbol('kSendGroupId')

/**
 * @implements {WebTransportSession}
 */
export class HttpWTSession {
  #inner = {
    __proto__: null,

    /** @type {HttpServer | HttpClient | undefined} */
    parentobj: undefined,

    /** @type {NativeWebTransportSessionStreamCreator|undefined} */
    streamCreator: undefined,
    /** @type {NativeWebTransportSessionControl|undefined} */
    sessionControl: undefined,

    /** @type {undefined|StreamControl} */
    streamControl: undefined,
    /** @type {(() => void) | null | undefined} */
    closeHook: null,

    isclient: false,
    /** @type {WebTransportSessionState} */
    state: 'connecting',
    /** @type {WebTransportReliabilityMode} */
    reliability: 'pending',
    /** @type {WebTransportCongestionControl} */
    congestionControl: 'default',

    /** @type {(string | undefined)} */
    peerAddress: undefined,
    /** @type {number|undefined} */
    sendBudget: undefined,
    /** @type {(Object | undefined)} */
    responseHeader: undefined,
    /** @type {(Object | undefined)} */
    header: undefined,
    /** @type {(Object | undefined)} */
    userData: undefined,
    /** @type {"bytes" | undefined} */
    datagramsReadableMode: undefined,

    /** @type {WebTransportDatagramsWritable| undefined} */
    datagramWritablePolyfilled: undefined,
    /** @type {PromiseWithResolvers<void>} */
    ready: Promise.withResolvers(),
    /** @type {PromiseWithResolvers<WebTransportCloseInfo>} */
    closed: Promise.withResolvers(),
    /** @type {PromiseWithResolvers<void>} */
    draining: Promise.withResolvers(),

    /** @type {Set<HttpWTStream>} */
    sendStreams: new Set(),
    /** @type {Set<HttpWTStream>} */
    receiveStreams: new Set(),

    /** @type {WebTransportDatagramDuplexStream|undefined} */
    datagrams: undefined,
    /** @type {import("stream/web").ReadableByteStreamController | undefined} */
    incomDatagramControllerBytes: undefined,
    /** @type {import("stream/web").ReadableStreamController<Uint8Array> | undefined} */
    incomDatagramController: undefined,
    lastGetMaxDatagramSize: 0,
    /** @type {PromiseWithResolvers<WebTransportBidirectionalStream>[]} */
    promBiDi: [],
    /** @type {PromiseWithResolvers<WebTransportSendStream>[]} */
    promUniDi: [],
    /** @type {ReadableStreamDefaultController<WebTransportBidirectionalStream>|undefined} */
    incomBiDiController: undefined,
    /** @type {ReadableStreamDefaultController<WebTransportReceiveStream>|undefined} */
    incomUniDiController: undefined,
    /** @type {ReadableStream<WebTransportBidirectionalStream>|undefined} */
    incomingBidirectionalStreams: undefined,
    /** @type {ReadableStream<WebTransportReceiveStream>|undefined} */
    incomingUnidirectionalStreams: undefined,

    sendGroupNum: 1n, // 0n is reserved for no sendgroup
    /** @type {Map<bigint,WebTransportSendGroup>} */
    sendGroupIndex: new Map(),
    /** @type {string|undefined} */
    selectedProtocol: undefined
  }

  /**
   * @param {object} args
   * @param {import('./types').NativeHttpWTSession} [args.object]
   * @param {NativeWebTransportSessionStreamCreator} [args.creator]
   * @param {NativeWebTransportSessionControl} [args.control]
   * @param {HttpServer | HttpClient} args.parentobj
   * @param {Object | undefined} [args.header= undefined]
   * @param {Object | undefined} [args.userData= undefined]
   * @param {string | undefined} [args.peerAddress= undefined]
   * @param {DatagramsReadableMode} [args.datagramsReadableMode]
   * @param {number} args.sendBudget
   */
  constructor(args) {
    const inner = this.#inner

    if (args.control && args.creator) {
      this.setSessionObj({
        control: args.control,
        creator: args.creator,
        isclient: false,
        sendBudget: args.sendBudget || 16 * 1024 // 16 KB
      })
    }
    inner.parentobj = args.parentobj

    /** @type {(Object | null | undefined)} */
    inner.header = args.header
    /** @type {(Object | null | undefined)} */
    inner.userData = args.userData

    /** @type {(string | undefined)} */
    inner.peerAddress = args.peerAddress

    inner.datagramsReadableMode = args.datagramsReadableMode

    /** @type {ReadableStream<WebTransportBidirectionalStream>} */
    // @ts-ignore
    inner.incomingBidirectionalStreams = new ReadableStream({
      /** @param {ReadableStreamDefaultController<WebTransportBidirectionalStream>} controller */
      start: (controller) => {
        inner.incomBiDiController = controller
      }
    })
    /** @type {ReadableStream<WebTransportReceiveStream>} */
    // @ts-ignore
    inner.incomingUnidirectionalStreams = new ReadableStream({
      /** @param {ReadableStreamDefaultController<WebTransportReceiveStream>} controller */
      start: (controller) => {
        inner.incomUniDiController = controller
      }
    })

    const readableopts = {
      start: (
        /** @type {import("stream/web").ReadableByteStreamController | import("stream/web").ReadableStreamController<Uint8Array>} */ controller
      ) => {
        if (inner.datagramsReadableMode === 'bytes') {
          inner.incomDatagramControllerBytes =
            /** @type {import("stream/web").ReadableByteStreamController} */ (
              controller
            )
        } else {
          inner.incomDatagramController =
            /** @type {import("stream/web").ReadableStreamController<Uint8Array>} */ (
              controller
            )
        }
      },
      /** @type {undefined | 'bytes'} */
      type: undefined
    }
    if (inner.datagramsReadableMode === 'bytes') {
      readableopts.type = 'bytes'
    }
    if (!canByteStream) {
      // @ts-ignore
      delete readableopts.type
    }
    const getMaxDatagramSize = function () {
      inner.lastGetMaxDatagramSize = Number(
        inner.streamCreator?.remoteTransportParams?.maxDatagramFrameSize ||
          inner.lastGetMaxDatagramSize
      )
      return inner.lastGetMaxDatagramSize
    }
    inner.datagrams = {
      /** @type {ReadableStream<Uint8Array>} */
      // @ts-ignore
      readable: new ReadableStream(readableopts),
      /**
       *  @param {WebTransportSendOptions|undefined} options
       *  @return {import('./dom').WebTransportDatagramsWritable}
       */
      createWritable: (options) => {
        let sendOrder = options?.sendOrder ?? 0
        let sendGroup = options?.sendGroup
        /** @type {WebTransportSendStream} */
        // @ts-expect-error some props are initially missing
        const retWritable = new WritableStream({
          // eslint-disable-next-line no-unused-vars
          start: (controller) => {
            //inner.outgoDatagramController = controller
          },
          // eslint-disable-next-line no-unused-vars
          write: async (chunk, controller) => {
            if (inner.state === 'closed') throw new Error('Session is closed')
            if (chunk instanceof Uint8Array) {
              if (
                inner.streamCreator &&
                'applicationOptions' in inner.streamCreator
              ) {
                // workaround to be removed
                if (chunk.byteLength > getMaxDatagramSize())
                  throw new WebTransportError('DatagramSize is too big')
                const sessionId = (inner.sessionControl?.id ?? 0n) / 4n // quarter stream id
                const byteLengthSessId = lengthVarInt(sessionId)
                // in case, node js changes handling of datagrams we can remove the varint stuff
                const toSend = new Uint8Array(
                  chunk.byteLength + byteLengthSessId
                )
                writeVarInt(
                  {
                    offset: 0,
                    buffer: [toSend],
                    size: byteLengthSessId,
                    curBuf: 0,
                    curBufOffset: 0
                  },
                  sessionId
                )

                const dest = new Uint8Array(toSend.buffer, byteLengthSessId)
                dest.set(chunk) // copy over
                inner.streamCreator.sendDatagram(toSend)
                return
              }
              inner.sessionControl?.sendDatagram(chunk)
            } else throw new Error('chunk is not of type Uint8Array')
          },
          close: () => {
            // do nothing
          }
        })
        Object.defineProperties(retWritable, {
          sendOrder: {
            get: () => {
              return sendOrder
            },
            /**
             * @param {number} value
             */
            set: (value) => {
              sendOrder = value
            }
          },
          sendGroup: {
            get: () => {
              return sendGroup
            },
            /**
             * @param {WebTransportSendGroup} value
             */
            set: (value) => {
              if (value !== sendGroup) {
                sendGroup = value
              }
            }
          }
        })
        return retWritable
      },
      // @ts-ignore
      get writable() {
        if (!inner.datagramWritablePolyfilled) {
          console.warn('datagrams.writable is deprecated')
        }
        return (inner.datagramWritablePolyfilled ||= this.createWritable())
      },
      get maxDatagramSize() {
        // @ts-ignore
        return getMaxDatagramSize()
      }
    }
  }

  /**
   * @param {{ code: number, reason: string }} arg
   */
  closeInt({ code, reason }) {
    const inner = this.#inner
    if (!inner.sessionControl || !inner.streamCreator)
      throw new Error('Neither sessionControl nor streamCreator set')
    const creator = inner.streamCreator
    // FIXME should be inner
    inner.sessionControl.closeWebtransportSessionStream(code, reason)
    inner.sessionControl.closed
      .then(() => {
        // a server can have multiple wt sessions
        if (inner.isclient) creator.close({ code, reason })
      })
      .catch(() => {
        // a server can have multiple wt sessions
        if (inner.isclient) creator.close({ code, reason })
      })
  }

  /**
   * @param {object} args
   * @param {NativeWebTransportSessionControl} args.control
   * @param {NativeWebTransportSessionStreamCreator} args.creator
   * @param {boolean} [args.reliable]
   * @param {object} [args.responseHeader]
   * @param {boolean} args.isclient
   * @param {number} args.sendBudget
   */
  setSessionObj({
    reliable,
    responseHeader,
    control,
    creator,
    isclient,
    sendBudget
  }) {
    const inner = this.#inner
    inner.isclient = isclient
    if (creator && control) {
      inner.streamCreator = creator
      inner.sessionControl = control
      inner.sendBudget = sendBudget
      if (typeof reliable !== 'undefined') {
        inner.reliability = reliable ? 'reliable-only' : 'supports-unreliable'
      }
      if (typeof responseHeader !== 'undefined')
        inner.responseHeader = responseHeader
      // FIX ME
      /* if (this.objint.sendInitialParameters) {
        this.objint.sendInitialParameters()
      } */
      // install various handlers
      const session = this

      creator.onerror = () => {
        if (inner.state === 'connecting') {
          // TODO
          if (inner.parentobj && 'onClientConnected' in inner.parentobj)
            // only for clients
            inner.parentobj?.onClientConnected({
              success: false
            })
        }
      }
      creator.ongoaway = () => {
        if (inner.state === 'closed' || inner.state === 'failed') return // no sense to drain with no connection
        inner.draining.resolve(undefined)
        inner.state = 'draining'
      }
      creator.onstream = (stream) => {
        stream.onheaders = () => {
          // well we do not support this kind of response
          // actually it should not happen on client side
          // currently it is not supported the other way round either, if we have already a session
          stream.destroy({
            reason:
              'Additional non wt streams, either initiated by server are unsupported, or for a second session client side are unsupported'
          })
        }
        stream.onsessionid = (sessionid) => {
          // deinstall handlers
          stream.onheaders = undefined
          stream.onsessionid = undefined
          if (sessionid === control.id) {
            try {
              setTimeout(() => {
                session.#onStream({
                  bidirectional: stream.direction !== 'uni',
                  incoming: true,
                  stream: stream,
                  sendGroupId: stream.sendGroupId ?? 0n,
                  sendOrder: stream.sendOrder ?? 0
                })
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
      control.onwtsessionclose = (code, reason) => {
        if (!(inner.state === 'failed' || inner.state === 'closed')) {
          session[konClose]({
            errorcode: code,
            error: reason ?? ''
          })
        }
      }
      // @ts-ignore
      if (control !== creator)
        control.onerror = () => {
          // @ts-ignore
          if (
            inner.state === 'connecting' &&
            inner.parentobj &&
            'onClientConnected' in inner.parentobj
          ) {
            inner.parentobj.onClientConnected({
              success: false
            })
          } else {
            session.closeInt?.({
              code: 0,
              reason: 'Session stream error'
            })
          }
        }

      if ('applicationOptions' in creator) {
        /**
         * @param {Uint8Array} datagram
         *
         * */
        creator.ondatagram = (datagram) => {
          if ('applicationOptions' in creator) {
            // detect a QuicSession for the workaround
            // This is a workaround and will be soon removed
            const buffer = {
              offset: 0,
              buffer: [datagram],
              size: datagram.byteLength,
              curBuf: 0,
              curBufOffset: 0
            }
            const sessionId = readVarInt(buffer)
            if (control.id === null || sessionId !== control.id / 4n) return
            session.#onDatagramReceived(
              new Uint8Array(
                datagram.buffer,
                buffer.offset + datagram.byteOffset,
                datagram.byteLength - buffer.offset
              )
            )
            return
          }
          // This is the code, that should be kept, or onDatagramReceived should be copied to here
          session.#onDatagramReceived(new Uint8Array(datagram))
        }
      } else {
        /**
         * @param {Uint8Array} datagram
         *
         * */
        control.ondatagram = (datagram) => {
          session.#onDatagramReceived(new Uint8Array(datagram))
        }
      }
    } else {
      throw new Error('Insufficient paramaeters to setSessionObj')
    }
  }

  get protocol() {
    const inner = this.#inner
    if (typeof inner.selectedProtocol === 'undefined') {
      // @ts-ignore
      if (inner.responseHeader?.['wt-protocol']) {
        const match =
          // @ts-ignore
          inner.responseHeader['wt-protocol'].match(/\s*"([^"]+)"\s*/)
        if (match) {
          inner.selectedProtocol = match[1]
        } else {
          inner.selectedProtocol = ''
        }
      }
    }
    if (typeof inner.selectedProtocol === 'undefined') return ''
    return inner.selectedProtocol
  }

  /**
   * @return {Promise<WebTransportConnectionStats>}
   */
  getStats() {
    const inner = this.#inner
    const stats = inner.streamCreator?.stats
    return Promise.resolve({
      datagrams: {
        expiredIncoming: 0n,
        expiredOutgoing: 0n,
        droppedIncoming: 0n,
        lostOutgoing: stats?.datagramsLost || 0n
      },
      // non Datagram
      minRtt: Number(stats?.minRtt || 0),
      smoothedRtt: Number(stats?.smoothedRtt || 0),
      rttVariation: Number(stats?.rttVar || 0),
      estimatedSendRateBps: 0n,
      bytesSent: stats?.bytesSent || 0n,
      bytesReceived: stats?.bytesReceived || 0n,
      atSendCapacity: false
    })
  }

  /**
   * @type {StreamControl}
   */
  get #streamControl() {
    const inner = this.#inner

    if (inner.streamControl) return inner.streamControl

    /**
     * @param {HttpWTStream} streamobj
     */
    const addSendStream = function (streamobj) {
      inner.sendStreams.add(streamobj)
    }

    /**
     * @param {HttpWTStream} streamobj
     */
    const removeSendStream = function (streamobj) {
      inner.sendStreams.delete(streamobj)
    }

    /**
     * @param {HttpWTStream} streamobj
     */
    const addReceiveStream = function (streamobj) {
      inner.receiveStreams.add(streamobj)
    }

    /**
     * @param {HttpWTStream} streamobj
     */
    const removeReceiveStream = function (streamobj) {
      inner.receiveStreams.delete(streamobj)
    }

    const streamControl = (inner.streamControl = {
      addSendStream,
      removeSendStream,
      addReceiveStream,
      removeReceiveStream,
      get state() {
        return inner.state
      }
    })

    return streamControl
  }

  /**
   * @param {WebTransportSendStreamOptions} [opts]
   * @returns {Promise<WebTransportBidirectionalStream>}
   */
  async createBidirectionalStream(opts) {
    const inner = this.#inner
    if (inner.state === 'closed' || inner.state === 'failed')
      throw new DOMException(
        'Session is failed or closed and can not open streams',
        'InvalidStateError'
      )

    const sendGroup = opts?.sendGroup || null // maybe replace, when implemented
    const sendOrder = opts?.sendOrder || 0

    if (!inner.sessionControl || !inner.streamCreator)
      throw new Error('Neither control or creator is set')
    if (!inner.parentobj) throw new Error('Parentobject is not set')
    const stream = await inner.streamCreator.createBidirectionalStream({
      incremental: true,
      waitUntilAvailable: opts?.waitUntilAvailable || false,
      budget: inner.sendBudget || 0,
      // @ts-ignore
      sendGroupId: sendGroup?.[kSendGroupId] || 0n,
      sendOrder: sendOrder ?? 0,
      webtransportSession: inner.sessionControl /* that is the session stream */
    })
    if (stream.pending) {
      await stream.ready
    }

    /** @type {NativeWebTransportStream} */
    let newstream
    newstream = stream
    const strobj = new HttpWTStream({
      object: newstream,
      parentobj: this.#streamControl,
      bidirectional: true,
      incoming: false,
      // @ts-ignore
      sendGroup: inner.sendGroupIndex.get(sendGroup?.[kSendGroupId] || 0n),
      sendOrder: sendOrder
    })
    return strobj
  }

  /**
   * @param {WebTransportSendStreamOptions} [opts]
   * @returns {Promise<WebTransportSendStream>}
   */
  async createUnidirectionalStream(opts) {
    const inner = this.#inner
    if (inner.state === 'closed' || inner.state === 'failed')
      throw new DOMException(
        'Session is failed or closed and can not open streams',
        'InvalidStateError'
      )
    const sendGroup = opts?.sendGroup || null // maybe replace, when implemented
    const sendOrder = opts?.sendOrder || 0

    if (!inner.sessionControl || !inner.streamCreator)
      throw new Error('Neither control or creator is set')
    if (!inner.parentobj) throw new Error('Parentobject is not set')

    const stream = await inner.streamCreator.createUnidirectionalStream({
      incremental: true,
      waitUntilAvailable: opts?.waitUntilAvailable || false,
      budget: inner.sendBudget || 0,
      // @ts-ignore
      sendGroupId: opts?.sendGroup?.[kSendGroupId] || 0n,
      sendOrder: sendOrder ?? 0,
      webtransportSession: inner.sessionControl /* that is the session stream */
    })
    if (stream.pending) {
      await stream.ready
    }

    /** @type {NativeWebTransportStream} */
    let newstream

    newstream = stream
    const strobj = new HttpWTStream({
      object: newstream,
      parentobj: this.#streamControl,
      bidirectional: false,
      incoming: false,
      // @ts-ignore
      sendGroup: inner.sendGroupIndex.get(sendGroup?.[kSendGroupId] || 0n),
      sendOrder: sendOrder
    })
    return strobj.writable
  }

  /**
   * @param {object} [closeInfo]
   * @param {number} closeInfo.closeCode
   * @param {string} closeInfo.reason
   * @returns {void}
   */
  close(closeInfo) {
    const inner = this.#inner
    log('closeinfo', closeInfo)
    if (inner.state === 'closed' || inner.state === 'failed') return
    // TODO move to inner
    this.closeInt?.({
      code: closeInfo?.closeCode ?? 0,
      reason: (closeInfo?.reason ?? '').substring(0, 1023)
    })
  }

  /**
   * @returns {WebTransportSendGroup}
   */
  createSendGroup() {
    const inner = this.#inner
    if (inner.state === 'closed' || inner.state === 'failed')
      throw new Error('InvalidState')
    const sendGroupId = inner.sendGroupNum++
    const sendGroup = {
      [kSendGroupId]: sendGroupId,
      getStats: async () => {
        // TODO implement
        return {
          bytesWritten: 0,
          bytesSent: 0,
          bytesAcknowledged: 0
        }
      }
    }
    inner.sendGroupIndex.set(sendGroupId, sendGroup)
    return sendGroup
  }

  onReady() {
    const inner = this.#inner
    inner.state = 'connected'
    setTimeout(() => {
      // maybe to sth to prevent two times calling ready
      inner.ready.resolve()
    }, 0)
  }

  /**
   * @param {SessionCloseEvent} args
   */
  [konClose](args) {
    const inner = this.#inner
    if (inner.sessionControl) delete inner.sessionControl
    if (inner.streamCreator) delete inner.streamCreator

    if (inner.state !== 'connected' && inner.state !== 'draining') {
      log.error(
        'session was closed before state was "connected" - it was "%s"',
        inner.state
      )
      inner.state = 'failed'

      // make sure the event loop can still exit
      if (inner.closeHook) {
        inner.closeHook()
        delete inner.closeHook
      }

      // closed before connected
      const error = new WebTransportError('Opening handshake failed.')
      inner.ready.reject(error)
      inner.closed.reject(error)
      return
    }

    log('onClose')
    // TODO similar mechanism for Streams
    // this.streamObjs.forEach((ele) => ele.finalDrain())

    const error = new WebTransportError('Session closed')

    for (const prom of inner.promBiDi) prom.reject(error)
    for (const prom of inner.promUniDi) prom.reject(error)

    inner.promBiDi = []
    inner.promUniDi = []

    inner.incomBiDiController?.close()
    inner.incomUniDiController?.close()

    inner.incomDatagramController?.close()
    inner.incomDatagramControllerBytes?.close()

    // this.outgoDatagramController.error(errorcode)
    inner.state = 'closed'

    const wtError = new WebTransportError(
      `Session closed (on process ${pid}) with code ` +
        args.errorcode +
        ' and reason ' +
        args.error
    )

    inner.sendStreams.forEach((stream) => stream[kErrorSendStream](wtError))
    inner.receiveStreams.forEach((ele) => ele[kErrorReceiveStream](wtError))

    inner.sendStreams.clear()
    inner.receiveStreams.clear()
    inner.closed.resolve({
      closeCode: args.errorcode,
      reason: args.error ? args.error : ''
    })
    if (inner.closeHook) {
      inner.closeHook()
      delete inner.closeHook
    }
  }

  /** @param {WebTransportError} error */
  [konInitialError](error) {
    const inner = this.#inner
    inner.ready.reject(error)
    inner.closed.reject(error)
    inner.state = 'failed'
  }

  /**
   * @param {{
   *   stream: NativeWebTransportStream,
   *   bidirectional: boolean,
   *   incoming: true,
   *   sendGroupId?: bigint,
   *   sendOrder: number
   * }} args
   */
  #onStream(args) {
    const inner = this.#inner
    if (inner.state === 'closed' || inner.state === 'failed') {
      log('received stream after session closing')
      if (args.bidirectional || args.incoming) args.stream.stopSending(0)
      if (args.bidirectional || !args.incoming) args.stream.resetStream(0)
      return
    }
    if (!inner.parentobj) return

    const strobj = new HttpWTStream({
      object: args.stream,
      parentobj: this.#streamControl,
      bidirectional: args.bidirectional,
      incoming: args.incoming,
      sendGroup: inner.sendGroupIndex.get(args.sendGroupId || 0n),
      sendOrder: args.sendOrder
    })
    if (args.incoming) {
      if (args.bidirectional) {
        inner.incomBiDiController?.enqueue(strobj)
      } else {
        inner.incomUniDiController?.enqueue(strobj.readable)
      }
    } else {
      if (args.bidirectional) {
        if (inner.promBiDi.length === 0)
          throw new Error('Got bidirectional stream without asking for it')
        const curres = inner.promBiDi.shift()?.resolve

        if (
          curres != null &&
          strobj.readable != null &&
          strobj.writable != null
        ) {
          curres({
            readable: strobj.readable,
            writable: strobj.writable
          })
        }
      } else {
        if (inner.promUniDi.length === 0)
          throw new Error('Got unidirectional stream without asking for it')
        const curres = inner.promUniDi.shift()?.resolve

        if (curres != null && strobj.writable != null) {
          curres(strobj.writable)
        }
      }
    }
  }

  /**
   * @param {Uint8Array} datagram
   */
  #onDatagramReceived(datagram) {
    const inner = this.#inner
    log('datagram received', datagram)
    if (inner.state === 'closed' || inner.state === 'failed') {
      log('datagram dropped, session in wrong state')
      return
    }
    // streams spec says zero length chunk on byob stream is illegal
    if (datagram.byteLength === 0 && inner.datagramsReadableMode === 'bytes') {
      log('zerolength datagram dropped for a byte stream')
      return
    }
    // console.log('datagram received', args.datagram, Date.now())
    if (inner.incomDatagramControllerBytes?.byobRequest) {
      /** @type {ReadableStreamBYOBRequest} */
      const byob = inner.incomDatagramControllerBytes?.byobRequest
      /** @type {Uint8Array} */
      // @ts-ignore
      const view = byob?.view
      // @ts-ignore
      if (!(view instanceof Uint8Array))
        throw new Error('byob view is not a Uint8Array')
      if (view.byteLength < datagram.byteLength) {
        throw new Error('supplied view is not large enough.')
      }
      const destview = new Uint8Array(
        view.buffer,
        0 + view.byteOffset,
        datagram.byteLength
      )
      destview.set(datagram)
      byob.respond(datagram.byteLength)
    } else {
      // only one of them is set
      inner.incomDatagramController?.enqueue(new Uint8Array(datagram))
      inner.incomDatagramControllerBytes?.enqueue(new Uint8Array(datagram))
    }
  }

  get peerAddress() {
    return this.#inner.peerAddress
  }

  get congestionControl() {
    return this.#inner.congestionControl ?? 'default'
  }

  get reliability() {
    return this.#inner.reliability
  }

  get draining() {
    return this.#inner.draining.promise
  }

  get ready() {
    return this.#inner.ready.promise
  }

  get closed() {
    return this.#inner.closed.promise
  }

  /** @type{WebTransportDatagramDuplexStream} */
  get datagrams() {
    if (typeof this.#inner.datagrams === 'undefined')
      throw new Error('Datagrams not defined')
    return this.#inner.datagrams
  }
  /** @type{ReadableStream<WebTransportBidirectionalStream>} */
  get incomingBidirectionalStreams() {
    if (typeof this.#inner.incomingBidirectionalStreams === 'undefined')
      throw new Error('incomingBidirectionalStream is not defined')
    return this.#inner.incomingBidirectionalStreams
  }

  /** @type{ReadableStream<WebTransportReceiveStream>} */
  get incomingUnidirectionalStreams() {
    if (typeof this.#inner.incomingUnidirectionalStreams === 'undefined')
      throw new Error('incomingUnidirectionalStream is not defined')
    return this.#inner.incomingUnidirectionalStreams
  }

  get userData() {
    return this.#inner.userData
  }

  get [kState]() {
    return this.#inner.state
  }

  /**
   * @param {(() => void)} hook
   */
  [kSetCloseHook](hook) {
    this.#inner.closeHook = hook
  }
}
