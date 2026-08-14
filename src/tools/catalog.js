const DEFINITION_FIELDS = new Set([
  'name',
  'description',
  'parameters',
  'execute',
  'render',
])

function isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function deepFreeze(value, seen = new WeakSet()) {
  if (value === null || typeof value !== 'object') return value
  if (seen.has(value)) return value

  seen.add(value)
  for (const child of Object.values(value)) deepFreeze(child, seen)
  return Object.freeze(value)
}

export function defineDeepSpiderTool(options) {
  if (!isPlainObject(options)) {
    throw new TypeError('tool definition must be a plain object')
  }

  for (const field of Object.keys(options)) {
    if (!DEFINITION_FIELDS.has(field)) {
      throw new TypeError(`Unsupported tool definition field: ${field}`)
    }
  }

  const { name, description, parameters, execute, render } = options
  if (typeof name !== 'string' || name.length === 0) {
    throw new TypeError('name must be a non-empty string')
  }
  if (typeof description !== 'string' || description.length === 0) {
    throw new TypeError('description must be a non-empty string')
  }
  if (!isPlainObject(parameters)) {
    throw new TypeError('parameters must be a plain object')
  }
  if (typeof execute !== 'function') {
    throw new TypeError('execute must be a function')
  }
  if (render !== undefined && typeof render !== 'function') {
    throw new TypeError('render must be a function')
  }

  const definition = {
    name,
    description,
    parameters: deepFreeze(parameters),
    execute,
    ...(render === undefined ? {} : { render }),
  }
  return Object.freeze(definition)
}

export function createToolCatalog(groups) {
  if (!Array.isArray(groups)) throw new TypeError('groups must be an array')

  const names = new Set()
  const definitions = []
  for (const group of groups) {
    if (!Array.isArray(group)) throw new TypeError('each tool group must be an array')

    for (const candidate of group) {
      const definition = defineDeepSpiderTool(candidate)
      if (names.has(definition.name)) {
        throw new Error(`Duplicate tool name: ${definition.name}`)
      }
      names.add(definition.name)
      definitions.push(definition)
    }
  }

  return Object.freeze(definitions)
}
