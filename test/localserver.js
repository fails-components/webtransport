import express from 'express'
import path from 'path'
import { fileURLToPath } from 'url'
import { readdir } from 'fs/promises'
import * as esbuild from 'esbuild'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
const port = 6060

let specFiles

readdir(__dirname)
  .then(async (files) => {
    const scriptfiles = files.filter(
      (file) => file.endsWith('.spec.js') /* &&
        (file.startsWith('ses') || file.startsWith('uni')) */
    )
    let processScript =
      'var process ={}; process.env = {' +
      Object.entries(process.env)
        .map(([key, value]) => {
          return key + ": '" + value + "',\n"
        })
        .join('') +
      '};'
    await esbuild.build({
      entryPoints: scriptfiles,
      bundle: true,
      splitting: false,
      outdir: 'localserver',
      format: 'esm',
      banner: {
        js: processScript
      }
    })
    specFiles = scriptfiles.map((file) => {
      return '<script src="' + file + '"></script>'
    })
    console.log('bundling tests succeeded')
  })
  .catch((error) => {
    console.log('Problem read dir', error)
  })

// Serve files from the "public" directory
app.get('/:filename', (req, res) => {
  const requestedFile = req.params.filename
  console.log(`Request for file: ${requestedFile}`)
  if (/^[a-z-]+\.spec\.js$/.test(requestedFile)) {
    res.set('Content-Type', 'application/javascript')
    res.sendFile(path.join(__dirname, 'localserver', requestedFile))
  } else if (requestedFile === 'index.html') {
    const indexhtml =
      `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>@fails-components Webtransport Tests</title>
    <link rel="stylesheet" href="mocha/mocha.css">
</head>
<body>
    <div id="mocha"></div>

    Please note, that tests may influence each other! (If it causes a crash at client or server side).
    So if a test fails, you may want to edit localserver.js and the *.spec.js files and exclude some of the tests or change their ordering!

    <script src="mocha/mocha.js"></script>
    <script>
        mocha.setup({ui: 'bdd', timeout: 10000 /* increased timeout to mitigated throttling*/}); // Use BDD testing style
    </script>

    ` +
      specFiles +
      `<script>
        mocha.run();
    </script>
</body>
</html>`
    res.send(indexhtml)
  } else {
    res.send(`You requested the file: ${requestedFile}`)
  }
})

app.get('/fixtures/:filename', (req, res) => {
  const requestedFile = req.params.filename
  if (/^[a-z-.]+\.js$/.test(requestedFile)) {
    // fixtures
    res.sendFile(path.join(__dirname, 'fixtures/' + requestedFile))
  } else {
    res.send(`You requested the file: ${requestedFile}`)
  }
})

app.get('/mocha/:filename', (req, res) => {
  const requestedFile = req.params.filename
  if (requestedFile === 'mocha.css') {
    res.set('Content-Type', 'text/css')
    res.sendFile(path.join(__dirname + '/../node_modules/mocha', 'mocha.css'))
  } else if (requestedFile === 'mocha.js') {
    res.set('Content-Type', 'application/javascript')
    res.sendFile(path.join(__dirname + '/../node_modules/mocha', 'mocha.js'))
  } else {
    res.send(`You requested the file: ${requestedFile}`)
  }
})

// Bind to 0.0.0.0 to allow access from any network interface
app.listen(port, '0.0.0.0', () => {
  console.log(`Server is running on http://0.0.0.0:${port}`)
})
