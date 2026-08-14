/**
 * DeepSpider MCP - Network interception tools
 */

import { z } from 'zod';

export function registerNetworkTools(server, dependencies) {
  const { getRuntime, getDataStore, getCDPSession } = dependencies;
  server.tool(
    'list_network_requests',
    'List captured network requests. Use search to find specific content in responses.',
    {
      site: z.string().optional().describe('Filter by hostname'),
      search: z.string().optional().describe('Search text in response bodies'),
    },
    async ({ site, search }) => {
      try {
        const store = await getDataStore();
        if (search) {
          const results = await store.searchInResponses(search, site || null);
          return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
        }
        if (site) {
          const results = await store.getResponseList(site);
          return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
        }
        // No site specified — show available sites
        const sites = store.getSiteList();
        if (sites.length === 0) {
          return { content: [{ type: 'text', text: 'No captured data yet. Navigate to a page first using navigate_page.' }] };
        }
        return { content: [{ type: 'text', text: JSON.stringify(sites, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.tool(
    'get_network_request',
    'Get full request details (headers, body, response)',
    {
      site: z.string().describe('Site hostname'),
      id: z.string().describe('Request ID'),
    },
    async ({ site, id }) => {
      try {
        const store = await getDataStore();
        const result = await store.getResponse(site, id);
        if (!result) {
          return { content: [{ type: 'text', text: JSON.stringify({ error: 'Request not found' }) }], isError: true };
        }
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.tool(
    'list_websockets',
    'List WebSocket connections. Starts tracking if not already enabled.',
    {},
    async () => {
      try {
        const runtime = await getRuntime();
        const captures = runtime.captures;
        const cdp = await getCDPSession();
        if (captures.webSocketSession !== cdp) {
          captures.webSocketConnections = [];
          captures.webSocketMessages = [];
          captures.webSocketTracking = false;
          captures.webSocketSession = cdp;
        }
        // Enable WebSocket tracking once for this Runtime and raw CDP session.
        if (!captures.webSocketTracking) {
          cdp.on('Network.webSocketCreated', (params) => {
            if (captures.webSocketSession !== cdp) return;
            captures.webSocketConnections.push({ requestId: params.requestId, url: params.url, timestamp: Date.now() });
          });
          cdp.on('Network.webSocketFrameReceived', (params) => {
            if (captures.webSocketSession !== cdp) return;
            captures.webSocketMessages.push({ requestId: params.requestId, direction: 'received', data: params.response?.payloadData, timestamp: Date.now() });
          });
          cdp.on('Network.webSocketFrameSent', (params) => {
            if (captures.webSocketSession !== cdp) return;
            captures.webSocketMessages.push({ requestId: params.requestId, direction: 'sent', data: params.response?.payloadData, timestamp: Date.now() });
          });
          await cdp.send('Network.enable');
          captures.webSocketTracking = true;
        }
        return { content: [{ type: 'text', text: JSON.stringify({ connections: captures.webSocketConnections, messageCount: captures.webSocketMessages.length }, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.tool(
    'get_websocket_messages',
    'Get WebSocket messages for a connection',
    {
      requestId: z.string().describe('WebSocket request ID from list_websockets'),
      limit: z.number().optional().default(50).describe('Max messages'),
      direction: z.enum(['all', 'sent', 'received']).optional().default('all'),
    },
    async ({ requestId, limit, direction }) => {
      try {
        const runtime = await getRuntime();
        let msgs = runtime.captures.webSocketMessages.filter(m => m.requestId === requestId);
        if (direction !== 'all') {
          msgs = msgs.filter(m => m.direction === direction);
        }
        msgs = msgs.slice(-limit);
        return { content: [{ type: 'text', text: JSON.stringify({ count: msgs.length, messages: msgs }, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.tool(
    'get_request_initiator',
    'Get the JS call stack that initiated this request. Returns script URL + line number + function name. Essential first step for reverse engineering.',
    {
      site: z.string().describe('Site hostname'),
      id: z.string().describe('Request ID'),
    },
    async ({ site, id }) => {
      try {
        const store = await getDataStore();
        const result = await store.getResponse(site, id);
        if (!result) {
          return { content: [{ type: 'text', text: JSON.stringify({ error: 'Request not found' }) }], isError: true };
        }
        if (!result.initiator) {
          return { content: [{ type: 'text', text: JSON.stringify({ error: 'No initiator info (may be browser-internal request)' }) }] };
        }
        return { content: [{ type: 'text', text: JSON.stringify(result.initiator, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
      }
    }
  );
}
