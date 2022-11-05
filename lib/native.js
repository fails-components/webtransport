import { existsSync } from 'fs'
import { createRequire } from 'module'
import { findWTBinaryPaths } from './utils.js'

const wtpaths = findWTBinaryPaths(process.env.NODE_ENV !== 'production')
const require = createRequire(import.meta.url)

let wtpath = wtpaths.find(str => existsSync(str))

if (!wtpath) {
  throw new Error('No webtransport binary found')
}

export const wtrouter = require(wtpath)
