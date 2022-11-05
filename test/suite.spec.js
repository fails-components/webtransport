import { Http3EventLoop } from '../lib/event-loop.js'

after(async () => {
  if (Http3EventLoop.globalLoop != null) {
    // shut down loop, otherwise we have to wait for
    // it to time out which takes a long time.
    Http3EventLoop.globalLoop.shutdownEventLoop()
  }
})
