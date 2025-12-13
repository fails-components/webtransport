// Types taken from https://www.w3.org/TR/webtransport
// These can be removed when they are added to the default typescript types

export interface WebTransportDatagramStats {
  timestamp: number
  expiredOutgoing: number
  droppedIncoming: number
  lostOutgoing: number
}

export interface WebTransportStats {
  timestamp: number
  bytesSent: number
  packetsSent: number
  packetsLost: number
  numOutgoingStreamsCreated: number
  numIncomingStreamsCreated: number
  bytesReceived: number
  packetsReceived: number
  smoothedRtt: number
  rttVariation: number
  minRtt: number
  estimatedSendRate: number
  datagrams: WebTransportDatagramStats
}

export interface  WebTransportSendStreamStats {
  bytesWritten: number
  bytesSent: number
  bytesAcknowledged: number
}

export interface WebTransportSendGroup {
  getStats: () =>  Promise<WebTransportSendStreamStats>
}

export interface WebTransportCloseInfo {
  closeCode: number
  reason: string
}

export interface WebTransportDatagramsWritable extends WritableStream {
  sendGroup?: WebTransportSendGroup;
  sendOrder: number;
};

export interface WebTransportSendOptions {
  sendGroup?: WebTransportSendGroup;
  sendOrder: number;
};

export interface WebTransportDatagramDuplexStream {
  createWritable: (options?:  WebTransportSendOptions) => WebTransportDatagramsWritable;
  readable: ReadableStream<Uint8Array>
  readonly maxDatagramSize: number
  // incomingMaxAge?: number
  // outgoingMaxAge?: number
  // incomingHighWaterMark: number
  // outgoingHighWaterMark: number
}

export interface WebTransportSendStream extends WritableStream<Uint8Array> {
  sendGroup?: WebTransportSendGroup;
  sendOrder: number;
  getStats: () => Promise<WebTransportSendStreamStats>
}

export interface WebTransportReceiveStreamStats {
  timestamp: number
  bytesReceived: bigint
  bytesRead: bigint
}

export interface WebTransportReceiveStream extends ReadableStream<Uint8Array> {
  getStats: () => Promise<WebTransportReceiveStreamStats>
}

export interface WebTransportBidirectionalStream {
  readonly readable: WebTransportReceiveStream
  readonly writable: WebTransportSendStream
}

export interface WebTransportHash {
  algorithm: string
  value: BufferSource
}

export type DatagramsReadableMode = "bytes";

export interface WebTransportOptions {
  allowPooling?: boolean
  requireUnreliable?: boolean
  serverCertificateHashes?: WebTransportHash[]
  datagramsReadableMode?: DatagramsReadableMode;

  /**
   * Nonstandard option - when a new connection is opened, how long to wait for the quic handshake to complete in ms before rejecting or switching to http2
   */
  quicConnectTimeout?: number

   /**
    * Nonstandard option - when a new connection is opened, how long to wait for the webtransport handshake to complete in ms before rejecting or switching to http2
    */
  webTransportConnectTimeout?: number
  congestionControl?: WebTransportCongestionControl
  protocols?: string[] 
}

export interface WebTransportSendStreamOptions {
  sendGroup:  WebTransportSendGroup|null
  sendOrder?: number
  waitUntilAvailable?: boolean
}

export interface WebTransportSession {
  getStats: () => Promise<WebTransportStats>
  readonly ready: Promise<void>
  readonly reliability: WebTransportReliabilityMode
  readonly congestionControl: WebTransportCongestionControl
  readonly closed: Promise<WebTransportCloseInfo>
  readonly draining: Promise<undefined>
  close: (closeInfo?: WebTransportCloseInfo) => void
  readonly datagrams: WebTransportDatagramDuplexStream

  createBidirectionalStream: (opts?: WebTransportSendStreamOptions) => Promise<WebTransportBidirectionalStream>
  /* a ReadableStream of WebTransportBidirectionalStream objects */
  readonly incomingBidirectionalStreams: ReadableStream<WebTransportBidirectionalStream>

  createUnidirectionalStream: (opts?: WebTransportSendStreamOptions) => Promise<WebTransportSendStream>
  /* a ReadableStream of WebTransportReceiveStream objects */
  readonly incomingUnidirectionalStreams: ReadableStream<WebTransportReceiveStream>
}

export interface WebTransport extends WebTransportSession {
  readonly supportsReliableOnly: boolean
  readonly protocol: string | undefined
}

export type WebTransportReliabilityMode = 'pending' | 'reliable-only' | 'supports-unreliable'
export type WebTransportCongestionControl = 'default' | 'throughput' | 'low-latency';

