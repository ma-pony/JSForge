import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'

import { DialogBridge } from '../src/browser/DialogBridge.js'
import { getAnalysisPanelScript } from '../src/browser/ui/analysisPanel.js'
import { tools as browserTools } from '../src/tools/groups/browser.js'

function harness() {
  const cdp = new EventEmitter()
  cdp.calls = []
  cdp.send = async (method, params) => {
    cdp.calls.push([method, params])
    return {}
  }

  const evaluations = []
  const frame = {
    async evaluate(source, argument) {
      evaluations.push([source, argument])
    },
  }
  const page = {
    frames: () => [frame],
  }
  return { cdp, evaluations, frame, page }
}

test('Dialog installs its own binding on demand without requiring or activating Probe', async () => {
  const { cdp, evaluations, page } = harness()
  const bridge = new DialogBridge()

  await bridge.open({ page, cdp })

  assert.deepEqual(cdp.calls[0], [
    'Runtime.addBinding',
    { name: '__deepspider_send__' },
  ])
  assert.equal(evaluations.length, 1)
  assert.match(evaluations[0][0], /__deepspider_dialog_receive__/)
  assert.doesNotMatch(evaluations[0][0], /window\.__deepspider__\s*[;=]/)
})

test('Dialog owns binding messages, sends JSON-owned payloads, and removes itself', async () => {
  const { cdp, evaluations, page } = harness()
  const messages = []
  const bridge = new DialogBridge({ onMessage: (message) => messages.push(message) })
  await bridge.open({ page, cdp })

  cdp.emit('Runtime.bindingCalled', {
    name: '__deepspider_send__',
    payload: JSON.stringify({ type: 'chat', text: 'analyze this' }),
  })
  cdp.emit('Runtime.bindingCalled', { name: 'other-binding', payload: '{}' })
  assert.deepEqual(messages, [{ type: 'chat', text: 'analyze this' }])

  await bridge.send({ type: 'assistant', text: 'done' })
  assert.deepEqual(evaluations.at(-1)[1], { type: 'assistant', text: 'done' })

  await bridge.close()
  assert.equal(cdp.listenerCount('Runtime.bindingCalled'), 0)
  assert.equal(cdp.calls.some(([method]) => method === 'Runtime.removeBinding'), true)
  assert.match(evaluations.at(-1)[0], /__deepspider_dialog_close__/)
})

test('Dialog keeps Recovery messages compact and reuses the native DSH question envelope', async () => {
  const { cdp, evaluations, page } = harness()
  const bridge = new DialogBridge()
  await bridge.open({ page, cdp })

  await bridge.send({
    type: 'recovery/result',
    stages: { browserEvidence: 'complete', requestValidation: 'complete' },
    evidenceLevels: { browser: 'observed', request: 'reproduced' },
    strategy: 'semantic-runtime',
    blocker: null,
    solverId: 'solver-1',
    nextAction: null,
    cookie: 'secret-cookie-value',
    rawTrace: 'secret-trace',
    source: 'secret-source',
  })
  assert.deepEqual(evaluations.at(-1)[1], {
    type: 'recovery/result',
    stages: { browserEvidence: 'complete', requestValidation: 'complete' },
    evidenceLevels: { browser: 'observed', request: 'reproduced' },
    strategy: 'semantic-runtime',
    blocker: null,
    solverId: 'solver-1',
    nextAction: null,
  })

  await bridge.send({
    type: 'question/requested',
    rpcId: 'question-1',
    questions: [{
      id: 'recovery-output-kind',
      header: '目标输出',
      question: '选择需要独立生成的输出',
      options: [{ label: 'cookie', description: 'Cookie output' }],
    }],
  })
  assert.equal(evaluations.at(-1)[1].type, 'recovery/question')
  assert.equal(evaluations.at(-1)[1].rpcId, 'question-1')
  assert.deepEqual(evaluations.at(-1)[1].questions[0].options, [
    { label: 'cookie', description: 'Cookie output' },
  ])
})

test('analysis Dialog encodes one complete native DSH question batch', () => {
  const source = getAnalysisPanelScript()

  assert.match(source, /question\/requested/)
  assert.match(source, /multiSelect/)
  assert.match(source, /question\/answer/)
  assert.match(source, /question\/resolved/)
  assert.match(source, /selected/)
  assert.match(source, /custom/)
  assert.match(source, /deepspider-iframe-selection/)
  assert.match(source, /recovery\/progress/)
  assert.match(source, /recovery\/question/)
  assert.match(source, /recovery\/result/)
  assert.match(source, /browserEvidence/)
  assert.match(source, /artifactGraph/)
  assert.match(source, /nodeGeneration/)
  assert.match(source, /requestValidation/)
})

test('browser_dialog opens interactively without activating Probe hooks', async () => {
  let opens = 0
  const client = {
    mode: 'observe',
    probeActivated: false,
    async openDialog() { opens += 1 },
  }
  const runtime = {
    browserClient: client,
    async getBrowserClient() { return client },
    async waitForOperation(operation) { return operation },
  }
  const definition = browserTools.find(({ name }) => name === 'browser_dialog')

  assert.deepEqual(await definition.execute(runtime, { action: 'open' }), {
    mode: 'interactive',
    open: true,
  })
  assert.equal(opens, 1)
  assert.equal(client.probeActivated, false)
  assert.equal(client.mode, 'observe')
})
