import { expect } from 'chai'
import { Http3EventLoop } from '../lib/event-loop.js'

describe('event-loop', () => {
  beforeEach(() => {
    if (Http3EventLoop.globalLoop != null) {
      // shut down loop, otherwise we have to wait for
      // it to time out which takes a long time.
      Http3EventLoop.globalLoop.shutdownEventLoop()
    }
  })

  it('should start and stop the event loop', () => {
    expect(Http3EventLoop.globalLoop).to.be.null

    Http3EventLoop.createGlobalEventLoop()
    expect(Http3EventLoop.globalLoop).to.not.be.null

    Http3EventLoop.globalLoop?.shutdownEventLoop()
    expect(Http3EventLoop.globalLoop).to.be.null
  })
})
