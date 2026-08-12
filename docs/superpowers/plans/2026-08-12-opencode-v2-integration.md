# OpenCode V2 Integration Rewrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 DeepSpider 的 OpenCode 接入升级并重写为 `1.18.16` V2 Server/Client 主链，同时保留独立认证沙箱、官方 TUI、现有 Patchright 浏览器和 MCP 业务能力。

**Architecture:** `src/agent/runtime.js` 成为 OpenCode server/client、健康检查、TUI 和关闭流程的唯一生命周期所有者；`config.js` 只构建 V2 配置，`sandbox.js` 只管理隔离 XDG 与 auth 复用。CLI 只解析参数和转发信号。Patchright、MCP 工具和八阶段工作流仅在真实 smoke test 证明不兼容时做最小修复。

**Tech Stack:** Node.js ESM、OpenCode `1.18.16` V2 SDK/Plugin、Model Context Protocol SDK、Patchright、node:test、ESLint、pnpm/npm。

## Global Constraints

- `opencode-ai`、`@opencode-ai/sdk`、`@opencode-ai/plugin` 必须精确锁定为 `1.18.16`。
- 不兼容 OpenCode `1.3.13`，不保留旧 SDK 分支。
- 保留 `~/.deepspider/opencode-sandbox/`，只支持 `link-auth` 和 `fresh`。
- 继续设置 `OPENCODE_DISABLE_PROJECT_CONFIG=true`。
- Camoufox 不在范围内；Patchright 仍是唯一浏览器底座。
- 不预先重构 MCP 工具、DataStore、补环境或浏览器 UI；只修真实主链失败的根因。
- 不访问真实目标站点，不调用真实 LLM；浏览器 smoke 只使用本地/`data:` 页面。

---

## File Map

- Modify `package.json`: 精确依赖、测试与 smoke scripts，移除隐式 dotenv 依赖。
- Modify `pnpm-lock.yaml`: 与 manifest 同步。
- Modify `plugins/deepspider-plugin/package.json`: 声明 Plugin 的运行时依赖与目标 OpenCode 版本。
- Modify `bin/cli.js`: 删除 dotenv，Agent 命令委托统一 Runtime。
- Modify `src/agent/config.js`: 纯 V2 配置构建器。
- Modify `src/agent/index.js`: 两选项首次初始化与 Runtime 公开入口。
- Create `src/agent/runtime.js`: OpenCode V2 生命周期与 readiness 检查。
- Modify `src/agent/tui.js`: 可关闭、可等待的官方 TUI attach 句柄。
- Modify `src/agent/sandbox.js`: auth-only 隔离与旧 config 软链接脱离。
- Delete `src/agent/session.js`: 删除未使用的旧版 SDK 会话封装。
- Modify `plugins/deepspider-plugin/server.js`: `1.18.16` Plugin/Tool 契约。
- Create `test/dependencies.test.js`: manifest、Plugin 导入和版本合同。
- Modify `test/sandbox.test.js`: 两种模式与 config 本地化回归。
- Create `test/agent-config.test.js`: V2 配置与 Agent 加载回归。
- Create `test/agent-runtime.test.js`: Runtime 状态机、readiness 与幂等关闭。
- Create `test/agent-index.test.js`: 首次初始化选择规则。
- Create `test/integration/opencode-smoke.test.js`: 真实 OpenCode/MCP smoke。
- Create `test/integration/browser-mcp-smoke.test.js`: 本地页面浏览器工具 smoke。
- Create `scripts/smoke-packed-cli.mjs`: tarball 空目录安装验证。
- Modify `.github/workflows/publish.yml`: 发布前执行单元测试和 pack smoke。
- Modify `README.md`, `.env.example`: 对齐 auth-only 沙箱和当前环境变量。

## Task 1: Make the OpenCode dependency contract reproducible

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `plugins/deepspider-plugin/package.json`
- Modify: `bin/cli.js:7`
- Create: `test/dependencies.test.js`

**Interfaces:**
- Produces: root dependencies and Plugin dependency metadata pinned to `1.18.16`.
- Produces: `npm run test:integration` and `npm run smoke:pack` script names used by Task 6.
- Removes: runtime dependency on `dotenv/config`.

