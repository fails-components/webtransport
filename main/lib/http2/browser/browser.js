import { Http2WebTransportSession } from '../session.js'
import { BrowserParser } from './browserparser.js'

export class Http2WebTransportBrowser {
  /**
   * @param {import('../../types.js').NativeClientOptions} args
   */
  constructor(args) {
    this.port = args?.port || 443
    this.hostname = args?.host || 'localhost'
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
      this.clientInt = new WebSocket(url, ['webtransport'])
    } catch (error) {
      this.jsobj.onClientConnected({
        success: false
      })

      return
    }
    this.clientInt.binaryType = 'arraybuffer'

    this.clientInt.addEventListener('open', (event) => {
      if (this.clientInt?.protocol === 'webtransport') {
        this.jsobj.onClientWebTransportSupport({})
        this.jsobj.onClientConnected({
          success: true
        })
      } else {
        if (this.clientInt) this.clientInt.close()
        this.jsobj.onClientConnected({
          success: false
        })
      }
    })

    this.clientInt.addEventListener('error', () => {
      this.jsobj.onClientConnected({
        success: false
      })
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
            isclient: true
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
        }
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
