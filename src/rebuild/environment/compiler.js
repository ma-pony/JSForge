function installer(effective) {
  const root = globalThis
  let traceEmitter = null

  function emit(event) {
    if (traceEmitter) traceEmitter(event)
  }

  function isolateHostConstructors() {
    const realmFunction = Function
    const wrappedPrototypes = new Set()

    for (const key of Reflect.ownKeys(root)) {
      let original
      try { original = root[key] } catch { continue }
      if (typeof original !== 'function' || original.constructor === realmFunction) continue
      if (!original.prototype || wrappedPrototypes.has(original.prototype)) continue

      const facade = function (...args) {
        if (new.target) return Reflect.construct(original, args, original)
        return Reflect.apply(original, this, args)
      }
      try {
        Object.defineProperty(facade, 'name', { value: original.name, configurable: true })
      } catch {
        // Function names are diagnostic only.
      }
      try { facade.prototype = original.prototype } catch { continue }
      try {
        Object.defineProperty(original.prototype, 'constructor', {
          value: facade,
          configurable: true,
          writable: true,
        })
        Object.defineProperty(root, key, {
          value: facade,
          configurable: true,
          enumerable: false,
          writable: true,
        })
        wrappedPrototypes.add(original.prototype)
      } catch {
        // A non-configurable platform constructor remains owned by jsdom.
      }
    }
  }

  isolateHostConstructors()

  function parts(path) {
    const value = path.replace(/^(window|globalThis)\./, '')
    return value.split('.').filter(Boolean)
  }

  function ensureParent(path) {
    const keys = parts(path)
    const property = keys.pop()
    let parent = root
    for (const key of keys) {
      let next
      try { next = parent[key] } catch { next = undefined }
      if ((typeof next !== 'object' && typeof next !== 'function') || next === null) {
        next = Object.create(null)
        Object.defineProperty(parent, key, {
          value: next,
          configurable: true,
          enumerable: true,
          writable: true,
        })
      }
      parent = next
    }
    return { parent, property }
  }

  function defineValue(path, value) {
    const { parent, property } = ensureParent(path)
    Object.defineProperty(parent, property, {
      value,
      configurable: true,
      enumerable: true,
      writable: true,
    })
  }

  function hide(path) {
    const { parent, property } = ensureParent(path)
    let owner = parent
    while (owner) {
      const descriptor = Object.getOwnPropertyDescriptor(owner, property)
      if (descriptor) {
        if (descriptor.configurable) delete owner[property]
        else if (owner === parent) {
          Object.defineProperty(parent, property, {
            value: undefined,
            configurable: true,
          })
        }
      }
      owner = Object.getPrototypeOf(owner)
    }
  }

  for (const [path, value] of Object.entries(effective.values)) defineValue(path, value)

  for (const rule of effective.conceal) {
    if (rule.action === 'hide') {
      hide(rule.path)
      continue
    }
    const { parent, property } = ensureParent(rule.path)
    if (rule.action === 'undefined') {
      Object.defineProperty(parent, property, {
        value: undefined,
        configurable: true,
        enumerable: false,
        writable: false,
      })
    } else if (rule.action === 'throw') {
      Object.defineProperty(parent, property, {
        get() { throw new Error(rule.message || `Blocked property: ${rule.path}`) },
        configurable: true,
      })
    } else if (['fixed', 'replace', 'mask', 'hook', 'replay'].includes(rule.action)) {
      defineValue(rule.path, rule.value)
    }
  }

  const nativeSource = new WeakMap()
  const originalToString = Function.prototype.toString
  Object.defineProperty(Function.prototype, 'toString', {
    value: function toString() {
      return nativeSource.get(this) || originalToString.call(this)
    },
    configurable: true,
    writable: true,
  })

  function nativeFunction(name, implementation) {
    Object.defineProperty(implementation, 'name', { value: name, configurable: true })
    nativeSource.set(implementation, `function ${name}() { [native code] }`)
    return implementation
  }

  for (const [name, value] of [['atob', root.atob], ['btoa', root.btoa]]) {
    if (typeof value === 'function') {
      nativeSource.set(value, `function ${name}() { [native code] }`)
    }
  }

  const browserError = root.Error
  Object.defineProperty(browserError, 'prepareStackTrace', {
    value(error, frames) {
      const visibleFrames = frames.filter((frame) => {
        let file = ''
        try { file = String(frame.getFileName() || frame.getScriptNameOrSourceURL() || '') } catch {
          // Unreadable stack frames are omitted by the browser-style formatter.
        }
        return !/node:|internal\/|runner\.mjs/.test(file)
      })
      return `${browserError.prototype.toString.call(error)}${visibleFrames.map((frame) => `\n    at ${String(frame)}`).join('')}`
    },
    configurable: true,
    writable: true,
  })
  nativeSource.set(browserError.prepareStackTrace, 'function prepareStackTrace() { [native code] }')

  if (typeof root.Worker !== 'function') {
    defineValue('Worker', nativeFunction('Worker', function Worker() {
      throw new TypeError('Illegal constructor')
    }))
  }
  if (root.HTMLCanvasElement?.prototype) {
    const getContext = nativeFunction('getContext', function getContext(kind) {
      if (kind === '2d') return { canvas: this }
      if (kind === 'webgl' || kind === 'webgl2' || kind === 'experimental-webgl') {
        return { canvas: this, getExtension: () => null, getParameter: () => null }
      }
      return null
    })
    Object.defineProperty(root.HTMLCanvasElement.prototype, 'getContext', {
      value: getContext,
      configurable: true,
      writable: true,
    })
  }

  const replayResponses = Array.isArray(effective.replay?.responses)
    ? effective.replay.responses
    : []

  function normalizeRequest(input, options = {}) {
    const inputUrl = typeof input === 'object' && input !== null && 'url' in input
      ? input.url
      : String(input)
    const inputMethod = typeof input === 'object' && input !== null && 'method' in input
      ? input.method
      : 'GET'
    const inputBody = typeof input === 'object' && input !== null && 'body' in input
      ? input.body
      : null
    return {
      url: new URL(inputUrl, root.location.href).href,
      method: String(options.method || inputMethod || 'GET').toUpperCase(),
      body: options.body == null
        ? (inputBody == null ? null : String(inputBody))
        : String(options.body),
    }
  }

  function findReplay(request) {
    return replayResponses.find((response) =>
      response.url === request.url &&
      String(response.method || 'GET').toUpperCase() === request.method &&
      (response.requestBody == null ? null : String(response.requestBody)) === request.body)
  }

  function replayMiss(request) {
    emit({
      category: 'replay-miss',
      operation: 'request',
      path: request.url,
      method: request.method,
      body: request.body,
    })
    return new TypeError(`No replay response for ${request.method} ${request.url}`)
  }

  function replayHeaders(values = {}) {
    const entries = Object.entries(values).map(([name, value]) => [name.toLowerCase(), String(value)])
    const map = new Map(entries)
    return {
      get: (name) => map.get(String(name).toLowerCase()) ?? null,
      has: (name) => map.has(String(name).toLowerCase()),
      entries: () => map.entries(),
      keys: () => map.keys(),
      values: () => map.values(),
      forEach: (callback, thisArg) => map.forEach((value, name) => callback.call(thisArg, value, name)),
      [Symbol.iterator]: () => map.entries(),
    }
  }

  function replayResponse(record) {
    const body = record.body == null ? '' : String(record.body)
    return {
      ok: record.status >= 200 && record.status < 300,
      status: record.status,
      statusText: '',
      url: record.url,
      redirected: false,
      type: 'basic',
      headers: replayHeaders(record.headers),
      text: async () => body,
      json: async () => JSON.parse(body),
      arrayBuffer: async () => Uint8Array.from(body, (character) => character.charCodeAt(0) & 255).buffer,
    }
  }

  defineValue('fetch', nativeFunction('fetch', async function fetch(input, options = {}) {
    const request = normalizeRequest(input, options)
    const response = findReplay(request)
    if (!response) throw replayMiss(request)
    return replayResponse(response)
  }))

  class ReplayXMLHttpRequest {
    constructor() {
      this.readyState = 0
      this.status = 0
      this.responseText = ''
      this.response = ''
      this.responseURL = ''
      this.onload = null
      this.onerror = null
      this.onreadystatechange = null
      this.listeners = Object.create(null)
    }

    open(method, url) {
      this.method = String(method || 'GET').toUpperCase()
      this.url = new URL(String(url), root.location.href).href
      this.readyState = 1
      this.dispatch('readystatechange')
    }

    setRequestHeader() {}

    addEventListener(type, listener) {
      if (!this.listeners[type]) this.listeners[type] = []
      this.listeners[type].push(listener)
    }

    dispatch(type, value) {
      const handler = this[`on${type}`]
      if (typeof handler === 'function') handler.call(this, value)
      for (const listener of this.listeners[type] || []) listener.call(this, value)
    }

    send(body = null) {
      const request = { url: this.url, method: this.method, body: body == null ? null : String(body) }
      const record = findReplay(request)
      if (!record) {
        const error = replayMiss(request)
        this.readyState = 4
        this.dispatch('readystatechange')
        if (this.onerror || this.listeners.error?.length) this.dispatch('error', error)
        else throw error
        return
      }
      this.status = record.status
      this.responseText = record.body == null ? '' : String(record.body)
      this.response = this.responseText
      this.responseURL = record.url
      this.readyState = 4
      this.dispatch('readystatechange')
      this.dispatch('load')
    }
  }

  Object.defineProperty(ReplayXMLHttpRequest, 'name', { value: 'XMLHttpRequest', configurable: true })
  Object.defineProperty(ReplayXMLHttpRequest.prototype, Symbol.toStringTag, {
    value: 'XMLHttpRequest',
    configurable: true,
  })
  nativeSource.set(ReplayXMLHttpRequest, 'function XMLHttpRequest() { [native code] }')
  defineValue('XMLHttpRequest', ReplayXMLHttpRequest)

  return Object.freeze({
    setTraceEmitter(next) {
      traceEmitter = typeof next === 'function' ? next : null
    },
  })
}

export function getEnvironmentInstallerFunctionSource() {
  return installer.toString()
}

export function compileEnvironment({ baseline, sessionState = {}, recipe, replay = {} }) {
  if (!baseline || typeof baseline !== 'object') throw new TypeError('baseline must be provided')
  if (!recipe || typeof recipe !== 'object') throw new TypeError('recipe must be provided')

  const effective = {
    values: {
      ...(baseline.values || {}),
      ...(sessionState.values || {}),
      ...(recipe.fixedValues || {}),
    },
    conceal: [
      ...(baseline.conceal || []),
      ...(recipe.conceal || []),
    ],
    handlers: { ...(recipe.handlers || {}) },
    replay: { ...replay, ...(recipe.replay || {}) },
  }

  return {
    effective,
    installerSource: `(${installer.toString()})(${JSON.stringify(effective)})`,
  }
}
