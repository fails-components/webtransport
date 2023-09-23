import { createSecureServer, constants } from 'node:http2'
import { Http3WebTransport } from '../transport'
import { Http2WebTransportSession } from './session'

export class Http2WebTransportServer {
  /**
   * @param {import('../types').NativeServerOptions} args
   */
  constructor(args) {
    this.port = args?.port || 443
    this.secret = args?.secret
    if (!this.secret) throw new Error('No secret set for Http2Server')
    this.host = args?.host || 'localhost'
    const cert = args?.cert
    if (!cert) throw new Error('No cert set for Http2Server')
    const key = args?.privKey
    if (!key) throw new Error('No privKey set for Http2Server')
    // this.maxConnections = args?.maxConnections
    // this.initialStreamFlowControlWindow = args?.initialStreamFlowControlWindow
    // this.initialSessionFlowControlWindow = args?.initialSessionFlowControlWindow

    /** @type {Record<string, boolean>} */
    this.paths = {}
    this.hasrequesthandler = false
    /** @type {import('../session').Http3Server} */
    // @ts-ignore
    this.jsobj = undefined // the transport will set this

    // @ts-ignore
    this.serverInt = createSecureServer({
      key,
      cert,
      enableConnectProtocol: true,
      customSettings: {
        727725891: 1 // SETTINGS_WEBTRANSPORT_MAX_SESSIONS, TODO fix number
      }
    })

    this.serverInt.on('stream', (stream, header) => {
      if (header[':method'] !== 'CONNECT') {
        // Only accept CONNECT requests
        stream.close(constants.NGHTTP2_REFUSED_STREAM)
        return
      }
      if (header[':protocol'] !== 'webtransport') {
        stream.close(constants.NGHTTP2_REFUSED_STREAM)
        return
      }
      if (!header[':path']) {
        stream.close(constants.NGHTTP2_REFUSED_STREAM)
        return
      }
      const path = header[':path']
      if (this.paths[path]) {
        const retObj = {
          purpose: 'Http3WTSessionVisitor',
          session: new Http2WebTransportSession({ stream, isclient: false }),
          path,
          header,
          object: this // My server
        }
        Http3WebTransport.transportCallback(retObj)
      } else if (this.hasrequesthandler) {
        const retObj = {
          purpose: 'SessionRequest',
          header,
          session: stream,
          object: this // My server
        }
        Http3WebTransport.transportCallback(retObj)
      } else {
        stream.close(constants.HTTP_STATUS_NOT_FOUND)
        return
      }

      this.serverInt.on('error', (error_) => {
        stream.close(constants.NGHTTP2_CONNECT_ERROR)
      })
    })
  }

  startServer() {
    this.serverInt.listen(this.port)
  }

  stopServer() {
    this.serverInt.close()
    // TODO call close on all sessions
  }

  /**
   * @param {boolean} isset
   */
  setJSRequestHandler(isset) {
    this.hasrequesthandler = isset
  }

  /**
   * @param {string} path
   */
  addPath(path) {
    this.paths[path] = true
  }

  /**
   * @param {import('../types').NativeFinishSessionRequest} args
   */
  finishSessionRequest({ header, session: stream, status }) {
    if (status !== 200) {
      stream.close(constants.HTTP_STATUS_NOT_FOUND)
    } else {
      const retObj = {
        purpose: 'Http3WTSessionVisitor',
        session: new Http2WebTransportSession({ stream, isclient: false }),
        path: header[':path'],
        header,
        object: this // My server
      }
      Http3WebTransport.transportCallback(retObj)
    }
  }
}
