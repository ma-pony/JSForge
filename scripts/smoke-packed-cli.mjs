import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const projectRoot = fileURLToPath(new URL('..', import.meta.url))
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'deepspider-pack-smoke-'))
const installDir = path.join(tempRoot, 'install')
const npmEnv = { ...process.env, npm_config_cache: path.join(tempRoot, 'npm-cache') }
fs.mkdirSync(installDir)

function readSourceTree(root) {
  const sources = []
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name)
      if (entry.isDirectory()) visit(target)
      else if (/\.(?:js|mjs)$/.test(entry.name)) sources.push(fs.readFileSync(target, 'utf8'))
    }
  }
  visit(root)
  return sources.join('\n')
}

async function startSemanticTarget() {
  const cookie = 'packed_semantic=installed-runtime; Path=/'
  const server = http.createServer((request, response) => {
    const accepted = String(request.headers.cookie || '').split(/;\s*/).includes(
      cookie.replace(/; Path=\/$/, ''),
    )
    if (!accepted) {
      response.writeHead(412, { 'content-type': 'text/html; charset=utf-8' })
      response.end([
        '<!doctype html><title>Packed Semantic Challenge</title>',
        '<script>',
        `document.cookie = ${JSON.stringify(cookie)};`,
        'location.replace(location.href);',
        '</script>',
      ].join(''))
      return
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end('<!doctype html><title>Packed Semantic Accepted</title>')
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const { port } = server.address()
  return {
    url: `http://127.0.0.1:${port}/acceptance`,
    close: () => new Promise((resolve, reject) => server.close((error) => (
      error ? reject(error) : resolve()
    ))),
  }
}

async function smokeInstalledSemanticRuntime(installedPackageRoot) {
  const target = await startSemanticTarget()
  const runsDir = path.join(tempRoot, 'semantic-runs')
  fs.mkdirSync(runsDir)
  const { createOutputContract } = await import(pathToFileURL(
    path.join(installedPackageRoot, 'src', 'recovery', 'contracts.js'),
  ))
  const { createRuntimeRecipe } = await import(pathToFileURL(
    path.join(installedPackageRoot, 'src', 'recovery', 'recipe.js'),
  ))
  const { SdenvRuntimeAdapter } = await import(pathToFileURL(
    path.join(installedPackageRoot, 'src', 'recovery', 'runtime', 'sdenv-adapter.js'),
  ))
  const { validateGeneratedOutput } = await import(pathToFileURL(
    path.join(installedPackageRoot, 'src', 'recovery', 'validation.js'),
  ))
  const recipe = createRuntimeRecipe({ timeoutMs: 10000 })
  const contract = createOutputContract({
    kind: 'cookie',
    selector: 'packed_semantic',
    entryUrl: target.url,
    request: { url: target.url, method: 'GET', headers: {} },
    success: { status: 200, title: 'Packed Semantic Accepted' },
  })
  const runtime = new SdenvRuntimeAdapter({
    sessionId: 'packed-semantic-smoke',
    runsDir,
    env: {
      ...process.env,
      NO_PROXY: '127.0.0.1,localhost',
      no_proxy: '127.0.0.1,localhost',
    },
  })
  try {
    const result = await runtime.execute({ runId: 'native-run', contract, recipe })
    assert.equal(result.ok, true)
    assert.equal(result.engine.name, 'sdenv')
    assert.ok(result.engine.version)
    assert.ok(result.outputs.some(({ kind, name }) => kind === 'cookie' && name === contract.selector))
    assert.ok(result.events.some(({ type }) => type === 'sdenv:exit'))
    const validation = await validateGeneratedOutput({
      contract,
      outputs: result.outputs,
      requestTemplate: {
        headers: contract.request.headers,
        userAgent: recipe.userAgent,
        strictSSL: recipe.strictSSL,
        timeoutMs: recipe.timeoutMs,
      },
    })
    assert.equal(validation.level, 'reproduced')
    assert.equal(validation.accepted, true)
    assert.equal(validation.status, 200)
    assert.equal(validation.title, contract.success.title)
  } finally {
    await runtime.close('packed semantic smoke complete')
    await target.close()
  }
}

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
  execFileSync('npm', ['rebuild', 'sdenv', '--ignore-scripts=false'], {
    cwd: installDir,
    env: npmEnv,
    stdio: 'inherit',
  })
  const installedPackageRoot = path.join(installDir, 'node_modules', 'deepspider')
  assert.equal(
    fs.existsSync(path.join(installedPackageRoot, 'test', 'fixtures', 'dsh', 'host-probe-plugin.js')),
    false,
    'test-only DSH probe fixture was published',
  )
  for (const requiredPath of [
    'README.md',
    'README_EN.md',
    'src/browser/DialogBridge.js',
    'src/recovery/coordinator.js',
    'src/recovery/runtime/sdenv-adapter.js',
    'src/recovery/runtime/worker.mjs',
    'src/recovery/solver.js',
    'dsh/cordis.patch.yml',
    'dsh/agent-presets/spider/agent.cordis.yml',
    'skills/deepspider/SKILL.md',
  ]) {
    assert.equal(
      fs.existsSync(path.join(installedPackageRoot, requiredPath)),
      true,
      `missing published path: ${requiredPath}`,
    )
  }
  for (const removedPath of [
    'test',
    'src/core/PatchGenerator.js',
    'src/store/Store.js',
    'src/browser/EnvBridge.js',
    'src/env',
    'src/rebuild',
  ]) {
    assert.equal(
      fs.existsSync(path.join(installedPackageRoot, removedPath)),
      false,
      `removed path was published: ${removedPath}`,
    )
  }
  const installedManifest = JSON.parse(
    fs.readFileSync(path.join(installedPackageRoot, 'package.json'), 'utf8'),
  )
  const installedSource = readSourceTree(path.join(installedPackageRoot, 'src'))
  assert.equal(Object.hasOwn(installedManifest.dependencies, 'jsdom'), false, 'direct jsdom dependency was published')
  assert.doesNotMatch(
    installedSource,
    /export_rebuild_bundle|analyze_runtime_trace|analyze_script_semantics/,
    'legacy rebuild tool was published',
  )
  assert.doesNotMatch(
    installedSource,
    /(?:from\s+['"]jsdom['"]|require\(\s*['"]jsdom['"]\s*\))/,
    'direct jsdom entry was published',
  )
  const cliPath = path.join(installedPackageRoot, 'bin', 'cli.js')
  const installedEnvExample = fs.readFileSync(path.join(installedPackageRoot, '.env.example'), 'utf8')
  assert.doesNotMatch(installedEnvExample, /DEEPSPIDER_USER_DATA_DIR|browser-profile/i)
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
    layout.sourcePatch,
    layout.targetPatch,
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
  const managedPatch = fs.readFileSync(layout.targetPatch, 'utf8')
  const managedPreset = fs.readFileSync(path.join(layout.targetPreset, 'agent.cordis.yml'), 'utf8')
  assert.doesNotMatch(managedPatch, /DEEPSPIDER_HOST_PLUGIN_PATH/)
  assert.doesNotMatch(managedPreset, /DEEPSPIDER_AGENT_PLUGIN_PATH/)
  assert.match(managedPreset, /disabled: !!js process\.platform/)
  assert.equal(managedPatch.includes(JSON.stringify(layout.hostPluginPath)), true)
  assert.equal(managedPreset.includes(JSON.stringify(layout.agentPluginPath)), true)
  await smokeInstalledSemanticRuntime(installedPackageRoot)
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true })
}
