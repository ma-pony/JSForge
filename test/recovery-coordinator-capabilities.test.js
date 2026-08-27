import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { createRecoveryCapabilities } from '../src/recovery/capabilities.js'
import { RecoveryCoordinator } from '../src/recovery/coordinator.js'
import { SessionArtifactStore } from '../src/store/SessionArtifactStore.js'

const TARGET_URL = 'https://capability.example.test/target'

async function sessionStore(t) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'deepspider-capability-coordinator-'))
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }))
  const store = new SessionArtifactStore({ root: path.join(temporary, 'evidence') })
  store.startSession()
  await store.saveResponse({
    url: TARGET_URL, pageUrl: TARGET_URL, method: 'GET', resourceType: 'XHR',
    status: 200, requestHeaders: {}, responseBody: '{"challenge":true}', timestamp: Date.now(),
  })
  return { store, temporary }
}

function fixtureCapabilities({
  execute,
  validate,
  exportResult,
  engineId = 'fixture-engine',
  evidenceSelectorId = 'request-pair',
  contractSuccess = { status: 200, title: null },
  createRecipe = () => ({ engine: engineId, seed: 'one' }),
  validateRecipe = (recipe) => ({ engine: recipe.engine, seed: recipe.seed }),
  hashRecipe = (recipe) => `fixture-hash-${recipe.engine}-${recipe.seed}`,
}) {
  return createRecoveryCapabilities({
    evidenceSelectors: [{
      type: 'evidence-selector', id: evidenceSelectorId, outputKinds: ['header'], engineIds: [engineId],
      select({ graph }) {
        const source = graph.nodes.find(({ id }) => id.startsWith('response:'))
        return {
          sourceId: source.id,
          evidence: { request: { id: source.id, bodyHash: source.bodyHash } },
          contractTemplate: {
            entryUrl: TARGET_URL,
            request: { url: TARGET_URL, method: 'GET', headers: {} },
            success: contractSuccess,
          },
        }
      },
    }],
    engines: [{
      type: 'engine', id: engineId, strategy: 'semantic-runtime',
      modes: ['auto', 'semantic'], outputKinds: ['header'],
      createRecipe,
      validateRecipe,
      hashRecipe,
      execute,
    }],
    outputAdapters: [{
      type: 'output-adapter', id: 'header', outputKind: 'header', engineIds: [engineId],
      prepare() {
        throw new Error('fixture validator owns transport preparation')
      },
      summarize(outputs) {
        return {
          outputCount: outputs.length,
          outputNames: outputs.map(({ name }) => name),
        }
      },
    }],
    validators: [{
      type: 'validator', id: 'fixture-validator', outputKinds: ['header'], engineIds: [engineId], validate,
    }],
    exporters: [{
      type: 'exporter', id: 'fixture-exporter', engineIds: [engineId],
      outputKinds: ['header'], export: async () => exportResult,
    }],
  })
}

test('Coordinator runs a synthetic Header chain without output-specific branches', async (t) => {
  const { store, temporary } = await sessionStore(t)
  let executions = 0
  const capabilities = fixtureCapabilities({
    execute: async ({ runId }) => {
      executions += 1
      return {
        type: 'result', runId, ok: true,
        engine: { name: 'fixture-engine', version: '1.0.0' },
        outputs: [{ kind: 'header', name: 'x-generated', value: 'fixture-value' }],
        events: [], unknowns: [],
      }
    },
    validate: async (context) => {
      const { contract, outputs, outputAdapter, recipe } = context
      assert.equal(contract.kind, 'header')
      assert.equal(outputAdapter.id, 'header')
      assert.equal(outputs[0].value, 'fixture-value')
      assert.deepEqual(recipe, { engine: 'fixture-engine', seed: 'one' })
      assert.equal(Object.hasOwn(context, 'requestTemplate'), false)
      return {
        level: 'reproduced', accepted: true, status: 200, expectedStatus: 200,
        title: null, expectedTitle: null,
        outputArtifactIds: outputs.map(({ artifactId }) => artifactId),
        generatedOutputCount: 1, generatedOutputNames: ['x-generated'],
      }
    },
    exportResult: {
      directory: path.join(temporary, 'solver'), files: ['solver.mjs'], validationLevel: 'reproduced',
    },
  })
  const runtime = {
    sessionId: 'capability-session', paths: { solvers: path.join(temporary, 'solvers') }, dataStore: store,
  }

  const result = await new RecoveryCoordinator(runtime, { capabilities }).recover({
    url: TARGET_URL, outputKind: 'header', outputSelector: 'x-generated', mode: 'semantic',
  })

  assert.equal(executions, 1)
  assert.equal(result.strategy, 'semantic-runtime')
  assert.equal(result.validation.level, 'reproduced')
  assert.equal(result.solver.files[0], 'solver.mjs')
  assert.equal(result.attempts.length, 1)
})

