import { join } from 'node:path'

import { artifactManifest, buildArtifactGraph } from './artifact-graph.js'
import { createOutputContract, hashContract, validateOutputContract } from './contracts.js'
import { createRuntimeRecipe, hashRecipe, validateRuntimeRecipe } from './recipe.js'
import { exportSolver } from './solver.js'
import { detectStrategy } from './strategy-detector.js'
import { aggregateUnknowns } from './unknowns.js'
import { validateGeneratedOutput } from './validation.js'

const MAX_ATTEMPTS = 3
const TEMPLATE_BLOCKED_HEADERS = new Set([
  'cookie', 'host', 'connection', 'content-length', 'accept-encoding', 'user-agent',
])

function throwIfAborted(signal) {
  if (!signal?.aborted) return
  throw signal.reason
}

function normalizedUrl(value) {
  const url = new URL(value)
  url.hash = ''
  return url.href
}

function titleOf(html) {
  const match = String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  return match?.[1]?.replace(/\s+/g, ' ').trim() || ''
}

function templateHeaders(headers) {
  return Object.fromEntries(
    Object.entries(headers || {}).filter(([name]) => !TEMPLATE_BLOCKED_HEADERS.has(name.toLowerCase())),
  )
}

function evidencePair(graph, url) {
  const documents = graph.nodes
    .filter((node) => (
      node.kind === 'response'
      && node.resourceType === 'Document'
      && normalizedUrl(node.url) === url
    ))
    .sort((left, right) => left.timestamp - right.timestamp)
  for (let index = documents.length - 1; index >= 0; index -= 1) {
    const accepted = documents[index]
    if (accepted.status < 200 || accepted.status >= 400) continue
    const challenge = documents.slice(0, index).findLast((candidate) => candidate.status >= 400)
    if (challenge) return { challenge, accepted }
  }
  throw new Error(`Current Session does not contain challenge and accepted Document evidence for ${url}`)
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

async function loadContract(store, url, outputKind, outputSelector) {
  const entries = await store.listArtifacts({ kind: 'output-contract' })
  for (const entry of entries.toReversed()) {
    if (entry.metadata?.url !== url || entry.metadata?.outputKind !== outputKind) continue
    if ((entry.metadata?.outputSelector ?? null) !== outputSelector) continue
    const value = await artifactJson(store, entry)
    if (!value) continue
    try {
      return { artifact: entry, value: validateOutputContract(value) }
    } catch {
      // A stale artifact cannot become the current recovery contract.
    }
  }
  return null
}

async function loadRecipe(store, contractArtifactId) {
  const entries = await store.listArtifacts({ kind: 'runtime-recipe' })
  for (const entry of entries.toReversed()) {
    if (entry.sourceId !== contractArtifactId) continue
    const value = await artifactJson(store, entry)
    if (!value) continue
    try {
      return { artifact: entry, value: validateRuntimeRecipe(value) }
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
    outputArtifactIds,
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

function publicAttempt({ attempt, runId, result, outputs, validation }) {
  return {
    attempt,
    runId,
    ok: result.ok,
    engine: result.engine,
    outputCount: outputs.length,
    outputNames: outputs.filter(({ kind }) => kind === 'cookie').map(({ name }) => name),
    unknownCount: result.unknowns.length,
    validation,
  }
}

function artifactReference(artifact) {
  return { id: artifact.id, sha256: artifact.sha256 }
}

export class RecoveryCoordinator {
  constructor(runtime) {
    if (!runtime || typeof runtime !== 'object') throw new TypeError('runtime must be provided')
    this.runtime = runtime
  }

  async recover({ url, outputKind, outputSelector = null, mode = 'auto', signal } = {}) {
    const strategy = detectStrategy({ mode })
    if (strategy === 'algorithm-recovery') return algorithmResult()
    throwIfAborted(signal)
    const targetUrl = normalizedUrl(url)
    const store = this.runtime.dataStore
    if (!store || typeof store.saveArtifact !== 'function') throw new TypeError('runtime must own a SessionArtifactStore')
    if (typeof this.runtime.getRecoveryRuntime !== 'function') throw new TypeError('runtime must provide getRecoveryRuntime()')

    const graph = await buildArtifactGraph({ store })
    const { challenge, accepted } = evidencePair(graph, targetUrl)
    const graphArtifact = await store.saveArtifact({
      kind: 'artifact-graph',
      origin: 'derived',
      sourceId: challenge.id,
      url: targetUrl,
      content: artifactManifest(graph),
      metadata: { url: targetUrl, challengeId: challenge.id, acceptedId: accepted.id },
    })

    let contractRecord = await loadContract(store, targetUrl, outputKind, outputSelector)
    if (!contractRecord) {
      const contract = createOutputContract({
        kind: outputKind,
        selector: outputSelector,
        entryUrl: challenge.url,
        request: {
          url: accepted.url,
          method: accepted.method,
          headers: templateHeaders(accepted.requestHeaders),
        },
        success: {
          status: accepted.status,
          title: titleOf(accepted.body) || null,
        },
      })
      const artifact = await store.saveArtifact({
        kind: 'output-contract',
        origin: 'derived',
        sourceId: graphArtifact.id,
        url: targetUrl,
        content: contract,
        metadata: { url: targetUrl, outputKind, outputSelector },
      })
      contractRecord = { artifact, value: contract }
    }
    const contract = contractRecord.value
    const contractHash = hashContract(contract)

    let recipeRecord = await loadRecipe(store, contractRecord.artifact.id)
    if (!recipeRecord) {
      const recipe = createRuntimeRecipe()
      const artifact = await store.saveArtifact({
        kind: 'runtime-recipe',
        origin: 'derived',
        sourceId: contractRecord.artifact.id,
        url: targetUrl,
        content: recipe,
        metadata: { contractHash },
      })
      recipeRecord = { artifact, value: recipe }
    }
    const recipe = recipeRecord.value
    const recipeHash = hashRecipe(recipe)
    const recoveryRuntime = this.runtime.getRecoveryRuntime()
    const attempts = []
    const rawUnknowns = []
    let finalValidation = null
    let finalValidationArtifact = null

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      throwIfAborted(signal)
      const runId = `recovery-${Date.now().toString(36)}-${attempt}`
      const result = await recoveryRuntime.execute({ runId, contract, recipe, signal })
      throwIfAborted(signal)
      const runIdentity = {
        contractHash,
        recipeHash,
        engine: {
          name: result.engine?.name ?? null,
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
          runId, attempt, ok: result.ok, engine: result.engine?.name || null, identity: runIdentity,
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
            runId, outputKind: output.kind, outputName: output.name || null, identity: outputIdentity,
          },
        })
        outputs.push({ ...output, artifactId: artifact.id })
      }
      rawUnknowns.push(...result.unknowns)

      const nextStrategy = detectStrategy({ mode, result })
      if (nextStrategy === 'algorithm-recovery') {
        const validation = observedValidation(contract, outputs.map(({ artifactId }) => artifactId))
        attempts.push(publicAttempt({ attempt, runId, result, outputs, validation }))
        return algorithmResult({
          sessionId: this.runtime.sessionId,
          contract,
          recipe,
          graphArtifactId: graphArtifact.id,
          attempts,
          validation,
          rawUnknowns,
        })
      }

      let validation
      try {
        validation = await validateGeneratedOutput({
          contract,
          outputs,
          requestTemplate: {
            headers: contract.request.headers,
            userAgent: recipe.userAgent,
            strictSSL: recipe.strictSSL,
            timeoutMs: recipe.timeoutMs,
          },
          signal,
        })
      } catch (error) {
        if (signal?.aborted) throw signal.reason
        validation = {
          level: 'observed', accepted: false, status: null,
          expectedStatus: contract.success.status ?? null,
          title: null, expectedTitle: contract.success.title ?? null,
          outputArtifactIds: outputs.map(({ artifactId }) => artifactId),
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
            reason: 'status-title-or-cookie-mismatch',
            blocking: true,
          })
        }
      }
      const sourceId = outputs[0]?.artifactId || runArtifact.id
      finalValidationArtifact = await store.saveArtifact({
        kind: 'validation',
        origin: 'derived',
        sourceId,
        url: targetUrl,
        content: validation,
        metadata: { runId, attempt, level: validation.level, accepted: validation.accepted },
      })
      finalValidation = validation
      attempts.push(publicAttempt({ attempt, runId, result, outputs, validation }))

      if (validation.accepted) {
        const solverDir = join(
          this.runtime.paths.solvers,
          `${contractHash.slice(0, 16)}-${recipeHash.slice(0, 16)}`,
        )
        const solver = await exportSolver({
          sessionId: this.runtime.sessionId,
          contract,
          recipe,
          validation,
          solverDir,
        })
        const solverArtifact = await store.saveArtifact({
          kind: 'solver',
          origin: 'derived',
          sourceId: finalValidationArtifact.id,
          url: targetUrl,
          content: solver,
          metadata: { directory: solver.directory, validationLevel: validation.level },
        })
        return {
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
      }

    }

    const unknowns = aggregateUnknowns(rawUnknowns)
    const blocker = unknowns.find(({ blocking }) => blocking) || unknowns[0] || null
    const suggestedRecipeActions = recipeActions(unknowns)
    return {
      sessionId: this.runtime.sessionId,
      strategy,
      contract,
      recipe,
      graphArtifactId: graphArtifact.id,
      attempts,
      validation: finalValidation,
      validationArtifactId: finalValidationArtifact?.id || null,
      unknowns,
      blocker,
      suggestedRecipeActions,
      nextActions: suggestedRecipeActions,
      solver: null,
    }
  }
}
