
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
  
