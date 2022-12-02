import { execa } from 'execa'

/**
 * Run server as separate process so we can kill it without
 * getting stuck waiting for the custom event loop to end.
 */
async function startServer () {
  return new Promise((resolve, reject) => {
    const server = execa('node', ['./test/fixtures/server.js'])
    server.stdout?.on('data', (data) => {
      const { address, certificate } = JSON.parse(data.toString())

      resolve({
        server,
        address,
        certificate
      })
    })

    server.catch(err => reject(err))
  })
}

/** @type {import('execa').ExecaChildProcess[]} */
const procs = []
let success = true

try {
  const { server, address, certificate } = await startServer()
  procs.push(server)

  const env = process.argv[2]
  /** @type {string} */
  let command = ''
  /** @type {string[]} */
  let args = []

  if (env === 'node') {
    command = 'mocha'
    args = [
      process.env.CI ? '--no-colors' : '--colors',
      './test/*.spec.js',
      './test/*.node.js',
      ...process.argv.slice(3)
    ]
  } else if (env === 'chromium') {
    command = 'playwright-test'
    args = [
      './test/*.spec.js',
      ...process.argv.slice(3)
    ]
  }

  const tests = execa(command, args,
    {
      env: {
        DEBUG_COLORS: process.env.CI ? '' : 'true',
        CERT_HASH: certificate,
        SERVER_URL: address
      }
    }
  )
  tests.stderr?.on('data', (data) => {
    process.stdout.write(data)
  })
  tests.stdout?.on('data', (data) => {
    process.stdout.write(data)
  })

  procs.push(tests)

  await tests
} catch (/** @type {any} */ err) {
  if (err.command == null) {
    // was not an execa error
    throw err
  }

  if (err.failed || err.timedOut || err.isCancelled || err.isKilled) {
    success = false
  }
} finally {
  procs.forEach(proc => proc.kill('SIGKILL'))

  if (!success) {
    process.exit(1)
  }
}
