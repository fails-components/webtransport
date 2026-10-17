export class WebTransportError extends Error {
  /**
   * @param {string} message
   */
  constructor(message) {
    super(message)

    this.name = /** @type {any} */ (this)[Symbol.toStringTag] =
      'WebTransportError'
  }
}
