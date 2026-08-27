import { RecoveryCoordinator } from '../../recovery/coordinator.js'
import { SUPPORTED_RECOVERY_OUTPUT_KINDS } from '../../recovery/default-capabilities.js'
import { defineDeepSpiderTool } from '../catalog.js'

const OUTPUT_KIND_VALUES = [...SUPPORTED_RECOVERY_OUTPUT_KINDS]
const RECOVERY_MODES = ['auto', 'semantic', 'algorithm']
const STRATEGIES = new Set(['semantic-runtime', 'algorithm-recovery'])
const EVIDENCE_LEVELS = new Set(['observed', 'replayed', 'reproduced'])
const BLOCKER_KINDS = new Set(['environment', 'resource', 'program', 'validation'])
const BLOCKER_OPERATIONS = new Set([
  'algorithm-recovery',
  'cycle-tls-initialize',
  'cycle-tls-request',
  'resolve-recovery-capability',
  'validate-generated-output',
  'validate-output-contract',
  'validate-output-kind',
])
const BLOCKER_REASONS = new Set([
  'algorithm-recovery-engine-not-implemented',
  'unsupported-output-kind',
  'unsupported-recovery-mode',
  'status-title-or-output-mismatch',
  'status-title-or-cookie-mismatch',
  'unsupported-success-condition',
])
const NEXT_ACTIONS = new Set([
  'implement-algorithm-recovery-engine',
  'inspect-program-behavior',
  'provide-environment-value',
  'provide-resource',
  'refresh-request-contract',
  'repair-cycle-tls-runtime',
  'retry-network-request',
  'select-supported-output',
  'select-compatible-validator',
])
const SOLVER_ID = /^artifact-[a-f0-9]{64}$/

const STARTING_STAGES = Object.freeze({
  browserEvidence: 'running',
  artifactGraph: 'pending',
  nodeGeneration: 'pending',
  requestValidation: 'pending',
})

function compactBlocker(blocker) {
  if (!blocker) return null
  return {
    kind: BLOCKER_KINDS.has(blocker.kind) ? blocker.kind : 'program',
    operation: BLOCKER_OPERATIONS.has(blocker.operation) ? blocker.operation : 'recovery-failed',
    reason: BLOCKER_REASONS.has(blocker.reason) ? blocker.reason : 'recovery-failed',
  }
}

function firstAction(result) {
  const value = result.nextActions?.[0]
  const action = typeof value === 'string' ? value : value?.action
  return NEXT_ACTIONS.has(action) ? action : value == null ? null : 'inspect-session-artifacts'
}

function compactResult(result) {
  const generated = result.attempts?.some(({ outputCount }) => outputCount > 0) === true
  const hasGraph = typeof result.graphArtifactId === 'string' && result.graphArtifactId.length > 0
  const algorithm = result.strategy === 'algorithm-recovery'
  const accepted = result.validation?.accepted === true

  return {
    stages: {
      browserEvidence: hasGraph ? 'complete' : algorithm ? 'skipped' : 'blocked',
      artifactGraph: hasGraph ? 'complete' : algorithm ? 'skipped' : 'blocked',
      nodeGeneration: generated ? 'complete' : algorithm ? 'skipped' : 'blocked',
      requestValidation: accepted ? 'complete' : algorithm ? 'skipped' : 'blocked',
    },
    evidenceLevels: {
      browser: hasGraph ? 'observed' : null,
      node: accepted ? 'reproduced' : null,
      request: EVIDENCE_LEVELS.has(result.validation?.level) ? result.validation.level : null,
    },
    strategy: STRATEGIES.has(result.strategy) ? result.strategy : 'recovery-failed',
    blocker: compactBlocker(result.blocker),
    solverId: SOLVER_ID.test(result.solver?.artifactId) ? result.solver.artifactId : null,
    nextAction: firstAction(result),
  }
}

