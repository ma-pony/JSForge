/**
 * DeepSpider MCP - Browser control tools
 */

import { z } from 'zod';
import { join } from 'path';
import { PATHS, ensureDir, generateFilename } from '../../config/paths.js';

export function registerBrowserTools(server, dependencies) {
  const {
    getRuntime,
    getBrowserClient,
    getPage,
    getCDPSession,
    cdpEvaluate,
    navigateTo,
    setActiveFrameContext,
    clearActiveFrameContext,
    getActiveFrameContext,
  } = dependencies;
  server.tool(
    'navigate_page',
    'Navigate to URL or reload current page',
    {
      url: z.string().optional().describe('URL to navigate to'),
      reload: z.boolean().optional().default(false).describe('Reload current page'),
    },
    async ({ url, reload }) => {
      try {
        if (url) {
          const finalUrl = await navigateTo(url);
          const title = await cdpEvaluate('document.title');
          return { content: [{ type: 'text', text: JSON.stringify({ url: finalUrl, title }) }] };
        }
        if (reload) {
          const runtime = await getRuntime();
          runtime.clearNavigationDerivedState();
          const cdp = await getCDPSession();
          await cdp.send('Page.reload');
          await new Promise(r => setTimeout(r, 1000));
          const info = await cdpEvaluate('({ url: location.href, title: document.title })');
          return { content: [{ type: 'text', text: JSON.stringify(info) }] };
        }
        const info = await cdpEvaluate('({ url: location.href, title: document.title })');
        return { content: [{ type: 'text', text: JSON.stringify(info) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.tool(
    'click',
    'Click page element by CSS selector',
    { selector: z.string().describe('CSS selector') },
    async ({ selector }) => {
      try {
        const page = await getPage();
        await page.click(selector, { force: true });
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, selector }) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.tool(
    'fill',
    'Fill input field',
    {
      selector: z.string().describe('CSS selector'),
      value: z.string().describe('Value to fill'),
    },
    async ({ selector, value }) => {
      try {
        const page = await getPage();
        await page.fill(selector, value, { force: true });
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, selector, value }) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.tool(
    'press_key',
    'Press keyboard key (Enter, Escape, Tab, ArrowDown, etc.)',
    { key: z.string().describe('Key name') },
    async ({ key }) => {
      try {
        const page = await getPage();
        await page.keyboard.press(key);
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, key }) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.tool(
    'take_screenshot',
    'Take page screenshot, saved to ~/.deepspider/output/screenshots/',
    {
      fullPage: z.boolean().optional().default(true).describe('Capture full page'),
    },
    async ({ fullPage }) => {
      try {
        const page = await getPage();
        ensureDir(PATHS.SCREENSHOTS_DIR);
        const filename = generateFilename('screenshot', 'png');
        const savePath = join(PATHS.SCREENSHOTS_DIR, filename);
        await page.screenshot({ path: savePath, fullPage });
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, filePath: savePath }) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.tool(
    'scroll_page',
    'Scroll page up or down',
    {
      direction: z.enum(['up', 'down']).describe('Scroll direction'),
      distance: z.number().optional().default(500).describe('Scroll distance in pixels'),
    },
    async ({ direction, distance }) => {
      try {
        const cdp = await getCDPSession();
        const deltaY = direction === 'up' ? -distance : distance;
        await cdp.send('Input.dispatchMouseEvent', {
          type: 'mouseWheel', x: 100, y: 100, deltaX: 0, deltaY,
        });
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, direction, distance }) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.tool(
    'wait_for',
    'Wait for element to appear/disappear',
    {
      selector: z.string().describe('CSS selector'),
      timeout: z.number().optional().default(30000).describe('Timeout in ms'),
      state: z.enum(['attached', 'detached', 'visible', 'hidden']).optional().default('attached'),
    },
    async ({ selector, timeout, state }) => {
      try {
        const page = await getPage();
        await page.waitForSelector(selector, { timeout, state });
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, selector, state }) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.tool(
    'evaluate_script',
    'Evaluate JavaScript expression in page context via CDP. Promises are always awaited. Honors select_frame active iframe context.',
    {
      expression: z.string().describe('JS expression to evaluate'),
    },
    async ({ expression }) => {
      try {
        // Route through cdpEvaluate so active iframe context (if any) is honored.
        const value = await cdpEvaluate(expression);
        // Backward-compatible contract: when no frame is active, return the raw
        // evaluated value (existing consumers parse this directly). Only wrap in
        // an envelope when an iframe context is active, so callers can tell which
        // frame produced the value.
        const frameCtx = await getActiveFrameContext();
        const payload = frameCtx.contextId != null
          ? { frameId: frameCtx.frameId, value }
          : value;
        return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.tool(
    'inject_preload_script',
    'Inject script to run before any page script loads. Useful for hooking globals before anti-debug runs.',
    {
      source: z.string().describe('JavaScript source to inject'),
    },
    async ({ source }) => {
      try {
        const cdp = await getCDPSession();
        const { identifier } = await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source });
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, identifier }) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.tool(
    'list_frames',
    'List all frames (iframes) in the page',
    {},
    async () => {
      try {
        const cdp = await getCDPSession();
        const { frameTree } = await cdp.send('Page.getFrameTree');

        function flattenFrames(node, depth = 0) {
          const frames = [{ id: node.frame.id, url: node.frame.url, name: node.frame.name || '', depth }];
          for (const child of node.childFrames || []) {
            frames.push(...flattenFrames(child, depth + 1));
          }
          return frames;
        }

        const frames = flattenFrames(frameTree);
        return { content: [{ type: 'text', text: JSON.stringify({ frames }, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.tool(
    'select_frame',
    'Switch execution context to a specific iframe by frame ID. Subsequent evaluate_script / cdpEvaluate / collect_property calls run in this frame until select_frame(mainFrame), select_page, or navigate_page is called.',
    {
      frameId: z.string().describe('Frame ID from list_frames. Pass empty string to clear and return to main frame.'),
    },
    async ({ frameId }) => {
      try {
        if (!frameId) {
          await clearActiveFrameContext();
          return { content: [{ type: 'text', text: JSON.stringify({ success: true, cleared: true }) }] };
        }
        const cdp = await getCDPSession();
        // Create isolated world in the target frame
        const { executionContextId } = await cdp.send('Page.createIsolatedWorld', {
          frameId, worldName: 'deepspider',
        });
        await setActiveFrameContext(frameId, executionContextId);
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, frameId, executionContextId, note: 'subsequent evaluate/cdpEvaluate calls will run in this frame until cleared' }) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.tool(
    'list_pages',
    'List all open browser pages/tabs',
    {},
    async () => {
      try {
        const client = await getBrowserClient();
        const context = client.context;
        if (!context) {
          return { content: [{ type: 'text', text: JSON.stringify({ error: 'No browser context' }) }], isError: true };
        }
        const pages = context.pages();
        const info = await Promise.all(pages.map(async (p, i) => ({
          index: i,
          url: p.url(),
          title: await p.title().catch(() => ''),
        })));
        return { content: [{ type: 'text', text: JSON.stringify({ pages: info }, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.tool(
    'select_page',
    'Switch active page to a different tab by index',
    {
      index: z.number().describe('Page index from list_pages'),
    },
    async ({ index }) => {
      try {
        const client = await getBrowserClient();
        const pages = client.context.pages();
        if (index < 0 || index >= pages.length) {
          return { content: [{ type: 'text', text: JSON.stringify({ error: `Index ${index} out of range (${pages.length} pages)` }) }], isError: true };
        }
        // Switching tabs invalidates any iframe context bound to the previous page.
        await clearActiveFrameContext();
        const runtime = await getRuntime();
        runtime.clearPageDerivedState();
        client.page = pages[index];
        runtime.page = pages[index];
        await pages[index].bringToFront();
        const url = pages[index].url();
        const title = await pages[index].title();
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, index, url, title }) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.tool(
    'save_session_state',
    'Save current page state: cookies + localStorage + sessionStorage snapshot',
    {},
    async () => {
      try {
        const cdp = await getCDPSession();
        const pageUrl = await cdpEvaluate('location.href');
        const { cookies } = await cdp.send('Network.getCookies', { urls: [pageUrl] });
        const storage = await cdpEvaluate(`({
          localStorage: Object.fromEntries(Object.keys(localStorage).map(k => [k, localStorage.getItem(k)])),
          sessionStorage: Object.fromEntries(Object.keys(sessionStorage).map(k => [k, sessionStorage.getItem(k)])),
        })`);

        const state = { url: pageUrl, cookies, ...storage, savedAt: new Date().toISOString() };
        const runtime = await getRuntime();
        runtime.captures.savedSessionState = state;
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, url: pageUrl, cookieCount: cookies.length }) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.tool(
    'restore_session_state',
    'Restore previously saved session state (cookies + localStorage + sessionStorage)',
    {},
    async () => {
      try {
        const runtime = await getRuntime();
        const savedSessionState = runtime.captures.savedSessionState;
        if (!savedSessionState) {
          return { content: [{ type: 'text', text: JSON.stringify({ error: 'No saved state. Call save_session_state first.' }) }], isError: true };
        }

        const cdp = await getCDPSession();
        // Restore cookies
        for (const cookie of savedSessionState.cookies) {
          await cdp.send('Network.setCookie', cookie);
        }
        // Restore localStorage and sessionStorage
        const ls = savedSessionState.localStorage || {};
        const ss = savedSessionState.sessionStorage || {};
        await cdpEvaluate(`
          ${Object.entries(ls).map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(v)})`).join(';')};
          ${Object.entries(ss).map(([k, v]) => `sessionStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(v)})`).join(';')};
        `);
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, savedAt: savedSessionState.savedAt }) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.tool(
    'list_console_messages',
    'List captured console messages (log, warn, error)',
    {
      level: z.enum(['all', 'log', 'warning', 'error']).optional().default('all'),
      limit: z.number().optional().default(50).describe('Max messages to return'),
    },
    async ({ level, limit }) => {
      try {
        const runtime = await getRuntime();
        const captures = runtime.captures;
        const cdp = await getCDPSession();
        if (captures.consoleSession !== cdp) {
          captures.consoleMessages = [];
          captures.consoleTracking = false;
          captures.consoleSession = cdp;
        }
        // Enable console tracking once for this Runtime and raw CDP session.
        if (!captures.consoleTracking) {
          cdp.on('Runtime.consoleAPICalled', (params) => {
            if (captures.consoleSession !== cdp) return;
            captures.consoleMessages.push({
              type: params.type,
              text: params.args?.map(a => a.value ?? a.description ?? '').join(' '),
              timestamp: params.timestamp,
              url: params.stackTrace?.callFrames?.[0]?.url,
              line: params.stackTrace?.callFrames?.[0]?.lineNumber,
            });
            // Cap at 500 messages
            if (captures.consoleMessages.length > 500) captures.consoleMessages.shift();
          });
          await cdp.send('Runtime.enable');
          captures.consoleTracking = true;
        }

        let messages = captures.consoleMessages;
        if (level !== 'all') {
          messages = messages.filter(m => m.type === level);
        }
        messages = messages.slice(-limit);
        return { content: [{ type: 'text', text: JSON.stringify({ count: messages.length, messages }, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.tool(
    'get_console_message',
    'Get a single console message by index',
    {
      index: z.number().describe('Message index from list_console_messages'),
    },
    async ({ index }) => {
      try {
        const runtime = await getRuntime();
        const messages = runtime.captures.consoleMessages;
        if (index < 0 || index >= messages.length) {
          return { content: [{ type: 'text', text: JSON.stringify({ error: `Index ${index} out of range (${messages.length} messages)` }) }], isError: true };
        }
        return { content: [{ type: 'text', text: JSON.stringify(messages[index], null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.tool(
    'get_dom_structure',
    'Get page DOM structure (document outline with tag names, IDs, classes)',
    {
      depth: z.number().optional().default(4).describe('Max depth to traverse'),
      selector: z.string().optional().describe('CSS selector to start from'),
    },
    async ({ depth, selector: _selector }) => {
      try {
        const cdp = await getCDPSession();
        const { root } = await cdp.send('DOM.getDocument', { depth });

        function summarizeNode(node, maxDepth, currentDepth = 0) {
          if (currentDepth > maxDepth) return null;
          const summary = { tag: node.nodeName.toLowerCase() };
          if (node.attributes) {
            const attrs = {};
            for (let i = 0; i < node.attributes.length; i += 2) {
              const name = node.attributes[i];
              if (['id', 'class', 'name', 'type', 'href', 'src'].includes(name)) {
                attrs[name] = node.attributes[i + 1];
              }
            }
            if (Object.keys(attrs).length > 0) summary.attrs = attrs;
          }
          if (node.children && node.children.length > 0) {
            const kids = node.children
              .filter(c => c.nodeType === 1) // element nodes only
              .map(c => summarizeNode(c, maxDepth, currentDepth + 1))
              .filter(Boolean);
            if (kids.length > 0) summary.children = kids;
          }
          return summary;
        }

        const tree = summarizeNode(root, depth);
        return { content: [{ type: 'text', text: JSON.stringify(tree, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.tool(
    'get_storage',
    'Get all browser storage at once: cookies + localStorage + sessionStorage',
    {},
    async () => {
      try {
        const cdp = await getCDPSession();
        const pageUrl = await cdpEvaluate('location.href');
        const { cookies } = await cdp.send('Network.getCookies', { urls: [pageUrl] });
        const storage = await cdpEvaluate(`({
          localStorage: Object.fromEntries(Object.keys(localStorage).map(k => [k, localStorage.getItem(k)])),
          sessionStorage: Object.fromEntries(Object.keys(sessionStorage).map(k => [k, sessionStorage.getItem(k)])),
        })`);

        const result = {
          cookies: cookies.map(c => ({ name: c.name, value: c.value, domain: c.domain, httpOnly: c.httpOnly, secure: c.secure })),
          cookieCount: cookies.length,
          localStorage: storage.localStorage,
          localStorageCount: Object.keys(storage.localStorage).length,
          sessionStorage: storage.sessionStorage,
          sessionStorageCount: Object.keys(storage.sessionStorage).length,
        };
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.tool(
    'get_page_info',
    'Get current page URL, title, and optionally cookies',
    {
      includeCookies: z.boolean().optional().default(false),
      cookieFormat: z.enum(['full', 'header', 'dict']).optional().default('full'),
    },
    async ({ includeCookies, cookieFormat }) => {
      try {
        const info = await cdpEvaluate('({ url: location.href, title: document.title })');
        if (!includeCookies) {
          return { content: [{ type: 'text', text: JSON.stringify(info) }] };
        }

        const cdp = await getCDPSession();
        const { cookies } = await cdp.send('Network.getCookies', { urls: [info.url] });

        if (cookieFormat === 'header') {
          info.cookie = cookies.map(c => `${c.name}=${c.value}`).join('; ');
        } else if (cookieFormat === 'dict') {
          info.cookies = {};
          cookies.forEach(c => { info.cookies[c.name] = c.value; });
        } else {
          info.cookies = cookies.map(c => ({
            name: c.name, value: c.value, domain: c.domain,
            path: c.path, expires: c.expires, httpOnly: c.httpOnly, secure: c.secure,
          }));
        }
        info.cookieCount = cookies.length;
        return { content: [{ type: 'text', text: JSON.stringify(info, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
      }
    }
  );
}
