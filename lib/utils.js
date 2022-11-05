import * as url from 'url'
import { arch, platform } from 'node:process'

/**
 * Allows deferring the resolution of a value
 * until later.
 *
 * @template {unknown} T
 * @returns {import('./types').Deferred<T>}
 */
export function defer () {
  /** @type {(value?: T) => void} */
  let res = () => {}

  /** @type {(reason?: Error) => void} */
  let rej = () => {}

  const promise = new Promise((resolve, reject) => {
    res = resolve
    rej = reject
  })

  return {
    promise,
    resolve: res,
    reject: rej
  }
}

/**
 * Returns search paths for the webtransport.node binary in
 * order - callers should load the first path that exists
 *
 * @param {boolean} [includeDebug]
 * @returns
 */
export function findWTBinaryPaths (includeDebug) {
  const dirname = url.fileURLToPath(new URL('..', import.meta.url))

  /** @type {string[]} */
  const wtpaths = [
    `${dirname}build/Release/webtransport.node`, // precompiled version
    `${dirname}build_${platform}_${arch}/Release/webtransport.node` // development version
  ]

  if (platform === 'darwin') {
    // try universal binary if available
    wtpaths.unshift(...[
      `${dirname}build_darwin_universal/Release/webtransport.node`
    ])
  }

  // add debug paths
  if (includeDebug === true) {
    wtpaths.unshift(`${dirname}build_${platform}_${arch}/Debug/webtransport.node`)

    // try universal binary if available
    if (platform === 'darwin') {
      wtpaths.unshift(...[
        `${dirname}build_darwin_universal/Debug/webtransport.node`
      ])
    }
  }

  return wtpaths
}
