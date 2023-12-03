import { WebTransportPolyfill } from '../../lib/webtransport.browser'

/** @type {import('../../lib/dom').WebTransport} */
// @ts-ignore
// eslint-disable-next-line no-undef
let webtransport = WebTransport
if (process.env.USE_POLYFILL === 'true') {
  // @ts-ignore
  webtransport = WebTransportPolyfill
}

export default webtransport // eslint-disable-line no-undef
