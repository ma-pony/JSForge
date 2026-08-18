import { RecoveryCoordinator } from '../../recovery/coordinator.js'
import { OUTPUT_KINDS } from '../../recovery/contracts.js'
import { defineDeepSpiderTool } from '../catalog.js'

const OUTPUT_KIND_VALUES = [...OUTPUT_KINDS]
const RECOVERY_MODES = ['auto', 'semantic', 'algorithm']

const STARTING_STAGES = Object.freeze({
  browserEvidence: 'running',
  artifactGraph: 'pending',
  nodeGeneration: 'pending',
  requestValidation: 'pending',
})

function compactBlocker(blocker) {
  if (!blocker) return null
  return {
    kind: blocker.kind ?? null,
    operation: blocker.operation ?? null,
    reason: blocker.reason ?? null,
  }
}

function firstAction(result) {
  const value = result.nextActions?.[0]
  if (typeof value === 'string') return value
  return value?.action ?? null
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
      request: result.validation?.level ?? null,
    },
    strategy: result.strategy ?? null,
    blocker: compactBlocker(result.blocker),
    solverId: result.solver?.artifactId ?? null,
    nextAction: firstAction(result),
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
      await sendDialog(runtime, {
        type: 'recovery/progress',
        stages: STARTING_STAGES,
        evidenceLevels: { browser: null, node: null, request: null },
      }, { open: true })

      const result = await coordinatorFactory(runtime).recover({
        url,
        outputKind,
        outputSelector,
        mode,
        signal,
      })
      const compact = compactResult(result)

      await sendDialog(runtime, {
        type: 'recovery/progress',
        stages: compact.stages,
        evidenceLevels: compact.evidenceLevels,
      })
      await sendDialog(runtime, { type: 'recovery/result', ...compact })
      return compact
    },
  })
}

export const tools = Object.freeze([createRecoveryTool()])
