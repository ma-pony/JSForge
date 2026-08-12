import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import plugin from '../plugins/deepspider-plugin/server.js'

test('evolve_skill rejects traversal before execution and never changes the target', async (t) => {
  const targetName = `plugin-traversal-target-${process.pid}-${Date.now()}`
  const target = path.join(import.meta.dirname, `${targetName}.md`)
  const original = 'must remain unchanged\n'
  fs.writeFileSync(target, original)
  t.after(() => fs.rmSync(target, { force: true }))

  const hooks = await plugin({ directory: process.cwd() })
  const evolveSkill = hooks.tool.evolve_skill
  const traversal = `../../../test/${targetName}`
  const parsed = evolveSkill.args.skill.safeParse(traversal)
  const result = await evolveSkill.execute({
    skill: traversal,
    category: 'new-pattern',
    content: 'must not be appended',
    source: 'security regression',
  })

  assert.equal(parsed.success, false)
  assert.match(result, /^Error: unknown skill/)
  assert.equal(fs.readFileSync(target, 'utf8'), original)
})
