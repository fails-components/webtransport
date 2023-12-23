import { createSecureServer, constants } from 'node:http2'
import { Http2WebTransportSession } from '../session.js'
import { Http2CapsuleParser } from './capsuleparser.js'
import { WebSocketParser } from './websocketparser.js'
import { log } from 'node:console'
import { webcrypto as crypto } from 'crypto'
import { supportedVersions } from '../websocketcommon.js'

export class Http2WebTransportServer {
  /**
   * @param {import('../../types.js').NativeServerOptions} args
   */
  constructor(args) {
    let port = args?.port
    if (typeof port === 'undefined') port = 443
    this.port = Number(port)
    this.secret = args?.secret
    if (!this.secret) throw new Error('No secret set for Http2Server')
    this.host = args?.host || 'localhost'
    const cert = args?.certhttp2 ? args?.certhttp2 : args?.cert
    if (!cert) throw new Error('No cert set for Http2Server')
    const key = args?.privKeyhttp2 ? args?.privKeyhttp2 : args?.privKey
    if (!key) throw new Error('No privKey set for Http2Server')
    // this.maxConnections = args?.maxConnections
    // this.initialStreamFlowControlWindow = args?.initialStreamFlowControlWindow
    // this.initialSessionFlowControlWindow = args?.initialSessionFlowControlWindow

    /** @type {Record<string, boolean>} */
    this.paths = {}
    this.hasrequesthandler = false
    /** @type {import('../../session.js').HttpServer} */
    // @ts-ignore
    this.jsobj = undefined // the transport will set this

    // @ts-ignore
    this.serverInt = createSecureServer({
      key,
      cert,
      allowHTTP1: true /* Chromium uses http2 only, if there is already an existing http2 connection */,
      settings: {
        enableConnectProtocol: true,
        customSettings: {
          0x2b60: 1 // SETTINGS_WEBTRANSPORT_MAX_SESSIONS, TODO fix number
        }
      }
    })

    this.serverInt.on('listening', () => {
      const addr = this.serverInt.address()
      const retObj = {
        // @ts-ignore
        port: addr?.port,
        // @ts-ignore
        host: addr?.address
      }
      // @ts-ignore
      this.jsobj.onServerListening(retObj)
    })

    this.serverInt.on('error', () => {
      const retObj = {}
      // @ts-ignore
      this.jsobj.onServerError(retObj)
      /* TODO (stream) => {
        stream.close(constants.NGHTTP2_CONNECT_ERROR)
      }) */
    })

    this.serverInt.on('close', () => {
      const retObj = {}
      // @ts-ignore
      this.jsobj.onServerClose(retObj)
    })

    this.serverInt.on(
      'upgrade',
      (request, stream /* actually a socket */, head) => {
        let path = request.url
        const header = request.headers
        if (!path) {
          stream.destroy()
          return
        }
        const websocketProt = this.checkProtocolHeader(header)
        if (!websocketProt) {
          stream.destroy()
          return
        }
        while (path.length > 1 && path[0] === '/' && path[1] === '/') {
          path = path?.slice(1)
        }
        if (this.paths[path]) {
          this.sendHttp1Headers({ stream, header, protocol: websocketProt })
            .then(() => {
              const retObj = {
                session: new Http2WebTransportSession({
                  stream,
                  isclient: false,
                  createParser: (
                    /** @type {Http2WebTransportSession} */ nativesession
                  ) => {
                    const parse = (this.capsParser = new WebSocketParser({
                      stream,
                      nativesession,
                      isclient: false
                    }))
                    if (head.byteLength > 0) parse.parseData(head)
                    return parse
                  }
                }),
                path,
                header,
                reliable: true,
                object: this // My server
              }
              this.jsobj.onHttpWTSessionVisitor(retObj)
            })
            .catch((error) => {
              log('Problem sendHttp1Header', error)
              stream.destroy()
            })
        } else if (this.hasrequesthandler) {
          stream.head = head

          const retObj = {
            header,
            session: stream,
            protocol: 'websocketoverhttp1',
            head
          }
          this.jsobj.onSessionRequest(retObj)
        } else {
          stream.destroy()
        }
      }
    )

    this.serverInt.on('stream', (stream, header) => {
      if (header[':method'] !== 'CONNECT') {
        // Only accept CONNECT requests
        stream.respond({
          ':status': '406'
        })
        stream.close(constants.NGHTTP2_REFUSED_STREAM)
        return
      }
      /**
       * @type {string|undefined}
       */
      let websocketProt
      if (
        header[':protocol'] === 'websocket' &&
        header['Sec-WebSocket-Protocol']
      ) {
        websocketProt = this.checkProtocolHeader(header)
      }
      if (header[':protocol'] !== 'webtransport' && !websocketProt) {
        stream.respond({
          ':status': '406'
        })
        stream.close(constants.NGHTTP2_REFUSED_STREAM)
        return
      }
      if (!header[':path']) {
        stream.respond({
          ':status': '406'
        })
        stream.close(constants.NGHTTP2_REFUSED_STREAM)
        return
      }
      const path = header[':path']
      if (this.paths[path]) {
        const retObj = {
          session: new Http2WebTransportSession({
            stream,
            isclient: false,
            createParser: (
              /** @type {Http2WebTransportSession} */ nativesession
            ) => {
              if (!websocketProt) {
                return new Http2CapsuleParser({
                  stream,
                  nativesession,
                  isclient: false
                })
              } else {
                return (this.capsParser = new WebSocketParser({
                  stream,
                  nativesession,
                  isclient: false
                }))
              }
            }
          }),
          path,
          header,
          reliable: true,
          object: this // My server
        }
        const resp = {
          ':status': '200'
        }
        // @ts-ignore
        if (websocketProt) resp['Sec-WebSocket-Protocol'] = websocketProt
        stream.respond(resp)
        this.jsobj.onHttpWTSessionVisitor(retObj)
      } else if (this.hasrequesthandler) {
        const retObj = {
          header,
          session: stream,
          protocol: websocketProt ? 'websocket' : 'capsule'
        }
        const resp = {
          ':status': '200'
        }
        // @ts-ignore
        if (websocketProt) resp['Sec-WebSocket-Protocol'] = websocketProt
        stream.respond(resp)
        this.jsobj.onSessionRequest(retObj)
      } else {
        stream.respond({
          ':status': '404'
        })
        stream.end()
        stream.close()
        // eslint-disable-next-line no-useless-return
        return
      }
    })
  }

