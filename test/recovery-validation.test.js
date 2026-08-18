import assert from 'node:assert/strict'
import http from 'node:http'
import net from 'node:net'
import test from 'node:test'

import { validateGeneratedOutput } from '../src/recovery/validation.js'

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const { port } = server.address()
  return `http://127.0.0.1:${port}/target`
}

async function close(server) {
  await new Promise((resolve) => server.close(resolve))
}

async function waitForCycleTlsExit(timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const open = await new Promise((resolve) => {
      const socket = net.connect(9119, '127.0.0.1')
      socket.once('connect', () => { socket.destroy(); resolve(true) })
      socket.once('error', () => resolve(false))
    })
    if (!open) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  assert.fail('CycleTLS process still owns port 9119')
}

function contract(url, selector = 'clearance') {
  return {
    kind: 'cookie',
    selector,
    request: { method: 'GET', url },
    success: { status: 200, title: 'Accepted' },
  }
}

function requestTemplate() {
  return {
    headers: {},
    userAgent: 'DeepSpider recovery validation test',
    strictSSL: false,
    timeoutMs: 3000,
  }
}

test('concurrent CycleTLS validation initializes once and both requests reproduce', { timeout: 10000 }, async (t) => {
  const server = http.createServer((request, response) => {
    const accepted = request.headers.cookie === 'clearance=generated'
    response.writeHead(accepted ? 200 : 412, { 'content-type': 'text/html' })
    response.end(`<title>${accepted ? 'Accepted' : 'Challenge'}</title>`)
  })
  const url = await listen(server)
  t.after(() => close(server))

  const validation = () => validateGeneratedOutput({
    contract: contract(url),
    outputs: [{ kind: 'cookie', name: 'clearance', value: 'generated' }],
    requestTemplate: requestTemplate(),
  })
  const deadline = new Promise((_, reject) => {
    const timer = setTimeout(() => reject(new Error('concurrent validation timed out')), 7000)
    timer.unref()
  })
  const results = await Promise.race([Promise.all([validation(), validation()]), deadline])
  assert.deepEqual(results.map(({ level }) => level), ['reproduced', 'reproduced'])
  assert.deepEqual(results.map(({ accepted }) => accepted), [true, true])
  await waitForCycleTlsExit()
})

test('aborting a real CycleTLS request closes its client and shared process', { timeout: 10000 }, async (t) => {
  const server = http.createServer((_request, response) => {
    setTimeout(() => {
      response.writeHead(200, { 'content-type': 'text/html' })
      response.end('<title>Accepted</title>')
    }, 2000)
  })
  const url = await listen(server)
  t.after(() => close(server))
  const controller = new globalThis.AbortController()
  const reason = new Error('validation cancelled')
  const validation = validateGeneratedOutput({
    contract: contract(url),
    outputs: [{ kind: 'cookie', name: 'clearance', value: 'generated' }],
    requestTemplate: requestTemplate(),
    signal: controller.signal,
  })
  setTimeout(() => controller.abort(reason), 100)
  await assert.rejects(validation, (error) => error === reason)
  await waitForCycleTlsExit()
})

test('Cookie validation requires at least one legal generated Cookie and selector match', async () => {
  const target = 'http://127.0.0.1:1/unused'
  for (const outputs of [
    [],
    [{ kind: 'cookie', name: '', value: 'generated' }],
    [{ kind: 'cookie', name: 'wrong', value: 'generated' }],
    [{ kind: 'cookie', name: 'clearance', value: 'bad;value' }],
  ]) {
    const result = await validateGeneratedOutput({
      contract: contract(target), outputs, requestTemplate: requestTemplate(),
    })
    assert.equal(result.accepted, false)
    assert.equal(result.level, 'observed')
    assert.equal(result.status, null)
    assert.equal(result.failure?.operation, 'validate-generated-cookie')
  }
})
