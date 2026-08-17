import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

import { chromium } from 'patchright'

import { deepSpiderCatalog } from '../../src/tools/index.js'

const PROJECT_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const PROBE_PLUGIN = fileURLToPath(new URL('../fixtures/dsh/host-probe-plugin.js', import.meta.url))
const PATCHRIGHT_BROWSER_CACHE = findBrowserCache(chromium.executablePath())
const DEEPSPIDER_NAMES = deepSpiderCatalog.map(({ name }) => name)
const ENABLED_TOOLS = [
  'get_goal',
  'create_goal',
  'update_goal',
  'todo_write',
  'bash',
  'read',
  'write',
  'edit',
  'glob',
  'grep',
  'job_output',
  'job_list',
  'job_kill',
  'ask_user_question',
  'skill',
  'web_search',
  'cordis_inspect_list',
]
const DISABLED_TOOLS = ['web_fetch', 'subagent', 'workflow', 'ralph', 'evolve_skill']

test('real DSH Web boots the Spider Preset with native Code Mode capabilities', {
  timeout: 60000,
}, async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'deepspider-dsh-smoke-'))
  const home = path.join(tempRoot, 'home')
  const dshHome = path.join(tempRoot, 'dsh-home')
  const output = path.join(tempRoot, 'probe.jsonl')
  const sessionIds = [randomUUID(), randomUUID()]
  const target = await startTargetServer()
  fs.mkdirSync(home, { recursive: true })
  fs.mkdirSync(dshHome, { recursive: true })
  fs.writeFileSync(output, '')
  writeProbePatch(dshHome)

  const child = spawn(process.execPath, ['bin/cli.js', 'agent', '--port', '0'], {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      HOME: home,
      DSH_HOME: dshHome,
      DEEPSPIDER_HEADLESS: 'true',
      DEEPSPIDER_TEST_CWD: PROJECT_ROOT,
      DEEPSPIDER_TEST_PROBE_MODE: 'smoke',
      DEEPSPIDER_TEST_PROBE_OUTPUT: output,
      DEEPSPIDER_TEST_SESSION_A: sessionIds[0],
      DEEPSPIDER_TEST_SESSION_B: sessionIds[1],
      DEEPSPIDER_TEST_TARGET_URL: target.url,
      PLAYWRIGHT_BROWSERS_PATH: PATCHRIGHT_BROWSER_CACHE,
      NO_PROXY: '127.0.0.1,localhost',
      no_proxy: '127.0.0.1,localhost',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const processOutput = captureOutput(child)

  try {
    const [webUrl, ready] = await Promise.all([
      waitForWebUrl(child, processOutput, 30000),
      waitForCheckpoint(output, 'ready', 30000),
    ])
    await waitForHttp(webUrl, child, processOutput, 15000)

    assert.deepEqual(ready.agents.map(({ id }) => id), sessionIds)
    assert.deepEqual(ready.agents.map(({ preset }) => preset), ['spider', 'spider'])
    assert.deepEqual(ready.rootAgentIds.sort(), [...sessionIds].sort())
    assert.equal(DEEPSPIDER_NAMES.length, 51)
    assert.equal(new Set(DEEPSPIDER_NAMES).size, 51)
    assert.deepEqual(ready.registry.modelToolNames, ['run_code'])
    assert.equal(ready.registry.assembledSectionNames.includes('tools:sdk'), true)
    assert.equal(typeof ready.registry.sdkSectionText, 'string')
    const assembledDeepSpiderNames = DEEPSPIDER_NAMES.filter((name) => (
      new RegExp(`(^|\\W)${name}(?=\\W|$)`).test(ready.registry.sdkSectionText)
    ))
    assert.deepEqual(assembledDeepSpiderNames, DEEPSPIDER_NAMES)
    assert.match(ready.navigation.url, /\/smoke$/)
    assert.equal(ready.cordisInspectProviderIds.includes('Service'), true)
    assert.equal(ready.cordisInspectProviderIds.includes('Tool'), true)
    assert.equal(ready.directNativeBlocked, true)
    assert.equal(ready.registry.compactionPresent, true, processOutput.text())
    for (const name of ENABLED_TOOLS) assert.equal(ready.registry.enabled[name], true, name)
    for (const name of DISABLED_TOOLS) assert.equal(ready.registry.disabled[name], false, name)

    child.kill('SIGTERM')
    const exit = await waitForExit(child, 15000)
    assert.equal(exit.code, 143, processOutput.text())
    assert.equal(exit.signal, null, processOutput.text())
  } finally {
    await stopChild(child)
    await target.close()
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
})

async function startTargetServer() {
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end('<!doctype html><title>DSH Smoke</title>')
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  return {
    url: `http://127.0.0.1:${address.port}/smoke`,
    close: () => new Promise((resolve, reject) => server.close((error) => (
      error ? reject(error) : resolve()
    ))),
  }
}

function writeProbePatch(dshHome) {
  fs.writeFileSync(
    path.join(dshHome, 'cordis.patch.yml'),
    `- insert:\n    - id: deepspider-test-host-probe\n      name: ${JSON.stringify(PROBE_PLUGIN)}\n`,
  )
}

function captureOutput(child) {
  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (chunk) => { stdout += chunk })
  child.stderr.on('data', (chunk) => { stderr += chunk })
  return {
    stdout: () => stdout,
    text: () => `stdout:\n${stdout}\nstderr:\n${stderr}`,
  }
}

