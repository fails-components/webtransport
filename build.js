import { arch, argv, env, platform } from 'node:process'
import { spawn } from 'node:child_process'
import { cp, rename, mkdtemp, rm, access } from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'
import pkg from './package.json' assert { type: 'json' }
import { tmpdir } from 'node:os'

const binplatform = platform + '_' + arch

console.log(
  'Webtransport binary handler: We are working on platform ',
  binplatform
)

const callGit = (args, opts) => {
  // console.log('callgit', args)
  return new Promise((resolve, reject) => {
    const git = spawn('git', args, {
      cwd: (opts && opts.cwd) || process.cwd(),
      shell: true
    })
    const output = []
    git.stdout.on('data', (data) => {
      output.push(data)
    })

    git.stderr.on('data', (data) => {
      console.error(data.toString())
    })

    git.on('close', (code) => {
      if (code === 0) resolve(output.join(''))
      else {
        reject(output.join(''))
      }
    })
  })
}

const extractthirdparty = async () => {
  let tmppath
  let fatal = false
  console.error('Now extracting third party lib code from git....')
  const destdir = process.cwd() + '/third_party'
  let exists = false
  try {
    await access(destdir, constants.F_OK)
    exists = true
  } catch (error) {
    // ok this is ok
  }
  if (exists) {
    console.error(
      'Destination dir already exists: ' + destdir + ', skip downloading.'
    )
    return
  }
  try {
    console.log('tmpdir', tmpdir())
    tmppath = await mkdtemp(path.join(tmpdir(), 'wtbuild-'))
  } catch (error) {
    console.error('mktmp dir', error)
    throw new Error('Cannot generate tmp dir')
  }
  try {
    await callGit(
      [
        'clone',
        '--branch',
        `v${pkg.version}`,
        '--depth',
        '1',
        pkg.repository.url.replace('git+https', 'https')
      ],
      { cwd: tmppath }
    )
    const copath = tmppath + '/webtransport'
    const submodules = [
      'third_party/boringssl/src',
      'third_party/abseil-cpp',
      'third_party/quiche',
      'third_party/zlib',
      'third_party/googleurl',
      'third_party/libevent',
      'third_party/protobuf'
    ]
    for (let mod in submodules) {
      const sub = submodules[mod]
      await callGit(
        [
          'config',
          '-f',
          '.gitmodules',
          'submodule.' + sub + '.shallow',
          'true'
        ],
        { cwd: copath }
      )
      await callGit(['submodule', 'update', '--init', '--recursive', sub], {
        cwd: copath
      })
    }
    try {
      await rm(destdir, { recursive: true, maxRetries: 10 })
    } catch (err) {
      console.log('destdir does not exist (only warning, ignore): ', err)
    }
    try {
      await rename(path.join(copath, '/third_party'), destdir)
    } catch (error) {
      console.log('rename tmp dir failed:', error)
      console.log('copy instead start... (can take a while)...')
      await cp(path.join(copath, '/third_party'), destdir, {recursive: true})
      console.log('copy instead finished')
    }
  } catch (error) {
    console.error('failed to get third party code from git', error)
    fatal = true
  }
  try {
    await rm(tmppath, { recursive: true, maxRetries: 10 })
  } catch (error) {
    console.error('failed to remove temp dir ', error)
  }
  if (fatal) throw new Error('Cannot get thirdparty code')
  console.error('Extracting third party lib code from git finished.')
}

const prebuild = (args) => {
  return new Promise((resolve, reject) => {
    const pb = 'npx'
    // if (platform === 'win32') cmakejs = 'cmake-js.exe'
    const proc = spawn(pb, ['prebuild', ...args], {
      cwd: process.cwd(),
      stdio: [null, 'inherit', 'inherit'],
      shell: true
    })

    proc.on('close', (code) => {
      console.log(`child process exited with code ${code}`)
      if (code == 0) resolve()
      else reject()
    })
  })
}