- [ ] **Step 1: Write the dependency contract test**

Create `test/dependencies.test.js` using `node:test`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const root = JSON.parse(
  fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')
)
const plugin = JSON.parse(
  fs.readFileSync(
    new URL('../plugins/deepspider-plugin/package.json', import.meta.url),
    'utf8'
  )
)

test('OpenCode packages are pinned to one supported version', () => {
  assert.equal(root.dependencies['@opencode-ai/sdk'], '1.18.16')
  assert.equal(root.dependencies['@opencode-ai/plugin'], '1.18.16')
  assert.equal(root.dependencies['opencode-ai'], '1.18.16')
  assert.equal(plugin.dependencies['@opencode-ai/plugin'], '1.18.16')
  assert.equal(plugin.dependencies.zod, root.dependencies.zod)
})

test('CLI has no undeclared dotenv bootstrap', () => {
  const cli = fs.readFileSync(new URL('../bin/cli.js', import.meta.url), 'utf8')
  assert.doesNotMatch(cli, /dotenv\/config/)
})
```

- [ ] **Step 2: Run the new test and verify it fails**

Run: `node --test test/dependencies.test.js`

Expected: FAIL because `@opencode-ai/plugin` is absent and the CLI still imports `dotenv/config`.

- [ ] **Step 3: Update manifests and CLI bootstrap**

In root `package.json`:

```json
"scripts": {
  "test": "node --test 'test/*.test.js'",
  "test:integration": "node --test 'test/integration/*.test.js'",
  "smoke:pack": "node scripts/smoke-packed-cli.mjs"
},
"dependencies": {
  "@opencode-ai/plugin": "1.18.16",
  "@opencode-ai/sdk": "1.18.16",
  "opencode-ai": "1.18.16"
}
```

Keep all unrelated dependencies unchanged. In `plugins/deepspider-plugin/package.json`, add:

```json
"engines": { "opencode": "1.18.16" },
"dependencies": {
  "@opencode-ai/plugin": "1.18.16",
  "zod": "^4.3.6"
}
```

Delete `import 'dotenv/config'` from `bin/cli.js`.

- [ ] **Step 4: Regenerate the lockfile and install the pinned runtime**

Run:

```bash
pnpm install --lockfile-only --ignore-scripts
pnpm install
```

Expected: root manifest and `pnpm-lock.yaml` contain the same three OpenCode versions; OpenCode and Patchright postinstall steps complete.

- [ ] **Step 5: Run the dependency test and manifest checks**

Run:

```bash
node --test test/dependencies.test.js
pnpm install --frozen-lockfile --ignore-scripts
git diff --check
```

Expected: PASS; frozen install reports no manifest/lock mismatch.

- [ ] **Step 6: Commit Task 1**

```bash
git add package.json pnpm-lock.yaml plugins/deepspider-plugin/package.json bin/cli.js test/dependencies.test.js
git commit -m "build: pin opencode v2 dependencies"
```

## Task 2: Reduce the sandbox to auth-only isolation

**Files:**
- Modify: `src/agent/sandbox.js`
- Modify: `test/sandbox.test.js`

**Interfaces:**
- Produces: `initSandbox(mode)` where `mode` is exactly `'link-auth' | 'fresh'`.
- Produces: `localizeSandboxConfig()` that replaces a legacy `opencode.json` symlink with a `0600` local copy without modifying the link target.
- Preserves: `applySandboxEnv()`, `isSandboxInitialized()`, `getSandboxPaths()`.

- [ ] **Step 1: Add failing auth-only sandbox tests**

Extend `test/sandbox.test.js` with these cases:

```js
function resetSandboxFiles() {
  const paths = getSandboxPaths()
  for (const target of [paths.opencodeJson, paths.authJson]) {
    try { fs.unlinkSync(target) } catch {}
  }
  for (const dir of [path.dirname(paths.opencodeJson), path.dirname(paths.authJson)]) {
    for (const file of fs.readdirSync(dir)) {
      if (file.includes('.bak.')) fs.unlinkSync(path.join(dir, file))
    }
  }
}

