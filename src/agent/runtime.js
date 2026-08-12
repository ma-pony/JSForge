/**
 * OpenCode V2 runtime lifecycle.
 *
 * The installed DeepSpider directory supplies the bundled OpenCode binary,
 * plugins, and skills. `directory` remains the user's OpenCode project.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createOpencode } from '@opencode-ai/sdk/v2'
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
let pathCriticalSection = Promise.resolve()

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
 * @param {typeof createOpencode} [options.createOpencodeFn]
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
    createOpencodeFn = createOpencode,
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
    const packageRoot = path.dirname(require.resolve('opencode-ai/package.json'))
    const executablePath = path.join(packageRoot, 'bin', 'opencode.exe')
    return withPinnedOpencodePath(executablePath, () =>
      this.createOpencodeFn({
        hostname: '127.0.0.1',
        port: 0,
        timeout: 10000,
        signal: this.abortController.signal,
        config: this.config,
      })
    )
  }

  async _waitForReady() {
    await this._checkHealth()
    await this._checkAgent()
    await this._checkSkill()
    await this._waitForMcpAndTool()
  }

  async _checkHealth() {
    try {
      const response = await this.client.v2.health.get({ throwOnError: true })
      if (response?.data?.healthy !== true) {
        throw new Error('OpenCode health endpoint did not report healthy')
      }
    } catch (error) {
      throw runtimeError('E_OPENCODE_HEALTH', error.message, error)
    }
  }

  async _checkAgent() {
    try {
      const response = await this.client.app.agents(
        { directory: this.directory },
        { throwOnError: true }
      )
      if (!response?.data?.some((agent) => agent.name === 'spider')) {
        throw new Error('OpenCode agent spider is unavailable')
      }
    } catch (error) {
      throw runtimeError('E_AGENT_NOT_READY', error.message, error)
    }
  }

  async _checkSkill() {
    try {
      const response = await this.client.app.skills(
        { directory: this.directory },
        { throwOnError: true }
      )
      if (!response?.data?.some((skill) => skill.name === 'deepspider')) {
        throw new Error('DeepSpider skill is unavailable')
      }
    } catch (error) {
      throw runtimeError('E_SKILL_NOT_READY', error.message, error)
    }
  }

  async _waitForMcpAndTool() {
    let mcpReady = false
    let toolReady
    let lastMcpError = null

    for (let attempt = 0; attempt < READY_ATTEMPTS; attempt++) {
      try {
        const response = await this.client.mcp.status(
          { directory: this.directory },
          { throwOnError: true }
        )
        const mcp = response?.data?.deepspider
        mcpReady = mcp?.status === 'connected'
        if (!mcpReady) lastMcpError = mcp?.error || `MCP status is ${mcp?.status || 'missing'}`
      } catch (error) {
        mcpReady = false
        lastMcpError = error
      }

      try {
        const response = await this.client.tool.ids(
          { directory: this.directory },
          { throwOnError: true }
        )
        toolReady = response?.data?.includes('evolve_skill') === true
      } catch {
        toolReady = false
      }

      if (mcpReady && toolReady) return
      if (attempt < READY_ATTEMPTS - 1) await this.sleepFn(READY_INTERVAL_MS)
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
  let entryPath
  try {
    entryPath = require.resolve(pkg.entry)
  } catch (error) {
    if (pkg.packageJson || error.code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED') throw error
    entryPath = fileURLToPath(import.meta.resolve(pkg.entry))
  }

  if (pkg.packageJson) return entryPath

  let directory = path.dirname(entryPath)
  while (true) {
    const packageJsonPath = path.join(directory, 'package.json')
    if (fs.existsSync(packageJsonPath)) return packageJsonPath
    const parent = path.dirname(directory)
    if (parent === directory) {
      throw new Error(`Unable to find package.json for ${pkg.name}`)
    }
    directory = parent
  }
}

function runtimeError(code, message, cause) {
  const error = new Error(message, cause ? { cause } : undefined)
  error.code = code
  return error
}

async function withPinnedOpencodePath(executablePath, createOpencodeFn) {
  const previous = pathCriticalSection
  let release
  pathCriticalSection = new Promise((resolve) => {
    release = resolve
  })
  await previous

  let temporaryBinDirectory
  let binDirectory = path.dirname(executablePath)
  if (process.platform !== 'win32') {
    temporaryBinDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'deepspider-opencode-bin-'))
    fs.symlinkSync(executablePath, path.join(temporaryBinDirectory, 'opencode'))
    binDirectory = temporaryBinDirectory
  }
  const originalPath = process.env.PATH
  process.env.PATH = originalPath
    ? `${binDirectory}${path.delimiter}${originalPath}`
    : binDirectory

  try {
    return await createOpencodeFn()
  } finally {
    if (originalPath === undefined) delete process.env.PATH
    else process.env.PATH = originalPath
    if (temporaryBinDirectory) {
      fs.rmSync(temporaryBinDirectory, { recursive: true, force: true })
    }
    release()
  }
}

function cleanupError(errors) {
  if (errors.length === 1) return errors[0]
  return new globalThis.AggregateError(errors, 'OpenCode runtime cleanup failed')
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}
