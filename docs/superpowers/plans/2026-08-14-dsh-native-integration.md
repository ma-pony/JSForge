# DeepSpider Native DSH Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace OpenCode with DeepSeek Harness as DeepSpider's native Agent runtime, while supporting isolated concurrent browser sessions and retaining MCP only as an external adapter.

**Architecture:** DSH owns the Host and Agent planes. A process-wide `RuntimeManager` maps each exact DSH Agent/Session ID to one isolated `DeepSpiderRuntime`; both the native DSH adapter and the external MCP adapter dispatch through one framework-neutral Tool Catalog. Session state is restored from a typed DSH checkpoint projection, while large evidence stays in session-owned hashed directories.

**Tech Stack:** Node.js `>=24.0.0`, ESM, DeepSeek Harness/Cordis public plugin APIs, `@deepseek-ai/dsh-tools`, Schemastery, Patchright, MCP SDK, Zod 4, `node:test`, pnpm.

**Spec:** `docs/superpowers/specs/2026-08-14-dsh-native-integration-design.md`

## Global Constraints

- Work directly on `main`; commit after every green task.
- Do not fork DSH or import its unpublished source paths.
- Declare directly imported DSH packages as `latest`; the lockfile records the tested snapshot.
- Do not add compatibility code for OpenCode, Node 20/22, older DSH releases, or legacy settings.
- One DSH Agent ID is the Session identity. Never infer identity from the newest directory, active page, or process global.
- Captured target JavaScript remains immutable. Environment repair stays in Hook and environment files.
- Browser execution is evidence collection; the normal final deliverable remains a direct non-browser request implementation.
- Use public DSH tool, service, event, projection, Profile/Patch, Bundle, and Preset APIs only.
- Preserve all existing reverse-engineering tool names and behavior unless an adapter boundary requires a protocol-only representation change.
- Every async tool path accepts an `AbortSignal`; shutdown must abort active work and await browser cleanup.
- Do not begin implementation until `node --version` reports Node 24 or later.

---

## Task 1: Raise the Runtime Floor and Add Current DSH Packages

**Files:**

- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `.github/workflows/publish.yml`
- Modify: `test/dependencies.test.js`

**Interfaces:**

- `package.json#engines.node` is exactly `>=24.0.0`.
- Direct dependencies are `@deepseek-ai/dsh`, `@deepseek-ai/cordis`, `@deepseek-ai/dsh-tools`, and `@deepseek-ai/schemastery`, each declared as `latest`.
- OpenCode dependencies remain temporarily until Task 12 so intermediate commits stay runnable.

- [ ] Verify the execution environment before editing:

```bash
node --version
```

Expected: `v24.x.x` or newer. Stop this implementation run if it is older; switch the active Node toolchain instead of adding compatibility code.

- [ ] Extend `test/dependencies.test.js` with assertions for the Node engine and four direct DSH dependency declarations.

- [ ] Run the dependency test and confirm RED:

```bash
node --test test/dependencies.test.js
```

Expected: failure because the current engine is `>=20.19.0` and DSH packages are absent.

- [ ] Update `package.json` and both `actions/setup-node` rows in `.github/workflows/publish.yml` to Node `24`.

- [ ] Add the four DSH packages using their current registry `latest` releases, keep their manifest specifiers as `latest`, and regenerate `pnpm-lock.yaml`:

```bash
pnpm install
```

- [ ] Assert only public package entrypoints are resolvable:

```bash
node -e "for (const p of ['@deepseek-ai/dsh','@deepseek-ai/cordis','@deepseek-ai/dsh-tools','@deepseek-ai/schemastery']) console.log(p, import.meta.resolve(p))"
```

Expected: four installed package URLs and no source-tree import.

- [ ] Run focused and manifest checks:

```bash
node --test test/dependencies.test.js
pnpm install --frozen-lockfile --ignore-scripts
git diff --check
```

Expected: all exit 0.

- [ ] Commit:

```bash
git add package.json pnpm-lock.yaml .github/workflows/publish.yml test/dependencies.test.js
git commit -m "build: require Node 24 and add DSH"
```

---

## Task 2: Make Session Paths a Single Pure Contract

**Files:**

- Create: `src/runtime/SessionPaths.js`
- Create: `test/session-paths.test.js`
- Modify: `src/config/paths.js`

**Interfaces:**

```js
export function hashSessionId(sessionId) // full lowercase SHA-256 hex
export function createSessionPaths(sessionId, { root } = {})
// => { sessionId, key, root, metadata, data, output, rebuild, screenshots, browserData }
export function ensureSessionPaths(paths)
```

