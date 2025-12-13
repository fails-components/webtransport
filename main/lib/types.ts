import type {
  WebTransportSession,
  WebTransportHash,
  WebTransportOptions,
  WebTransportSendStreamOptions,
  DatagramsReadableMode
} from './dom'
import type { IncomingHttpHeaders, Http2Stream, ServerHttp2Stream } from 'http2'
import { ParserBase } from './http2/parserbase'
import { Http2WebTransportSession } from './http2/session'
import { HttpClient } from './client'

/**
 * Native HttpWTSession counterpart
 */
export interface NativeHttpWTSession {
  jsobj: WebTransportSessionEventHandler
  sendInitialParameters?: () => void
  writeDatagram: (chunk: Uint8Array) => { code: 'success' | 'blocked' | 'internalError' | 'tooBig', message?: string}
  orderUnidiStream: (opts: WebTransportSendStreamOptions) => boolean
  orderBidiStream: (opts: WebTransportSendStreamOptions)  => boolean
  orderSessionStats: () => void
  orderDatagramStats: () => void
  notifySessionDraining: () => void
  getMaxDatagramSize: () => number
  close: (arg: { code: number; reason: string }) => void
}

/**
 * Native HttpWTStream counterpart
 */
export interface NativeHttpWTStream {
  jsobj: WebTransportStreamEventHandler
  readbuffer: ArrayBuffer | undefined
  sendInitialParameters?: () => void
  startReading: () => void
  drainReads: () => void
  stopReading: () => void
  stopSending: (code: number) => void
  resetStream: (code: number) => void
  writeChunk: (buf: Uint8Array) => void
  streamFinal: () => void
  updateSendOrderAndGroup: (args :{
    sendOrder: number,
    sendGroupId: bigint
  }) => void
}

export interface NativeServerOptions {
  port: number | 443
  secret?: string
  host: string
  cert: string
  certhttp2?: string // if http2 has a different cert
  privKey: string
  privKeyhttp2?: string // if http2 has a different cert
  initialBidirectionalSendStreams?: number
  initialBidirectionalReceiveStreams?: number
  initialUnidirectionalSendStreams?: number
  initialUnidirectionalReceiveStreams?: number
  initialStreamFlowControlWindow?: number
  streamShouldAutoTuneReceiveWindow?: boolean
  streamFlowControlWindowSizeLimit?: number
  initialSessionFlowControlWindow?: number
  sessionShouldAutoTuneReceiveWindow?: boolean
  sessionFlowControlWindowSizeLimit?: number
  initialBidirectionalStreams?: number
  initialUnidirectionalStreams?: number
}

export interface NativeClientOptions {
  port: number
  host: string
  serverCertificateHashes: WebTransportHash[]
  localPort: number
  allowPooling: boolean
  forceIpv6: boolean
  initialBidirectionalSendStreams?: number
  initialBidirectionalReceiveStreams?: number
  initialUnidirectionalSendStreams?: number
  initialUnidirectionalReceiveStreams?: number
  initialStreamFlowControlWindow?: number
  streamShouldAutoTuneReceiveWindow?: boolean
  streamFlowControlWindowSizeLimit?: number
  initialSessionFlowControlWindow?: number
  sessionShouldAutoTuneReceiveWindow?: boolean
  sessionFlowControlWindowSizeLimit?: number
  protocols?: string[]
}

export interface FlowControlable {
  sendWindowUpdate: (windowOffset: bigint) => void
  sendBlocked: (windowOffSet: bigint) => void
  connected: () => boolean
  closeConnection: (arg: { code: number; reason: string }) => void
  smoothedRtt: () => number
}

export interface StreamIdClient {
  canSendMaxStreams: () => boolean
  sendMaxStreams: (maxStreams: bigint, unidirectional: boolean) => void
}

export interface ReadBuffer {
  buffer?: Uint8Array
  readBytes?: number
  byob?: ReadableStreamBYOBRequest
  drained?: boolean
  fin: boolean
}

export interface NativeFinishSessionRequest {
  path: string
  header: IncomingHttpHeaders
  peerAddress: string
  session: ServerHttp2Stream
  status: number
  protocol: 'capsule' | 'websocket' | 'websocketoverhttp1' | 'http3'
  head?: Buffer
  userData?: object
  transportPrivate?: object,
  selectedProtocol?: string
}

export type Purpose =
  | 'StreamRecvSignal'
  | 'StreamRead'
  | 'StreamWrite'
  | 'StreamReset'
  | 'StreamNetworkFinish'
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
  success?: boolean
}

export interface StreamResetEvent {}

export interface StreamNetworkFinishEvent {
  nettask: NetTask
}

export interface WebTransportStreamEventHandler {
  onStreamRecvSignal: (evt: StreamRecvSignalEvent) => void
  onStreamWrite: (evt: StreamWriteEvent) => void
  onStreamNetworkFinish: (evt: StreamNetworkFinishEvent) => void
}

export interface SessionReadyEvent {
  object: NativeHttpWTSession
  protocol?: string
}

export interface SessionCloseEvent {
  errorcode: number
  error: string
}

export interface SessionStatsEvent {
  timestamp: number
  expiredOutgoing: number
  lostOutgoing: number

  // non Datagram
  minRtt: number
  smoothedRtt: number
  rttVariation: number
  estimatedSendRateBps: number
}

