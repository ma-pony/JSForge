# DeepSpider Bilingual README Rewrite Design

## Goal

Rewrite `README.md` and `README_EN.md` so both documents describe the current OpenCode V2 + Patchright implementation accurately, use the same information architecture, and contain commands that work for global installs and source checkouts.

## Source of truth

Documentation claims must be supported by the current repository:

- `bin/cli.js` and its `--help` output define public commands.
- `package.json` defines the Node.js floor, package contents, scripts, and pinned dependencies.
- `src/agent/**` defines the OpenCode Runtime, sandbox, Agent/Skill/Plugin/MCP readiness, TUI, and shutdown behavior.
- `src/mcp/**` and `src/browser/**` define the MCP and Patchright/CDP capabilities.
- `agents/spider.md` defines the eight-stage workflow.
- `.env.example` and direct `process.env` reads define supported environment variables.
- `src/config/paths.js` and `src/agent/sandbox.js` define persistent data locations.

Old README text is not a source of truth when it conflicts with current code.

## Content strategy

Both READMEs will use the same section order and equivalent content:

1. Project positioning
2. Current capabilities
3. Requirements and installation
4. Global-install and source-checkout startup commands
5. OpenCode auth-only sandbox configuration
6. Agent, MCP Server, and lightweight fetch usage
7. Eight-stage workflow
8. Current architecture
9. Environment variables and data locations
10. Development and verification commands
11. Current boundaries
12. License

The Chinese README remains the primary language entry; the English README is a faithful English counterpart rather than a separate legacy product description.

## Required corrections

- Replace DeepAgents/sub-agent architecture with the current Spider Agent and OpenCode V2 Runtime.
- Remove `isolated-vm`, old `config set` commands, obsolete API-key environment variables, old URL-as-command startup, and old persistence flags.
- Remove unverifiable OCR, proxy rotation, automatic CAPTCHA handling, and automatic crawler-orchestration claims.
- Remove dead `docs/GUIDE.md` and `docs/DEBUG.md` links.
- Remove undocumented `/ds:*` slash-command examples.
- Document global startup as `deepspider agent` and source startup as `node bin/cli.js agent`.
- Document `Ctrl+C` shutdown.
- Document exact OpenCode `1.18.16`, Node.js `>=20.19.0`, Patchright as the sole browser base, and the auth-only `link-auth`/`fresh` sandbox.
- Document only production-read environment variables: `DEEPSPIDER_HEADLESS` and `DEEPSPIDER_USER_DATA_DIR`.
- Describe the MCP surface as 51 currently registered tools without listing a brittle per-tool catalog.
- Keep unverified performance claims out of the product positioning.

## Writing rules

- Prefer short, operational explanations over marketing language.
- Commands must be copyable and distinguish global-install from source-checkout forms.
- Chinese and English examples must remain semantically equivalent.
- Do not add compatibility guidance for removed architectures or configuration APIs.
- Do not turn the README into an internal implementation specification.

## Verification

The rewrite is accepted when:

- every documented CLI command matches `node bin/cli.js --help` or a current package script;
- all referenced paths and files exist;
- environment variables match production reads;
- both READMEs use equivalent sections and claims;
- searches find no active README references to DeepAgents, sub-agents, `isolated-vm`, old `config set`, old API environment variables, `/ds:*`, or dead guide links;
- Markdown links and code fences are valid;
- `git diff --check` passes;
- CLI `--help` and `--version` still run after the documentation-only change.

## Scope boundary

This work changes only `README.md` and `README_EN.md` after this design is approved. It does not change code, dependencies, CLI behavior, OpenCode configuration, MCP tools, browser behavior, or release workflows.