`createSessionPaths` rejects empty/non-string IDs. Every derived child must remain under `<root>/<full-sha256>`. `ensureSessionPaths` creates sensitive directories with mode `0o700`.

- [ ] Add `test/session-paths.test.js` covering deterministic full hashes, different session isolation, path containment, invalid IDs, and directory permissions.

- [ ] Run the focused test and confirm RED:

```bash
node --test test/session-paths.test.js
```

Expected: module-not-found failure.

- [ ] Implement `SessionPaths.js` with `node:crypto`, `node:path`, and `node:fs`; default root is `~/.deepspider/sessions`.

- [ ] Change `src/config/paths.js` to reuse the same secure-directory helper where it creates DeepSpider-owned sensitive directories. Do not redirect existing non-session paths yet.

- [ ] Run focused and existing path consumers:

```bash
node --test test/session-paths.test.js test/rebuild-tools.test.js test/script-tools.test.js
pnpm lint
git diff --check
```

Expected: all tests pass; lint has no new warnings or errors.

- [ ] Commit:

```bash
git add src/runtime/SessionPaths.js src/config/paths.js test/session-paths.test.js
git commit -m "feat(runtime): isolate session storage paths"
```

---

## Task 3: Introduce the Session Runtime and Runtime Manager

**Files:**

- Create: `src/runtime/DeepSpiderRuntime.js`
- Create: `src/runtime/RuntimeManager.js`
- Create: `test/runtime-manager.test.js`

**Interfaces:**

```js
export class DeepSpiderRuntime {
  constructor({ sessionId, paths, browserFactory, dataStoreFactory, env })
  getBrowserClient({ signal } = {})
  getPage({ signal } = {})
  getCDPSession({ signal } = {})
  cdpEvaluate(expression, options)
  navigateTo(url, options)
  close(reason)
}

export class RuntimeManager {
  constructor({ runtimeFactory })
  run(agent, operation, { signal } = {})
  get(agent, { signal } = {})
  disposeAgent(agent, reason)
  closeAll(reason)
}
```

`run` serializes operations for one Agent ID. Runtime creation and operations for different Agent IDs proceed concurrently. The manager rejects work after `closeAll()` starts.

- [ ] Write `test/runtime-manager.test.js` covering lazy creation, concurrent first-call deduplication, same-session serialization, cross-session parallelism, retry after failed creation, exact Agent disposal, abort while queued, idempotent runtime close, and `closeAll()` continuing after one cleanup failure.

- [ ] Run the focused test and confirm RED:

```bash
node --test test/runtime-manager.test.js
```

Expected: module-not-found failures.

- [ ] Implement `DeepSpiderRuntime` as an explicit owner of paths, browser lifecycle, active frame, CDP state, capture collections, selected target, rebuild context, and DataStore. Browser creation remains lazy.

- [ ] Implement `RuntimeManager` with a `Map` keyed by `agent.id`, one shared creation promise per key, one promise queue per key, and one manager-level closing flag.

- [ ] Ensure cancellation is checked before queueing, after queue acquisition, and before returning a lazily created Runtime.

- [ ] Run focused tests and static checks:

```bash
node --test test/runtime-manager.test.js test/mcp-lifecycle.test.js
pnpm lint
git diff --check
```

Expected: all exit 0.

- [ ] Commit:

```bash
git add src/runtime/DeepSpiderRuntime.js src/runtime/RuntimeManager.js test/runtime-manager.test.js
git commit -m "feat(runtime): manage isolated agent runtimes"
```

---

## Task 4: Remove Browser and Debug State from Module Globals

**Files:**

- Modify: `src/runtime/DeepSpiderRuntime.js`
- Modify: `src/mcp/context.js`
- Modify: `src/mcp/tools/browser.js`
- Modify: `src/mcp/tools/network.js`
- Modify: `src/mcp/tools/debugger.js`
- Modify: `src/mcp/tools/capture.js`
- Create: `test/runtime-state-isolation.test.js`
- Modify: `test/mcp-lifecycle.test.js`

**Interfaces:**

- `createMcpContext({ sessionId = 'mcp-stdio', runtimeManager } = {})` returns runtime-bound context methods.
- Tool modules no longer own `_savedSessionState`, console tracking, WebSocket buffers, CDP session, pause state, frames, or breakpoints at module scope.
- The single stdio MCP process uses a standalone synthetic Agent `{ id: 'mcp-stdio' }`.

- [ ] Add a state-isolation test that creates two Runtimes, mutates selected Frame, console, WebSocket, debugger, target-script, and rebuild state in one, and asserts the other remains empty.

