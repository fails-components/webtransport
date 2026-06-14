import { connect } from 'node:quic'
import { isIP } from 'node:net'
import { logger } from '../utils.js'
import { Http3WebTransportSession } from './session.js'

const log = logger(`webtransport:http3:native:client(${process?.pid})`)

export class Http3WebTransportClientNative {
  /**
   * @param {import('../types.js').NativeClientOptions} args
   */
  constructor(args) {
    let port = args?.port
    if (typeof port === 'undefined') port = 443
    this.port = Number(port)
    this.hostname = args?.host || 'localhost'
    this.serverCertificateHashes = args?.serverCertificateHashes || undefined
    this.protocols = args?.protocols || []
    this.localPort = Number(args?.localPort) || undefined
    this.allowPooling = args?.allowPooling || false
    this.forceIpv6 = args?.forceIpv6 || false
    this.initialStreamFlowControlWindow =
      args?.initialStreamFlowControlWindow || 16 * 1024 // 16 KB
    this.initialSessionFlowControlWindow =
      args?.initialSessionFlowControlWindow || 16 * 1024 // 16 KB

    this.initialBidirectionalStreams =
      args?.initialBidirectionalSendStreams || 100
    this.initialUnidirectionalStreams =
      args?.initialUnidirectionalSendStreams || 100

    this.initialBidirectionalStreamsRemote =
      args?.initialBidirectionalReceiveStreams || 100

    this.streamShouldAutoTuneReceiveWindow =
      args.streamShouldAutoTuneReceiveWindow || true
    this.streamFlowControlWindowSizeLimit =
      args?.streamFlowControlWindowSizeLimit || 6 * 1024 * 1024

    this.sessionShouldAutoTuneReceiveWindow =
      args.sessionShouldAutoTuneReceiveWindow || true
    this.sessionFlowControlWindowSizeLimit =
      args?.sessionFlowControlWindowSizeLimit || 15 * 1024 * 1024
    /** @type {import('../session.js').HttpClient} */
    // @ts-ignore
    this.jsobj = undefined // the transport will set this
  }

