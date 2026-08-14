import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createManifest,
  selectCurrentSessionScript,
  sha256,
  validateCallExpression,
  validateTaskId,
} from '../src/rebuild/bundle.js'

test('selects only the exact script from the current capture session', () => {
  const scripts = [
    { id: 'script-a', site: 'example.com', url: 'https://example.com/a.js', sessionId: 'old' },
    { id: 'script-a', site: 'example.com', url: 'https://example.com/a.js', sessionId: 'current' },
    { id: 'script-b', site: 'example.com', url: 'https://example.com/a.js', sessionId: 'current' },
  ]

  const selected = selectCurrentSessionScript(scripts, 'script-a', 'current')

  assert.equal(selected.sessionId, 'current')
  assert.equal(selected.id, 'script-a')
})

test('rejects scripts that are absent from the current capture session', () => {
  const scripts = [
    { id: 'script-a', site: 'example.com', url: 'https://example.com/a.js', sessionId: 'old' },
  ]

  assert.throws(
    () => selectCurrentSessionScript(scripts, 'script-a', 'current'),
    (error) => error.code === 'E_SCRIPT_SESSION' && /current session/.test(error.message),
  )
})

test('creates a deterministic immutable manifest', () => {
  const targetSource = 'globalThis.answer = 42;\n'
  const environmentSource = '{"navigator":{"language":"en-US"}}'

  const manifest = createManifest({
    sessionId: 'session-1',
    site: 'example.com',
    pageUrl: 'https://example.com/page',
    scriptId: 'script-1',
    scriptUrl: 'https://example.com/app.js',
    targetSource,
    environmentSource,
    callExpression: 'window.answer',
    createdAt: '2026-08-14T00:00:00.000Z',
  })

  assert.deepEqual(manifest, {
    schemaVersion: 1,
    sessionId: 'session-1',
    site: 'example.com',
    pageUrl: 'https://example.com/page',
    scriptId: 'script-1',
    scriptUrl: 'https://example.com/app.js',
    targetSha256: sha256(targetSource),
    targetBytes: Buffer.byteLength(targetSource),
    environmentSha256: sha256(environmentSource),
    callExpression: 'window.answer',
    createdAt: '2026-08-14T00:00:00.000Z',
  })
  assert.equal(sha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
})

test('validates task IDs and entry expressions through production helpers', () => {
  assert.equal(validateTaskId('runtime_1.v2').ok, true)
  assert.equal(validateTaskId('.git').ok, false)
  assert.equal(validateTaskId('../runtime').ok, false)
  assert.equal(validateCallExpression('window.generate(1)').ok, true)
  assert.equal(validateCallExpression('process.exit(1)').ok, false)
  assert.equal(validateCallExpression('window.a();window.b()').ok, false)
})