test('link-all is rejected', () => {
  assert.throws(
    () => initSandbox('link-all'),
    (err) => err.code === 'E_SANDBOX_MODE'
  )
})

test('link-auth links auth but never links opencode config', () => {
  resetSandboxFiles()
  const userConfigDir = path.join(TMP_HOME, '.config', 'opencode')
  const userDataDir = path.join(TMP_HOME, '.local', 'share', 'opencode')
  fs.mkdirSync(userConfigDir, { recursive: true })
  fs.mkdirSync(userDataDir, { recursive: true })
  fs.writeFileSync(path.join(userConfigDir, 'opencode.json'), '{"model":"global/model"}\n')
  fs.writeFileSync(path.join(userDataDir, 'auth.json'), '{"provider":"credential"}\n')
  const result = initSandbox('link-auth')
  assert.equal(result.linked.authJson, true)
  assert.ok(fs.lstatSync(getSandboxPaths().authJson).isSymbolicLink())
  assert.equal(fs.existsSync(getSandboxPaths().opencodeJson), false)
})

test('legacy config symlink becomes an isolated local file', () => {
  resetSandboxFiles()
  prepareSandbox()
  const externalConfig = path.join(TMP_HOME, 'legacy-opencode.json')
  const original = '{"model":"legacy/model"}\n'
  fs.writeFileSync(externalConfig, original)
  fs.symlinkSync(externalConfig, getSandboxPaths().opencodeJson)
  localizeSandboxConfig()
  assert.equal(fs.lstatSync(getSandboxPaths().opencodeJson).isSymbolicLink(), false)
  assert.equal(fs.readFileSync(getSandboxPaths().opencodeJson, 'utf8'), original)
  assert.equal(fs.readFileSync(externalConfig, 'utf8'), original)
  assert.equal(fs.statSync(getSandboxPaths().opencodeJson).mode & 0o777, 0o600)
})
```

Import `localizeSandboxConfig` from the production module; do not copy its implementation into the test. Convert the two existing `link-all` rollback cases to `link-auth`: one verifies an existing sandbox `auth.json` is backed up before linking, and the other monkey-patches the first `fs.symlinkSync` call to throw and verifies the original sandbox `auth.json` is restored. Change fresh-mode result assertions to `assert.deepEqual(result.linked, { authJson: false })`.

- [ ] **Step 2: Run sandbox tests and verify the new cases fail**

Run: `node --test test/sandbox.test.js`

Expected: FAIL because `link-all` is accepted and `localizeSandboxConfig` does not exist.

- [ ] **Step 3: Implement strict modes and config localization**

In `src/agent/sandbox.js`:

```js
const SUPPORTED_MODES = new Set(['link-auth', 'fresh'])

function assertSandboxMode(mode) {
  if (!SUPPORTED_MODES.has(mode)) {
    throw Object.assign(new Error(`Unsupported sandbox mode: ${mode}`), {
      code: 'E_SANDBOX_MODE',
    })
  }
}

