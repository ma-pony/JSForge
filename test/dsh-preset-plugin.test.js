import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { apply } from '../src/dsh/preset-plugin.js'

const projectRoot = fileURLToPath(new URL('..', import.meta.url))

test('the DSH bundle installs Spider as a real directory in the native user roster', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'deepspider-preset-plugin-'))
  const presetRoot = path.join(tempRoot, '.agent-presets')
  try {
    apply(null, { presetRoot })
    const installed = path.join(presetRoot, 'spider')
    assert.equal(fs.lstatSync(installed).isDirectory(), true)
    assert.equal(fs.lstatSync(installed).isSymbolicLink(), false)
    for (const filename of ['agent.cordis.yml', 'preset.yml']) {
      assert.equal(
        fs.readFileSync(path.join(installed, filename), 'utf8'),
        fs.readFileSync(path.join(projectRoot, 'dsh', 'agent-presets', 'spider', filename), 'utf8'),
      )
    }
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
})