- [ ] Extend lifecycle coverage so cleanup closes the synthetic MCP Runtime through `RuntimeManager.closeAll()`.

- [ ] Run the focused tests and confirm RED:

```bash
node --test test/runtime-state-isolation.test.js test/mcp-lifecycle.test.js
```

Expected: failures demonstrating shared module state or missing runtime fields.

- [ ] Move all mutable fields into `DeepSpiderRuntime`. Keep constants and pure helper functions in tool modules.

- [ ] Refactor `src/mcp/context.js` into a context factory that delegates browser/CDP/frame operations to an explicit Runtime. Remove singleton exports after all call sites in this task use the factory.

- [ ] Make page switching and navigation clear only the owning Runtime's frame/CDP-derived state. Make listener installation idempotent per Runtime.

- [ ] Run focused, browser-tool, and lifecycle tests:

```bash
node --test test/runtime-state-isolation.test.js test/mcp-lifecycle.test.js test/capture-tools.test.js test/script-tools.test.js test/rebuild-tools.test.js
pnpm lint
git diff --check
```

Expected: all exit 0 and `rg` finds no mutable top-level session arrays/variables in the three stateful tool modules.

- [ ] Commit:

```bash
git add src/runtime/DeepSpiderRuntime.js src/mcp/context.js src/mcp/tools/browser.js src/mcp/tools/network.js src/mcp/tools/debugger.js src/mcp/tools/capture.js test/runtime-state-isolation.test.js test/mcp-lifecycle.test.js
git commit -m "refactor(runtime): scope browser state by session"
```

---

## Task 5: Create the Framework-Neutral Tool Catalog and MCP Adapter

**Files:**

- Create: `src/tools/catalog.js`
- Create: `src/tools/errors.js`
- Create: `src/adapters/mcp-schema.js`
- Create: `src/adapters/mcp-tools.js`
- Create: `test/tool-catalog.test.js`
- Create: `test/mcp-schema.test.js`
- Modify: `src/mcp/server.js`

**Interfaces:**

```js
export function defineDeepSpiderTool({ name, description, parameters, execute, render })
export function createToolCatalog(groups)
export class DeepSpiderToolError extends Error { code; details }
export function parameterSpecToZodShape(spec)
export function registerMcpCatalog(server, catalog, { runtimeManager, agent })
```

Catalog parameter schemas use DSH's public plain `ParameterSchemaSpec`. The MCP converter supports only the shapes actually used by DeepSpider: string, number, integer, boolean, array, object, json, enum, const, `oneOf`, optional properties, and required properties. Tool handlers return domain JSON values or throw `DeepSpiderToolError`; adapters own protocol envelopes.

- [ ] Add catalog tests for duplicate-name rejection, immutable definitions, explicit Runtime dispatch, signal forwarding, JSON rendering, and typed errors.

- [ ] Add schema tests for every supported shape and for clear rejection of unsupported shapes.

- [ ] Run focused tests and confirm RED:

```bash
node --test test/tool-catalog.test.js test/mcp-schema.test.js
```

Expected: module-not-found failures.

- [ ] Implement the catalog primitives and typed error.

- [ ] Implement the small DSH-spec-to-Zod converter; do not add a general JSON Schema library.

- [ ] Implement `registerMcpCatalog` using `server.registerTool`. Resolve the synthetic MCP Runtime through `RuntimeManager.run`, translate results to MCP text content, and map typed errors to `isError: true`.

- [ ] Change `src/mcp/server.js` to construct the standalone manager/Agent and register an initially empty catalog through the adapter alongside the still-unmigrated legacy groups. This commit establishes the boundary without changing published tools.

- [ ] Run focused and server lifecycle checks:

```bash
node --test test/tool-catalog.test.js test/mcp-schema.test.js test/mcp-lifecycle.test.js
pnpm lint
git diff --check
```

Expected: all exit 0.

- [ ] Commit:

```bash
git add src/tools/catalog.js src/tools/errors.js src/adapters/mcp-schema.js src/adapters/mcp-tools.js src/mcp/server.js test/tool-catalog.test.js test/mcp-schema.test.js
git commit -m "refactor(tools): add framework-neutral catalog"
```

---

## Task 6: Migrate Browser-Facing Tools into the Catalog

**Files:**

- Create: `src/tools/groups/browser.js`
- Create: `src/tools/groups/network.js`
- Create: `src/tools/groups/debugger.js`
- Create: `src/tools/groups/hook.js`
- Create: `src/tools/groups/stealth.js`
- Modify: `src/tools/catalog.js`
- Modify: `src/mcp/server.js`
- Delete: `src/mcp/tools/browser.js`
- Delete: `src/mcp/tools/network.js`
- Delete: `src/mcp/tools/debugger.js`
- Delete: `src/mcp/tools/hook.js`
- Delete: `src/mcp/tools/stealth.js`
- Modify: `test/tool-catalog.test.js`
- Modify: `test/runtime-state-isolation.test.js`

