import assert from 'node:assert/strict'
import test from 'node:test'

import { SessionEvidenceCollector } from '../src/browser/SessionEvidenceCollector.js'

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
