import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { RecoveryCoordinator } from '../src/recovery/coordinator.js'
import { hashContract } from '../src/recovery/contracts.js'
import { hashRecipe } from '../src/recovery/recipe.js'
import { SessionArtifactStore } from '../src/store/SessionArtifactStore.js'

const TARGET_URL = 'https://identity.example.test/target'
const ENGINE = { name: 'sdenv', version: 'test-engine-7.4.2' }
const COOKIE_SECRET = 'must-not-enter-identity'

function artifactOf(artifacts, kind) {
  return artifacts.findLast((artifact) => artifact.kind === kind)
}

function assertArtifactReference(actual, expected) {
  assert.deepEqual(actual, { id: expected.id, sha256: expected.sha256 })
}

function assertIdentity(identity, { contract, recipe, graph, contractArtifact, recipeArtifact, runArtifact }) {
  assert.ok(identity, 'saved Artifact must contain runtime identity')
  assert.deepEqual(Object.keys(identity).sort(), ['contractHash', 'engine', 'recipeHash', 'upstream'])
  assert.equal(identity.contractHash, hashContract(contract))
  assert.equal(identity.recipeHash, hashRecipe(recipe))
  assert.deepEqual(identity.engine, ENGINE)
  assert.deepEqual(Object.keys(identity.upstream).sort(), runArtifact
    ? ['artifactGraph', 'contract', 'recipe', 'runtimeRun']
    : ['artifactGraph', 'contract', 'recipe'])
  assertArtifactReference(identity.upstream.artifactGraph, graph)
  assertArtifactReference(identity.upstream.contract, contractArtifact)
  assertArtifactReference(identity.upstream.recipe, recipeArtifact)
  if (runArtifact) assertArtifactReference(identity.upstream.runtimeRun, runArtifact)
  const serialized = JSON.stringify(identity)
  assert.equal(serialized.includes(COOKIE_SECRET), false)
  assert.doesNotMatch(serialized, /"(?:source|rawTrace|path)"/)
}

test('saved run and generated output bind canonical runtime identity to upstream Artifacts', async (t) => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'deepspider-runtime-identity-'))
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }))
  const store = new SessionArtifactStore({ root: path.join(temporary, 'evidence') })
  store.startSession()
  await store.saveResponse({
    url: TARGET_URL,
    pageUrl: TARGET_URL,
    method: 'GET',
    resourceType: 'Document',
    status: 412,
    requestHeaders: {},
    responseBody: '<title>Challenge</title>',
    timestamp: Date.now() - 1000,
  })
  await store.saveResponse({
    url: TARGET_URL,
    pageUrl: TARGET_URL,
    method: 'GET',
    resourceType: 'Document',
    status: 200,
    requestHeaders: {},
    responseBody: '<title>Accepted</title>',
    timestamp: Date.now(),
  })
  const runtime = {
    sessionId: 'identity-session',
    paths: { solvers: path.join(temporary, 'solvers') },
    dataStore: store,
    getRecoveryRuntime() {
      return {
        execute: async ({ runId }) => ({
          type: 'result',
          runId,
          ok: false,
          engine: { ...ENGINE },
          outputs: [{ kind: 'cookie', name: 'clearance', value: COOKIE_SECRET }],
          events: [],
          unknowns: [],
          program: { executable: false },
        }),
      }
    },
  }
  const coordinator = new RecoveryCoordinator(runtime)

  const firstResult = await coordinator.recover({
    url: TARGET_URL,
    outputKind: 'cookie',
    outputSelector: 'clearance',
  })
  const firstArtifacts = await store.listArtifacts()
  const firstGraph = firstArtifacts.find(({ id }) => id === firstResult.graphArtifactId)
  const contractArtifact = artifactOf(firstArtifacts, 'output-contract')
  const firstRecipeArtifact = artifactOf(firstArtifacts, 'runtime-recipe')
  const firstRunArtifact = artifactOf(firstArtifacts, 'runtime-run')
  const firstOutputArtifact = artifactOf(firstArtifacts, 'generated-output')
  const firstRun = await store.getArtifact(firstRunArtifact.id)
  const firstOutput = await store.getArtifact(firstOutputArtifact.id)

  assertIdentity(firstRun.metadata.identity, {
    contract: firstResult.contract,
    recipe: firstResult.recipe,
    graph: firstGraph,
    contractArtifact,
    recipeArtifact: firstRecipeArtifact,
  })
  assertIdentity(firstOutput.metadata.identity, {
    contract: firstResult.contract,
    recipe: firstResult.recipe,
    graph: firstGraph,
    contractArtifact,
    recipeArtifact: firstRecipeArtifact,
    runArtifact: firstRunArtifact,
  })

  const changedRecipe = { ...firstResult.recipe, userAgent: 'changed-recipe-user-agent' }
  await store.saveArtifact({
    kind: 'runtime-recipe',
    origin: 'derived',
    sourceId: contractArtifact.id,
    url: TARGET_URL,
    content: changedRecipe,
    metadata: { contractHash: hashContract(firstResult.contract) },
  })
  await coordinator.recover({
    url: TARGET_URL,
    outputKind: 'cookie',
    outputSelector: 'clearance',
  })
  const changedRunArtifact = artifactOf(await store.listArtifacts(), 'runtime-run')
  const changedRun = await store.getArtifact(changedRunArtifact.id)

  assert.notEqual(changedRun.metadata.identity.recipeHash, firstRun.metadata.identity.recipeHash)
  assert.equal(changedRun.metadata.identity.recipeHash, hashRecipe(changedRecipe))
  assert.equal('identity' in firstResult.attempts[0], false)
})
