import type { WebTransport, WebTransportHash, WebTransportOptions } from './dom'
import type { IncomingHttpHeaders, Http2Stream } from 'http2'


/**
 * Native HttpWTSession counterpart
 */
 export interface NativeHttpWTSession {
  jsobj: WebTransportSessionEventHandler
  writeDatagram: (chunk: Uint8Array) => void
  orderUnidiStream: () => void
  orderBidiStream: () => void
  orderSessionStats: () => void
  orderDatagramStats: () => void
  notifySessionDraining(): () => void
  close: (arg: { code: number, reason: string }) => void
}

/**
 * Native HttpWTStream counterpart
 */
export interface NativeHttpWTStream {
  updateReadPos(bytesread: Number, pos: Number): unknown
  jsobj: WebTransportStreamEventHandler
  readbuffer: Uint8Array | undefined
  startReading: () => void
  stopReading: () => void
  stopSending: (code: number) => void
  resetStream: (code: number) => void
  writeChunk: (buf: Uint8Array) => void
  streamFinal: () => void
}

export interface NativeServerOptions {
  port: number | 443
  secret?: string
  host: string
  cert: string
  privKey: string
}

export interface NativeClientOptions {
  port: number
  hostname: string
  serverCertificateHashes: WebTransportHash[]
  localPort: number
  allowPooling: boolean
  forceIpv6: boolean
}

export interface NativeFinishSessionRequest {
   header: IncomingHttpHeaders
   session: Http2Stream
   status: number 
}

export type Purpose = 'StreamRecvSignal' | 'StreamRead' | 'StreamWrite' | 'StreamReset' | 'StreamNetworkFinish'
export type NetTask = 'stopSending' | 'resetStream' | 'streamFinal'

export interface StreamRecvSignalEvent {
  code: number
  nettask: NetTask
}

export interface StreamReadEvent {
  buffergrow?: number
  fin?: boolean
  success?: boolean
}

export interface StreamWriteEvent {
}

export interface StreamResetEvent {
}

export interface StreamNetworkFinishEvent {
  nettask: NetTask
}

export interface WebTransportStreamEventHandler {
  onStreamRecvSignal: (evt: StreamRecvSignalEvent) => void
  onStreamRead: (evt: StreamReadEvent) => void
  onStreamWrite: (evt: StreamWriteEvent) => void
  onStreamNetworkFinish: (evt: StreamNetworkFinishEvent) => void
}

export interface SessionReadyEvent {
  object: NativeHttpWTSession
}

export interface SessionCloseEvent {
  errorcode: number
  error: string
}

export interface SessionStatsEvent {
  timestamp: number
  expiredOutgoing: bigint
  lostOutgoing: bigint

  // non Datagram
  minRtt: number
  smoothedRtt: number
  rttVariation: number
  estimatedSendRateBps: bigint
}

export interface DatagramStatsEvent {
  timestamp: number
  expiredOutgoing: bigint
  lostOutgoing: bigint
}

export interface DatagramReceivedEvent {
  datagram: Uint8Array
}

export interface DatagramSendEvent {
}

export interface GoawayReceivedEvent {
}

export interface NewStreamEvent {
  stream: NativeHttpWTStream
  bidirectional: boolean
  incoming: boolean
}

export interface WebTransportSessionEventHandler {
  onReady: (evt: SessionReadyEvent) => void
  onClose: (evt: SessionCloseEvent) => void
  onDatagramReceived: (evt: DatagramReceivedEvent) => void
  onDatagramSend: (evt: DatagramSendEvent) => void
  onGoAwayReceived: (evt: GoawayReceivedEvent) => void
  onSessionStats: (evt: SessionStatsEvent) => void
  onDatagramStats: (evt: DatagramStatsEvent) => void
  onStream: (evt: NewStreamEvent) => void
  closeHook?: (() => void) | null
}

export interface ClientConnectedEvent {
  success: boolean
}

export interface ClientWebtransportSupportEvent {
}

export interface HttpWTSessionVisitorEvent {
  session: NativeHttpWTSession
}

export interface HttpClientEventHandler {
  onClientConnected: (evt: ClientConnectedEvent) => void
  onClientWebTransportSupport: (evt: ClientWebtransportSupportEvent) => void
  onHttpWTSessionVisitor: (evt: HttpWTSessionVisitorEvent) => void
}

export interface HttpWTServerSessionVisitorEvent extends HttpWTSessionVisitorEvent {
  path: string
  object: any
  header?: any
}

export interface ServerSessionRequestEvent {
  header: Object
  promise: any
  session: any
  object: any // the actual transport object itself, actually present on all messages, but required here
}

export interface UDPServerSocketSend {
  msg:  Uint8Array
  offset: number
  length: number
  port:number
  address: string
}

/**
 * The Http server is listening on the specified port
 */
export interface HttpServerListeningEvent {
  port: number | undefined
  host: string | undefined
}


export interface HttpServerEventHandler {
  onHttpWTSessionVisitor: (evt: HttpWTServerSessionVisitorEvent) => void
  onServerError: (error?: Error) => void
  onServerListening: (evt: HttpServerListeningEvent) => void
  onServerClose: () => void
}

/**
 * A defered promise with the value T
 */
export interface Deferred<T = unknown> {
  promise: Promise<T>
  resolve: (value?: T) => void
  reject: (reason?: any) => void
}

// https://www.w3.org/TR/webtransport/#dom-webtransport-state-slot
export type WebTransportSessionState =  'connecting' | 'connected' | 'draining' | 'closed' | 'failed'

export interface WebTransportSession extends WebTransport {
  state: WebTransportSessionState
}

export interface HttpWebTransportInit extends WebTransportOptions {
  host: string
  port: string | number
  quicheLogVerbose?: number
  forceIpv6?: boolean
  localPort?: number
}

export type WebTransportServerReliability = 'unreliableOnly' | 'reliableOnly' | 'both'

// see HttpServerJS C++ type
export interface HttpServerInit extends HttpWebTransportInit {
  port: string | number
  host: string
  secret: string
  cert: string
  privKey: string
  maxConnections?: number
  initialStreamFlowControlWindow?: number
  initialSessionFlowControlWindow?: number
  reliability?: WebTransportServerReliability
}

// see HttpClientJS C++ type
export interface HttpClientInit extends HttpWebTransportInit {
  forceIpv6?: boolean
  localPort?: number
}

export interface Logger {
  (formatter: any, ...args: any[]): void
  error: (formatter: any, ...args: any[]) => void
  trace: (formatter: any, ...args: any[]) => void
}

export interface Http2CapsuleParserInit {
  stream: Http2Stream
  isclient: boolean
  sessioncallback: (args: SessionReadyEvent | SessionCloseEvent | DatagramReceivedEvent | DatagramSendEvent | GoawayReceivedEvent | NewStreamEvent) => void
  streamcallback: (args: StreamRecvSignalEvent | StreamReadEvent | StreamWriteEvent  | StreamNetworkFinishEvent) => void
  nativesession: any
}

export interface ReadDataInt {
  data: Uint8Array
  fin: boolean
}
