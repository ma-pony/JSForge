import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const projectRoot = fileURLToPath(new URL('..', import.meta.url))
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'deepspider-pack-smoke-'))
const installDir = path.join(tempRoot, 'install')
fs.mkdirSync(installDir)

try {
  const packed = JSON.parse(
    execFileSync('npm', ['pack', '--json', '--pack-destination', tempRoot], {
      cwd: projectRoot,
      encoding: 'utf8',
    })
  )
  const tarballPath = path.join(tempRoot, packed[0].filename)
  execFileSync('npm', ['install', '--ignore-scripts', tarballPath], {
    cwd: installDir,
    stdio: 'inherit',
  })
  const cliPath = path.join(installDir, 'node_modules', '.bin', 'deepspider')
  const version = execFileSync(cliPath, ['--version'], { encoding: 'utf8' })
  const help = execFileSync(cliPath, ['--help'], { encoding: 'utf8' })
  assert.match(version, /1\.0\.0-beta/)
  assert.match(help, /deepspider agent/)
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true })
}
