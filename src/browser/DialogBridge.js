import { getAnalysisPanelScript } from './ui/analysisPanel.js'

const BINDING_NAME = '__deepspider_send__'

function ownedJson(value) {
  return JSON.parse(JSON.stringify(value))
}

function picked(value, fields) {
  if (!value || typeof value !== 'object') return null
  return Object.fromEntries(fields.filter((field) => field in value).map((field) => [field, value[field]]))
}

function compactQuestion(question) {
  const value = picked(question, ['id', 'header', 'question', 'detail', 'multiSelect']) || {}
  value.options = Array.isArray(question?.options)
    ? question.options.map((option) => picked(option, ['label', 'description']) || {})
    : []
  return value
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
      rpcId: payload.rpcId,
      questions: Array.isArray(payload.questions) ? payload.questions.map(compactQuestion) : [],
    }
  }
  if (payload.type === 'recovery/progress') {
    return {
      type: payload.type,
      stages: picked(payload.stages, ['browserEvidence', 'artifactGraph', 'nodeGeneration', 'requestValidation']) || {},
      evidenceLevels: picked(payload.evidenceLevels, ['browser', 'node', 'request']) || {},
    }
  }
  if (payload.type === 'recovery/result') {
    return {
      type: payload.type,
      stages: picked(payload.stages, ['browserEvidence', 'artifactGraph', 'nodeGeneration', 'requestValidation']) || {},
      evidenceLevels: picked(payload.evidenceLevels, ['browser', 'node', 'request']) || {},
      strategy: payload.strategy ?? null,
      blocker: picked(payload.blocker, ['kind', 'operation', 'reason']),
      solverId: payload.solverId ?? null,
      nextAction: payload.nextAction ?? null,
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
