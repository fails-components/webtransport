import {
  checkQuicheInit,
  Http3WebTransportClientSocket,
  Http3WebTransportClient
} from './http3/index.js'
import { HttpWTSession } from './session.js'
import { WebTransportBase } from './webtransportbase.js'
import { HttpClient } from './client.js'
import { Http2WebTransportClient } from './http2/index.js'
import { logger } from './utils.js'

const log = logger(`webtransportnode(${process?.pid})`)
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
    const client = new HttpClient({
      createReliableClient: function (client) {
        // @ts-ignore
        return new Http2WebTransportClient({ ...args })
      },
      createUnreliableClient: function (client) {
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
      },
      ...args
    })
    const sessionint = new HttpWTSession({
      /* object: args.session, */
      parentobj: client
    })
    return { client, sessionint }
  }
}