export function localizeSandboxConfig() {
  const target = SANDBOX_OPENCODE_JSON
  let stat
  try { stat = fs.lstatSync(target) } catch (err) {
    if (err.code === 'ENOENT') return false
    throw err
  }
  if (!stat.isSymbolicLink()) return false

  const content = fs.readFileSync(fs.realpathSync(target), 'utf8')
  const tmp = `${target}.tmp.${process.pid}.${Date.now()}`
  fs.writeFileSync(tmp, content, { mode: 0o600 })
  fs.renameSync(tmp, target)
  return true
}
```

Call `assertSandboxMode(mode)` as the first statement of `initSandbox()`. Delete the `link-all` config target branch; retain the existing transactional backup, link and rollback code for `auth.json` only. Return `linked: { authJson: boolean }`. Call `localizeSandboxConfig()` from `applySandboxEnv()` before setting XDG variables.

- [ ] **Step 4: Run sandbox and full unit tests**

Run:

```bash
node --test test/sandbox.test.js
npm test
```

Expected: all sandbox rollback, fresh-mode, auth-link and localization tests pass.

- [ ] **Step 5: Commit Task 2**

```bash
git add src/agent/sandbox.js test/sandbox.test.js
git commit -m "refactor(agent): isolate opencode auth sandbox"
```

## Task 3: Build one valid V2 config and load the Plugin contract

**Files:**
- Modify: `src/agent/config.js`
- Modify: `plugins/deepspider-plugin/server.js`
- Create: `test/agent-config.test.js`

**Interfaces:**
- Produces: `buildOpencodeConfig({ model?, projectRoot? }) -> OpenCode V2 Config`.
- Produces: Plugin default export with tool ID `evolve_skill` and `experimental.session.compacting` hook.
- Consumes: exact dependencies from Task 1.

- [ ] **Step 1: Write failing V2 configuration tests**

Create `test/agent-config.test.js`:

```js
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
```

Do not execute `evolve_skill` against repository files.

- [ ] **Step 2: Run the tests and verify expected failures**

Run: `node --test test/agent-config.test.js`

Expected: FAIL because `projectRoot`, `share`, `cwd`, `process.execPath` and the V2 permission name are absent.

- [ ] **Step 3: Rewrite the config builder as a pure function**

Implement this stable shape in `src/agent/config.js`:

```js
export function buildOpencodeConfig({ model, projectRoot = PROJECT_ROOT } = {}) {
  const config = {
    default_agent: 'spider',
    autoupdate: false,
    share: 'disabled',
    mcp: {
      deepspider: {
        type: 'local',
        command: [process.execPath, path.join(projectRoot, 'src/mcp/server.js')],
        cwd: projectRoot,
        enabled: true,
        timeout: 10000,
      },
    },
    plugin: [path.join(projectRoot, 'plugins/deepspider-plugin')],
    skills: { paths: [path.join(projectRoot, 'skills/deepspider')] },
    permission: {
      read: 'allow',
      glob: 'allow',
      grep: 'allow',
      bash: 'ask',
      edit: 'ask',
      'deepspider_*': 'allow',
    },
    agent: loadAgentDefinitions(path.join(projectRoot, 'agents')),
  }
  if (model) config.model = model
  return config
}
```

Keep frontmatter parsing and Spider prompt contents unchanged.

- [ ] **Step 4: Align the local Plugin with `1.18.16`**

Keep the existing default Plugin function and tool behavior. Resolve `skills/deepspider` from `import.meta.url` and the installed package root, not from OpenCode's session `directory`, so `evolve_skill` works when the user launches DeepSpider outside the source checkout. Update its JSDoc import to the installed `Plugin` type, keep `tool(...)`, and ensure the compaction hook uses the `({ sessionID }, output)` signature accepted by `1.18.16`. Do not redesign session-state lookup unless the integration test proves it blocks loading.

- [ ] **Step 5: Run config, Plugin and lint checks**

Run:

```bash
node --test test/agent-config.test.js
npm run lint
git diff --check
```

Expected: config tests pass; direct Plugin import succeeds; lint has no new errors.

- [ ] **Step 6: Commit Task 3**

```bash
git add src/agent/config.js plugins/deepspider-plugin/server.js test/agent-config.test.js
git commit -m "refactor(agent): build opencode v2 config"
```

## Task 4: Implement the OpenCode V2 Runtime and TUI lifecycle

**Files:**
- Create: `src/agent/runtime.js`
- Modify: `src/agent/tui.js`
- Delete: `src/agent/session.js`
- Create: `test/agent-runtime.test.js`

**Interfaces:**
- Produces: `new OpencodeRuntime({ config, directory?, projectRoot?, verbose?, createOpencodeFn?, startTUIFn?, readVersionsFn?, sleepFn? })` with `start()`, `attachTUI()`, `close()` and readable `state`.
- Produces: `assertOpencodeVersions()` with error code `E_OPENCODE_VERSION`.
- Produces: `startTUI(serverUrl, { signal, verbose, spawnImpl? }) -> { wait(), close() }`.
- Consumes: `buildOpencodeConfig()` from Task 3 and `createOpencode` from `@opencode-ai/sdk/v2`.

- [ ] **Step 1: Write Runtime state and cleanup tests with injected fakes**

Create fake server/client/TUI handles in `test/agent-runtime.test.js` and cover:

```js
function readyClient(overrides = {}) {
  return {
    v2: {
      health: { get: async () => ({ data: { healthy: true } }) },
      agent: { list: async () => ({ data: { data: [{ id: 'spider' }] } }) },
      skill: { list: async () => ({ data: { data: [{ name: 'deepspider' }] } }) },
    },
    mcp: {
      status: async () => ({ data: { deepspider: { status: 'connected' } } }),
    },
    tool: { ids: async () => ({ data: ['evolve_skill'] }) },
    ...overrides,
  }
}

