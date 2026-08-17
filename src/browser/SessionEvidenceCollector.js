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
export class SessionEvidenceCollector {
  constructor(page) {
    if (!page) throw new TypeError('page must be provided')
    this.page = page
  }

  async collect() {
    const [title, html, storage, cookies] = await Promise.all([
      this.page.title(),
      this.page.content(),
      this.page.evaluate(storageSnapshot),
      this.page.context().cookies(),
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
      document: { html },
    }
  }
}
