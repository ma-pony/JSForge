/**
 * DeepSpider MCP - Environment capture tools
 */

import { z } from 'zod';
import { EnvCollector, collectPropertyInRealm } from '../../browser/collector.js';

export function registerCaptureTools(server, dependencies = {}) {
  const getCurrentPage = dependencies.getPage;
  const getFrameContext = dependencies.getFrameContext || dependencies.getActiveFrameContext;
  const evaluateFrame = dependencies.evaluateFrame || dependencies.cdpEvaluate;

  server.tool(
    'collect_env',
    'Collect full browser environment snapshot (navigator, screen, canvas, webgl, fonts, etc.)',
    {},
    async () => {
      try {
        const page = await getCurrentPage();
        const collector = new EnvCollector(page);
        const data = await collector.collectFullSnapshot();
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.tool(
    'collect_property',
    'Collect a specific browser property value from the real browser. Use for env patching.',
    {
      path: z.string().describe('Property path, e.g. navigator.connection.effectiveType'),
      depth: z.number().optional().default(2).describe('Collection depth'),
    },
    async ({ path, depth }) => {
      try {
        const frameCtx = await getFrameContext();
        // When a specific iframe is selected, use CDP Runtime.evaluate in that context.
        // (EnvCollector uses page.evaluate which always targets the main frame.)
        if (frameCtx.contextId != null) {
          const args = JSON.stringify({ path, depth });
          const expr = `(() => ({ ...(${collectPropertyInRealm.toString()})(${args}), frameId: ${JSON.stringify(frameCtx.frameId)} }))()`;
          const data = await evaluateFrame(expr);
          return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
        }

        const page = await getCurrentPage();
        const collector = new EnvCollector(page);
        const data = await collector.collect(path, { depth });

        // Add hints for undefined/null values
        if (data?.success === false && /undefined|null/.test(data?.error || '')) {
          const storageMatch = path.match(/^(localStorage|sessionStorage)\./);
          if (storageMatch) {
            try {
              const keysData = await collector.collect(storageMatch[1], { depth: 1 });
              const keys = keysData?.success ? Object.keys(keysData.data?.properties || {}) : [];
              return {
                content: [{ type: 'text', text: JSON.stringify({
                  ...data,
                  hint: `${storageMatch[1]} has ${keys.length} keys: [${keys.slice(0, 30).join(', ')}]. Check key name or trigger the write operation first.`,
                }, null, 2) }],
              };
            } catch { /* fall through */ }
          }
          return {
            content: [{ type: 'text', text: JSON.stringify({
              ...data,
              hint: `Variable ${path} is undefined. It may only exist during specific function execution. Use set_breakpoint + evaluate_on_callframe to capture it at runtime.`,
            }, null, 2) }],
          };
        }

        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
      }
    }
  );
}