function makeRuntimeWithReadyFakes(client = readyClient()) {
  const server = {
    closeCalls: 0,
    url: 'http://127.0.0.1:45678',
    close() { this.closeCalls++ },
  }
  const tui = {
    closeCalls: 0,
    wait: async () => 0,
    close() { this.closeCalls++ },
  }
  const runtime = new OpencodeRuntime({
    config: {},
    directory: process.cwd(),
    projectRoot: process.cwd(),
    createOpencodeFn: async () => ({ client, server }),
    startTUIFn: () => tui,
    readVersionsFn: () => ({
      '@opencode-ai/sdk': '1.18.16',
      '@opencode-ai/plugin': '1.18.16',
      'opencode-ai': '1.18.16',
    }),
    sleepFn: async () => {},
  })
  return { runtime, server, tui }
}

test('start reaches ready only after all readiness checks pass', async () => {
  const { runtime } = makeRuntimeWithReadyFakes()
  await runtime.start()
  assert.equal(runtime.state, 'ready')
})

test('failed readiness closes the started server', async () => {
  const client = readyClient({
    mcp: {
      status: async () => ({
        data: { deepspider: { status: 'failed', error: 'synthetic MCP failure' } },
      }),
    },
  })
  const { runtime, server } = makeRuntimeWithReadyFakes(client)
  await assert.rejects(runtime.start(), (err) => err.code === 'E_MCP_NOT_READY')
  assert.equal(server.closeCalls, 1)
  assert.equal(runtime.state, 'closed')
})

