/**
 * DeepSpider MCP Server
 * Exposes ~22 tools via MCP protocol for Claude Code integration
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { registerBrowserTools } from './tools/browser.js';
import { registerNetworkTools } from './tools/network.js';
import { registerScriptTools } from './tools/script.js';
import { registerDebuggerTools } from './tools/debugger.js';
import { registerHookTools } from './tools/hook.js';
import { registerCaptureTools } from './tools/capture.js';
import { registerRebuildTools } from './tools/rebuild.js';
import { registerStealthTools } from './tools/stealth.js';
import { createMcpContext } from './context.js';
import { installMcpShutdown } from './lifecycle.js';
import { RuntimeManager } from '../runtime/RuntimeManager.js';
import { createToolCatalog } from '../tools/catalog.js';
import { registerMcpCatalog } from '../adapters/mcp-tools.js';

const server = new McpServer(
  { name: 'deepspider', version: '1.0.0' }
);
const runtimeManager = new RuntimeManager();
const context = createMcpContext({
  sessionId: 'mcp-stdio',
  runtimeManager,
});
const catalog = createToolCatalog([]);

registerMcpCatalog(server, catalog, { runtimeManager, agent: context.agent });

// Register all tool groups
registerBrowserTools(server, context);
registerNetworkTools(server, context);
registerScriptTools(server, context);
registerDebuggerTools(server, context);
registerHookTools(server, context);
registerCaptureTools(server, context);
registerRebuildTools(server, context);
registerStealthTools(server, context);

installMcpShutdown({
  cleanupFn: async () => {
    await context.cleanup();
    await server.close();
  },
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('DeepSpider MCP server running (51 tools registered)');
}

main().catch(async (err) => {
  console.error('MCP server failed to start:', err);
  await context.cleanup();
  process.exit(1);
});
