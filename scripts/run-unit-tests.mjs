import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const projectRoot = fileURLToPath(new URL('../', import.meta.url))

export function findUnitTestFiles(testDirectory) {
  return fs
    .readdirSync(testDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.test.js'))
    .map((entry) => path.join(testDirectory, entry.name))
    .sort()
}

function run() {
  const testFiles = findUnitTestFiles(path.join(projectRoot, 'test'))
  const result = spawnSync(process.execPath, ['--test', ...testFiles], {
    cwd: projectRoot,
    stdio: 'inherit',
  })
  if (result.error) {
    console.error(result.error.message)
    process.exitCode = 1
    return
  }
  process.exitCode = Number.isInteger(result.status) ? result.status : 1
}

const invokedPath = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href
if (invokedPath === import.meta.url) run()
