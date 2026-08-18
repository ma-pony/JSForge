import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { isAbsolute, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { validateOutputContract } from '../contracts.js'
import { validateRuntimeRecipe } from '../recipe.js'
import { validateWorkerRequest, validateWorkerResult } from './protocol.js'

const WORKER_PATH = fileURLToPath(new URL('./worker.mjs', import.meta.url))
const TERMINATION_GRACE_MS = 250

function nonEmptyString(value, name) {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${name} must be a non-empty string`)
  return value
}

function abortReason(signal) {
  const reason = signal?.reason
  return reason instanceof Error ? reason.message : String(reason || 'Runtime aborted')
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms))
}

function workerEnvironment(env) {
  const next = {}
  for (const key of ['PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'SSL_CERT_FILE']) {
    if (typeof env[key] === 'string' && env[key].length > 0) next[key] = env[key]
  }
  for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy', 'ALL_PROXY', 'all_proxy']) {
    if (typeof env[key] === 'string' && env[key].length > 0) next[key] = env[key]
  }
  return next
}

function failedResult(runId, category, reason) {
  return {
    type: 'result',
    runId,
    ok: false,
    engine: { name: 'sdenv', version: 'unavailable' },
    outputs: [],
    events: [],
    unknowns: [{ category, reason }],
  }
}

export class SdenvRuntimeAdapter {
  constructor({ sessionId, runsDir, env = process.env, spawnImpl = spawn }) {
    this.sessionId = nonEmptyString(sessionId, 'sessionId')
    this.runsDir = nonEmptyString(runsDir, 'runsDir')
    if (!isAbsolute(this.runsDir)) throw new TypeError('runsDir must be absolute')
    if (!env || typeof env !== 'object') throw new TypeError('env must be an object')
    if (typeof spawnImpl !== 'function') throw new TypeError('spawnImpl must be a function')

    this.env = env
    this.spawnImpl = spawnImpl
    this.active = new Map()
    this.closed = false
    this.closePromise = null
  }

  async execute({ runId, contract, recipe, signal } = {}) {
    if (this.closed) throw new Error('Recovery runtime is closed')
    runId = nonEmptyString(runId, 'runId')
    if (this.active.has(runId)) throw new Error(`Recovery run already active: ${runId}`)

    const safeRunDir = resolve(this.runsDir, runId)
    if (safeRunDir !== this.runsDir && !safeRunDir.startsWith(`${this.runsDir}${sep}`)) {
      throw new TypeError('runId must resolve within runsDir')
    }
    const request = validateWorkerRequest({
      type: 'execute',
      runId,
      sessionId: this.sessionId,
      contract: validateOutputContract(contract),
      recipe: validateRuntimeRecipe(recipe),
      runDir: safeRunDir,
    })
    const record = this.#createRecord(request, signal)
    this.active.set(runId, record)
    record.watchAbort()

    if (record.terminating) return record.promise
    try {
      await mkdir(safeRunDir, { recursive: true, mode: 0o700 })
      if (record.terminating || this.closed) {
        void record.terminate('Recovery runtime closed')
        return record.promise
      }
      await writeFile(join(safeRunDir, 'request.json'), `${JSON.stringify(request)}\n`, { mode: 0o600 })
      if (record.terminating || this.closed) {
        void record.terminate('Recovery runtime closed')
        return record.promise
      }
      record.spawn()
    } catch (error) {
      void record.finish(failedResult(runId, 'worker-preparation-error', error.message))
    }
    return record.promise
  }

  close(reason = 'Recovery runtime closed') {
    if (this.closePromise) return this.closePromise
    this.closed = true
    this.closePromise = Promise.all([...this.active.values()].map((record) => record.terminate(reason)))
      .then(() => undefined)
    return this.closePromise
  }

  #createRecord(request, signal) {
    let child
    let stdout = ''
    let stderr = ''
    let finished = false
    let timer
    let resolveResult
    const record = {
      terminating: false,
      promise: new Promise((resolve) => { resolveResult = resolve }),
    }
    const onAbort = () => {
      void record.terminate(abortReason(signal), 'runtime-aborted')
    }

    record.finish = async (result) => {
      if (finished) return record.promise
      finished = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      if (this.active.get(request.runId) === record) this.active.delete(request.runId)
      try {
        await writeFile(join(request.runDir, 'result.json'), `${JSON.stringify(result)}\n`, { mode: 0o600 })
        if (stderr) await writeFile(join(request.runDir, 'stderr.log'), stderr, { mode: 0o600 })
      } catch {
        // The result still reaches the Session caller if diagnostics cannot be persisted.
      }
      resolveResult(result)
      return record.promise
    }

    record.terminate = async (reason, category = 'runtime-terminated') => {
      if (finished || record.terminating) return record.promise
      record.terminating = true
      if (!child) return record.finish(failedResult(request.runId, category, String(reason)))
      if (child.exitCode == null) child.kill('SIGTERM')
      await delay(TERMINATION_GRACE_MS)
      if (child.exitCode == null) child.kill('SIGKILL')
      return record.finish(failedResult(request.runId, category, String(reason)))
    }

    record.watchAbort = () => {
      signal?.addEventListener('abort', onAbort, { once: true })
      if (signal?.aborted) onAbort()
    }

    record.spawn = () => {
      if (record.terminating || this.closed) {
        void record.terminate('Recovery runtime closed')
        return
      }
      try {
        child = this.spawnImpl(process.execPath, [WORKER_PATH], {
          shell: false,
          stdio: ['pipe', 'pipe', 'pipe'],
          env: workerEnvironment(this.env),
        })
        child.stdout.on('data', (chunk) => { stdout += chunk })
        child.stderr.on('data', (chunk) => { stderr += chunk })
        child.once('error', (error) => {
          void record.finish(failedResult(request.runId, 'worker-spawn-error', error.message))
        })
        child.once('close', () => {
          if (finished || record.terminating) return
          const lines = stdout.trim().split(/\r?\n/).filter(Boolean)
          if (lines.length !== 1) {
            void record.finish(failedResult(request.runId, 'worker-protocol-error', 'Worker must emit exactly one JSON result line'))
            return
          }
          try {
            const result = validateWorkerResult(JSON.parse(lines[0]))
            if (result.runId !== request.runId) throw new Error('Worker result runId does not match request')
            void record.finish(result)
          } catch (error) {
            void record.finish(failedResult(request.runId, 'worker-protocol-error', error.message))
          }
        })
        child.stdin.end(`${JSON.stringify(request)}\n`)
        timer = setTimeout(() => {
          void record.terminate(`Worker exceeded ${request.recipe.timeoutMs}ms`, 'runtime-timeout')
        }, request.recipe.timeoutMs + TERMINATION_GRACE_MS)
        if (signal?.aborted) onAbort()
      } catch (error) {
        void record.finish(failedResult(request.runId, 'worker-spawn-error', error.message))
      }
    }
    return record
  }
}
