import assert from 'node:assert/strict'
import test from 'node:test'

import { createRecoveryCapabilities } from '../src/recovery/capabilities.js'
import {
  SUPPORTED_RECOVERY_OUTPUT_KINDS,
  defaultRecoveryCapabilities,
} from '../src/recovery/default-capabilities.js'

function capability(type, id, support = {}) {
  const executable = {
    'evidence-selector': { select() {} },
    engine: {
      createRecipe() {}, validateRecipe(value) { return value }, hashRecipe() {}, execute() {},
    },
    'output-adapter': { prepare() {} },
    validator: { validate() {} },
    exporter: { export() {} },
  }
  return Object.freeze({ type, id, ...executable[type], ...support })
}

test('default capabilities advertise only complete executable output chains', () => {
  assert.deepEqual(SUPPORTED_RECOVERY_OUTPUT_KINDS, ['cookie'])
  assert.deepEqual(defaultRecoveryCapabilities.supportedOutputKinds, ['cookie'])

  const plan = defaultRecoveryCapabilities.resolve({ mode: 'auto', outputKind: 'cookie' })
  assert.equal(plan.ok, true)
  assert.equal(plan.evidenceSelector.id, 'document-challenge')
  assert.equal(plan.engine.id, 'sdenv')
  assert.equal(plan.outputAdapter.id, 'cookie')
  assert.equal(plan.validator.id, 'cycle-tls-http')
  assert.equal(plan.exporter.id, 'sdenv-solver')

  const unsupported = defaultRecoveryCapabilities.resolve({ mode: 'auto', outputKind: 'header' })
  assert.deepEqual(unsupported, {
    ok: false,
    kind: 'program',
    operation: 'resolve-recovery-capability',
    reason: 'unsupported-output-kind',
    outputKind: 'header',
    mode: 'auto',
  })
})

test('a complete synthetic chain adds an output kind without changing the registry', () => {
  const capabilities = createRecoveryCapabilities({
    evidenceSelectors: [
      capability('evidence-selector', 'document-pair', { outputKinds: ['cookie'] }),
      capability('evidence-selector', 'request-pair', { outputKinds: ['header'] }),
    ],
    engines: [capability('engine', 'fixture-engine', {
      modes: ['auto', 'semantic'], outputKinds: ['header'],
    })],
    outputAdapters: [capability('output-adapter', 'header', {
      outputKind: 'header', engineIds: ['fixture-engine'],
    })],
    validators: [capability('validator', 'fixture-http', { outputKinds: ['header'] })],
    exporters: [capability('exporter', 'fixture-module', {
      engineIds: ['fixture-engine'], outputKinds: ['header'],
    })],
  })

  assert.deepEqual(capabilities.supportedOutputKinds, ['header'])
  const plan = capabilities.resolve({ mode: 'semantic', outputKind: 'header' })
  assert.equal(plan.ok, true)
  assert.equal(plan.evidenceSelector.id, 'request-pair')
  assert.equal(plan.engine.id, 'fixture-engine')
  assert.equal(plan.outputAdapter.id, 'header')
})

test('an output kind is not advertised when any required capability is missing', () => {
  const capabilities = createRecoveryCapabilities({
    evidenceSelectors: [capability('evidence-selector', 'request-pair', { outputKinds: ['header'] })],
    engines: [capability('engine', 'fixture-engine', {
      modes: ['auto'], outputKinds: ['header'],
    })],
    outputAdapters: [capability('output-adapter', 'header', { outputKind: 'header' })],
    validators: [],
    exporters: [capability('exporter', 'fixture-module', {
      engineIds: ['fixture-engine'], outputKinds: ['header'],
    })],
  })

  assert.deepEqual(capabilities.supportedOutputKinds, [])
  assert.equal(capabilities.resolve({ mode: 'auto', outputKind: 'header' }).ok, false)
})

test('registry rejects capability descriptors without their executable interface', () => {
  assert.throws(() => createRecoveryCapabilities({
    evidenceSelectors: [{
      type: 'evidence-selector', id: 'description-only', outputKinds: ['cookie'],
    }],
  }), /description-only\.select must be a function/)
})
