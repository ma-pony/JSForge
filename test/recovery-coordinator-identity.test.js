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
const CAPABILITY = {
  evidenceSelector: 'document-challenge',
  engine: 'sdenv',
  outputAdapter: 'cookie',
  validator: 'cycle-tls-http',
  exporter: 'sdenv-solver',
}
const COOKIE_SECRET = 'must-not-enter-identity'

function artifactOf(artifacts, kind) {
  return artifacts.findLast((artifact) => artifact.kind === kind)
}

function assertArtifactReference(actual, expected) {
  assert.deepEqual(actual, { id: expected.id, sha256: expected.sha256 })
}

function assertIdentity(identity, { contract, recipe, graph, contractArtifact, recipeArtifact, runArtifact }) {
  assert.ok(identity, 'saved Artifact must contain runtime identity')
  assert.deepEqual(
    Object.keys(identity).sort(),
    ['capability', 'contractHash', 'engine', 'evidenceHash', 'recipeHash', 'upstream'],
  )
  assert.match(identity.evidenceHash, /^[a-f0-9]{64}$/)
  assert.equal(identity.contractHash, hashContract(contract))
  assert.equal(identity.recipeHash, hashRecipe(recipe))
  assert.deepEqual(identity.engine, ENGINE)
  assert.deepEqual(identity.capability, CAPABILITY)
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

test('fresh evidence creates a new Contract and derives the edited Recipe onto its identity', async (t) => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'deepspider-contract-freshness-'))
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }))
  const store = new SessionArtifactStore({ root: path.join(temporary, 'evidence') })
  store.startSession()
  const capturePair = async ({ challengeTitle, acceptedTitle, header, timestamp }) => {
    await store.saveResponse({
      url: TARGET_URL, pageUrl: TARGET_URL, method: 'GET', resourceType: 'Document', status: 412,
      requestHeaders: { 'x-round': header }, responseBody: `<title>${challengeTitle}</title>`, timestamp,
    })
    await store.saveResponse({
      url: TARGET_URL, pageUrl: TARGET_URL, method: 'GET', resourceType: 'Document', status: 200,
      requestHeaders: { 'x-round': header }, responseBody: `<title>${acceptedTitle}</title>`, timestamp: timestamp + 1,
    })
  }
  const now = Date.now()
  await capturePair({ challengeTitle: 'Challenge One', acceptedTitle: 'Accepted One', header: 'one', timestamp: now })
  const runtime = {
    sessionId: 'freshness-session', paths: { solvers: path.join(temporary, 'solvers') }, dataStore: store,
    getRecoveryRuntime() {
      return { execute: async ({ runId }) => ({
        type: 'result', runId, ok: false, engine: ENGINE, outputs: [], events: [], unknowns: [],
        program: { executable: false },
      }) }
    },
  }
  const coordinator = new RecoveryCoordinator(runtime)
  const first = await coordinator.recover({ url: TARGET_URL, outputKind: 'cookie', outputSelector: 'clearance' })
  let artifacts = await store.listArtifacts()
  const firstContract = artifactOf(artifacts, 'output-contract')
  const firstRecipe = artifactOf(artifacts, 'runtime-recipe')
  const editedRecipe = { ...first.recipe, userAgent: 'preserved-user-recipe' }
  const editedRecipeArtifact = await store.saveArtifact({
    kind: 'runtime-recipe', origin: 'derived', sourceId: firstContract.id, url: TARGET_URL,
    content: editedRecipe, metadata: { contractHash: hashContract(first.contract) },
  })

  await capturePair({ challengeTitle: 'Challenge Two', acceptedTitle: 'Accepted Two', header: 'two', timestamp: now + 100 })
  const second = await coordinator.recover({ url: TARGET_URL, outputKind: 'cookie', outputSelector: 'clearance' })
  artifacts = await store.listArtifacts()
  const secondContract = artifactOf(artifacts, 'output-contract')
  const secondRecipe = artifactOf(artifacts, 'runtime-recipe')
  const secondRun = await store.getArtifact(artifactOf(artifacts, 'runtime-run').id)

  assert.notEqual(secondContract.id, firstContract.id)
  assert.notEqual(secondRecipe.id, firstRecipe.id)
  assert.equal(secondRecipe.sourceId, secondContract.id)
  assert.equal(second.recipe.userAgent, editedRecipe.userAgent)
  assert.equal(secondRecipe.metadata.previousContractId, firstContract.id)
  assert.equal(secondRecipe.metadata.previousRecipeId, editedRecipeArtifact.id)
  assert.equal(secondContract.sourceId, second.graphArtifactId)
  assert.equal(secondContract.metadata.evidence.accepted.id.includes('response:'), true)
  assert.equal(second.contract.success.title, 'Accepted Two')
  assert.equal(second.contract.request.headers['x-round'], 'two')
  assert.equal(secondRun.metadata.identity.upstream.contract.id, secondContract.id)
  assert.equal(secondRun.metadata.identity.upstream.recipe.id, secondRecipe.id)
  assert.equal(secondRun.metadata.identity.upstream.artifactGraph.id, second.graphArtifactId)
})
