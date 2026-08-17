/**
 * DeepSpider MCP Server
 * Exposes the DeepSpider catalog through a stdio MCP adapter.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { createMcpContext, createMcpSessionId } from './context.js';
import { installMcpShutdown } from './lifecycle.js';
import { RuntimeManager } from '../runtime/RuntimeManager.js';
import { deepSpiderCatalog, DEEPSPIDER_TOOL_COUNT } from '../tools/index.js';
import { registerMcpCatalog } from '../adapters/mcp-tools.js';

const server = new McpServer(
  { name: 'deepspider', version: '1.0.0' }
);
const runtimeManager = new RuntimeManager();
const sessionId = createMcpSessionId();
const context = createMcpContext({
  sessionId,
  runtimeManager,
});

registerMcpCatalog(server, deepSpiderCatalog, { runtimeManager, agent: context.agent });

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
  console.error(`DeepSpider MCP server running (${DEEPSPIDER_TOOL_COUNT} tools registered)`);
}

main().catch(async (err) => {
  console.error('MCP server failed to start:', err);
  await context.cleanup();
  process.exit(1);
});