export interface DatagramStatsEvent {
  timestamp: number
  expiredOutgoing: number
  lostOutgoing: number
}

export interface DatagramReceivedEvent {
  datagram: Uint8Array
}

export interface GoawayReceivedEvent {}

export interface NewStreamEvent {
  stream: NativeHttpWTStream
  bidirectional: boolean
  incoming: boolean
  sendGroupId?: bigint;
  sendOrder: number;
}

export interface WebTransportSessionEventHandler {
  onReady: (evt: SessionReadyEvent) => void
  onClose: (evt: SessionCloseEvent) => void
  onDatagramReceived: (evt: DatagramReceivedEvent) => void
  onGoAwayReceived: (evt: GoawayReceivedEvent) => void
  onSessionStats: (evt: SessionStatsEvent) => void
  onDatagramStats: (evt: DatagramStatsEvent) => void
  onStream: (evt: NewStreamEvent) => void
  closeHook?: (() => void) | null
}

export interface ClientConnectedEvent {
  success: boolean
}

export interface ClientWebtransportSupportEvent {}

export interface HttpWTSessionVisitorEvent {
  session: NativeHttpWTSession
  reliable?: boolean
}

export interface HttpClientEventHandler {
  onClientConnected: (evt: ClientConnectedEvent) => void
  onClientWebTransportSupport: (evt: ClientWebtransportSupportEvent) => void
  onHttpWTSessionVisitor: (evt: HttpWTSessionVisitorEvent) => void
}

export interface HttpWTServerSessionVisitorEvent
  extends HttpWTSessionVisitorEvent {
  path: string
  header: Object
  peerAddress: string
  userData?: Object | undefined
}

export interface ServerSessionRequestEvent {
  header: Object
  head?: Buffer | undefined
  promise?: any
  session: any
  object?: any // the actual transport object itself, actually present on all messages, but required here
  peerAddress: string
  protocol: string //'capsule' | 'websocket' | 'http3'
  transportPrivate?: Object //private information from the transport object
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
export type WebTransportSessionState =
  | 'connecting'
  | 'connected'
  | 'draining'
  | 'closed'
  | 'failed'

export interface WebTransportSessionImpl extends WebTransportSession {
  state: WebTransportSessionState
}

export type QUICHE_LOG_OFF = -1
export type QUICHE_LOG_INFO = 0
export type QUICHE_LOG_WARNING = 1
export type QUICHE_LOG_ERROR = 2
export type QUICHE_LOG_FATAL = 3
export type QUICHE_LOG = QUICHE_LOG_OFF | QUICHE_LOG_INFO | QUICHE_LOG_WARNING | QUICHE_LOG_ERROR | QUICHE_LOG_FATAL

export interface HttpWebTransportInit extends WebTransportOptions {
  host: string
  port: string | number
  quicheLogVerbose?: QUICHE_LOG
  forceIpv6?: boolean
  localPort?: number
}

export type WebTransportServerReliability =
  | 'unreliableOnly'
  | 'reliableOnly'
  | 'both'

// see HttpServerJS C++ type
export interface HttpServerInit extends HttpWebTransportInit {
  port: string | number
  host: string
  secret: string
  cert: string | string[]
  privKey: string | string[]
  maxConnections?: number
  initialStreamFlowControlWindow?: number
  streamShouldAutoTuneReceiveWindow?: boolean
  streamFlowControlWindowSizeLimit?: number
  initialSessionFlowControlWindow?: number
  sessionShouldAutoTuneReceiveWindow?: boolean
  sessionFlowControlWindowSizeLimit?: number
  reliability?: WebTransportServerReliability
  defaultDatagramsReadableMode: DatagramsReadableMode
}

// see HttpClientJS C++ type
export interface HttpClientInit extends HttpWebTransportInit {
  forceReliable?: any
  forceIpv6?: boolean
  localPort?: number
  initialStreamFlowControlWindow?: number
  streamShouldAutoTuneReceiveWindow?: boolean
  streamFlowControlWindowSizeLimit?: number
  initialSessionFlowControlWindow?: number
  sessionShouldAutoTuneReceiveWindow?: boolean
  sessionFlowControlWindowSizeLimit?: number
  createReliableClient?: (cklient: HttpClient) => any
  createUnreliableClient?: (client: HttpClient) => any
}

export interface TransportHttp3Quiche {
  checkQuicheInit: () => void

  Http3WebTransportServer: new (init: HttpServerInit) => any
  Http3WebTransportServerSocket: new (init: HttpServerInit) => any
}

export interface Logger {
  (formatter: any, ...args: any[]): void
  error: (formatter: any, ...args: any[]) => void
  trace: (formatter: any, ...args: any[]) => void
}

export type CreateParserFunction = (
  nativesession: Http2WebTransportSession
) => ParserBase

export interface ParserInit {
  isclient: boolean
  nativesession: any
  initialStreamSendWindowOffsetBidi: number
  initialStreamSendWindowOffsetUnidi: number
  initialStreamReceiveWindowOffset: number
  streamShouldAutoTuneReceiveWindow: boolean
  streamReceiveWindowSizeLimit: number
}

export interface ParserHttp2Init extends ParserInit {
  stream: Http2Stream
}

export interface ParserWebsocketInit extends ParserInit {
  ws: WebSocket
}

export interface ReadDataInt {
  data: Uint8Array|undefined
  fin: boolean
}
