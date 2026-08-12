/**
 * OpenCode V2 runtime lifecycle.
 *
 * The installed DeepSpider directory supplies the bundled OpenCode binary,
 * plugins, and skills. `directory` remains the user's OpenCode project.
 */

import fs from 'node:fs'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createOpencodeClient } from '@opencode-ai/sdk/v2'
import { resolveOpencodeBinary } from './opencode-binary.js'
import { startTUI } from './tui.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(__dirname, '../..')
const require = createRequire(import.meta.url)

export const SUPPORTED_OPENCODE_VERSION = '1.18.16'
export const OPENCODE_PACKAGES = [
  { name: '@opencode-ai/sdk', entry: '@opencode-ai/sdk' },
  { name: '@opencode-ai/plugin', entry: '@opencode-ai/plugin' },
  { name: 'opencode-ai', entry: 'opencode-ai/package.json', packageJson: true },
]

const READY_ATTEMPTS = 40
const READY_INTERVAL_MS = 250

/**
 * Launch the OpenCode server from the exact binary installed with DeepSpider.
 *
 * @param {object} options
 * @param {string} [options.hostname]
 * @param {number} [options.port]
 * @param {number} [options.timeout]
 * @param {AbortSignal} [options.signal]
 * @param {object} [options.config]
 * @param {object} [dependencies]
 * @returns {Promise<{client: object, server: {url: string, close: () => void}}>}
 */
export async function launchInstalledOpencode(
  options = {},
  {
    resolveBinaryFn = resolveOpencodeBinary,
    spawnImpl = spawn,
    createClientFn = createOpencodeClient,
  } = {}
) {
  const hostname = options.hostname ?? '127.0.0.1'
  const port = options.port ?? 4096
  const timeout = options.timeout ?? 5000
  const executable = resolveBinaryFn()
  const args = ['serve', `--hostname=${hostname}`, `--port=${port}`]
  if (options.config?.logLevel) args.push(`--log-level=${options.config.logLevel}`)

  const child = spawnImpl(executable, args, {
    env: {
      ...process.env,
      OPENCODE_CONFIG_CONTENT: JSON.stringify(options.config ?? {}),
    },
    shell: false,
  })

  let clearAbort = () => {}
  const url = await new Promise((resolve, reject) => {
    let output = ''
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      clearAbort()
      stopProcess(child)
      reject(new Error(`Timeout waiting for server to start after ${timeout}ms`))
    }, timeout)

    const rejectOnce = (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      clearAbort()
      reject(error)
    }

    child.stdout?.on('data', (chunk) => {
      if (settled) return
      output += chunk.toString()
      for (const line of output.split('\n')) {
        if (!line.startsWith('opencode server listening')) continue
        const match = line.match(/on\s+(https?:\/\/[^\s]+)/)
        if (!match) {
          stopProcess(child)
          rejectOnce(new Error(`Failed to parse server url from output: ${line}`))
          return
        }
        settled = true
        clearTimeout(timer)
        resolve(match[1])
        return
      }
    })
    child.stderr?.on('data', (chunk) => {
      output += chunk.toString()
    })
    child.once('exit', (code) => {
      let message = `Server exited with code ${code}`
      if (output.trim()) message += `\nServer output: ${output}`
      rejectOnce(new Error(message))
    })
    child.once('error', rejectOnce)

    if (options.signal) {
      const abort = () => {
        stopProcess(child)
        rejectOnce(options.signal.reason ?? new Error('OpenCode server start aborted'))
      }
      clearAbort = () => options.signal.removeEventListener('abort', abort)
      options.signal.addEventListener('abort', abort, { once: true })
      if (options.signal.aborted) abort()
    }
  })

  return {
    client: createClientFn({ baseUrl: url }),
    server: {
      url,
      close() {
        clearAbort()
        stopProcess(child)
      },
    },
  }
}

/**
 * Assert that every OpenCode package installed with DeepSpider is the version
 * validated against this runtime.
 *
 * @param {() => Record<string, string>} [readVersionsFn]
 * @returns {Record<string, string>}
 */
export function assertOpencodeVersions(readVersionsFn = readInstalledVersions) {
  let versions
  try {
    versions = readVersionsFn()
  } catch (error) {
    throw runtimeError(
      'E_OPENCODE_VERSION',
      `Unable to read installed OpenCode versions: ${error.message}`,
      error
    )
  }

  for (const { name } of OPENCODE_PACKAGES) {
    if (versions[name] !== SUPPORTED_OPENCODE_VERSION) {
      throw runtimeError(
        'E_OPENCODE_VERSION',
        `${name} must be ${SUPPORTED_OPENCODE_VERSION}, found ${versions[name] || 'missing'}`
      )
    }
  }

  return versions
}

