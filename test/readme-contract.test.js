import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const packageJson = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const readmes = [
  fs.readFileSync(new URL('../README.md', import.meta.url), 'utf8'),
  fs.readFileSync(new URL('../README_EN.md', import.meta.url), 'utf8'),
]
const contributorGuide = fs.readFileSync(new URL('../CLAUDE.md', import.meta.url), 'utf8')
const envExample = fs.readFileSync(new URL('../.env.example', import.meta.url), 'utf8')

test('bilingual READMEs describe the current evidence-driven runtime', () => {
  for (const text of readmes) {
    for (const pattern of [
      /DSH/,
      /Observe/i,
      /Capture/i,
      /Recipe/i,
      /Probe/i,
      /Verify/i,
      /Dialog/i,
      /target\.original\.js/,
      /target\.working\.js/,
      /transforms\.json/,
      /evidence\/network\/responses\.json/,
      /browser_dialog/,
    ]) assert.match(text, pattern)

    assert.doesNotMatch(text, /OpenCode|Camoufox|evolve_skill|web_fetch|PatchGenerator|EnvBridge|src\/env\/|\b51 tools\b|51 个工具/i)
  }
})

test('repository guidance describes the same live architecture', () => {
  assert.match(contributorGuide, /DSH/)
  assert.match(contributorGuide, /Environment Recipe/)
  assert.match(contributorGuide, /Dialog/)
  assert.doesNotMatch(contributorGuide, /OpenCode|EnvBridge|PatchGenerator|src\/env\//)
})

test('package metadata identifies the current product and runtime floor', () => {
  assert.match(packageJson.description, /DSH-native JavaScript reverse-engineering/i)
  assert.equal(packageJson.engines.node, '>=24.15.0')
  assert.equal(packageJson.packageManager, 'pnpm@11.21.0')
})

test('README dependency and authorization claims match the release contract', () => {
  for (const text of readmes) {
    assert.match(text, /Node\.js `>=24\.15\.0`/)
    assert.match(text, /pnpm `11\.21\.0`/)
    assert.match(text, /Cordis/)
    assert.match(text, /Session/)
    assert.match(text, /Goals/)
    assert.match(text, /Todo/)
    assert.match(text, /Code Mode/)
    assert.match(text, /MCP/)
    assert.match(text, /authorization|授权/i)
  }
})

test('published environment example only advertises supported settings', () => {
  assert.doesNotMatch(envExample, /DEEPSPIDER_USER_DATA_DIR|browser-profile/i)
})
