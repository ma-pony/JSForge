import assert from 'node:assert/strict'
import test from 'node:test'

import { documentChallengeEvidenceSelector } from '../src/recovery/evidence-selectors/document-challenge.js'

test('Document selector derives a Contract template from one challenged and accepted response pair', () => {
  const url = 'https://example.test/target#fragment'
  const selected = documentChallengeEvidenceSelector.select({
    url,
    graph: {
      nodes: [
        {
          id: 'challenge', kind: 'response', resourceType: 'Document',
          url: 'https://example.test/target', status: 412, method: 'GET', timestamp: 1,
          body: '<title>Challenge</title>', bodyHash: 'challenge-hash', requestHeaders: {},
        },
        {
          id: 'accepted', kind: 'response', resourceType: 'Document',
          url: 'https://example.test/target', status: 200, method: 'POST', timestamp: 2,
          body: '<title>Accepted</title>', bodyHash: 'accepted-hash',
          requestHeaders: {
            Accept: 'text/html', Cookie: 'secret=must-not-copy', Host: 'example.test',
          },
        },
      ],
    },
  })

  assert.equal(selected.sourceId, 'challenge')
  assert.deepEqual(selected.evidence, {
    challenge: { id: 'challenge', bodyHash: 'challenge-hash' },
    accepted: { id: 'accepted', bodyHash: 'accepted-hash' },
  })
  assert.deepEqual(selected.contractTemplate, {
    entryUrl: 'https://example.test/target',
    request: {
      url: 'https://example.test/target',
      method: 'POST',
      headers: { Accept: 'text/html' },
    },
    success: { status: 200, title: 'Accepted' },
  })
})

test('Document selector reports the evidence shape it requires', () => {
  assert.throws(
    () => documentChallengeEvidenceSelector.select({
      url: 'https://example.test/api',
      graph: {
        nodes: [{
          id: 'api', kind: 'response', resourceType: 'XHR',
          url: 'https://example.test/api', status: 200, timestamp: 1,
        }],
      },
    }),
    /challenge and accepted Document evidence/,
  )
})
