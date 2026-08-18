import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'

import { BrowserClient } from '../src/browser/client.js'

function createHarness({ failMethod = null } = {}) {
  const cdp = new EventEmitter()
  cdp.methods = []
  cdp.send = async (method) => {
    cdp.methods.push(method)
    if (method === failMethod) throw new Error(`${method} failed`)
    return {}
  }
  cdp.detach = async () => {}

  const page = new EventEmitter()
  page.url = () => 'about:blank'
  page.mainFrame = () => ({ url: () => 'about:blank' })
  page.evaluateCalls = []
  page.evaluate = async (source) => {
    page.evaluateCalls.push(source)
  }

  const context = new EventEmitter()
  context.addInitScriptCalls = []
  context.addInitScript = async (source) => {
    context.addInitScriptCalls.push(source)
  }
  context.newPage = async () => page
  context.newCDPSession = async () => cdp
  context.pages = () => [page]
  context.close = async () => {}
  page.context = () => context

  const browser = {
    closed: false,
    newContext: async () => context,
    close: async () => {
      browser.closed = true
    },
  }
  const browserType = {
    launch: async () => browser,
    launchPersistentContext: async () => context,
  }
  const store = { startSession() {} }
  return { browser, browserType, cdp, context, page, store }
}

test('observe mode adds no init script or Runtime binding', async () => {
  const harness = createHarness()
  const client = new BrowserClient({
    dataStore: harness.store,
    browserType: harness.browserType,
  })

  await client.launch({ mode: 'observe', disableInterceptors: true })

  assert.equal(client.mode, 'observe')
  assert.deepEqual(harness.context.addInitScriptCalls, [])
  assert.equal(harness.cdp.methods.includes('Runtime.addBinding'), false)
  await client.close()
})

test('Probe activation installs its script for future documents without evaluating about:blank', async () => {
  const harness = createHarness()
  const client = new BrowserClient({
    dataStore: harness.store,
    browserType: harness.browserType,
  })
  await client.launch({ mode: 'observe', disableInterceptors: true })

  await client.activateProbe()
  await client.activateProbe()

  assert.equal(client.mode, 'probe')
  assert.equal(harness.context.addInitScriptCalls.length, 1)
  assert.equal(harness.page.evaluateCalls.length, 0)
  assert.match(harness.context.addInitScriptCalls[0], /__deepspider__/)
  await client.close()
})

test('initial setup failure closes the partial browser and rejects launch', async () => {
  const harness = createHarness({ failMethod: 'Network.enable' })
  const client = new BrowserClient({
    dataStore: harness.store,
    browserType: harness.browserType,
  })

  await assert.rejects(
    client.launch({ mode: 'observe' }),
    /Network\.enable failed/,
  )
  assert.equal(harness.browser.closed, true)
})
