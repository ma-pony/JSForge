import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { SessionArtifactStore } from '../src/store/SessionArtifactStore.js'
import { buildArtifactGraph } from '../src/recovery/artifact-graph.js'

test('SessionArtifactStore keeps matching captures, indexes, searches, cleanup, and sessions inside its root', async (t) => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'deepspider-data-store-'))
  const rootA = path.join(temporary, 'session-a', 'data')
  const rootB = path.join(temporary, 'session-b', 'data')
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }))

  const storeA = new SessionArtifactStore({ root: rootA })
  const storeB = new SessionArtifactStore({ root: rootB })

  assert.equal(storeA.root, rootA)
  assert.equal(storeB.root, rootB)
  assert.equal(storeA.sitesDir, path.join(rootA, 'sites'))
  assert.equal(storeB.globalIndexPath, path.join(rootB, 'index.json'))

  const sessionA = storeA.startSession()
  const sessionB = storeB.startSession()
  assert.notEqual(sessionA, sessionB)

  const responseAData = {
    url: 'https://example.test/api/profile',
    method: 'GET',
    status: 200,
    responseBody: 'capture-only-in-session-a',
    pageUrl: 'https://example.test/app',
  }
  const responseBData = {
    ...responseAData,
    responseBody: 'capture-only-in-session-b',
  }
  const scriptAData = {
    url: 'https://example.test/assets/app.js',
    type: 'external',
    source: 'const captureOnlyInSessionA = true',
    pageUrl: 'https://example.test/app',
  }
  const scriptBData = {
    ...scriptAData,
    source: 'const captureOnlyInSessionB = true',
  }

  const [responseA, responseB] = await Promise.all([
    storeA.saveResponse(responseAData),
    storeB.saveResponse(responseBData),
  ])
  const [scriptA, scriptB] = await Promise.all([
    storeA.saveScript(scriptAData),
    storeB.saveScript(scriptBData),
  ])

  assert.equal(responseA.id, responseB.id)
  assert.equal(scriptA.id, scriptB.id)
  assert.deepEqual(storeA.getSiteList(), [{
    hostname: 'example.test', responseCount: 1, scriptCount: 1, lastAccess: storeA.getSiteList()[0].lastAccess,
  }])
  assert.deepEqual(storeB.getSiteList(), [{
    hostname: 'example.test', responseCount: 1, scriptCount: 1, lastAccess: storeB.getSiteList()[0].lastAccess,
  }])

  const indexA = await storeA.getSiteIndex('example.test')
  const indexB = await storeB.getSiteIndex('example.test')
  assert.equal(indexA.responses[0].file.startsWith(rootA), true)
  assert.equal(indexA.scripts[0].file.startsWith(rootA), true)
  assert.equal(indexB.responses[0].file.startsWith(rootB), true)
  assert.equal(indexB.scripts[0].file.startsWith(rootB), true)
  assert.equal(fs.existsSync(indexA.responses[0].file), true)
  assert.equal(fs.existsSync(indexA.scripts[0].file), true)
  assert.deepEqual(await storeA.getResponse('example.test', responseA.id), {
    url: responseAData.url,
    method: responseAData.method,
    status: responseAData.status,
    responseBody: responseAData.responseBody,
    pageUrl: responseAData.pageUrl,
  })
  assert.deepEqual(await storeB.getResponse('example.test', responseB.id), {
    url: responseBData.url,
    method: responseBData.method,
    status: responseBData.status,
    responseBody: responseBData.responseBody,
    pageUrl: responseBData.pageUrl,
  })
  assert.equal(await storeA.getScript('example.test', scriptA.id), scriptAData.source)
  assert.equal(await storeB.getScript('example.test', scriptB.id), scriptBData.source)

  assert.deepEqual(await storeA.searchInResponses('capture-only-in-session-a'), [{
    site: 'example.test',
    id: responseA.id,
    url: responseAData.url,
    path: 'app',
    method: responseAData.method,
    status: responseAData.status,
    timestamp: indexA.responses[0].timestamp,
  }])
  assert.deepEqual(await storeB.searchInScripts('captureonlyinsessionb'), [{
    site: 'example.test',
    id: scriptB.id,
    url: scriptBData.url,
    type: scriptBData.type,
    matchIndex: 6,
    context: scriptBData.source,
    timestamp: indexB.scripts[0].timestamp,
  }])
  assert.deepEqual(await storeA.searchInResponses('capture-only-in-session-b'), [])
  assert.deepEqual(await storeB.searchInScripts('captureonlyinsessiona'), [])
  assert.deepEqual(await storeA.getResponseList(null, true).then((items) => items.map((item) => item.sessionId)), [sessionA])
  assert.deepEqual(await storeB.getScriptList(null, true).then((items) => items.map((item) => item.sessionId)), [sessionB])

  await storeA.clearSite('example.test')
  assert.deepEqual(storeA.getSiteList(), [])
  assert.equal(fs.existsSync(indexA.responses[0].file), false)
  assert.deepEqual((await storeB.getResponseList()).map((item) => item.id), [responseB.id])
  assert.equal(fs.existsSync(indexB.responses[0].file), true)
})

