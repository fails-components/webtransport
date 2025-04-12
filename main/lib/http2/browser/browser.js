import { Http2WebTransportSession } from '../session.js'
import { BrowserParser } from './browserparser.js'
import { supportedVersions } from '../websocketcommon.js'
import { logger } from '../../utils.js'

const log = logger(`webtransport:http2:browser`)

export class Http2WebTransportBrowser {
  /**
   * @param {import('../../types.js').NativeClientOptions} args
   */
  constructor(args) {
    this.port = args?.port || 443
    this.hostname = args?.host || 'localhost'
    this.protocols = args?.protocols || []
    this.initialStreamFlowControlWindow =
      args?.initialStreamFlowControlWindow || 16 * 1024 // 16 KB
    this.initialSessionFlowControlWindow =
      args?.initialSessionFlowControlWindow || 16 * 1024 // 16 KB

    this.initialBidirectionalStreams =
      args?.initialBidirectionalSendStreams || 100
    this.initialUnidirectionalStreams =
      args?.initialUnidirectionalSendStreams || 100

    this.streamShouldAutoTuneReceiveWindow =
      args.streamShouldAutoTuneReceiveWindow || false
    this.streamFlowControlWindowSizeLimit =
      args?.streamFlowControlWindowSizeLimit || 6 * 1024 * 1024

    this.sessionShouldAutoTuneReceiveWindow =
      args.sessionShouldAutoTuneReceiveWindow || false
    this.sessionFlowControlWindowSizeLimit =
      args?.sessionFlowControlWindowSizeLimit || 15 * 1024 * 1024
    /** @type {import('../../session.js').HttpClient} */
    // @ts-ignore
    this.jsobj = undefined // the transport will set this
    /** @type {WebSocket} */
    // @ts-ignore
    this.clientInt = undefined
    /** @type {undefined|string} */
    this._webtransportProtocol = undefined
  }

  /**
   * @param {{path: string}} arg
   */
  createTransport({ path }) {
    try {
      let url = 'wss://' + this.hostname + ':' + this.port
      if (path) url = url + '/' + path

      let protocols = supportedVersions.map(
        (/** @type {string} */ el) => 'webtransport_' + el
      )
      if (this.protocols.length > 0) {
        protocols = protocols
          .filter((el) => el !== 'kDraft1')
          .map((el) => this.protocols.map((el2) => el + '_' + el2))
          .flat(1)
      }
      // eslint-disable-next-line no-undef
      this.clientInt = new WebSocket(url, protocols)
    } catch (error) {
      log('Failed on WebTransport/Websocket:', error)
      this.jsobj.onClientConnected({
        success: false
      })

      return
    }
    this.clientInt.binaryType = 'arraybuffer'
    // eslint-disable-next-line no-unused-vars
    this.clientInt.addEventListener('open', (event) => {
      const protocol = this.clientInt?.protocol
      if (!protocol) {
        if (this.clientInt) this.clientInt.close()
        this.jsobj.onClientConnected({
          success: false
        })
      }
      const aprotocol = protocol.split('_')
      if (
        !(aprotocol.length === 2 || aprotocol.length >= 3) ||
        aprotocol[0] !== 'webtransport' ||
        !supportedVersions.includes(aprotocol[1])
      ) {
        if (this.clientInt) this.clientInt.close()
        this.jsobj.onClientConnected({
          success: false
        })
      } else {
        this._webtransportProtocol =
          aprotocol.length >= 3 ? aprotocol.slice(2).join('_') : undefined
        this.jsobj.onClientWebTransportSupport(
          aprotocol.length >= 3
            ? { selectedProtocol: aprotocol.slice(2).join('_') }
            : {}
        )
        this.jsobj.onClientConnected({
          success: true
        })
      }
    })

    this.clientInt.addEventListener('error', (error) => {
      log('Failed on WebTransport/Websocket:', error)
      if (
        !this.jsobj?.sessionobjint ||
        this.jsobj?.sessionobjint?.state === 'connecting'
      )
        this.jsobj.onClientConnected({
          success: false
        })
      else {
        if (this?.jsobj?.sessionobjint?.objint)
          this.jsobj.sessionobjint.close({
            closeCode: 0,
            reason: error.toString()
          })
      }
    })
  }

