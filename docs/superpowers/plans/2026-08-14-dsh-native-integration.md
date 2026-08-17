# DeepSpider Native DSH Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish replacing OpenCode with DeepSeek Harness (DSH), expose all 51 DeepSpider reverse-engineering tools through native Code Mode and MCP, and keep every DSH Session's browser, evidence, and artifacts isolated.

**Architecture:** DSH owns the product-facing Host and Agent planes: Web UI, models, credentials, Sessions, Goals, standard tools, persistence, and compaction. DeepSpider contributes one process-wide `RuntimeManager`; each exact `agent.id` owns one lazy `DeepSpiderRuntime`, Patchright browser, DataStore, and hashed artifact root. One immutable Tool Catalog feeds both a native DSH adapter and the external MCP adapter.

**Tech Stack:** Node.js `>=24.0.0`, pnpm `11.21.0`, ESM, DeepSeek Harness/Cordis public plugin APIs, `@deepseek-ai/dsh-tools`, Patchright Chromium, MCP SDK, Zod 4, `node:test`.

**Spec:** `docs/superpowers/specs/2026-08-14-dsh-native-integration-design.md`

## Global Constraints

- Work directly on `main`; commit each task only after its focused checks are green.
- Do not fork DSH or import unpublished DSH source paths.
- Follow current releases: `@deepseek-ai/dsh` and `@deepseek-ai/cordis` use `latest`; `@deepseek-ai/dsh-tools` uses `next` until its `latest` dist-tag reaches the current DSH release line. The lockfile records the tested snapshot.
- Do not directly depend on `@deepseek-ai/schemastery`; DeepSpider does not define user-facing DSH configuration schemas.
- Do not add compatibility code for OpenCode, Node 20/22, older DSH releases, old settings, or the removed Agent layout.
- One exact DSH `agent.id` is the Session identity. MCP uses one process-unique synthetic identity. Never select state by newest directory or active global.
- Captured target JavaScript is immutable. Repair the environment through Hooks and `env.js`; preserve truncation rejection, target hashes, trace integrity, timeout evidence, and Node-identity concealment.
- Browser execution gathers evidence. The normal final deliverable remains a direct non-browser request implementation.
- Patchright Chromium is the only browser backend. Do not add Camoufox or a browser abstraction layer.
- Keep the approved DSH surface only: Goals, Todo, Code Mode, Cordis dynamic tools, `web_search`, Bash, filesystem/search, jobs, Ask User, Skills, compaction, and pruning.
- Do not mount Plan Mode, Subagents, Workflows, Ralph, `web_fetch`, or `evolve_skill`.
- Cordis dynamic tools are intentionally shell-level trusted Host mutation; do not claim that arbitrary Cordis mutations are Session-isolated.
- Every async domain tool receives the owning operation's `AbortSignal`. Process shutdown aborts active work and awaits browser cleanup.
- Do not build migration, merge, or fallback behavior for package-managed Preset/Skill copies. Replace those two managed directories on launch.
- Keep this implementation narrow. Test the normal lifecycle and the security/correctness invariants already present; do not build frameworks for rare edge cases.

## Completed Groundwork

The following commits are the starting point and must not be reimplemented:

- `e673c09` / `1ab7b17`: Node 24, pnpm 11, DSH packages, secure Session paths.
- `4012086` / `8e9b547`: per-Agent `RuntimeManager`, serialized same-Session operations, parallel cross-Session operations, awaited shutdown.
- `7a67e35` / `fdfdf6a`: browser, console, WebSocket, Frame, and debugger state moved into `DeepSpiderRuntime`.
- `dd608ae` / `099c27b`: framework-neutral Tool Catalog and MCP schema/dispatch adapter.
- `a5d7b8c` / `0e73401`: 44 browser/network/debugger/Hook/stealth tools migrated to the Catalog with listener isolation.

This plan replaces the former Tasks 7–14. There is no checkpoint task and no dynamic Skill mutation task.

---

## Task 1: Make DataStore and Browser Capture Session-Owned

**Files:**

- Modify: `src/store/DataStore.js`
- Modify: `src/runtime/DeepSpiderRuntime.js`
- Modify: `src/browser/client.js`
- Modify: `src/browser/interceptors/NetworkInterceptor.js`
- Modify: `src/browser/interceptors/ScriptInterceptor.js`
- Create: `test/data-store-isolation.test.js`
- Modify: `test/runtime-state-isolation.test.js`

**Interfaces:**

```js
new DataStore({ root })
new BrowserClient({ dataStore })
new NetworkInterceptor(cdpClient, page, dataStore)
new ScriptInterceptor(cdpClient, page, dataStore)
```

