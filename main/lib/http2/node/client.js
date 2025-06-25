import { connect, constants as http2constants } from 'node:http2'
import { Http2WebTransportSession } from '../session.js'
import { Http2CapsuleParser } from './capsuleparser.js'
import { logger } from '../../utils.js'

const log = logger(`webtransport:http2:node:client(${process?.pid})`)

export class Http2WebTransportClient {
  /**
   * @param {import('../../types.js').NativeClientOptions} args
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

    this.streamShouldAutoTuneReceiveWindow =
      args.streamShouldAutoTuneReceiveWindow || true
    this.streamFlowControlWindowSizeLimit =
      args?.streamFlowControlWindowSizeLimit || 6 * 1024 * 1024

    this.sessionShouldAutoTuneReceiveWindow =
      args.sessionShouldAutoTuneReceiveWindow || true
    this.sessionFlowControlWindowSizeLimit =
      args?.sessionFlowControlWindowSizeLimit || 15 * 1024 * 1024

    this.initialDatagramSize =
      args.initialDatagramSize || this.initialSessionFlowControlWindow - 128
    /** @type {import('../../session.js').HttpClient} */
    // @ts-ignore
    this.jsobj = undefined // the transport will set this
  }

  createTransport() {
    /**
     * @param {string} hostname
     * @param {import('node:tls').PeerCertificate} cert
     * */
    const webTransportVerifier = (hostname, cert) => {
      if (
        this.serverCertificateHashes &&
        this.serverCertificateHashes.some((el) => {
          if (el.algorithm !== 'sha-256') return false
          const cbytes = cert.fingerprint256
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
    const http2Options = {
      settings: {
        enableConnectProtocol: true,
        customSettings: {
          0x2b60: 1, // SETTINGS_WEBTRANSPORT_MAX_SESSIONS, TODO fix number
          0x2b61: this.initialSessionFlowControlWindow, // SETTINGS_WEBTRANSPORT_INITIAL_MAX_DATA
          0x2b62: this.initialStreamFlowControlWindow, // SETTINGS_WEBTRANSPORT_INITIAL_MAX_STREAM_DATA_UNI
          0x2b63: this.initialStreamFlowControlWindow, // SETTINGS_WEBTRANSPORT_INITIAL_MAX_STREAM_DATA_BIDI
          0x2b64: this.initialUnidirectionalStreams, // SETTINGS_WEBTRANSPORT_INITIAL_MAX_STREAMS_UNI
          0x2b65: this.initialBidirectionalStreams, // SETTINGS_WEBTRANSPORT_INITIAL_MAX_STREAMS_BIDI
          0x2b66: this.initialDatagramSize // SETTINGS_MAX_DATAGRAM_SIZE
        }
      },
      remoteCustomSettings: [
        0x2b60, 0x2b61, 0x2b62, 0x2b63, 0x2b64, 0x2b65, 0x2b66
      ],
      localPort: this.localPort,
      // TODO: REMOVE BEFORE RELEASE; UNSAFE SETTING
      rejectUnauthorized: !this.serverCertificateHashes
    }
    if (this.serverCertificateHashes)
      // @ts-ignore
      http2Options.checkServerIdentity = webTransportVerifier

    // @ts-ignore
    this.clientInt = connect(
      'https://' + this.hostname + ':' + this.port,
      http2Options
    )

    /** @type {NodeJS.Timeout|undefined} */
    let pingsender

    this.clientInt.on('close', () => {
      if (pingsender) clearInterval(pingsender)
    })

    let authfail = false
    this.clientInt.socket.on('secureConnect', () => {
      /** @type {import('node:tls').TLSSocket} */
      // @ts-ignore
      const oursocket = this.clientInt?.socket
      if (!oursocket) throw new Error('Can not get http2 TLSSocket')
      // @ts-ignore
      if (!oursocket.authorized) {
        // ok last hope we have hashes
        if (this.serverCertificateHashes) {
          if (
            !webTransportVerifier(this.hostname, oursocket.getPeerCertificate())
          ) {
            this.clientInt?.destroy(
              undefined,
              http2constants.NGHTTP2_REFUSED_STREAM
            )
            log('Certificate hash does not match')
            authfail = true
            this.jsobj.onClientConnected({
              success: false
            })
          } else {
            oursocket.authorized = true
          }
        } else {
          this.clientInt?.destroy(
            new Error('Certificate not authorized'),
            http2constants.NGHTTP2_REFUSED_STREAM
          )
          authfail = true
          log('Certificate not authorized')
          this.jsobj.onClientConnected({
            success: false
          })
        }
      }
    })
    let connected = false
    // eslint-disable-next-line no-unused-vars
    this.clientInt.on('connect', (session, socket) => {
      if (!authfail) {
        connected = true
        this.jsobj.onClientConnected({
          success: true
        })
        let rtt = 100
        let adjust = 1
        // ok we got a session and want to measure RTT
        const pingupdater = () => {
          if (this.clientInt && !this.clientInt.closed) {
            // eslint-disable-next-line no-unused-vars
            this.clientInt.ping((err, duration, payload) => {
              if (!err) {
                rtt = adjust * duration + (1 - adjust) * rtt
                adjust = 0.2
                // @ts-ignore
                this.clientInt.WTrtt = rtt
              }
            })
          } else {
            clearInterval(pingsender)
            // @ts-ignore
            pingsender = undefined
          }
        }
        pingsender = setInterval(pingupdater, 1000)
        pingupdater()
      }
    })
    this.clientInt.on('error', (error) => {
      log('http2 client error:', error)
      if (!connected && !authfail) {
        this.jsobj.onClientConnected({
          success: false
        })
      }
    })
    this.clientInt.on('remoteSettings', (settings) => {
      if (settings.enableConnectProtocol && this.clientInt) {
        // if (settings.webtansportmaxsessions)
        {
          const retObj = {}
          this.jsobj.onClientWebTransportSupport(retObj)
        }
      }
    })
  }

  /**
   * @param {string} path
   */
  openWTSession(path) {
    if (!this.clientInt) throw new Error('clientInt not present')

    const requestOpts = {
      ':method': 'CONNECT',
      ':protocol': 'webtransport',
      ':scheme': 'https',
      ':path': path,
      authority: this.hostname,
      origin: this.hostname
    }
    if (this.protocols.length > 0) {
      // @ts-ignore
      requestOpts['wt-available-protocols'] =
        '"' +
        this.protocols
          .map((el) => el.replace(/\\/g, '\\\\').replace(/"/g, '\\"'))
          .join('","') +
        '"'
    }

    const stream = this.clientInt.request(requestOpts)
    const {
      0x2b65: remoteBidirectionalStreams = undefined,
      0x2b64: remoteUnidirectionalStreams = undefined,
      0x2b63: remoteBidirectionalStreamFlowControlWindow = undefined,
      0x2b62: remoteUnidirectionalStreamFlowControlWindow = undefined,
      0x2b61: remoteSessionFlowControlWindow = undefined,
      0x2b66: remoteMaxDatagramSize = 2 ** 62 - 1 // note this exceeds safe integer
      // @ts-ignore
    } = this.clientInt.remoteSettings?.customSettings || {}

    const retObj = {
      header: stream.sentHeaders,
      session: new Http2WebTransportSession({
        stream,
        isclient: true,
        createParser: (/** @type {Http2WebTransportSession} */ nativesession) =>
          new Http2CapsuleParser({
            stream,
            nativesession,
            isclient: true,
            initialStreamSendWindowOffsetBidi:
              remoteBidirectionalStreamFlowControlWindow ||
              this.initialStreamFlowControlWindow,
            initialStreamSendWindowOffsetUnidi:
              remoteUnidirectionalStreamFlowControlWindow ||
              this.initialStreamFlowControlWindow,
            initialStreamReceiveWindowOffset:
              this.initialStreamFlowControlWindow,
            streamShouldAutoTuneReceiveWindow:
              this.streamShouldAutoTuneReceiveWindow,
            streamReceiveWindowSizeLimit: this.streamFlowControlWindowSizeLimit,
            maxDatagramSize: this.initialDatagramSize,
            remoteMaxDatagramSize
          }),
        initialBidirectionalSendStreams:
          remoteBidirectionalStreams || this.initialBidirectionalStreams,
        initialBidirectionalReceiveStreams: this.initialBidirectionalStreams,
        initialUnidirectionalSendStreams:
          remoteUnidirectionalStreams || this.initialUnidirectionalStreams,
        initialUnidirectionalReceiveStreams: this.initialUnidirectionalStreams,
        sendWindowOffset:
          remoteSessionFlowControlWindow ||
          this.sessionFlowControlWindowSizeLimit,
        receiveWindowOffset: this.initialSessionFlowControlWindow,
        shouldAutoTuneReceiveWindow: this.sessionShouldAutoTuneReceiveWindow,
        receiveWindowSizeLimit: this.sessionFlowControlWindowSizeLimit
      }),
      reliable: true
    }
    this.jsobj.onHttpWTSessionVisitor(retObj)
  }

  closeClient() {
    if (this.clientInt) this.clientInt.close()
  }
}
