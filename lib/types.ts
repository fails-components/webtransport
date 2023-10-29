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
  notifySessionDraining: () => void
  close: (arg: { code: number, reason: string }) => void
}

/**
 * Native HttpWTStream counterpart
 */
export interface NativeHttpWTStream {
  jsobj: WebTransportStreamEventHandler
  readbuffer: ArrayBuffer | undefined
  startReading: () => void
  stopReading: () => void
  updateReadPos: (bytesread: number, pos: number) => void
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
  host: string
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
  object?: NativeHttpWTStream
  purpose?: 'StreamRecvSignal'
  code: number
  nettask: NetTask
}

export interface StreamReadEvent {
  object?: NativeHttpWTStream
  purpose?: 'StreamRead'
  buffergrow?: number
  fin?: boolean
  success?: boolean
}

export interface StreamWriteEvent {
  object?: NativeHttpWTStream
  purpose?: 'StreamWrite'
  success?: boolean
}

export interface StreamNetworkFinishEvent {
  object?: NativeHttpWTStream
  purpose?: 'StreamNetworkFinish'
  nettask: NetTask
}

export interface WebTransportStreamEventHandler {
  onStreamRecvSignal: (evt: StreamRecvSignalEvent) => void
  onStreamRead: (evt: StreamReadEvent) => void
  onStreamWrite: (evt: StreamWriteEvent) => void
  onStreamNetworkFinish: (evt: StreamNetworkFinishEvent) => void
}

export interface SessionReadyEvent {
  object?: NativeHttpWTSession
  purpose?: 'SessionReady'
}

export interface SessionCloseEvent {
  object?: NativeHttpWTSession
  purpose?: 'SessionClose'
  errorcode: number
  error: string
}

export interface SessionStatsEvent {
  object?: NativeHttpWTSession
  purpose?: 'SessionStats'
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
  object?: NativeHttpWTSession
  purpose?: 'DatagramStats'
  timestamp: number
  expiredOutgoing: bigint
  lostOutgoing: bigint
}

export interface DatagramReceivedEvent {
  object?: NativeHttpWTSession
  purpose?: 'DatagramReceived'
  datagram: Uint8Array
}

export interface DatagramSendEvent {
  object?: NativeHttpWTSession
  purpose?: 'DatagramSend'
}

export interface GoawayReceivedEvent {
  object?: NativeHttpWTSession
  purpose?: 'GoawayReceived'
}

export interface NewStreamEvent {
  object?: NativeHttpWTSession
  purpose?: 'Http2WTStreamVisitor' | 'Http3WTStreamVisitor'
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
  purpose?: 'ClientConnected'
  success: boolean
}

export interface ClientWebtransportSupportEvent {
  purpose?: 'ClientWebtransportSupport'
}

export interface HttpWTSessionVisitorEvent {
  purpose?: 'Http2WTSessionVisitor' | 'Http3WTSessionVisitor'
  session: NativeHttpWTSession
  reliable?: boolean
}

export interface HttpClientEventHandler {
  onClientConnected: (evt: ClientConnectedEvent) => void
  onClientWebTransportSupport: (evt: ClientWebtransportSupportEvent) => void
  onHttpWTSessionVisitor: (evt: HttpWTSessionVisitorEvent) => void
}

export interface HttpWTServerSessionVisitorEvent extends HttpWTSessionVisitorEvent {
  path: string
  header: Object
}

export interface ServerSessionRequestEvent {
  purpose?: 'SessionRequest'
  header: Object
  promise: any
  session: any
  object: any // the actual transport object itself, actually present on all messages, but required here
}

/**
 * The Http server is listening on the specified port
 */
export interface HttpServerListeningEvent {
  purpose?: 'HttpServerListening'
}

/**
 * The Http server has stopped listening on the specified port
 */
 export interface ServerStatusEvent {
  port?: number
  host?: string
  purpose?: 'ServerStatus',
  status: 'error' | 'listening' | 'close'
}


export interface HttpServerEventHandler {
  onHttpWTSessionVisitor: (evt: HttpWTServerSessionVisitorEvent) => void
  onServerError: () => void
  onServerListening: () => void
  onServerClose: () => void
  onServerStatus: (evt: ServerStatusEvent) => void
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
  nativesession: any
}

export interface ReadDataInt {
  data: Uint8Array
  fin: boolean
}
