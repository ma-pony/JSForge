const VALUES = Object.freeze({
  'navigator.userAgent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  'navigator.appVersion': '5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  'navigator.platform': 'MacIntel',
  'navigator.vendor': 'Google Inc.',
  'navigator.language': 'en-US',
  'navigator.languages': ['en-US', 'en'],
  'navigator.hardwareConcurrency': 8,
  'navigator.deviceMemory': 8,
  'navigator.maxTouchPoints': 0,
  'navigator.pdfViewerEnabled': true,
  'navigator.connection': {
    effectiveType: '4g',
    rtt: 50,
    downlink: 10,
    saveData: false,
  },
  'navigator.plugins': [
    { name: 'PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
    { name: 'Chrome PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
    { name: 'Chromium PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
  ],
  'navigator.mimeTypes': [
    { type: 'application/pdf', suffixes: 'pdf', description: 'Portable Document Format' },
    { type: 'text/pdf', suffixes: 'pdf', description: 'Portable Document Format' },
  ],
  'screen.width': 1920,
  'screen.height': 1080,
  'screen.availWidth': 1920,
  'screen.availHeight': 1055,
  'screen.colorDepth': 24,
  'screen.pixelDepth': 24,
  innerWidth: 1920,
  innerHeight: 955,
  outerWidth: 1920,
  outerHeight: 1080,
  devicePixelRatio: 1,
  chrome: {
    app: {},
    runtime: {},
    loadTimes: {},
    csi: {},
  },
})

const CONCEAL = Object.freeze([
  { path: 'process', action: 'hide' },
  { path: 'require', action: 'hide' },
  { path: 'module', action: 'hide' },
  { path: 'Buffer', action: 'hide' },
  { path: 'global', action: 'hide' },
  { path: '__dirname', action: 'hide' },
  { path: '__filename', action: 'hide' },
  { path: 'navigator.webdriver', action: 'hide' },
])

export function getChromeBaseline() {
  return {
    name: 'chrome-default',
    values: globalThis.structuredClone(VALUES),
    conceal: globalThis.structuredClone(CONCEAL),
  }
}