function waitForWebUrl(child, output, timeout) {
  return new Promise((resolve, reject) => {
    const inspect = () => {
      const match = output.stdout().match(/dsh web: (http:\/\/127\.0\.0\.1:\d+)/)
      if (match) finish(resolve, match[1])
    }
    const onExit = (code, signal) => finish(
      reject,
      new Error(`DSH Web exited before listening (${code ?? signal})\n${output.text()}`),
    )
    const finish = (callback, value) => {
      clearTimeout(timer)
      child.stdout.removeListener('data', inspect)
      child.removeListener('exit', onExit)
      callback(value)
    }
    const timer = setTimeout(
      () => finish(reject, new Error(`timed out waiting for DSH Web\n${output.text()}`)),
      timeout,
    )
    child.stdout.on('data', inspect)
    child.once('exit', onExit)
    inspect()
  })
}

function waitForCheckpoint(file, phase, timeout) {
  return new Promise((resolve, reject) => {
    const inspect = () => {
      const rows = fs.readFileSync(file, 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line))
      const failure = rows.find((row) => row.phase === 'error')
      if (failure) return finish(reject, new Error(failure.error))
      const found = rows.find((row) => row.phase === phase)
      if (found) finish(resolve, found)
    }
    const finish = (callback, value) => {
      clearTimeout(timer)
      watcher.close()
      callback(value)
    }
    const watcher = fs.watch(file, inspect)
    const timer = setTimeout(
      () => finish(reject, new Error(`timed out waiting for probe checkpoint ${phase}`)),
      timeout,
    )
    inspect()
  })
}

async function waitForHttp(url, child, output, timeout) {
  const deadline = Date.now() + timeout
  let lastError
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`DSH Web exited before HTTP readiness\n${output.text()}`)
    }
    try {
      const response = await fetch(url)
      if (response.ok) return
      lastError = new Error(`HTTP ${response.status}`)
    } catch (error) {
      lastError = error
    }
    await delay(25)
  }
  throw new Error(`DSH Web HTTP readiness failed: ${lastError}\n${output.text()}`)
}

function waitForExit(child, timeout) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode })
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.removeListener('exit', onExit)
      reject(new Error(`timed out waiting for process ${child.pid} to exit`))
    }, timeout)
    const onExit = (code, signal) => {
      clearTimeout(timer)
      resolve({ code, signal })
    }
    child.once('exit', onExit)
  })
}

async function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return
  child.kill('SIGTERM')
  try {
    await waitForExit(child, 10000)
  } catch {
    child.kill('SIGKILL')
    await waitForExit(child, 5000).catch(() => {})
  }
}

function findBrowserCache(executablePath) {
  let current = executablePath
  while (path.dirname(current) !== current) {
    if (/^chromium-\d+$/.test(path.basename(current))) return path.dirname(current)
    current = path.dirname(current)
  }
  throw new Error(`Unable to locate Patchright browser cache from ${executablePath}`)
}
