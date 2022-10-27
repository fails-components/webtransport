// Types taken from https://www.w3.org/TR/webtransport
// These can be removed when they are added to the default typescript types

export interface WebTransportDatagramStats {
  timestamp: number
  expiredOutgoing: bigint
  droppedIncoming: bigint
  lostOutgoing: bigint
}

export interface WebTransportStats {
  timestamp: number
  bytesSent: bigint
  packetsSent: bigint
  packetsLost: bigint
  numOutgoingStreamsCreated: number
  numIncomingStreamsCreated: number
  bytesReceived: bigint
  packetsReceived: bigint
  smoothedRtt: number
  rttVariation: number
  minRtt: number
  datagrams: WebTransportDatagramStats
}

export interface WebTransportCloseInfo {
  closeCode: number
  reason: string
}

export interface WebTransportDatagramDuplexStream {
  readable: ReadableStream<Uint8Array>
  writable: WritableStream<Uint8Array>
  readonly maxDatagramSize: number
  incomingMaxAge?: number
  outgoingMaxAge?: number
  incomingHighWaterMark: number
  outgoingHighWaterMark: number
}

export interface WebTransportBidirectionalStream {
  readonly readable: ReadableStream<Uint8Array>
  readonly writable: WritableStream<Uint8Array>
}

export interface  WebTransportSendStreamStats {
  timestamp: number
  bytesWritten: bigint
  bytesSent: bigint
  bytesAcknowledged: bigint
}

export interface WebTransportSendStream extends WritableStream<Uint8Array> {
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

export interface WebTransportHash {
  algorithm: string
  value: BufferSource
}

export interface WebTransportOptions {
  allowPooling?: boolean
  requireUnreliable?: boolean
  serverCertificateHashes?: WebTransportHash[]
}

export interface WebTransport {
  getStats: () => Promise<WebTransportStats>
  readonly ready: Promise<void>
  readonly reliability: WebTransportReliabilityMode
  readonly closed: Promise<WebTransportCloseInfo>
  close: (closeInfo?: WebTransportCloseInfo) => void
  readonly datagrams: WebTransportDatagramDuplexStream

  createBidirectionalStream: () => Promise<WebTransportBidirectionalStream>
  /* a ReadableStream of WebTransportBidirectionalStream objects */
  readonly incomingBidirectionalStreams: ReadableStream<WebTransportBidirectionalStream>

  createUnidirectionalStream: () => Promise<WebTransportSendStream>
  /* a ReadableStream of WebTransportReceiveStream objects */
  readonly incomingUnidirectionalStreams: ReadableStream<WebTransportReceiveStream>
}

export type WebTransportReliabilityMode = 'pending' | 'reliable-only' | 'supports-unreliable'
