import { arch, argv, platform } from 'node:process'
import { spawn } from 'node:child_process'

const binplatform = platform + '_' + arch

console.log(
  'Webtransport binary handler: We are working on platform ',
  binplatform
)

const execbuild = (args) => {
  let cmakejs = 'cmake-js'
  // if (platform === 'win32') cmakejs = 'cmake-js.exe'
  const proc = spawn(cmakejs, args, {
    cwd: process.cwd(),
    stdio: [null, 'inherit', 'inherit'],
    shell: true
  })

  proc.on('close', (code) => {
    console.log(`child process exited with code ${code}`)
  })
}

if (argv.length > 2) {
  let platformargs = ['-O', 'build_' + binplatform]
  if (platform === 'win32') platformargs.push('-t', 'ClangCL')
  switch (argv[2]) {
    case 'install':
    case 'build':
      execbuild(['build', ...platformargs])
      break
    case 'rebuild':
      execbuild(['rebuild', ...platformargs])
      break
    case 'build-debug':
      execbuild(['build', '-D', ...platformargs])
      break
    case 'rebuild-debug':
      execbuild(['rebuild', '-D', ...platformargs])
      break
    default:
      console.log('unsupported argument ', argv[2])
      break
  }
} else {
  console.log('Please supply a task as argument')
}
