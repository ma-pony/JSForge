# DeepSpider Full Code Audit and README Rewrite Design

## Context

DeepSpider has completed its native DSH migration. The current product surface is DSH Web with the Spider Preset, a Session-owned Patchright/CDP runtime, a shared 51-tool catalog, and an MCP external adapter. The repository now needs a complete production-code audit and a bilingual README rewrite based on the implemented release rather than migration history.

The audit is corrective, not a broad modernization project. It fixes confirmed correctness, dependency, release, metadata, and dead-code problems while preserving the validated DSH lifecycle and reverse-engineering workflow.

## Goals

- Review every published production area: CLI, DSH composition, Runtime ownership, browser/CDP lifecycle, DataStore, rebuild runtime, adapters, tool catalog, package metadata, CI, and release contents.
- Fix deterministic problems found by the audit.
- Remove production modules proven unreachable from the current CLI, DSH, MCP, tool, and test entry points.
- Refresh direct dependencies and the lockfile through supported package-manager operations.
- Rewrite `README.md` and `README_EN.md` around the current product and keep their structure equivalent.
- Preserve the reverse-engineering narrative and eight-stage method.
- Finish with unit, lint, dependency-audit, real integration, packed-install, and dry-pack evidence.

## Non-goals

- Do not split large but working modules merely to reduce file size.
- Do not add Camoufox or a second browser runtime.
- Do not restore OpenCode compatibility or retired Agent paths.
- Do not change the 51-tool public contract without a confirmed correctness defect.
- Do not add compatibility aliases for deleted internal modules.
- Do not treat `node:vm` as a complete hostile-code security sandbox.

## Preserved Browser Behavior

`BrowserClient` intentionally keeps the reverse-analysis launch configuration:

- `--disable-web-security`;
- `--ignore-certificate-errors`;
- `ignoreHTTPSErrors: true`.

This audit does not add a safe-mode switch or change these defaults. The README will describe DeepSpider as a privileged analysis environment intended for authorized targets.

## Code Audit Design

### 1. Browser evidence reliability

Browser startup must fail when page setup, CDP initialization, Runtime binding, or required interceptor startup fails. Logging and continuing would create a browser that appears usable while silently missing request or script evidence.

Tests will inject a setup failure and prove `launch()` rejects and releases partially created browser resources. Popup-specific behavior may continue to log a page-local failure, but the initial Session browser cannot report success without its evidence pipeline.

### 2. Dead-code and unfinished-feature decisions

An internal module is deleted only after repository-wide import, textual-reference, history, Skill-contract, and replacement-path checks establish whether it is obsolete or an unfinished required capability.

The audit produced these decisions:

- Delete `src/core/PatchGenerator.js`. It belongs to the former global knowledge-library and error-text patch-generation path. The current contract intentionally replaced that path with exact browser facts, `collect_property`, immutable `target.js`, Trace analysis, and edits limited to `env.js` / `probe.js`. Reconnecting it would reintroduce unscoped, potentially stale environment code.
- Delete `src/store/Store.js`. Its only production consumer is `PatchGenerator`; no current tool, Skill, Session workflow, or learned-reference path writes or reads its JSON knowledge library. Reusable guidance now lives in the packaged Skill and evidence-backed Session artifacts.
- Delete standalone `src/browser/ui/selector.js` and `src/browser/ui/confirmDialog.js` after final reference checks. They are early UI prototypes with no tool registration, no DSH surface, and no default-hook assembly. If manual visual selection is required later, it must be implemented as an explicit Session-scoped tool with a result contract.
- Keep `src/browser/ui/analysisPanel.js` and `src/browser/defaultHooks.js`. They remain in the active browser injection chain.
- Reduce `src/config/paths.js` rather than delete it. Keep the used directory-permission and filename helpers; remove the obsolete process-global data, store, output, report, and browser-data tree. `SessionPaths` remains the only owner of Runtime artifact roots.
- Delete `src/config/index.js` if the final reference check confirms it only re-exports the removed global path surface.

Comments and tests referring to the deleted route will be updated. No compatibility aliases will be added.

### 3. Dependency and release hygiene

Use pnpm 11.21.0 to refresh the direct runtime dependencies and regenerate the lockfile. Prefer upstream releases that naturally resolve vulnerable transitive packages. Do not add speculative overrides when the current upstream release still owns the dependency.

After refresh:

- run `pnpm audit --prod`;
- fix high-severity findings that are resolvable through supported direct dependency updates;
- report any remaining upstream-only advisory with its dependency path;
- keep the DSH channel policy: DSH and Cordis on `latest`, DSH tools on `next`;
- retain the scheduled DSH compatibility workflow and add production-audit coverage to release gates if the refreshed graph can pass it reliably.

### 4. Product metadata and CLI text

Package metadata and the default CLI help must identify DeepSpider as a DSH-native JavaScript reverse-engineering platform. MCP remains a generic external adapter rather than the primary product or a Claude Code-specific identity.

The command contract stays unchanged:

- `agent [--port <number>] [--verbose]`;
- `mcp`;
- `fetch <url>`;
- `update`;
- `--version`;
- `--help`.

Unused option plumbing and the three current lint warnings will be removed at their source rather than suppressed.

## README Design

The two READMEs target reverse engineers who want a working Agent first and contributors who need the runtime contract second. They will share the same section order and factual claims, with natural Chinese and English rather than sentence-by-sentence translation.

Target structure:

1. Product statement: real browser evidence to direct-request implementation.
2. Why DeepSpider: evidence chain, protected-script analysis, immutable target, verified delivery.
3. Quick start with the DSH Web Agent.
4. Eight-stage workflow and evidence gate.
5. Probe/Verify environment-rebuild contract.
6. DSH multi-Session architecture and ownership boundaries.
7. The eight groups behind the 51-tool catalog.
8. CLI, MCP external adapter, and lightweight `fetch`.
9. Session artifact layout.
10. Development, release verification, and authorization boundary.

The rewrite will:

- keep Patchright Chromium as the supported browser runtime;
- explain that browser automation gathers evidence and the deliverable is a direct request implementation;
- distinguish DSH-owned Sessions, models, credentials, Goals, Code Mode, persistence, and compaction from DeepSpider-owned browser and reverse-engineering state;
- describe Cordis as a privileged capability;
- avoid migration history, retired capabilities, compatibility disclaimers, and duplicated usage sections;
- avoid claiming unpublished tool behavior or unsupported environment variables.

After writing, both files will be scanned with the de-slop pattern catalog. Rewrites must remove negative-parallelism templates, inflated claims, repetitive three-item rhythms, uniform cadence, and redundant formatting without losing technical precision.

## Testing and Acceptance

The implementation is complete only when all of the following hold:

- focused regressions demonstrate each production fix;
- `pnpm test` passes;
- `pnpm lint` reports zero errors and zero warnings;
- `pnpm audit --prod` has no resolvable high-severity finding in the supported graph;
- `pnpm test:integration` passes with real DSH Web and Patchright Chromium;
- `pnpm smoke:pack` installs the generated tarball in an empty directory and validates the installed DSH layout;
- `npm pack --dry-run --json` contains both READMEs, DSH assets, runtime sources, and the Skill, while excluding tests and removed legacy modules;
- README contract tests prove bilingual command parity, required product terms, artifact paths, and absence of retired product instructions;
- `git diff --check` passes and the tracked worktree contains only the intended audit and README changes.

## Delivery Boundary

Work remains on `main`, as previously authorized. Implementation will be committed locally after verification. It will not be pushed unless the user requests a push.
