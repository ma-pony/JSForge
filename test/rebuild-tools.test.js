import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { tools as rebuildTools } from '../src/tools/groups/rebuild.js'

function definition(name) {
  return rebuildTools.find((tool) => tool.name === name)
}

test('exports an immutable bundle from an exact current-session script ID', async () => {
  const rebuildDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepspider-export-'))
  const calls = []
  const source = 'globalThis.answer = 42;\n'
  const pageData = {
    source: 'patchright-session',
    mode: 'observe',
    page: { url: 'https://example.com/page', title: 'Fixture', referrer: '' },
    storage: { cookies: [], local: {}, session: {} },
    document: { html: '<!doctype html><title>Fixture</title>' },
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
    async getResponseList(site, sessionOnly) {
      calls.push(['getResponseList', site, sessionOnly])
      return [{ id: 'response-current', site: 'example.com' }]
    },
    async getResponse(site, responseId) {
      calls.push(['getResponse', site, responseId])
      return {
        url: 'https://example.com/api/data',
        method: 'GET',
        status: 200,
        responseHeaders: { 'content-type': 'application/json' },
        responseBody: '{"ok":true}',
      }
    },
  }
  const runtime = {
    dataStore: store,
    paths: { rebuild: rebuildDir },
    captures: { propertyFacts: [{ path: 'navigator.language', value: 'en-US' }] },
    async getPage() {
      return {
        url: () => 'https://example.com/page',
        title: async () => 'Fixture',
        content: async () => '<!doctype html><title>Fixture</title>',
        evaluate: async () => ({ referrer: '', local: {}, session: {} }),
        context: () => ({ cookies: async () => [] }),
      }
    },
  }
  const result = await definition('export_rebuild_bundle').execute(runtime, {
    taskId: 'fixture-task',
    scriptId: 'script-current',
    callExpression: 'window.answer',
  }, undefined)

  assert.equal(result.success, true)
  assert.deepEqual(calls, [
    ['getScriptList', null, true],
    ['getScript', 'example.com', 'script-current'],
    ['getResponseList', null, true],
    ['getResponse', 'example.com', 'response-current'],
  ])

  const taskDir = path.join(rebuildDir, 'fixture-task')
  assert.deepEqual(fs.readdirSync(taskDir).sort(), [
    'evidence',
    'manifest.json',
    'recipe.json',
    'runner.mjs',
    'runs',
    'target.original.js',
    'transforms.json',
  ])
  assert.deepEqual(fs.readdirSync(path.join(taskDir, 'evidence')).sort(), [
    'baseline.json',
    'dynamic',
    'network',
    'property-facts.json',
    'session-state.json',
  ])
  const manifest = JSON.parse(fs.readFileSync(path.join(taskDir, 'manifest.json'), 'utf8'))
  assert.equal(manifest.schemaVersion, 2)
  assert.equal(manifest.sessionId, 'session-current')
  assert.equal(manifest.scriptId, 'script-current')
  assert.equal(manifest.pageUrl, 'https://example.com/page')
  assert.equal(fs.readFileSync(path.join(taskDir, 'target.original.js'), 'utf8'), source)
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(taskDir, 'evidence', 'session-state.json'), 'utf8')), pageData)
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(taskDir, 'evidence', 'property-facts.json'), 'utf8')), runtime.captures.propertyFacts)
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(taskDir, 'evidence', 'network', 'responses.json'), 'utf8')), [{
    url: 'https://example.com/api/data',
    method: 'GET',
    requestBody: null,
    status: 200,
    headers: { 'content-type': 'application/json' },
    body: '{"ok":true}',
  }])
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(taskDir, 'transforms.json'), 'utf8')), [])
  assert.equal(result.originalImmutable, true)
  assert.equal(result.derivedTargetAllowed, true)
  assert.equal(fs.statSync(taskDir).mode & 0o777, 0o700)
  assert.equal(fs.statSync(path.join(taskDir, 'target.original.js')).mode & 0o777, 0o600)

  await assert.rejects(
    definition('export_rebuild_bundle').execute(runtime, {
    taskId: 'fixture-task',
    scriptId: 'script-current',
    callExpression: 'window.answer',
    }, undefined),
    { code: 'E_REBUILD_EXISTS' },
  )
})

test('analyzes a stored probe trace while preserving the original and allowing recorded derivatives', async () => {
  const rebuildDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepspider-trace-tool-'))
  const runDir = path.join(rebuildDir, 'fixture-task', 'runs', 'run-1')
  fs.mkdirSync(runDir, { recursive: true })
  fs.writeFileSync(path.join(runDir, 'trace.ndjson'), [
    JSON.stringify({ category: 'runtime-timeout', path: 'target.js' }),
    JSON.stringify({ category: 'source-integrity', path: 'Function.prototype.toString' }),
  ].join('\n'))
  const result = await definition('analyze_runtime_trace').execute({ paths: { rebuild: rebuildDir } }, {
    taskId: 'fixture-task',
    runId: 'run-1',
  }, undefined)

  assert.equal(result.category, 'source-integrity')
  assert.equal(result.originalImmutable, true)
  assert.equal(result.derivedTargetAllowed, true)
})

test('rejects a truncated capture instead of signing partial bytes as the target', async () => {
  const rebuildDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepspider-truncated-'))
  const runtime = {
    paths: { rebuild: rebuildDir },
    dataStore: {
      getSessionId: () => 'session-current',
      getScriptList: async () => [{
        id: 'script-truncated',
        site: 'example.com',
        sessionId: 'session-current',
        truncated: true,
      }],
      getScript: async () => 'partial source',
    },
    async getPage() { return { url: () => 'https://example.com/' } },
  }

  await assert.rejects(definition('export_rebuild_bundle').execute(runtime, {
    taskId: 'truncated-task',
    scriptId: 'script-truncated',
  }, undefined), { code: 'E_SCRIPT_TRUNCATED' })
  assert.equal(fs.existsSync(path.join(rebuildDir, 'truncated-task')), false)
})
