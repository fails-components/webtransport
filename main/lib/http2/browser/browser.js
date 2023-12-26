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
    this.initialStreamFlowControlWindow =
      args?.initialStreamFlowControlWindow || 16 * 1024 // 16 KB
    this.initialSessionFlowControlWindow =
      args?.initialSessionFlowControlWindow || 16 * 1024 // 16 KB

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
  }

  /**
   * @param {{path: string}} arg
   */
  createTransport({ path }) {
    try {
      let url = 'wss://' + this.hostname + ':' + this.port
      if (path) url = url + '/' + path
      // eslint-disable-next-line no-undef
      this.clientInt = new WebSocket(
        url,
        supportedVersions.map(
          (/** @type {string} */ el) => 'webtransport_' + el
        )
      )
    } catch (error) {
      log('Failed on WebTransport/Websocket:', error)
      this.jsobj.onClientConnected({
        success: false
      })

      return
    }
    this.clientInt.binaryType = 'arraybuffer'

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
        aprotocol.length !== 2 ||
        aprotocol[0] !== 'webtransport' ||
        !supportedVersions.includes(aprotocol[1])
      ) {
        if (this.clientInt) this.clientInt.close()
        this.jsobj.onClientConnected({
          success: false
        })
      } else {
        this.jsobj.onClientWebTransportSupport({})
        this.jsobj.onClientConnected({
          success: true
        })
      }
    })

    this.clientInt.addEventListener('error', (error) => {
      log('Failed on WebTransport/Websocket:', error)
      if (this.jsobj?.sessionobjint?.state === 'connecting')
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
            initialStreamSendWindowOffset: this.initialStreamFlowControlWindow,
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
              }
              nativesession.jsobj.onClose({
                errorcode: code,
                error
              })
            })
          return session
        },
        sendWindowOffset: this.sessionFlowControlWindowSizeLimit,
        receiveWindowOffset: this.sessionFlowControlWindowSizeLimit,
        shouldAutoTuneReceiveWindow: this.sessionShouldAutoTuneReceiveWindow,
        receiveWindowSizeLimit: this.sessionFlowControlWindowSizeLimit
      }),
      reliable: true
    }
    this.jsobj.onHttpWTSessionVisitor(retObj)

    // @ts-ignore
    sessobj.jsobj.onReady({})
  }

  closeClient() {
    if (this.clientInt && this.clientInt.readyState === 1)
      this.clientInt.close()
  }
}