test('SessionArtifactStore requires a non-empty absolute root', () => {
  assert.throws(() => new SessionArtifactStore({ root: '' }), /non-empty absolute path/)
  assert.throws(() => new SessionArtifactStore({ root: 'relative/data' }), /non-empty absolute path/)
})

test('SessionArtifactStore scans complete response and script files after a prefix-index miss', async (t) => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'deepspider-data-store-search-'))
  const store = new SessionArtifactStore({ root: path.join(temporary, 'data') })
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }))

  store.startSession()
  const prefix = 'x'.repeat(1200)
  const response = await store.saveResponse({
    url: 'https://search.test/api/data',
    method: 'POST',
    status: 200,
    responseBody: `${prefix} ResponseSuffixNeedle`,
    pageUrl: 'https://search.test/app',
  })
  const script = await store.saveScript({
    url: 'https://search.test/assets/app.js',
    type: 'external',
    source: `${prefix} const MixedCaseScriptNeedle = true`,
    pageUrl: 'https://search.test/app',
  })

  assert.deepEqual(
    (await store.searchInResponses('responsesuffixneedle')).map(({ id }) => id),
    [response.id],
  )
  const matches = await store.searchInScripts('mixedcasescriptneedle')
  assert.equal(matches.length, 1)
  assert.equal(matches[0].id, script.id)
  assert.equal(matches[0].matchIndex, prefix.length + ' const '.length)
  assert.match(matches[0].context, /MixedCaseScriptNeedle/)
})

test('repeated script captures keep immutable occurrences while sharing one source blob', async (t) => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'deepspider-script-occurrences-'))
  const store = new SessionArtifactStore({ root: path.join(temporary, 'evidence') })
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }))
  const sessionId = store.startSession()
  const source = 'window.dynamicRepeat = true'
  const now = Date.now()
  const first = await store.saveScript({
    url: 'https://repeat.test/app.js', type: 'external', source,
    timestamp: now, pageUrl: 'https://repeat.test/first', cdpScriptId: 'script-1',
    sourceHash: 'source-one', executionContextId: 1, startLine: 10, startColumn: 11,
    parentScriptId: 'parent-1', parentUrl: 'https://repeat.test/parent-1.js',
  })
  const firstIndex = await store.getSiteIndex('repeat.test')
  const firstOccurrence = JSON.parse(JSON.stringify(firstIndex.scripts[0]))
  const second = await store.saveScript({
    url: 'https://repeat.test/app.js', type: 'dynamic', source,
    timestamp: now + 1, pageUrl: 'https://repeat.test/second', cdpScriptId: 'script-2',
    sourceHash: 'source-two', executionContextId: 2, startLine: 20, startColumn: 21,
    parentScriptId: 'parent-2', parentUrl: 'https://repeat.test/parent-2.js',
  })

  const index = await store.getSiteIndex('repeat.test')
  assert.notEqual(first.id, second.id)
  assert.equal(index.scripts.length, 2)
  assert.deepEqual(index.scripts[0], firstOccurrence)
  assert.equal(index.scripts[0].sessionId, sessionId)
  assert.equal(index.scripts[1].sessionId, sessionId)
  assert.equal(index.scripts[0].parentScriptId, 'parent-1')
  assert.equal(index.scripts[1].parentScriptId, 'parent-2')
  assert.equal(index.scripts[0].file, index.scripts[1].file)
  assert.equal(await store.getScript('repeat.test', first.id), source)
  assert.equal(await store.getScript('repeat.test', second.id), source)
  assert.equal((await store.searchInScripts('dynamicrepeat', 'repeat.test')).length, 2)
  assert.equal(store.getSiteList()[0].scriptCount, 2)

  const graph = await buildArtifactGraph({ store, sessionId })
  const scriptNodes = graph.nodes.filter(({ kind }) => kind === 'script')
  assert.equal(scriptNodes.length, 2)
  assert.deepEqual(scriptNodes.map(({ parentScriptId }) => parentScriptId), ['parent-1', 'parent-2'])
})

