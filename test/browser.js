import { execa } from 'execa'
import { createServer } from './fixtures/server.js'

const { server, certificate } = await createServer()
server.startServer()
await server.ready

const address = server.address()

if (address == null) {
  throw new Error('Could not determine server address')
}

try {
  const proc = execa(
    'playwright-test',
    ['test/*.spec.js', ...process.argv.slice(2)],
    {
      env: {
        CERT_HASH: certificate.fingerprint,
        SERVER_URL: `https://${address.host}:${address.port}`
      }
    }
  )
  proc.stderr?.on('data', (data) => {
    process.stderr.write(data)
  })
  proc.stdout?.on('data', (data) => {
    process.stdout.write(data)
  })

  await proc
} catch (/** @type {any} */ err) {
  if (err.command == null) {
    // was not an execa error
    throw err
  }
} finally {
  server.stopServer()
  await server.closed
}