function failedResult() {
  return {
    stages: {
      browserEvidence: 'blocked',
      artifactGraph: 'blocked',
      nodeGeneration: 'blocked',
      requestValidation: 'blocked',
    },
    evidenceLevels: { browser: null, node: null, request: null },
    strategy: 'recovery-failed',
    blocker: { kind: 'program', operation: 'recovery-failed', reason: 'recovery-failed' },
    solverId: null,
    nextAction: 'inspect-session-artifacts',
  }
}

function recoveryAbortError() {
  const error = new Error('RECOVERY_ABORTED')
  error.name = 'AbortError'
  error.code = 'RECOVERY_ABORTED'
  return error
}

async function savePrivateFailure(runtime, error, url) {
  if (typeof runtime.dataStore?.saveArtifact !== 'function') return
  const failure = error instanceof Error
    ? { name: error.name, message: error.message, stack: error.stack }
    : { name: 'Error', message: String(error), stack: null }
  await runtime.dataStore.saveArtifact({
    kind: 'recovery-failure',
    origin: 'generated',
    url,
    content: failure,
    metadata: { operation: 'recover-target-output' },
  }).catch(() => {})
}

function createAbortCheckpoint(runtime, signal, url) {
  let failureSaved = false
  return (error = signal?.reason) => {
    if (!signal?.aborted) return null
    return (async () => {
      if (!failureSaved) {
        failureSaved = true
        await savePrivateFailure(runtime, error, url)
      }
      throw recoveryAbortError()
    })()
  }
}

async function sendDialog(runtime, payload, options) {
  if (typeof runtime.sendDialog !== 'function') return false
  try {
    return await runtime.sendDialog(payload, options)
  } catch {
    return false
  }
}

export function createRecoveryTool({
  coordinatorFactory = (runtime) => new RecoveryCoordinator(runtime),
} = {}) {
  return defineDeepSpiderTool({
    name: 'recover_target_output',
    description: 'Independently generate a target output in the Session semantic runtime and validate it with a real request',
    parameters: {
      url: { type: 'string', required: true, description: 'Target page URL already observed in this Session' },
      outputKind: {
        type: 'string',
        enum: OUTPUT_KIND_VALUES,
        required: true,
        description: 'Output Contract kind; use the native DSH question tool first when this is ambiguous',
      },
      outputSelector: { type: 'string', description: 'Optional output name or path within the selected kind' },
      mode: {
        type: 'string',
        enum: RECOVERY_MODES,
        default: 'auto',
        description: 'Use semantic recovery by default; algorithm is an explicit escalation',
      },
    },
    async execute(runtime, {
      url,
      outputKind,
      outputSelector = null,
      mode = 'auto',
    }, signal) {
      const abortCheckpoint = createAbortCheckpoint(runtime, signal, url)
      let pendingAbort = abortCheckpoint()
      if (pendingAbort) await pendingAbort
      await sendDialog(runtime, {
        type: 'recovery/progress',
        stages: STARTING_STAGES,
        evidenceLevels: { browser: null, node: null, request: null },
      }, { open: true })
      pendingAbort = abortCheckpoint()
      if (pendingAbort) await pendingAbort

      let compact
      let result
      try {
        result = await coordinatorFactory(runtime).recover({
          url,
          outputKind,
          outputSelector,
          mode,
          signal,
        })
      } catch (error) {
        pendingAbort = abortCheckpoint(error)
        if (pendingAbort) await pendingAbort
        await savePrivateFailure(runtime, error, url)
        compact = failedResult()
      }
      pendingAbort = abortCheckpoint()
      if (pendingAbort) await pendingAbort
      if (!compact) compact = compactResult(result)

      pendingAbort = abortCheckpoint()
      if (pendingAbort) await pendingAbort
      await sendDialog(runtime, {
        type: 'recovery/progress',
        stages: compact.stages,
        evidenceLevels: compact.evidenceLevels,
      })
      pendingAbort = abortCheckpoint()
      if (pendingAbort) await pendingAbort
      await sendDialog(runtime, { type: 'recovery/result', ...compact })
      pendingAbort = abortCheckpoint()
      if (pendingAbort) await pendingAbort
      return compact
    },
  })
}

export const tools = Object.freeze([createRecoveryTool()])
