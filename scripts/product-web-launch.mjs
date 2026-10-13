/** Start the extracted Web product with its bundled Node and persistent profile. */
import { existsSync, mkdirSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** Resolve the small launcher interface; the Web listener is always loopback. */
export function launchOptions(args, environment = process.env, home = homedir()) {
  let data = environment.DSH_HOME || join(environment.XDG_DATA_HOME || join(home, '.local/share'), 'apus-reflex-web')
  let port = '3080'
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index]
    const value = args[++index]
    if (!value || !['--port', '--data-dir'].includes(option)) throw new Error('Usage: ./start.sh [--port 3080] [--data-dir /absolute/path]')
    if (option === '--port') port = value
    else data = value
  }
  if (!/^\d+$/.test(port) || Number(port) > 65535) throw new Error('Port must be an integer from 0 to 65535.')
  return { data: resolve(data), args: ['web', '--host', '127.0.0.1', '--port', port, '--no-open'] }
}

/** Initialize a missing Web profile, then await the supported CLI's shutdown. */
export async function launch(args = process.argv.slice(2)) {
  const root = dirname(fileURLToPath(import.meta.url))
  const options = launchOptions(args)
  const runtime = join(root, 'runtime')
  const environment = { ...process.env, DSH_HOME: options.data }
  for (const name of ['NODE_OPTIONS', 'NODE_PATH', 'ELECTRON_RUN_AS_NODE']) delete environment[name]
  mkdirSync(options.data, { recursive: true, mode: 0o700 })
  const require = createRequire(join(runtime, 'package.json'))
  const boot = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-app-boot')).href)
  const profile = boot.resolveProfileDir('web', options.data)
  if (!existsSync(join(profile, 'package.json'))) {
    boot.initProfile(profile, [...boot.PROFILE_TEMPLATES.web.bundles, '@deepseek-ai/dsh-experimental-apus-dsh-jev-plugin'])
  }
  const child = spawn(join(root, 'bin/node'), [join(runtime, 'node_modules/@deepseek-ai/dsh/lib/bin.js'),
    '--profile', 'web', '--patch', join(root, 'web.patch.yml'), ...options.args.slice(1)], {
    cwd: options.data, env: environment, stdio: 'inherit',
  })
  const interrupt = () => child.kill('SIGINT')
  const terminate = () => child.kill('SIGTERM')
  process.on('SIGINT', interrupt)
  process.on('SIGTERM', terminate)
  try {
    await new Promise((done, reject) => {
      child.once('error', reject)
      child.once('close', (code, signal) => {
        if (signal) process.exitCode = signal === 'SIGINT' ? 130 : 143
        else process.exitCode = code ?? 1
        done()
      })
    })
  } finally {
    process.off('SIGINT', interrupt)
    process.off('SIGTERM', terminate)
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await launch() }
  catch (error) { console.error(error.message); process.exitCode = 1 }
}
