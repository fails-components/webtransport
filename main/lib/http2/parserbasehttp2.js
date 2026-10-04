import { ParserBase } from './parserbase.js'

/**
 * @typedef {import('node:http2').Http2Stream} Http2Stream
 */

export class ParserBaseHttp2 extends ParserBase {
  /**
   * @param {import('../types').ParserHttp2Init} stream
   */
  constructor({
    stream,
    nativesession,
    isclient,
    initialStreamSendWindowOffsetBidi,
    initialStreamSendWindowOffsetUnidi,
    initialStreamReceiveWindowOffset,
    streamShouldAutoTuneReceiveWindow,
    streamReceiveWindowSizeLimit
  }) {
    super({
      nativesession,
      isclient,
      initialStreamSendWindowOffsetBidi,
      initialStreamSendWindowOffsetUnidi,
      initialStreamReceiveWindowOffset,
      streamShouldAutoTuneReceiveWindow,
      streamReceiveWindowSizeLimit
    })
    this.stream = stream
    this.session = nativesession
    this.isclient = isclient

    this.stream.on('readable', () => {
      let data
      while ((data = this.stream.read()) !== null) {
        this.parseData([data])
      }
    })

    this.stream.on('end', () => {
      // readable end
    })

    this.stream.on(
      'error',
      /**
       * @param {Error} error
       */ (error) => {
        // readable error
        if (
          !(
            this.session.jsobj.state === 'failed' ||
            this.session.jsobj.state === 'closed'
          )
        ) {
          this.session.jsobj.onClose({
            errorcode: this.stream.rstCode,
            error: error.toString()
          })
        }
      }
    )

    this.stream.on('drain', () => {
      // writable, can write more data
      this.blocked = false
      this.drainWrites()
    })

    this.stream.on('close', () => {
      if (
        !(
          this.session.jsobj.state === 'failed' ||
          this.session.jsobj.state === 'closed'
        )
      ) {
        // writable close
        this.session.jsobj.onClose({
          errorcode: this.stream.rstCode || 0,
          error: ''
        })
      }
    })
  }
}
