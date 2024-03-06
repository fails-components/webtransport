import type {
  WebTransportOptions
} from '../../../main/lib/dom'

export interface UDPServerSocketSend {
    msg:  Uint8Array
    offset: number
    length: number
    port:number
    address: string
  }

  export interface Logger {
    (formatter: any, ...args: any[]): void
    error: (formatter: any, ...args: any[]) => void
    trace: (formatter: any, ...args: any[]) => void
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
