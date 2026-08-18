import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { createOutputContract } from '../src/recovery/contracts.js'
import { createRuntimeRecipe } from '../src/recovery/recipe.js'
import { exportSolver } from '../src/recovery/solver.js'

async function run(file, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [file], { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.once('error', reject)
    child.once('close', (code) => resolve({ code, stdout, stderr }))
  })
}

test('exported Solver rejects a matching response when sdenv generated no Cookie', { timeout: 15000 }, async (t) => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'deepspider-solver-cookie-anchor-'))
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end(`<title>Accepted</title><script>window.dispatchEvent(new CustomEvent('sdenv:exit'))</script>`)
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve))
    fs.rmSync(temporary, { recursive: true, force: true })
  })
  const url = `http://127.0.0.1:${server.address().port}/target`
  const directory = path.join(temporary, 'solver')
  const contract = createOutputContract({
    kind: 'cookie', selector: null, entryUrl: url,
    request: { method: 'GET', url, headers: {} },
    success: { status: 200, title: 'Accepted' },
  })
  const recipe = createRuntimeRecipe({ timeoutMs: 1000 })
  await assert.rejects(exportSolver({
    sessionId: 'solver-anchor', contract, recipe,
    validation: { level: 'reproduced', accepted: true }, directory, solverDir: directory,
  }), /legal generated Cookie/)
  await exportSolver({
    sessionId: 'solver-anchor', contract, recipe,
    validation: {
      level: 'reproduced', accepted: true,
      generatedCookieCount: 1, generatedCookieNames: ['previously-generated'],
    },
    solverDir: directory,
  })
  fs.symlinkSync(path.resolve('node_modules'), path.join(directory, 'node_modules'), 'dir')

  const result = await run(path.join(directory, 'solver.mjs'), directory)
  assert.equal(result.code, 1, `${result.stdout}\n${result.stderr}`)
  const output = JSON.parse(result.stdout.trim().split('\n').at(-1))
  assert.equal(output.accepted, false)
  assert.equal(output.outputCount, 0)
})
