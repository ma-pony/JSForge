import { BrowserClient } from '../browser/client.js'
import { SdenvRuntimeAdapter } from '../recovery/runtime/sdenv-adapter.js'
import { SessionArtifactStore } from '../store/SessionArtifactStore.js'

function abortError(reason) {
  if (reason instanceof Error) return reason
  return new Error(reason == null ? 'Runtime aborted' : String(reason))
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError(signal.reason)
}

function combinedSignal(first, second) {
  if (!first) return second
  if (!second) return first
  return globalThis.AbortSignal.any([first, second])
}

function waitFor(promise, { signal, timeout, timeoutMessage } = {}) {
  if (!signal && timeout == null) return promise

  return new Promise((resolve, reject) => {
    let timer
    const onAbort = () => finish(reject, abortError(signal.reason))
    const finish = (settle, value) => {
      if (timer) clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      settle(value)
    }

    promise.then(
      (value) => finish(resolve, value),
      (error) => finish(reject, error),
    )

    if (signal?.aborted) {
      reject(abortError(signal.reason))
      return
    }

    signal?.addEventListener('abort', onAbort, { once: true })
    if (timeout != null) {
      timer = setTimeout(() => finish(reject, new Error(timeoutMessage)), timeout)
    }
  })
}

export class DeepSpiderRuntime {
  constructor({
    sessionId,
    paths,
    browserFactory = ({ dataStore }) => new BrowserClient({ dataStore }),
    dataStoreFactory = ({ paths }) => new SessionArtifactStore({ root: paths.evidence }),
    recoveryRuntimeFactory = ({ sessionId, runsDir, env }) => new SdenvRuntimeAdapter({ sessionId, runsDir, env }),
    env = process.env,
    onDialogMessage = null,
  }) {
    if (typeof sessionId !== 'string' || sessionId.length === 0) {
      throw new TypeError('sessionId must be a non-empty string')
    }
    if (!paths || typeof paths !== 'object') {
      throw new TypeError('paths must be provided')
    }
    if (typeof browserFactory !== 'function' || typeof dataStoreFactory !== 'function' || typeof recoveryRuntimeFactory !== 'function') {
      throw new TypeError('browserFactory, dataStoreFactory and recoveryRuntimeFactory must be functions')
    }

    this.sessionId = sessionId
    this.paths = paths
    this.env = env
    this.browserFactory = browserFactory
    this.dataStoreFactory = dataStoreFactory
    this.recoveryRuntimeFactory = recoveryRuntimeFactory
    this.dataStore = dataStoreFactory({ sessionId, paths, env })
    this.onDialogMessage = onDialogMessage

    this.browserClient = null
    this.recoveryRuntime = null
    this.page = null
    this.cdpSession = null
    this.activeFrame = { frameId: null, contextId: null }
    this.cdpState = {
      debuggerSession: null,
      debuggerInitializationPromise: null,
      debuggerInitializationSession: null,
      rawClient: null,
      isPaused: false,
      currentCallFrames: [],
      activeBreakpoints: [],
    }
    this.captures = {
      savedSessionState: null,
      consoleMessages: [],
      consoleTracking: false,
      consoleSession: null,
      consoleInitializationPromise: null,
      consoleInitializationSession: null,
      webSocketConnections: [],
      webSocketMessages: [],
      webSocketTracking: false,
      webSocketSession: null,
      webSocketInitializationPromise: null,
      webSocketInitializationSession: null,
      propertyFacts: [],
    }
    this.selectedTarget = null

    this._browserPromise = null
    this._pendingBrowser = null
    this._closePromise = null
    this._closed = false
    this._lifetime = new globalThis.AbortController()
  }

  async getBrowserClient({ signal } = {}) {
    throwIfAborted(signal)
    if (this._closed) throw abortError(this._lifetime.signal.reason || 'Runtime is closed')
    if (this.browserClient) return this.browserClient

    if (!this._browserPromise) {
      const browserPromise = this._createBrowserClient()
      this._browserPromise = browserPromise
      browserPromise.catch(() => {
        if (this._browserPromise === browserPromise && !this._closed) {
          this._browserPromise = null
        }
      })
    }

    const client = await waitFor(this._browserPromise, { signal })
    throwIfAborted(signal)
    return client
  }

  getRecoveryRuntime() {
    if (this._closed) throw abortError(this._lifetime.signal.reason || 'Runtime is closed')
    if (this.recoveryRuntime) return this.recoveryRuntime
    const runtime = this.recoveryRuntimeFactory({
      sessionId: this.sessionId,
      runsDir: this.paths.runs,
      env: this.env,
    })
    if (!runtime || typeof runtime.execute !== 'function' || typeof runtime.close !== 'function') {
      throw new TypeError('recoveryRuntimeFactory must return a Recovery Runtime')
    }
    this.recoveryRuntime = runtime
    return runtime
  }

  async getPage({ signal } = {}) {
    const client = await this.getBrowserClient({ signal })
    throwIfAborted(signal)
    this.page = client.getPage()
    return this.page
  }

  async getCDPSession({ signal } = {}) {
    const client = await this.getBrowserClient({ signal })
    const nextSession = await waitFor(Promise.resolve(client.getCDPSession()), { signal })
    if (!nextSession) throw new Error('CDP session unavailable')
    if (this.cdpSession && this.cdpSession !== nextSession) {
      this.clearPageDerivedState()
    }
    this.cdpSession = nextSession
    throwIfAborted(signal)
    return this.cdpSession
  }