**Interfaces:**

- Every group exports `tools`, an array of catalog definitions.
- Every handler signature is `execute(runtime, args, signal)`.
- Tool names and argument contracts remain the existing public names.
- Browser, Network, Debugger, Hook, and Stealth handlers access state only through their supplied Runtime.

- [ ] Extend the catalog test to snapshot the names and parameter specs of all live browser-facing tools and assert each handler receives a Runtime explicitly.

- [ ] Run the focused test and confirm RED because the group modules do not exist:

```bash
node --test test/tool-catalog.test.js test/runtime-state-isolation.test.js
```

- [ ] Move pure descriptions, schemas, and handlers group by group. Replace calls to MCP context globals with Runtime methods/fields. Replace MCP envelopes inside handlers with domain JSON returns.

- [ ] Register these definitions only through `registerMcpCatalog`; delete their legacy `register*Tools` modules immediately so a tool cannot be registered twice.

- [ ] Preserve operation cancellation by passing `signal` into navigation, evaluation, waits, CDP calls, and loops.

- [ ] Verify tool count, contracts, state isolation, and a real browser smoke:

```bash
node --test test/tool-catalog.test.js test/runtime-state-isolation.test.js test/mcp-lifecycle.test.js
node --test test/integration/browser-mcp-smoke.test.js
pnpm lint
git diff --check
```

Expected: the MCP smoke exits 0 and all migrated tool names are registered exactly once.

- [ ] Commit:

```bash
git add src/tools src/mcp/server.js src/mcp/tools test/tool-catalog.test.js test/runtime-state-isolation.test.js
git commit -m "refactor(tools): migrate browser tools to catalog"
```

---

## Task 7: Migrate Evidence and Rebuild Tools into the Catalog

**Files:**

- Create: `src/tools/groups/script.js`
- Create: `src/tools/groups/capture.js`
- Create: `src/tools/groups/rebuild.js`
- Modify: `src/tools/catalog.js`
- Modify: `src/runtime/DeepSpiderRuntime.js`
- Modify: `src/store/DataStore.js`
- Modify: `src/mcp/server.js`
- Delete: `src/mcp/tools/script.js`
- Delete: `src/mcp/tools/capture.js`
- Delete: `src/mcp/tools/rebuild.js`
- Modify: `test/script-tools.test.js`
- Modify: `test/capture-tools.test.js`
- Modify: `test/rebuild-tools.test.js`
- Modify: `test/tool-catalog.test.js`

**Interfaces:**

- `DeepSpiderRuntime.dataStore` is created with its Session `data` path.
- Artifact-producing tools write only beneath the supplied Runtime's `SessionPaths`.
- `export_script_for_rebuild`, probe, patch, trace, and verification retain immutable-target checks and hashes.
- Tool outputs contain session-relative artifact references rather than process-global or newest-directory paths.

- [ ] Rewrite the three focused test suites to call catalog handlers with explicit fake Runtimes and assert session-owned paths.

- [ ] Add a two-Runtime test proving script IDs, capture indexes, rebuild directories, and selected target state cannot cross Sessions.

- [ ] Run focused tests and confirm RED:

```bash
node --test test/script-tools.test.js test/capture-tools.test.js test/rebuild-tools.test.js test/tool-catalog.test.js
```

- [ ] Move the remaining groups into catalog definitions and change protocol envelopes to domain JSON values.

- [ ] Make `DataStore` an instance owned by the Runtime instead of a site/process singleton. Pass its root explicitly; preserve secure file modes, write/cleanup locking, full-file search, truncation rejection, and trace integrity behavior.

- [ ] Remove all legacy MCP group registration from `src/mcp/server.js`. Its only tool registration path must now be `registerMcpCatalog`.

- [ ] Run all tool, rebuild, and real MCP checks:

```bash
node --test test/script-tools.test.js test/capture-tools.test.js test/rebuild-tools.test.js test/rebuild-bundle.test.js test/rebuild-runtime.test.js test/rebuild-trace.test.js test/rebuild-protected-target.test.js test/tool-catalog.test.js test/runtime-state-isolation.test.js
node --test test/integration/browser-mcp-smoke.test.js
pnpm lint
git diff --check
```

Expected: all exit 0; MCP exposes the same complete DeepSpider tool set through the catalog.

- [ ] Commit:

