import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { createManifest, sha256 } from '../src/rebuild/bundle.js'
import { buildProbeCode, buildRunnerCode } from '../src/rebuild/runtime-template.js'

function createBundle(options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'deepspider-runtime-'))
  const targetSource = options.targetSource || `
globalThis.nativeSource = Function.prototype.toString.call(Array.prototype.push);
globalThis.pushDescriptor = Object.getOwnPropertyDescriptor(Array.prototype, 'push');
globalThis.ownNames = Reflect.ownKeys({ answer: 42 });
globalThis.clockSample = Date.now();
(0, eval)('globalThis.dynamicValue = 7;\\n//# sourceURL=dynamic-fixture.js');
globalThis.inspectRuntime = function inspectRuntime() {
  return {
    process: typeof process,
    Buffer: typeof Buffer,
    require: typeof require,
    module: typeof module,
    global: typeof global,
    probe: typeof __dsEmit,
    aliases: window === globalThis && self === window && top === window && parent === window,
    language: navigator.language,
    dynamicValue,
  };
};
`
  const environmentSource = JSON.stringify({ navigator: { language: 'en-US' } })
  const envCode = `globalThis.window = globalThis;
globalThis.self = globalThis;
globalThis.top = globalThis;
globalThis.parent = globalThis;
globalThis.navigator = { language: 'en-US' };`
  const manifest = createManifest({
    sessionId: 'session-1',
    site: 'example.com',
    pageUrl: 'https://example.com/',
    scriptId: 'script-1',
    scriptUrl: 'https://example.com/app.js',
    targetSource,
    environmentSource,
    callExpression: options.callExpression ?? 'window.inspectRuntime()',
    createdAt: '2026-08-14T00:00:00.000Z',
  })

  fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2))
  fs.writeFileSync(path.join(directory, 'target.js'), targetSource)
  fs.writeFileSync(path.join(directory, 'environment.json'), environmentSource)
  fs.writeFileSync(path.join(directory, 'env.js'), envCode)
  fs.writeFileSync(path.join(directory, 'probe.js'), buildProbeCode())
  fs.writeFileSync(path.join(directory, 'runner.mjs'), buildRunnerCode(options.runnerOptions))
  return directory
}

function runBundle(directory, mode, options = {}) {
  return spawnSync(process.execPath, ['runner.mjs', '--mode', mode], {
    cwd: directory,
    encoding: 'utf8',
    ...options,
  })
}

