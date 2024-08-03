import {
  WebTransportPolyfill,
  WebTransportPonyfill
} from '@fails-components/webtransport'

/** @type {import('../../lib/dom').WebTransport} */
// @ts-ignore
let webtransport = globalThis.WebTransport
if (process.env.USE_POLYFILL === 'true') {
  // @ts-ignore
  webtransport = WebTransportPolyfill
}

if (process.env.USE_PONYFILL === 'true') {
  // @ts-ignore
  webtransport = WebTransportPonyfill
}

export default webtransport
