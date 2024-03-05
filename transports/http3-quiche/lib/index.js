import { existsSync } from 'fs'
import { createRequire } from 'module'
import * as path from 'path'
import * as url from 'url'
import { arch, platform } from 'node:process'
import { logger } from './utils.js'

const log = logger(`webtransport:native(${process?.pid})`)

const binplatform = platform + '_' + arch
const require = createRequire(import.meta.url)
const dirname = url.fileURLToPath(new URL('.', import.meta.url))
let buildpath = '../build_' + binplatform

if (!existsSync(path.join(dirname, buildpath))) buildpath = '../build' // use precompiled only if own compilation does not exist

let wtpath = buildpath + '/Release/webtransport.node'

if (
  process.env.NODE_ENV !== 'production' &&
  existsSync(path.join(dirname, buildpath + '/Debug/webtransport.node'))
) {
  wtpath = buildpath + '/Debug/webtransport.node'
}
log('load webtransport binary:', wtpath)

export const wtrouter = require(wtpath)
export const quicheInit = wtrouter.quicheInit

let quicheInited = false

/**
 * @param {{quicheLogVerbose?: 1 | 2 | 3, path?: string}} [args]
 */
export const checkQuicheInit = function (args) {
  if (!quicheInited) {
    quicheInit({
      quicheLogVerbose: args?.quicheLogVerbose ? args.quicheLogVerbose : -1
    })
    quicheInited = true
  }
}

export const Http3WebTransportClient = wtrouter.Http3WebTransportClient
export const Http3WebTransportServer = wtrouter.Http3WebTransportServer
export { Http3WebTransportClientSocket } from './clientsocket.js'
export { Http3WebTransportServerSocket } from './serversocket.js'