`root` is exactly one Runtime's `paths.data`. A `DataStore` instance derives `sitesDir` and `globalIndexPath` from that root and imports no process-global storage path. `BrowserClient` and both interceptors require the injected instance; there is no `getDataStore()` singleton.

- [ ] Add `test/data-store-isolation.test.js` with two temporary roots. Save one response and one script with the same site/IDs in both stores, then prove indexes, source files, search results, cleanup, and current capture Session IDs do not cross roots.

- [ ] Extend `test/runtime-state-isolation.test.js` to create two real default `DeepSpiderRuntime` instances under different temporary Session roots and assert:

  - `runtimeA.dataStore !== runtimeB.dataStore`;
  - each DataStore root equals its Runtime's `paths.data`;
  - each default BrowserClient receives the same DataStore instance owned by its Runtime.

- [ ] Run the focused tests and confirm RED:

```bash
node --test test/data-store-isolation.test.js test/runtime-state-isolation.test.js
```

Expected: failure because `DataStore` still uses module constants and all browser interceptors still call the singleton.

- [ ] Refactor `DataStore`:

  - validate `root` as a non-empty absolute path;
  - set `this.root`, `this.sitesDir`, and `this.globalIndexPath` in the constructor;
  - replace every `DATA_DIR`, `SITES_DIR`, and `GLOBAL_INDEX` use with those instance fields;
  - preserve `0o700` directory creation, `0o600` sensitive files, path containment, site locks, cleanup locking, full-file search fallback, and existing storage limits;
  - delete the module singleton and `getDataStore()` export.

- [ ] Change the default Runtime factories to the exact ownership chain:

```js
dataStoreFactory = ({ paths }) => new DataStore({ root: paths.data })
browserFactory = ({ dataStore }) => new BrowserClient({ dataStore })
```

- [ ] Change `BrowserClient` to store the required `dataStore`, call `startSession()` on that instance in `launch()`, and pass it to both interceptors created by `setupPage()`.

- [ ] Remove all `getDataStore` imports from Runtime, browser, and interceptors. Do not add a temporary alias.

- [ ] Run focused and regression checks:

```bash
node --test test/data-store-isolation.test.js test/runtime-state-isolation.test.js test/runtime-manager.test.js test/script-tools.test.js test/rebuild-tools.test.js
pnpm lint
git diff --check
```

Expected: all tests pass; lint has no errors or new warnings.

- [ ] Commit:

```bash
git add src/store/DataStore.js src/runtime/DeepSpiderRuntime.js src/browser/client.js src/browser/interceptors/NetworkInterceptor.js src/browser/interceptors/ScriptInterceptor.js test/data-store-isolation.test.js test/runtime-state-isolation.test.js
git commit -m "refactor(runtime): isolate captured data by session"
```

---

## Task 2: Finish the 51-Tool Catalog and Make MCP Process-Unique

**Files:**

- Create: `src/tools/groups/script.js`
- Create: `src/tools/groups/capture.js`
- Create: `src/tools/groups/rebuild.js`
- Create: `src/tools/index.js`
- Modify: `src/mcp/context.js`
- Modify: `src/mcp/server.js`
- Delete: `src/mcp/tools/script.js`
- Delete: `src/mcp/tools/capture.js`
- Delete: `src/mcp/tools/rebuild.js`
- Modify: `test/script-tools.test.js`
- Modify: `test/capture-tools.test.js`
- Modify: `test/rebuild-tools.test.js`
- Modify: `test/tool-catalog.test.js`
- Modify: `test/mcp-lifecycle.test.js`
- Modify: `test/integration/browser-mcp-smoke.test.js`

**Interfaces:**

```js
export const DEEPSPIDER_TOOL_COUNT = 51
export const deepSpiderCatalog = createToolCatalog([
  browserTools,
  networkTools,
  debuggerTools,
  hookTools,
  stealthTools,
  scriptTools,
  captureTools,
  rebuildTools,
])

export function createMcpSessionId(randomUUIDFn = randomUUID)
// => `mcp-${randomUUIDFn()}`
```

The remaining tool names are exactly:

```text
list_scripts
get_script_source
find_in_script
collect_env
collect_property
export_rebuild_bundle
analyze_runtime_trace
```

- [ ] Rewrite the three focused suites to import Catalog groups and call `definition.execute(runtime, args, signal)` directly. Fake Runtimes expose only the properties the domain handlers need.

- [ ] Extend `test/tool-catalog.test.js` to assert:

  - the central catalog has exactly 51 unique names in stable group order;
  - every definition and parameter tree is frozen;
  - all handlers have the three-argument Runtime contract;
  - the seven names above are present and no `evolve_skill` exists;
  - MCP registers exactly the central catalog, with no second legacy registration path.