  /**
   * @param {import("http2").IncomingHttpHeaders} header
   */
  checkProtocolHeader(header) {
    const sechead = header['sec-websocket-protocol']
    let prots
    if (!Array.isArray(sechead)) {
      prots = [sechead]
    } else {
      prots = sechead
    }
    prots = prots
      .map((el) => (el ? el.split('_') : [undefined, undefined]))
      .filter((el) => el[0] === 'webtransport')
      .filter((el) => (el[1] ? supportedVersions.includes(el[1]) : false))
    if (prots.length > 0) return prots[0].join('_')
    else return undefined
  }

  startServer() {
    this.serverInt.listen(this.port, this.host)
  }

  stopServer() {
    this.serverInt.close()
    // TODO call close on all sessions
  }

  /**
   * @param {string} cert
   * @param {string} privKey
   * @param {boolean} http2only
   * */
  updateCert(cert, privKey, http2only) {
    this.serverInt.setSecureContext({ key: privKey, cert })
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
   * @param {{stream: import('net').Socket, header: any, protocol: string}} args
   */
  async sendHttp1Headers({ stream, header, protocol }) {
    try {
      const digi = await crypto.subtle.digest(
        'SHA-1',
        new TextEncoder().encode(
          header['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'
        )
      )
      const wstoken = Buffer.from(digi).toString('base64')
      stream.write(
        'HTTP/1.1 101 Switching Protocols\r\n' +
          'Upgrade: websocket\r\n' +
          'Connection: Upgrade\r\n' +
          'Sec-WebSocket-Protocol: ' +
          protocol +
          '\r\n' +
          'Sec-WebSocket-Accept: ' +
          wstoken +
          '\r\n' +
          '\r\n'
      )
      // @ts-ignore
    } catch (error) {
      log('Problem decoding websocket token:', error)
      stream.destroy()
    }
  }

  /**
   * @param {import('../../types.js').NativeFinishSessionRequest} args
   */
  finishSessionRequest({ header, session: stream, status, protocol, head }) {
    if (status !== 200) {
      if (protocol === 'websocketoverhttp1') {
        stream.destroy()
      } else {
        stream.close(constants.HTTP_STATUS_NOT_FOUND)
      }
    } else {
      if (protocol === 'websocketoverhttp1') {
        // @ts-ignore
        this.sendHttp1Headers({ stream, header })
          .then(() => {
            const retObj = {
              session: new Http2WebTransportSession({
                stream,
                isclient: false,
                createParser: (
                  /** @type {Http2WebTransportSession} */ nativesession
                ) => {
                  const parse = (this.capsParser = new WebSocketParser({
                    stream,
                    nativesession,
                    isclient: false
                  }))
                  if (head && head.byteLength > 0) parse.parseData(head)
                  return parse
                }
              }),
              path: header[':path'],
              header
            }
            // @ts-ignore
            this.jsobj.onHttpWTSessionVisitor(retObj)
          })
          .catch((error) => {
            log('sendHttp1Headers error', error)
          })
      } else {
        const retObj = {
          session: new Http2WebTransportSession({
            stream,
            isclient: false,
            createParser: (
              /** @type {Http2WebTransportSession} */ nativesession
            ) => {
              if (protocol !== 'websocket') {
                return new Http2CapsuleParser({
                  stream,
                  nativesession,
                  isclient: false
                })
              } else {
                return (this.capsParser = new WebSocketParser({
                  stream,
                  nativesession,
                  isclient: false
                }))
              }
            }
          }),
          path: header[':path'],
          header
        }
        // @ts-ignore
        this.jsobj.onHttpWTSessionVisitor(retObj)
      }

      // @ts-ignore
    }
  }
}
