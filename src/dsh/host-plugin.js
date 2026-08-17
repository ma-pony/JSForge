import { InProcessApiClient, toFetchHandler } from '@deepseek-ai/dsh-host-apiproxy'
import { createUserMessage } from '@deepseek-ai/dsh-llm'

import { RuntimeManager } from '../runtime/RuntimeManager.js'

export const name = 'deepspider-host'
export const provide = 'deepSpiderRuntimeManager'
export const inject = ['agents', 'apiProxy']

function dialogPrompt(message) {
  const lines = [message.text]
  if (Array.isArray(message.elements) && message.elements.length > 0) {
    lines.push('', 'Selected page elements:')
    for (const item of message.elements) {
      lines.push(`- ${item.text || '(no text)'} (${item.xpath})${item.frameUrl ? ` @ ${item.frameUrl}` : ''}`)
    }
  }
  if (message.url) lines.push('', `Page: ${message.url}`)
  return lines.join('\n')
}

function assistantText(event) {
  if (event?.type !== 'assistant/message') return ''
  return (event.data?.message?.content || [])
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('')
}

export function apply(ctx, config = {}) {
  const manager = config.runtimeManager ?? new RuntimeManager()
  const questionClient = config.questionClient
    ?? new InProcessApiClient(toFetchHandler(ctx.apiProxy))

  manager.setDialogHandler(async ({ sessionId, message }) => {
    if (message.type === 'chat') {
      const agent = ctx.agents.get(sessionId)
      if (!agent) throw new Error(`Dialog Agent ${sessionId} is not live`)
      agent.followup(createUserMessage({
        content: [{ type: 'text', text: dialogPrompt(message) }],
        source: { kind: 'user' },
      }))
      return
    }

    if (message.type === 'question/answer') {
      const response = {
        type: 'client-response',
        rpcId: message.rpcId,
        result: {
          ok: true,
          value: {
            sessionId,
            answer: { answers: message.answers },
          },
        },
      }
      const receipt = await questionClient.respond(response)
      if (!receipt.accepted) {
        await manager.sendDialog(sessionId, {
          type: 'question/receipt',
          rpcId: message.rpcId,
          ...receipt,
        })
      }
    }
  })

  ctx.provide(provide, manager)
  ctx.on('agent/disposed', ({ agent }) => (
    manager.disposeAgent(agent, 'DSH Agent disposed')
  ))
  ctx.on('session/event', (session, event) => {
    const sessionId = String(session.id)
    const text = assistantText(event)
    if (text) return manager.sendDialog(sessionId, { type: 'assistant', text })
    if (event.type === 'turn/start') {
      return manager.sendDialog(sessionId, {
        type: 'status',
        status: 'running',
        text: 'Agent 正在分析',
      })
    }
    if (event.type === 'turn/end') {
      return manager.sendDialog(sessionId, {
        type: 'status',
        status: 'idle',
        text: 'Agent 已完成',
      })
    }
  })

  ctx.effect(() => {
    const controller = new globalThis.AbortController()
    const consumeQuestions = (async () => {
      for await (const frame of questionClient.events.mux({}, controller.signal)) {
        const payload = frame.payload
        if (payload.type === 'question/requested') {
          await manager.sendDialog(payload.sessionId, {
            type: payload.type,
            rpcId: frame.rpcId,
            questions: payload.questions,
          }, { open: true })
        } else if (payload.type === 'question/resolved') {
          await manager.sendDialog(payload.sessionId, {
            type: payload.type,
            questionRpcId: payload.questionRpcId,
            outcome: payload.outcome,
          })
        }
      }
    })().catch((error) => {
      if (!controller.signal.aborted) {
        console.error('[DeepSpider] DSH question stream failed:', error.message)
      }
    })

    return async () => {
      controller.abort(new Error('DSH Host disposed'))
      await consumeQuestions
      await manager.closeAll('DSH Host disposed')
    }
  })
}
