import { HttpWebTransport } from './transport.js'
import { HttpWTStream } from './stream.js'
import { HttpWTSession } from './session.js'
import { wtrouter } from './native.js'
import { logger } from './utils.js'

const log = logger(`webtransport:event-loop(${process.pid})`)

export class Http3EventLoop {
  /** @type {Http3EventLoop | null} */
  static globalLoop = null

  /**
   * @param {{ quicheLogVerbose: any; } | undefined} [args]
   */
  constructor(args) {
    this.eventloopInt = new wtrouter.Http3EventLoop({
      transportCallback: HttpWebTransport.transportCallback,
      streamCallback: HttpWTStream.callback,
      sessionCallback: HttpWTSession.callback,
      eventloopCallback: Http3EventLoop.callback,
      quicheLogVerbose: args?.quicheLogVerbose
    })
    this.eventloopInt.jsobj = this

    this.refObjects = new Set()
    this.loopGuardian = this.loopGuardian.bind(this)
  }

  /**
   * @param {*} [args]
   */
  startEventLoop(args) {
    log('start GlobalEventLoop')
    this.eventloopInt.startEventLoop(args)
    this.loopGuardianTimer = setInterval(this.loopGuardian, 5000)
  }

  shutdownEventLoop() {
    log('shutdown GlobalEventLoop')
    Http3EventLoop.globalLoop = null
    clearInterval(this.loopGuardianTimer)
    this.eventloopInt.shutDownEventLoop()
  }

  loopGuardian() {
    for (const item of this.refObjects) {
      if (typeof item.deref() === 'undefined' || item.deref()?.stopped)
        this.refObjects.delete(item)
    }
    if (this.refObjects.size === 0) {
      const now = Date.now()
      if (!this.refObjectsEmptyTime) this.refObjectsEmptyTime = now
      else if (now - this.refObjectsEmptyTime > 20 * 1000)
        this.shutdownEventLoop()
    } else if (this.refObjectsEmptyTime) delete this.refObjectsEmptyTime
  }

  static callback() {
    log('final eventloop callback called')
  }

  /**
   * @param {any} [args]
   * @returns {Http3EventLoop}
   */
  static createGlobalEventLoop(args) {
    if (!Http3EventLoop.globalLoop) {
      Http3EventLoop.globalLoop = new Http3EventLoop()
      Http3EventLoop.globalLoop.startEventLoop(args)
      log('createGlobalEventLoop')
    }
    return Http3EventLoop.globalLoop
  }

  /**
   * @param {any} object
   * @param {any} args
   * @returns {Http3EventLoop}
   */
  static getGlobalEventLoop(object, args) {
    if (!object) throw new Error('getGlobalEventLoop without reference object')
    const loop =
      Http3EventLoop.globalLoop ?? Http3EventLoop.createGlobalEventLoop(args)
    loop.refObjects.add(new WeakRef(object))
    return loop
  }
}
