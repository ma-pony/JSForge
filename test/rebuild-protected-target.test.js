import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { createManifest, sha256 } from '../src/rebuild/bundle.js'
import { buildEnvCode } from '../src/env/modules/index.js'
import { buildProbeCode, buildRunnerCode } from '../src/rebuild/runtime-template.js'

const fixtureDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'rebuild')

function pageData() {
  return {
    navigator: { language: 'en-US', userAgent: 'fixture-agent' },
    screen: { width: 1440, height: 900 },
    location: {
      href: 'https://example.com/path',
      protocol: 'https:',
      host: 'example.com',
      hostname: 'example.com',
      port: '',
      pathname: '/path',
      search: '',
      hash: '',
      origin: 'https://example.com',
    },
    localStorage: {},
    sessionStorage: {},
    document: {
      cookie: '',
      URL: 'https://example.com/path',
      domain: 'example.com',
      referrer: '',
      title: 'Fixture',
    },
  }
}

function createBundle() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'deepspider-protected-'))
  const targetSource = fs.readFileSync(path.join(fixtureDirectory, 'protected-target.js'), 'utf8')
  const environmentSource = JSON.stringify(pageData())
  const manifest = createManifest({
    sessionId: 'session-protected',
    site: 'example.com',
    pageUrl: 'https://example.com/path',
    scriptId: 'script-protected',
    scriptUrl: 'https://example.com/protected.js',
    targetSource,
    environmentSource,
    callExpression: 'window.protectedResult',
    createdAt: '2026-08-14T00:00:00.000Z',
  })

  fs.mkdirSync(path.join(directory, 'patches'))
  fs.mkdirSync(path.join(directory, 'dynamic'))
  fs.mkdirSync(path.join(directory, 'runs'))
  fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2))
  fs.writeFileSync(path.join(directory, 'target.js'), targetSource)
  fs.writeFileSync(path.join(directory, 'environment.json'), environmentSource)
  fs.writeFileSync(path.join(directory, 'env.js'), buildEnvCode(pageData()))
  fs.writeFileSync(path.join(directory, 'probe.js'), buildProbeCode())
  fs.writeFileSync(path.join(directory, 'runner.mjs'), buildRunnerCode())
  return { directory, targetSha256: sha256(targetSource) }
}

function runBundle(directory, mode) {
  return spawnSync(process.execPath, ['runner.mjs', '--mode', mode], {
    cwd: directory,
    encoding: 'utf8',
  })
}

test('generic protected target stays immutable across probe and verify runs', () => {
  const { directory, targetSha256 } = createBundle()
  const verify = runBundle(directory, 'verify')
  const probe = runBundle(directory, 'probe')

  assert.equal(verify.status, 0, verify.stderr)
  assert.equal(probe.status, 0, probe.stderr)
  assert.deepEqual(JSON.parse(verify.stdout), { ok: true, failures: [], value: 17 })
  assert.deepEqual(JSON.parse(probe.stdout), { ok: true, failures: [], value: 17 })
  assert.equal(sha256(fs.readFileSync(path.join(directory, 'target.js'))), targetSha256)

  const runDirectories = fs.readdirSync(path.join(directory, 'runs'))
  const records = runDirectories.map((runId) => ({
    runId,
    result: JSON.parse(fs.readFileSync(path.join(directory, 'runs', runId, 'result.json'), 'utf8')),
  }))
  const probeRecord = records.find(({ result }) => result.mode === 'probe')
  const trace = fs.readFileSync(path.join(directory, 'runs', probeRecord.runId, 'trace.ndjson'), 'utf8')
  assert.match(trace, /"category":"node-fingerprint"/)
  assert.match(trace, /"category":"source-integrity"/)
  assert.match(trace, /"category":"dynamic-code"/)

  const dynamicSources = fs.readdirSync(path.join(directory, 'dynamic')).map((file) =>
    fs.readFileSync(path.join(directory, 'dynamic', file), 'utf8'),
  )
  assert.ok(dynamicSources.includes('globalThis.__dynamicProtectedValue = 17;'))
})
