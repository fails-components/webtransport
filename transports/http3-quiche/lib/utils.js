import debug from 'debug'

/**
 * @param {string} name
 * @returns {import('./types').Logger}
 */
export function logger(name) {
  return Object.assign(debug(name), {
    error: debug(`${name}:error`),
    trace: process?.env.DEBUG_TRACE ? debug(`${name}:trace`) : () => {}
  })
}
