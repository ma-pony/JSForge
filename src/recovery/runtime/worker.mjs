import { createRequire } from 'node:module'

import { validateWorkerRequest } from './protocol.js'

const require = createRequire(import.meta.url)
const { jsdomFromUrl, version } = require('sdenv')

function diagnostic(...values) {
  console.error(...values)
}

function jsonSafe(value) {
  try {
    return JSON.parse(JSON.stringify(value))
  } catch {
    return { value: String(value) }
  }
}

function resolvePathParent(window, path) {
  const parts = path.split('.')
  if (parts.some((part) => part.length === 0)) {
    throw new TypeError(`Runtime path must be dot-separated: ${path}`)
  }

  let target = window
  for (const part of parts.slice(0, -1)) {
    target = Reflect.get(target, part)
    if (target == null || (typeof target !== 'object' && typeof target !== 'function')) return null
  }
  return { target, property: parts.at(-1) }
}

function applyFixedValues(window, values) {
  for (const [path, value] of Object.entries(values)) {
    const parent = resolvePathParent(window, path)
    if (!parent) throw new Error(`Cannot resolve fixed runtime path: ${path}`)
    Object.defineProperty(parent.target, parent.property, {
      value,
      configurable: true,
      enumerable: true,
      writable: true,
    })
  }
}

function applyConcealment(window, paths, windowProxyConfig) {
  for (const path of paths) {
    const parent = resolvePathParent(window, path)
    if (parent) {
      const descriptor = Object.getOwnPropertyDescriptor(parent.target, parent.property)
      if (!descriptor || descriptor.configurable) {
        Reflect.deleteProperty(parent.target, parent.property)
        continue
      }
    }

    const undefinedKeys = windowProxyConfig.windowGetterUndefinedKeys ||= []
    if (!undefinedKeys.includes(path.split('.').at(-1))) {
      undefinedKeys.push(path.split('.').at(-1))
    }
  }
}

function cookieOutputs(cookieHeader) {
  if (!cookieHeader) return []
  return cookieHeader.split(/;\s*/).filter(Boolean).map((pair) => {
    const separator = pair.indexOf('=')
    return {
      kind: 'cookie',
      name: separator === -1 ? pair : pair.slice(0, separator),
      value: separator === -1 ? '' : pair.slice(separator + 1),
    }
  })
}

function waitForExit(exitPromise, timeoutMs) {
  let timer
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs)
  })
  return Promise.race([exitPromise, timeout]).finally(() => clearTimeout(timer))
}

async function execute(request) {
  const windowProxyConfig = { ...request.recipe.windowProxyConfig }
  if (Array.isArray(windowProxyConfig.windowGetterUndefinedKeys)) {
    windowProxyConfig.windowGetterUndefinedKeys = [...windowProxyConfig.windowGetterUndefinedKeys]
  }

  let resolveExit
  const exitPromise = new Promise((resolve) => {
    resolveExit = resolve
  })
  const events = []
  let dom
  try {
    dom = await jsdomFromUrl(request.contract.entryUrl, {
      userAgent: request.recipe.userAgent,
      strictSSL: request.recipe.strictSSL,
      windowProxyConfig,
      consoleConfig: {
        log: diagnostic,
        info: diagnostic,
        warn: diagnostic,
        error: diagnostic,
        table: diagnostic,
      },
      beforeParse(window) {
        applyFixedValues(window, request.recipe.fixedValues)
        applyConcealment(window, request.recipe.conceal, windowProxyConfig)
        window.addEventListener('sdenv:exit', (event) => {
          const detail = jsonSafe(event.detail || {})
          events.push({ type: 'sdenv:exit', detail })
          resolveExit(detail)
        }, { once: true })
      },
    })

    const exit = await waitForExit(exitPromise, request.recipe.timeoutMs)
    const finalUrl = typeof exit?.url === 'string' && exit.url.length > 0
      ? new URL(exit.url, request.contract.entryUrl).href
      : dom.window.location.href
    events.push({ type: 'final-url', url: finalUrl })
    const cookieHeader = dom.cookieJar.getCookieStringSync(request.contract.entryUrl)
    return {
      type: 'result',
      runId: request.runId,
      ok: true,
      engine: { name: 'sdenv', version },
      outputs: cookieOutputs(cookieHeader),
      events,
      unknowns: exit ? [] : [{ category: 'runtime-timeout', reason: 'sdenv:exit was not observed' }],
    }
  } finally {
    dom?.window?.close()
  }
}

function failure(runId, error) {
  return {
    type: 'result',
    runId,
    ok: false,
    engine: { name: 'sdenv', version },
    outputs: [],
    events: [],
    unknowns: [{ category: 'runtime-error', reason: error instanceof Error ? error.message : String(error) }],
  }
}

async function main() {
  let runId = 'invalid-request'
  try {
    let input = ''
    for await (const chunk of process.stdin) input += chunk
    const [line] = input.split(/\r?\n/).filter(Boolean)
    const raw = JSON.parse(line)
    runId = typeof raw?.runId === 'string' && raw.runId.length > 0 ? raw.runId : runId
    const request = validateWorkerRequest(raw)
    process.stdout.write(`${JSON.stringify(await execute(request))}\n`)
  } catch (error) {
    diagnostic(error?.stack || error)
    process.stdout.write(`${JSON.stringify(failure(runId, error))}\n`)
  }
}

await main()