test('script occurrence IDs remain unique after cleanup removes an earlier capture', async (t) => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'deepspider-script-sequence-'))
  const store = new SessionArtifactStore({ root: path.join(temporary, 'evidence') })
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }))
  const sessionId = store.startSession()
  const now = Date.now()
  const capture = (number) => store.saveScript({
    url: 'https://sequence.test/app.js', type: 'dynamic', source: 'window.sameBlob = true',
    timestamp: now + number, pageUrl: `https://sequence.test/page-${number}`,
    cdpScriptId: `script-${number}`, parentScriptId: `parent-${number}`,
  })
  const first = await capture(1)
  const second = await capture(2)
  const third = await capture(3)
  const beforeCleanup = await store.getSiteIndex('sequence.test')
  const retained = beforeCleanup.scripts.slice(1).map((entry) => JSON.parse(JSON.stringify(entry)))
  delete beforeCleanup.nextScriptSequence
  await store.saveSiteIndex('sequence.test')
  store.siteIndexCache.delete('sequence.test')
  const migratedIndex = await store.getSiteIndex('sequence.test')
  assert.equal(migratedIndex.nextScriptSequence, 3)
  migratedIndex.scripts[0].timestamp = now - (8 * 24 * 60 * 60 * 1000)
  await store.saveSiteIndex('sequence.test')
  await store.cleanupExpired(now)
  const fourth = await capture(4)

  const historicalIds = [first.id, second.id, third.id, fourth.id]
  const index = await store.getSiteIndex('sequence.test')
  assert.equal(new Set(historicalIds).size, 4)
  assert.equal(index.scripts.length, 3)
  assert.equal(new Set(index.scripts.map(({ id }) => id)).size, 3)
  assert.deepEqual(index.scripts.slice(0, 2), retained)
  assert.equal(index.scripts[2].cdpScriptId, 'script-4')
  assert.equal(new Set(index.scripts.map(({ file }) => file)).size, 1)
  assert.equal((await store.searchInScripts('sameblob', 'sequence.test')).length, 3)

  const graph = await buildArtifactGraph({ store, sessionId })
  const scriptNodes = graph.nodes.filter(({ kind }) => kind === 'script')
  assert.equal(scriptNodes.length, 3)
  assert.equal(new Set(scriptNodes.map(({ id }) => id)).size, 3)
  assert.deepEqual(scriptNodes.map(({ parentScriptId }) => parentScriptId), ['parent-2', 'parent-3', 'parent-4'])
})

test('replay lookup matches the exact request only inside the current Session', async (t) => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'deepspider-data-store-replay-'))
  const store = new SessionArtifactStore({ root: path.join(temporary, 'data') })
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }))

  store.startSession()
  await store.saveResponse({
    url: 'https://example.test/api/data?b=2&a=1',
    method: 'post',
    status: 201,
    requestBody: 'a=1',
    responseHeaders: { 'content-type': 'application/json' },
    responseBody: '{"ok":true}',
    pageUrl: 'https://example.test/app',
  })

  assert.deepEqual(await store.findReplayResponse({
    url: 'https://example.test/api/data?b=2&a=1',
    method: 'POST',
    body: 'a=1',
  }), {
    url: 'https://example.test/api/data?b=2&a=1',
    method: 'POST',
    requestBody: 'a=1',
    status: 201,
    headers: { 'content-type': 'application/json' },
    body: '{"ok":true}',
  })
  assert.equal(await store.findReplayResponse({
    url: 'https://example.test/api/data?b=2&a=1', method: 'POST', body: 'a=2',
  }), null)

  store.startSession()
  assert.equal(await store.findReplayResponse({
    url: 'https://example.test/api/data?b=2&a=1', method: 'POST', body: 'a=1',
  }), null)

  await store.saveResponse({
    url: 'https://example.test/api/data?b=2&a=1',
    method: 'POST',
    status: 202,
    requestBody: 'a=1',
    responseHeaders: { 'x-session': 'new' },
    responseBody: 'new-session-response',
    pageUrl: 'https://example.test/app',
  })
  const current = await store.findReplayResponse({
    url: 'https://example.test/api/data?b=2&a=1', method: 'POST', body: 'a=1',
  })
  assert.equal(current.status, 202)
  assert.equal(current.body, 'new-session-response')
  assert.deepEqual(current.headers, { 'x-session': 'new' })
})

