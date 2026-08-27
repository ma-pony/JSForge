import assert from 'node:assert/strict'
import test from 'node:test'

import { createRecoveryTool } from '../src/tools/groups/recovery.js'

function coordinatorResult(sessionId) {
  const solverId = `artifact-${sessionId === 'alpha' ? 'a'.repeat(64) : 'b'.repeat(64)}`
  return {
    sessionId,
    strategy: 'semantic-runtime',
    graphArtifactId: `graph-${sessionId}`,
    attempts: [{ outputCount: 2 }],
    validation: { level: 'reproduced', accepted: true },
    blocker: null,
    nextActions: [],
    solver: { artifactId: solverId, directory: `/private/${sessionId}` },
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
    solverId: `artifact-${'a'.repeat(64)}`,
    nextAction: null,
  })
  assert.equal(JSON.stringify(alpha).includes('must-not-leak'), false)
  assert.equal(JSON.stringify(alpha).includes('/private/'), false)
  assert.equal(beta.solverId, `artifact-${'b'.repeat(64)}`)
})

test('recover_target_output exposes the exact bounded public contract', () => {
  const tool = createRecoveryTool({ coordinatorFactory: () => ({ recover: async () => ({}) }) })

  assert.equal(tool.name, 'recover_target_output')
  assert.deepEqual(tool.parameters.outputKind.enum, ['cookie'])
  assert.equal(tool.parameters.outputKind.required, true)
  assert.deepEqual(tool.parameters.mode.enum, ['auto', 'semantic', 'algorithm'])
  assert.equal(tool.parameters.mode.default, 'auto')
})

test('recover_target_output maps untrusted Coordinator strings to fixed public codes', async () => {
  const secret = 'Cookie: sid=SECRET source=rawTrace /private/tmp/secret.js'
  const sent = []
  const tool = createRecoveryTool({
    coordinatorFactory: () => ({
      recover: async () => ({
        strategy: secret,
        graphArtifactId: 'artifact-graph',
        attempts: [{ outputCount: 1 }],
        validation: { level: secret, accepted: true },
        blocker: { kind: secret, operation: secret, reason: secret },
        nextActions: [{ action: secret }],
        solver: { artifactId: secret },
      }),
    }),
  })
  const runtime = {
    async sendDialog(payload) { sent.push(payload); return true },
  }

  const result = await tool.execute(runtime, {
    url: 'https://example.test/',
    outputKind: 'cookie',
  })

  assert.deepEqual(result, {
    stages: {
      browserEvidence: 'complete',
      artifactGraph: 'complete',
      nodeGeneration: 'complete',
      requestValidation: 'complete',
    },
    evidenceLevels: { browser: 'observed', node: 'reproduced', request: null },
    strategy: 'recovery-failed',
    blocker: { kind: 'program', operation: 'recovery-failed', reason: 'recovery-failed' },
    solverId: null,
    nextAction: 'inspect-session-artifacts',
  })
  assert.doesNotMatch(JSON.stringify({ result, sent }), /SECRET|source|private\/tmp|rawTrace/)
})

test('recover_target_output preserves fixed capability-resolution blocker codes', async () => {
  const tool = createRecoveryTool({
    coordinatorFactory: () => ({
      recover: async () => ({
        strategy: 'recovery-unavailable',
        graphArtifactId: null,
        attempts: [],
        validation: { level: 'observed', accepted: false },
        blocker: {
          kind: 'program',
          operation: 'resolve-recovery-capability',
          reason: 'unsupported-output-kind',
        },
        nextActions: [{ action: 'select-supported-output' }],
        solver: null,
      }),
    }),
  })

  const result = await tool.execute({}, {
    url: 'https://example.test/', outputKind: 'cookie',
  })

  assert.equal(result.blocker.operation, 'resolve-recovery-capability')
  assert.equal(result.blocker.reason, 'unsupported-output-kind')
  assert.equal(result.nextAction, 'select-supported-output')
})

test('recover_target_output preserves unsupported Validator contract codes', async () => {
  const tool = createRecoveryTool({
    coordinatorFactory: () => ({
      recover: async () => ({
        strategy: 'semantic-runtime',
        graphArtifactId: 'artifact-graph',
        attempts: [{ outputCount: 1 }],
        validation: { level: 'observed', accepted: false },
        blocker: {
          kind: 'program',
          operation: 'validate-output-contract',
          reason: 'unsupported-success-condition',
        },
        nextActions: [{ action: 'select-compatible-validator' }],
        solver: null,
      }),
    }),
  })

  const result = await tool.execute({}, {
    url: 'https://example.test/', outputKind: 'cookie',
  })

  assert.equal(result.blocker.operation, 'validate-output-contract')
  assert.equal(result.blocker.reason, 'unsupported-success-condition')
  assert.equal(result.nextAction, 'select-compatible-validator')
})

