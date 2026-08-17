/**
 * fetch 命令 - 快速 HTTP 请求
 */

import initCycleTLS from 'cycletls';

export async function fetchCommand(url) {
  console.log(`🚀 请求: ${url}`);

  try {
    const cycleTLS = await initCycleTLS();

    const response = await cycleTLS(url, {
      body: '',
      ja3: '771,4865-4866-4867-49195-49199-49196-49200-52393-52392-49171-49172-156-157-47-53,0-23-65281-10-11-35-16-5-13-18-51-45-43-27-17513,29-23-24,0',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });

    console.log(`✅ 状态: ${response.status}`);
    console.log(`📦 大小: ${response.body?.length || 0} bytes`);

    if (response.status >= 400) {
      console.log('⚠️  可能有反爬，建议使用: deepspider agent ' + url);
    }

    await cycleTLS.exit();
    process.exit(0);
  } catch (error) {
    console.error('❌ 失败:', error.message);
    process.exit(1);
  }
}