/**
 * @param {object} options
 * @param {object} options.config
 * @param {string} [options.directory]
 * @param {string} [options.projectRoot]
 * @param {boolean} [options.verbose]
 * @param {typeof launchInstalledOpencode} [options.createOpencodeFn]
 * @param {typeof startTUI} [options.startTUIFn]
 * @param {() => Record<string, string>} [options.readVersionsFn]
 * @param {(milliseconds: number) => Promise<void>} [options.sleepFn]
 */
export class OpencodeRuntime {
  constructor({
    config,
    directory = process.cwd(),
    projectRoot = PROJECT_ROOT,
    verbose = false,
    createOpencodeFn = launchInstalledOpencode,
    startTUIFn = startTUI,
    readVersionsFn = readInstalledVersions,
    sleepFn = sleep,
  }) {
    this.config = config
    this.directory = directory
    this.projectRoot = projectRoot
    this.verbose = verbose
    this.createOpencodeFn = createOpencodeFn
    this.startTUIFn = startTUIFn
    this.readVersionsFn = readVersionsFn
    this.sleepFn = sleepFn
    this.abortController = new globalThis.AbortController()
    this.client = null
    this.server = null
    this.tui = null
    this.state = 'idle'
    this._startPromise = null
    this._closePromise = null
  }

  async start() {
    if (this.state === 'ready') return
    if (this._startPromise) return this._startPromise
    if (this.state !== 'idle') {
      throw runtimeError('E_RUNTIME_CLOSED', `Cannot start runtime in ${this.state} state`)
    }

    assertOpencodeVersions(this.readVersionsFn)
    this.state = 'starting'
    this._startPromise = this._start()
    return this._startPromise
  }

  async attachTUI() {
    if (this.state !== 'ready') {
      throw runtimeError('E_RUNTIME_NOT_READY', 'OpenCode runtime is not ready')
    }

    if (!this.tui) {
      this.tui = this.startTUIFn(this.server.url, {
        signal: this.abortController.signal,
        verbose: this.verbose,
      })
    }

    return this.tui.wait()
  }

  close() {
    if (this._closePromise) return this._closePromise

    this.state = 'closing'
    this._closePromise = (async () => {
      const tui = this.tui
      const server = this.server
      const errors = []

      try {
        try {
          this.abortController.abort()
        } catch (error) {
          errors.push(error)
        }
        try {
          if (tui) await tui.close()
        } catch (error) {
          errors.push(error)
        }
        try {
          if (server) await server.close()
        } catch (error) {
          errors.push(error)
        }
      } finally {
        this.tui = null
        this.server = null
        this.client = null
        this.state = 'closed'
      }

      if (errors.length > 0) throw cleanupError(errors)
    })()

    return this._closePromise
  }

  async _start() {
    try {
      const { client, server } = await this._createServer()
      if (this.state !== 'starting') {
        await server.close()
        throw runtimeError('E_RUNTIME_CLOSED', 'OpenCode runtime was closed while starting')
      }

      this.client = client
      this.server = server
      await this._waitForReady()
      if (this.state !== 'starting' || this.abortController.signal.aborted) {
        throw runtimeError('E_RUNTIME_CLOSED', 'OpenCode runtime was closed while becoming ready')
      }
      this.state = 'ready'
    } catch (error) {
      let cleanupFailure
      try {
        await this.close()
      } catch (cleanupError) {
        cleanupFailure = cleanupError
      }
      if (cleanupFailure && error && typeof error === 'object') {
        error.cleanupError = cleanupFailure
      }
      throw error
    }
  }

  async _createServer() {
    return this.createOpencodeFn({
      hostname: '127.0.0.1',
      port: 0,
      timeout: 10000,
      signal: this.abortController.signal,
      config: this.config,
    })
  }

  async _waitForReady() {
    this._assertStarting()
    await this._checkHealth()
    this._assertStarting()
    await this._checkAgent()
    this._assertStarting()
    await this._checkSkill()
    this._assertStarting()
    await this._waitForMcpAndTool()
  }

  async _checkHealth() {
    try {
      const response = await this.client.v2.health.get(this._requestOptions())
      this._assertStarting()
      if (response?.data?.healthy !== true) {
        throw new Error('OpenCode health endpoint did not report healthy')
      }
    } catch (error) {
      if (this._isClosed()) throw this._closedError()
      throw runtimeError('E_OPENCODE_HEALTH', error.message, error)
    }
  }

  async _checkAgent() {
    try {
      const response = await this.client.app.agents(
        { directory: this.directory },
        this._requestOptions()
      )
      this._assertStarting()
      if (!response?.data?.some((agent) => agent.name === 'spider')) {
        throw new Error('OpenCode agent spider is unavailable')
      }
    } catch (error) {
      if (this._isClosed()) throw this._closedError()
      throw runtimeError('E_AGENT_NOT_READY', error.message, error)
    }
  }

