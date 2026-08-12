#!/usr/bin/env node
/**
 * DeepSpider CLI 入口
 * 路由命令到对应处理模块
 */

const args = process.argv.slice(2);
const first = args[0];

switch (first) {
  case '-v':
  case '--version': {
    const { run } = await import('../src/cli/commands/version.js');
    run();
    break;
  }

  case '-h':
  case '--help': {
    const { run } = await import('../src/cli/commands/help.js');
    run();
    break;
  }

  case 'config': {
    const { run } = await import('../src/cli/commands/config.js');
    run(args.slice(1));
    break;
  }

  case 'update': {
    const { run } = await import('../src/cli/commands/update.js');
    await run();
    break;
  }

  case 'fetch': {
    const { fetchCommand } = await import('../src/cli/commands/fetch.js');
    const url = args[1];
    if (!url) {
      console.error('❌ 缺少 URL 参数');
      console.log('用法: deepspider fetch <url>');
      process.exit(1);
    }
    await fetchCommand(url, { http: args.includes('--http') });
    break;
  }

  case 'agent': {
    // 启动独立 Agent
    const {
      reportAgentCleanupError,
      reportAgentError,
      selectAgentExitCode,
      startAgent,
    } = await import('../src/agent/index.js');

    const agentArgs = args.slice(1);
    const modelIdx = agentArgs.indexOf('--model');
    const model = modelIdx !== -1 ? agentArgs[modelIdx + 1] : undefined;
    const verbose = agentArgs.includes('--verbose');

    let runtime;
    let signalExitCode;
    const startupAbortController = new globalThis.AbortController();
    const reportedCleanupErrors = new Set();
    const closeRuntime = async () => {
      try {
        await runtime?.close();
      } catch (err) {
        reportAgentCleanupError(err, reportedCleanupErrors);
      }
    };
    const closeForSignal = async (exitCode, signal) => {
      signalExitCode = exitCode;
      process.exitCode = exitCode;
      startupAbortController.abort({ signal, exitCode });
      await closeRuntime();
    };
    const onSigint = () => { void closeForSignal(130, 'SIGINT'); };
    const onSigterm = () => { void closeForSignal(143, 'SIGTERM'); };
    process.once('SIGINT', onSigint);
    process.once('SIGTERM', onSigterm);

    try {
      runtime = await startAgent({ model, verbose, signal: startupAbortController.signal });
      if (signalExitCode == null) {
        const tuiExitCode = await runtime.attachTUI();
        process.exitCode = selectAgentExitCode(process.exitCode, tuiExitCode);
      }
    } catch (err) {
      if (err && err.code === 'E_WIZARD_CANCELLED') {
        if (signalExitCode == null) {
          process.exitCode = err.exitCode || 130;
          console.error('');
          console.error('已取消。');
        }
      } else {
        process.exitCode = reportAgentError(err, {
          signalExitCode,
          verbose,
          reportedCleanupErrors,
        });
      }
    } finally {
      process.removeListener('SIGINT', onSigint);
      process.removeListener('SIGTERM', onSigterm);
      await closeRuntime();
    }
    break;
  }

  case 'mcp': {
    // 启动 MCP Server
    await import('../src/mcp/server.js');
    break;
  }

  default: {
    console.log('DeepSpider - 智能爬虫工程平台');
    console.log('');
    console.log('Commands:');
    console.log('  deepspider agent                 Start standalone Agent (opencode TUI)');
    console.log('  deepspider agent --model <id>    Override LLM model');
    console.log('  deepspider agent --verbose       Verbose logging');
    console.log('  deepspider mcp                   Start MCP server (for Claude Code)');
    console.log('  deepspider config list           Show sandbox opencode config');
    console.log('  deepspider config set-model <m>  Set model in sandbox opencode.json');
    console.log('  deepspider config auth login     Log in to a provider (passthrough)');
    console.log('  deepspider config reset          Reset sandbox (re-run init wizard)');
    console.log('  deepspider fetch <url>           Quick HTTP request');
    console.log('  deepspider update                Check for updates');
    console.log('  deepspider --version             Show version');
    console.log('  deepspider --help                Show help');
    console.log('');
    console.log('Usage with Claude Code:');
    console.log('  claude mcp add deepspider node src/mcp/server.js');
    break;
  }
}
