import { createHash } from 'node:crypto'

const OUTPUT_KINDS = new Set(['cookie', 'header', 'query', 'body', 'return-value', 'navigation'])

function plainObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`)
  }
  return value
}

function normalizeUrl(value, name) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${name} must be a non-empty URL string`)
  }
  return new URL(value).href
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export function validateOutputContract(value) {
  const input = plainObject(value, 'Output contract')
  if (!OUTPUT_KINDS.has(input.kind)) throw new TypeError(`Unsupported output contract kind: ${input.kind}`)
  if (input.selector !== null && input.selector !== undefined && typeof input.selector !== 'string') {
    throw new TypeError('Output contract selector must be a string or null')
  }
  const request = plainObject(input.request, 'Output contract request')
  const normalizedRequest = { ...request }
  normalizedRequest.url = normalizeUrl(request.url, 'Output contract request URL')
  if (typeof request.method !== 'string' || request.method.length === 0) {
    throw new TypeError('Output contract request method must be a non-empty string')
  }
  normalizedRequest.method = request.method.toUpperCase()
  if (!input.success || typeof input.success !== 'object') throw new TypeError('Output contract success must be provided')
  return {
    kind: input.kind,
    selector: input.selector ?? null,
    entryUrl: normalizeUrl(input.entryUrl, 'Output contract entryUrl'),
    request: normalizedRequest,
    success: input.success,
  }
}

export function createOutputContract(input) {
  return validateOutputContract(input)
}

export function hashContract(contract) {
  return createHash('sha256').update(stableJson(validateOutputContract(contract))).digest('hex')
}

export { OUTPUT_KINDS }