test('SessionArtifactStore stores immutable artifact metadata and rejects unsourced derivatives', async (t) => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'deepspider-artifact-store-'))
  const store = new SessionArtifactStore({ root: path.join(temporary, 'evidence') })
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }))

  const capture = await store.saveArtifact({
    kind: 'document', origin: 'capture', url: 'https://example.test/', content: '<html/>', metadata: { title: 'Example' },
  })
  const derived = await store.saveArtifact({
    kind: 'output-contract', origin: 'derived', sourceId: capture.id, content: '{"kind":"cookie"}', metadata: {},
  })

  assert.equal(capture.sha256.length, 64)
  assert.deepEqual(await store.getArtifact(derived.id), {
    ...derived,
    content: '{"kind":"cookie"}',
  })
  assert.deepEqual((await store.listArtifacts({ kind: 'document', origin: 'capture' })).map(({ id }) => id), [capture.id])
  await assert.rejects(
    store.saveArtifact({ kind: 'runtime-recipe', origin: 'derived', content: '{}', metadata: {} }),
    /sourceId/,
  )
})

test('SessionArtifactStore serializes concurrent Artifact saves and reopens their complete index', async (t) => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'deepspider-artifact-concurrency-'))
  const root = path.join(temporary, 'evidence')
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }))

  const store = new SessionArtifactStore({ root })
  await Promise.all(Array.from({ length: 30 }, (_, index) => store.saveArtifact({
    kind: 'document', origin: 'capture', content: `artifact-${index}`, metadata: { index },
  })))

  const reopened = new SessionArtifactStore({ root })
  assert.equal((await reopened.listArtifacts()).length, 30)
})

test('artifact graph links Session-derived runtime artifacts without source content', async (t) => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'deepspider-artifact-graph-'))
  const store = new SessionArtifactStore({ root: path.join(temporary, 'evidence') })
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }))

  const contract = await store.saveArtifact({ kind: 'output-contract', origin: 'capture', content: '{}', metadata: {} })
  const recipe = await store.saveArtifact({ kind: 'runtime-recipe', origin: 'derived', sourceId: contract.id, content: '{}', metadata: {} })
  const run = await store.saveArtifact({ kind: 'runtime-run', origin: 'derived', sourceId: contract.id, content: '{}', metadata: {} })
  const output = await store.saveArtifact({ kind: 'generated-output', origin: 'derived', sourceId: run.id, content: '{}', metadata: {} })
  const validation = await store.saveArtifact({ kind: 'validation', origin: 'derived', sourceId: output.id, content: '{}', metadata: {} })
  const solver = await store.saveArtifact({ kind: 'solver', origin: 'derived', sourceId: validation.id, content: '{}', metadata: {} })

  const graph = await buildArtifactGraph({ store })
  assert.deepEqual(new Set(graph.nodes.map(({ kind }) => kind)), new Set([
    'output-contract', 'runtime-recipe', 'runtime-run', 'generated-output', 'validation', 'solver',
  ]))
  assert.deepEqual(new Set(graph.edges.map(({ relation }) => relation)), new Set(['derived-from']))
  assert.equal(graph.nodes.find(({ id }) => id === solver.id).content, undefined)
  assert.equal(recipe.sha256.length, 64)
})

test('response identity preserves each Session Cookie evidence without overwriting the first capture', async (t) => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'deepspider-immutable-capture-'))
  const store = new SessionArtifactStore({ root: path.join(temporary, 'evidence') })
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }))

  store.startSession()
  const first = await store.saveResponse({
    url: 'https://example.test/api', method: 'GET', status: 200,
    requestHeaders: { 'x-evidence': 'first' }, associatedCookies: [{ name: 'sid', value: 'a' }],
    responseBody: 'same body', pageUrl: 'https://example.test/',
  })
  store.startSession()
  const second = await store.saveResponse({
    url: 'https://example.test/api', method: 'GET', status: 200,
    requestHeaders: { 'x-evidence': 'second' }, associatedCookies: [{ name: 'sid', value: 'b' }],
    responseBody: 'same body', pageUrl: 'https://example.test/',
  })

  assert.deepEqual((await store.getResponse('example.test', second.id)).associatedCookies, [{ name: 'sid', value: 'b' }])
  assert.deepEqual((await store.getResponse('example.test', first.id)).associatedCookies, [{ name: 'sid', value: 'a' }])
})

test('response deduplication keeps the first same-Session capture immutable', async (t) => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'deepspider-immutable-capture-'))
  const store = new SessionArtifactStore({ root: path.join(temporary, 'evidence') })
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }))

  store.startSession()
  const first = await store.saveResponse({
    url: 'https://example.test/api', method: 'GET', status: 200,
    requestHeaders: { 'x-evidence': 'first' }, responseBody: 'same body', pageUrl: 'https://example.test/',
  })
  await store.saveResponse({
    url: 'https://example.test/api', method: 'GET', status: 200,
    requestHeaders: { 'x-evidence': 'later' }, responseBody: 'same body', pageUrl: 'https://example.test/',
  })

  assert.deepEqual((await store.getResponse('example.test', first.id)).requestHeaders, { 'x-evidence': 'first' })
})
