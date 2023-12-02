import { connect } from 'node:http2'
import { Http2WebTransportSession } from './session.js'
import { log } from 'node:console'
import { Http2CapsuleParser } from './capsule/capsuleparser.js/index.js'

export class Http2WebTransportClient {
  /**
   * @param {import('../types').NativeClientOptions} args
   */
  constructor(args) {
    let port = args?.port
    if (typeof port === 'undefined') port = 443
    this.port = Number(port)
    this.hostname = args?.host || 'localhost'
    this.serverCertificateHashes = args?.serverCertificateHashes || undefined
    this.localPort = Number(args?.localPort) || undefined
    this.allowPooling = args?.allowPooling || false
    this.forceIpv6 = args?.forceIpv6 || false
    /** @type {import('../session').HttpClient} */
    // @ts-ignore
    this.jsobj = undefined // the transport will set this
  }

  createTransport() {
    /**
     * @param {string} _servername
     * @param {import('node:tls').PeerCertificate} cert
     * */
    const webTransportVerifier = (_servername, cert) => {
      if (
        this.serverCertificateHashes &&
        this.serverCertificateHashes.some((el) => {
          if (el.algorithm !== 'sha-256') return false
          const cbytes = cert.fingerprint256
            .split(':')
            .map((el) => parseInt(el, 16))
          const val = new Uint8Array(
            ArrayBuffer.isView(el.value) ? el.value.buffer : el.value
          )
          if (cbytes.length !== val.byteLength) return false
          for (let i = 0; i < val.byteLength; i++) {
            if (val[i] !== cbytes[i]) return false
          }
          return true
        })
      )
        return undefined
      else return new Error('Verification of server certificate failed!')
    }
    const http2Options = {
      settings: {
        enableConnectProtocol: true,
        customSettings: {
          0x2b60: 1 // SETTINGS_WEBTRANSPORT_MAX_SESSIONS, TODO fix number
        }
      },
      localPort: this.localPort,
      // TODO: REMOVE BEFORE RELEASE; UNSAFE SETTING
      rejectUnauthorized: false
    }
    if (this.serverCertificateHashes)
      // @ts-ignore
      http2Options.checkServerIdentity = webTransportVerifier

    // @ts-ignore
    this.clientInt = connect(
      'https://' + this.hostname + ':' + this.port,
      http2Options
    )
    let connected = false
    this.clientInt.on('connect', (session, socket) => {
      const retObj = {
        success: true
      }
      connected = true
      this.jsobj.onClientConnected(retObj)
    })
    this.clientInt.on('error', (error) => {
      log('http2 client error:', error)
      if (!connected) {
        const retObj = {
          success: false
        }
        this.jsobj.onClientConnected(retObj)
      }
    })
    this.clientInt.on('remoteSettings', (settings) => {
      if (settings.enableConnectProtocol && this.clientInt) {
        // if (settings.webtansportmaxsessions)
        // eslint-disable-next-line no-lone-blocks
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

    const stream = this.clientInt.request({
      ':method': 'CONNECT',
      ':protocol': 'webtransport',
      ':scheme': 'https',
      ':path': path,
      authority: this.hostname,
      origin: this.hostname
    })

    const retObj = {
      header: stream.sentHeaders,
      session: new Http2WebTransportSession({
        stream,
        isclient: true,
        createParser: (/** @type {Http2WebTransportSession} */ nativesession) =>
          new Http2CapsuleParser({
            stream,
            nativesession,
            isclient: true
          })
      }),
      reliable: true
    }
    this.jsobj.onHttpWTSessionVisitor(retObj)
  }

  closeClient() {
    if (this.clientInt) this.clientInt.close()
  }
}