```bash
git add src/tools src/runtime/DeepSpiderRuntime.js src/store/DataStore.js src/mcp/server.js src/mcp/tools test/script-tools.test.js test/capture-tools.test.js test/rebuild-tools.test.js test/tool-catalog.test.js
git commit -m "refactor(tools): migrate evidence tools to catalog"
```

---

## Task 8: Define Event-Sourced Session Checkpoints

**Files:**

- Create: `src/dsh/session-state.js`
- Create: `test/dsh-session-state.test.js`

**Interfaces:**

```js
export const CHECKPOINT_EVENT_TYPE = 'deepspider/checkpoint'
export const checkpointSchema // Schemastery schema
export function normalizeCheckpoint(input)
export function applyCheckpoint(state, event)
export function createCheckpointProjection()
export function renderCheckpointContext(state)
```

The payload contains `phase`, `target`, `artifacts`, and `verification` exactly as specified. Artifact paths are relative to the Session root and hashes are lowercase SHA-256. Folding ignores unrelated event types and selects the latest valid checkpoint.

- [ ] Add tests for every phase, normalization, invalid traversal/absolute artifact paths, invalid hashes, unrelated events, latest-event folding, empty state, and stable model-visible rendering.

- [ ] Run the focused test and confirm RED:

```bash
node --test test/dsh-session-state.test.js
```

Expected: module-not-found failure.

- [ ] Implement the pure checkpoint contract and return the public DSH projection descriptor `{ key, stateVersion, schema, init, apply, view }`.

- [ ] Keep event values small; reject embedded script/body/trace content instead of adding storage behavior here.

- [ ] Run focused and workflow-contract checks:

```bash
node --test test/dsh-session-state.test.js test/rebuild-workflow-contract.test.js
pnpm lint
git diff --check
```

Expected: all exit 0.

- [ ] Commit:

```bash
git add src/dsh/session-state.js test/dsh-session-state.test.js
git commit -m "feat(dsh): define session checkpoint projection"
```

---

## Task 9: Add the Process-Wide DSH Host Plugin

**Files:**

- Create: `src/dsh/host-plugin.js`
- Create: `test/dsh-host-plugin.test.js`

**Interfaces:**

```js
export const name = 'deepspider-host'
export const inject = [/* public DSH services actually consumed */]
export function apply(ctx, config)
```

`apply` provides one `ctx.deepSpiderRuntimeManager`, registers the checkpoint projection, disposes an exact Runtime on the matching Agent disposal event, and calls `closeAll()` during plugin disposal. It registers no model-facing tools.

- [ ] Build a focused fake Cordis context test for service provision, one projection registration, exact Agent disposal, idempotent plugin disposal, and cleanup continuation when one Runtime fails to close.

- [ ] Run the focused test and confirm RED:

```bash
node --test test/dsh-host-plugin.test.js
```

- [ ] Implement `apply` against installed public DSH/Cordis APIs. Keep Runtime construction injectable in config for tests, but expose no user-facing compatibility switches.

- [ ] Verify no tool registration occurs in Host scope.

- [ ] Run focused and manager tests:

```bash
node --test test/dsh-host-plugin.test.js test/runtime-manager.test.js test/dsh-session-state.test.js
pnpm lint
git diff --check
```

Expected: all exit 0.

- [ ] Commit:

```bash
git add src/dsh/host-plugin.js test/dsh-host-plugin.test.js
git commit -m "feat(dsh): provide host runtime manager"
```

---

## Task 10: Register Native Tools and Prompt Context in the Agent Plugin

**Files:**

- Create: `src/adapters/dsh-tools.js`
- Create: `src/dsh/agent-plugin.js`
- Create: `test/dsh-tools.test.js`
- Create: `test/dsh-agent-plugin.test.js`
- Modify: `src/dsh/session-state.js`
- Modify: `src/config/paths.js`

**Interfaces:**

```js
export function registerDshCatalog(ctx, catalog, { runtimeManager })
export function apply(ctx, config)
```

Each native tool is created with `defineTool`. Its `execute(args, exec)` requires `exec.agent.id`, dispatches through `RuntimeManager.run(exec.agent, ...)`, forwards `exec.signal`, renders domain JSON, and appends a validated checkpoint only when the tool reports a workflow-state transition.

- [ ] Add adapter tests for parameter-schema pass-through, exact Agent dispatch, signal forwarding, missing-Agent failure, typed-error rendering, and checkpoint append behavior.

- [ ] Add Agent plugin tests for tool registration, stable invariant prompt section, projected checkpoint context, and `evolve_skill` writing only below `~/.deepspider/dsh/skills`.

