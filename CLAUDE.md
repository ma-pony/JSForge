# DeepSpider repository guidance

DeepSpider is a DSH-native JavaScript reverse-engineering platform. The primary entry point is `deepspider agent`, which starts DSH Web with the Spider Preset. `deepspider mcp` is an external stdio adapter over the same tool catalog.

## Runtime boundaries

- `src/dsh/` mounts the Host and Agent plugins into DSH.
- `src/runtime/RuntimeManager.js` owns one DeepSpider Runtime per DSH Session.
- `src/browser/` owns Patchright Chromium, CDP capture, explicit Probe hooks, and Dialog.
- `src/store/DataStore.js` persists captured requests, responses, and scripts inside the Session root.
- `src/rebuild/` compiles an Environment Recipe over jsdom and runs Probe or Verify.
- `src/tools/` is the single catalog consumed by both DSH and MCP adapters.

Do not add process-wide browser, CDP, DataStore, WebSocket, debugger, or Dialog state. Closing a Session must close its associated browser. Reusing the same Session ID must wait for the previous Runtime to finish closing.

## Reverse-engineering contract

Use the evidence sequence:

```text
Observe → Capture → Recipe → Probe → Verify
```

- Observe does not inject Probe code.
- Capture binds evidence to the Session and script hash.
- `target.original.js` preserves captured bytes.
- A derived `target.working.js` requires a complete `transforms.json` hash chain.
- Fixed rules, concealment, Hook behavior, handlers, and network replay belong in the task's `recipe.json`.
- Probe is an explicit diagnostic mode. Verify runs without Probe.
- Browser output is evidence; completion requires offline request-level verification.

The in-page Dialog is optional. It supports chat, DOM or iframe selection, and DSH question batches. Dialog messages and answers stay within the owning Session, and opening Dialog must not activate Probe.

## Tool schemas

Define tools in `src/tools/groups/` and register them once in `src/tools/index.js`. DSH and MCP adapters must consume that central catalog. Avoid `z.any()`, `z.unknown()`, and `z.record()` in model-facing schemas because their generated JSON Schema is not accepted consistently by providers.

## Commands

```bash
pnpm test
pnpm lint
pnpm audit --prod
pnpm test:integration
pnpm smoke:pack
npm pack --dry-run
```

Development requires Node.js `>=24.15.0` and pnpm `11.21.0`. Browser integration tests require Patchright Chromium and permission to start local Chromium child processes.
