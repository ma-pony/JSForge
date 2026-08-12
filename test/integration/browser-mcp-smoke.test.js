import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { chromium } from 'patchright'

const PROJECT_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const PATCHRIGHT_BROWSER_CACHE = findBrowserCache(chromium.executablePath())

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
  try {
    await client.connect(transport)
    const result = await client.callTool({
      name: 'navigate_page',
      arguments: {
        url: 'data:text/html,%3Ctitle%3EDeepSpider%20Smoke%3C/title%3E',
      },
    })
    assert.equal(result.isError, undefined)
    assert.match(result.content[0].text, /DeepSpider Smoke/)
  } finally {
    await client.close().catch(() => {})
    fs.rmSync(tmpHome, { recursive: true, force: true })
  }
})

function findBrowserCache(executablePath) {
  let current = executablePath
  while (path.dirname(current) !== current) {
    if (/^chromium-\d+$/.test(path.basename(current))) return path.dirname(current)
    current = path.dirname(current)
  }
  throw new Error(`Unable to locate Patchright browser cache from ${executablePath}`)
}