- [ ] Extend `test/mcp-lifecycle.test.js` to inject a deterministic UUID function and prove two default contexts receive different `mcp-<uuid>` identities while an explicitly supplied test ID stays unchanged for that process context.

- [ ] Run the focused tests and confirm RED:

```bash
node --test test/script-tools.test.js test/capture-tools.test.js test/rebuild-tools.test.js test/tool-catalog.test.js test/mcp-lifecycle.test.js
```

Expected: module-not-found and 44-versus-51 contract failures.

- [ ] Move the seven handlers into Catalog definitions:

  - return canonical domain JSON, never MCP `{ content, isError }` envelopes;
  - use `runtime.dataStore`, `runtime.paths.rebuild`, `runtime.getPage()`, `runtime.getActiveFrameContext()`, and `runtime.cdpEvaluate()` directly;
  - throw `DeepSpiderToolError` with stable codes for expected domain failures;
  - keep `collect_property` main-frame and iframe facts on the same complete schema;
  - keep rebuild tasks non-overwriting and rooted only below `runtime.paths.rebuild`;
  - preserve truncated-target rejection, unchanged `target.js`, manifest hashes, dynamic-source integrity, trace aggregation, runtime exception/timeout evidence, and stack concealment.

- [ ] Add `src/tools/index.js` as the only complete group assembly. MCP and DSH must import `deepSpiderCatalog` from this module rather than repeat the group list.

- [ ] Change the MCP context default from the literal `mcp-stdio` to `createMcpSessionId()`. Generate it once when `src/mcp/server.js` starts, reuse it for all calls in that process, and keep explicit `sessionId` injection for tests.

- [ ] Delete all three legacy MCP tool modules. `src/mcp/server.js` must have one tool registration statement:

```js
registerMcpCatalog(server, deepSpiderCatalog, {
  runtimeManager,
  agent: context.agent,
})
```

- [ ] Run the full reverse-tool and real MCP checks:

```bash
node --test test/script-tools.test.js test/capture-tools.test.js test/rebuild-tools.test.js test/rebuild-bundle.test.js test/rebuild-runtime.test.js test/rebuild-trace.test.js test/rebuild-protected-target.test.js test/rebuild-workflow-contract.test.js test/tool-catalog.test.js test/mcp-lifecycle.test.js test/runtime-state-isolation.test.js
node --test test/integration/browser-mcp-smoke.test.js
pnpm lint
git diff --check
```

Expected: all exit 0; the real MCP server reports and exposes 51 Catalog tools.

- [ ] Confirm there is no singleton/legacy registration residue:

```bash
rg -n "getDataStore|registerScriptTools|registerCaptureTools|registerRebuildTools|mcp-stdio" src test
```

Expected: no production match; an explicit test fixture string is allowed only where identity injection is under test.

- [ ] Commit:

```bash
git add -A src/tools src/mcp test/script-tools.test.js test/capture-tools.test.js test/rebuild-tools.test.js test/tool-catalog.test.js test/mcp-lifecycle.test.js test/integration/browser-mcp-smoke.test.js
git commit -m "refactor(tools): complete the shared tool catalog"
```

---

## Task 3: Add Native DSH Adapter, Host Service, and Agent Plugin

**Files:**

- Create: `src/adapters/dsh-tools.js`
- Create: `src/dsh/host-plugin.js`
- Create: `src/dsh/agent-plugin.js`
- Create: `test/dsh-tools.test.js`
- Create: `test/dsh-host-plugin.test.js`
- Create: `test/dsh-agent-plugin.test.js`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `test/dependencies.test.js`

**Interfaces:**

```js
export function registerDshCatalog(ctx, catalog, { runtimeManager })

// src/dsh/host-plugin.js
export const name = 'deepspider-host'
export const provide = 'deepSpiderRuntimeManager'
export const inject = ['agents']
export function apply(ctx, config = {})

// src/dsh/agent-plugin.js
export const name = 'deepspider-agent'
export const inject = ['tools', 'systemPrompt', 'deepSpiderRuntimeManager']
export function apply(ctx)
```

The Host-provided value is the one process-wide `RuntimeManager`. The Agent plugin is stateless and registers the shared Catalog into the current Agent scope.

- [ ] Change only `@deepseek-ai/dsh-tools` from `latest` to `next`, run `pnpm install`, and extend `test/dependencies.test.js` to enforce this three-package policy:

```json
{
  "@deepseek-ai/cordis": "latest",
  "@deepseek-ai/dsh": "latest",
  "@deepseek-ai/dsh-tools": "next"
}
```

Do not remove OpenCode or Schemastery yet; Task 4 deletes them in one runnable boundary.

