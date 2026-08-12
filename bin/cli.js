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
    const { startAgent } = await import('../src/agent/index.js');
    const { startTUI } = await import('../src/agent/tui.js');

    const agentArgs = args.slice(1);
    const modelIdx = agentArgs.indexOf('--model');
    const model = modelIdx !== -1 ? agentArgs[modelIdx + 1] : undefined;
    const verbose = agentArgs.includes('--verbose');

    // 保存 server 句柄以便 SIGINT/SIGTERM 时关闭，避免 4096 端口泄漏
    let _server = null;
    let _shuttingDown = false;
    const shutdown = async (sig) => {
      if (_shuttingDown) return;
      _shuttingDown = true;
      if (_server) {
        try { await _server.close(); } catch { /* best-effort */ }
      }
      process.exit(sig === 'SIGINT' ? 130 : 143);
    };
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

    try {
      const { server } = await startAgent({ model, verbose });
      _server = server;
      const exitCode = await startTUI(server, { verbose });
      try { await server.close(); } catch { /* best-effort */ }
      process.exit(exitCode);
    } catch (err) {
      if (err && err.code === 'E_WIZARD_CANCELLED') {
        // 用户在首次运行向导中按了 Ctrl+C，算正常取消
        console.error('');
        console.error('已取消。');
        process.exit(err.exitCode || 130);
      }
      console.error(`❌ Agent 启动失败: ${err.message}`);
      if (verbose) console.error(err.stack);
      if (_server) {
        try { await _server.close(); } catch { /* best-effort */ }
      }
      // 端口占用给一个 actionable 提示（ProdReady F-07）
      if (err && /EADDRINUSE|port 4096|Failed to start server/i.test(err.message || '')) {
        console.error('');
        console.error('提示: opencode server 默认端口 4096 被占用。可能是上次运行残留：');
        console.error('  lsof -iTCP:4096 -sTCP:LISTEN -Pn   # 查看占用');
        console.error('  kill <pid>                         # 关掉残留进程后重试');
      }
      process.exit(1);
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
