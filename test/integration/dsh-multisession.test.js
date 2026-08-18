import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { execFileSync, spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

import { chromium } from 'patchright'

const PROJECT_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const PROBE_PLUGIN = fileURLToPath(new URL('../fixtures/dsh/host-probe-plugin.js', import.meta.url))
const PATCHRIGHT_BROWSER_EXECUTABLE = chromium.executablePath()
const PATCHRIGHT_BROWSER_CACHE = findBrowserCache(PATCHRIGHT_BROWSER_EXECUTABLE)

test('two real DSH Sessions isolate browser state, dispose exactly, and shut Chromium down', {
  timeout: 120000,
}, async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'deepspider-dsh-multisession-'))
  const home = path.join(tempRoot, 'home')
  const dshHome = path.join(tempRoot, 'dsh-home')
  const output = path.join(tempRoot, 'probe.jsonl')
  const continueFile = path.join(tempRoot, 'continue')
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
      DEEPSPIDER_TEST_PROBE_MODE: 'multisession',
      DEEPSPIDER_TEST_PROBE_OUTPUT: output,
      DEEPSPIDER_TEST_PROBE_CONTINUE: continueFile,
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
    const [webUrl, navigated] = await Promise.all([
      waitForWebUrl(child, processOutput, 60000),
      waitForCheckpoint(output, 'navigated', 60000),
    ])
    await waitForHttp(webUrl, child, processOutput, 15000)

    assert.deepEqual(navigated.agents.map(({ id }) => id), sessionIds)
    assert.deepEqual(navigated.agents.map(({ preset }) => preset), ['spider', 'spider'])
    assert.deepEqual(navigated.registry.modelToolNames, ['run_code'])
    assert.match(navigated.navigation.a.url, /session=A$/)
    assert.match(navigated.navigation.b.url, /session=B$/)
    assert.equal(navigated.concurrency.sameSessionSerialized, true)
    assert.equal(navigated.concurrency.differentSessionsOverlapped, true)
    assertDistinctPair(navigated.isolation.runtimeIds, 'Runtime')
    assertDistinctPair(navigated.isolation.dataStoreIds, 'DataStore')
    assertDistinctPair(navigated.isolation.browserIds, 'BrowserClient')
    assertDistinctPair(navigated.isolation.roots, 'Session root')
    assertDistinctPair(navigated.isolation.dataRoots, 'DataStore root')
    assertDistinctPair(navigated.isolation.browserDataRoots, 'browser-data root')
    assertRecoveryResult(navigated.isolation.recovery)
    assert.doesNotMatch(JSON.stringify(navigated.isolation.recovery), /DSH_SESSION_SECRET|rawTrace|private\/tmp/)

    const firstSnapshot = descendantProcesses(child.pid)
    const firstChromium = firstSnapshot.filter(isChromium)
    const firstMainA = browserProcessFor(firstChromium, navigated.isolation.browserDataRoots[0])
    const firstMainB = browserProcessFor(firstChromium, navigated.isolation.browserDataRoots[1])
    assert.ok(firstMainA, `missing Session A Chromium\n${formatProcesses(firstSnapshot)}`)
    assert.ok(firstMainB, `missing Session B Chromium\n${formatProcesses(firstSnapshot)}`)
    assert.notEqual(firstMainA.pid, firstMainB.pid)
    const firstAChromiumPids = processSubtree(firstMainA.pid, firstSnapshot)
      .filter(isChromium)
      .map(({ pid }) => pid)
    assert.ok(firstAChromiumPids.length > 0)

    fs.writeFileSync(continueFile, 'continue')
    const complete = await waitForCheckpoint(output, 'complete', 60000)
    assert.equal(complete.disposal.removedA, true)
    assert.equal(complete.disposal.keptB, true)
    assert.notEqual(complete.resume.oldRuntimeId, complete.resume.newRuntimeId)
    assert.notEqual(complete.resume.oldBrowserId, complete.resume.newBrowserId)
    assert.notEqual(complete.resume.oldDataStoreId, complete.resume.newDataStoreId)
    assert.equal(complete.resume.oldRoot, complete.resume.newRoot)
    assert.equal(complete.resume.browserDataRoot, navigated.isolation.browserDataRoots[0])
    assert.match(complete.navigation.survivingB.url, /session=B$/)
    assert.match(complete.navigation.resumedA.url, /session=A-resumed$/)

    await waitForCondition(
      () => firstAChromiumPids.every((pid) => !pidExists(pid)),
      30000,
      `old Session A Chromium PIDs to exit: ${firstAChromiumPids.join(', ')}`,
    )
    const resumedSnapshot = descendantProcesses(child.pid)
    const resumedChromium = resumedSnapshot.filter(isChromium)
    const resumedMainA = browserProcessFor(resumedChromium, complete.resume.browserDataRoot)
    const resumedMainB = browserProcessFor(resumedChromium, navigated.isolation.browserDataRoots[1])
    assert.ok(resumedMainA, `missing resumed Session A Chromium\n${formatProcesses(resumedSnapshot)}`)
    assert.ok(resumedMainB, `missing Session B Chromium\n${formatProcesses(resumedSnapshot)}`)
    assert.notEqual(resumedMainA.pid, firstMainA.pid)
    assert.equal(resumedMainB.pid, firstMainB.pid)

    const shutdownChromiumPids = resumedChromium.map(({ pid }) => pid)
    assert.ok(shutdownChromiumPids.length > 0)
    const hostDisposal = waitForCheckpointBeforeExit(
      output,
      'host-disposed',
      child,
      shutdownChromiumPids,
      processOutput,
      30000,
    )
    assert.equal(child.kill('SIGTERM'), true)
    const disposed = await hostDisposal
    assert.deepEqual(disposed.remainingRuntimeIds, [])
    await waitForPidsGoneBeforeExit(
      child,
      shutdownChromiumPids,
      processOutput,
      30000,
    )
    const exit = await waitForExit(child, 30000)
    assert.equal(exit.code, 143, processOutput.text())
    assert.equal(exit.signal, null, processOutput.text())
  } finally {
    await stopChild(child)
    await target.close()
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
})

