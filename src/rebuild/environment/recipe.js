const ACTIONS = new Set([
  'hide',
  'undefined',
  'throw',
  'replace',
  'fixed',
  'mask',
  'hook',
  'replay',
])

const DEFAULT_RECIPE = Object.freeze({
  baseline: 'chrome-default',
  fixedValues: Object.freeze({}),
  conceal: Object.freeze([]),
  handlers: Object.freeze({}),
  replay: Object.freeze({}),
  sourceTransforms: Object.freeze([]),
  assertions: Object.freeze([]),
})

function plainObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`)
  }
  return { ...value }
}

function rules(value, name) {
  if (!Array.isArray(value)) throw new TypeError(`${name} must be an array`)
  return value.map((rule) => {
    if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
      throw new TypeError(`${name} entries must be objects`)
    }
    if (typeof rule.path !== 'string' || rule.path.length === 0) {
      throw new TypeError(`${name} path must be a non-empty string`)
    }
    if (!ACTIONS.has(rule.action)) {
      throw new TypeError(`Unsupported Recipe action: ${rule.action}`)
    }
    return { ...rule }
  })
}

export function validateRecipe(value) {
  const input = plainObject(value, 'Recipe')
  if (typeof input.baseline !== 'string' || input.baseline.length === 0) {
    throw new TypeError('Recipe baseline must be a non-empty string')
  }

  return {
    baseline: input.baseline,
    fixedValues: plainObject(input.fixedValues, 'Recipe fixedValues'),
    conceal: rules(input.conceal, 'Recipe conceal'),
    handlers: plainObject(input.handlers, 'Recipe handlers'),
    replay: plainObject(input.replay, 'Recipe replay'),
    sourceTransforms: Array.isArray(input.sourceTransforms)
      ? input.sourceTransforms.map((entry) => ({ ...entry }))
      : (() => { throw new TypeError('Recipe sourceTransforms must be an array') })(),
    assertions: Array.isArray(input.assertions)
      ? input.assertions.map((entry) => ({ ...entry }))
      : (() => { throw new TypeError('Recipe assertions must be an array') })(),
  }
}

export function createRecipe(overrides = {}) {
  return validateRecipe({
    ...DEFAULT_RECIPE,
    ...overrides,
    fixedValues: { ...DEFAULT_RECIPE.fixedValues, ...overrides.fixedValues },
    conceal: [...DEFAULT_RECIPE.conceal, ...(overrides.conceal || [])],
    handlers: { ...DEFAULT_RECIPE.handlers, ...overrides.handlers },
    replay: { ...DEFAULT_RECIPE.replay, ...overrides.replay },
    sourceTransforms: overrides.sourceTransforms || DEFAULT_RECIPE.sourceTransforms,
    assertions: overrides.assertions || DEFAULT_RECIPE.assertions,
  })
}

export { ACTIONS as RECIPE_ACTIONS }