test('recover_target_output stores Coordinator errors but returns one fixed compact failure', async () => {
  const secret = 'Cookie: sid=SECRET source=rawTrace /private/tmp/secret.js'
  const artifacts = []
  const sent = []
  const tool = createRecoveryTool({
    coordinatorFactory: () => ({
      recover: async () => { throw new Error(secret) },
    }),
  })
  const runtime = {
    dataStore: {
      async saveArtifact(artifact) { artifacts.push(artifact); return { id: 'artifact-private' } },
    },
    async sendDialog(payload) { sent.push(payload); return true },
  }

  const result = await tool.execute(runtime, {
    url: 'https://example.test/',
    outputKind: 'cookie',
  })

  assert.equal(artifacts.length, 1)
  assert.match(JSON.stringify(artifacts[0]), /SECRET/)
  assert.equal(result.strategy, 'recovery-failed')
  assert.deepEqual(result.blocker, {
    kind: 'program', operation: 'recovery-failed', reason: 'recovery-failed',
  })
  assert.equal(result.nextAction, 'inspect-session-artifacts')
  assert.doesNotMatch(JSON.stringify({ result, sent }), /SECRET|source|private\/tmp|rawTrace/)
})

test('recover_target_output rejects an already-aborted operation with one fixed safe error', async () => {
  const secret = 'Cookie: sid=SECRET source=rawTrace /private/tmp/secret.js'
  const artifacts = []
  const sent = []
  const controller = new globalThis.AbortController()
  controller.abort(new Error(secret))
  const tool = createRecoveryTool({
    coordinatorFactory: () => ({
      recover: async ({ signal }) => { throw signal.reason },
    }),
  })
  const runtime = {
    dataStore: {
      async saveArtifact(artifact) { artifacts.push(artifact); return { id: 'artifact-private' } },
    },
    async sendDialog(payload) { sent.push(payload); return true },
  }

  await assert.rejects(
    tool.execute(runtime, {
      url: 'https://example.test/',
      outputKind: 'cookie',
    }, controller.signal),
    (error) => {
      assert.equal(error.name, 'AbortError')
      assert.equal(error.code, 'RECOVERY_ABORTED')
      assert.equal(error.message, 'RECOVERY_ABORTED')
      assert.doesNotMatch(`${error.name} ${error.code} ${error.message}`, /SECRET|source|private\/tmp|rawTrace/)
      return true
    },
  )

  assert.equal(artifacts.length, 1)
  assert.match(JSON.stringify(artifacts[0]), /SECRET/)
  assert.doesNotMatch(JSON.stringify(sent), /SECRET|source|private\/tmp|rawTrace/)
})

test('recover_target_output rejects an in-flight abort with one fixed safe error', async () => {
  const secret = 'Cookie: sid=SECRET source=rawTrace /private/tmp/secret.js'
  const artifacts = []
  const sent = []
  const controller = new globalThis.AbortController()
  let started
  const running = new Promise((resolve) => { started = resolve })
  const tool = createRecoveryTool({
    coordinatorFactory: () => ({
      recover: async ({ signal }) => new Promise((resolve, reject) => {
        started()
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      }),
    }),
  })
  const runtime = {
    dataStore: {
      async saveArtifact(artifact) { artifacts.push(artifact); return { id: 'artifact-private' } },
    },
    async sendDialog(payload) { sent.push(payload); return true },
  }

  const recovery = tool.execute(runtime, {
    url: 'https://example.test/',
    outputKind: 'cookie',
  }, controller.signal)
  await running
  controller.abort(new Error(secret))

  await assert.rejects(recovery, (error) => {
    assert.equal(error.name, 'AbortError')
    assert.equal(error.code, 'RECOVERY_ABORTED')
    assert.equal(error.message, 'RECOVERY_ABORTED')
    assert.doesNotMatch(`${error.name} ${error.code} ${error.message}`, /SECRET|source|private\/tmp|rawTrace/)
    return true
  })
  assert.equal(artifacts.length, 1)
  assert.match(JSON.stringify(artifacts[0]), /SECRET/)
  assert.doesNotMatch(JSON.stringify(sent), /SECRET|source|private\/tmp|rawTrace/)
})

test('recover_target_output rejects an abort while the final progress Dialog is pending', async () => {
  const secret = 'Cookie: sid=SECRET source=rawTrace /private/tmp/secret.js'
  const artifacts = []
  const sent = []
  const controller = new globalThis.AbortController()
  let progressStarted
  const waitingForProgress = new Promise((resolve) => { progressStarted = resolve })
  let releaseProgress
  const pendingProgress = new Promise((resolve) => { releaseProgress = resolve })
  let progressCount = 0
  const tool = createRecoveryTool({
    coordinatorFactory: () => ({
      recover: async () => coordinatorResult('alpha'),
    }),
  })
  const runtime = {
    dataStore: {
      async saveArtifact(artifact) { artifacts.push(artifact); return { id: 'artifact-private' } },
    },
    async sendDialog(payload) {
      sent.push(payload)
      if (payload.type === 'recovery/progress' && ++progressCount === 2) {
        progressStarted()
        await pendingProgress
      }
      return true
    },
  }

  const recovery = tool.execute(runtime, {
    url: 'https://example.test/',
    outputKind: 'cookie',
  }, controller.signal)
  await waitingForProgress
  controller.abort(new Error(secret))
  releaseProgress()

  await assert.rejects(recovery, (error) => (
    error.name === 'AbortError'
    && error.code === 'RECOVERY_ABORTED'
    && error.message === 'RECOVERY_ABORTED'
  ))
  assert.equal(artifacts.length, 1)
  assert.match(JSON.stringify(artifacts[0]), /SECRET/)
  assert.deepEqual(sent.map(({ type }) => type), ['recovery/progress', 'recovery/progress'])
  assert.doesNotMatch(JSON.stringify(sent), /SECRET|source|private\/tmp|rawTrace/)
})
