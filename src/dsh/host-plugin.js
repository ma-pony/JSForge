import { RuntimeManager } from '../runtime/RuntimeManager.js'

export const name = 'deepspider-host'
export const provide = 'deepSpiderRuntimeManager'
export const inject = ['agents']

export function apply(ctx, config = {}) {
  const manager = config.runtimeManager ?? new RuntimeManager()

  ctx.provide(provide, manager)
  ctx.on('agent/disposed', (agent) => (
    manager.disposeAgent(agent, 'DSH Agent disposed')
  ))
  ctx.effect(() => () => manager.closeAll('DSH Host disposed'))
}
