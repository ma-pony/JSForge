# DeepSpider

[![npm version](https://img.shields.io/npm/v/deepspider.svg)](https://www.npmjs.com/package/deepspider)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> Intelligent Web Scraping Platform — AI-powered Crawler Agent built on DeepAgents + Patchright

An end-to-end AI Agent solution from JS reverse engineering to production-ready crawler scripts.

[中文文档](README.md)

## Features

- **AI-Driven Architecture**: Directly understands JS source code without AST parsing or deobfuscation preprocessing
- **HTTP Fast Request**: Lightweight HTTP mode with TLS fingerprint spoofing, no browser needed
- **Reverse Engineering**: AI understands obfuscated code, identifies encryption algorithms, generates Python implementation
- **Dynamic Debugging**: Real browser + CDP breakpoint debugging, Hook injection
- **CAPTCHA Handling**: Slider, click-based, and image CAPTCHAs
- **Anti-Detection**: Fingerprint spoofing, proxy rotation, risk control evasion
- **Crawler Orchestration**: AI generates complete runnable Python crawler projects
- **Interactive Panel**: Built-in browser analysis panel with element selection and chat
- **Real-time Progress**: Streaming output shows tool calls and analysis progress

## Quick Start

### Installation

Requires Node.js 20.19 or later.

```bash
# Option 1: npm global install (recommended)
npm install -g deepspider

# Option 2: pnpm global install
pnpm approve-builds -g deepspider isolated-vm  # Approve native build scripts on first install
pnpm install -g deepspider

# Option 3: Clone the repository
git clone https://github.com/ma-pony/deepspider.git
cd deepspider
pnpm install
cp .env.example .env  # Configure environment variables
pnpm run setup:crypto  # Install Python crypto libraries (optional)
```

On first run, you'll be prompted to configure the LLM API.

> **Note**: This project depends on the `isolated-vm` native module, which requires a C++ build environment:
> - macOS: `xcode-select --install`
> - Ubuntu: `sudo apt install build-essential`
> - Windows: Install [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)

### Configuration

DeepSpider supports Anthropic-compatible API providers. Claude API is recommended for best results.

| Config Key | Environment Variable | Description |
|------------|---------------------|-------------|
| `apiKey` | `DEEPSPIDER_API_KEY` | API key |
| `baseUrl` | `DEEPSPIDER_BASE_URL` | API endpoint URL |
| `model` | `DEEPSPIDER_MODEL` | Model name |
| `persistBrowserData` | `DEEPSPIDER_PERSIST_BROWSER` | Persist browser data (keep login sessions) |

Priority: Environment variables > Config file (`~/.deepspider/config/settings.json`) > Defaults

**Option 1: CLI commands (recommended)**

```bash
deepspider config set apiKey sk-ant-api03-xxx
deepspider config set baseUrl https://api.anthropic.com
deepspider config set model claude-opus-4-6
```

**Option 2: Environment variables**

```bash
export DEEPSPIDER_API_KEY=sk-ant-api03-xxx
export DEEPSPIDER_BASE_URL=https://api.anthropic.com
export DEEPSPIDER_MODEL=claude-opus-4-6
```

> **Note**: Other Anthropic-compatible API providers are also supported.

### Usage

#### Global install (npm/pnpm install -g)

```bash
# Start Agent - specify target website
deepspider https://example.com

# Fast HTTP request (lightweight, no browser needed)
deepspider fetch https://example.com

# Start Agent - persist browser data (one-time)
deepspider --persist https://example.com

# Start Agent - interactive mode only
deepspider

# Show help
deepspider --help

# Manage configuration
deepspider config list            # List all settings
deepspider config set apiKey sk-xxx
deepspider config set model gpt-4o

# Persist browser data (for sites requiring login, auto-restores session on next launch)
deepspider config set persistBrowserData true

# Check for updates
deepspider update
```

#### Clone repository

```bash
# Configure (pick one)
cp .env.example .env  # Edit .env file
# or use CLI commands
node bin/cli.js config set apiKey sk-xxx
node bin/cli.js config set baseUrl https://api.openai.com/v1
node bin/cli.js config set model gpt-4o

# Install Python dependencies (optional, for running generated Python code)
pnpm run setup:crypto

# Start Agent
pnpm run agent https://example.com

# MCP service (for Claude Code, etc.)
pnpm run mcp

# Run tests
pnpm test
```

### Workflow

1. **Launch**: `deepspider https://target-site.com`
2. **Wait**: Browser opens, system automatically records data (no API cost)
3. **Interact**: Log in, paginate, trigger target requests on the website
4. **Select**: Click the panel's select button ⦿ to enter selection mode
5. **Analyze**: Click on target data elements, choose a quick action:
   - **Trace Data Source** — Locate the API endpoint for the selected data
   - **Analyze Encryption** — Identify and reverse-engineer encrypted parameters
   - **Full Analysis & Generate Crawler** — End-to-end: reverse, verify, generate code
   - **Extract Page Structure** — Analyze DOM structure, generate selectors and field configs
6. **Chat**: Continue asking questions in the panel or CLI for deeper analysis

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   DeepSpider                        │
│         (Main Agent - AI-Driven Smart Routing)      │
└──────────────────────┬──────────────────────────────┘
                       │ On-demand invocation
       ┌───────────────┼───────────────┐
       ▼               ▼               ▼
┌─────────────┐ ┌─────────────┐ ┌─────────────┐
│reverse-agent│ │captcha-agent│ │anti-detect  │
│ AI analyzes │ │ CAPTCHA     │ │ Anti-detect │
│ & generates │ │             │ │             │
└─────────────┘ └─────────────┘ └─────────────┘
       │
       ▼
┌─────────────┐
│crawler-agent│
│ AI generates│
└─────────────┘
```

### Sub-Agent System (v2.0 - AI-Driven)

| Sub-Agent | Responsibility | Core Tools |
|-----------|---------------|------------|
| crawler | AI generates complete crawler projects | ai, file, store |
| reverse | AI understands JS source and generates Python | ai, tracing, debug, capture, python |
| captcha | CAPTCHA handling: OCR, slider, click-based | captcha_ocr, captcha_slide |
| anti-detect | Anti-detection: fingerprint, proxy pool | proxy, fingerprint |

**Architecture Advantages**:
- Old: 10+ steps (AST parsing → deobfuscation → extraction → conversion → generation)
- New: 3 steps (get source → AI analysis → validation)
- AI directly understands obfuscated code without preprocessing

## Project Structure

```
deepspider/
├── bin/cli.js               # CLI entry (command routing)
├── src/
│   ├── agent/               # DeepAgent system
│   │   ├── tools/           # Tool collection (42)
│   │   ├── subagents/       # Sub-agents
│   │   ├── skills/          # Domain skills
│   │   └── prompts/         # System prompts
│   ├── cli/                 # CLI commands
│   │   ├── config.js        # Config re-export
│   │   └── commands/        # Sub-commands (version/help/config/update)
│   ├── config/              # Core configuration
│   │   ├── paths.js         # Path constants
│   │   └── settings.js      # Config read/write (env vars/file/defaults)
│   ├── browser/             # Browser runtime
│   │   ├── client.js        # Patchright client
│   │   ├── cdp.js           # CDP session management
│   │   ├── defaultHooks.js  # Default injected Hooks
│   │   ├── interceptors/    # CDP interceptors
│   │   └── ui/              # In-browser UI panel
│   ├── analyzer/            # Static analyzer
│   ├── env/                 # Environment patching
│   ├── store/               # Data storage
│   └── mcp/                 # MCP service
└── test/                    # Tests
```

## Core Technologies

- **DeepAgents**: Multi-agent collaboration framework
- **Patchright**: Anti-detection browser automation
- **CDP**: Chrome DevTools Protocol deep integration
- **webcrack**: Webpack/Browserify unpacking
- **isolated-vm**: Secure sandbox execution

## Documentation

- [Development Guide](docs/GUIDE.md)
- [Debug Guide](docs/DEBUG.md)

## Contributing

Issues and Pull Requests are welcome!

## License

MIT