test('close is idempotent', async () => {
  const { runtime, server, tui } = makeRuntimeWithReadyFakes()
  await runtime.start()
  await runtime.attachTUI()
  await Promise.all([runtime.close(), runtime.close()])
  assert.equal(tui.closeCalls, 1)
  assert.equal(server.closeCalls, 1)
})
```

- [ ] **Step 2: Run Runtime tests and verify module-not-found failure**

Run: `node --test test/agent-runtime.test.js`

Expected: FAIL because `src/agent/runtime.js` does not exist.

- [ ] **Step 3: Implement installed-version discovery**

In `runtime.js`, use `createRequire(import.meta.url).resolve()` to resolve `@opencode-ai/sdk` and `@opencode-ai/plugin`, then walk upward from each entry until its `package.json`. Resolve `opencode-ai/package.json` directly because the CLI package intentionally has no JavaScript main entry. Read and assert this exact map before spawning:

```js
const SUPPORTED_OPENCODE_VERSION = '1.18.16'
const OPENCODE_PACKAGES = [
  { name: '@opencode-ai/sdk', entry: '@opencode-ai/sdk' },
  { name: '@opencode-ai/plugin', entry: '@opencode-ai/plugin' },
  { name: 'opencode-ai', entry: 'opencode-ai/package.json', packageJson: true },
]
```

On missing or mismatched packages throw:

```js
Object.assign(new Error(message), { code: 'E_OPENCODE_VERSION' })
```

Keep the package resolver injectable in tests.

- [ ] **Step 4: Implement Runtime start and readiness checks**

Use `createOpencode` from `@opencode-ai/sdk/v2`:

```js
const { client, server } = await createOpencodeFn({
  hostname: '127.0.0.1',
  port: 0,
  timeout: 10000,
  signal: this.abortController.signal,
  config: this.config,
})
```

`directory` defaults to `process.cwd()` and remains the OpenCode session location. `projectRoot` defaults to DeepSpider's installed package root and is used only for bundled assets and binaries. Before the SDK call, prepend `path.join(this.projectRoot, 'node_modules/.bin')` to `PATH` so its internal `spawn('opencode')` resolves the pinned dependency, then restore the original `PATH` immediately after `createOpencodeFn()` resolves or rejects. Do not depend on a globally installed OpenCode binary and do not force user sessions into the installed package directory.

Call these exact APIs with `{ throwOnError: true }`:

```js
client.v2.health.get({ throwOnError: true })
client.v2.agent.list(
  { location: { directory: this.directory } },
  { throwOnError: true }
)
client.v2.skill.list(
  { location: { directory: this.directory } },
  { throwOnError: true }
)
client.mcp.status({ directory: this.directory }, { throwOnError: true })
client.tool.ids({ directory: this.directory }, { throwOnError: true })
```

Assert `healthy === true`, Agent ID `spider`, Skill name `deepspider`, MCP `connected`, and tool ID `evolve_skill`. Poll MCP/tool readiness for at most 40 attempts with a 250 ms interval; injected `sleepFn` makes this deterministic in unit tests. Use stable stage codes `E_OPENCODE_HEALTH`, `E_AGENT_NOT_READY`, `E_SKILL_NOT_READY`, `E_PLUGIN_NOT_READY`, and `E_MCP_NOT_READY`; preserve the last MCP error in the latter.

- [ ] **Step 5: Implement a controllable TUI handle**

Change `startTUI` to accept a URL string and return:

```js
{
  wait: () => exitPromise,
  close: () => {
    if (child.exitCode == null && child.signalCode == null) child.kill('SIGTERM')
  },
}
```

Spawn the pinned local binary with `['attach', serverUrl]`, inherited stdio/environment and the Runtime abort signal. Convert child `error` into `E_TUI_ATTACH`; do not call `process.exit()`.

- [ ] **Step 6: Implement idempotent Runtime close**

Cache one `_closePromise`. The first call sets `closing`, aborts pending SDK operations, closes the TUI handle, closes the server, clears references and sets `closed`. Later calls return the same promise.

- [ ] **Step 7: Remove the unused legacy session wrapper**

Verify no imports first:

Run: `rg -n "agent/session|createSession|resumeLatestSession|sendMessage|abortSession" src test`

Expected: only `src/agent/session.js` definitions. Delete that file.

- [ ] **Step 8: Run Runtime and full unit tests**

Run:

```bash
node --test test/agent-runtime.test.js
npm test
npm run lint
```

Expected: lifecycle tests pass and no new lint errors appear.

- [ ] **Step 9: Commit Task 4**

```bash
git add src/agent/runtime.js src/agent/tui.js src/agent/session.js test/agent-runtime.test.js
git commit -m "feat(agent): add opencode v2 runtime"
```

## Task 5: Wire the auth-only wizard and CLI into the Runtime

**Files:**
- Modify: `src/agent/index.js`
- Modify: `bin/cli.js`
- Modify: `src/cli/commands/config.js`
- Create: `test/agent-index.test.js`

**Interfaces:**
- Produces: `startAgent({ model?, verbose? }) -> Promise<OpencodeRuntime>` after Runtime reaches `ready`.
- Produces: `selectInitMode(existing, answer) -> 'link-auth' | 'fresh'` as a pure decision helper.
- Consumes: `OpencodeRuntime` from Task 4.

- [ ] **Step 1: Write initialization decision tests**

Create `test/agent-index.test.js`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { selectInitMode } from '../src/agent/index.js'

test('defaults to link-auth when credentials exist', () => {
  assert.equal(selectInitMode({ authJson: '/tmp/auth.json' }, ''), 'link-auth')
})

test('fresh is selected explicitly or when no credentials exist', () => {
  assert.equal(selectInitMode({ authJson: '/tmp/auth.json' }, '2'), 'fresh')
  assert.equal(selectInitMode({ authJson: null }, ''), 'fresh')
})
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `node --test test/agent-index.test.js`

Expected: FAIL because `selectInitMode` is not exported and the old wizard has three choices.

- [ ] **Step 3: Rewrite the first-run wizard**

When global auth exists, show only:

```text
[1] 复用已有 auth.json（推荐）
[2] 创建独立空沙箱
```

Default to `link-auth`. When no auth exists, initialize `fresh` without prompting. The summary prints only auth reuse or empty sandbox; remove all global config-link messages.

- [ ] **Step 4: Make `startAgent` return a ready Runtime**

Implement the sequence:

```js
await ensureSandboxInitialized(options)
applySandboxEnv()
const config = buildOpencodeConfig({ model: options.model })
const runtime = new OpencodeRuntime({
  config,
  directory: process.cwd(),
  verbose: options.verbose,
})
await runtime.start()
return runtime
```

If the wizard is cancelled, preserve `E_WIZARD_CANCELLED` and exit code `130`.

- [ ] **Step 5: Replace CLI-owned server lifecycle with Runtime lifecycle**

In the `agent` branch of `bin/cli.js`:

```js
let runtime
const closeForSignal = async (exitCode) => {
  process.exitCode = exitCode
  await runtime?.close()
}

