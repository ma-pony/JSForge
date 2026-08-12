/**
 * DeepSpider Plugin for opencode
 * - evolve_skill: 记录新发现的逆向知识到 learned/ 目录
 * - compaction hook: 在上下文压缩时注入 session-state.md
 */

import { tool } from '@opencode-ai/plugin'
import { z } from 'zod'
import path from 'path'
import fs from 'fs'
import { homedir } from 'os'
import { fileURLToPath } from 'url'

const LEARNED_FILES = Object.freeze({
  crypto: 'crypto.md',
  'anti-bot': 'anti-bot.md',
  'env-patch': 'env-patch.md',
  general: 'general.md',
})

/** @type {import("@opencode-ai/plugin").Plugin} */
export default async ({ directory }) => {
  const packageRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../..'
  )
  const skillsDir = path.join(packageRoot, 'skills/deepspider')
  const outputDir = path.join(homedir(), '.deepspider/output')

  return {
    tool: {
      evolve_skill: tool({
        description: '记录新发现的逆向知识到 Skill 文件',
        args: {
          skill: z
            .enum(['crypto', 'anti-bot', 'env-patch', 'general'])
            .describe('Target: crypto / anti-bot / env-patch / general'),
          category: z
            .string()
            .describe('Type: new-pattern / bypass / env-patch / template'),
          content: z.string().describe('Markdown content'),
          source: z.string().describe('Source URL or description'),
        },
        async execute(args) {
          const learnedName = LEARNED_FILES[args.skill]
          if (!learnedName) {
            return `Error: unknown skill "${args.skill}". Valid: crypto, anti-bot, env-patch, general`
          }
          const learnedFile = path.join(skillsDir, 'learned', learnedName)

          const entry = `\n### ${args.source}\n- **类别**: ${args.category}\n${args.content}\n`
          fs.appendFileSync(learnedFile, entry, 'utf-8')

          return `Appended to ${learnedFile}`
        },
      }),
    },

    // compaction 时注入 session-state.md
    // 这是 compaction 后恢复上下文的唯一依据
    'experimental.session.compacting': async ({ sessionID }, output) => {
      void sessionID
      if (!fs.existsSync(outputDir)) return

      // 查找最近修改的 task 目录
      let tasks
      try {
        tasks = fs.readdirSync(outputDir).filter((d) => {
          try {
            return fs.statSync(path.join(outputDir, d)).isDirectory()
          } catch {
            return false
          }
        })
      } catch {
        return
      }

      if (tasks.length === 0) return

      // 取最近修改的 task 目录
      const latest = tasks
        .map((d) => ({
          name: d,
          mtime: fs.statSync(path.join(outputDir, d)).mtimeMs,
        }))
        .sort((a, b) => b.mtime - a.mtime)[0]

      const stateFile = path.join(outputDir, latest.name, 'session-state.md')
      if (fs.existsSync(stateFile)) {
        const state = fs.readFileSync(stateFile, 'utf-8')
        output.context.push(
          `## DeepSpider Session State (MUST preserve in summary)\n${state}`
        )
      }
    },
  }
}
