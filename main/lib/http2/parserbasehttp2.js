import { ParserBase } from './parserbase.js'

/**
 * @typedef {import('node:http2').Http2Stream} Http2Stream
 */

/** @typedef {import('./parserbase.js').ParserInit} ParserInit */
/**
 * @typedef {ParserInit & { stream: Http2Stream }} ParserHttp2Init
 */

export class ParserBaseHttp2 extends ParserBase {
  /**
   * @param {ParserHttp2Init} stream
   */
  constructor({
    stream,
    nativesession,
    sessionControlable,
    isclient,
    initialStreamSendWindowOffsetBidi,
    initialStreamSendWindowOffsetUnidi,
    initialStreamReceiveWindowOffset,
    streamShouldAutoTuneReceiveWindow,
    streamReceiveWindowSizeLimit
  }) {
    super({
      nativesession,
      sessionControlable,
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
        this.sessionControlable.receiveClose({
          code: this.stream.rstCode,
          reason: error.toString()
        })
      }
    )

    this.stream.on('drain', () => {
      // writable, can write more data
      this.blocked = false
      this.drainWrites()
    })

    this.stream.on('close', () => {
      // writable close
      this.sessionControlable.receiveClose({
        code: this.stream.rstCode || 0,
        reason: ''
      })
    })
  }
}