- [ ] Run focused tests and confirm RED:

```bash
node --test test/dsh-tools.test.js test/dsh-agent-plugin.test.js
```

- [ ] Implement `registerDshCatalog` using only `@deepseek-ai/dsh-tools` public exports.

- [ ] Implement a stateless Agent plugin. Register the catalog in Agent scope; never store a current Agent, Runtime, browser, Page, Frame, or task directory on the plugin module/context.

- [ ] Add only stable prompt invariants: direct-request goal, browser-as-evidence, generic decisions, immutable target, Hook-based environment repair, Node identity concealment, and request-level verification. Do not duplicate the eight-stage Skill text.

- [ ] Implement `evolve_skill` with a fixed destination under DSH home and explicit allowed skill names; no package-source writes or relative-path joining from model input.

- [ ] Run focused, tool, and security tests:

```bash
node --test test/dsh-tools.test.js test/dsh-agent-plugin.test.js test/plugin-security.test.js test/rebuild-workflow-contract.test.js
pnpm lint
git diff --check
```

Expected: all exit 0.

- [ ] Commit:

```bash
git add src/adapters/dsh-tools.js src/dsh/agent-plugin.js src/dsh/session-state.js src/config/paths.js test/dsh-tools.test.js test/dsh-agent-plugin.test.js
git commit -m "feat(dsh): register native DeepSpider tools"
```

---

## Task 11: Compose the Spider Preset and DeepSpider Patch

**Files:**

- Create: `dsh/cordis.patch.yml`
- Create: `dsh/agent-presets/spider/agent.cordis.yml`
- Create: `dsh/agent-presets/spider/preset.yml`
- Create: `test/dsh-composition.test.js`
- Modify: `package.json`

**Interfaces:**

- The patch mounts `src/dsh/host-plugin.js`, adds the installed Spider Preset root, and selects `spider` by default.
- The Preset mounts `src/dsh/agent-plugin.js`, the DeepSpider Skill, Goals, shell, filesystem, search, jobs, Ask User, compaction, and pruning.
- It enables `web_search` and excludes Plan Mode, Subagents, Workflows, Ralph, Code Mode, generic Todo, `web_fetch`, and dynamic Cordis.
- `package.json#files` includes `dsh/` and removes nothing needed by the still-existing launcher.

- [ ] Add a composition test that invokes the installed DSH CLI's config dump/mount validation against `dsh/cordis.patch.yml` and inspects the resolved config.

- [ ] Assert intended capabilities are present once, excluded capabilities are absent, `spider` is default, plugin paths resolve inside the package, and permission mode defaults to `danger-full-access` at launch configuration.

- [ ] Run the focused test and confirm RED:

```bash
node --test test/dsh-composition.test.js
```

- [ ] Write the minimal Patch and Preset rows using the installed DSH version's public plugin names and schemas. Use relative module specifiers from the installed patch/Preset directory.

- [ ] Add `dsh/` to the published file list.

- [ ] Validate through the real DSH config loader, not a YAML-only parser:

```bash
node --test test/dsh-composition.test.js
pnpm lint
npm pack --dry-run --json
git diff --check
```

Expected: composition test exits 0 and the dry-run archive lists the patch and both Preset files.

- [ ] Commit:

```bash
git add dsh package.json test/dsh-composition.test.js
git commit -m "feat(dsh): compose spider agent preset"
```

---

## Task 12: Replace the CLI Launcher and Delete OpenCode

**Files:**

- Create: `src/dsh/launcher.js`
- Create: `test/dsh-launcher.test.js`
- Create: `test/integration/dsh-smoke.test.js`
- Modify: `bin/cli.js`
- Modify: `src/cli/commands/help.js`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `scripts/smoke-packed-cli.mjs`
- Delete: `src/agent/config.js`
- Delete: `src/agent/index.js`
- Delete: `src/agent/opencode-binary.js`
- Delete: `src/agent/runtime.js`
- Delete: `src/agent/sandbox.js`
- Delete: `src/agent/tui.js`
- Delete: `src/cli/commands/config.js`
- Delete: `plugins/deepspider-plugin/`
- Delete: `agents/spider.md`
- Delete: `test/agent-config.test.js`
- Delete: `test/agent-index.test.js`
- Delete: `test/agent-runtime.test.js`
- Delete: `test/opencode-binary.test.js`
- Delete: `test/sandbox.test.js`
- Delete: `test/config-command.test.js`
- Delete: `test/integration/opencode-smoke.test.js`

**Interfaces:**

