import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { ensureSecureDir } from '../config/paths.js'

const DEFAULT_SESSION_ROOT = join(homedir(), '.deepspider', 'sessions')

export function hashSessionId(sessionId) {
  if (typeof sessionId !== 'string' || sessionId.length === 0) {
    throw new TypeError('sessionId must be a non-empty string')
  }

  return createHash('sha256').update(sessionId).digest('hex')
}

export function createSessionPaths(sessionId, { root = DEFAULT_SESSION_ROOT } = {}) {
  const key = hashSessionId(sessionId)
  const sessionRoot = join(root, key)

  return {
    sessionId,
    key,
    root: sessionRoot,
    metadata: join(sessionRoot, 'metadata'),
    data: join(sessionRoot, 'data'),
    output: join(sessionRoot, 'output'),
    rebuild: join(sessionRoot, 'rebuild'),
    screenshots: join(sessionRoot, 'screenshots'),
    browserData: join(sessionRoot, 'browser-data'),
  }
}

export function ensureSessionPaths(paths) {
  [
    paths.root,
    paths.metadata,
    paths.data,
    paths.output,
    paths.rebuild,
    paths.screenshots,
    paths.browserData,
  ].forEach(ensureSecureDir)

  return paths
}
