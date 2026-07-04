import { listen, QuicEndpoint } from 'node:quic'
import { logger } from '../utils.js'
import dns from 'node:dns/promises'
import { isIP } from 'node:net'
import { createPrivateKey } from 'node:crypto'
import { Http3WebTransportSession } from './session.js'

const log = logger(`webtransport:http3:native:server(${process?.pid})`)

export class Http3WebTransportServerNative {
  /**
   * @param {import('../types.js').NativeServerOptions} args
   */
  constructor(args) {
    let port = args?.port
    if (typeof port === 'undefined') port = 443
    this.port = Number(port)
    this.secret = args?.secret
    if (!this.secret) throw new Error('No secret set for Http3Server')
    this.host = args?.host || 'localhost'
    if (!args?.cert) throw new Error('No cert set for Http3Server')
    const encoder = new TextEncoder()
    this.cert_ = encoder.encode(args?.cert)
    this.key_ = createPrivateKey(encoder.encode(args?.privKey))
    if (!this.key_) throw new Error('No privKey set for Http3Server')
    // this.maxConnections = args?.maxConnections
    this.initialStreamFlowControlWindow =
      args?.initialStreamFlowControlWindow || 16 * 1024 // 16 KB
    this.initialSessionFlowControlWindow =
      args?.initialSessionFlowControlWindow || 16 * 1024 // 16 KB

    this.initialBidirectionalStreams = args?.initialBidirectionalStreams || 100
    this.initialUnidirectionalStreams =
      args?.initialUnidirectionalStreams || 100

    this.streamShouldAutoTuneReceiveWindow =
      args.streamShouldAutoTuneReceiveWindow || true
    this.streamFlowControlWindowSizeLimit =
      args?.streamFlowControlWindowSizeLimit || 6 * 1024 * 1024

    this.sessionShouldAutoTuneReceiveWindow =
      args.sessionShouldAutoTuneReceiveWindow || true
    this.sessionFlowControlWindowSizeLimit =
      args?.sessionFlowControlWindowSizeLimit || 15 * 1024 * 1024

    /** @type {Record<string, boolean>} */
    this.paths = {}
    this.hasrequesthandler = false
    /** @type {import('../session.js').HttpServer} */
    // @ts-ignore
    this.jsobj = undefined // the transport will set this

    this.serverStatus_ = 'unstarted'
  }

