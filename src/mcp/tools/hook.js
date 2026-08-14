import { z } from 'zod';

export function registerHookTools(server, dependencies) {
  const { cdpEvaluate } = dependencies;
  server.tool(
    'inject_hook',
    'Inject custom Hook code into browser page. The code runs in page context with access to window.__deepspider__ API.',
    { code: z.string().describe('JS code to inject') },
    async ({ code }) => {
      try {
        const safeCode = JSON.stringify(code);
        const result = await cdpEvaluate(`JSON.stringify(window.__deepspider__?.injectHook?.(${safeCode}))`);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Error: ${err.message}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    'get_hook_data',
    'Get Hook captured logs.',
    {
      type: z.string().optional().describe('Log type: xhr, fetch, cookie, crypto, json, eval, storage, encoding, websocket, env, debug, dom. Empty for all'),
      limit: z.number().optional().default(50),
    },
    async ({ type, limit }) => {
      try {
        let raw;
        if (type) {
          // JSON.stringify produces a safely-escaped JS string literal
          raw = await cdpEvaluate(`window.__deepspider__?.getLogs?.(${JSON.stringify(type)}) || '[]'`);
        } else {
          raw = await cdpEvaluate(`window.__deepspider__?.getAllLogs?.() || '[]'`);
        }
        const logs = JSON.parse(raw);
        const sliced = logs.slice(-limit);
        const result = { count: sliced.length, logs: sliced };
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Error: ${err.message}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    'search_hook_data',
    'Search Hook logs by keyword.',
    { keyword: z.string() },
    async ({ keyword }) => {
      try {
        // JSON.stringify safely escapes apostrophes, backslashes, and newlines
        const raw = await cdpEvaluate(`window.__deepspider__?.searchLogs?.(${JSON.stringify(keyword)}) || '[]'`);
        const results = JSON.parse(raw);
        return {
          content: [{ type: 'text', text: JSON.stringify(results, null, 2) }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Error: ${err.message}` }],
          isError: true,
        };
      }
    }
  );
}
