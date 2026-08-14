import { join } from 'node:path'

import { ensureDir, generateFilename } from '../../config/paths.js'
import { defineDeepSpiderTool } from '../catalog.js'
import { DeepSpiderToolError } from '../errors.js'

function failure(error, code = 'BROWSER_OPERATION_FAILED') {
  if (error instanceof DeepSpiderToolError) throw error
  throw new DeepSpiderToolError(code, error.message)
}

async function ensureConsoleTracking(runtime, cdp, signal) {
  const captures = runtime.captures
  if (captures.consoleTracking) return
  if (captures.consoleInitializationPromise && captures.consoleInitializationSession === cdp) {
    await runtime.waitForOperation(captures.consoleInitializationPromise, { signal })
    return
  }

  const initialization = (async () => {
    try {
      await runtime.waitForOperation(cdp.send('Runtime.enable'))
      if (captures.consoleSession !== cdp || captures.consoleInitializationPromise !== initialization) return

      cdp.on('Runtime.consoleAPICalled', (params) => {
        if (captures.consoleSession !== cdp) return
        captures.consoleMessages.push({
          type: params.type,
          text: params.args?.map((arg) => arg.value ?? arg.description ?? '').join(' '),
          timestamp: params.timestamp,
          url: params.stackTrace?.callFrames?.[0]?.url,
          line: params.stackTrace?.callFrames?.[0]?.lineNumber,
        })
        if (captures.consoleMessages.length > 500) captures.consoleMessages.shift()
      })
      captures.consoleTracking = true
    } finally {
      if (captures.consoleInitializationPromise === initialization) {
        captures.consoleInitializationPromise = null
        captures.consoleInitializationSession = null
      }
    }
  })()

  captures.consoleInitializationSession = cdp
  captures.consoleInitializationPromise = initialization
  await runtime.waitForOperation(initialization, { signal })
}

