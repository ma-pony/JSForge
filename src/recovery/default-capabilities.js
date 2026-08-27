import { createRecoveryCapabilities } from './capabilities.js'
import { documentChallengeEvidenceSelector } from './evidence-selectors/document-challenge.js'
import { cookieOutputAdapter } from './output-adapters/cookie.js'
import { createRuntimeRecipe, hashRecipe, validateRuntimeRecipe } from './recipe.js'
import { exportSolver } from './solver.js'
import { validateGeneratedOutput } from './validation.js'

const sdenvEngine = Object.freeze({
  type: 'engine',
  id: 'sdenv',
  strategy: 'semantic-runtime',
  modes: Object.freeze(['auto', 'semantic']),
  outputKinds: Object.freeze(['cookie']),
  createRecipe: createRuntimeRecipe,
  validateRecipe: validateRuntimeRecipe,
  hashRecipe,
  execute({ runtime, runId, contract, recipe, signal }) {
    if (typeof runtime.getRecoveryRuntime !== 'function') {
      throw new TypeError('runtime must provide getRecoveryRuntime()')
    }
    return runtime.getRecoveryRuntime().execute({ runId, contract, recipe, signal })
  },
})

const cycleTlsValidator = Object.freeze({
  type: 'validator',
  id: 'cycle-tls-http',
  outputKinds: Object.freeze(['cookie']),
  engineIds: Object.freeze(['sdenv']),
  outputAdapterIds: Object.freeze(['cookie']),
  validate({ contract, recipe, ...context }) {
    return validateGeneratedOutput({
      ...context,
      contract,
      requestTemplate: {
        headers: contract.request.headers,
        userAgent: recipe.userAgent,
        strictSSL: recipe.strictSSL,
        timeoutMs: recipe.timeoutMs,
      },
    })
  },
})

const sdenvSolverExporter = Object.freeze({
  type: 'exporter',
  id: 'sdenv-solver',
  engineIds: Object.freeze(['sdenv']),
  outputKinds: Object.freeze(['cookie']),
  outputAdapterIds: Object.freeze(['cookie']),
  validatorIds: Object.freeze(['cycle-tls-http']),
  export(context) {
    return exportSolver(context)
  },
})

export const defaultRecoveryCapabilities = createRecoveryCapabilities({
  evidenceSelectors: [documentChallengeEvidenceSelector],
  engines: [sdenvEngine],
  outputAdapters: [cookieOutputAdapter],
  validators: [cycleTlsValidator],
  exporters: [sdenvSolverExporter],
})

export const SUPPORTED_RECOVERY_OUTPUT_KINDS = defaultRecoveryCapabilities.supportedOutputKinds
