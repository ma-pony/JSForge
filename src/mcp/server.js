/**
 * DeepSpider MCP Server
 * Exposes ~22 tools via MCP protocol for Claude Code integration
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { registerScriptTools } from './tools/script.js';
import { registerCaptureTools } from './tools/capture.js';
import { registerRebuildTools } from './tools/rebuild.js';
import { createMcpContext } from './context.js';
import { installMcpShutdown } from './lifecycle.js';
import { RuntimeManager } from '../runtime/RuntimeManager.js';
import { createToolCatalog } from '../tools/catalog.js';
import { tools as browserTools } from '../tools/groups/browser.js';
import { tools as debuggerTools } from '../tools/groups/debugger.js';
import { tools as hookTools } from '../tools/groups/hook.js';
import { tools as networkTools } from '../tools/groups/network.js';
import { tools as stealthTools } from '../tools/groups/stealth.js';
import { registerMcpCatalog } from '../adapters/mcp-tools.js';

const server = new McpServer(
  { name: 'deepspider', version: '1.0.0' }
);
const runtimeManager = new RuntimeManager();
const context = createMcpContext({
  sessionId: 'mcp-stdio',
  runtimeManager,
});
const catalog = createToolCatalog([
  browserTools,
  networkTools,
  debuggerTools,
  hookTools,
  stealthTools,
]);

registerMcpCatalog(server, catalog, { runtimeManager, agent: context.agent });

// Register the three groups that remain on the legacy MCP path until Task 7.
registerScriptTools(server, context);
registerCaptureTools(server, context);
registerRebuildTools(server, context);

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
