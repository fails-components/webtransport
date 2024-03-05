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

  export interface HttpWebTransportInit extends WebTransportOptions {
    host: string
    port: string | number
    quicheLogVerbose?: 1 | 2 | 3
    forceIpv6?: boolean
    localPort?: number
  }