- [ ] Add adapter tests using a fake `ctx.tools.register` and real `defineTool` output. Prove for a representative definition that:

  - `name`, `description`, and the Catalog parameter spec pass through unchanged;
  - output is declared as `{ schema: { type: 'json' }, render(...) }`;
  - `execute(args, exec)` requires `exec.agent.id`;
  - the exact `exec.agent` and `exec.signal` reach `RuntimeManager.run()` and the domain handler;
  - successful canonical JSON is returned unchanged;
  - a Catalog `render(value)` becomes one DSH text block;
  - a `DeepSpiderToolError` becomes a failed native tool call with the stable user-visible message `[CODE] message` and is not converted to an MCP envelope.

- [ ] Add Host plugin tests with a real Cordis `Context` or a contract-faithful fake. Prove:

  - exactly one manager is provided as `deepSpiderRuntimeManager`;
  - `config.runtimeManager` may inject a test manager but is not exposed as a product option;
  - `agent/disposed` calls `disposeAgent()` for the exact payload Agent;
  - the plugin effect disposer calls and awaits `closeAll()`;
  - the Host plugin registers no model-facing tool or custom Session projection.

- [ ] Add Agent plugin tests proving:

  - all 51 `deepSpiderCatalog` definitions are registered through `registerDshCatalog`;
  - one stable system-prompt section is registered;
  - the prompt requires generic reverse analysis, browser evidence, immutable target, Hook/env repair, Node-environment probing/concealment, and request-level verification;
  - the plugin owns no module-level Agent, Runtime, Page, Frame, browser, DataStore, selected task, or checkpoint state;
  - `evolve_skill` and a custom checkpoint event are absent.

- [ ] Run the new tests and confirm RED before implementation:

```bash
node --test test/dependencies.test.js test/dsh-tools.test.js test/dsh-host-plugin.test.js test/dsh-agent-plugin.test.js
```

- [ ] Implement `registerDshCatalog()` with only public `@deepseek-ai/dsh-tools` exports:

```js
ctx.tools.register(defineTool({
  name: definition.name,
  description: definition.description,
  parameters: definition.parameters,
  output: {
    schema: { type: 'json' },
    render: (_args, value) => [{
      type: 'text',
      text: definition.render
        ? definition.render(value)
        : JSON.stringify(value, null, 2),
    }],
  },
  async execute(args, exec) {
    if (typeof exec.agent?.id !== 'string' || exec.agent.id.length === 0) {
      throw new Error('[DSH_AGENT_REQUIRED] Native DeepSpider tools require an Agent Session')
    }
    try {
      return await runtimeManager.run(
        exec.agent,
        (runtime, signal) => definition.execute(runtime, args, signal),
        { signal: exec.signal },
      )
    } catch (error) {
      if (error instanceof DeepSpiderToolError) {
        throw new Error(`[${error.code}] ${error.message}`, { cause: error })
      }
      throw error
    }
  },
}))
```

Do not import Schemastery or `@deepseek-ai/dsh-llm`, and do not create a second parameter translator. MCP keeps its structured `{ code, message, details }` error envelope; the native DSH boundary keeps the same code in deterministic text because only DSH-owned `HarnessError` instances receive structured DSH error metadata.

- [ ] Implement the Host plugin with `ctx.provide('deepSpiderRuntimeManager', manager)`, `ctx.on('agent/disposed', ...)`, and `ctx.effect(() => () => manager.closeAll(...))`. Let `RuntimeManager` track in-flight disposal so final Host shutdown awaits browser cleanup even though `agent/disposed` itself is an emitted event.

- [ ] Implement the Agent plugin with one Catalog registration call and one concise invariant prompt section. Do not duplicate the full Skill or eight-stage workflow text.

- [ ] Run focused and existing Runtime/Catalog checks:

```bash
node --test test/dependencies.test.js test/dsh-tools.test.js test/dsh-host-plugin.test.js test/dsh-agent-plugin.test.js test/tool-catalog.test.js test/runtime-manager.test.js
pnpm test
pnpm lint
git diff --check
```

Expected: all unit tests pass; lint has no errors.

- [ ] Commit:

```bash
git add src/adapters/dsh-tools.js src/dsh/host-plugin.js src/dsh/agent-plugin.js test/dsh-tools.test.js test/dsh-host-plugin.test.js test/dsh-agent-plugin.test.js package.json pnpm-lock.yaml test/dependencies.test.js
git commit -m "feat(dsh): register native DeepSpider runtime tools"
```

---

## Task 4: Compose the Spider Preset, Launch DSH Web, and Delete OpenCode

**Files:**

