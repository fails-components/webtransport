import { HttpWTSession } from './session.js'
import { WebTransportBase } from './webtransportbase.js'
import { HttpClient } from './client.js'
import { Http2WebTransportClient } from './http2/index.js'
import { logger } from './utils.js'

const log = logger(`webtransportnode(${process?.pid})`)

/**
 * @type {(arg0: import("./types").HttpWebTransportInit) => void}
 */
let checkQuicheInit
/**
 * @type {new (arg0: import("./types").HttpWebTransportInit) => any}
 */
let Http3WebTransportClientSocket
/**
 * @type {new (arg0: import("./types").HttpWebTransportInit) => any}
 */
let Http3WebTransportClient
// @ts-ignore
// eslint-disable-next-line no-unused-vars
const quicheLoaded = new Promise((resolve, reject) => {
  // @ts-ignore
  import('@fails-components/webtransport-transport-http3-quiche')
    .then(
      /**
       * @type {import("./types").TransportHttp3Quiche}
       */
      (http3lib) => {
        /**
         * @type {import("./types").TransportHttp3Quiche}
         */
        ;({
          checkQuicheInit,
          Http3WebTransportClientSocket,
          Http3WebTransportClient
        } = http3lib)
        resolve(undefined)
      }
    )
    .catch((error) => {
      log('Problem loading http3-quiche transport', error)
      reject(error)
    })
})

/**
 * @typedef {import('./dom').WebTransportCloseInfo} WebTransportCloseInfo
 * @typedef {import('./dom').WebTransportBidirectionalStream} WebTransportBidirectionalStream
 * @typedef {import('./dom').WebTransportReceiveStream} WebTransportReceiveStream
 */

/**
 * @template T
 * @typedef {import('node:stream/web').ReadableStream<T>} ReadableStream<T>
 */

/**
 * @typedef {import('./dom').WebTransport} WebTransportInterface
 *
 * @implements {WebTransportInterface}
 */
export class WebTransport extends WebTransportBase {
  /**
   * @param{{client: HttpClient, sessionint: HttpWTSession, ourl: URL}} args
   */
  startUpConnection({ client, sessionint, ourl }) {
    client
      .handleConnection({ createTransport: true, path: ourl.pathname })
      .then(() => client.createWTSession(sessionint, ourl.pathname))
      .catch((error) => {
        if (client.transportIntSwitchToReliable) {
          log('Connecting to unreliable failed:', error)
          log('Now switching to reliable')
          client.transportIntSwitchToReliable()
          client
            .handleConnection({ createTransport: false, path: ourl.pathname })
            .then(() => client.createWTSession(sessionint, ourl.pathname))
            .catch((error) => {
              client.closeHookSession()
              sessionint.readyReject(error)
              sessionint.closedReject(error)
            })
        } else {
          client.closeHookSession()
          sessionint.readyReject(error)
          sessionint.closedReject(error)
        }
      })
  }

  /**
   * @param{import('./types.js').HttpWebTransportInit} args
   * @return {{sessionint: HttpWTSession, client: HttpClient}}
   */
  createClient(args) {
    let createUnreliableClient
    if (checkQuicheInit) {
      createUnreliableClient = function (/** @type {any} */ _client) {
        if (
          // @ts-ignore
          !args?.forceReliable
        ) {
          checkQuicheInit(args)
        }
        const socket = new Http3WebTransportClientSocket(args)
        const uclient = new Http3WebTransportClient(args)
        uclient.closeClientInt = uclient.closeClient
        uclient.closeClient = socket.closeClient.bind(socket)
        socket.init()
        socket.cobj = uclient
        uclient.socket = socket
        return uclient
      }
    }
    const client = new HttpClient({
      createReliableClient: function (client) {
        // @ts-ignore
        return new Http2WebTransportClient({ ...args })
      },
      createUnreliableClient,
      ...args
    })
    const sessionint = new HttpWTSession({
      /* object: args.session, */
      parentobj: client
    })
    return { client, sessionint }
  }
}
