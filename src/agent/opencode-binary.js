import path from 'node:path'
import { createRequire } from 'node:module'

/**
 * Resolve the native executable shipped by this installation's opencode-ai
 * package. The package uses the same bin/opencode.exe path on every platform.
 *
 * @param {string | URL} [parentUrl]
 * @returns {string}
 */
export function resolveOpencodeBinary(parentUrl = import.meta.url) {
  const require = createRequire(parentUrl)
  const packageJson = require.resolve('opencode-ai/package.json')
  return path.join(path.dirname(packageJson), 'bin', 'opencode.exe')
}
