import {
  WebTransportPolyfill,
  WebTransportPonyfill
} from '../../lib/webtransport.browser'

/** @type {import('../../lib/dom').WebTransport} */
// @ts-ignore
// eslint-disable-next-line no-undef
let webtransport = globalThis.WebTransport
if (process.env.USE_POLYFILL === 'true') {
  // @ts-ignore
  webtransport = WebTransportPolyfill
}

if (process.env.USE_PONYFILL === 'true') {
  // @ts-ignore
  webtransport = WebTransportPonyfill
}

export default webtransport // eslint-disable-line no-undef
