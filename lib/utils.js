import debug from 'debug'

/**
 * @template {unknown} T
 * @returns {import('./types').Deferred<T>}
 */
export function defer() {
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
 * @param {string} name
 * @returns {import('./types').Logger}
 */
export function logger (name) {
  return Object.assign(debug(name), {
    error: debug(`${name}:error`),
    trace: process.env.DEBUG_TRACE ? debug(`${name}:trace`) : () => {}
  })
}
