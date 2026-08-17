import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { setImmediate } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { chromium } from 'patchright'
import { DEEPSPIDER_TOOL_COUNT, deepSpiderCatalog } from '../../src/tools/index.js'

const PROJECT_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const PATCHRIGHT_BROWSER_CACHE = findBrowserCache(chromium.executablePath())
const CATALOG_NAMES = deepSpiderCatalog.map(({ name }) => name)

test('MCP browser tool opens a local page', { timeout: 30000 }, async () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'deepspider-browser-smoke-'))
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['src/mcp/server.js'],
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      HOME: tmpHome,
      DEEPSPIDER_HEADLESS: 'true',
      PLAYWRIGHT_BROWSERS_PATH: PATCHRIGHT_BROWSER_CACHE,
    },
  })
  const client = new Client({ name: 'deepspider-smoke', version: '1.0.0' })
  let serverPid
  try {
    await client.connect(transport)
    serverPid = transport.pid
    assert.ok(Number.isInteger(serverPid), 'MCP stdio server PID was not exposed')
    const registered = await client.listTools()
    const registeredNames = registered.tools.map(({ name }) => name)
    assert.equal(registeredNames.length, DEEPSPIDER_TOOL_COUNT)
    for (const name of CATALOG_NAMES) {
      assert.equal(registeredNames.filter((candidate) => candidate === name).length, 1, name)
    }
    const result = await client.callTool({
      name: 'navigate_page',
      arguments: {
        url: 'data:text/html,%3Ctitle%3EDeepSpider%20Smoke%3C/title%3E',
      },
    })
    assert.equal(result.isError, undefined, result.content[0].text)
    assert.match(result.content[0].text, /DeepSpider Smoke/)
  } finally {
    await client.close().catch(() => {})
    if (serverPid) await waitForProcessExit(serverPid, 10000)
    fs.rmSync(tmpHome, { recursive: true, force: true })
  }
})

async function waitForProcessExit(pid, timeout) {
  const deadline = Date.now() + timeout
  while (pidExists(pid)) {
    if (Date.now() >= deadline) throw new Error(`MCP stdio server PID ${pid} did not exit`)
    await setImmediate()
  }
}

function pidExists(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error.code === 'EPERM'
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
