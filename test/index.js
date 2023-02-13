import { execa } from 'execa'

/**
 * Run server as separate process so we can kill it without
 * getting stuck waiting for the custom event loop to end.
 */
async function startServer() {
  return new Promise((resolve, reject) => {
    let foundAddress = false

    const server = execa('node', ['./test/fixtures/server.js'], {
      stdio: ['inherit', 'inherit', 'inherit', 'ipc']
    })
    server.on('message', (data) => {
      if (!foundAddress) {
        foundAddress = true

        resolve(data)
      }
    })
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
    const tests = execa(command, args, {
      env: {
        DEBUG_COLORS: process.env.CI ? '' : 'true',
        CERT_HASH: certificate,
        SERVER_URL: serverAddress
      },
      stdio: ['inherit', 'inherit', 'inherit']
    })

    await tests
  } else if (env === 'chromium') {
    command = 'playwright-test'
    args = ['./test/bidi*.spec.js', ...process.argv.slice(3)]
    const testsbidi = execa(command, args, {
      env: {
        DEBUG_COLORS: process.env.CI ? '' : 'true',
        CERT_HASH: certificate,
        SERVER_URL: serverAddress
      },
      stdio: ['inherit', 'inherit', 'inherit']
    })

    await testsbidi

    command = 'playwright-test'
    args = ['./test/sess*.spec.js', ...process.argv.slice(3)]
    const testssess = execa(command, args, {
      env: {
        DEBUG_COLORS: process.env.CI ? '' : 'true',
        CERT_HASH: certificate,
        SERVER_URL: serverAddress
      },
      stdio: ['inherit', 'inherit', 'inherit']
    })

    await testssess

    command = 'playwright-test'
    args = ['./test/data*.spec.js', ...process.argv.slice(3)]
    const testdata = execa(command, args, {
      env: {
        DEBUG_COLORS: process.env.CI ? '' : 'true',
        CERT_HASH: certificate,
        SERVER_URL: serverAddress
      },
      stdio: ['inherit', 'inherit', 'inherit']
    })

    await testdata

    command = 'playwright-test'
    args = ['./test/uni*.spec.js', ...process.argv.slice(3)]
    const testsuni = execa(command, args, {
      env: {
        DEBUG_COLORS: process.env.CI ? '' : 'true',
        CERT_HASH: certificate,
        SERVER_URL: serverAddress
      },
      stdio: ['inherit', 'inherit', 'inherit']
    })

    await testsuni
  }
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
