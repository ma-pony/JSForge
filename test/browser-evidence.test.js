import assert from 'node:assert/strict'
import test from 'node:test'

import { SessionEvidenceCollector } from '../src/browser/SessionEvidenceCollector.js'
import { ScriptInterceptor } from '../src/browser/interceptors/ScriptInterceptor.js'

function fakePage() {
  return {
    url: () => 'https://example.com/path',
    title: async () => 'Example',
    content: async () => '<!doctype html><title>Example</title>',
    context: () => ({
      cookies: async () => [{ name: 'sid', value: 'secret', domain: 'example.com' }],
    }),
    evaluate: async (script) => script.name === 'probeSnapshot'
      ? { cookie: [{ action: 'write' }], storage: [], fetch: [], xhr: [] }
      : {
          referrer: 'https://referrer.test/',
          local: { token: 'abc' },
          session: { nonce: 'xyz' },
        },
  }
}

test('Session evidence contains page state without treating its navigator as baseline truth', async () => {
  const evidence = await new SessionEvidenceCollector(fakePage()).collect()

  assert.equal(evidence.source, 'patchright-session')
  assert.equal(evidence.mode, 'observe')
  assert.deepEqual(evidence.page, {
    url: 'https://example.com/path',
    title: 'Example',
    referrer: 'https://referrer.test/',
  })
  assert.deepEqual(evidence.storage.local, { token: 'abc' })
  assert.deepEqual(evidence.storage.session, { nonce: 'xyz' })
  assert.deepEqual(evidence.storage.cookies, [
    { name: 'sid', value: 'secret', domain: 'example.com' },
  ])
  assert.deepEqual(evidence.document, {
    html: '<!doctype html><title>Example</title>',
  })
  assert.deepEqual(evidence.probe, { cookie: [{ action: 'write' }], storage: [], fetch: [], xhr: [] })
  assert.equal('navigator' in evidence, false)
})

test('ScriptInterceptor preserves a short anonymous dynamic script with its metadata', async () => {
  const saved = []
  const interceptor = new ScriptInterceptor(
    { send: async () => ({ scriptSource: 'window.x=1' }) },
    { url: () => 'https://example.com/path' },
    { saveScript: async (entry) => saved.push(entry) },
  )

  await interceptor.fetchAndSave({ scriptId: 'dynamic-1', url: '', executionContextId: 7, startLine: 2, startColumn: 3 })

  assert.equal(saved.length, 1)
  assert.deepEqual(saved[0], {
    url: saved[0].url,
    type: 'dynamic',
    source: 'window.x=1',
    truncated: false,
    sourceHash: saved[0].sourceHash,
    cdpScriptId: 'dynamic-1',
    executionContextId: 7,
    parentScriptId: null,
    parentUrl: null,
    startLine: 2,
    startColumn: 3,
    timestamp: saved[0].timestamp,
    pageUrl: 'https://example.com/path',
  })
  assert.match(saved[0].url, /^dynamic:\/\/sha256\//)
  assert.match(saved[0].sourceHash, /^[a-f0-9]{64}$/)
})