  createTransport() {
    // same as on http2
    const webTransportVerifier = (cert) => {
      if (
        this.serverCertificateHashes &&
        this.serverCertificateHashes.some((el) => {
          if (el.algorithm !== 'sha-256') return false
          const cbytes = cert
            .fingerprint256() // after the interface is fixed remove ()
            .split(':')
            .map((el) => parseInt(el, 16))
          const val = Buffer.isBuffer(el.value)
            ? el.value
            : new Uint8Array(
                ArrayBuffer.isView(el.value) ? el.value.buffer : el.value
              )
          if (cbytes.length !== val.byteLength) return false
          for (let i = 0; i < val.byteLength; i++) {
            if (val[i] !== cbytes[i]) return false
          }
          const curdate = new Date()

          if (
            new Date(cert.valid_from) > curdate ||
            new Date(cert.valid_to) < curdate
          )
            return false

          const difference =
            new Date(cert.valid_to).getTime() -
            new Date(cert.valid_from).getTime()
          if (difference > 1000 * 60 * 60 * 24 * 14) return false // no more than 14 days spec says.
          return true
        })
      )
        return true
      else return false
    }
    const quicOptions = {
      alpn: 'h3', // it is the default,
      application: {
        enableConnectProtocol: true, // needed to start a webtransport session
        enableDatagrams: true,
        enableWebtransport: true,
        maxStreamWindow: this.streamFlowControlWindowSizeLimit,
        maxWindow: this.sessionFlowControlWindowSizeLimit
        // I am wondering, how certificates are verified.
      },
      transportParams: {
        initialMaxStreamDataBidiLocal: this.initialBidirectionalStreams,
        initialMaxStreamDataBidiRemote: this.initialBidirectionalStreamsRemote,
        initialMaxStreamDataUni: this.initialUnidirectionalStreams,
        initialMaxData: this.sessionFlowControlWindowSizeLimit, // or something else
        initialMaxStreamsBidi: this.initialBidirectionalStreams,
        initialMaxStreamsUni: this.initialUnidirectionalStreams,
        maxDatagramFrameSize: 1200 // required to start a webtransport session
      },
      verifyPeer: this.serverCertificateHashes ? 'manual' : 'auto'
    }
    if (!isIP(this.hostname)) {
      quicOptions.servername = this.hostname
    }

    this.clientInt = connect(this.hostname + ':' + this.port, quicOptions)
    log('tried to connect to', this.hostname + ':' + this.port)
    let connected = false
    this.clientInt
      .then(async (session) => {
        log('http3 client created')
        this.sessionInt = session

        session.onapplication = (aopts) => {
          if (
            aopts.enableConnectProtocol &&
            aopts.enableDatagrams &&
            aopts.enableWebtransport
          ) {
            this.jsobj.onClientWebTransportSupport({})
            session.onapplication = undefined
          }
        }

        const openresult = await session.opened
        log('session open result', openresult)
        if (this.serverCertificateHashes) {
          let certVerifiyFailed = true
          if (openresult.validationErrorCode === 0) certVerifiyFailed = false
          if (
            certVerifiyFailed &&
            this.serverCertificateHashes &&
            session.peerCertificate
          ) {
            try {
              if (webTransportVerifier(session.peerCertificate)) {
                log('certificateHash verified')
                certVerifiyFailed = false
              }
            } catch (error) {
              log('webTransportVerifier failed', error)
            }
          }
          if (certVerifiyFailed) {
            session.destroy(
              new Error('Server certificate hashes validation failed'),
              { reason: 'cert invalid' }
            )
          }
        }
        log('http3 client connected')

        this.jsobj.onClientConnected({ success: true })
        connected = true
      })
      .catch((error) => {
        connected = false
        this.jsobj.onClientConnected({ success: false })
        log('http3 connection fail', error)
      })
  }

  /**
   * @param {string} path
   */
  openWTSession(path) {
    if (!this.clientInt) throw new Error('clientInt not present')
    if (!this.sessionInt) throw new Error('sessionInt not present')

    let headersReceivedResolve
    const headersReceivedProm = new Promise((resolve, reject) => {
      headersReceivedResolve = resolve
    })

    this.sessionInt
      .createBidirectionalStream({
        body: '',
        onheaders(headers) {
          headersReceivedResolve(headers)
        }
        // webtransport: true
      })
      /*  .then(
        (stream) =>
          new Promise((resolve) => setTimeout(() => resolve(stream), 100))
      )*/
      .then((stream) => {
        const sendHeadersOpts = {
          ':method': 'CONNECT',
          ':scheme': 'https',
          // this one depends on draft, draft14 says "webtransport", draft15 says "webtransport-h3"
          ':protocol': 'webtransport',
          ':path': path,
          ':authority': this.hostname + ':' + this.port
        }
        if (this.protocols.length > 0) {
          // @ts-ignore
          sendHeadersOpts['wt-available-protocols'] =
            '"' +
            this.protocols
              .map((el) => el.replace(/\\/g, '\\\\').replace(/"/g, '\\"'))
              .join('","') +
            '"'
        }
        if (!stream.sendHeaders(sendHeadersOpts, { webtransport: true }))
          throw new Error('Sending headers failed')
        const retObj = {
          headers: {}, // TODO?
          session: new Http3WebTransportSession({
            stream,
            session: this.sessionInt,
            isclient: true,
            headersReceivedProm,
            initialStreamSendWindowOffset: this.initialStreamFlowControlWindow
          }),
          reliable: false
        }
        this.jsobj.onHttpWTSessionVisitor(retObj)
      })
      .catch((error) => {
        log('Error creating sessionstream')
        throw error
      })
  }

  closeClient() {}
}
