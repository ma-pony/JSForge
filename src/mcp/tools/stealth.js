/**
 * DeepSpider MCP - Anti-debug / stealth tools
 */

import { z } from 'zod';

export function registerStealthTools(server, dependencies) {
  const { getBrowserClient } = dependencies;
  server.tool(
    'toggle_anti_debug',
    'Toggle anti-debug protection. When enabled (default), debugger statements are skipped. Disable before setting breakpoints.',
    {
      enabled: z.boolean().describe('true = skip debugger statements (safe mode), false = allow debugger pauses (for breakpoints)'),
    },
    async ({ enabled }) => {
      try {
        const client = await getBrowserClient();
        const interceptor = client.antiDebugInterceptor;
        if (!interceptor) {
          return { content: [{ type: 'text', text: JSON.stringify({ error: 'AntiDebugInterceptor not available' }) }], isError: true };
        }

        if (enabled) {
          await interceptor.disablePauses();
        } else {
          await interceptor.enablePauses();
        }

        return {
          content: [{ type: 'text', text: JSON.stringify({
            success: true,
            antiDebug: enabled ? 'enabled (skipping debugger statements)' : 'disabled (breakpoints will work)',
          }) }],
        };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
      }
    }
  );
}
