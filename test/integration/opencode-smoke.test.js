import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PROJECT_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'deepspider-opencode-smoke-'))
process.env.HOME = TMP_HOME

test('real OpenCode loads DeepSpider capabilities and closes', { timeout: 30000 }, async () => {
  const [{ OpencodeRuntime }, { buildOpencodeConfig }, sandbox] = await Promise.all([
    import('../../src/agent/runtime.js'),
    import('../../src/agent/config.js'),
    import('../../src/agent/sandbox.js'),
  ])
  sandbox.initSandbox('fresh')
  sandbox.applySandboxEnv()
  const runtime = new OpencodeRuntime({
    config: buildOpencodeConfig({ projectRoot: PROJECT_ROOT }),
    directory: PROJECT_ROOT,
  })
  try {
    await runtime.start()
    assert.equal(runtime.state, 'ready')
  } finally {
    await runtime.close()
    fs.rmSync(TMP_HOME, { recursive: true, force: true })
  }
  assert.equal(runtime.state, 'closed')
})