const prebuildInstall = async (args) => {
  return new Promise((resolve, reject) => {
    const pb = 'prebuild-install'
    // if (platform === 'win32') cmakejs = 'cmake-js.exe'
    const proc = spawn(pb, args, {
      cwd: process.cwd(),
      stdio: [null, 'inherit', 'inherit'],
      shell: true
    })

    proc.on('close', (code) => {
      if (code === 0) resolve(code)
      else reject(code)
      console.log(`child process exited with code ${code}`)
    })
  })
}

const buildTypes = async () => {
  return new Promise((resolve, reject) => {
    const tsc = 'tsc'
    const proc = spawn(tsc, {
      cwd: process.cwd(),
      stdio: [null, 'inherit', 'inherit'],
      shell: true
    })

    proc.on('close', (code) => {
      if (code === 0) resolve(code)
      else reject(code)
      console.log(`child process exited with code ${code}`)
    })
  })
}

const execbuild = async (args) => {
  return new Promise((resolve, reject) => {
    const cmakejs = 'cmake-js'
    // if (platform === 'win32') cmakejs = 'cmake-js.exe'
    const proc = spawn(cmakejs, args, {
      cwd: process.cwd(),
      stdio: [null, 'inherit', 'inherit'],
      shell: true
    })

    proc.on('close', (code) => {
      if (code === 0) resolve(code)
      else reject(code)
      console.log(`child process exited with code ${code}`)
    })
  })
}

if (argv.length > 2) {
  const target = pkg.binary.napi_versions
  const platformargs = [
    '--CDnapi_build_version=' + target,
    '-O',
    'build_' + binplatform
  ]
  if (platform === 'win32') platformargs.push('-t', 'ClangCL')
  const pbargs = []
  const pbargspre = []
  if (platform === 'win32') pbargs.push('-t', 'ClangCL') 
  if (env.BUILDARCH) {
    pbargspre.push('--arch', env.BUILDARCH)
    platformargs.push('--arch', env.BUILDARCH)
  }
  if (env.GH_TOKEN) pbargspre.push('--u', env.GH_TOKEN)

  switch (argv[2]) {
    case 'prebuild':
      try {
        await prebuild([
          '-t',
          '6',
          '-r',
          'napi',
          '--strip',
          ...pbargspre,
          '--backend',
          'cmake-js',
          '--',
          ...pbargs
        ])
      } catch (error) {
        console.log('prebuild failed')
        process.exit(1)
      }
      break
    case 'install': {
      try {
        const pbres = await prebuildInstall([
          '-r',
          'napi',
          '-d',
          '-t',
          '6',
          '--verbose'
        ])
        if (pbres === 0) break
      } catch (error) {
        console.error(
          'No prebuild available, building binary, this may take more than 20 minutes'
        )
      }
      try {
        // if we do not succeed, we have to build it ourselves
        await extractthirdparty()
      } catch (error) {
        console.error('Building binary failed: ', error)
      }
    }
    // eslint-disable-next-line no-fallthrough
    case 'build':
      try {
        await execbuild(['build', ...platformargs])
        await buildTypes()
      } catch (error) {
        console.error('Building binary failed: ', error)
        process.exit(1)
      }
      break
    case 'rebuild':
      try {
        await execbuild(['rebuild', ...platformargs])
        await buildTypes()
      } catch (error) {
        console.error('ReBuilding binary failed: ', error)
        process.exit(1)
      }
      break
    case 'build-debug':
      try {
        await execbuild(['build', '-D', ...platformargs])
        await buildTypes()
      } catch (error) {
        console.error('Building binary failed: ', error)
        process.exit(1)
      }
      break
    case 'rebuild-debug':
      try {
        await execbuild(['rebuild', '-D', ...platformargs])
        await buildTypes()
      } catch (error) {
        console.error('ReBuilding binary failed: ', error)
        process.exit(1)
      }
      break
    case 'extract-thirdparty':
      try {
        // if we do not succeed, we have to build it ourselves
        await extractthirdparty()
      } catch (error) {
        console.error('Extract third party failed: ', error)
      }
      break
    default:
      console.log('unsupported argument ', argv[2])
      break
  }
} else {
  console.log('Please supply a task as argument')
}
