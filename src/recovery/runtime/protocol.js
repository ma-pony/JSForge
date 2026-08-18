import { isAbsolute } from 'node:path'

import { validateOutputContract } from '../contracts.js'
import { validateRuntimeRecipe } from '../recipe.js'

function plainObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`)
  }
  return value
}

function nonEmptyString(value, name) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${name} must be a non-empty string`)
  }
  return value
}

function list(value, name) {
  if (!Array.isArray(value)) throw new TypeError(`${name} must be an array`)
  return value
}

export function validateWorkerRequest(value) {
  const input = plainObject(value, 'Worker request')
  if (input.type !== 'execute') throw new TypeError('Worker request type must be execute')
  const runDir = nonEmptyString(input.runDir, 'Worker request runDir')
  if (!isAbsolute(runDir)) throw new TypeError('Worker request runDir must be absolute')

  return {
    type: 'execute',
    runId: nonEmptyString(input.runId, 'Worker request runId'),
    sessionId: nonEmptyString(input.sessionId, 'Worker request sessionId'),
    contract: validateOutputContract(input.contract),
    recipe: validateRuntimeRecipe(input.recipe),
    runDir,
  }
}

export function validateWorkerResult(value) {
  const input = plainObject(value, 'Worker result')
  if (input.type !== 'result') throw new TypeError('Worker result type must be result')
  const engine = plainObject(input.engine, 'Worker result engine')
  if (engine.name !== 'sdenv') throw new TypeError('Worker result engine must be sdenv')
  nonEmptyString(engine.version, 'Worker result engine version')
  if (typeof input.ok !== 'boolean') throw new TypeError('Worker result ok must be a boolean')

  return {
    type: 'result',
    runId: nonEmptyString(input.runId, 'Worker result runId'),
    ok: input.ok,
    engine: { name: 'sdenv', version: engine.version },
    outputs: list(input.outputs, 'Worker result outputs'),
    events: list(input.events, 'Worker result events'),
    unknowns: list(input.unknowns, 'Worker result unknowns'),
  }
}