try {
  runtime = await startAgent({ model, verbose })
  const tuiExitCode = await runtime.attachTUI()
  if (process.exitCode == null) process.exitCode = tuiExitCode
} catch (err) {
  process.exitCode = err.exitCode || 1
  console.error(`❌ Agent 启动失败: ${err.message}`)
  if (verbose) console.error(err.stack)
} finally {
  await runtime?.close()
}
```

Register `SIGINT`/`SIGTERM` once around this block, call `closeForSignal(130|143)`, and remove the handlers in `finally`. Remove fixed-port `4096` cleanup advice and every `process.exit()` from the Agent branch.

- [ ] **Step 6: Keep config auth on the pinned local binary**

In `src/cli/commands/config.js`, keep `spawnSync(OPENCODE_BIN, ['auth', ...rest])` and sandbox XDG. Remove comments/branches that assume `opencode.json` can be a linked global config. `set-model` still writes a `0600` local file atomically.

- [ ] **Step 7: Run index, CLI and unit checks**

Run:

```bash
node --test test/agent-index.test.js
node bin/cli.js --version
node bin/cli.js --help
npm test
npm run lint
```

Expected: all pass; help/version return without loading OpenCode or dotenv.

- [ ] **Step 8: Commit Task 5**

```bash
git add src/agent/index.js bin/cli.js src/cli/commands/config.js test/agent-index.test.js
git commit -m "refactor(cli): run agent through v2 runtime"
```

## Task 6: Prove the real OpenCode, MCP, browser and package paths

**Files:**
- Create: `test/integration/opencode-smoke.test.js`
- Create: `test/integration/browser-mcp-smoke.test.js`
- Create: `scripts/smoke-packed-cli.mjs`
- Modify: `.github/workflows/publish.yml`
- Modify: `README.md`
- Modify: `.env.example`
- Conditional modify only if a smoke test proves necessary: `src/browser/**`, `src/mcp/**`, `agents/spider.md`, `skills/deepspider/**`

**Interfaces:**
- Consumes: `startAgent`/`OpencodeRuntime`, the stdio MCP server and packaged CLI.
- Produces: repeatable `npm run test:integration` and `npm run smoke:pack` acceptance commands.

- [ ] **Step 1: Write the real OpenCode/MCP smoke test**

In `test/integration/opencode-smoke.test.js`, set a temporary `HOME` before dynamically importing Agent modules, initialize a fresh sandbox, and start `OpencodeRuntime` without attaching TUI:

```js
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
```

Do not configure a provider and do not send a model prompt.

- [ ] **Step 2: Run the OpenCode smoke and fix only proven adapter mismatches**

Run: `node --test test/integration/opencode-smoke.test.js`

Expected: Health, Spider Agent, Skill, Plugin tool and MCP reach ready, then the process exits cleanly.

If it fails, preserve the exact failing response before editing. Valid fixes are limited to V2 config shape, Plugin entrypoint, readiness API response parsing, MCP tool naming or child cleanup.

- [ ] **Step 3: Write the stdio MCP browser smoke test**

Use the SDK client directly:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const PROJECT_ROOT = fileURLToPath(new URL('../../', import.meta.url))

test('MCP browser tool opens a local page', { timeout: 30000 }, async () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'deepspider-browser-smoke-'))
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['src/mcp/server.js'],
    cwd: PROJECT_ROOT,
    env: { ...process.env, HOME: tmpHome, DEEPSPIDER_HEADLESS: 'true' },
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
```

Always close the MCP client in `finally` so MCP cleanup closes Patchright.

- [ ] **Step 4: Run browser smoke and make only root-cause fixes**

Run: `node --test test/integration/browser-mcp-smoke.test.js`

Expected: headless Patchright opens the local `data:` page, `navigate_page` returns its title, and the test exits.

Only if this test or the OpenCode smoke fails because of `select_page`, session-state naming, MCP schema, or workflow references may the corresponding minimal change be added. Add a focused regression test beside every such fix; do not broaden the refactor.

- [ ] **Step 5: Implement packed CLI smoke**

Create `scripts/smoke-packed-cli.mjs` with this flow:

```js
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
  const packed = JSON.parse(execFileSync(
    'npm',
    ['pack', '--json', '--pack-destination', tempRoot],
    { cwd: projectRoot, encoding: 'utf8' }
  ))
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
```

Use argument arrays throughout; do not build shell command strings.

- [ ] **Step 6: Run packed CLI smoke**

Run: `npm run smoke:pack`

Expected: the tarball installs without repository `node_modules`; both CLI commands exit 0.

- [ ] **Step 7: Update release checks and minimal user docs**

In `.github/workflows/publish.yml`, after lint add:

```yaml
- run: pnpm test
- run: pnpm smoke:pack
```

Do not add browser integration to tag publishing because install currently uses `--ignore-scripts` and intentionally does not download Chromium.

Update `README.md` to describe only `link-auth`/`fresh`, OpenCode V2 Runtime readiness and the existing CLI commands. Replace `.env.example` contents with variables actually read by production code:

```dotenv
DEEPSPIDER_HEADLESS=false
# DEEPSPIDER_USER_DATA_DIR=/absolute/path/to/browser-profile
```

- [ ] **Step 8: Run the complete acceptance suite**

Run:

```bash
npm test
npm run lint
npm run test:integration
npm run smoke:pack
npm pack --dry-run
git diff --check
git status --short
```

Expected:

- unit tests pass;
- lint has zero errors and no new warnings;
- real OpenCode, Plugin and MCP reach ready;
- local Patchright browser tool succeeds;
- all child processes exit;
- packed CLI installs and runs from an empty directory;
- package dry-run contains `bin/`, `src/`, `agents/`, `plugins/`, `skills/` and required manifests.

- [ ] **Step 9: Commit Task 6**

Stage only the files used by the verified solution, including any conditional root-cause fix and its focused regression test:

```bash
git add test/integration scripts/smoke-packed-cli.mjs .github/workflows/publish.yml README.md .env.example
git commit -m "test: verify opencode v2 integration"
```

If a conditional root-cause fix was necessary, add only its explicit source path and focused regression-test path to the same commit after reviewing `git diff --name-only`.

## Final Review Gate

- [ ] Compare every changed file with `docs/superpowers/specs/2026-08-12-opencode-v2-integration-design.md`.
- [ ] Confirm no Camoufox dependency, dual-browser abstraction or OpenCode `1.3.13` branch remains.
- [ ] Confirm `rg -n "1\.3\.13|link-all|dotenv/config|port 4096" src bin plugins package.json README.md` returns no active implementation reference.
- [ ] Confirm any Patchright/MCP/workflow edit has a failing smoke or focused regression test proving necessity.
- [ ] Run `git diff --check` and inspect `git status --short` before delivery.
