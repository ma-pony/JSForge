/**
 * deepspider --help
 */

import { getVersion } from './version.js';

export function run() {
  console.log(`
deepspider v${getVersion()} - DSH-native JavaScript reverse-engineering platform

用法:
  deepspider agent                   启动原生 DSH Web
  deepspider agent --port <number>   设置 DSH Web 端口
  deepspider agent --verbose         显示 DeepSpider 启动信息
  deepspider mcp                     启动 stdio MCP 外部适配器
  deepspider fetch <url>             快速 HTTP 请求（轻量级）
  deepspider update                  检查更新

选项:
  -v, --version                      显示版本号
  -h, --help                         显示帮助信息

示例:
  deepspider agent
  deepspider agent --port 3080 --verbose
  deepspider fetch https://httpbin.org/get
`.trim());
}
