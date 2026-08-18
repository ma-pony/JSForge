import assert from 'node:assert/strict'
import test from 'node:test'

import { createRecoveryTool } from '../src/tools/groups/recovery.js'

function coordinatorResult(sessionId) {
  return {
    sessionId,
    strategy: 'semantic-runtime',
    graphArtifactId: `graph-${sessionId}`,
    attempts: [{ outputCount: 2 }],
    validation: { level: 'reproduced', accepted: true },
    blocker: null,
    nextActions: [],
    solver: { artifactId: `solver-${sessionId}`, directory: `/private/${sessionId}` },
    contract: { secret: 'must-not-leak' },
    recipe: { fixedValues: { token: 'must-not-leak' } },
  }
}

test('recover_target_output keeps Coordinator and Dialog state inside each Session', async () => {
  const calls = []
  const tool = createRecoveryTool({
    coordinatorFactory(runtime) {
      return {
        async recover(args) {
          calls.push({ runtime, args })
          return coordinatorResult(runtime.sessionId)
        },
      }
    },
  })
  const signalA = new globalThis.AbortController().signal
  const signalB = new globalThis.AbortController().signal
  const runtimeA = {
    sessionId: 'alpha',
    sent: [],
    async sendDialog(payload, options) { this.sent.push({ payload, options }); return true },
  }
  const runtimeB = {
    sessionId: 'beta',
    sent: [],
    async sendDialog(payload, options) { this.sent.push({ payload, options }); return true },
  }

  const [alpha, beta] = await Promise.all([
    tool.execute(runtimeA, { url: 'https://example.test/a', outputKind: 'cookie' }, signalA),
    tool.execute(runtimeB, { url: 'https://example.test/b', outputKind: 'header', mode: 'semantic' }, signalB),
  ])

  assert.equal(calls[0].args.signal, signalA)
  assert.equal(calls[1].args.signal, signalB)
  assert.deepEqual(calls.map(({ runtime }) => runtime.sessionId), ['alpha', 'beta'])
  assert.equal(runtimeA.sent.every(({ payload }) => JSON.stringify(payload).includes('beta') === false), true)
  assert.equal(runtimeB.sent.every(({ payload }) => JSON.stringify(payload).includes('alpha') === false), true)
  assert.equal(runtimeA.sent[0].options.open, true)
  assert.deepEqual(runtimeA.sent.map(({ payload }) => payload.type), [
    'recovery/progress',
    'recovery/progress',
    'recovery/result',
  ])
  assert.deepEqual(alpha, {
    stages: {
      browserEvidence: 'complete',
      artifactGraph: 'complete',
      nodeGeneration: 'complete',
      requestValidation: 'complete',
    },
    evidenceLevels: {
      browser: 'observed',
      node: 'reproduced',
      request: 'reproduced',
    },
    strategy: 'semantic-runtime',
    blocker: null,
    solverId: 'solver-alpha',
    nextAction: null,
  })
  assert.equal(JSON.stringify(alpha).includes('must-not-leak'), false)
  assert.equal(JSON.stringify(alpha).includes('/private/'), false)
  assert.equal(beta.solverId, 'solver-beta')
})

test('recover_target_output exposes the exact bounded public contract', () => {
  const tool = createRecoveryTool({ coordinatorFactory: () => ({ recover: async () => ({}) }) })

  assert.equal(tool.name, 'recover_target_output')
  assert.deepEqual(tool.parameters.outputKind.enum, [
    'cookie', 'header', 'query', 'body', 'return-value', 'navigation',
  ])
  assert.equal(tool.parameters.outputKind.required, true)
  assert.deepEqual(tool.parameters.mode.enum, ['auto', 'semantic', 'algorithm'])
  assert.equal(tool.parameters.mode.default, 'auto')
})
