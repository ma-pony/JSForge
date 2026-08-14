import { DeepSpiderRuntime } from './DeepSpiderRuntime.js'
import { createSessionPaths, ensureSessionPaths } from './SessionPaths.js'

function agentId(agent) {
  if (typeof agent?.id !== 'string' || agent.id.length === 0) {
    throw new TypeError('agent.id must be a non-empty string')
  }
  return agent.id
}

function abortError(reason) {
  if (reason instanceof Error) return reason
  return new Error(reason == null ? 'Operation aborted' : String(reason))
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError(signal.reason)
}

function waitForSignal(promise, signal) {
  if (!signal) return promise
  if (signal.aborted) return Promise.reject(abortError(signal.reason))

  return new Promise((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener('abort', onAbort)
      reject(abortError(signal.reason))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
}

function combinedSignal(first, second) {
  if (!first) return second
  if (!second) return first
  return globalThis.AbortSignal.any([first, second])
}

function defaultRuntimeFactory(agent) {
  const paths = ensureSessionPaths(createSessionPaths(agent.id))
  return new DeepSpiderRuntime({ sessionId: agent.id, paths })
}

export class RuntimeManager {
  constructor({ runtimeFactory = defaultRuntimeFactory } = {}) {
    if (typeof runtimeFactory !== 'function') {
      throw new TypeError('runtimeFactory must be a function')
    }

    this.runtimeFactory = runtimeFactory
    this.entries = new Map()
    this.closing = false
    this._closePromise = null
  }

  async get(agent, { signal } = {}) {
    const id = agentId(agent)
    throwIfAborted(signal)
    this._rejectIfClosing()

    const entry = this._getOrCreateEntry(id, agent)
    const operationSignal = combinedSignal(signal, entry.abortController.signal)
    const runtime = await waitForSignal(this._getRuntime(entry), operationSignal)
    throwIfAborted(operationSignal)
    return runtime
  }

  async run(agent, operation, { signal } = {}) {
    const id = agentId(agent)
    if (typeof operation !== 'function') throw new TypeError('operation must be a function')
    throwIfAborted(signal)
    this._rejectIfClosing()

    const entry = this._getOrCreateEntry(id, agent)
    const operationSignal = combinedSignal(signal, entry.abortController.signal)
    const previous = entry.queue
    let release
    let acquired = false
    entry.queue = new Promise((resolve) => {
      release = resolve
    })

    try {
      await waitForSignal(previous, operationSignal)
      acquired = true
      throwIfAborted(operationSignal)
      const runtime = await waitForSignal(this._getRuntime(entry), operationSignal)
      throwIfAborted(operationSignal)
      return await operation(runtime, operationSignal)
    } finally {
      if (acquired) {
        release()
      } else {
        previous.then(release, release)
      }
    }
  }

  async disposeAgent(agent, reason) {
    const id = agentId(agent)
    const entry = this.entries.get(id)
    if (!entry) return

    this.entries.delete(id)
    entry.abortController.abort(abortError(reason || `Agent ${id} disposed`))
    await this._closeEntry(entry, reason)
  }

  closeAll(reason) {
    if (this._closePromise) return this._closePromise

    this.closing = true
    const entries = [...this.entries.values()]
    this.entries.clear()
    for (const entry of entries) {
      entry.abortController.abort(abortError(reason || 'RuntimeManager is closing'))
    }

    this._closePromise = (async () => {
      const results = await Promise.allSettled(
        entries.map((entry) => this._closeEntry(entry, reason)),
      )
      const errors = results
        .filter((result) => result.status === 'rejected')
        .map((result) => result.reason)
      if (errors.length === 1) throw errors[0]
      if (errors.length > 1) throw new AggregateError(errors, 'RuntimeManager cleanup failed')
    })()
    return this._closePromise
  }

  _rejectIfClosing() {
    if (this.closing) throw new Error('RuntimeManager is closing')
  }

  _getOrCreateEntry(id, agent) {
    let entry = this.entries.get(id)
    if (!entry) {
      entry = {
        id,
        ownerAgent: agent,
        runtimePromise: null,
        queue: Promise.resolve(),
        abortController: new globalThis.AbortController(),
      }
      this.entries.set(id, entry)
    }
    return entry
  }

  _getRuntime(entry) {
    if (!entry.runtimePromise) {
      const creation = Promise.resolve().then(() => this.runtimeFactory(
        entry.ownerAgent,
        { signal: entry.abortController.signal },
      ))
      entry.runtimePromise = creation.then((runtime) => {
        if (!runtime || typeof runtime.close !== 'function') {
          throw new TypeError('runtimeFactory must return a Runtime')
        }
        return runtime
      }).catch(async (error) => {
        if (error?.runtime && typeof error.runtime.close === 'function') {
          try {
            await error.runtime.close(error)
          } catch (cleanupError) {
            if (error && typeof error === 'object') error.cleanupError = cleanupError
          }
        }
        if (this.entries.get(entry.id) === entry) {
          this.entries.delete(entry.id)
        }
        throw error
      })
    }
    return entry.runtimePromise
  }

  async _closeEntry(entry, reason) {
    if (!entry.runtimePromise) return

    let runtime
    try {
      runtime = await entry.runtimePromise
    } catch {
      return
    }
    await runtime.close(reason)
  }
}