  async _checkSkill() {
    try {
      const response = await this.client.app.skills(
        { directory: this.directory },
        this._requestOptions()
      )
      this._assertStarting()
      if (!response?.data?.some((skill) => skill.name === 'deepspider')) {
        throw new Error('DeepSpider skill is unavailable')
      }
    } catch (error) {
      if (this._isClosed()) throw this._closedError()
      throw runtimeError('E_SKILL_NOT_READY', error.message, error)
    }
  }

  async _waitForMcpAndTool() {
    let mcpReady = false
    let toolReady
    let lastMcpError = null

    for (let attempt = 0; attempt < READY_ATTEMPTS; attempt++) {
      this._assertStarting()
      try {
        const response = await this.client.mcp.status(
          { directory: this.directory },
          this._requestOptions()
        )
        this._assertStarting()
        const mcp = response?.data?.deepspider
        mcpReady = mcp?.status === 'connected'
        if (!mcpReady) lastMcpError = mcp?.error || `MCP status is ${mcp?.status || 'missing'}`
      } catch (error) {
        if (this._isClosed()) throw this._closedError()
        mcpReady = false
        lastMcpError = error
      }

      this._assertStarting()
      try {
        const response = await this.client.tool.ids(
          { directory: this.directory },
          this._requestOptions()
        )
        this._assertStarting()
        toolReady = response?.data?.includes('evolve_skill') === true
      } catch {
        if (this._isClosed()) throw this._closedError()
        toolReady = false
      }

      if (mcpReady && toolReady) return
      if (attempt < READY_ATTEMPTS - 1) {
        this._assertStarting()
        try {
          await this.sleepFn(READY_INTERVAL_MS, this.abortController.signal)
        } catch (error) {
          if (this._isClosed()) throw this._closedError()
          throw error
        }
        this._assertStarting()
      }
    }

    if (!mcpReady) {
      const message = lastMcpError instanceof Error ? lastMcpError.message : lastMcpError
      throw runtimeError(
        'E_MCP_NOT_READY',
        `DeepSpider MCP is not ready: ${message || 'unknown error'}`,
        lastMcpError instanceof Error ? lastMcpError : undefined
      )
    }

    throw runtimeError('E_PLUGIN_NOT_READY', 'DeepSpider plugin tool evolve_skill is unavailable')
  }

  _requestOptions() {
    return {
      throwOnError: true,
      signal: this.abortController.signal,
    }
  }

  _isClosed() {
    return this.state !== 'starting' || this.abortController.signal.aborted
  }

  _assertStarting() {
    if (this._isClosed()) throw this._closedError()
  }

  _closedError() {
    return runtimeError('E_RUNTIME_CLOSED', 'OpenCode runtime was closed while becoming ready')
  }
}

function readInstalledVersions() {
  return Object.fromEntries(
    OPENCODE_PACKAGES.map((pkg) => {
      const packageJsonPath = resolvePackageJson(pkg)
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))
      return [pkg.name, packageJson.version]
    })
  )
}

function resolvePackageJson(pkg) {
  if (pkg.packageJson) return require.resolve(pkg.entry)

  const packageSegments = pkg.name.split('/')
  for (const moduleDirectory of require.resolve.paths(pkg.name) ?? []) {
    const packageJsonPath = path.join(moduleDirectory, ...packageSegments, 'package.json')
    if (fs.existsSync(packageJsonPath)) return fs.realpathSync(packageJsonPath)
  }

  throw new Error(`Unable to find package.json for ${pkg.name}`)
}

function runtimeError(code, message, cause) {
  const error = new Error(message, cause ? { cause } : undefined)
  error.code = code
  return error
}

function stopProcess(child) {
  if (child.exitCode != null || child.signalCode != null) return
  if (process.platform === 'win32' && child.pid) {
    const result = spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
      shell: false,
      windowsHide: true,
    })
    if (!result.error && result.status === 0) return
  }
  child.kill('SIGTERM')
}

function cleanupError(errors) {
  if (errors.length === 1) return errors[0]
  return new globalThis.AggregateError(errors, 'OpenCode runtime cleanup failed')
}

function sleep(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason)
      return
    }

    const timer = setTimeout(() => {
      clear()
      resolve()
    }, milliseconds)
    const abort = () => {
      clearTimeout(timer)
      clear()
      reject(signal.reason)
    }
    const clear = () => signal?.removeEventListener('abort', abort)
    signal?.addEventListener('abort', abort, { once: true })
  })
}