  /**
   * @param {string} path
   */
  // eslint-disable-next-line no-unused-vars
  openWTSession(path) {
    if (!this.clientInt) throw new Error('clientInt not present')
    let sessobj

    const retObj = {
      session: new Http2WebTransportSession({
        ws: this.clientInt,
        isclient: true,
        createParser: (
          /** @type {Http2WebTransportSession} */ nativesession
        ) => {
          sessobj = nativesession
          const session = new BrowserParser({
            ws: this.clientInt,
            nativesession,
            isclient: true,
            initialStreamSendWindowOffsetBidi: 0,
            initialStreamSendWindowOffsetUnidi: 0,
            initialStreamReceiveWindowOffset:
              this.initialStreamFlowControlWindow,
            streamShouldAutoTuneReceiveWindow:
              this.streamShouldAutoTuneReceiveWindow,
            streamReceiveWindowSizeLimit: this.streamFlowControlWindowSizeLimit
          })
          if (this.clientInt)
            this.clientInt.addEventListener('close', (event) => {
              let code = event.code
              let error = 'Session WebSocket closed'
              if (event.reason) {
                let tokens = event.reason.split(':')
                if (tokens.length > 1) {
                  code = parseInt(tokens[0])
                  tokens = tokens.slice(1)
                }
                error = tokens.join(':')
              } else {
                switch (code) {
                  case 1001:
                    error = 'Going Away'
                    break
                  case 1002:
                    error = 'Protocol error'
                    break
                  case 1003:
                    error = 'Unsupported data'
                    break
                  case 1004:
                    error = 'Reserved'
                    break
                  case 1005:
                    error = 'No Status Rcvd'
                    break
                  case 1006:
                    error = 'Abnormal Closure'
                    break
                  case 1007:
                    error = 'Invalid frame payload data'
                    break
                  case 1008:
                    error = 'Policy Violation'
                    break
                  case 1009:
                    error = 'Message Too Big'
                    break
                  case 1010:
                    error = 'Mandatory Ext.'
                    break
                  case 1011:
                    error = 'Internal error'
                    break
                  case 1012:
                    error = 'Service Restart'
                    break
                  case 1013:
                    error = 'Try Again Later'
                    break
                  case 1014:
                    error = 'Bad Gateway'
                    break
                  case 1015:
                    error = 'TLS handshake'
                    break
                  case 1000:
                  default:
                    error = ''
                    break
                }
              }
              nativesession.jsobj.onClose({
                errorcode: code,
                error
              })
            })
          return session
        },
        sendWindowOffset: 0,
        receiveWindowOffset: this.sessionFlowControlWindowSizeLimit,
        shouldAutoTuneReceiveWindow: this.sessionShouldAutoTuneReceiveWindow,
        receiveWindowSizeLimit: this.sessionFlowControlWindowSizeLimit,
        initialBidirectionalSendStreams: this.initialBidirectionalStreams, // TODO, once supported by node, use initial settings
        initialBidirectionalReceiveStreams: this.initialBidirectionalStreams,
        initialUnidirectionalSendStreams: this.initialUnidirectionalStreams, // TODO, once supported by node, use initial settings
        initialUnidirectionalReceiveStreams: this.initialUnidirectionalStreams
      }),
      reliable: true
    }
    this.jsobj.onHttpWTSessionVisitor(retObj)
    // @ts-ignore
    sessobj.jsobj.onReady(
      this._webtransportProtocol ? { protocol: this._webtransportProtocol } : {}
    )
  }

  closeClient() {
    if (this.clientInt && this.clientInt.readyState === 1)
      this.clientInt.close()
  }
}
