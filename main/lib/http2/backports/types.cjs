'use strict';

// @ts-ignore
let streamiter 
try {
  streamiter = require("stream/iter");
} catch (error) {
  if (error.code === 'MODULE_NOT_FOUND') {
    streamiter = undefined;
  } else {
    throw error;
  }
}

/**
 * Symbol for Drainable protocol - object can signal when backpressure
 * clears. Used to bridge event-driven sources that need drain notification.
 */
const drainableProtocol = streamiter?.drainableProtocol || Symbol.for('Stream.drainableProtocol');

module.exports = {
  drainableProtocol,
};
