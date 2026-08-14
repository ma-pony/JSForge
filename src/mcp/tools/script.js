import { getDataStore } from '../context.js';
import { z } from 'zod';

export function registerScriptTools(server, dependencies = {}) {
  const getStore = dependencies.getStore || getDataStore;

  server.tool(
    'list_scripts',
    'List captured JS scripts',
    { site: z.string().optional() },
    async ({ site }) => {
      try {
        const store = getStore();
        const scripts = await store.getScriptList(site || null, true);
        return {
          content: [{ type: 'text', text: JSON.stringify(scripts, null, 2) }],
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
    'get_script_source',
    'Get script source code (supports chunked reading)',
    {
      site: z.string(),
      id: z.string(),
      offset: z.number().optional().default(0),
      limit: z.number().optional().default(5000),
    },
    async ({ site, id, offset, limit }) => {
      try {
        const store = getStore();
        const source = await store.getScript(site, id);
        const total = source.length;
        const content = source.slice(offset, offset + limit);
        const result = {
          total,
          offset,
          limit,
          hasMore: offset + limit < total,
          content,
        };
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
    'find_in_script',
    'Search text across scripts',
    {
      text: z.string(),
      site: z.string().optional(),
      contextChars: z.number().optional().default(3000),
    },
    async ({ text, site, contextChars }) => {
      try {
        const store = getStore();
        const matches = await store.searchInScripts(text, site || null);
        const found = matches.length > 0;
        const count = matches.length;
        const topMatches = matches.slice(0, 3);

        const extracts = await Promise.all(
          topMatches.map(async (match) => {
            try {
              const source = await store.getScript(match.site, match.id);
              const matchAt = source.indexOf(text);
              if (matchAt === -1) {
                return {
                  site: match.site,
                  scriptId: match.id,
                  scriptUrl: match.url,
                  offset: 0,
                  matchAt: -1,
                  code: '',
                  totalLength: source.length,
                };
              }
              const half = Math.floor(contextChars / 2);
              const start = Math.max(0, matchAt - half);
              const end = Math.min(source.length, matchAt + text.length + half);
              return {
                site: match.site,
                scriptId: match.id,
                scriptUrl: match.url,
                offset: start,
                matchAt,
                code: source.slice(start, end),
                totalLength: source.length,
              };
            } catch {
              return {
                site: match.site,
                scriptId: match.id,
                scriptUrl: match.url,
                offset: 0,
                matchAt: -1,
                code: '',
                totalLength: 0,
              };
            }
          })
        );

        const result = { found, count, extracts };
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
}