- Create: `dsh/cordis.patch.yml`
- Create: `dsh/agent-presets/spider/agent.cordis.yml`
- Create: `dsh/agent-presets/spider/preset.yml`
- Create: `src/dsh/launcher.js`
- Create: `test/dsh-composition.test.js`
- Create: `test/dsh-launcher.test.js`
- Modify: `bin/cli.js`
- Modify: `src/cli/commands/help.js`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `pnpm-workspace.yaml`
- Modify: `scripts/smoke-packed-cli.mjs`
- Delete: `src/agent/config.js`
- Delete: `src/agent/index.js`
- Delete: `src/agent/opencode-binary.js`
- Delete: `src/agent/runtime.js`
- Delete: `src/agent/sandbox.js`
- Delete: `src/agent/tui.js`
- Delete: `src/cli/commands/config.js`
- Delete: `plugins/deepspider-plugin/package.json`
- Delete: `plugins/deepspider-plugin/server.js`
- Delete: `agents/spider.md`
- Delete: `test/agent-config.test.js`
- Delete: `test/agent-index.test.js`
- Delete: `test/agent-runtime.test.js`
- Delete: `test/opencode-binary.test.js`
- Delete: `test/sandbox.test.js`
- Delete: `test/config-command.test.js`
- Delete: `test/plugin-security.test.js`
- Delete: `test/integration/opencode-smoke.test.js`

**Launcher interfaces:**

```js
export function resolveDshBinary({ packageJsonPath } = {})
export function resolveDshLayout({ packageRoot, env } = {})
export function syncManagedDshAssets(layout)
export function buildDshLaunch({ port, verbose, packageRoot, env } = {})
export function startDshAgent(options)
// => { child, closed, close(reason) }
```

`resolveDshBinary()` reads `@deepseek-ai/dsh/package.json` and resolves its declared `bin.dsh`; it never uses `node_modules/.bin`. `syncManagedDshAssets()` replaces only these two resolved targets:

```text
$DSH_HOME/.agent-presets/spider
$DSH_HOME/skills/deepspider
```

The launcher then starts:

```text
<process.execPath> <real dsh bin> web --patch <installed dsh/cordis.patch.yml> [--port N] [--verbose]
```

with `shell: false`, inherited stdio, and default `DSH_PERMISSION_MODE=danger-full-access`.

- [ ] Add composition tests that validate the source Preset contract before boot:

  - `preset.yml` identifies `spider` clearly;
  - `agent.cordis.yml` contains persona, agent instructions, Bash/Pwsh, filesystem/search, jobs, Skill discovery/tool, Goals, compaction/pruning, Ask User, Todo, Web search, Cordis, Code Mode, and the DeepSpider Agent plugin;
  - Web config is exactly `fetch: false` with search enabled;
  - presentation config is exactly `mode: code`;
  - Plan Mode, Subagents, Workflows, Ralph, and evolve tooling are absent;
  - `dsh/cordis.patch.yml` mounts the Host plugin and changes the existing `agent-presets` row's default to `spider`.

- [ ] Add a real DSH composition check using a temporary `DSH_HOME`:

```bash
DSH_HOME=/private/tmp/deepspider-dsh-composition \
DEEPSPIDER_HOST_PLUGIN_PATH="$PWD/src/dsh/host-plugin.js" \
node "$(node -p \"const p=require.resolve('@deepseek-ai/dsh/package.json'); const j=require(p); require('node:path').resolve(require('node:path').dirname(p), j.bin.dsh)\")" \
  web --patch dsh/cordis.patch.yml --dump-config
```

Parse the dumped composition and assert the Host plugin resolves, `agent-presets.default` is `spider`, and the Web profile still supplies `codeRuntime`, Session persistence, Goals, permissions, and the model route. This is the loader-level proof; YAML text matching alone is insufficient.

- [ ] Add launcher tests for:

  - real package-manifest binary resolution;
  - package-root paths when installed under a temporary `node_modules/deepspider` layout;
  - exact replacement of the managed Preset and Skill directories, including removal of a stale file;
  - preservation of all unrelated `$DSH_HOME` files/directories;
  - exact `web --patch` argv, `--port 0`, `--verbose`, `shell: false`, inherited stdio, and YOLO default;
  - preserving an explicitly supplied `DSH_PERMISSION_MODE`;
  - `DEEPSPIDER_HOST_PLUGIN_PATH` pointing to the installed `src/dsh/host-plugin.js`;
  - `DEEPSPIDER_AGENT_PLUGIN_PATH` pointing to the installed `src/dsh/agent-plugin.js`, so the copied Preset does not resolve back into the source checkout;
  - child spawn error/non-zero exit propagation, idempotent `close()`, and signal-driven shutdown.

