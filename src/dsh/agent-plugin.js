import { registerDshCatalog } from '../adapters/dsh-tools.js'
import { deepSpiderCatalog } from '../tools/index.js'

export const name = 'deepspider-agent'
export const inject = ['tools', 'systemPrompt', 'deepSpiderRuntimeManager']

export function apply(ctx) {
  registerDshCatalog(ctx, deepSpiderCatalog, {
    runtimeManager: ctx.deepSpiderRuntimeManager,
  })
  ctx.systemPrompt.section({
    name: 'deepspider:invariants',
    order: 120,
    text: [
      'Perform generic reverse analysis from browser evidence.',
      'Treat browser results as observed evidence, never completion.',
      'Completion requires independent non-browser output generation and successful real request validation.',
      'Keep target-specific rules in the Session Runtime Recipe.',
      'Use pure algorithm recovery only as an explicit escalation after a program blocker or an explicit user request.',
      'When the output kind is ambiguous, use one native DSH question with id recovery-output-kind before calling recover_target_output.',
      'Preserve the captured original; recorded working-source transforms are allowed.',
      'After using browser tools, call browser_session to keep or release the live browser before the final response; release it when live page state is no longer needed and keep it only for follow-up work.',
    ].join(' '),
  })
}
