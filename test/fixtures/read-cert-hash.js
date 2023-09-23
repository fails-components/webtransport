/**
 * @param {string} [certHash]
 * @returns {Uint8Array}
 */
export function readCertHash(certHash) {
  return Uint8Array.from(`${certHash}`.split(':').map((i) => parseInt(i, 16)))
}
