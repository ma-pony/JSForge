import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { registerRebuildTools } from '../src/mcp/tools/rebuild.js'

function fakeServer() {
  const tools = new Map()
  return {
    tools,
    tool(name, description, schema, handler) {
      tools.set(name, { description, schema, handler })
    },
  }
}

function textResult(result) {
  return JSON.parse(result.content[0].text)
}

test('exports an immutable bundle from an exact current-session script ID', async () => {
  const rebuildDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepspider-export-'))
  const calls = []
  const source = 'globalThis.answer = 42;\n'
  const pageData = {
    navigator: {}, screen: {}, location: {}, localStorage: {}, sessionStorage: {}, document: {},
  }
  const store = {
    getSessionId() { return 'session-current' },
    async getScriptList(site, sessionOnly) {
      calls.push(['getScriptList', site, sessionOnly])
      return [{
        id: 'script-current',
        site: 'example.com',
        url: 'https://example.com/app.js',
        sessionId: 'session-current',
      }]
    },
    async getScript(site, scriptId) {
      calls.push(['getScript', site, scriptId])
      return source
    },
  }
  const server = fakeServer()
  registerRebuildTools(server, {
    rebuildDir,
    getStore: () => store,
    getPageUrl: async () => 'https://example.com/page',
    collectPageData: async () => pageData,
    buildEnvironment: () => 'globalThis.window = globalThis;\n',
  })

  assert.deepEqual([...server.tools.keys()].sort(), ['analyze_runtime_trace', 'export_rebuild_bundle'])
  const exportTool = server.tools.get('export_rebuild_bundle')
  assert.ok(exportTool.schema.scriptId)
  assert.equal(exportTool.schema.scriptUrl, undefined)

  const result = await exportTool.handler({
    taskId: 'fixture-task',
    scriptId: 'script-current',
    callExpression: 'window.answer',
  })
  const data = textResult(result)

  assert.equal(result.isError, undefined)
  assert.equal(data.success, true)
  assert.deepEqual(calls, [
    ['getScriptList', null, true],
    ['getScript', 'example.com', 'script-current'],
  ])

  const taskDir = path.join(rebuildDir, 'fixture-task')
  assert.deepEqual(fs.readdirSync(taskDir).sort(), [
    'dynamic',
    'env.js',
    'environment.json',
    'manifest.json',
    'patches.json',
    'probe.js',
    'runner.mjs',
    'runs',
    'target.js',
  ])
  const manifest = JSON.parse(fs.readFileSync(path.join(taskDir, 'manifest.json'), 'utf8'))
  assert.equal(manifest.sessionId, 'session-current')
  assert.equal(manifest.scriptId, 'script-current')
  assert.equal(manifest.pageUrl, 'https://example.com/page')
  assert.equal(fs.readFileSync(path.join(taskDir, 'target.js'), 'utf8'), source)
  assert.equal(fs.statSync(taskDir).mode & 0o777, 0o700)
  assert.equal(fs.statSync(path.join(taskDir, 'target.js')).mode & 0o777, 0o600)

  const duplicate = await exportTool.handler({
    taskId: 'fixture-task',
    scriptId: 'script-current',
    callExpression: 'window.answer',
  })
  assert.equal(duplicate.isError, true)
  assert.match(textResult(duplicate).error, /already exists/)
})

test('analyzes a stored probe trace without permitting target modification', async () => {
  const rebuildDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepspider-trace-tool-'))
  const runDir = path.join(rebuildDir, 'fixture-task', 'runs', 'run-1')
  fs.mkdirSync(runDir, { recursive: true })
  fs.writeFileSync(path.join(runDir, 'trace.ndjson'), [
    JSON.stringify({ category: 'runtime-timeout', path: 'target.js' }),
    JSON.stringify({ category: 'source-integrity', path: 'Function.prototype.toString' }),
  ].join('\n'))
  const server = fakeServer()
  registerRebuildTools(server, { rebuildDir })

  const result = await server.tools.get('analyze_runtime_trace').handler({
    taskId: 'fixture-task',
    runId: 'run-1',
  })
  const data = textResult(result)

  assert.equal(data.category, 'source-integrity')
  assert.equal(data.targetModificationAllowed, false)
})
