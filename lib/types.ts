import type { WebTransport, WebTransportHash, WebTransportOptions } from './dom'
import type { IncomingHttpHeaders, Http2Stream } from 'http2'


/**
 * Native Http3WTSession counterpart
 */
 export interface NativeHttp3WTSession {
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
 * Native Http3WTStream counterpart
 */
export interface NativeHttp3WTStream {
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
  object: NativeHttp3WTSession
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
  stream: NativeHttp3WTStream
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

export interface Http3WTSessionVisitorEvent {
  session: NativeHttp3WTSession
}

export interface Http3ClientEventHandler {
  onClientConnected: (evt: ClientConnectedEvent) => void
  onClientWebTransportSupport: (evt: ClientWebtransportSupportEvent) => void
  onHttp3WTSessionVisitor: (evt: Http3WTSessionVisitorEvent) => void
}

export interface Http3WTServerSessionVisitorEvent extends Http3WTSessionVisitorEvent {
  path: string
  object: any
  header?: any
}

export interface ServerSessionRequestEvent {
  header: Object
  promise: any
  session: any
}

export interface UDPServerSocketSend {
  msg:  Uint8Array
  offset: number
  length: number
  port:number
  address: string
}

/**
 * The Http3 server is listening on the specified port
 */
export interface Http3ServerListeningEvent {
  port: number | undefined
  host: string | undefined
}



export interface Http3ServerEventHandler {
  onHttp3WTSessionVisitor: (evt: Http3WTServerSessionVisitorEvent) => void
  onServerError: (error?: Error) => void
  onServerListening: (evt: Http3ServerListeningEvent) => void
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

export interface Http3WebTransportInit extends WebTransportOptions {
  host: string
  port: string | number
  quicheLogVerbose?: number
  forceIpv6?: boolean
  localPort?: number
}

// see Http3ServerJS C++ type
export interface Http3ServerInit extends Http3WebTransportInit {
  port: string | number
  host: string
  secret: string
  cert: string
  privKey: string
  maxConnections?: number
  initialStreamFlowControlWindow?: number
  initialSessionFlowControlWindow?: number
}

// see Http3ClientJS C++ type
export interface Http3ClientInit extends Http3WebTransportInit {
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