- [ ] Run the new tests and confirm RED:

```bash
node --test test/dsh-composition.test.js test/dsh-launcher.test.js
```

- [ ] Build `dsh/agent-presets/spider/agent.cordis.yml` from the installed DSH `code` Preset structure, keeping only approved rows. Add:

```yaml
- id: tool-cordis
  name: '@deepseek-ai/dsh-tool-cordis'

- id: deepspider-agent
  name: !!js process.env.DEEPSPIDER_AGENT_PLUGIN_PATH
```

Keep the compaction group isolation from DSH's shipped Preset. Do not copy DSH plugin implementations.

- [ ] Write the package patch as the minimal overlay:

```yaml
- id: deepspider-host
  name: !!js process.env.DEEPSPIDER_HOST_PLUGIN_PATH

- id: agent-presets
  config:
    default: spider
```

Both plugin-path environment variables are computed by the launcher from the installed package root; neither YAML file contains a source-checkout path.

- [ ] Implement the launcher. Determine DSH home as `env.DSH_HOME || path.join(os.homedir(), '.dsh')`; copy the package Preset and static `skills/deepspider` directory before every spawn. No merge, backup, migration, or old-layout detection.

- [ ] Replace the `agent` branch in `bin/cli.js`:

  - accept only `--port <number>` and `--verbose`;
  - handle `agent --help` without starting DSH;
  - remove `--model` and the `config` command;
  - on SIGINT/SIGTERM call launcher `close()` and await the child/Host cleanup;
  - preserve conventional exit codes 130/143 for signals and the child exit code otherwise.

- [ ] Delete the OpenCode runtime, sandbox, TUI, plugin, Agent markdown, config command, and all tests that exist solely for them. Remove `gray-matter`, `@opencode-ai/plugin`, `@opencode-ai/sdk`, `opencode-ai`, and direct `@deepseek-ai/schemastery` from `package.json`; regenerate `pnpm-lock.yaml`.

- [ ] Remove `allowBuilds.opencode-ai` from `pnpm-workspace.yaml`; retain only the `@deepseek-ai/*` minimum-release-age exclusion needed by the current DSH closure.

- [ ] Change `package.json#files` to include `dsh/` and remove `agents/` and `plugins/`. Keep `src/`, `bin/`, `skills/`, both READMEs, and runtime requirement files.

- [ ] Extend the packed CLI smoke to install the tarball with scripts disabled and assert:

  - `--version`, `--help`, and `agent --help` work from the installed tree;
  - the installed launcher resolves the packaged DSH bin, patch, Preset, Agent plugin, and Skill;
  - no path points back to the repository checkout;
  - the smoke does not leave a permanent DSH Web process running.

- [ ] Run focused, packed, and manifest checks:

```bash
node --test test/dsh-composition.test.js test/dsh-launcher.test.js test/dependencies.test.js
pnpm install --frozen-lockfile --ignore-scripts
pnpm test
pnpm lint
pnpm smoke:pack
npm pack --dry-run --json
git diff --check
```

Expected: all exit 0; archive entries include `dsh/`, `src/dsh/`, and `skills/deepspider/`.

- [ ] Confirm OpenCode and removed capability residue is gone from the release surface:

```bash
rg -n -i "opencode|@opencode-ai|evolve_skill" package.json pnpm-lock.yaml pnpm-workspace.yaml bin src test scripts dsh agents plugins || true
```

Expected: no output. Remove empty `agents/` or `plugins/` directories if they remain.

- [ ] Commit:

```bash
git add -A
git commit -m "feat(agent): replace OpenCode with native DSH"
```

---

## Task 5: Update Chinese/English Docs and Continuous DSH Refresh

**Files:**

- Modify: `README.md`
- Modify: `README_EN.md`
- Create: `.github/workflows/dsh-refresh.yml`
- Modify: `.github/workflows/publish.yml`
- Modify: `test/dependencies.test.js`
- Modify: `test/dsh-composition.test.js`

**Documentation contract:**

- Preserve the previous README's reverse-engineering product narrative and eight-stage method.
- Replace OpenCode TUI/configuration with DSH Web, multiple Sessions, Goals, Code Mode, Cordis, and DSH-owned model/credential settings.
- Explain that browser actions are evidence collection and the expected outcome is a direct request implementation.
- Document only current CLI commands: `agent [--port] [--verbose]`, `mcp`, `fetch`, `update`, `--version`, and `--help`.
- State Node.js `>=24.0.0`, pnpm `11.21.0` for development, Patchright Chromium, Session artifact layout, Ctrl+C cleanup, MCP's external-adapter role, and the privileged nature of Cordis dynamic tools.
- Do not add a Camoufox disclaimer sentence; simply document the supported Patchright runtime.
- Do not advertise disabled Plan Mode, Subagents, Workflows, Ralph, `web_fetch`, or evolve behavior as current capabilities.