export const tools = Object.freeze([
  defineDeepSpiderTool({
    name: 'navigate_page',
    description: 'Navigate to URL or reload current page',
    parameters: {
      url: { type: 'string', description: 'URL to navigate to' },
      reload: { type: 'boolean', default: false, description: 'Reload current page' },
    },
    async execute(runtime, { url, reload = false }, signal) {
      try {
        if (url) {
          const finalUrl = await runtime.navigateTo(url, { signal })
          const title = await runtime.cdpEvaluate('document.title', { signal })
          return { url: finalUrl, title }
        }
        if (reload) {
          runtime.clearNavigationDerivedState()
          await runtime.cdpSend('Page.reload', {}, { signal })
          await runtime.waitForOperation(new Promise((resolve) => setTimeout(resolve, 1000)), { signal })
        }
        const info = await runtime.cdpEvaluate(
          '({ url: location.href, title: document.title })',
          { signal },
        )
        return info ?? null
      } catch (error) {
        failure(error)
      }
    },
  }),
  defineDeepSpiderTool({
    name: 'click',
    description: 'Click page element by CSS selector',
    parameters: {
      selector: { type: 'string', required: true, description: 'CSS selector' },
    },
    async execute(runtime, { selector }, signal) {
      try {
        const page = await runtime.getPage({ signal })
        await runtime.waitForOperation(page.click(selector, { force: true }), { signal })
        return { success: true, selector }
      } catch (error) {
        failure(error)
      }
    },
  }),
  defineDeepSpiderTool({
    name: 'fill',
    description: 'Fill input field',
    parameters: {
      selector: { type: 'string', required: true, description: 'CSS selector' },
      value: { type: 'string', required: true, description: 'Value to fill' },
    },
    async execute(runtime, { selector, value }, signal) {
      try {
        const page = await runtime.getPage({ signal })
        await runtime.waitForOperation(page.fill(selector, value, { force: true }), { signal })
        return { success: true, selector, value }
      } catch (error) {
        failure(error)
      }
    },
  }),
  defineDeepSpiderTool({
    name: 'press_key',
    description: 'Press keyboard key (Enter, Escape, Tab, ArrowDown, etc.)',
    parameters: {
      key: { type: 'string', required: true, description: 'Key name' },
    },
    async execute(runtime, { key }, signal) {
      try {
        const page = await runtime.getPage({ signal })
        await runtime.waitForOperation(page.keyboard.press(key), { signal })
        return { success: true, key }
      } catch (error) {
        failure(error)
      }
    },
  }),
  defineDeepSpiderTool({
    name: 'take_screenshot',
    description: 'Take page screenshot, saved to the current session screenshots directory',
    parameters: {
      fullPage: { type: 'boolean', default: true, description: 'Capture full page' },
    },
    async execute(runtime, { fullPage = true }, signal) {
      try {
        const page = await runtime.getPage({ signal })
        ensureDir(runtime.paths.screenshots)
        const filename = generateFilename('screenshot', 'png')
        const savePath = join(runtime.paths.screenshots, filename)
        await runtime.waitForOperation(page.screenshot({ path: savePath, fullPage }), { signal })
        return { success: true, filePath: savePath }
      } catch (error) {
        failure(error)
      }
    },
  }),
  defineDeepSpiderTool({
    name: 'scroll_page',
    description: 'Scroll page up or down',
    parameters: {
      direction: {
        type: 'string',
        enum: ['up', 'down'],
        required: true,
        description: 'Scroll direction',
      },
      distance: { type: 'number', default: 500, description: 'Scroll distance in pixels' },
    },
    async execute(runtime, { direction, distance = 500 }, signal) {
      try {
        const deltaY = direction === 'up' ? -distance : distance
        await runtime.cdpSend('Input.dispatchMouseEvent', {
          type: 'mouseWheel', x: 100, y: 100, deltaX: 0, deltaY,
        }, { signal })
        return { success: true, direction, distance }
      } catch (error) {
        failure(error)
      }
    },
  }),
  defineDeepSpiderTool({
    name: 'wait_for',
    description: 'Wait for element to appear/disappear',
    parameters: {
      selector: { type: 'string', required: true, description: 'CSS selector' },
      timeout: { type: 'number', default: 30000, description: 'Timeout in ms' },
      state: {
        type: 'string',
        enum: ['attached', 'detached', 'visible', 'hidden'],
        default: 'attached',
      },
    },
    async execute(runtime, { selector, timeout = 30000, state = 'attached' }, signal) {
      try {
        const page = await runtime.getPage({ signal })
        await runtime.waitForOperation(page.waitForSelector(selector, { timeout, state }), { signal })
        return { success: true, selector, state }
      } catch (error) {
        failure(error)
      }
    },
  }),
  defineDeepSpiderTool({
    name: 'evaluate_script',
    description: 'Evaluate JavaScript expression in page context via CDP. Promises are always awaited. Honors select_frame active iframe context.',
    parameters: {
      expression: { type: 'string', required: true, description: 'JS expression to evaluate' },
    },
    async execute(runtime, { expression }, signal) {
      try {
        const value = await runtime.cdpEvaluate(expression, { signal })
        const frameContext = runtime.getActiveFrameContext()
        if (frameContext.contextId != null) {
          return { frameId: frameContext.frameId, value: value ?? null }
        }
        return value ?? null
      } catch (error) {
        failure(error)
      }
    },
  }),
  defineDeepSpiderTool({
    name: 'inject_preload_script',
    description: 'Inject script to run before any page script loads. Useful for hooking globals before anti-debug runs.',
    parameters: {
      source: { type: 'string', required: true, description: 'JavaScript source to inject' },
    },
    async execute(runtime, { source }, signal) {
      try {
        const { identifier } = await runtime.cdpSend(
          'Page.addScriptToEvaluateOnNewDocument',
          { source },
          { signal },
        )
        return { success: true, identifier }
      } catch (error) {
        failure(error)
      }
    },
  }),
  defineDeepSpiderTool({
    name: 'list_frames',
    description: 'List all frames (iframes) in the page',
    parameters: {},
    async execute(runtime, _args, signal) {
      try {
        const { frameTree } = await runtime.cdpSend('Page.getFrameTree', {}, { signal })

        function flattenFrames(node, depth = 0) {
          const frames = [{ id: node.frame.id, url: node.frame.url, name: node.frame.name || '', depth }]
          for (const child of node.childFrames || []) frames.push(...flattenFrames(child, depth + 1))
          return frames
        }

        return { frames: flattenFrames(frameTree) }
      } catch (error) {
        failure(error)
      }
    },
  }),
  defineDeepSpiderTool({
    name: 'select_frame',
    description: 'Switch execution context to a specific iframe by frame ID. Subsequent evaluate_script / cdpEvaluate / collect_property calls run in this frame until select_frame(mainFrame), select_page, or navigate_page is called.',
    parameters: {
      frameId: {
        type: 'string',
        required: true,
        description: 'Frame ID from list_frames. Pass empty string to clear and return to main frame.',
      },
    },
    async execute(runtime, { frameId }, signal) {
      try {
        if (!frameId) {
          runtime.clearActiveFrameContext()
          return { success: true, cleared: true }
        }
        const { executionContextId } = await runtime.cdpSend('Page.createIsolatedWorld', {
          frameId,
          worldName: 'deepspider',
        }, { signal })
        runtime.setActiveFrameContext(frameId, executionContextId)
        return {
          success: true,
          frameId,
          executionContextId,
          note: 'subsequent evaluate/cdpEvaluate calls will run in this frame until cleared',
        }
      } catch (error) {
        failure(error)
      }
    },
  }),
  defineDeepSpiderTool({
    name: 'list_pages',
    description: 'List all open browser pages/tabs',
    parameters: {},
    async execute(runtime, _args, signal) {
      try {
        const client = await runtime.getBrowserClient({ signal })
        if (!client.context) {
          throw new DeepSpiderToolError('NO_BROWSER_CONTEXT', 'No browser context')
        }
        const pages = client.context.pages()
        const info = await runtime.waitForOperation(Promise.all(pages.map(async (page, index) => ({
          index,
          url: page.url(),
          title: await runtime.waitForOperation(page.title(), { signal }).catch(() => ''),
        }))), { signal })
        return { pages: info }
      } catch (error) {
        failure(error)
      }
    },
  }),
  defineDeepSpiderTool({
    name: 'select_page',
    description: 'Switch active page to a different tab by index',
    parameters: {
      index: { type: 'number', required: true, description: 'Page index from list_pages' },
    },
    async execute(runtime, { index }, signal) {
      try {
        const client = await runtime.getBrowserClient({ signal })
        const pages = client.context.pages()
        if (index < 0 || index >= pages.length) {
          throw new DeepSpiderToolError(
            'PAGE_INDEX_OUT_OF_RANGE',
            `Index ${index} out of range (${pages.length} pages)`,
          )
        }
        runtime.clearPageDerivedState()
        client.page = pages[index]
        runtime.page = pages[index]
        await runtime.waitForOperation(pages[index].bringToFront(), { signal })
        const url = pages[index].url()
        const title = await runtime.waitForOperation(pages[index].title(), { signal })
        return { success: true, index, url, title }
      } catch (error) {
        failure(error)
      }
    },
  }),
  defineDeepSpiderTool({
    name: 'save_session_state',
    description: 'Save current page state: cookies + localStorage + sessionStorage snapshot',
    parameters: {},
    async execute(runtime, _args, signal) {
      try {
        const pageUrl = await runtime.cdpEvaluate('location.href', { signal })
        const { cookies } = await runtime.cdpSend('Network.getCookies', { urls: [pageUrl] }, { signal })
        const storage = await runtime.cdpEvaluate(`({
          localStorage: Object.fromEntries(Object.keys(localStorage).map(k => [k, localStorage.getItem(k)])),
          sessionStorage: Object.fromEntries(Object.keys(sessionStorage).map(k => [k, sessionStorage.getItem(k)])),
        })`, { signal })
        runtime.captures.savedSessionState = {
          url: pageUrl,
          cookies,
          ...storage,
          savedAt: new Date().toISOString(),
        }
        return { success: true, url: pageUrl, cookieCount: cookies.length }
      } catch (error) {
        failure(error)
      }
    },
  }),
  defineDeepSpiderTool({
    name: 'restore_session_state',
    description: 'Restore previously saved session state (cookies + localStorage + sessionStorage)',
    parameters: {},
    async execute(runtime, _args, signal) {
      try {
        const savedSessionState = runtime.captures.savedSessionState
        if (!savedSessionState) {
          throw new DeepSpiderToolError('NO_SAVED_SESSION_STATE', 'No saved state. Call save_session_state first.')
        }
        for (const cookie of savedSessionState.cookies) {
          await runtime.cdpSend('Network.setCookie', cookie, { signal })
        }
        const localStorage = savedSessionState.localStorage || {}
        const sessionStorage = savedSessionState.sessionStorage || {}
        await runtime.cdpEvaluate(`
          ${Object.entries(localStorage).map(([key, value]) => `localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(value)})`).join(';')};
          ${Object.entries(sessionStorage).map(([key, value]) => `sessionStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(value)})`).join(';')};
        `, { signal })
        return { success: true, savedAt: savedSessionState.savedAt }
      } catch (error) {
        failure(error)
      }
    },
  }),
  defineDeepSpiderTool({
    name: 'list_console_messages',
    description: 'List captured console messages (log, warn, error)',
    parameters: {
      level: { type: 'string', enum: ['all', 'log', 'warning', 'error'], default: 'all' },
      limit: { type: 'number', default: 50, description: 'Max messages to return' },
    },
    async execute(runtime, { level = 'all', limit = 50 }, signal) {
      try {
        const captures = runtime.captures
        const cdp = await runtime.getCDPSession({ signal })
        if (captures.consoleSession !== cdp) {
          captures.consoleMessages = []
          captures.consoleTracking = false
          captures.consoleSession = cdp
          captures.consoleInitializationPromise = null
          captures.consoleInitializationSession = null
        }
        await ensureConsoleTracking(runtime, cdp, signal)
        let messages = captures.consoleMessages
        if (level !== 'all') messages = messages.filter((message) => message.type === level)
        messages = messages.slice(-limit)
        return { count: messages.length, messages }
      } catch (error) {
        failure(error)
      }
    },
  }),
  defineDeepSpiderTool({
    name: 'get_console_message',
    description: 'Get a single console message by index',
    parameters: {
      index: { type: 'number', required: true, description: 'Message index from list_console_messages' },
    },
    async execute(runtime, { index }, _signal) {
      try {
        const messages = runtime.captures.consoleMessages
        if (index < 0 || index >= messages.length) {
          throw new DeepSpiderToolError(
            'CONSOLE_MESSAGE_INDEX_OUT_OF_RANGE',
            `Index ${index} out of range (${messages.length} messages)`,
          )
        }
        return messages[index]
      } catch (error) {
        failure(error)
      }
    },
  }),
  defineDeepSpiderTool({
    name: 'get_dom_structure',
    description: 'Get page DOM structure (document outline with tag names, IDs, classes)',
    parameters: {
      depth: { type: 'number', default: 4, description: 'Max depth to traverse' },
      selector: { type: 'string', description: 'CSS selector to start from' },
    },
    async execute(runtime, { depth = 4, selector: _selector }, signal) {
      try {
        const { root } = await runtime.cdpSend('DOM.getDocument', { depth }, { signal })

        function summarizeNode(node, maxDepth, currentDepth = 0) {
          if (currentDepth > maxDepth) return null
          const summary = { tag: node.nodeName.toLowerCase() }
          if (node.attributes) {
            const attrs = {}
            for (let index = 0; index < node.attributes.length; index += 2) {
              const name = node.attributes[index]
              if (['id', 'class', 'name', 'type', 'href', 'src'].includes(name)) {
                attrs[name] = node.attributes[index + 1]
              }
            }
            if (Object.keys(attrs).length > 0) summary.attrs = attrs
          }
          if (node.children?.length > 0) {
            const children = node.children
              .filter((child) => child.nodeType === 1)
              .map((child) => summarizeNode(child, maxDepth, currentDepth + 1))
              .filter(Boolean)
            if (children.length > 0) summary.children = children
          }
          return summary
        }

        return summarizeNode(root, depth)
      } catch (error) {
        failure(error)
      }
    },
  }),
  defineDeepSpiderTool({
    name: 'get_storage',
    description: 'Get all browser storage at once: cookies + localStorage + sessionStorage',
    parameters: {},
    async execute(runtime, _args, signal) {
      try {
        const pageUrl = await runtime.cdpEvaluate('location.href', { signal })
        const { cookies } = await runtime.cdpSend('Network.getCookies', { urls: [pageUrl] }, { signal })
        const storage = await runtime.cdpEvaluate(`({
          localStorage: Object.fromEntries(Object.keys(localStorage).map(k => [k, localStorage.getItem(k)])),
          sessionStorage: Object.fromEntries(Object.keys(sessionStorage).map(k => [k, sessionStorage.getItem(k)])),
        })`, { signal })
        return {
          cookies: cookies.map((cookie) => ({
            name: cookie.name,
            value: cookie.value,
            domain: cookie.domain,
            httpOnly: cookie.httpOnly,
            secure: cookie.secure,
          })),
          cookieCount: cookies.length,
          localStorage: storage.localStorage,
          localStorageCount: Object.keys(storage.localStorage).length,
          sessionStorage: storage.sessionStorage,
          sessionStorageCount: Object.keys(storage.sessionStorage).length,
        }
      } catch (error) {
        failure(error)
      }
    },
  }),
  defineDeepSpiderTool({
    name: 'get_page_info',
    description: 'Get current page URL, title, and optionally cookies',
    parameters: {
      includeCookies: { type: 'boolean', default: false },
      cookieFormat: { type: 'string', enum: ['full', 'header', 'dict'], default: 'full' },
    },
    async execute(runtime, { includeCookies = false, cookieFormat = 'full' }, signal) {
      try {
        const info = await runtime.cdpEvaluate('({ url: location.href, title: document.title })', { signal })
        if (!includeCookies) return info

        const { cookies } = await runtime.cdpSend('Network.getCookies', { urls: [info.url] }, { signal })
        if (cookieFormat === 'header') {
          info.cookie = cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ')
        } else if (cookieFormat === 'dict') {
          info.cookies = {}
          cookies.forEach((cookie) => { info.cookies[cookie.name] = cookie.value })
        } else {
          info.cookies = cookies.map((cookie) => ({
            name: cookie.name,
            value: cookie.value,
            domain: cookie.domain,
            path: cookie.path,
            expires: cookie.expires,
            httpOnly: cookie.httpOnly,
            secure: cookie.secure,
          }))
        }
        info.cookieCount = cookies.length
        return info
      } catch (error) {
        failure(error)
      }
    },
  }),
])
