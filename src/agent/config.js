/**
 * Agent 配置构建
 *
 * 只负责把 DeepSpider 自有的 MCP / Plugin / Skills / Agent 等"注入项"
 * 拼成 opencode config。用户的 provider/model/apiKey 配置完全走沙箱的
 * opencode.json + auth.json，DeepSpider 不再代管。
 *
 * SDK 内部会把本对象 JSON.stringify 后设为 OPENCODE_CONFIG_CONTENT，
 * 与沙箱内的 opencode.json 合并（SDK 语义：传入对象优先，未覆盖的字段
 * 继续从 opencode.json 读）。
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import matter from 'gray-matter'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(__dirname, '../..')

/**
 * 构建 opencode 注入配置
 *
 * @param {object} overrides
 * @param {string} [overrides.model] - CLI --model 覆盖（可选）
 * @param {string} [overrides.projectRoot] - DeepSpider 安装根目录
 * @returns {object} opencode 配置对象
 */
export function buildOpencodeConfig({ model, projectRoot = PROJECT_ROOT } = {}) {
  const config = {
    default_agent: 'spider',
    autoupdate: false,
    share: 'disabled',

    mcp: {
      deepspider: {
        type: 'local',
        command: [process.execPath, path.join(projectRoot, 'src/mcp/server.js')],
        cwd: projectRoot,
        enabled: true,
        timeout: 10000,
      },
    },

    plugin: [path.join(projectRoot, 'plugins/deepspider-plugin')],

    skills: {
      paths: [path.join(projectRoot, 'skills/deepspider')],
    },

    permission: 'allow',

    agent: loadAgentDefinitions(path.join(projectRoot, 'agents')),
  }

  // 仅在明确指定时覆盖 model；否则完全由沙箱 opencode.json 决定
  if (model) {
    config.model = model
  }

  return config
}

/**
 * 从 agents/ 目录加载 Agent 定义
 * 使用 gray-matter 解析 frontmatter + body
 * SDK config.agent 接收已解析的对象（prompt 为纯字符串）
 */
function loadAgentDefinitions(agentsDir) {
  const agents = {}

  if (!fs.existsSync(agentsDir)) return agents

  for (const file of fs.readdirSync(agentsDir)) {
    if (!file.endsWith('.md')) continue
    const name = file.replace('.md', '')
    const content = fs.readFileSync(path.join(agentsDir, file), 'utf-8')
    const { data: frontmatter, content: body } = matter(content)
    agents[name] = { ...frontmatter, prompt: body.trim() }
  }

  return agents
}
