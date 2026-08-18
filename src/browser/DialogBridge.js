import { getAnalysisPanelScript } from './ui/analysisPanel.js'

const BINDING_NAME = '__deepspider_send__'
const STAGE_STATUS = new Set(['pending', 'running', 'complete', 'blocked', 'skipped'])
const EVIDENCE_LEVELS = new Set(['observed', 'replayed', 'reproduced'])
const STRATEGIES = new Set(['semantic-runtime', 'algorithm-recovery', 'recovery-failed'])
const BLOCKER_KINDS = new Set(['environment', 'resource', 'program', 'validation'])
const BLOCKER_OPERATIONS = new Set([
  'algorithm-recovery',
  'cycle-tls-initialize',
  'cycle-tls-request',
  'recovery-failed',
  'validate-generated-output',
  'validate-output-kind',
])
const BLOCKER_REASONS = new Set([
  'algorithm-recovery-engine-not-implemented',
  'recovery-failed',
  'status-title-or-cookie-mismatch',
])
const NEXT_ACTIONS = new Set([
  'implement-algorithm-recovery-engine',
  'inspect-program-behavior',
  'inspect-session-artifacts',
  'provide-environment-value',
  'provide-resource',
  'refresh-request-contract',
  'repair-cycle-tls-runtime',
  'retry-network-request',
])
const OUTPUT_KINDS = new Set(['cookie', 'header', 'query', 'body', 'return-value', 'navigation'])
const SOLVER_ID = /^artifact-[a-f0-9]{64}$/
const OPAQUE_ID = /^[a-zA-Z0-9_-]{1,128}$/

function ownedJson(value) {
  return JSON.parse(JSON.stringify(value))
}

function known(value, allowed, fallback) {
  return allowed.has(value) ? value : fallback
}

function compactQuestion(question) {
  const options = Array.isArray(question?.options)
    ? question.options.filter(({ label }) => OUTPUT_KINDS.has(label)).map(({ label }) => ({
      label,
      description: `${label} output`,
    }))
    : []
  return {
    id: 'recovery-output-kind',
    header: '目标输出',
    question: '选择需要独立生成的输出',
    multiSelect: false,
    options,
  }
}

function compactStages(stages) {
  const value = {}
  for (const field of ['browserEvidence', 'artifactGraph', 'nodeGeneration', 'requestValidation']) {
    if (stages && field in stages) value[field] = known(stages[field], STAGE_STATUS, 'blocked')
  }
  return value
}

function compactEvidence(evidence) {
  const value = {}
  for (const field of ['browser', 'node', 'request']) {
    if (evidence && field in evidence) value[field] = known(evidence[field], EVIDENCE_LEVELS, null)
  }
  return value
}

function compactBlocker(blocker) {
  if (!blocker) return null
  return {
    kind: known(blocker.kind, BLOCKER_KINDS, 'program'),
    operation: known(blocker.operation, BLOCKER_OPERATIONS, 'recovery-failed'),
    reason: known(blocker.reason, BLOCKER_REASONS, 'recovery-failed'),
  }
}

function compactRecoveryPayload(payload) {
  if (
    payload.type === 'question/requested'
    && payload.questions?.length === 1
    && payload.questions[0]?.id === 'recovery-output-kind'
  ) {
    return compactRecoveryPayload({ ...payload, type: 'recovery/question' })
  }
  if (payload.type === 'recovery/question') {
    return {
      type: payload.type,
      rpcId: OPAQUE_ID.test(payload.rpcId) ? payload.rpcId : null,
      questions: Array.isArray(payload.questions) ? payload.questions.map(compactQuestion) : [],
    }
  }
  if (payload.type === 'recovery/progress') {
    return {
      type: payload.type,
      stages: compactStages(payload.stages),
      evidenceLevels: compactEvidence(payload.evidenceLevels),
    }
  }
  if (payload.type === 'recovery/result') {
    return {
      type: payload.type,
      stages: compactStages(payload.stages),
      evidenceLevels: compactEvidence(payload.evidenceLevels),
      strategy: known(payload.strategy, STRATEGIES, 'recovery-failed'),
      blocker: compactBlocker(payload.blocker),
      solverId: SOLVER_ID.test(payload.solverId) ? payload.solverId : null,
      nextAction: known(payload.nextAction, NEXT_ACTIONS, payload.nextAction == null ? null : 'inspect-session-artifacts'),
    }
  }
  return payload
}

export class DialogBridge {
  constructor({ onMessage = null } = {}) {
    this.onMessage = onMessage
    this.page = null
    this.cdp = null
    this.frames = []
    this._bindingListener = null
  }

  setMessageHandler(handler) {
    if (handler != null && typeof handler !== 'function') {
      throw new TypeError('Dialog message handler must be a function')
    }
    this.onMessage = handler
  }

  async open({ page, cdp }) {
    if (!page || !cdp) throw new TypeError('Dialog requires page and cdp')
    if (this.page === page && this.cdp === cdp) {
      this.frames = typeof page.frames === 'function' ? page.frames() : [page]
      const source = getAnalysisPanelScript()
      await Promise.all(this.frames.map((frame) => frame.evaluate(source)))
      return
    }
    if (this.page || this.cdp) await this.close()

    this.page = page
    this.cdp = cdp
    this.frames = typeof page.frames === 'function' ? page.frames() : [page]
    this._bindingListener = (event) => {
      if (event?.name !== BINDING_NAME) return
      let message
      try {
        message = JSON.parse(event.payload)
      } catch {
        return
      }
      Promise.resolve(this.onMessage?.(ownedJson(message))).catch((error) => {
        console.error('[DeepSpider Dialog] message handler failed:', error.message)
      })
    }

    try {
      await cdp.send('Runtime.addBinding', { name: BINDING_NAME })
      cdp.on('Runtime.bindingCalled', this._bindingListener)
      const source = getAnalysisPanelScript()
      await Promise.all(this.frames.map((frame) => frame.evaluate(source)))
    } catch (error) {
      await this.close()
      throw error
    }
  }

  async send(payload) {
    if (!this.page) return false
    const value = ownedJson(compactRecoveryPayload(payload))
    const receiver = `(payload) => globalThis.__deepspider_dialog_receive__?.(payload)`
    const frame = this.frames[0] || this.page
    await frame.evaluate(receiver, value)
    return true
  }

  async close() {
    const cdp = this.cdp
    const frames = this.frames
    const listener = this._bindingListener

    this.page = null
    this.cdp = null
    this.frames = []
    this._bindingListener = null

    if (cdp && listener) cdp.off('Runtime.bindingCalled', listener)
    await Promise.allSettled(frames.map((frame) => (
      frame.evaluate(`() => globalThis.__deepspider_dialog_close__?.()`)
    )))
    if (cdp) {
      await cdp.send('Runtime.removeBinding', { name: BINDING_NAME }).catch(() => {})
    }
  }
}
