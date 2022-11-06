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
