import assert from 'node:assert/strict'
import test from 'node:test'

import { cookieOutputAdapter } from '../src/recovery/output-adapters/cookie.js'

function contract(selector = 'clearance') {
  return {
    kind: 'cookie', selector,
    request: { url: 'https://example.test/target', method: 'GET' },
    success: { status: 200 },
  }
}

test('Cookie adapter filters generated outputs and owns request injection', () => {
  const prepared = cookieOutputAdapter.prepare({
    contract: contract(),
    outputs: [
      { kind: 'cookie', name: 'clearance', value: 'generated', artifactId: 'artifact-cookie' },
      { kind: 'cookie', name: 'bad name', value: 'ignored' },
      { kind: 'header', name: 'x-token', value: 'ignored' },
    ],
    requestTemplate: {
      headers: { Accept: 'text/html', Cookie: 'captured=secret', Host: 'example.test' },
      userAgent: 'DeepSpider adapter test', strictSSL: false, timeoutMs: 3000,
    },
  })

  assert.equal(prepared.ok, true)
  assert.deepEqual(prepared.outputArtifactIds, ['artifact-cookie'])
  assert.equal(prepared.generatedOutputCount, 1)
  assert.deepEqual(prepared.generatedOutputNames, ['clearance'])
  assert.deepEqual(prepared.request, {
    headers: { Accept: 'text/html', Cookie: 'clearance=generated' },
    userAgent: 'DeepSpider adapter test',
    strictSSL: false,
    timeoutMs: 3000,
  })
})

test('Cookie adapter rejects missing, illegal, or mismatched generated outputs before transport', () => {
  for (const outputs of [
    [],
    [{ kind: 'cookie', name: '', value: 'generated' }],
    [{ kind: 'cookie', name: 'wrong', value: 'generated' }],
    [{ kind: 'cookie', name: 'clearance', value: 'bad;value' }],
  ]) {
    const prepared = cookieOutputAdapter.prepare({
      contract: contract(), outputs,
      requestTemplate: { headers: {}, userAgent: 'test', strictSSL: false, timeoutMs: 1 },
    })
    assert.equal(prepared.ok, false)
    assert.equal(prepared.failure.operation, 'validate-generated-cookie')
  }
})
