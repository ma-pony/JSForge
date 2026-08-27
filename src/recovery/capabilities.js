const CAPABILITY_TYPES = Object.freeze({
  evidenceSelectors: 'evidence-selector',
  engines: 'engine',
  outputAdapters: 'output-adapter',
  validators: 'validator',
  exporters: 'exporter',
})

const REQUIRED_METHODS = Object.freeze({
  'evidence-selector': Object.freeze(['select']),
  engine: Object.freeze(['createRecipe', 'validateRecipe', 'hashRecipe', 'execute']),
  'output-adapter': Object.freeze(['prepare']),
  validator: Object.freeze(['validate']),
  exporter: Object.freeze(['export']),
})

function strings(value, name) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.length === 0)) {
    throw new TypeError(`${name} must be an array of non-empty strings`)
  }
  return value
}

function capabilities(value, collection, type) {
  if (!Array.isArray(value)) throw new TypeError(`${collection} must be an array`)
  const ids = new Set()
  return Object.freeze(value.map((entry) => {
    if (!entry || typeof entry !== 'object') throw new TypeError(`${collection} entries must be objects`)
    if (entry.type !== type) throw new TypeError(`${collection} entries must have type ${type}`)
    if (typeof entry.id !== 'string' || entry.id.length === 0) {
      throw new TypeError(`${collection} entries must have a non-empty id`)
    }
    if (ids.has(entry.id)) throw new Error(`Duplicate ${type} id: ${entry.id}`)
    for (const method of REQUIRED_METHODS[type]) {
      if (typeof entry[method] !== 'function') {
        throw new TypeError(`${entry.id}.${method} must be a function`)
      }
    }
    ids.add(entry.id)
    return Object.freeze({ ...entry })
  }))
}

function supports(entry, field, value) {
  return strings(entry[field] || [], `${entry.id}.${field}`).includes(value)
}

function compatible(entry, field, value) {
  return entry[field] === undefined || supports(entry, field, value)
}

function findPlan(collections, { mode, outputKind }) {
  for (const engine of collections.engines) {
    if (!supports(engine, 'modes', mode) || !supports(engine, 'outputKinds', outputKind)) continue
    const evidenceSelector = collections.evidenceSelectors.find((entry) => (
      supports(entry, 'outputKinds', outputKind)
      && compatible(entry, 'modes', mode)
      && compatible(entry, 'engineIds', engine.id)
    ))
    if (!evidenceSelector) continue
    const outputAdapters = collections.outputAdapters.filter((entry) => (
      entry.outputKind === outputKind
      && compatible(entry, 'modes', mode)
      && compatible(entry, 'engineIds', engine.id)
    ))
    for (const outputAdapter of outputAdapters) {
      const validator = collections.validators.find((entry) => (
        supports(entry, 'outputKinds', outputKind)
        && compatible(entry, 'modes', mode)
        && compatible(entry, 'engineIds', engine.id)
        && compatible(entry, 'outputAdapterIds', outputAdapter.id)
      ))
      if (!validator) continue
      const exporter = collections.exporters.find((entry) => (
        supports(entry, 'engineIds', engine.id)
        && supports(entry, 'outputKinds', outputKind)
        && compatible(entry, 'outputAdapterIds', outputAdapter.id)
        && compatible(entry, 'validatorIds', validator.id)
      ))
      if (!exporter) continue
      return Object.freeze({
        ok: true,
        evidenceSelector,
        engine,
        outputAdapter,
        validator,
        exporter,
      })
    }
  }
  return null
}

export function createRecoveryCapabilities(input = {}) {
  const collections = Object.fromEntries(
    Object.entries(CAPABILITY_TYPES).map(([name, type]) => [
      name,
      capabilities(input[name] || [], name, type),
    ]),
  )
  const outputKinds = collections.outputAdapters
    .map(({ outputKind }) => outputKind)
    .filter((outputKind, index, values) => (
      typeof outputKind === 'string'
      && outputKind.length > 0
      && values.indexOf(outputKind) === index
      && ['auto', 'semantic', 'algorithm'].some((mode) => findPlan(collections, { mode, outputKind }))
    ))
  const supportedOutputKinds = Object.freeze(outputKinds)

  return Object.freeze({
    supportedOutputKinds,
    resolve({ mode = 'auto', outputKind } = {}) {
      const plan = findPlan(collections, { mode, outputKind })
      if (plan) return plan
      return Object.freeze({
        ok: false,
        kind: 'program',
        operation: 'resolve-recovery-capability',
        reason: supportedOutputKinds.includes(outputKind) ? 'unsupported-recovery-mode' : 'unsupported-output-kind',
        outputKind: outputKind ?? null,
        mode,
      })
    },
  })
}