```js
export function resolveDshBinary({ packageRoot } = {})
export function buildDshLaunch({ port, verbose, env, packageRoot } = {})
export function startDshAgent(options)
// => { child, closed, close(reason) }
```

`resolveDshBinary` reads `@deepseek-ai/dsh/package.json`, resolves `bin.dsh`, and returns the real JS entry. `startDshAgent` spawns `process.execPath` with `shell: false`, arguments `web --patch <installed patch>`, and inherited stdio. It sets DeepSpider roots and defaults `DSH_PERMISSION_MODE` to `danger-full-access`. SIGINT/SIGTERM close DSH, which must await Host-plugin browser cleanup.

- [ ] Add launcher tests for installed-layout binary resolution, no `.bin` wrapper, exact arguments, `--port` forwarding including `0`, verbose forwarding, environment roots, YOLO default, `shell: false`, child error/nonzero propagation, idempotent close, and bounded signal shutdown.

- [ ] Add a real DSH smoke that starts `deepspider agent --port 0`, waits for Web readiness, verifies the Spider Preset and native tools, creates two Sessions, then terminates cleanly.

- [ ] Run launcher tests and confirm RED:

```bash
node --test test/dsh-launcher.test.js
```

- [ ] Implement the launcher and replace the `agent` branch in `bin/cli.js`. Remove `--model` and `config`; retain `--port` and `--verbose`.

- [ ] Remove all OpenCode packages, OpenCode-only `pnpm.onlyBuiltDependencies`, source, plugin, Agent markdown, commands, and tests. Regenerate the lockfile with `pnpm install`.

- [ ] Remove `agents/` and `plugins/` from `package.json#files`; keep `skills/` and the new `dsh/` package surface.

- [ ] Update the packed CLI smoke to assert installed `agent --help`/argument behavior and DSH binary resolution without starting an interactive permanent server.

- [ ] Run focused and real DSH tests:

```bash
node --test test/dsh-launcher.test.js
node --test test/integration/dsh-smoke.test.js
pnpm smoke:pack
pnpm lint
git diff --check
```

Expected: all exit 0, the child exits after cleanup, and no OpenCode process remains.

- [ ] Confirm source and manifest removal:

```bash
rg -n -i "opencode|@opencode-ai" package.json pnpm-lock.yaml bin src test scripts dsh plugins agents || true
```

Expected: no output. Remove now-empty `plugins/` or `agents/` directories if applicable.

- [ ] Commit:

```bash
git add -A
git commit -m "feat(agent): replace OpenCode with DSH"
```

---

## Task 13: Update the Product Documentation and Continuous DSH Refresh

**Files:**

- Modify: `README.md`
- Modify: `README_EN.md`
- Create: `.github/workflows/dsh-refresh.yml`
- Modify: `.github/workflows/publish.yml`
- Modify: `test/dependencies.test.js`
- Modify: `test/dsh-composition.test.js`
- Modify: `scripts/smoke-packed-cli.mjs`

**Interfaces:**

- Both READMEs describe the same current commands, DSH Web flow, multiple Session model, Node 24 prerequisite, MCP external-adapter role, and direct-request reverse-engineering outcome.
- Scheduled CI refreshes `latest` DSH dependencies in an ephemeral checkout and runs acceptance; it opens no automatic repository mutation or unreviewed publish.
- Release CI runs unit, lint, DSH integration, browser/MCP integration, and packed-install smoke on Node 24.

- [ ] Extend dependency/composition tests to assert the public documentation command set and the absence of OpenCode terminology.

- [ ] Run the focused tests and confirm RED against the old READMEs/workflow:

```bash
node --test test/dependencies.test.js test/dsh-composition.test.js
```

- [ ] Rewrite the Chinese and English installation/startup/configuration sections in parallel. Preserve the existing product narrative and eight-stage reverse-engineering positioning; remove stale settings, TUI, Agent/Skill injection, and OpenCode instructions.

- [ ] Document only these retained CLI surfaces: `agent [--port] [--verbose]`, `mcp`, `fetch`, `update`, `--version`, and `--help`. Model/provider/credential setup belongs to DSH Web.

- [ ] Add a scheduled/manual `dsh-refresh.yml` that installs Node 24, updates the four DSH packages to current `latest` in the ephemeral job, and runs unit, lint, composition, DSH, browser/MCP, and pack acceptance. It reports breakage through CI only; it does not commit lockfile changes.

The refresh step is:

```bash
pnpm update --latest @deepseek-ai/dsh @deepseek-ai/cordis @deepseek-ai/dsh-tools @deepseek-ai/schemastery
```

- [ ] Expand publish CI to run the same checked-in-lock acceptance before npm publish.

