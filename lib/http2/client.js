import { connect } from 'node:http2'
import { HttpWebTransport } from '../transport.js'
import { Http2WebTransportSession } from './session.js'
import { log } from 'node:console'

export class Http2WebTransportClient {
  /**
   * @param {import('../types').NativeClientOptions} args
   */
  constructor(args) {
    this.port = args?.port || 443
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
          727725891: 1 // SETTINGS_WEBTRANSPORT_MAX_SESSIONS, TODO fix number
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
        purpose: 'ClientConnected',
        success: true,
        object: this // My client
      }
      connected = true
      HttpWebTransport.transportCallback(retObj)
    })
    this.clientInt.on('error', (error) => {
      log('http2 client error:', error)
      if (!connected) {
        const retObj = {
          purpose: 'ClientConnected',
          success: false,
          object: this // My client
        }
        HttpWebTransport.transportCallback(retObj)
      }
    })
    this.clientInt.on('remoteSettings', (settings) => {
      if (settings.enableConnectProtocol && this.clientInt) {
        // if (settings.webtansportmaxsessions)
        // eslint-disable-next-line no-lone-blocks
        {
          const retObj = {
            purpose: 'ClientWebtransportSupport',
            object: this // My client
          }
          HttpWebTransport.transportCallback(retObj)
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
      purpose: 'Http2WTSessionVisitor',
      header: stream.sentHeaders,
      session: new Http2WebTransportSession({ stream, isclient: true }),
      reliable: true,
      object: this // My client
    }
    HttpWebTransport.transportCallback(retObj)
  }

  closeClient() {
    if (this.clientInt) this.clientInt.close()
  }
}