test('Coordinator reuses an unchanged failed recovery identity across calls', async (t) => {
  const { store, temporary } = await sessionStore(t)
  let executions = 0
  const capabilities = fixtureCapabilities({
    execute: async ({ runId }) => {
      executions += 1
      return {
        type: 'result', runId, ok: false,
        engine: { name: 'fixture-engine', version: '1.0.0' },
        outputs: [], events: [], unknowns: [{
          kind: 'environment', operation: 'missing-fixture', path: 'window.fixture', blocking: true,
        }],
      }
    },
    validate: async () => ({
      level: 'observed', accepted: false, status: null, expectedStatus: 200,
      title: null, expectedTitle: null, outputArtifactIds: [],
      generatedOutputCount: 0, generatedOutputNames: [],
    }),
    exportResult: null,
  })
  const runtime = {
    sessionId: 'single-attempt-session', paths: { solvers: path.join(temporary, 'solvers') }, dataStore: store,
  }

  const coordinator = new RecoveryCoordinator(runtime, { capabilities })
  const result = await coordinator.recover({
    url: TARGET_URL, outputKind: 'header', mode: 'auto',
  })
  await store.saveResponse({
    url: `${TARGET_URL}/unrelated`, pageUrl: TARGET_URL, method: 'GET', resourceType: 'XHR',
    status: 200, requestHeaders: {}, responseBody: '{"unrelated":true}', timestamp: Date.now(),
  })
  const repeated = await coordinator.recover({
    url: TARGET_URL, outputKind: 'header', mode: 'auto',
  })
  const outcomeArtifacts = await store.listArtifacts({ kind: 'recovery-outcome' })
  const outcomeHashes = outcomeArtifacts.map(({ metadata }) => metadata.recoveryIdentityHash)

  assert.equal(new Set(outcomeHashes).size, 1, JSON.stringify(outcomeArtifacts.map(({ metadata }) => metadata.recoveryIdentity)))
  assert.equal(executions, 1)
  assert.equal(result.attempts.length, 1)
  assert.equal(result.blocker.operation, 'missing-fixture')
  assert.equal(repeated.attempts[0].runId, result.attempts[0].runId)
  assert.equal(repeated.blocker.operation, 'missing-fixture')
})

test('Coordinator derives a new Contract when the Evidence Selector changes', async (t) => {
  const { store, temporary } = await sessionStore(t)
  const runtime = {
    sessionId: 'selector-isolation-session', paths: { solvers: path.join(temporary, 'solvers') }, dataStore: store,
  }
  const execute = async ({ runId }) => ({
    type: 'result', runId, ok: false,
    engine: { name: 'fixture-engine', version: '1.0.0' }, outputs: [], events: [], unknowns: [],
  })
  const validate = async () => ({
    level: 'observed', accepted: false, status: null, expectedStatus: 200,
    title: null, expectedTitle: null, outputArtifactIds: [],
    generatedOutputCount: 0, generatedOutputNames: [],
  })
  await new RecoveryCoordinator(runtime, {
    capabilities: fixtureCapabilities({
      execute, validate, exportResult: null, evidenceSelectorId: 'selector-a',
      contractSuccess: { status: 200, title: 'Accepted A' },
    }),
  }).recover({ url: TARGET_URL, outputKind: 'header' })

  const second = await new RecoveryCoordinator(runtime, {
    capabilities: fixtureCapabilities({
      execute, validate, exportResult: null, evidenceSelectorId: 'selector-b',
      contractSuccess: { status: 200, title: 'Accepted B' },
    }),
  }).recover({ url: TARGET_URL, outputKind: 'header' })

  assert.equal(second.contract.success.title, 'Accepted B')
})

test('Coordinator derives a new Recipe when the Engine changes', async (t) => {
  const { store, temporary } = await sessionStore(t)
  const runtime = {
    sessionId: 'engine-isolation-session', paths: { solvers: path.join(temporary, 'solvers') }, dataStore: store,
  }
  const validate = async () => ({
    level: 'observed', accepted: false, status: null, expectedStatus: 200,
    title: null, expectedTitle: null, outputArtifactIds: [],
    generatedOutputCount: 0, generatedOutputNames: [],
  })
  const result = (runId, engine) => ({
    type: 'result', runId, ok: false,
    engine: { name: engine, version: '1.0.0' }, outputs: [], events: [], unknowns: [],
  })
  await new RecoveryCoordinator(runtime, {
    capabilities: fixtureCapabilities({
      engineId: 'engine-a', execute: async ({ runId }) => result(runId, 'engine-a'),
      validate, exportResult: null,
    }),
  }).recover({ url: TARGET_URL, outputKind: 'header' })

  let receivedRecipe
  const second = await new RecoveryCoordinator(runtime, {
    capabilities: fixtureCapabilities({
      engineId: 'engine-b',
      execute: async ({ runId, recipe }) => {
        receivedRecipe = recipe
        return result(runId, 'engine-b')
      },
      validate, exportResult: null,
    }),
  }).recover({ url: TARGET_URL, outputKind: 'header' })

  assert.equal(second.recipe.engine, 'engine-b')
  assert.equal(receivedRecipe.engine, 'engine-b')
})