  startServer() {
    if (this.serverStatus_ != 'unstarted') {
      log('Server was already started, abort')
      return
    }
    this.serverStatus_ = 'starting'

    const sni = {}
    sni[isIP(this.host) == 0 ? this.host : '*'] = {
      keys: [this.key_],
      certs: [this.cert_]
    }

    const getHostaddress = async () => {
      const iptype = isIP(this.host)
      if (iptype === 4 || iptype === 6) {
        return { ip: this.host, family: iptype }
      }
      const { address, family } = await dns.lookup(this.host)

      return { ip: address, family }
    }

    getHostaddress()
      .then(async ({ ip, family }) => {
        this.endpoint = new QuicEndpoint({
          address: { address: ip, port: this.port }
        })
        const servernative = this
        return await listen(
          async (serverSession) => {
            // yay we got a server session
            // what we really want is the client opening a webtransport session
            serverSession.onapplication = (aopts) => {
              if (!aopts.enableDatagrams) {
                serverSession.close({
                  type: 'application',
                  reason:
                    'Connection does not support webtransport (no datagrams enabled)'
                })
              }
            }
            serverSession.onhandshake = function (info) {
              if (
                !this?.remoteTransportParams?.maxDatagramFrameSize ||
                BigInt(this?.remoteTransportParams?.maxDatagramFrameSize) <= 0
              ) {
                this.close({
                  type: 'application',
                  reason:
                    'Connection does not support webtransport (datagram size not greater than 0)'
                })
              }
            }
            serverSession.onstream = function (stream) {
              // console.log('onstream', stream)
            }
          },
          {
            sni,
            application: {
              enableConnectProtocol: true, // needed to start a webtransport session
              enableDatagrams: true,
              enableWebtransport: true,
              maxStreamWindow: this.streamFlowControlWindowSizeLimit,
              maxWindow: this.sessionFlowControlWindowSizeLimit
            },
            transportParams: {
              initialMaxStreamDataBidiLocal:
                this.initialStreamFlowControlWindow,
              initialMaxStreamDataBidiRemote:
                this.initialStreamFlowControlWindow,
              initialMaxStreamDataUni: this.initialStreamFlowControlWindow,
              initialMaxData: this.sessionFlowControlWindowSizeLimit, // or something else
              initialMaxStreamsBidi: this.initialBidirectionalStreams,
              initialMaxStreamsUni: this.initialUnidirectionalStreams,
              maxDatagramFrameSize: 1200 // required to start a webtransport session
            },
            endpoint: this.endpoint,
            onheaders(headers) {
              // we got a stream with headers
              if (
                !headers[':path'] ||
                headers?.[':scheme'] !== 'https' ||
                headers?.[':method'] !== 'CONNECT' ||
                headers?.[':protocol'] !== 'webtransport'
              ) {
                // no webtransport no nothing, go away I do not like you
                this.sendHeaders({ ':status': '404' })
                this.writer.endSync()
                return
              }

              if (headers['wt-available-protocols']) {
                let splitted = headers['wt-available-protocols']
                  // @ts-ignore
                  .split(',')
                  .map((/** @type {string} */ el) => el.trim())
                if (
                  splitted.some(
                    (/** @type {string} */ el) =>
                      typeof el !== 'string' ||
                      el.length < 2 ||
                      el[0] !== '"' ||
                      el.at(-1) !== '"'
                  )
                ) {
                  this.sendHeaders({ ':status': '406' }, { terminal: true })
                  return
                }
                splitted = splitted.map((/** @type {string} */ el) =>
                  el.slice(1, -1)
                )
                if (
                  splitted.some((/** @type {string} */ el) =>
                    /\\([^"\\])/.test(el)
                  )
                ) {
                  this.sendHeaders({ ':status': '406' })
                  this.writer.endSync()
                  return
                }
                headers['wt-available-protocols'] = splitted.map(
                  (/** @type {string} */ el) => el.replace(/\\(["\\])/g, '$1')
                )
              }
              let path = headers[':path']
              while (path.length > 1 && path[0] === '/' && path[1] === '/') {
                path = path?.slice(1)
              }
              headers[':path'] = path // also adapt it for the middleware
              const session = this.session
              const handshake = session.opened
              if (servernative.hasrequesthandler) {
                const retObj = {
                  header: headers,
                  peerAddress:
                    handshake?.remote?.address + ':' + handshake?.remote?.port,
                  protocol: 'http3:node:native',
                  session: this /* the session stream */
                }
                servernative.jsobj.onSessionRequest(retObj)
              } else if (servernative.paths[path]) {
                const retObj = {
                  session: new Http3WebTransportSession({
                    stream: this,
                    session,
                    isclient: false,
                    initialStreamSendWindowOffset:
                      servernative.initialStreamFlowControlWindow
                  }),
                  path,
                  header: headers,
                  peerAddress:
                    handshake?.remote?.address + ':' + handshake?.remote?.port,
                  reliable: false,
                  object: servernative // My server
                }
                this.sendHeaders(
                  { ':status': '200' },
                  { terminal: false, webtransport: true }
                )
                // may be we need another call, see nghttp3 docu
                servernative.jsobj.onHttpWTSessionVisitor(retObj)
              } else {
                this.sendHeaders({ ':status': '404' })
                this.writer.writeSync('Path does not exist')
                this.writer.endSync()
                return
              }
            }
          }
        )
      })
      .then((server) => {
        this.serverInt = server
        this.serverStatus_ = 'started'
        const addr = this.serverInt.address
        const retObj = {
          // @ts-ignore
          port: addr?.port,
          // @ts-ignore
          host: addr?.address
        }
        // @ts-ignore
        this.jsobj.onServerListening(retObj)
        log('Server to ', this.host, 'started')
      })
      .catch((error) => {
        this.serverStatus_ = 'error'
        log('Error starting webtransport server:', this.host, error)
        this.jsobj.onServerError(error)
      })
  }

  stopServer() {
    log('Call destroy on server')
    this.serverInt.destroy()
  }

  /**
   * @param {string|string[]} cert
   * @param {string|string[]} privKey
   * @param {boolean} http2only
   * */
  // eslint-disable-next-line no-unused-vars
  updateCert(cert, privKey, http2only) {
    if (!http2only) {
      const encoder = new TextEncoder()
      this.cert_ = encoder.encode(cert)
      this.key_ = createPrivateKey(encoder.encode(privKey))
      if (this.endpoint) {
        const sni = {}
        sni[this.host] = {
          keys: [this.key_],
          certs: [this.cert_]
        }
        this.endpoint.setSNIContexts(sni)
      }
    }
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
   * @param {import('../types.js').NativeFinishSessionRequest} args
   */
  finishSessionRequest({
    header,
    peerAddress,
    userData,
    session: stream,
    status,
    path,
    selectedProtocol
  }) {
    if (status !== 200) {
      stream.sendHeaders({ ':status': status.toString() })
      stream.writer.endSync()
      return
    }
    const resp = {
      ':status': '200'
    }
    if (selectedProtocol)
      // @ts-ignore
      resp['wt-protocol'] = '"' + selectedProtocol + '"'
    const retObj = {
      session: new Http3WebTransportSession({
        stream,
        session: stream.session,
        isclient: false,
        initialStreamSendWindowOffset: this.initialStreamFlowControlWindow
      }),
      path,
      header,
      peerAddress,
      userData,
      reliable: false,
      object: this // My server
    }
    stream.sendHeaders(resp, { terminal: false, webtransport: true })
    // may be we need to do something else
    this.jsobj.onHttpWTSessionVisitor(retObj)
  }
}
