import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { buildOpencodeConfig } from '../src/agent/config.js'

test('builds DeepSpider-owned V2 config', () => {
  const root = '/tmp/deepspider-fixture'
  const config = buildOpencodeConfig({ projectRoot: root })
  assert.equal(config.default_agent, 'spider')
  assert.equal(config.autoupdate, false)
  assert.equal(config.share, 'disabled')
  assert.deepEqual(config.skills.paths, [path.join(root, 'skills/deepspider')])
  assert.deepEqual(config.plugin, [path.join(root, 'plugins/deepspider-plugin')])
  assert.deepEqual(config.mcp.deepspider.command, [
    process.execPath,
    path.join(root, 'src/mcp/server.js'),
  ])
  assert.equal(config.mcp.deepspider.cwd, root)
  assert.equal(config.permission['deepspider_*'], 'allow')
  assert.equal(config.model, undefined)
})

test('CLI model override affects only this config object', () => {
  const config = buildOpencodeConfig({ model: 'test/model' })
  assert.equal(config.model, 'test/model')
})

test('local Plugin exports evolve_skill and compaction hook', async () => {
  const { default: plugin } = await import('../plugins/deepspider-plugin/server.js')
  const hooks = await plugin({ directory: '/tmp/deepspider-plugin-fixture' })
  assert.equal(typeof hooks.tool.evolve_skill.execute, 'function')
  assert.equal(typeof hooks['experimental.session.compacting'], 'function')
})
