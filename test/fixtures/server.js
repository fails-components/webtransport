import { generateWebTransportCertificate } from './certificate.js'
import { Http3Server } from '../../lib/index.js'

export async function createServer() {
  const attrs = [
    { shortName: 'C', value: 'DE' },
    { shortName: 'ST', value: 'Berlin' },
    { shortName: 'L', value: 'Berlin' },
    { shortName: 'O', value: 'WebTransport Test Server' },
    { shortName: 'CN', value: '127.0.0.1' }
  ]

  const certificate = await generateWebTransportCertificate(attrs, {
    days: 13
  })

  if (certificate == null) {
    throw new Error('Certificate generation failed')
  }

  const server = new Http3Server({
    port: 0,
    host: '127.0.0.1',
    secret: 'mysecret',
    cert: certificate.cert, // unclear if it is the correct format
    privKey: certificate.private
  })

  return {
    server,
    certificate
  }
}

/**
 * @param {import('../../lib/server.js').Http3Server} server
 * @param {string} path
 */
export async function getServerSession(server, path) {
  const sessionStream = await server.sessionStream(path)
  const sessionReader = sessionStream.getReader()

  try {
    const { done, value } = await sessionReader.read()

    if (done) {
      throw new Error('Server is gone')
    }

    if (!value) {
      throw new Error('Session was undefined')
    }

    return value
  } finally {
    sessionReader.releaseLock()
  }
}
