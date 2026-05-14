export class Http3WebTransportServerNative {
  /**
   * @param {import('../types.js').NativeServerOptions} args
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

    throw new Error('Server start not implemented')
  }

  startServer() {
    throw new Error('Server start not implemented')
  }

  stopServer() {
    throw new Error('Server start not implemented')
  }

  /**
   * @param {string|string[]} cert
   * @param {string|string[]} privKey
   * @param {boolean} http2only
   * */
  // eslint-disable-next-line no-unused-vars
  updateCert(cert, privKey, http2only) {
    throw new Error('Server start not implemented')
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
    protocol,
    head,
    path,
    transportPrivate,
    selectedProtocol
  }) {
    throw new Error('not implemented')
  }
}
