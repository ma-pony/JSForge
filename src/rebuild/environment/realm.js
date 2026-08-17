import { JSDOM } from 'jsdom'

export function createEnvironmentRealm({ html = '<!doctype html>', url, compiled }) {
  if (!compiled?.installerSource) throw new TypeError('compiled environment must be provided')

  const dom = new JSDOM(html, {
    url,
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  })
  const context = dom.getInternalVMContext()
  const controller = context.eval(compiled.installerSource)
  let closed = false

  return {
    window: dom.window,
    context,
    setTraceEmitter(emit) {
      controller.setTraceEmitter(emit)
    },
    close() {
      if (closed) return
      closed = true
      dom.window.close()
    },
  }
}
