import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { createManifest } from '../src/rebuild/bundle.js'
import { buildProbeCode, buildRunnerCode } from '../src/rebuild/runtime-template.js'

function createBundle() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'deepspider-runtime-'))
  const targetSource = `
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
    callExpression: 'window.inspectRuntime()',
    createdAt: '2026-08-14T00:00:00.000Z',
  })

  fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2))
  fs.writeFileSync(path.join(directory, 'target.js'), targetSource)
  fs.writeFileSync(path.join(directory, 'environment.json'), environmentSource)
  fs.writeFileSync(path.join(directory, 'env.js'), envCode)
  fs.writeFileSync(path.join(directory, 'probe.js'), buildProbeCode())
  fs.writeFileSync(path.join(directory, 'runner.mjs'), buildRunnerCode())
  return directory
}

function runBundle(directory, mode) {
  return spawnSync(process.execPath, ['runner.mjs', '--mode', mode], {
    cwd: directory,
    encoding: 'utf8',
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
