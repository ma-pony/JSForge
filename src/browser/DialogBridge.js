import { getAnalysisPanelScript } from './ui/analysisPanel.js'

const BINDING_NAME = '__deepspider_send__'

function ownedJson(value) {
  return JSON.parse(JSON.stringify(value))
}

export class DialogBridge {
  constructor({ onMessage = null } = {}) {
    this.onMessage = onMessage
    this.page = null
    this.cdp = null
    this.frames = []
    this._bindingListener = null
  }

  setMessageHandler(handler) {
    if (handler != null && typeof handler !== 'function') {
      throw new TypeError('Dialog message handler must be a function')
    }
    this.onMessage = handler
  }

  async open({ page, cdp }) {
    if (!page || !cdp) throw new TypeError('Dialog requires page and cdp')
    if (this.page === page && this.cdp === cdp) {
      this.frames = typeof page.frames === 'function' ? page.frames() : [page]
      const source = getAnalysisPanelScript()
      await Promise.all(this.frames.map((frame) => frame.evaluate(source)))
      return
    }
    if (this.page || this.cdp) await this.close()

    this.page = page
    this.cdp = cdp
    this.frames = typeof page.frames === 'function' ? page.frames() : [page]
    this._bindingListener = (event) => {
      if (event?.name !== BINDING_NAME) return
      let message
      try {
        message = JSON.parse(event.payload)
      } catch {
        return
      }
      Promise.resolve(this.onMessage?.(ownedJson(message))).catch((error) => {
        console.error('[DeepSpider Dialog] message handler failed:', error.message)
      })
    }

    try {
      await cdp.send('Runtime.addBinding', { name: BINDING_NAME })
      cdp.on('Runtime.bindingCalled', this._bindingListener)
      const source = getAnalysisPanelScript()
      await Promise.all(this.frames.map((frame) => frame.evaluate(source)))
    } catch (error) {
      await this.close()
      throw error
    }
  }

  async send(payload) {
    if (!this.page) return false
    const value = ownedJson(payload)
    const receiver = `(payload) => globalThis.__deepspider_dialog_receive__?.(payload)`
    const frame = this.frames[0] || this.page
    await frame.evaluate(receiver, value)
    return true
  }

  async close() {
    const cdp = this.cdp
    const frames = this.frames
    const listener = this._bindingListener

    this.page = null
    this.cdp = null
    this.frames = []
    this._bindingListener = null

    if (cdp && listener) cdp.off('Runtime.bindingCalled', listener)
    await Promise.allSettled(frames.map((frame) => (
      frame.evaluate(`() => globalThis.__deepspider_dialog_close__?.()`)
    )))
    if (cdp) {
      await cdp.send('Runtime.removeBinding', { name: BINDING_NAME }).catch(() => {})
    }
  }
}
