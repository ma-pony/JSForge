import { createToolCatalog } from './catalog.js'
import { tools as browserTools } from './groups/browser.js'
import { tools as networkTools } from './groups/network.js'
import { tools as debuggerTools } from './groups/debugger.js'
import { tools as hookTools } from './groups/hook.js'
import { tools as stealthTools } from './groups/stealth.js'
import { tools as scriptTools } from './groups/script.js'
import { tools as captureTools } from './groups/capture.js'
import { tools as recoveryTools } from './groups/recovery.js'

export const deepSpiderCatalog = createToolCatalog([
  browserTools,
  networkTools,
  debuggerTools,
  hookTools,
  stealthTools,
  scriptTools,
  captureTools,
  recoveryTools,
])
export const DEEPSPIDER_TOOL_COUNT = deepSpiderCatalog.length