test('verify mode executes the unchanged target in a realm without Node globals', () => {
  const directory = createBundle()
  const result = runBundle(directory, 'verify')

  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout), {
    process: 'undefined',
    Buffer: 'undefined',
    require: 'undefined',
    module: 'undefined',
    global: 'undefined',
    probe: 'undefined',
    aliases: true,
    language: 'en-US',
    dynamicValue: 7,
  })
  assert.doesNotMatch(buildRunnerCode(), /require\(['"]\.\/target\.js/)
})

test('runner rejects a target whose bytes no longer match the manifest', () => {
  const directory = createBundle()
  fs.appendFileSync(path.join(directory, 'target.js'), '\n// changed')

  const result = runBundle(directory, 'verify')

  assert.equal(result.status, 1)
  assert.match(result.stderr, /E_TARGET_INTEGRITY/)
})

test('probe and verify runs create separate immutable result records', () => {
  const directory = createBundle()
  const verify = runBundle(directory, 'verify')
  const probe = runBundle(directory, 'probe')

  assert.equal(verify.status, 0, verify.stderr)
  assert.equal(probe.status, 0, probe.stderr)

  const runDirectories = fs.readdirSync(path.join(directory, 'runs')).sort()
  assert.equal(runDirectories.length, 2)
  const records = runDirectories.map((runId) =>
    JSON.parse(fs.readFileSync(path.join(directory, 'runs', runId, 'result.json'), 'utf8')),
  )
  assert.deepEqual(new Set(records.map((record) => record.mode)), new Set(['probe', 'verify']))
  for (const record of records) {
    assert.equal(record.status, 'success')
    assert.equal(typeof record.targetSha256, 'string')
    assert.equal(typeof record.envSha256, 'string')
    assert.equal(typeof record.startedAt, 'string')
    assert.equal(typeof record.finishedAt, 'string')
    assert.equal(record.error, null)
  }

  const probeRecord = records.find((record) => record.mode === 'probe')
  const verifyRecord = records.find((record) => record.mode === 'verify')
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'))
  const envCodeSha256 = sha256(fs.readFileSync(path.join(directory, 'env.js')))
  const probeSha256 = sha256(fs.readFileSync(path.join(directory, 'probe.js')))
  const runnerSha256 = sha256(fs.readFileSync(path.join(directory, 'runner.mjs')))
  for (const record of records) {
    assert.equal(record.sessionId, 'session-1')
    assert.equal(record.scriptId, 'script-1')
    assert.equal(record.environmentSha256, manifest.environmentSha256)
    assert.equal(record.envSha256, envCodeSha256)
    assert.equal(record.runnerSha256, runnerSha256)
  }
  assert.equal(probeRecord.probeSha256, probeSha256)
  assert.equal(verifyRecord.probeSha256, null)
  const trace = fs.readFileSync(path.join(directory, 'runs', probeRecord.runId, 'trace.ndjson'), 'utf8')
  assert.match(trace, /"category":"node-fingerprint"/)
  assert.match(trace, /"category":"source-integrity"/)
  assert.match(trace, /"category":"environment-access"/)
  assert.match(trace, /"category":"timing-random"/)
  assert.match(trace, /"category":"dynamic-code"/)

  const dynamicFiles = fs.readdirSync(path.join(directory, 'dynamic'))
  assert.equal(dynamicFiles.length, 1)
  const dynamicSource = fs.readFileSync(path.join(directory, 'dynamic', dynamicFiles[0]), 'utf8')
  assert.equal(dynamicSource, 'globalThis.dynamicValue = 7;\n//# sourceURL=dynamic-fixture.js')
})

test('runner accepts only explicit probe and verify modes', () => {
  const directory = createBundle()
  const result = runBundle(directory, 'debug')

  assert.equal(result.status, 1)
  assert.match(result.stderr, /E_RUNTIME_MODE/)
})

test('runner bounds an entry promise that never settles and traces the timeout', () => {
  const directory = createBundle({
    targetSource: 'globalThis.waitForever = () => new Promise(() => {});\n',
    callExpression: 'window.waitForever()',
    runnerOptions: { timeoutMs: 50 },
  })
  const result = runBundle(directory, 'verify', { timeout: 1000 })

  assert.equal(result.status, 1, result.stderr)
  assert.match(result.stderr, /E_RUNTIME_TIMEOUT/)
  const runId = fs.readdirSync(path.join(directory, 'runs'))[0]
  const trace = fs.readFileSync(path.join(directory, 'runs', runId, 'trace.ndjson'), 'utf8')
  assert.match(trace, /"category":"runtime-timeout"/)
})

test('runner traces runtime exceptions before returning an error', () => {
  const directory = createBundle({
    targetSource: 'throw new TypeError("fixture failure");\n',
    callExpression: '',
  })
  const result = runBundle(directory, 'probe')

  assert.equal(result.status, 1)
  const runId = fs.readdirSync(path.join(directory, 'runs'))[0]
  const trace = fs.readFileSync(path.join(directory, 'runs', runId, 'trace.ndjson'), 'utf8')
  assert.match(trace, /"category":"runtime-exception"/)
  assert.match(trace, /fixture failure/)
})

test('runner rejects a modified dynamic source file on the next capture', () => {
  const directory = createBundle()
  const first = runBundle(directory, 'probe')
  assert.equal(first.status, 0, first.stderr)
  const dynamicFile = path.join(directory, 'dynamic', fs.readdirSync(path.join(directory, 'dynamic'))[0])
  fs.writeFileSync(dynamicFile, 'MODIFIED')

  const second = runBundle(directory, 'probe')

  assert.equal(second.status, 1)
  assert.match(second.stderr, /E_DYNAMIC_INTEGRITY/)
  assert.equal(fs.readFileSync(dynamicFile, 'utf8'), 'MODIFIED')
})

test('probe trace aggregates repeated events by category operation path and caller', () => {
  const directory = createBundle({
    targetSource: `
for (let index = 0; index < 100; index++) navigator.language;
globalThis.loopResult = true;
`,
    callExpression: 'window.loopResult',
  })
  const result = runBundle(directory, 'probe')
  assert.equal(result.status, 0, result.stderr)

  const runId = fs.readdirSync(path.join(directory, 'runs'))[0]
  const events = fs.readFileSync(path.join(directory, 'runs', runId, 'trace.ndjson'), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
  const languageEvents = events.filter((event) =>
    event.category === 'environment-access' &&
    event.operation === 'get' &&
    event.path === 'navigator.language',
  )

  assert.equal(languageEvents.length, 1)
  assert.equal(languageEvents[0].count, 100)
  assert.match(languageEvents[0].caller, /target\.js/)
})

test('probe classifies a missing browser property from a real target access', () => {
  const directory = createBundle({
    targetSource: 'globalThis.missingResult = navigator.missingFeature;\n',
    callExpression: 'window.missingResult',
  })
  const result = runBundle(directory, 'probe')
  assert.equal(result.status, 0, result.stderr)

  const runId = fs.readdirSync(path.join(directory, 'runs'))[0]
  const trace = fs.readFileSync(path.join(directory, 'runs', runId, 'trace.ndjson'), 'utf8')
  assert.match(trace, /"category":"environment-missing"/)
  assert.match(trace, /"path":"navigator\.missingFeature"/)
})