function assertDistinctPair(values, label) {
  assert.equal(values.length, 2, label)
  assert.notEqual(values[0], values[1], label)
}

function assertRecoveryResult(recovery) {
  assert.deepEqual(recovery.modelResult.stages, {
    browserEvidence: 'complete',
    artifactGraph: 'complete',
    nodeGeneration: 'complete',
    requestValidation: 'complete',
  })
  assert.deepEqual(recovery.modelResult.evidenceLevels, {
    browser: 'observed', node: 'reproduced', request: 'reproduced',
  })
  assert.equal(recovery.modelResult.strategy, 'semantic-runtime')
  assert.equal(recovery.modelResult.blocker, null)
  assert.match(recovery.modelResult.solverId, /^artifact-[a-f0-9]{64}$/)
  assert.equal(recovery.modelResult.nextAction, null)
  assert.deepEqual(recovery.dialogEvents.map(({ payload }) => payload.type), [
    'recovery/progress', 'recovery/progress', 'recovery/result',
  ])
  assert.equal(recovery.dialogEvents.every(({ delivered }) => delivered === true), true)
  assert.equal(recovery.sessionARecoveryRuntime, true)
  assert.equal(recovery.sessionBRecoveryRuntime, false)
  assert.equal(recovery.sessionAArtifactKinds.includes('runtime-run'), true)
  assert.equal(recovery.sessionAArtifactKinds.includes('validation'), true)
  assert.equal(recovery.sessionAArtifactKinds.includes('solver'), true)
  assert.deepEqual(recovery.sessionBArtifactKinds, [])
}

