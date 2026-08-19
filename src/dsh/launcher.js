import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const defaultPackageRoot = fileURLToPath(new URL('../..', import.meta.url))
const profileName = 'web'
const bundleName = 'deepspider'

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
  const profileDir = path.join(dshHome, 'profiles', profileName)
  return {
    packageRoot,
    dshHome,
    env,
    dshBinary: resolveDshBinary({
      packageJsonPath: packageRequire.resolve('@deepseek-ai/dsh/package.json'),
    }),
    profileName,
    profileDir,
    profileManifest: path.join(profileDir, 'package.json'),
    profilePackageRoot: path.join(profileDir, 'node_modules', bundleName),
    bundlePatch: path.join(packageRoot, 'dsh', 'cordis.patch.yml'),
    bundlePreset: path.join(packageRoot, 'dsh', 'agent-presets', 'spider'),
    bundleSkills: path.join(packageRoot, 'skills'),
    bundleSpec: `link:${path.resolve(packageRoot)}`,
  }
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

export function isDshBundleInstalled(layout) {
  try {
    const profile = readJson(layout.profileManifest)
    const bundles = profile.dsh?.profile?.bundles
    if (!Array.isArray(bundles) || !bundles.includes(bundleName)) return false
    if (typeof profile.dependencies?.[bundleName] !== 'string') return false
    const installed = readJson(path.join(layout.profilePackageRoot, 'package.json'))
    return installed.name === bundleName
      && fs.realpathSync(layout.profilePackageRoot) === fs.realpathSync(layout.packageRoot)
  } catch {
    return false
  }
}

export function ensureDshBundle(layout, { spawnSyncImpl = spawnSync } = {}) {
  if (isDshBundleInstalled(layout)) return false

  const result = spawnSyncImpl(
    process.execPath,
    [
      layout.dshBinary,
      'plugin',
      '--profile',
      layout.profileName,
      'add',
      layout.bundleSpec,
    ],
    {
      cwd: layout.packageRoot,
      env: { ...process.env, ...layout.env, DSH_HOME: layout.dshHome },
      stdio: 'inherit',
      shell: false,
    },
  )
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`Failed to install DeepSpider DSH bundle (exit ${result.status ?? 'unknown'})`)
  }
  if (!isDshBundleInstalled(layout)) {
    throw new Error('DeepSpider DSH bundle installation completed without activating the web profile layer')
  }
  return true
}

export function buildDshLaunch({
  port,
  packageRoot = defaultPackageRoot,
  env = process.env,
} = {}) {
  const layout = resolveDshLayout({ packageRoot, env })
  const args = [layout.dshBinary, 'web']
  if (port !== undefined) args.push('--port', String(port))
  return {
    command: process.execPath,
    args,
    options: {
      shell: false,
      stdio: 'inherit',
      env: {
        ...process.env,
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
    bundleInstaller = ensureDshBundle,
    ...launchOptions
  } = options
  const launch = buildDshLaunch(launchOptions)
  bundleInstaller(launch.layout)
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
