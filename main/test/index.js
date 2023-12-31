import { execa } from 'execa'

/**
 * Run server as separate process so we can kill it without
 * getting stuck waiting for the custom event loop to end.
 */
async function startServer() {
  let http2 = false
  if (process.argv[3] === 'http2') http2 = true
  return new Promise((resolve, reject) => {
    let foundAddress = false

    const server = execa('node', ['./test/fixtures/server.js'], {
      stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
      env: {
        USE_HTTP2: http2 ? 'true' : 'false'
      }
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
  let http2 = false
  if (process.argv[3] === 'http2') http2 = true
  let polyfill = false
  let ponyfill = false
  let slice = 4
  if (process.argv.length > 3 && process.argv[4] === 'polyfill') {
    polyfill = true
    slice++
    if (env === 'node') throw new Error('Polyfill not supported on node')
  }
  if (process.argv.length > 3 && process.argv[4] === 'ponyfill') {
    ponyfill = true
    slice++
    if (env === 'node') throw new Error('Ponyfill not supported on node')
  }
  /** @type {string} */
  let command = ''
  /** @type {string[]} */
  let args = []

  if (env === 'node') {
    command = 'mocha'
    args = [
      process.env.CI ? '--no-colors' : '--colors',
      './test/*.spec.js',
      ...process.argv.slice(4)
    ]
    const tests = execa(command, args, {
      env: {
        DEBUG_COLORS: process.env.CI ? '' : 'true',
        CERT_HASH: certificate,
        SERVER_URL: serverAddress,
        USE_HTTP2: http2 ? 'true' : 'false'
      },
      stdio: ['inherit', 'inherit', 'inherit']
    })

    await tests
  } else if (env === 'chromium' || env === 'firefox' || env === 'webkit') {
    command = 'playwright-test'
    const otheropts = []
    if (polyfill || ponyfill || env === 'firefox')
      otheropts.push('--config', './test/pw-no-https-errors.json')
    args = [
      './test/*.spec.js',
      '-b',
      env /* the browser */,
      ...otheropts,
      ...process.argv.slice(slice)
    ]
    const tests = execa(command, args, {
      env: {
        DEBUG_COLORS: process.env.CI ? '' : 'true',
        CERT_HASH: certificate,
        SERVER_URL: serverAddress,
        USE_HTTP2: http2 ? 'true' : 'false',
        USE_POLYFILL: polyfill ? 'true' : 'false',
        USE_PONYFILL: ponyfill ? 'true' : 'false',
        NO_CERT_HASHES:
          env === 'firefox' && !ponyfill && !polyfill ? 'true' : 'false',
        BROWSER: env
      },
      stdio: ['inherit', 'inherit', 'inherit']
    })

    await tests
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
    console.log('Error cause mocha process', err)
    success = false
  }
} finally {
  // this will cause the server process to exit too as it is a child of this process
  process.exit(success ? 0 : 1)
}