async function startTargetServer() {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1')
    const session = url.searchParams.get('session') || 'unknown'
    const challengeName = `dsh_challenge_${session}`
    const challengeValue = `DSH_SESSION_SECRET_${session}`
    const accepted = String(request.headers.cookie || '').split(/;\s*/).includes(
      `${challengeName}=${challengeValue}`,
    )
    if (url.pathname === '/acceptance' && !accepted) {
      response.writeHead(412, { 'content-type': 'text/html; charset=utf-8' })
      response.end([
        '<!doctype html><title>DSH Local Challenge</title>',
        '<script>',
        `document.cookie = ${JSON.stringify(`${challengeName}=${challengeValue}; Path=/`)};`,
        'location.replace(location.href);',
        '</script>',
      ].join(''))
      return
    }
    if (url.pathname === '/native-artifact.js') {
      response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' })
      response.end([
        `globalThis.__nativeAcceptance = ${JSON.stringify(`native-session-${session}`)};`,
        `document.documentElement.dataset.nativeSession = ${JSON.stringify(session)};`,
      ].join('\n'))
      return
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end([
      '<!doctype html><title>DSH Native Acceptance</title>',
      `<p>${request.url}</p>`,
      `<script src="/native-artifact.js?session=${encodeURIComponent(session)}"></script>`,
    ].join(''))
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  return {
    url: `http://127.0.0.1:${address.port}/acceptance`,
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

function waitForCheckpointBeforeExit(file, phase, child, pids, output, timeout) {
  return new Promise((resolve, reject) => {
    let settled = false
    const readCheckpoint = () => {
      const rows = fs.readFileSync(file, 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line))
      const failure = rows.find((row) => row.phase === 'error')
      if (failure) return { failure }
      return { found: rows.find((row) => row.phase === phase) }
    }
    const inspect = () => {
      const { failure, found } = readCheckpoint()
      if (failure) return finish(reject, new Error(failure.error))
      if (found) finish(resolve, found)
    }
    const onExit = (code, signal) => {
      const { failure, found } = readCheckpoint()
      if (failure) return finish(reject, new Error(failure.error))
      const alive = pids.filter(pidExists)
      if (found && alive.length === 0) return finish(resolve, found)
      finish(reject, new Error([
        `DSH CLI exited (${code ?? signal}) before ${phase} completed`,
        `checkpoint seen: ${Boolean(found)}`,
        `Chromium PIDs still alive: ${alive.join(', ') || 'none'}`,
        output.text(),
      ].join('\n')))
    }
    const finish = (callback, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      watcher.close()
      child.removeListener('exit', onExit)
      callback(value)
    }
    const watcher = fs.watch(file, inspect)
    const timer = setTimeout(
      () => finish(reject, new Error(`timed out waiting for ${phase} before CLI exit`)),
      timeout,
    )
    child.once('exit', onExit)
    if (child.exitCode !== null || child.signalCode !== null) {
      onExit(child.exitCode, child.signalCode)
      return
    }
    inspect()
  })
}

function waitForPidsGoneBeforeExit(child, pids, output, timeout) {
  return new Promise((resolve, reject) => {
    let settled = false
    let poll
    const inspect = () => {
      const alive = pids.filter(pidExists)
      if (alive.length === 0) return finish(resolve)
      poll = setTimeout(inspect, 25)
    }
    const onExit = (code, signal) => {
      const alive = pids.filter(pidExists)
      if (alive.length === 0) return finish(resolve)
      finish(reject, new Error([
        `DSH CLI exited (${code ?? signal}) while Chromium was still alive`,
        `Chromium PIDs still alive: ${alive.join(', ')}`,
        output.text(),
      ].join('\n')))
    }
    const finish = (callback, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      clearTimeout(poll)
      child.removeListener('exit', onExit)
      callback(value)
    }
    const timer = setTimeout(() => finish(
      reject,
      new Error(`timed out waiting for Chromium PIDs to exit: ${pids.join(', ')}`),
    ), timeout)
    child.once('exit', onExit)
    if (child.exitCode !== null || child.signalCode !== null) {
      onExit(child.exitCode, child.signalCode)
      return
    }
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

function processRows() {
  return execFileSync('ps', ['-ax', '-o', 'pid=,ppid=,command='], { encoding: 'utf8' })
    .split('\n')
    .map((line) => line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/))
    .filter(Boolean)
    .map((match) => ({
      pid: Number(match[1]),
      ppid: Number(match[2]),
      command: match[3],
    }))
}

function descendantProcesses(rootPid) {
  return processSubtree(rootPid, processRows()).filter(({ pid }) => pid !== rootPid)
}

function processSubtree(rootPid, rows) {
  const descendants = new Set([rootPid])
  let changed = true
  while (changed) {
    changed = false
    for (const row of rows) {
      if (descendants.has(row.pid) || !descendants.has(row.ppid)) continue
      descendants.add(row.pid)
      changed = true
    }
  }
  return rows.filter(({ pid }) => descendants.has(pid))
}

function isChromium({ command }) {
  return command.startsWith(`${PATCHRIGHT_BROWSER_CACHE}${path.sep}chromium`)
}

function browserProcessFor(rows, browserDataRoot) {
  return rows.find(({ command }) => command.includes(`--user-data-dir=${browserDataRoot}`))
}

function formatProcesses(rows) {
  return rows.map(({ pid, ppid, command }) => `${pid} ${ppid} ${command}`).join('\n')
}

function pidExists(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error.code === 'EPERM'
  }
}

async function waitForCondition(predicate, timeout, description) {
  const deadline = Date.now() + timeout
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${description}`)
    await delay(25)
  }
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