- [ ] Extend dependency/composition tests to check both READMEs for the current command set and product terms, and to reject OpenCode/config/TUI instructions.

- [ ] Run the focused tests and confirm RED:

```bash
node --test test/dependencies.test.js test/dsh-composition.test.js
```

- [ ] Rewrite both READMEs in parallel. Keep section order and narrative comparable across languages; update examples, architecture tree, runtime paths, development commands, and security notes to match current code.

- [ ] Add `.github/workflows/dsh-refresh.yml` with scheduled and manual triggers. In an ephemeral checkout on Node 24/pnpm 11.21.0:

```bash
pnpm update @deepseek-ai/dsh@latest @deepseek-ai/cordis@latest @deepseek-ai/dsh-tools@next
pnpm test
pnpm lint
pnpm test:integration
pnpm smoke:pack
```

The workflow reports compatibility drift only. It does not commit, push, open a PR, or publish.

- [ ] Expand `.github/workflows/publish.yml` so the checked-in lockfile gate runs unit tests, lint, full integration, and packed-install smoke before publish. Keep Node 24 and pnpm 11.21.0 in both jobs.

- [ ] Run documentation, workflow, and package checks:

```bash
node --test test/dependencies.test.js test/dsh-composition.test.js
pnpm lint
pnpm smoke:pack
npm pack --dry-run --json
git diff --check
```

Expected: all exit 0; both READMEs and DSH assets are present in the archive.

- [ ] Commit:

```bash
git add README.md README_EN.md .github/workflows/dsh-refresh.yml .github/workflows/publish.yml test/dependencies.test.js test/dsh-composition.test.js
git commit -m "docs: document the native DSH workflow"
```

---

## Task 6: Prove Real DSH Multi-Session and Browser Shutdown

**Files:**

- Create: `test/fixtures/dsh/host-probe-plugin.js`
- Create: `test/integration/dsh-smoke.test.js`
- Create: `test/integration/dsh-multisession.test.js`
- Modify: `src/runtime/RuntimeManager.js`
- Modify: `test/runtime-manager.test.js`
- Modify: `test/integration/browser-mcp-smoke.test.js`
- Modify: `scripts/smoke-packed-cli.mjs`
- Modify: `package.json`

**Acceptance scenarios:**

1. Real DSH Web boots through `deepspider agent --port 0` with the Spider Preset selected.
2. The native DSH registry sees 51 DeepSpider tools, while Code Mode presents `run_code` and its generated SDK.
3. Goals, Todo, Cordis, `web_search`, Bash/files/search/jobs/Ask User/Skills/compaction exist; disabled capabilities do not.
4. Two real DSH Agents/Sessions produce distinct Runtime objects, DataStores, browser-data roots, rebuild roots, selected state, and Patchright browser processes.
5. Same-Session operations serialize; two Session operations overlap. This is checked through `RuntimeManager`, not model timing.
6. Disposing Session A removes and closes only Runtime A; Session B can still execute `get_page_info` through native Code Mode.
7. Resuming A's persisted DSH Session creates a fresh Runtime/browser under the same hashed Session root rather than restoring browser memory.
8. SIGTERM to `deepspider agent` triggers Host `closeAll()`. Every exact Chromium PID recorded after a native `navigate_page` call exits before the CLI exits.
9. MCP still reaches the same 51 Catalog definitions and exits without open handles.

- [ ] Build `test/fixtures/dsh/host-probe-plugin.js` as a test-only Host plugin mounted from a temporary `$DSH_HOME/cordis.patch.yml`. It injects public `agents`, `tools`, and `deepSpiderRuntimeManager` services, creates two top-level Agents with `meta.agentPreset: 'spider'`, and drives native Code Mode through:

```js
ctx.tools.execute({
  callId,
  name: 'run_code',
  arguments: {
    description: 'Open the local acceptance page',
    code: `return await tools.navigate_page({ url: ${JSON.stringify(url)} })`,
  },
  agent,
  signal,
})
```

The fixture writes small JSON checkpoints to a path supplied by `DEEPSPIDER_TEST_PROBE_OUTPUT`; it never enters the published package.

- [ ] Add `dsh-smoke.test.js` to:

  - create a fresh HOME/DSH_HOME and local HTTP target;
  - launch the real installed `bin/cli.js agent --port 0`;
  - wait for the printed `dsh web:` URL and HTTP readiness;
  - assert the probe reports `spider`, 51 native definitions, Code Mode `run_code`, and the approved/disabled capability set;
  - terminate and assert bounded clean exit.