- [ ] Run documentation, packaging, and workflow checks:

```bash
node --test test/dependencies.test.js test/dsh-composition.test.js
pnpm smoke:pack
npm pack --dry-run --json
pnpm lint
git diff --check
```

Expected: all exit 0 and both READMEs are listed in the archive.

- [ ] Commit:

```bash
git add README.md README_EN.md .github/workflows/dsh-refresh.yml .github/workflows/publish.yml test/dependencies.test.js test/dsh-composition.test.js scripts/smoke-packed-cli.mjs
git commit -m "docs: document native DSH workflow"
```

---

## Task 14: Prove Multi-Session Isolation and Release Readiness

**Files:**

- Create: `test/integration/dsh-multisession.test.js`
- Modify: `test/integration/dsh-smoke.test.js`
- Modify: `test/integration/browser-mcp-smoke.test.js`
- Modify: `scripts/run-unit-tests.mjs`
- Modify: `scripts/smoke-packed-cli.mjs`

**Acceptance scenarios:**

1. Two DSH Sessions receive distinct Runtime instances, browser processes/contexts, user-data roots, DataStores, selected Frames, Network/WebSocket buffers, target scripts, rebuild roots, and artifact hashes.
2. Same-Session tool calls serialize; different Sessions overlap in time.
3. Disposing Session A closes only browser A. Session B remains usable.
4. Process SIGTERM aborts active work, closes both browsers, and exits with bounded latency.
5. Resuming a Session reconstructs its latest checkpoint and lazily creates a fresh Runtime/browser.
6. Native DSH and MCP invoke the same catalog definitions.
7. Goals and `web_search` exist; excluded capabilities do not.
8. A real immutable-target probe/Hook/verify flow writes evidence only under its Session root.

- [ ] Add `dsh-multisession.test.js` using real DSH Web plus controlled local target pages. Record child PIDs and temporary roots so cleanup assertions are exact.

- [ ] Run the new integration test and confirm RED before completing missing lifecycle behavior:

```bash
node --test test/integration/dsh-multisession.test.js
```

- [ ] Make only the minimal production adjustments exposed by the acceptance test. Do not weaken isolation assertions, serialize different Sessions globally, or add retries that conceal lifecycle failures.

- [ ] Run the full unit suite:

```bash
pnpm test
```

Expected: all discovered top-level unit suites pass and no integration file is run by the unit runner.

- [ ] Run the full integration suite:

```bash
pnpm test:integration
```

Expected: DSH startup, multi-session, and browser/MCP smokes all pass and the Node process exits without open handles.

- [ ] Run release checks from the checked-in lockfile:

```bash
pnpm install --frozen-lockfile --ignore-scripts
pnpm lint
pnpm smoke:pack
npm pack --dry-run --json
git diff --check
```

Expected: all exit 0; archive contents include `src/dsh`, `src/runtime`, `src/tools`, `src/adapters`, `dsh`, `skills`, and both READMEs.

- [ ] Audit forbidden residuals and process leaks:

```bash
rg -n -i "opencode|@opencode-ai|latest task|most recently modified" package.json pnpm-lock.yaml bin src test scripts dsh README.md README_EN.md .github || true
ps -ax -o pid=,command= | rg "deepspider|@deepseek-ai/dsh|patchright|Chromium" || true
```

Expected: no forbidden source/documentation matches and no process created by the test run remains.

- [ ] Confirm repository state contains only intended changes:

```bash
git status --short
git diff --stat 3690fab..HEAD
```

- [ ] Commit the final acceptance additions:

```bash
git add test/integration/dsh-multisession.test.js test/integration/dsh-smoke.test.js test/integration/browser-mcp-smoke.test.js scripts/run-unit-tests.mjs scripts/smoke-packed-cli.mjs
git commit -m "test: verify DSH multi-session lifecycle"
```

## Final Review Gate

- [ ] Re-read the design spec and map every acceptance criterion to a passing test or explicit release check.
- [ ] Confirm `RuntimeManager` is the only process-wide DeepSpider state and each map entry is keyed by exact Agent ID.
- [ ] Confirm DSH native tools and MCP share the exact catalog definitions.
- [ ] Confirm Agent disposal and process disposal are both wired and tested.
- [ ] Confirm Node `>=24.0.0` appears consistently in manifest, CI, READMEs, and packed installation behavior.
- [ ] Confirm all DSH direct dependencies remain declared as `latest` while `pnpm-lock.yaml` records the tested versions.
- [ ] Confirm no legacy compatibility layer, rare-edge-case framework, or vendor/site-specific routing was introduced.
- [ ] Request a final code review before pushing `main`.
