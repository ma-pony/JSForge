import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const defaultPackageRoot = fileURLToPath(new URL('../..', import.meta.url))

export function resolveDshBinary({ packageJsonPath } = {}) {
  const manifestPath = packageJsonPath ?? createRequire(import.meta.url).resolve('@deepseek-ai/dsh/package.json')
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  const declaredBinary = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.dsh
  if (!declaredBinary) throw new Error(`${manifestPath} does not declare bin.dsh`)
  return path.resolve(path.dirname(manifestPath), declaredBinary)
}

export function resolveDshLayout({ packageRoot = defaultPackageRoot, env = process.env } = {}) {
  const dshHome = env.DSH_HOME || path.join(os.homedir(), '.dsh')
  const packageRequire = createRequire(path.join(packageRoot, 'package.json'))
  return {
    packageRoot,
    dshHome,
    dshBinary: resolveDshBinary({
      packageJsonPath: packageRequire.resolve('@deepseek-ai/dsh/package.json'),
    }),
    sourcePatch: path.join(packageRoot, 'dsh', 'cordis.patch.yml'),
    targetPatch: path.join(dshHome, '.deepspider', 'cordis.patch.yml'),
    sourcePreset: path.join(packageRoot, 'dsh', 'agent-presets', 'spider'),
    targetPreset: path.join(dshHome, '.agent-presets', 'spider'),
    sourceSkill: path.join(packageRoot, 'skills', 'deepspider'),
    targetSkill: path.join(dshHome, 'skills', 'deepspider'),
    hostPluginPath: path.join(packageRoot, 'src', 'dsh', 'host-plugin.js'),
    agentPluginPath: path.join(packageRoot, 'src', 'dsh', 'agent-plugin.js'),
  }
}

function replaceDirectory(source, target) {
  fs.rmSync(target, { recursive: true, force: true })
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.cpSync(source, target, { recursive: true })
}

function materializePluginPath(source, target, placeholder, pluginPath) {
  const template = fs.readFileSync(source, 'utf8')
  if (!template.includes(placeholder)) throw new Error(`${source} does not contain ${placeholder}`)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, template.replace(placeholder, JSON.stringify(pluginPath)))
}

export function syncManagedDshAssets(layout) {
  replaceDirectory(layout.sourcePreset, layout.targetPreset)
  replaceDirectory(layout.sourceSkill, layout.targetSkill)
  materializePluginPath(
    layout.sourcePatch,
    layout.targetPatch,
    '!!js process.env.DEEPSPIDER_HOST_PLUGIN_PATH',
    layout.hostPluginPath
  )
  materializePluginPath(
    path.join(layout.sourcePreset, 'agent.cordis.yml'),
    path.join(layout.targetPreset, 'agent.cordis.yml'),
    '!!js process.env.DEEPSPIDER_AGENT_PLUGIN_PATH',
    layout.agentPluginPath
  )
}

export function buildDshLaunch({
  port,
  packageRoot = defaultPackageRoot,
  env = process.env,
} = {}) {
  const layout = resolveDshLayout({ packageRoot, env })
  const args = [layout.dshBinary, 'web', '--patch', layout.targetPatch]
  if (port !== undefined) args.push('--port', String(port))
  return {
    command: process.execPath,
    args,
    options: {
      shell: false,
      stdio: 'inherit',
      env: {
        ...env,
        DSH_PERMISSION_MODE: env.DSH_PERMISSION_MODE || 'danger-full-access',
      },
    },
    layout,
  }
}

function signalExitCode(signal) {
  const number = os.constants.signals[signal]
  return number ? 128 + number : 1
}

export function startDshAgent(options = {}) {
  const {
    spawnImpl = spawn,
    signal,
    verbose = false,
    log = console.error,
    ...launchOptions
  } = options
  const launch = buildDshLaunch(launchOptions)
  syncManagedDshAssets(launch.layout)
  if (verbose) {
    const portLabel = launchOptions.port === undefined ? '' : ` on port ${launchOptions.port}`
    log(`[DeepSpider] starting DSH Web${portLabel}`)
  }
  const child = spawnImpl(launch.command, launch.args, launch.options)
  let settled = false
  let closePromise
  let abortHandler
  let resolveClosed
  let rejectClosed
  const closed = new Promise((resolve, reject) => {
    resolveClosed = resolve
    rejectClosed = reject
  })
  const finish = (callback, value) => {
    if (settled) return
    settled = true
    child.removeListener('error', onError)
    child.removeListener('exit', onExit)
    if (signal && abortHandler) signal.removeEventListener('abort', abortHandler)
    callback(value)
  }
  const onError = (error) => finish(rejectClosed, error)
  const onExit = (code, childSignal) => finish(
    resolveClosed,
    Number.isInteger(code) ? code : signalExitCode(childSignal)
  )
  child.once('error', onError)
  child.once('exit', onExit)

  const close = () => {
    if (!closePromise) {
      closePromise = (async () => {
        if (!settled) child.kill('SIGTERM')
        return closed
      })()
    }
    return closePromise
  }
  if (signal) {
    abortHandler = () => { void close(signal.reason) }
    if (signal.aborted) abortHandler()
    else signal.addEventListener('abort', abortHandler, { once: true })
  }
  return { child, closed, close }
}
