import { existsSync } from 'fs'
import { createRequire } from 'module'
import * as path from 'path'
import * as url from 'url'
import { arch, platform } from 'node:process'
import { logger } from './utils.js'

const log = logger(`webtransport:native(${process.pid})`)

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
console.log('load binary 1', wtpath)
log('load webtransport binary:', wtpath)
let wtroutermod
try {
  wtroutermod = require(wtpath)
} catch (error) {
  console.log('problem loading module', error)
}

export const wtrouter = wtroutermod
console.log('load binary 2', wtpath)
export const quicheInit = wtrouter.quicheInit
