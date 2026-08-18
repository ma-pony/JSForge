import { mkdir, writeFile } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'

import { validateOutputContract } from './contracts.js'
import { validateRuntimeRecipe } from './recipe.js'

const SOLVER_SOURCE = `import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'

import initCycleTLS from 'cycletls'

const require = createRequire(import.meta.url)
const { jsdomFromUrl } = require('sdenv')

const contract = JSON.parse(await readFile(new URL('./contract.json', import.meta.url), 'utf8'))
const recipe = JSON.parse(await readFile(new URL('./recipe.json', import.meta.url), 'utf8'))
const blockedHeaders = new Set(['cookie', 'host', 'connection', 'content-length', 'accept-encoding', 'user-agent'])
const cookieName = /^[!#$%&'*+\\-.^_\`|~0-9A-Za-z]+$/
const cookieValue = /^[\\x21-\\x3A\\x3C-\\x7E]*$/

function titleOf(html) {
  const match = String(html || '').match(/<title[^>]*>([\\s\\S]*?)<\\/title>/i)
  return match?.[1]?.replace(/\\s+/g, ' ').trim() || ''
}

function cookieOutputs(header) {
  return String(header || '').split(/;\\s*/).filter(Boolean).map((pair) => {
    const separator = pair.indexOf('=')
    return { name: separator < 0 ? pair : pair.slice(0, separator), value: separator < 0 ? '' : pair.slice(separator + 1) }
  })
}

function resolvePathParent(window, path) {
  const parts = path.split('.')
  let owner = window
  for (const part of parts.slice(0, -1)) {
    owner = owner?.[part]
    if (owner == null) return null
  }
  return { owner, property: parts.at(-1) }
}

function applyRecipe(window, windowProxyConfig) {
  for (const [path, value] of Object.entries(recipe.fixedValues)) {
    const parent = resolvePathParent(window, path)
    if (!parent) throw new Error(\`Cannot resolve fixed runtime path: \${path}\`)
    Object.defineProperty(parent.owner, parent.property, { value, configurable: true, enumerable: true, writable: true })
  }
  for (const path of recipe.conceal) {
    const parent = resolvePathParent(window, path)
    if (parent) {
      const descriptor = Object.getOwnPropertyDescriptor(parent.owner, parent.property)
      if (descriptor?.configurable && Reflect.deleteProperty(parent.owner, parent.property) && !Reflect.has(parent.owner, parent.property)) continue
    }
    const keys = windowProxyConfig.windowGetterUndefinedKeys ||= []
    const key = path.split('.').at(-1)
    if (!keys.includes(key)) keys.push(key)
  }
}

function waitForExit(timeoutMs) {
  let resolveExit
  let timer
  const promise = new Promise((resolve) => {
    resolveExit = resolve
    timer = setTimeout(() => resolve(null), timeoutMs)
  }).finally(() => clearTimeout(timer))
  return { promise, resolve: resolveExit }
}

let dom
let client
try {
  const exit = waitForExit(recipe.timeoutMs)
  const windowProxyConfig = { ...recipe.windowProxyConfig }
  if (Array.isArray(windowProxyConfig.windowGetterUndefinedKeys)) {
    windowProxyConfig.windowGetterUndefinedKeys = [...windowProxyConfig.windowGetterUndefinedKeys]
  }
  dom = await jsdomFromUrl(contract.entryUrl, {
    userAgent: recipe.userAgent,
    strictSSL: recipe.strictSSL,
    windowProxyConfig,
    consoleConfig: { log() {}, info() {}, warn() {}, error() {}, table() {} },
    beforeParse(window) {
      applyRecipe(window, windowProxyConfig)
      window.addEventListener('sdenv:exit', (event) => exit.resolve(event.detail || {}), { once: true })
    },
  })
  await exit.promise
  const cookies = cookieOutputs(dom.cookieJar.getCookieStringSync(contract.entryUrl))
    .filter(({ name, value }) => cookieName.test(name) && cookieValue.test(value))
  const anchorPresent = cookies.length > 0
    && (!contract.selector || cookies.some(({ name }) => name === contract.selector))
  if (!anchorPresent) {
    console.log(JSON.stringify({ level: 'observed', accepted: false, status: null, expectedStatus: contract.success.status ?? null, title: null, expectedTitle: contract.success.title ?? null, outputCount: cookies.length, outputNames: cookies.map(({ name }) => name) }))
    process.exitCode = 1
  } else {
    const headers = Object.fromEntries(Object.entries(contract.request.headers || {}).filter(([name]) => !blockedHeaders.has(name.toLowerCase())))
    headers.Cookie = cookies.map(({ name, value }) => \`\${name}=\${value}\`).join('; ')
    client = await initCycleTLS({ autoExit: false, timeout: recipe.timeoutMs })
    const response = await client(contract.request.url, {
      headers,
      userAgent: recipe.userAgent,
      responseType: 'text',
      disableRedirect: true,
      insecureSkipVerify: recipe.strictSSL === false,
      timeout: recipe.timeoutMs,
    }, contract.request.method.toLowerCase())
    const body = typeof response.data === 'string' ? response.data : JSON.stringify(response.data ?? '')
    const title = titleOf(body)
    const accepted = (contract.success.status == null || response.status === contract.success.status)
      && (contract.success.title == null || title === contract.success.title)
    console.log(JSON.stringify({ level: accepted ? 'reproduced' : 'observed', accepted, status: response.status, expectedStatus: contract.success.status ?? null, title, expectedTitle: contract.success.title ?? null, outputCount: cookies.length, outputNames: cookies.map(({ name }) => name) }))
    if (!accepted) process.exitCode = 1
  }
} catch (error) {
  console.log(JSON.stringify({ level: 'observed', accepted: false, error: error instanceof Error ? error.message : String(error) }))
  process.exitCode = 1
} finally {
  dom?.window?.close()
  await client?.exit().catch(() => {})
}
`

const PACKAGE = {
  private: true,
  type: 'module',
  dependencies: {
    cycletls: '2.0.5',
    sdenv: '1.1.3',
  },
}

async function writeJson(file, value) {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
}

export async function exportSolver({ sessionId, contract, recipe, validation, solverDir }) {
  if (typeof sessionId !== 'string' || sessionId.length === 0) throw new TypeError('sessionId must be a non-empty string')
  if (typeof solverDir !== 'string' || !isAbsolute(solverDir)) throw new TypeError('solverDir must be absolute')
  const safeContract = validateOutputContract(contract)
  const safeRecipe = validateRuntimeRecipe(recipe)
  if (!validation || typeof validation !== 'object') throw new TypeError('validation must be provided')
  const validatedNames = Array.isArray(validation.generatedCookieNames) ? validation.generatedCookieNames : []
  const cookieAnchored = validation.accepted === true
    && validation.level === 'reproduced'
    && Number.isInteger(validation.generatedCookieCount)
    && validation.generatedCookieCount > 0
    && (!safeContract.selector || validatedNames.includes(safeContract.selector))
  if (!cookieAnchored) throw new TypeError('validation must be reproduced from a legal generated Cookie')
  const directory = resolve(solverDir)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  await Promise.all([
    writeFile(resolve(directory, 'solver.mjs'), SOLVER_SOURCE, { mode: 0o700 }),
    writeJson(resolve(directory, 'contract.json'), safeContract),
    writeJson(resolve(directory, 'recipe.json'), safeRecipe),
    writeJson(resolve(directory, 'package.json'), PACKAGE),
  ])
  return {
    directory,
    files: ['solver.mjs', 'contract.json', 'recipe.json', 'package.json'],
    validationLevel: validation.level || null,
  }
}
