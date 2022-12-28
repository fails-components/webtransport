import { Http3WebTransport } from './transport.js'
import { Http3WTStream } from './stream.js'
import { Http3WTSession } from './session.js'
import { wtrouter } from './native.js'
import { logger } from './utils.js'

const log = logger(`webtransport:event-loop(${process.pid})`)

export class Http3EventLoop {
  /** @type {Http3EventLoop | null} */
  static globalLoop = null

  constructor() {
    this.eventloopInt = new wtrouter.Http3EventLoop({
      transportCallback: Http3WebTransport.transportCallback,
      streamCallback: Http3WTStream.callback,
      sessionCallback: Http3WTSession.callback,
      eventloopCallback: Http3EventLoop.callback
    })
    this.eventloopInt.jsobj = this

    this.refObjects = new Set()
    this.loopGuardian = this.loopGuardian.bind(this)
  }

  startEventLoop() {
    log('start GlobalEventLoop')
    this.eventloopInt.startEventLoop()
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
   * @returns {Http3EventLoop}
   */
  static createGlobalEventLoop() {
    if (!Http3EventLoop.globalLoop) {
      Http3EventLoop.globalLoop = new Http3EventLoop()
      Http3EventLoop.globalLoop.startEventLoop()
      log('createGlobalEventLoop')
    }
    return Http3EventLoop.globalLoop
  }

  /**
   * @param {any} object
   * @returns {Http3EventLoop}
   */
  static getGlobalEventLoop(object) {
    if (!object) throw new Error('getGlobalEventLoop without reference object')
    const loop =
      Http3EventLoop.globalLoop ?? Http3EventLoop.createGlobalEventLoop()
    loop.refObjects.add(new WeakRef(object))
    return loop
  }
}
