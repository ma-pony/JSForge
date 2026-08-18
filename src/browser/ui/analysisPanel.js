/**
 * Session-owned in-page Dialog. It is independent from the Probe runtime and
 * communicates only through the binding installed by DialogBridge.
 */
export function getAnalysisPanelScript() {
  return String.raw`
(function installDeepSpiderDialog() {
  if (globalThis.__deepspider_dialog_state__) return;

  const topFrame = globalThis === globalThis.top;
  const state = {
    selecting: false,
    current: null,
    overlay: null,
    info: null,
    selected: [],
    pending: null,
    listeners: [],
  };
  globalThis.__deepspider_dialog_state__ = state;

  function listen(target, type, handler, options) {
    target.addEventListener(type, handler, options);
    state.listeners.push([target, type, handler, options]);
  }

  function send(message) {
    if (typeof globalThis.__deepspider_send__ !== 'function') return;
    globalThis.__deepspider_send__(JSON.stringify(message));
  }

  function xpath(element) {
    if (!element) return '';
    if (element.id) return '//*[@id="' + element.id.replace(/"/g, '\\"') + '"]';
    const parts = [];
    let node = element;
    while (node && node.nodeType === 1) {
      let index = 1;
      let sibling = node.previousElementSibling;
      while (sibling) {
        if (sibling.tagName === node.tagName) index += 1;
        sibling = sibling.previousElementSibling;
      }
      parts.unshift(node.tagName.toLowerCase() + '[' + index + ']');
      node = node.parentElement;
    }
    return '/' + parts.join('/');
  }

  function ensureSelectorUi() {
    if (state.overlay) return;
    const overlay = document.createElement('div');
    overlay.id = 'deepspider-selector-overlay';
    overlay.style.cssText = 'position:fixed;display:none;pointer-events:none;border:2px solid #38bdf8;background:rgba(56,189,248,.12);z-index:2147483645;';
    const info = document.createElement('div');
    info.id = 'deepspider-selector-info';
    info.style.cssText = 'position:fixed;display:none;pointer-events:none;background:#0f172a;color:#e0f2fe;padding:4px 7px;border-radius:4px;font:11px ui-monospace,monospace;z-index:2147483646;';
    document.documentElement.append(overlay, info);
    state.overlay = overlay;
    state.info = info;
  }

  function stopSelecting() {
    state.selecting = false;
    state.current = null;
    document.documentElement.style.cursor = '';
    if (state.overlay) state.overlay.style.display = 'none';
    if (state.info) state.info.style.display = 'none';
  }

  function startSelecting() {
    ensureSelectorUi();
    state.selecting = true;
    document.documentElement.style.cursor = 'crosshair';
  }

  function selectorMove(event) {
    if (!state.selecting) return;
    const target = document.elementFromPoint(event.clientX, event.clientY);
    if (!target || target.closest?.('#deepspider-panel')) return;
    state.current = target;
    const rect = target.getBoundingClientRect();
    Object.assign(state.overlay.style, {
      display: 'block', left: rect.left + 'px', top: rect.top + 'px',
      width: rect.width + 'px', height: rect.height + 'px',
    });
    state.info.textContent = target.tagName.toLowerCase() + (target.id ? '#' + target.id : '');
    Object.assign(state.info.style, {
      display: 'block', left: rect.left + 'px', top: Math.max(0, rect.top - 24) + 'px',
    });
  }

  function selectorClick(event) {
    if (!state.selecting || !state.current) return;
    event.preventDefault();
    event.stopPropagation();
    const selected = {
      text: (state.current.innerText || state.current.textContent || '').trim().slice(0, 1000),
      xpath: xpath(state.current),
      frameUrl: location.href,
    };
    stopSelecting();
    if (topFrame) addSelection(selected);
    else globalThis.top.postMessage({ type: 'deepspider-iframe-selection', selected }, '*');
  }

  listen(document, 'mousemove', selectorMove, true);
  listen(document, 'click', selectorClick, true);
  listen(document, 'keydown', function onKey(event) {
    if (event.key === 'Escape') stopSelecting();
  }, true);
  listen(globalThis, 'message', function onWindowMessage(event) {
    if (event.data?.type === 'deepspider-start-select') startSelecting();
    if (event.data?.type === 'deepspider-stop-select') stopSelecting();
    if (topFrame && event.data?.type === 'deepspider-iframe-selection') {
      addSelection(event.data.selected);
    }
  });

  function closeDialog() {
    stopSelecting();
    for (const [target, type, handler, options] of state.listeners) {
      target.removeEventListener(type, handler, options);
    }
    document.getElementById('deepspider-panel')?.remove();
    document.getElementById('deepspider-panel-style')?.remove();
    state.overlay?.remove();
    state.info?.remove();
    delete globalThis.__deepspider_dialog_receive__;
    delete globalThis.__deepspider_dialog_close__;
    delete globalThis.__deepspider_dialog_state__;
  }
  globalThis.__deepspider_dialog_close__ = closeDialog;

  if (!topFrame) return;

  const style = document.createElement('style');
  style.id = 'deepspider-panel-style';
  style.textContent = [
    '#deepspider-panel{all:initial;position:fixed;right:18px;bottom:18px;width:390px;max-height:72vh;display:flex;flex-direction:column;background:#0f172a;color:#e2e8f0;border:1px solid #334155;border-radius:12px;box-shadow:0 18px 50px rgba(0,0,0,.35);font:13px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;z-index:2147483647}',
    '#deepspider-panel *{box-sizing:border-box}',
    '.ds-head{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid #334155}.ds-head strong{flex:1;color:#f8fafc}.ds-icon{border:0;background:transparent;color:#94a3b8;font-size:18px;cursor:pointer}',
    '.ds-status{padding:6px 12px;color:#7dd3fc;border-bottom:1px solid #1e293b;font-size:12px}',
    '.ds-recovery{display:grid;grid-template-columns:1fr auto;gap:5px 10px;padding:9px 12px;border-bottom:1px solid #1e293b}.ds-recovery[hidden]{display:none}.ds-recovery-label{color:#cbd5e1}.ds-recovery-state{color:#7dd3fc}.ds-recovery-summary{grid-column:1/-1;color:#94a3b8;font-size:12px}',
    '.ds-messages{min-height:130px;overflow:auto;padding:10px 12px;display:flex;flex-direction:column;gap:8px}.ds-message{white-space:pre-wrap;word-break:break-word;padding:8px 10px;border-radius:8px;background:#1e293b}.ds-message.user{background:#0c4a6e}',
    '.ds-selected{padding:0 12px;color:#cbd5e1;font-size:12px}.ds-chip{display:flex;gap:6px;align-items:center;margin:4px 0}.ds-chip span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ds-chip button{margin-left:auto}',
    '.ds-question{margin:0 12px 10px;padding:10px;border:1px solid #475569;border-radius:8px}.ds-question h4{margin:0 0 5px;color:#f8fafc}.ds-question p{margin:0 0 7px}.ds-option{display:block;margin:5px 0}.ds-detail{color:#94a3b8;font-size:12px}.ds-custom{width:100%;margin-top:6px;padding:6px;background:#020617;color:#e2e8f0;border:1px solid #475569;border-radius:5px}',
    '.ds-compose{display:grid;grid-template-columns:auto 1fr auto;gap:7px;padding:10px 12px;border-top:1px solid #334155}.ds-compose textarea{resize:vertical;min-height:38px;max-height:110px;padding:7px;background:#020617;color:#f8fafc;border:1px solid #475569;border-radius:6px}.ds-button{border:0;border-radius:6px;padding:7px 10px;background:#0369a1;color:white;cursor:pointer}.ds-button.secondary{background:#334155}',
  ].join('');
  document.head.appendChild(style);

  const panel = document.createElement('section');
  panel.id = 'deepspider-panel';
  panel.innerHTML = '<header class="ds-head"><strong>DeepSpider Dialog</strong><button class="ds-icon" data-action="close" aria-label="Close">×</button></header>' +
    '<div class="ds-status">Ready</div><div class="ds-recovery" hidden></div><div class="ds-messages"></div><div class="ds-selected"></div>' +
    '<form class="ds-questions" hidden></form>' +
    '<form class="ds-compose"><button type="button" class="ds-button secondary" data-action="select">选择</button><textarea aria-label="Message" placeholder="告诉 Agent 要分析什么"></textarea><button class="ds-button" type="submit">发送</button></form>';
  document.documentElement.appendChild(panel);

  const status = panel.querySelector('.ds-status');
  const recoveryBox = panel.querySelector('.ds-recovery');
  const messages = panel.querySelector('.ds-messages');
  const selectedBox = panel.querySelector('.ds-selected');
  const questionsBox = panel.querySelector('.ds-questions');
  const compose = panel.querySelector('.ds-compose');
  const textarea = compose.querySelector('textarea');

  function appendMessage(role, text) {
    if (!text) return;
    const row = document.createElement('div');
    row.className = 'ds-message ' + role;
    row.textContent = text;
    messages.appendChild(row);
    messages.scrollTop = messages.scrollHeight;
  }

  const recoveryStages = [
    ['browserEvidence', '浏览器证据'],
    ['artifactGraph', 'Artifact Graph'],
    ['nodeGeneration', 'Node 生成'],
    ['requestValidation', '真实请求验证'],
  ];

  function renderRecovery(payload) {
    recoveryBox.hidden = false;
    recoveryBox.replaceChildren();
    for (const [key, labelText] of recoveryStages) {
      const label = document.createElement('span');
      label.className = 'ds-recovery-label';
      label.textContent = labelText;
      const value = document.createElement('span');
      value.className = 'ds-recovery-state';
      value.textContent = payload.stages?.[key] || 'pending';
      recoveryBox.append(label, value);
    }
    if (payload.type !== 'recovery/result') return;
    const summary = document.createElement('div');
    summary.className = 'ds-recovery-summary';
    const details = [
      payload.strategy,
      payload.evidenceLevels?.request,
      payload.solverId ? 'Solver ' + payload.solverId : null,
      payload.blocker?.reason,
      payload.nextAction,
    ].filter(Boolean);
    summary.textContent = details.join(' · ');
    recoveryBox.appendChild(summary);
  }

  function renderSelections() {
    selectedBox.replaceChildren();
    for (const [index, item] of state.selected.entries()) {
      const row = document.createElement('div');
      row.className = 'ds-chip';
      const label = document.createElement('span');
      label.textContent = item.text || item.xpath;
      label.title = item.xpath;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = '移除';
      remove.onclick = () => { state.selected.splice(index, 1); renderSelections(); };
      row.append(label, remove);
      selectedBox.appendChild(row);
    }
  }

  function addSelection(item) {
    if (!item?.xpath) return;
    state.selected.push(item);
    renderSelections();
  }

  function clearQuestion(rpcId) {
    if (rpcId && state.pending?.rpcId !== rpcId) return;
    state.pending = null;
    questionsBox.replaceChildren();
    questionsBox.hidden = true;
  }

  function renderQuestionBatch(payload) {
    state.pending = payload;
    questionsBox.replaceChildren();
    questionsBox.hidden = false;
    for (const question of payload.questions || []) {
      const fieldset = document.createElement('fieldset');
      fieldset.className = 'ds-question';
      fieldset.dataset.questionId = question.id;
      const title = document.createElement('h4');
      title.textContent = question.header || '需要你的选择';
      const prompt = document.createElement('p');
      prompt.textContent = question.question;
      fieldset.append(title, prompt);
      if (question.detail) {
        const detail = document.createElement('div');
        detail.className = 'ds-detail';
        detail.textContent = question.detail;
        fieldset.appendChild(detail);
      }
      for (const option of question.options || []) {
        const label = document.createElement('label');
        label.className = 'ds-option';
        const input = document.createElement('input');
        input.type = question.multiSelect ? 'checkbox' : 'radio';
        input.name = 'question-' + question.id;
        input.value = option.label;
        label.append(input, document.createTextNode(' ' + option.label));
        if (option.description) label.title = option.description;
        fieldset.appendChild(label);
      }
      const custom = document.createElement('input');
      custom.className = 'ds-custom';
      custom.placeholder = '其他答案（可选）';
      fieldset.appendChild(custom);
      questionsBox.appendChild(fieldset);
    }
    const submit = document.createElement('button');
    submit.type = 'submit';
    submit.className = 'ds-button';
    submit.textContent = '提交选择';
    questionsBox.appendChild(submit);
  }

  questionsBox.addEventListener('submit', function submitQuestions(event) {
    event.preventDefault();
    if (!state.pending) return;
    const answers = (state.pending.questions || []).map(function encode(question) {
      const fieldset = Array.from(questionsBox.querySelectorAll('.ds-question')).find((item) => item.dataset.questionId === question.id);
      const selected = Array.from(fieldset.querySelectorAll('input[type="radio"]:checked,input[type="checkbox"]:checked')).map((input) => input.value);
      const custom = fieldset.querySelector('.ds-custom').value.trim();
      return custom ? { id: question.id, selected, custom } : { id: question.id, selected };
    });
    questionsBox.querySelector('button[type="submit"]').disabled = true;
    send({ type: 'question/answer', rpcId: state.pending.rpcId, answers });
  });

  compose.addEventListener('submit', function submitMessage(event) {
    event.preventDefault();
    const text = textarea.value.trim();
    if (!text) return;
    const elements = state.selected.slice();
    appendMessage('user', text);
    send({ type: 'chat', text, elements, url: location.href });
    textarea.value = '';
    state.selected = [];
    renderSelections();
  });

  panel.querySelector('[data-action="select"]').onclick = function selectElement() {
    startSelecting();
    for (const frame of document.querySelectorAll('iframe')) {
      frame.contentWindow?.postMessage({ type: 'deepspider-start-select' }, '*');
    }
  };
  panel.querySelector('[data-action="close"]').onclick = closeDialog;

  globalThis.__deepspider_dialog_receive__ = function receiveDialogMessage(payload) {
    if (!payload || typeof payload !== 'object') return;
    if (payload.type === 'assistant') appendMessage('assistant', payload.text);
    if (payload.type === 'status') status.textContent = payload.text || payload.status || 'Ready';
    if (payload.type === 'question/requested') renderQuestionBatch(payload);
    if (payload.type === 'recovery/progress') renderRecovery(payload);
    if (payload.type === 'recovery/question') renderQuestionBatch(payload);
    if (payload.type === 'recovery/result') renderRecovery(payload);
    if (payload.type === 'question/resolved') clearQuestion(payload.questionRpcId);
    if (payload.type === 'question/receipt' && payload.accepted === false && payload.reason === 'not-pending') clearQuestion(payload.rpcId);
  };
})();`
}
