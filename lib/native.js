import { existsSync } from 'fs'
import { createRequire } from 'module'
import * as path from 'path'
import * as url from 'url'
import { arch, platform } from 'node:process'

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

console.log('load webtransport binary:', wtpath)

export const wtrouter = require(wtpath)
