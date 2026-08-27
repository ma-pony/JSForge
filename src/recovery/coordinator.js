import { createHash } from 'node:crypto'
import { join } from 'node:path'

import { artifactManifest, buildArtifactGraph } from './artifact-graph.js'
import { createOutputContract, hashContract, validateOutputContract } from './contracts.js'
import { defaultRecoveryCapabilities } from './default-capabilities.js'
import { detectStrategy } from './strategy-detector.js'
import { aggregateUnknowns } from './unknowns.js'

function throwIfAborted(signal) {
  if (!signal?.aborted) return
  throw signal.reason
}

function normalizedUrl(value) {
  const url = new URL(value)
  url.hash = ''
  return url.href
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function hashValue(value) {
  return createHash('sha256').update(stableJson(value)).digest('hex')
}

function sameEvidence(left, right) {
  return stableJson(left) === stableJson(right)
}

async function artifactJson(store, entry) {
  const stored = await store.getArtifact(entry.id)
  if (!stored?.content) return null
  try {
    return JSON.parse(stored.content)
  } catch {
    return null
  }
}

async function loadRecoveryOutcome(store, recoveryIdentityHash) {
  const entries = await store.listArtifacts({ kind: 'recovery-outcome' })
  for (const entry of entries.toReversed()) {
    if (entry.metadata?.recoveryIdentityHash !== recoveryIdentityHash) continue
    const outcome = await artifactJson(store, entry)
    if (outcome && typeof outcome === 'object' && Array.isArray(outcome.attempts)) return outcome
  }
  return null
}

async function saveRecoveryOutcome({ store, result, sourceId, url, recoveryIdentity, recoveryIdentityHash }) {
  await store.saveArtifact({
    kind: 'recovery-outcome',
    origin: 'derived',
    sourceId,
    url,
    content: result,
    metadata: {
      recoveryIdentity,
      recoveryIdentityHash,
      accepted: result.validation?.accepted === true,
      blockerKind: result.blocker?.kind || null,
    },
  })
  return result
}

async function loadContracts(store, url, outputKind, outputSelector, evidence, evidenceSelectorId) {
  const entries = await store.listArtifacts({ kind: 'output-contract' })
  let previous = null
  for (const entry of entries.toReversed()) {
    if (entry.metadata?.url !== url || entry.metadata?.outputKind !== outputKind) continue
    if ((entry.metadata?.outputSelector ?? null) !== outputSelector) continue
    const storedSelectorId = entry.metadata?.evidenceSelectorId
    if (storedSelectorId && storedSelectorId !== evidenceSelectorId) continue
    if (!storedSelectorId && evidenceSelectorId !== 'document-challenge') continue
    const value = await artifactJson(store, entry)
    if (!value) continue
    try {
      const record = { artifact: entry, value: validateOutputContract(value) }
      if (sameEvidence(entry.metadata?.evidence, evidence)) return { current: record, previous }
      previous ||= record
    } catch {
      // A stale artifact cannot become the current recovery contract.
    }
  }
  return { current: null, previous }
}

async function loadRecipe(store, contractArtifactId, engineId, validateRecipe) {
  const entries = await store.listArtifacts({ kind: 'runtime-recipe' })
  for (const entry of entries.toReversed()) {
    if (entry.sourceId !== contractArtifactId) continue
    const storedEngineId = entry.metadata?.engineId
    if (storedEngineId && storedEngineId !== engineId) continue
    if (!storedEngineId && engineId !== 'sdenv') continue
    const value = await artifactJson(store, entry)
    if (!value) continue
    try {
      return { artifact: entry, value: validateRecipe(value) }
    } catch {
      // A stale artifact cannot become the current runtime recipe.
    }
  }
  return null
}

function observedValidation(contract = null, outputArtifactIds = []) {
  return {
    level: 'observed', accepted: false, status: null,
    expectedStatus: contract?.success?.status ?? null,
    title: null, expectedTitle: contract?.success?.title ?? null,
    outputArtifactIds, generatedOutputCount: 0, generatedOutputNames: [],
  }
}

function algorithmResult(context = {}) {
  const { rawUnknowns = [], ...details } = context
  const blocker = {
    kind: 'program',
    operation: 'algorithm-recovery',
    path: null,
    caller: null,
    reason: 'algorithm-recovery-engine-not-implemented',
    blocking: true,
    count: 1,
  }
  const diagnostics = aggregateUnknowns(rawUnknowns)
  return {
    ...details,
    strategy: 'algorithm-recovery',
    validation: details.validation || observedValidation(details.contract),
    unknowns: [blocker, ...diagnostics],
    blocker,
    suggestedRecipeActions: [],
    nextActions: [{ action: 'implement-algorithm-recovery-engine' }],
    attempts: details.attempts || [],
    solver: null,
  }
}

function unsupportedCapabilityResult(resolution) {
  const blocker = {
    kind: resolution.kind,
    operation: resolution.operation,
    path: null,
    caller: null,
    reason: resolution.reason,
    blocking: true,
    count: 1,
  }
  return {
    strategy: 'recovery-unavailable',
    validation: observedValidation(),
    unknowns: [blocker],
    blocker,
    suggestedRecipeActions: [],
    nextActions: [{ action: 'select-supported-output' }],
    attempts: [],
    solver: null,
  }
}

function recipeActions(unknowns) {
  const actions = []
  for (const unknown of unknowns) {
    if (unknown.suggestion?.action) {
      const candidate = {
        ...unknown.suggestion,
        operation: unknown.operation,
        path: unknown.path,
      }
      if (!actions.some((entry) => JSON.stringify(entry) === JSON.stringify(candidate))) actions.push(candidate)
      if (actions.length === 3) break
      continue
    }
    let action
    if (unknown.kind === 'environment') action = 'provide-environment-value'
    if (unknown.kind === 'resource') action = 'provide-resource'
    if (unknown.kind === 'program') action = 'inspect-program-behavior'
    if (unknown.kind === 'validation') action = 'refresh-request-contract'
    if (!action) continue
    const candidate = { action, operation: unknown.operation, path: unknown.path }
    if (!actions.some((entry) => JSON.stringify(entry) === JSON.stringify(candidate))) actions.push(candidate)
    if (actions.length === 3) break
  }
  return actions
}

function publicAttempt({ attempt, runId, result, outputs, validation, outputAdapter }) {
  const summary = typeof outputAdapter.summarize === 'function'
    ? outputAdapter.summarize(outputs)
    : { outputCount: outputs.length, outputNames: [] }
  return {
    attempt,
    runId,
    ok: result.ok,
    engine: result.engine,
    outputCount: summary.outputCount,
    outputNames: summary.outputNames,
    unknownCount: result.unknowns.length,
    validation,
  }
}

function artifactReference(artifact) {
  return { id: artifact.id, sha256: artifact.sha256 }
}

export class RecoveryCoordinator {
  constructor(runtime, { capabilities = defaultRecoveryCapabilities } = {}) {
    if (!runtime || typeof runtime !== 'object') throw new TypeError('runtime must be provided')
    if (!capabilities || typeof capabilities.resolve !== 'function') {
      throw new TypeError('capabilities must provide resolve()')
    }
    this.runtime = runtime
    this.capabilities = capabilities
  }

  async recover({ url, outputKind, outputSelector = null, mode = 'auto', signal } = {}) {
    const plan = this.capabilities.resolve({ mode, outputKind })
    if (!plan.ok) {
      if (mode === 'algorithm') return algorithmResult()
      return unsupportedCapabilityResult(plan)
    }
    const strategy = plan.engine.strategy || 'semantic-runtime'
    throwIfAborted(signal)
    const targetUrl = normalizedUrl(url)
    const store = this.runtime.dataStore
    if (!store || typeof store.saveArtifact !== 'function') throw new TypeError('runtime must own a SessionArtifactStore')

    const graph = await buildArtifactGraph({ store })
    const selectedEvidence = plan.evidenceSelector.select({ graph, url: targetUrl })
    const evidence = selectedEvidence.evidence
    const graphArtifact = await store.saveArtifact({
      kind: 'artifact-graph',
      origin: 'derived',
      sourceId: selectedEvidence.sourceId,
      url: targetUrl,
      content: artifactManifest(graph),
      metadata: {
        url: targetUrl,
        evidenceSelectorId: plan.evidenceSelector.id,
        evidence,
      },
    })

    const loadedContracts = await loadContracts(
      store,
      targetUrl,
      outputKind,
      outputSelector,
      evidence,
      plan.evidenceSelector.id,
    )
    let contractRecord = loadedContracts.current
    if (!contractRecord) {
      const contract = createOutputContract({
        kind: outputKind,
        selector: outputSelector,
        ...selectedEvidence.contractTemplate,
      })
      const artifact = await store.saveArtifact({
        kind: 'output-contract',
        origin: 'derived',
        sourceId: graphArtifact.id,
        url: targetUrl,
        content: contract,
        metadata: {
          url: targetUrl,
          outputKind,
          outputSelector,
          evidenceSelectorId: plan.evidenceSelector.id,
          evidence,
        },
      })
      contractRecord = { artifact, value: contract }
    }
    const contract = contractRecord.value
    const contractHash = hashContract(contract)

    let recipeRecord = await loadRecipe(
      store,
      contractRecord.artifact.id,
      plan.engine.id,
      plan.engine.validateRecipe,
    )
    if (!recipeRecord) {
      const previousRecipe = loadedContracts.previous
        ? await loadRecipe(
          store,
          loadedContracts.previous.artifact.id,
          plan.engine.id,
          plan.engine.validateRecipe,
        )
        : null
      const recipe = previousRecipe?.value || plan.engine.createRecipe()
      const artifact = await store.saveArtifact({
        kind: 'runtime-recipe',
        origin: 'derived',
        sourceId: contractRecord.artifact.id,
        url: targetUrl,
        content: recipe,
        metadata: {
          contractHash,
          engineId: plan.engine.id,
          previousContractId: loadedContracts.previous?.artifact.id || null,
          previousRecipeId: previousRecipe?.artifact.id || null,
        },
      })
      recipeRecord = { artifact, value: recipe }
    }
    const recipe = recipeRecord.value
    const recipeHash = plan.engine.hashRecipe(recipe)
    const recoveryIdentity = {
      evidenceHash: hashValue(evidence),
      contractHash,
      recipeHash,
      capability: {
        evidenceSelector: plan.evidenceSelector.id,
        engine: plan.engine.id,
        outputAdapter: plan.outputAdapter.id,
        validator: plan.validator.id,
        exporter: plan.exporter.id,
      },
    }
    const recoveryIdentityHash = hashValue(recoveryIdentity)
    const existingOutcome = await loadRecoveryOutcome(store, recoveryIdentityHash)
    if (existingOutcome) return existingOutcome
    const attempts = []
    const rawUnknowns = []
    const attempt = 1
    throwIfAborted(signal)
    const runId = `recovery-${Date.now().toString(36)}-${attempt}`
    const result = await plan.engine.execute({
      runtime: this.runtime,
      runId,
      contract,
      recipe,
      signal,
    })
    throwIfAborted(signal)
    const runIdentity = {
      ...recoveryIdentity,
      engine: {
        name: result.engine?.name ?? plan.engine.id,
        version: result.engine?.version ?? null,
      },
      upstream: {
        artifactGraph: artifactReference(graphArtifact),
        contract: artifactReference(contractRecord.artifact),
        recipe: artifactReference(recipeRecord.artifact),
      },
    }
    const runArtifact = await store.saveArtifact({
      kind: 'runtime-run',
      origin: 'derived',
      sourceId: recipeRecord.artifact.id,
      url: targetUrl,
      content: { attempt, runId, result },
      metadata: {
        runId,
        attempt,
        ok: result.ok,
        engine: result.engine?.name || plan.engine.id,
        identity: runIdentity,
      },
    })
    const outputs = []
    for (const output of result.outputs) {
      const outputIdentity = {
        ...runIdentity,
        upstream: {
          ...runIdentity.upstream,
          runtimeRun: artifactReference(runArtifact),
        },
      }
      const artifact = await store.saveArtifact({
        kind: 'generated-output',
        origin: 'generated',
        sourceId: runArtifact.id,
        url: targetUrl,
        content: output,
        metadata: {
          runId,
          outputKind: output.kind,
          outputName: output.name || null,
          identity: outputIdentity,
        },
      })
      outputs.push({ ...output, artifactId: artifact.id })
    }
    rawUnknowns.push(...result.unknowns)

    const nextStrategy = detectStrategy({ mode, result })
    if (nextStrategy === 'algorithm-recovery') {
      const validation = observedValidation(contract, outputs.map(({ artifactId }) => artifactId))
      attempts.push(publicAttempt({ attempt, runId, result, outputs, validation, outputAdapter: plan.outputAdapter }))
      const outcome = algorithmResult({
        sessionId: this.runtime.sessionId,
        contract,
        recipe,
        graphArtifactId: graphArtifact.id,
        attempts,
        validation,
        rawUnknowns,
      })
      return saveRecoveryOutcome({
        store,
        result: outcome,
        sourceId: runArtifact.id,
        url: targetUrl,
        recoveryIdentity,
        recoveryIdentityHash,
      })
    }

    let validation
    try {
      validation = await plan.validator.validate({
        contract,
        outputs,
        recipe,
        engine: plan.engine,
        outputAdapter: plan.outputAdapter,
        signal,
      })
    } catch (error) {
      if (signal?.aborted) throw signal.reason
      validation = {
        level: 'observed',
        accepted: false,
        status: null,
        expectedStatus: contract.success.status ?? null,
        title: null,
        expectedTitle: contract.success.title ?? null,
        outputArtifactIds: outputs.map(({ artifactId }) => artifactId),
        generatedOutputCount: 0,
        generatedOutputNames: [],
        error: error instanceof Error ? error.message : String(error),
      }
    }
    if (!validation.accepted) {
      if (validation.failure) {
        rawUnknowns.push(validation.failure)
      } else {
        rawUnknowns.push({
          category: 'validation-result',
          operation: 'validate-generated-output',
          path: contract.request.url,
          reason: 'status-title-or-output-mismatch',
          blocking: true,
        })
      }
    }
    const sourceId = outputs[0]?.artifactId || runArtifact.id
    const validationArtifact = await store.saveArtifact({
      kind: 'validation',
      origin: 'derived',
      sourceId,
      url: targetUrl,
      content: validation,
      metadata: { runId, attempt, level: validation.level, accepted: validation.accepted },
    })
    attempts.push(publicAttempt({
      attempt,
      runId,
      result,
      outputs,
      validation,
      outputAdapter: plan.outputAdapter,
    }))

    if (validation.accepted) {
      const solverDir = join(
        this.runtime.paths.solvers,
        `${contractHash.slice(0, 16)}-${recipeHash.slice(0, 16)}`,
      )
      const solver = await plan.exporter.export({
        sessionId: this.runtime.sessionId,
        contract,
        recipe,
        validation,
        solverDir,
      })
      const solverArtifact = await store.saveArtifact({
        kind: 'solver',
        origin: 'derived',
        sourceId: validationArtifact.id,
        url: targetUrl,
        content: solver,
        metadata: { directory: solver.directory, validationLevel: validation.level },
      })
      const outcome = {
        sessionId: this.runtime.sessionId,
        strategy,
        contract,
        recipe,
        graphArtifactId: graphArtifact.id,
        attempts,
        validation,
        unknowns: aggregateUnknowns(rawUnknowns),
        blocker: null,
        suggestedRecipeActions: [],
        nextActions: [],
        solver: { ...solver, artifactId: solverArtifact.id },
      }
      return saveRecoveryOutcome({
        store,
        result: outcome,
        sourceId: solverArtifact.id,
        url: targetUrl,
        recoveryIdentity,
        recoveryIdentityHash,
      })
    }

    const unknowns = aggregateUnknowns(rawUnknowns)
    const blocker = unknowns.find(({ blocking }) => blocking) || unknowns[0] || null
    const suggestedRecipeActions = recipeActions(unknowns)
    const outcome = {
      sessionId: this.runtime.sessionId,
      strategy,
      contract,
      recipe,
      graphArtifactId: graphArtifact.id,
      attempts,
      validation,
      validationArtifactId: validationArtifact.id,
      unknowns,
      blocker,
      suggestedRecipeActions,
      nextActions: suggestedRecipeActions,
      solver: null,
    }
    return saveRecoveryOutcome({
      store,
      result: outcome,
      sourceId: validationArtifact.id,
      url: targetUrl,
      recoveryIdentity,
      recoveryIdentityHash,
    })
  }
}
