# DeepSpider repository guidance

DeepSpider is a DSH-native JavaScript reverse-engineering platform. The primary entry point is `deepspider agent`, which starts DSH Web with the Spider Preset. `deepspider mcp` is an external stdio adapter over the same tool catalog.

## Runtime boundaries

- `src/dsh/` mounts the Host and Agent plugins into DSH.
- `src/runtime/RuntimeManager.js` owns one DeepSpider Runtime per DSH Session.
- `src/browser/` owns Patchright Chromium, CDP capture, explicit Hook injection, and Dialog.
- `src/store/SessionArtifactStore.js` stores observed browser data and derived Artifacts under the Session's `evidence/` root (`sites/` and `artifacts/`).
- `src/recovery/` owns Output Contracts, Runtime Recipes, the `RecoveryCoordinator`, the sdenv Worker, real request validation, and Solver export.
- `src/tools/` is the single catalog consumed by both DSH and MCP adapters.

Do not add process-wide browser, CDP, SessionArtifactStore, Recovery Runtime, WebSocket, debugger, or Dialog state. Closing a Session must close its associated browser and Worker state. Reusing the same Session ID must wait for the previous Runtime to finish closing.

## Reverse-engineering contract

Use the Recovery sequence:

```text
Browser evidence → Artifact Graph → Output Contract → Runtime Recipe → sdenv Worker → real request validation → Solver
```

- Browser output is observed evidence, not the final result.
- Every observed or derived Artifact is immutable and linked to its source in the current Session.
- Fixed rules, concealment, and runtime settings belong in the Session Runtime Recipe, not a site-specific core branch.
- The sdenv Worker starts from independent state and generates the required output without Patchright cookies or browser data.
- Completion requires the generated output to pass a real request and reach `reproduced` validation before Solver export.

The in-page Dialog is optional. It supports chat, DOM or iframe selection, and DSH question batches. Dialog messages and answers stay within the owning Session, and opening Dialog must not inject runtime Hooks.

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
