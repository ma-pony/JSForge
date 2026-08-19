import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const packagedPreset = fileURLToPath(new URL('../../dsh/agent-presets/spider', import.meta.url))

export const name = 'deepspider-preset'

export function apply(_ctx, config = {}) {
  if (typeof config.presetRoot !== 'string' || config.presetRoot.length === 0) {
    throw new Error('deepspider-preset requires presetRoot')
  }
  const installedPreset = path.join(config.presetRoot, 'spider')
  fs.mkdirSync(config.presetRoot, { recursive: true })
  fs.rmSync(installedPreset, { recursive: true, force: true })
  fs.cpSync(packagedPreset, installedPreset, { recursive: true })
}
