'use strict';

// @ts-ignore
let streamiter 
try {
  // @ts-ignore
  streamiter = require("stream/iter");
} catch (error) {
  streamiter = undefined;
}

/**
 * Symbol for Drainable protocol - object can signal when backpressure
 * clears. Used to bridge event-driven sources that need drain notification.
 */
const drainableProtocol = streamiter?.drainableProtocol || Symbol.for('Stream.drainableProtocol');

module.exports = {
  drainableProtocol,
};
