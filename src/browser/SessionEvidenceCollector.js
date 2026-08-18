function storageSnapshot() {
  const read = (storage) => {
    const values = {}
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index)
      values[key] = storage.getItem(key)
    }
    return values
  }

  return {
    referrer: document.referrer,
    local: read(localStorage),
    session: read(sessionStorage),
  }
}

function probeSnapshot() {
  const api = globalThis.__deepspider__
  if (!api?.getLogs) return null
  const read = (type) => {
    try { return JSON.parse(api.getLogs(type)) } catch { return [] }
  }
  return {
    cookie: read('cookie'),
    storage: read('storage'),
    fetch: read('fetch'),
    xhr: read('xhr'),
  }
}
export class SessionEvidenceCollector {
  constructor(page) {
    if (!page) throw new TypeError('page must be provided')
    this.page = page
  }

  async collect() {
    const [title, html, storage, cookies, probe] = await Promise.all([
      this.page.title(),
      this.page.content(),
      this.page.evaluate(storageSnapshot),
      this.page.context().cookies(),
      this.page.evaluate(probeSnapshot).catch(() => null),
    ])

    return {
      source: 'patchright-session',
      mode: 'observe',
      page: {
        url: this.page.url(),
        title,
        referrer: storage.referrer,
      },
      storage: {
        cookies,
        local: storage.local,
        session: storage.session,
      },
      probe,
      document: { html },
    }
  }
}
