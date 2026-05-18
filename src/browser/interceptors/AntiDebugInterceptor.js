/**
 * DeepSpider - 反无限 debugger 拦截器
 * 通过 CDP Debugger.setBlackboxedRanges 跳过包含 debugger 语句的脚本
 * 零运行时开销，不修改源码，不触发完整性校验
 *
 * 已知限制：/\bdebugger\b/ 会匹配字符串/注释中的 debugger，
 * 对反爬场景可接受（误 blackbox 的脚本仍正常执行，只是不可调试）
 */

export class AntiDebugInterceptor {
  constructor(cdpClient) {
    this.client = cdpClient;
    this.blackboxedScripts = new Set();
    // 高频 debugger 检测
    this.pausedCount = 0;
    this.pausedWindowStart = 0;
    this.PAUSED_WINDOW_MS = 1000;  // 1秒窗口
    this.PAUSED_THRESHOLD = 5;     // 1秒内超过5次paused认为是debugger风暴
    this.stormMode = false;        // 风暴模式：跳过所有断点
    this.stormTimer = null;        // 风暴模式自动退出定时器
  }

  async start() {
    // 核心策略：默认跳过所有断点暂停
    // Debugger.enable 是 ScriptInterceptor 捕获脚本所必须的，
    // 但 debugger 语句会触发 CDP pause，反调试网站利用这点制造 pause/resume 风暴。
    // setSkipAllPauses(true) 让引擎完全忽略 debugger 语句，零开销。
    // 用户主动设断点时通过 enablePauses() 关闭。
    await this.client.send('Debugger.setSkipAllPauses', { skip: true });
    this._skipAll = true;

    // 兜底：当 skipAll 关闭后，对非手动断点的 paused 事件自动 resume
    this.client.on('Debugger.paused', (params) => {
      // skipAll 模式下不会触发此事件，但作为防御性代码保留
      if (this._skipAll) {
        this.client.send('Debugger.resume').catch(() => {});
        return;
      }

      // 手动设置的断点（除非在风暴模式）
      if (!this.stormMode && params.reason === 'breakpoint') return;
      if (!this.stormMode && params.hitBreakpoints?.length > 0) return;

      // 风暴模式下直接 resume，不参与计数
      if (this.stormMode) {
        this.client.send('Debugger.resume').catch(() => {});
        return;
      }

      // 高频 debugger 检测
      const now = Date.now();
      if (now - this.pausedWindowStart > this.PAUSED_WINDOW_MS) {
        this.pausedWindowStart = now;
        this.pausedCount = 1;
      } else {
        this.pausedCount++;
      }

      // 触发风暴模式
      if (this.pausedCount > this.PAUSED_THRESHOLD) {
        console.error('[AntiDebugInterceptor] 检测到 debugger 风暴，启用风暴模式');
        this.stormMode = true;
        if (this.stormTimer) clearTimeout(this.stormTimer);
        this.stormTimer = setTimeout(() => {
          console.error('[AntiDebugInterceptor] 退出风暴模式');
          this.stormMode = false;
          this.pausedCount = 0;
          this.stormTimer = null;
        }, 3000);
      }

      // 自动 resume
      this.client.send('Debugger.resume').catch(() => {});
    });

    console.error('[AntiDebugInterceptor] 已启动 (skipAllPauses)');
  }

  /**
   * 启用断点暂停（用户主动设断点时调用）
   * 关闭 skipAllPauses，依赖 blackbox + storm mode 防御反调试
   */
  async enablePauses() {
    if (!this._skipAll) return;
    this._skipAll = false;
    await this.client.send('Debugger.setSkipAllPauses', { skip: false });
    console.error('[AntiDebugInterceptor] 已启用断点暂停');
  }

  /**
   * 禁用断点暂停（恢复默认防御模式）
   */
  async disablePauses() {
    if (this._skipAll) return;
    this._skipAll = true;
    await this.client.send('Debugger.setSkipAllPauses', { skip: true });
    console.error('[AntiDebugInterceptor] 已禁用断点暂停');
  }

  /**
   * 检查脚本源码，包含 debugger 则 blackbox 整个脚本
   * 由 ScriptInterceptor.onSource 回调驱动，避免重复拉取源码
   */
  checkScript(scriptId, scriptSource) {
    if (/\bdebugger\b/.test(scriptSource)) {
      this.client.send('Debugger.setBlackboxedRanges', {
        scriptId,
        positions: [{ lineNumber: 0, columnNumber: 0 }],
      }).then(() => {
        this.blackboxedScripts.add(scriptId);
      }).catch(() => {});
    }
  }

  /**
   * 取消指定脚本的 blackbox（供断点工具调用）
   */
  async unblackbox(scriptId) {
    if (this.blackboxedScripts.has(scriptId)) {
      await this.client.send('Debugger.setBlackboxedRanges', {
        scriptId,
        positions: [],
      });
      this.blackboxedScripts.delete(scriptId);
    }
  }

  /**
   * 手动启用/禁用风暴模式
   * 用于绕过强反调试场景
   */
  setStormMode(enabled) {
    // 清除之前的定时器
    if (this.stormTimer) {
      clearTimeout(this.stormTimer);
      this.stormTimer = null;
    }

    this.stormMode = enabled;
    if (enabled) {
      console.error('[AntiDebugInterceptor] 手动启用风暴模式');
      // 自动退出
      this.stormTimer = setTimeout(() => {
        this.stormMode = false;
        this.stormTimer = null;
        console.error('[AntiDebugInterceptor] 自动退出风暴模式');
      }, 5000);
    } else {
      console.error('[AntiDebugInterceptor] 手动禁用风暴模式');
      this.pausedCount = 0;
    }
  }

  /**
   * 检查当前是否在风暴模式
   */
  isStormMode() {
    return this.stormMode;
  }
}
