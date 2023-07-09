class TimeoutError extends Error {
  /**
   * @param {string} message
   */
  constructor(message) {
    super(message)

    this.name = this[Symbol.toStringTag] = 'TimeoutError'
  }
}

/**
 * @template T
 * @param {Promise<T>} promise
 * @param {number} timeout
 * @returns {Promise<T>}
 */
export async function pTimeout(promise, timeout) {
  let ref

  const value = await Promise.race([
    promise,
    new Promise((resolve, reject) => {
      ref = setTimeout(() => {
        reject(new TimeoutError('timeout'))
      }, timeout)
    })
  ])

  clearTimeout(ref)

  return value
}