  waitForOperation(promise, options = {}) {
    return waitFor(Promise.resolve(promise), {
      ...options,
      signal: combinedSignal(options.signal, this._lifetime.signal),
    })
  }

  async cdpSend(method, params = {}, options = {}) {
    const { signal, timeout, timeoutMessage = `CDP ${method} timeout` } = options
    const cdp = await this.getCDPSession({ signal })
    return this.waitForOperation(cdp.send(method, params), {
      signal,
      timeout,
      timeoutMessage,
    })
  }

  async cdpEvaluate(expression, options = {}) {
    const {
      returnByValue = true,
      timeout = 5000,
      signal,
    } = options
    const cdp = await this.getCDPSession({ signal })
    const params = {
      expression,
      returnByValue,
      awaitPromise: true,
    }
    if (this.activeFrame.contextId != null) {
      params.contextId = this.activeFrame.contextId
    }

    const result = await waitFor(
      Promise.resolve(cdp.send('Runtime.evaluate', params)),
      { signal, timeout, timeoutMessage: 'CDP evaluate timeout' },
    )
    if (result.exceptionDetails) {
      const message = result.exceptionDetails.text || 'CDP evaluate error'
      if (/Cannot find context with specified id/i.test(message) && this.activeFrame.contextId != null) {
        this.activeFrame = { frameId: null, contextId: null }
        throw new Error(`${message} — active frame context was invalidated, call select_frame again`)
      }
      throw new Error(message)
    }
    return result.result?.value
  }

  async navigateTo(url, options = {}) {
    const { signal } = options
    this.clearNavigationDerivedState()
    const client = await this.getBrowserClient({ signal })
    return waitFor(Promise.resolve(client.navigate(url, options)), { signal })
  }

  async sendDialog(payload, { open = false } = {}) {
    if (!this.browserClient) return false
    if (open) await this.browserClient.openDialog()
    return this.browserClient.sendDialogMessage(payload)
  }

  setActiveFrameContext(frameId, executionContextId) {
    this.activeFrame = {
      frameId: frameId || null,
      contextId: executionContextId ?? null,
    }
  }

  getActiveFrameContext() {
    return { ...this.activeFrame }
  }

  clearActiveFrameContext() {
    this.activeFrame = { frameId: null, contextId: null }
  }

  clearNavigationDerivedState() {
    this.clearActiveFrameContext()
    this.cdpState.isPaused = false
    this.cdpState.currentCallFrames = []
  }

  clearPageDerivedState() {
    this.page = null
    this.cdpSession = null
    this.clearActiveFrameContext()
    this.cdpState.debuggerSession = null
    this.cdpState.debuggerInitializationPromise = null
    this.cdpState.debuggerInitializationSession = null
    this.cdpState.rawClient = null
    this.cdpState.isPaused = false
    this.cdpState.currentCallFrames = []
    this.cdpState.activeBreakpoints = []
    this.captures.consoleMessages = []
    this.captures.consoleTracking = false
    this.captures.consoleSession = null
    this.captures.consoleInitializationPromise = null
    this.captures.consoleInitializationSession = null
    this.captures.webSocketConnections = []
    this.captures.webSocketMessages = []
    this.captures.webSocketTracking = false
    this.captures.webSocketSession = null
    this.captures.webSocketInitializationPromise = null
    this.captures.webSocketInitializationSession = null
  }

  close(reason) {
    if (this._closePromise) return this._closePromise

    this._closed = true
    this._lifetime.abort(abortError(reason || 'Runtime closed'))
    this._closePromise = this._closeOwnedResources(reason)
    return this._closePromise
  }

  async _createBrowserClient() {
    let client
    try {
      client = await this.browserFactory({
        sessionId: this.sessionId,
        paths: this.paths,
        dataStore: this.dataStore,
        env: this.env,
        signal: this._lifetime.signal,
      })
      throwIfAborted(this._lifetime.signal)
      if (!client || typeof client.launch !== 'function') {
        throw new TypeError('browserFactory must return a BrowserClient')
      }
      client.onMessage = (message) => this.onDialogMessage?.(message)
      this._pendingBrowser = client
      await client.launch({
        headless: this.env.DEEPSPIDER_HEADLESS === 'true',
        userDataDir: this.paths.browserData,
        mode: 'observe',
      })
      throwIfAborted(this._lifetime.signal)
      this.browserClient = client
      return client
    } catch (error) {
      if (client && typeof client.close === 'function') {
        try {
          await client.close(error)
        } catch (cleanupError) {
          error.cleanupError = cleanupError
        }
      }
      throw error
    } finally {
      this._pendingBrowser = null
    }
  }

  async _closeOwnedResources(reason) {
    const errors = []
    if (this.recoveryRuntime) {
      try {
        await this.recoveryRuntime.close(reason)
      } catch (error) {
        errors.push(error)
      }
    }
    let client = this.browserClient || this._pendingBrowser

    if (this._browserPromise) {
      try {
        client = await this._browserPromise
      } catch {
        client = null
      }
    }

    if (client && typeof client.close === 'function') {
      try {
        await client.close(reason)
      } catch (error) {
        errors.push(error)
      }
    }

    if (typeof this.dataStore?.close === 'function') {
      try {
        await this.dataStore.close(reason)
      } catch (error) {
        errors.push(error)
      }
    }

    this.browserClient = null
    this.recoveryRuntime = null
    this.page = null
    this.cdpSession = null

    if (errors.length === 1) throw errors[0]
    if (errors.length > 1) throw new AggregateError(errors, 'Runtime cleanup failed')
  }
}
