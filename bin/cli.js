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
    await fetchCommand(url);
    break;
  }

  case 'agent': {
    const agentArgs = args.slice(1);
    if (agentArgs.includes('--help') || agentArgs.includes('-h')) {
      console.log(`
用法:
  deepspider agent [--port <number>] [--verbose]

启动原生 DSH Web，并加载 DeepSpider Spider Preset。

选项:
  --port <number>  监听端口（允许 0 由系统分配）
  --verbose        显示 DeepSpider 启动信息
`.trim());
      break;
    }

    let port;
    let verbose = false;
    let argumentError;
    for (let index = 0; index < agentArgs.length; index += 1) {
      const argument = agentArgs[index];
      if (argument === '--verbose') {
        verbose = true;
        continue;
      }
      if (argument === '--port') {
        const value = agentArgs[index + 1];
        if (!/^\d+$/.test(value || '') || Number(value) > 65535) {
          argumentError = '--port 需要 0 到 65535 之间的数字';
          break;
        }
        port = Number(value);
        index += 1;
        continue;
      }
      argumentError = `不支持的选项 ${argument}`;
      break;
    }
    if (argumentError) {
      console.error(`agent: ${argumentError}`);
      process.exitCode = 1;
      break;
    }

    const { startDshAgent } = await import('../src/dsh/launcher.js');
    let runtime;
    let signalExitCode;
    const abortController = new globalThis.AbortController();
    const closeForSignal = (exitCode, signal) => {
      if (signalExitCode != null) return;
      signalExitCode = exitCode;
      process.exitCode = exitCode;
      abortController.abort({ signal, exitCode });
    };
    const onSigint = () => closeForSignal(130, 'SIGINT');
    const onSigterm = () => closeForSignal(143, 'SIGTERM');
    process.once('SIGINT', onSigint);
    process.once('SIGTERM', onSigterm);

    try {
      runtime = startDshAgent({ port, verbose, signal: abortController.signal });
      const childExitCode = await runtime.closed;
      process.exitCode = signalExitCode ?? childExitCode;
    } catch (err) {
      if (signalExitCode == null) console.error(`agent: ${err.message}`);
      process.exitCode = signalExitCode ?? 1;
    } finally {
      process.removeListener('SIGINT', onSigint);
      process.removeListener('SIGTERM', onSigterm);
      try {
        await runtime?.close();
      } catch {
        // The primary spawn/exit error was already reported above.
      }
    }
    break;
  }

  case 'mcp': {
    // 启动 MCP Server
    await import('../src/mcp/server.js');
    break;
  }

  default: {
    console.log('DeepSpider - DSH-native JavaScript reverse-engineering platform');
    console.log('');
    console.log('Commands:');
    console.log('  deepspider agent                 Start native DSH Web');
    console.log('  deepspider agent --port <number> Set DSH Web port');
    console.log('  deepspider agent --verbose       Show DeepSpider startup info');
    console.log('  deepspider mcp                   Start stdio MCP external adapter');
    console.log('  deepspider fetch <url>           Quick HTTP request');
    console.log('  deepspider update                Check for updates');
    console.log('  deepspider --version             Show version');
    console.log('  deepspider --help                Show help');
    break;
  }
}
