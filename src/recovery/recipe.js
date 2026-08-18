import { createHash } from 'node:crypto'

const DEFAULT_RECIPE = Object.freeze({
  engine: 'sdenv',
  networkMode: 'same-site-live',
  strictSSL: false,
  timeoutMs: 10000,
  fixedValues: Object.freeze({}),
  conceal: Object.freeze([]),
  windowProxyConfig: Object.freeze({}),
})

function plainObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`)
  }
  return { ...value }
}

function concealPaths(value) {
  if (!Array.isArray(value) || value.some((path) => typeof path !== 'string' || path.length === 0)) {
    throw new TypeError('Runtime recipe conceal must be an array of non-empty strings')
  }
  return [...value]
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export function validateRuntimeRecipe(value) {
  const input = plainObject(value, 'Runtime recipe')
  if (input.engine !== 'sdenv') throw new TypeError('Runtime recipe engine must be sdenv')
  if (input.networkMode !== 'same-site-live') throw new TypeError('Runtime recipe networkMode must be same-site-live')
  if (typeof input.strictSSL !== 'boolean') throw new TypeError('Runtime recipe strictSSL must be a boolean')
  if (!Number.isFinite(input.timeoutMs) || input.timeoutMs <= 0) throw new TypeError('Runtime recipe timeoutMs must be a positive number')
  return {
    engine: input.engine,
    networkMode: input.networkMode,
    strictSSL: input.strictSSL,
    timeoutMs: input.timeoutMs,
    fixedValues: plainObject(input.fixedValues, 'Runtime recipe fixedValues'),
    conceal: concealPaths(input.conceal),
    windowProxyConfig: plainObject(input.windowProxyConfig, 'Runtime recipe windowProxyConfig'),
  }
}

export function createRuntimeRecipe(overrides = {}) {
  return validateRuntimeRecipe({
    ...DEFAULT_RECIPE,
    ...overrides,
    fixedValues: { ...DEFAULT_RECIPE.fixedValues, ...overrides.fixedValues },
    conceal: [...DEFAULT_RECIPE.conceal, ...(overrides.conceal || [])],
    windowProxyConfig: { ...DEFAULT_RECIPE.windowProxyConfig, ...overrides.windowProxyConfig },
  })
}

export function hashRecipe(recipe) {
  return createHash('sha256').update(stableJson(validateRuntimeRecipe(recipe))).digest('hex')
}

export { DEFAULT_RECIPE }
