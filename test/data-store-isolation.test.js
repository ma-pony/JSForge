import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { DataStore } from '../src/store/DataStore.js'

test('DataStore keeps matching captures, indexes, searches, cleanup, and sessions inside its root', async (t) => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'deepspider-data-store-'))
  const rootA = path.join(temporary, 'session-a', 'data')
  const rootB = path.join(temporary, 'session-b', 'data')
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }))

  const storeA = new DataStore({ root: rootA })
  const storeB = new DataStore({ root: rootB })

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

test('DataStore requires a non-empty absolute root', () => {
  assert.throws(() => new DataStore({ root: '' }), /non-empty absolute path/)
  assert.throws(() => new DataStore({ root: 'relative/data' }), /non-empty absolute path/)
})

test('DataStore scans complete response and script files after a prefix-index miss', async (t) => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'deepspider-data-store-search-'))
  const store = new DataStore({ root: path.join(temporary, 'data') })
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

test('replay lookup matches the exact request only inside the current Session', async (t) => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'deepspider-data-store-replay-'))
  const store = new DataStore({ root: path.join(temporary, 'data') })
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
