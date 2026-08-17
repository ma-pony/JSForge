import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const projectRoot = fileURLToPath(new URL('..', import.meta.url))
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'deepspider-pack-smoke-'))
const installDir = path.join(tempRoot, 'install')
const npmEnv = { ...process.env, npm_config_cache: path.join(tempRoot, 'npm-cache') }
fs.mkdirSync(installDir)

try {
  const packed = JSON.parse(
    execFileSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', tempRoot], {
      cwd: projectRoot,
      encoding: 'utf8',
      env: npmEnv,
    })
  )
  const tarballPath = path.join(tempRoot, packed[0].filename)
  execFileSync('npm', ['install', '--ignore-scripts', tarballPath], {
    cwd: installDir,
    env: npmEnv,
    stdio: 'inherit',
  })
  const installedPackageRoot = path.join(installDir, 'node_modules', 'deepspider')
  const cliPath = path.join(installedPackageRoot, 'bin', 'cli.js')
  const version = execFileSync(process.execPath, [cliPath, '--version'], { encoding: 'utf8' })
  const help = execFileSync(process.execPath, [cliPath, '--help'], { encoding: 'utf8' })
  const agentHelp = execFileSync(process.execPath, [cliPath, 'agent', '--help'], { encoding: 'utf8' })
  assert.match(version, /1\.0\.0-beta/)
  assert.match(help, /deepspider agent/)
  assert.match(agentHelp, /DSH Web/)

  const launcher = await import(pathToFileURL(path.join(installedPackageRoot, 'src', 'dsh', 'launcher.js')))
  const dshHome = path.join(tempRoot, 'dsh-home')
  const layout = launcher.resolveDshLayout({ env: { DSH_HOME: dshHome } })
  launcher.syncManagedDshAssets(layout)

  for (const requiredPath of [
    layout.dshBinary,
    layout.patchPath,
    path.join(layout.sourcePreset, 'agent.cordis.yml'),
    layout.agentPluginPath,
    layout.hostPluginPath,
    path.join(layout.sourceSkill, 'SKILL.md'),
    path.join(layout.targetPreset, 'agent.cordis.yml'),
    path.join(layout.targetSkill, 'SKILL.md'),
  ]) {
    assert.equal(fs.existsSync(requiredPath), true, `missing packed path: ${requiredPath}`)
    assert.equal(requiredPath.startsWith(projectRoot), false, `packed path escaped to checkout: ${requiredPath}`)
  }
  assert.equal(layout.dshBinary.includes(`${path.sep}.bin${path.sep}`), false)
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true })
}
