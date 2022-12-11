import { execa } from 'execa'
import { OutputBuffer } from 'output-buffer'

/**
 * Run server as separate process so we can kill it without
 * getting stuck waiting for the custom event loop to end.
 */
async function startServer() {
  return new Promise((resolve, reject) => {
    let foundAddress = false

    const stdout = new OutputBuffer(console.info)
    const stderr = new OutputBuffer(console.error)

    const server = execa('node', ['./test/fixtures/server.js'])
    server.stdout?.on('data', (data) => {
      if (!foundAddress) {
        foundAddress = true

        const { address, certificate } = JSON.parse(data.toString())

        resolve({
          address,
          certificate
        })

        return
      }

      stdout.append(data)
    })
    server.stderr?.on('data', (data) => {
      stderr.append(data)
    })

    server
      .finally(() => {
        stdout.flush()
        stderr.flush()
      })
      .catch((err) => reject(err))
  })
}

/**
 * @param {string} certificate
 * @param {string} serverAddress
 */
async function runTests(certificate, serverAddress) {
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
    args = ['./test/*.spec.js', ...process.argv.slice(3)]
  }

  const stdout = new OutputBuffer(console.info)
  const stderr = new OutputBuffer(console.error)

  const tests = execa(command, args, {
    env: {
      DEBUG_COLORS: process.env.CI ? '' : 'true',
      CERT_HASH: certificate,
      SERVER_URL: serverAddress
    }
  })
  tests.stderr?.on('data', (data) => {
    stderr.append(data)
  })
  tests.stdout?.on('data', (data) => {
    stdout.append(data)
  })

  // eslint-disable-next-line promise/catch-or-return
  tests.finally(() => {
    stdout.flush()
    stderr.flush()
  })

  await tests
}

let success = true

try {
  const { address, certificate } = await startServer()

  await runTests(certificate, address)
} catch (/** @type {any} */ err) {
  if (err.command == null) {
    // was not an execa error
    throw err
  }

  if (err.failed || err.timedOut || err.isCancelled || err.isKilled) {
    success = false
  }
} finally {
  // this will cause the server process to exit too as it is a child of this process
  process.exit(success ? 0 : 1)
}
