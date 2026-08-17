function installer(effective) {
  const root = globalThis

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