- [ ] Add `dsh-multisession.test.js` to let the probe create A and B, navigate both to the local target, and report their Runtime/Session path identities. Assert every isolation field listed above.

- [ ] In the same test, dispose A, wait until the manager no longer contains A, and call `get_page_info` for B through another `run_code` execution. Resume A from persistence and prove its new Runtime object differs while `paths.root` is unchanged.

- [ ] Add one same-ID disposal barrier to `RuntimeManager`: retain the in-flight close promise by Session ID, make a new `get()`/`run()` for that ID await the old close before constructing its replacement Runtime, and clear the barrier in `finally`. Add a focused regression showing a resumed Session cannot open the same `browser-data` directory until its previous browser has closed; unrelated IDs still proceed immediately.

- [ ] After at least one real native `navigate_page`, snapshot the exact descendant Chromium PIDs of the `deepspider agent` child. Send SIGTERM to the CLI, wait for its exit, then poll only those recorded PIDs and assert all are gone. Do not use a broad process kill.

- [ ] Run the new integrations and confirm RED before changing production behavior:

```bash
node --test test/integration/dsh-smoke.test.js
node --test test/integration/dsh-multisession.test.js
node --test test/runtime-manager.test.js
```

- [ ] Make only minimal production fixes exposed by those tests. Do not serialize different Sessions globally, weaken PID assertions, add arbitrary sleeps in place of readiness, or add a second lifecycle manager.

- [ ] Update `package.json#scripts.test:integration` only if needed so Node discovers all integration files explicitly and exits with no open handles. Keep unit discovery separate.

- [ ] Run the complete acceptance matrix:

```bash
pnpm install --frozen-lockfile --ignore-scripts
pnpm test
pnpm lint
pnpm test:integration
pnpm smoke:pack
npm pack --dry-run --json
git diff --check
```

Expected: every command exits 0. Browser integration may require running outside a restricted macOS sandbox because Chromium's Mach port bootstrap is denied there; do not weaken the test for that environment error.

- [ ] Audit release residue and leaks:

```bash
rg -n -i "opencode|@opencode-ai|evolve_skill|deepspider/checkpoint|latest task|most recently modified" package.json pnpm-lock.yaml pnpm-workspace.yaml bin src test scripts dsh README.md README_EN.md .github || true
ps -ax -o pid=,ppid=,command= | rg "deepspider|@deepseek-ai/dsh|patchright|Chromium" || true
```

Expected: no forbidden source/documentation matches and no process created by the acceptance run remains.

- [ ] Confirm repository scope:

```bash
git status --short
git diff --stat 3e31517..HEAD
```

- [ ] Commit:

```bash
git add src/runtime/RuntimeManager.js test/runtime-manager.test.js test/fixtures/dsh/host-probe-plugin.js test/integration/dsh-smoke.test.js test/integration/dsh-multisession.test.js test/integration/browser-mcp-smoke.test.js scripts/smoke-packed-cli.mjs package.json
git commit -m "test: verify native DSH session lifecycle"
```

## Final Review Gate

- [ ] Re-read the design and map every goal/non-goal to a passing test or explicit release check.
- [ ] Confirm `RuntimeManager` is the only process-wide DeepSpider owner registry and every entry is keyed by exact `agent.id`.
- [ ] Confirm no BrowserClient, Page, Frame, CDP session, DataStore, debugger state, capture buffer, selected target, or rebuild task is module-global.
- [ ] Confirm DSH and MCP import the exact same `deepSpiderCatalog` and its count is 51.
- [ ] Confirm DSH Agent disposal starts exact Runtime cleanup and Host disposal awaits all in-flight/per-Session cleanup.
- [ ] Confirm the launcher resolves the real DSH bin, synchronizes only package-managed Preset/Skill directories, starts in YOLO mode, and awaits exit cleanup.
- [ ] Confirm target immutability, trace/timeout evidence, dynamic-source integrity, truncated-script rejection, and stack concealment tests remain green.
- [ ] Confirm Node `>=24.0.0`, pnpm `11.21.0`, `latest` DSH/Cordis, and `next` dsh-tools appear consistently in manifest, CI, docs, and packed installation behavior.
- [ ] Confirm there is no direct Schemastery dependency, OpenCode code/config/documentation, custom checkpoint, `evolve_skill`, Camoufox layer, or vendor/site-specific route.
- [ ] Confirm the scheduled refresh only reports drift and never mutates the repository or publishes.
- [ ] Run `pnpm test`, `pnpm lint`, `pnpm test:integration`, and `pnpm smoke:pack` once more after final review.
- [ ] Request final code review before pushing `main`.
