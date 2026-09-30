'use strict';

/* Offline design replay. File inputs contribute names only; no model, IPC or API calls. */
const $ = id => document.getElementById(id);
const definitions = {
  monthly: {
    title: '经营月报',
    subtitle: '汇总本机资料，确认口径，再交付可核验的月报',
    draft: '读取本工作区的订单和退款样例，按月汇总经营情况，生成月报和异常清单。原文件不要修改，先确认统计口径。',
    materials: ['订单样例.csv', '退款样例.csv', '上月统计口径.md'],
    checks: ['月报与异常清单已生成', '月份、币种与退款口径已确认', '合计与原始样例逐项核对'],
    events: [
      { kind: 'question', title: '先确认统计口径', text: '订单样例没有统一币种声明。请确认月份和币种，避免把不同口径的金额直接相加。' },
      { kind: 'skill', title: '月报核对清单已经用上', text: '技能正文进入本次样例请求：保持原文件不变、区分订单与退款、核对汇总与明细。' },
      { kind: 'context', title: '沿用你明确的业务约束', text: '本次请求保留“原文件不要修改”和“退款单独核对”；材料有可查看的原文来源。' },
      { kind: 'draft', title: '月报草稿可以查看了', text: '先交付阶段成果，再做核验。点击下方成果，在中央打开报告。' },
      { kind: 'check', title: '正在核对合计与明细', text: '样例文件工具在本机执行只读核对；核验回执出现前，草稿仍标为待验收。' },
      { kind: 'finish', title: '月报样例的必需检查通过', text: '月份、币种、退款口径与样例合计均有对应检查回执。结果来自固定样例，不是真实业务数据。' }
    ]
  },
  expert: {
    title: '接口升级',
    subtitle: '专业 Agent 接力，结果回父任务，再独立验收',
    draft: '检查本工作区的接口升级兼容性，委派已安装的代码专家。生产库不要动；整合升级报告，最后核对独立回归。',
    materials: ['接口契约样例.md', '升级差异样例.patch'],
    checks: ['专家结果已归属并返回父任务', '父任务整合报告已生成', '独立回归与生产只读约束通过'],
    events: [
      { kind: 'skill', title: '升级核对清单已经用上', text: '样例技能实际进入父任务请求；它不增加工具权限。' },
      { kind: 'expert-start', title: '代码专家已经接手', text: 'Harness 通过原生 ctx.subagents 启动已安装的 Codex 专家，只交接获准的样例契约和差异。' },
      { kind: 'expert-partial', title: '专家的阶段报告返回了', text: '子任务尚未完成。部分成果已经可读，不必等专家全部结束。' },
      { kind: 'expert-return', title: '专家结果已返回父任务', text: '子任务完成回执与返回结果已关联。专家内部自行执行，父任务继续归并与验收。' },
      { kind: 'integrate', title: '整合报告已经形成', text: '父任务使用专家返回结果生成报告。专家完成不等于整体任务验收通过。' },
      { kind: 'finish', title: '独立验收完成', text: '样例回归、只读约束和成果检查全部通过，才允许这份目标完成。' }
    ]
  },
  resume: {
    title: '继续上次月报',
    subtitle: '资料先恢复，明确授权后继续未完成的检查',
    draft: '继续上次经营月报，保留已生成草稿、人民币口径和原文件只读约束，从未完成的合计核验继续。',
    materials: ['历史月报草稿.md', '历史口径来源.md'],
    checks: ['已有草稿与原始约束恢复', '续做请求实际沿用必需约束', '未完成的合计核验通过'],
    events: [
      { kind: 'resume-context', title: '原有约束已进入续做请求', text: '恢复不是重新生成任务。人民币口径和原文件只读约束实际进入本次样例请求。' },
      { kind: 'check', title: '继续未完成的合计核验', text: '复用已有草稿，不重新执行已完成的写入；本次只推进未验收的核对。' },
      { kind: 'finish', title: '续做检查通过，成果保留', text: '新增样例验收回执已归档，已有草稿与历史约束仍可查看。' }
    ]
  }
};

function initialSession(name) {
  const d = definitions[name];
  const restored = name === 'resume';
  const session = {
    name, phase: restored ? 'restore_wait' : 'idle', cursor: -1, draft: d.draft,
    mode: 'auto', policy: 'minimized', runMode: null, runPolicy: null,
    materials: d.materials.map((name, index) => ({ id: 'sample-' + index, name, sample: true })),
    submittedMaterials: [], inputSnapshot: null, resumeSnapshot: null,
    admitted: false, hostReceived: false, routeCount: 0, entries: [], records: [],
    artifacts: [], contexts: [], excluded: new Set(), sourceOpen: new Set(),
    checks: d.checks.map((label, index) => ({ label, done: restored && index === 0 })),
    expert: null, pane: 'conversation', previewId: null, sidePanel: 'context',
    month: '2026-08', currency: 'CNY', previousPhase: null, blockKind: null,
    continuation: null, scopeOpen: false, newProgress: false, recoveryPending: false,
    pendingAnswer: null, resumePhase: null, verificationPending: false, hasGoal: restored,
    pendingMonth: '2026-08', pendingCurrency: ''
  };
  if (restored) {
    session.entries.push({ role: '历史资料', title: '草稿和口径已经恢复', text: 'Goal 的持久状态可读，activation 为 disarmed。历史资料恢复不等于任务正在运行。' });
    session.records.push('历史回放：草稿可读；Goal activation disarmed；未发起新路由或模型调用');
    session.contexts.push({ id: 'business-constraints', title: '上次任务的明确口径', body: '“使用人民币；订单与退款分开核对；原文件不要修改。”', source: '本工作区历史样例任务，第 2 条消息', historical: true, injected: false });
    session.artifacts.push(makeArtifact('history-draft', '上次月报草稿', '历史成果 · 合计待核验', '经营月报 · 2026-08\n\n历史样例已保存草稿。币种：人民币。\n订单收入与退款需要独立合计核对。\n原文件只读；当前尚未完成最终核验。'));
  }
  return session;
}

const sessions = Object.fromEntries(Object.keys(definitions).map(name => [name, initialSession(name)]));
let current = 'monthly';
let connection = 'online';
let fileSequence = 0;
let previousArtifactTrigger = null;
const active = () => sessions[current];
const labels = {
  idle: '未开始', submitting: '本地回显', received: 'Host 已收到', routing: '判断中',
  ready_admit: '等待准入', running: '执行中', waiting: '等待口径', answer_requested: '等待答复回执',
  blocked: '准入阻塞', pausing: '等待暂停收尾', paused: '已暂停', stopping: '等待停止收尾',
  stopped: '已停止', failed: '执行失败', complete: '验收通过', restore_wait: '等待恢复',
  resume_requested: '等待恢复回执', recovering: '读取错误证据', expert_restart: '重新交接专家任务',
  verification_blocked: '验收未通过', source_retry: '重新检查必需来源'
};

function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}

function announce(text) { $('announcement').textContent = '设计样例：' + text; }
function record(text) { active().records.push(text); }
function entry(role, title, text, artifactId) {
  const s = active();
  s.entries.push({ role, title, text, artifactId });
  const area = $('conversation');
  s.newProgress = s.pane !== 'conversation' || area.scrollTop + area.clientHeight < area.scrollHeight - 48;
}
function makeArtifact(id, title, stage, text) { return { id, title, stage, text }; }
function saveDraft() {
  const s = active();
  s.draft = $('task-input').value;
  s.mode = $('mode').value;
  s.policy = $('data-policy').value;
}

function snapshotDraft(s) {
  return { draft: s.draft, mode: s.mode, policy: s.policy, materials: s.materials.map(material => ({ ...material })) };
}

function nextExecutionPhase(s) {
  if (s.recoveryPending) return 'recovering';
  if (s.expert?.cancelled) return 'expert_restart';
  if (s.pendingAnswer) return 'answer_requested';
  if (s.resumePhase === 'waiting') return 'waiting';
  if (s.verificationPending) return 'source_retry';
  return 'running';
}

function switchSession(name) {
  saveDraft();
  current = name;
  $('task-input').value = active().draft;
  $('mode').value = active().mode;
  $('data-policy').value = active().policy;
  render();
  announce('已打开' + definitions[name].title + '，其余会话资料保留');
}

function statusText(s) {
  const text = {
    idle: ['把这份任务交给它', '先确认材料与处理范围；输入框中的草稿尚未提交'],
    submitting: ['输入已在本机显示，等待 Host 回执', '这只是本地回显；还不能称为 Host 收到、准入或入队'],
    received: ['Host 已收到这份输入，尚未准入', '下一步检查合法处理范围；尚未进入原生输入队列'],
    routing: ['正在判断获准的处理路径', 'Jev 仅判断有限合法候选；判断期间输入尚未入队'],
    ready_admit: ['处理路径已确定，等待输入准入', '本次模式已确认；由 Host 完成本次准入后才交给原生执行'],
    running: [s.entries.at(-1)?.title || '继续推进当前目标', s.entries.at(-1)?.text || '等待下一份实际样例事件'],
    waiting: ['需要你确认统计口径', '已有资料保留；选择月份与币种后，Host 接受答复再继续'],
    answer_requested: ['已提交口径答复，等待 Host 回执', '本地答复尚未成为已采用的任务上下文'],
    blocked: ['当前处理范围下无法准入', s.blockKind === 'materials' ? '需要至少一份材料；草稿与已有成果都保留' : '你选择仅本机处理，但当前没有已验证的本机通用模型；没有偷偷使用远程供给'],
    pausing: ['暂停后续推进的请求已接纳', '等待当前工作及对应子任务收尾；接纳请求不等于全部执行已经暂停'],
    paused: ['后续推进已暂停，已有成果可读', '明确恢复后再继续；不会清空当前或其他会话'],
    stopping: ['停止请求已接纳，等待收尾', '当前任务及其子任务正在结算；已发生的外部动作不能因此撤销'],
    stopped: ['当前任务已停止，已有成果保留', '可查看、下载或用已有成果继续；其他会话没有被停止'],
    failed: ['执行遇到问题，现场与成果保留', '继续时先取得错误证据，不自动重放未知幂等性的写操作'],
    complete: ['本样例的必需检查通过', '固定样例有对应检查回执；不代表真实业务、真实模型性能或成本收益'],
    restore_wait: ['资料已恢复，等待你恢复执行', '历史草稿与约束可读；Goal activation disarmed，没有自动继续'],
    resume_requested: [s.hasGoal ? '已明确请求恢复，等待 Host 激活' : '已明确请求继续，等待 Host 执行回执', '恢复回执出现前仍不推进；历史资料和已经完成的成果保留'],
    recovering: ['先取得错误详情，再继续检查', '样例只读取已结算错误证据，不重放未知幂等性的写操作'],
    expert_restart: ['原专家任务已取消，等待重新交接', '你已明确继续；Harness 将使用保留的阶段材料建立新的子任务，不把已取消的旧任务显示为继续运行'],
    verification_blocked: ['必需检查缺少通过依据，尚未验收', '历史约束本次未注入。可以恢复来源的后续使用，再明确重试缺项检查；已有成果保留'],
    source_retry: ['已明确请求重试必需来源检查', '下一份实际请求重新检查来源范围；重新允许不会倒填此前的注入或验收记录']
  };
  return text[s.phase] || text.idle;
}

function renderConversation(s) {
  const area = $('conversation');
  const prior = area.scrollTop;
  area.replaceChildren();
  if (!s.entries.length) {
    const empty = node('div', undefined, 'empty-state');
    empty.append(node('span', '从一份目标开始'), node('p', '编辑下方任务，添加材料。选路、实际使用与成果会在这里连续出现。'));
    area.append(empty);
  }
  s.entries.forEach((item, index) => {
    const message = node('div', undefined, 'message' + (item.role === '你' ? ' user' : ''));
    message.append(node('div', item.role + ' · ' + (index + 1), 'message-role'));
    if (item.title) message.append(node('strong', item.title));
    message.append(node('p', item.text));
    if (item.artifactId) {
      const button = node('button', '打开阶段成果');
      button.type = 'button';
      button.dataset.artifactTrigger = item.artifactId;
      button.addEventListener('click', () => openArtifact(item.artifactId, button));
      message.append(button);
    }
    area.append(message);
  });
  area.scrollTop = prior;
  $('new-progress').hidden = !s.newProgress;
}

function openArtifact(id, trigger) {
  const s = active();
  if (!s.artifacts.some(item => item.id === id)) return;
  s.previewId = id;
  s.pane = 'preview';
  previousArtifactTrigger = trigger;
  render();
  $('preview-title').focus({ preventScroll: true });
  announce('已在中央打开样例成果，任务会话仍保留');
}

function renderArtifacts(s) {
  const list = $('artifact-list');
  list.replaceChildren();
  s.artifacts.forEach(artifact => {
    const button = node('button', undefined, 'artifact-button');
    button.type = 'button';
    button.dataset.artifactTrigger = artifact.id;
    button.append(node('strong', artifact.title), node('span', artifact.stage));
    button.addEventListener('click', () => openArtifact(artifact.id, button));
    list.append(button);
  });
  $('artifact-count').textContent = s.artifacts.length;
  $('artifact-summary').textContent = s.artifacts.length ? s.artifacts.length + ' 份样例产物 · 点击在中央打开' : '等待第一份产物';
  $('preview-tab').disabled = !s.artifacts.length;
  $('conversation-tab').setAttribute('aria-pressed', String(s.pane === 'conversation'));
  $('preview-tab').setAttribute('aria-pressed', String(s.pane === 'preview'));
  $('conversation-pane').hidden = s.pane !== 'conversation';
  $('preview-pane').hidden = s.pane !== 'preview';
  const artifact = s.artifacts.find(item => item.id === s.previewId) || s.artifacts[0];
  if (artifact) {
    s.previewId = artifact.id;
    $('preview-title').textContent = artifact.title;
    $('preview-stage').textContent = artifact.stage;
    $('preview-content').textContent = artifact.text;
  }
}

function renderMaterials(s) {
  const root = $('material-list');
  root.replaceChildren();
  s.materials.forEach(material => {
    const row = node('div', undefined, 'material');
    const label = node('span', material.name);
    label.append(node('small', material.sample ? '编写的样例材料' : '仅文件名 · 未读取内容'));
    const remove = node('button', '×');
    remove.type = 'button';
    remove.setAttribute('aria-label', '从当前草稿移除 ' + material.name);
    remove.addEventListener('click', () => {
      s.materials = s.materials.filter(item => item.id !== material.id);
      render();
      $('add-samples').focus({ preventScroll: true });
      announce('已从当前草稿移除材料；已发送内容不撤回');
    });
    row.append(label, remove);
    root.append(row);
  });
}

function renderContext(s) {
  const root = $('context-list');
  root.replaceChildren();
  if (!s.contexts.length) {
    root.append(node('p', '实际使用回执出现后，显示技能、约束和来源。仅添加材料不会冒充已经使用。', 'panel-description'));
    return;
  }
  s.contexts.forEach(context => {
    const item = node('div', undefined, 'context-item');
    item.append(node('h3', context.title));
    const excluded = s.excluded.has(context.id);
    const state = context.historical ? '历史请求使用过；本次尚未注入' : context.injected ? '正文已进入本次样例请求' : '本次未注入此来源';
    item.append(node('p', state, 'source-state'));
    if (excluded) item.append(node('p', 'Host 样例已确认：排除后续使用；已发送内容不撤回', 'source-excluded'));
    const detail = node('details');
    detail.open = s.sourceOpen.has(context.id);
    detail.append(node('summary', '查看原文与来源'), node('p', context.body + '\n来源：' + context.source));
    detail.addEventListener('toggle', () => detail.open ? s.sourceOpen.add(context.id) : s.sourceOpen.delete(context.id));
    item.append(detail);
    const button = node('button', excluded ? '恢复后续使用' : '排除后续使用');
    button.type = 'button';
    button.dataset.contextId = context.id;
    button.disabled = connection !== 'online';
    button.addEventListener('click', () => {
      if (s.excluded.has(context.id)) s.excluded.delete(context.id); else s.excluded.add(context.id);
      record('来源 ' + context.id + '：Host 样例确认' + (s.excluded.has(context.id) ? '后续排除' : '恢复后续准入') + '；已发送内容不撤回');
      render();
      $('context-list').querySelector('[data-context-id="' + context.id + '"]')?.focus({ preventScroll: true });
      announce(s.excluded.has(context.id) ? '后续请求排除此来源，已发送内容不撤回' : '此来源恢复后续准入');
    });
    item.append(button);
    root.append(item);
  });
}

function renderSidebar(s) {
  document.querySelectorAll('[data-side-panel]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.sidePanel === s.sidePanel)));
  ['context', 'experts', 'goal', 'records'].forEach(name => $('side-' + name).hidden = name !== s.sidePanel);
  renderContext(s);
  const expertRoot = $('expert-list');
  expertRoot.replaceChildren();
  if (!s.expert) expertRoot.append(node('p', '本任务尚未实际委派专家。只有 Host 的实际启动回执才显示正在工作。', 'panel-description'));
  else {
    const item = node('div', undefined, 'expert-item');
    item.append(node('h3', 'Codex · 代码兼容性专家'), node('p', '样例状态：' + s.expert.status), node('p', '父任务：接口升级 · 子任务：兼容性检查'), node('p', '交接：契约与差异样例；未交接生产库凭据'), node('p', '实际域：远程专家服务；内部工具由专家 runtime 执行'));
    if (s.expert.artifactId) {
      const button = node('button', '打开专家阶段报告');
      button.type = 'button';
      button.addEventListener('click', () => openArtifact(s.expert.artifactId, button));
      item.append(button);
    }
    expertRoot.append(item);
  }
  $('goal-state').textContent = s.phase === 'complete' ? (s.hasGoal ? '持续 Goal 的样例验收通过，允许完成' : '本次任务的样例检查通过；未创建持续 Goal') : s.phase === 'restore_wait' || s.phase === 'resume_requested' ? (s.hasGoal ? '资料可读；等待明确恢复与激活回执' : '成果可读；等待明确继续与执行回执') : s.phase === 'paused' || s.phase === 'stopped' ? '推进已停，任务与验收记录保留' : s.hasGoal ? '持续 Goal 未验收；阶段成果不会自动点亮完成' : '本次任务尚待验收；普通任务不强加持续 Goal';
  const checks = $('goal-checks');
  checks.replaceChildren();
  s.checks.forEach(check => {
    const row = node('li', (check.done ? '已核验 · ' : '待核验 · ') + check.label);
    row.append(node('small', check.done ? '编写的样例回执与来源已关联' : '等待实际样例验收事件'));
    checks.append(row);
  });
  $('decision-count').textContent = '当前样例入口 Jev 判断：' + s.routeCount + ' 次；重连不会增加判断次数';
  const records = $('record-list');
  records.replaceChildren(...s.records.map(text => node('p', text)));
  if (!s.records.length) records.append(node('p', '尚无 Host 采用或执行记录'));
}

function retryAdmission() {
  const s = active();
  saveDraft();
  if (s.policy === 'local') { announce('仍选择仅本机，当前没有合法本机模型；请主动调整范围或保留草稿'); return; }
  if (!s.materials.length) { announce('请先添加至少一份样例材料或文件名'); return; }
  const prior = s.continuation ? s.resumeSnapshot : s.inputSnapshot;
  const confirmed = { ...snapshotDraft(s), draft: prior.draft, mode: prior.mode };
  if (s.continuation) s.resumeSnapshot = confirmed; else s.inputSnapshot = confirmed;
  s.phase = s.continuation ? 'resume_requested' : 'received';
  s.blockKind = null;
  record(s.continuation ? '用户明确确认续做材料与数据范围；保留当前任务，重新检查后续范围' : '用户明确确认原输入材料与数据范围；保留原输入目标和模式，重新检查合法候选');
  render();
  announce('已请求按你确认的范围重新检查；尚未准入');
}

function renderBlocking(s) {
  const root = $('blocking-panel');
  root.replaceChildren();
  root.hidden = !['blocked', 'waiting'].includes(s.phase);
  if (s.phase === 'blocked') {
    root.append(node('h2', s.blockKind === 'materials' ? '添加材料后再继续' : '保留本机限制，或由你调整外发范围'));
    root.append(node('p', '草稿和已有成果保留。这里只修改当前任务的后续范围，不改变其他会话。'));
    const actions = node('div', undefined, 'block-actions');
    if (s.blockKind === 'privacy') {
      const field = node('div');
      const label = node('label', '你允许的后续范围');
      label.htmlFor = 'blocked-policy';
      const select = node('select');
      select.id = 'blocked-policy';
      [['local', '仅本机，继续保持阻塞'], ['minimized', '允许文件名、汇总与脱敏片段'], ['selected', '允许选定样例材料']].forEach(([value, text]) => {
        const option = node('option', text); option.value = value; select.append(option);
      });
      select.value = s.policy;
      select.addEventListener('change', () => { s.policy = select.value; $('data-policy').value = s.policy; renderComposerPolicy(s); });
      field.append(label, select);
      actions.append(field);
    }
    const retry = node('button', '按确认范围重新检查');
    retry.id = 'retry-admission';
    retry.type = 'button';
    retry.disabled = connection !== 'online';
    retry.addEventListener('click', retryAdmission);
    actions.append(retry);
    root.append(actions);
  }
  if (s.phase === 'waiting') {
    root.append(node('h2', '经营月报的统计口径'));
    const form = node('form');
    form.id = 'clarification-form';
    const monthField = node('div');
    const monthLabel = node('label', '统计月份'); monthLabel.htmlFor = 'clarify-month';
    const month = node('input'); month.id = 'clarify-month'; month.type = 'month'; month.value = s.pendingMonth; month.required = true;
    month.addEventListener('input', () => s.pendingMonth = month.value);
    monthField.append(monthLabel, month);
    const currencyField = node('div');
    const currencyLabel = node('label', '金额币种'); currencyLabel.htmlFor = 'clarify-currency';
    const currency = node('select'); currency.id = 'clarify-currency'; currency.required = true;
    [['', '请选择口径'], ['CNY', '人民币 CNY'], ['USD', '美元 USD']].forEach(([value, text]) => { const option = node('option', text); option.value = value; currency.append(option); });
    currency.value = s.pendingCurrency;
    currency.addEventListener('change', () => s.pendingCurrency = currency.value);
    currencyField.append(currencyLabel, currency);
    const submit = node('button', '确认口径并继续'); submit.type = 'submit'; submit.id = 'confirm-clarification'; submit.disabled = connection !== 'online';
    form.append(monthField, currencyField, submit);
    form.addEventListener('submit', event => {
      event.preventDefault();
      s.pendingMonth = month.value; s.pendingCurrency = currency.value;
      s.pendingAnswer = { month: month.value, currency: currency.value };
      s.resumePhase = 'answer_requested'; s.phase = 'answer_requested';
      entry('你', '已提交统计口径', s.pendingAnswer.month + ' · ' + s.pendingAnswer.currency + '；退款单独核对');
      record('本地答复已提交；等待 Host 接受，尚未成为已采用上下文');
      render(); announce('口径答复已提交，等待 Host 回执');
    });
    root.append(form);
  }
}

function renderComposerPolicy(s) {
  const scopes = { local: '仅本机处理，不外发', minimized: '文件名、汇总与脱敏片段可外发', selected: '选定样例材料可外发' };
  const submitted = s.admitted ? { mode: s.runMode, policy: s.runPolicy } : s.resumeSnapshot || s.inputSnapshot;
  const currentPolicy = submitted ? '当前已提交输入：' + (submitted.mode === 'fixed' ? '固定 Pro，入口跳过 Jev' : '自动') + ' · ' + scopes[submitted.policy] + '。草稿修改用于下次提交；阻塞面板须明确确认才能调整当前范围。' : '';
  $('composer-policy').textContent = currentPolicy + ' 当前草稿：' + (s.mode === 'fixed' ? '固定 Pro' : '自动') + ' · ' + scopes[s.policy] + '。来源排除影响后续请求。所有操作为离线样例。';
}

function render() {
  const s = active();
  $('task-title').textContent = definitions[current].title;
  $('task-subtitle').textContent = definitions[current].subtitle;
  $('task-badge').textContent = labels[s.phase];
  const [title, detail] = statusText(s);
  $('state-title').textContent = title;
  $('state-detail').textContent = connection === 'online' ? detail : '连接中断期间无法确认新执行状态；本机已保存资料仍可查看';
  $('task-state').dataset.tone = ['blocked', 'waiting', 'failed', 'stopping', 'verification_blocked'].includes(s.phase) ? 'warn' : 'normal';
  const entryPhases = ['idle', 'submitting', 'received', 'routing', 'ready_admit', 'blocked'];
  document.querySelectorAll('[data-intelligence]').forEach(element => element.classList.toggle('active', element.dataset.intelligence === (entryPhases.includes(s.phase) ? 'entry' : ['restore_wait', 'resume_requested', 'paused', 'stopped'].includes(s.phase) ? 'feel' : 'process')));
  document.querySelectorAll('[data-scenario]').forEach(button => {
    if (button.dataset.scenario === current) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
    $('session-' + button.dataset.scenario).textContent = labels[sessions[button.dataset.scenario].phase];
  });
  $('global-notice').hidden = connection === 'online';
  $('global-message').textContent = connection === 'offline' ? '连接已中断。资料与成果保留；无法据此判断任务是否停止。' : '正在补齐持久事实；不重新调用 Jev，不重复启动专家或重放写操作。';
  $('reconnect').disabled = connection !== 'offline';
  $('runtime-status').textContent = connection === 'online' ? '样例 Runtime 就绪' : connection === 'offline' ? '与 Host 连接中断' : '正在补齐记录';
  $('connection-toggle').textContent = connection === 'online' ? '模拟断线' : connection === 'offline' ? '模拟重连' : '等待补档';
  $('connection-toggle').disabled = connection === 'syncing';
  $('next-event').disabled = connection === 'offline' || (connection !== 'syncing' && ['idle', 'waiting', 'blocked', 'paused', 'stopped', 'failed', 'complete', 'restore_wait', 'verification_blocked'].includes(s.phase));
  $('next-event').textContent = connection === 'syncing' ? '补齐事实，不重新路由' : ['pausing', 'stopping'].includes(s.phase) ? '当前工作收尾' : '下一事件';
  $('simulate-failure').disabled = connection !== 'online' || s.phase !== 'running';
  $('event-position').textContent = labels[s.phase] + ' · ' + Math.max(0, s.cursor + 1) + '/' + definitions[current].events.length + ' 个过程事件';
  $('send-task').disabled = connection !== 'online' || !['idle', 'restore_wait', 'complete'].includes(s.phase);
  $('send-task').textContent = s.phase === 'restore_wait' ? '明确恢复执行' : s.phase === 'complete' ? '开始新的当前样例' : '提交样例任务';
  $('pause-current').disabled = connection !== 'online' || !['running', 'waiting'].includes(s.phase);
  $('stop-current').disabled = connection !== 'online' || ['idle', 'stopped', 'complete', 'restore_wait', 'stopping'].includes(s.phase);
  $('continue-current').hidden = !['paused', 'stopped', 'failed', 'restore_wait', 'verification_blocked'].includes(s.phase);
  $('continue-current').disabled = connection !== 'online';
  $('continue-current').textContent = s.phase === 'restore_wait' ? '明确恢复并继续' : s.phase === 'failed' ? '保留成果，先检查错误' : s.phase === 'verification_blocked' ? '明确重试缺项检查' : '用已有成果继续';
  $('scope-panel').hidden = !s.scopeOpen;
  $('scope-toggle').setAttribute('aria-expanded', String(s.scopeOpen));
  $('execution-domain').textContent = s.expert ? '文件工具：本机 · Jev：远程 · 父模型：云端 · 专家：远程服务' : '文件工具：本机 · Jev：远程 · System2：云端';
  renderBlocking(s); renderConversation(s); renderArtifacts(s); renderMaterials(s); renderSidebar(s); renderComposerPolicy(s);
}

function guard(spec) {
  const s = active();
  if (spec.policy === 'local' || !spec.materials.length) {
    s.phase = 'blocked';
    s.blockKind = spec.policy === 'local' ? 'privacy' : 'materials';
    record(s.blockKind === 'privacy' ? '规则拒绝准入：仅本机，但无已验证本机模型；未调用远程 Jev / System2，未入队' : '规则拒绝准入：无材料；草稿保留，未入队');
    return false;
  }
  return true;
}

function restoreCurrent() {
  const s = active();
  saveDraft();
  if (connection !== 'online') return;
  if (!s.admitted && s.name !== 'resume') {
    s.phase = s.hostReceived ? 'received' : 'submitting';
    s.continuation = null;
    entry('你', '明确继续尚未准入的输入', '先等待 Host 收到并重新检查合法范围，不直接激活执行。');
    record('用户明确继续未准入输入；保留原稿与成果，尚未准入或入队');
    render(); announce('继续未准入输入，先回到收到与范围检查'); return;
  }
  s.recoveryPending = s.recoveryPending || s.phase === 'failed' || s.previousPhase === 'failed';
  s.resumeSnapshot = s.admitted ? { draft: s.inputSnapshot?.draft || s.draft, mode: s.runMode, policy: s.runPolicy, materials: s.submittedMaterials.map(material => ({ ...material })) } : snapshotDraft(s);
  s.continuation = 'restore';
  s.phase = 'resume_requested';
  entry('你', '明确请求继续当前任务', '保留已有成果与检查，不重新开始其他会话。先等 Host 恢复回执。');
  record(s.hasGoal ? '人类恢复请求：等待原生 activation 与 revision 检查；尚未续轮' : '人类继续请求：等待当前任务范围与执行回执；没有创建持续 Goal');
  render(); announce(s.hasGoal ? '已请求恢复当前任务，等待 Host 激活回执' : '已请求继续当前任务，等待 Host 执行回执');
}

function addContext(id, title, body, source) {
  const s = active();
  const excluded = s.excluded.has(id);
  let item = s.contexts.find(context => context.id === id);
  if (!item) { item = { id, title, body, source }; s.contexts.push(item); }
  item.historical = false;
  item.injected = !excluded;
  record(id + '：' + (excluded ? '后续排除检查通过，本次未注入' : '原文与来源已进入本次样例请求'));
  return item.injected;
}

function addArtifact(artifact) {
  const s = active();
  if (!s.artifacts.some(item => item.id === artifact.id)) s.artifacts.push(artifact);
  return artifact.id;
}

function performEvent(item) {
  const s = active();
  let feedback = item;
  let artifactId;
  if (item.kind === 'question') { s.phase = 'waiting'; s.resumePhase = 'waiting'; }
  if (item.kind === 'skill') addContext('skill-checklist', current === 'monthly' ? '经营月报核对技能' : '升级核对技能', '保持原文件与生产库约束；列出统计或兼容性检查；必须取得独立检查结果。', '编写的技能目录样例 v1');
  if (item.kind === 'context') addContext('business-constraints', '你明确的业务约束', '“原文件不要修改；退款单独核对；按确认月份与币种汇总。”', '本样例任务的用户输入与口径答复');
  if (item.kind === 'resume-context') {
    s.checks[1].done = addContext('business-constraints', '上次任务的明确口径', '“使用人民币；订单与退款分开核对；原文件不要修改。”', '本工作区历史样例任务，第 2 条消息');
    if (!s.checks[1].done) feedback = { ...item, title: '历史约束未进入本次请求', text: '此来源已被排除，本次没有注入。必需约束检查尚未通过；恢复后续使用不会倒填这次请求，可明确重试缺项检查。' };
  }
  if (item.kind === 'draft') {
    artifactId = addArtifact(makeArtifact('monthly-draft', '经营月报草稿', '阶段产物 · 待核验', '经营月报 · ' + s.month + ' · ' + s.currency + '\n\n统计口径\n订单与退款分别汇总；原文件只读。\n\n固定样例摘要\n订单收入：128,600\n退款金额：8,400\n净额草稿：120,200\n\n异常清单\n一条样例订单缺少业务分类；列入待人工核对。\n\n以上数字全部是独立编写的设计样例，未读取任何真实文件。\n最终合计仍待验收。'));
    s.checks[0].done = true;
  }
  if (item.kind === 'expert-start') {
    s.expert = { status: '实际启动回执已到达，正在检查', artifactId: null };
    record('ctx.subagents 样例：父任务绑定子 run；已安装 provider 通过 subprocess 启动专家');
  }
  if (item.kind === 'expert-partial') {
    artifactId = addArtifact(makeArtifact('expert-partial', '专家兼容性阶段报告', '专家部分结果 · 子任务未完成', '兼容性阶段报告（固定样例）\n\n发现一处返回字段调整；建议保留旧调用方兼容处理。\n专家正在核对其他调用方，此阶段报告不是最终交付。\n\n专家内部执行属于其 runtime；Harness 管理委派范围、取消与结果归属。'));
    s.expert.status = '部分结果已返回，继续检查';
    s.expert.artifactId = artifactId;
  }
  if (item.kind === 'expert-return') {
    s.expert.status = '子任务已完成，结果回父任务';
    s.checks[0].done = true;
    record('子 run completed → 父任务实际取得专家返回结果；整体任务尚未验收');
  }
  if (item.kind === 'integrate') {
    artifactId = addArtifact(makeArtifact('upgrade-report', '接口升级整合报告', '父任务整合产物 · 待独立回归', '接口升级整合报告（固定样例）\n\n已整合代码专家的兼容性检查。\n迁移顺序：增加兼容字段 → 核对调用方 → 隔离环境回归。\n生产数据库保持只读。\n\n专家完成不代表父目标完成，仍需独立回归和验收证据。'));
    s.checks[1].done = true;
  }
  if (item.kind === 'check') record('只读样例检查已开始；没有重放已完成写入');
  if (item.kind === 'finish') {
    if (!s.checks.length || !s.checks.slice(0, -1).every(check => check.done)) {
      s.phase = 'verification_blocked'; s.verificationPending = true;
      entry('Harness · 样例验收', '必需检查缺少通过依据', '未通过：' + s.checks.slice(0, -1).filter(check => !check.done).map(check => check.label).join('、') + '。保留成果，不发布验收通过或完成回执。');
      record('验收拒绝：必需检查未通过，没有点亮完成');
      return;
    }
    s.checks.at(-1).done = true; s.verificationPending = false;
    s.phase = 'complete';
    artifactId = addArtifact(makeArtifact(current + '-verified', current === 'expert' ? '接口升级验收摘要' : '月报核验摘要', '样例必需检查通过', '核验摘要（固定样例）\n\n所有声明的必需检查均有通过回执及可读来源。\n材料范围与原文件只读约束保持。\n已有阶段产物与历史资料继续可读。\n\n此文件只展示设计体验，不是实际运行验收，也没有证明成本或速度收益。'));
    record(s.hasGoal ? '非空必需检查集合及来源回执通过 → 同一原生 Goal 验收入口允许完成' : '本次任务必需检查及来源回执通过 → 任务验收通过；未创建持续 Goal');
  }
  entry('Harness · 样例事件', feedback.title, feedback.text, artifactId);
  record(feedback.title + '：编写的事件与证据样例');
}

function focusAfterAdvance(previouslyFocused) {
  if (!previouslyFocused || !$('next-event').disabled) return;
  const s = active();
  const target = s.phase === 'waiting' ? $('clarify-month') : s.phase === 'blocked' ? (s.blockKind === 'privacy' ? $('blocked-policy') : $('add-samples')) : s.phase === 'complete' ? $('artifact-list').querySelector('[data-artifact-trigger="' + current + '-verified"]') : $('continue-current');
  if (target && !target.hidden && !target.disabled) target.focus({ preventScroll: true });
}

function advance() {
  const s = active();
  const previouslyFocused = document.activeElement === $('next-event');
  if (connection === 'syncing') {
    connection = 'online';
    record('重连补齐持久事实；未重新路由，未重启专家，未重放写操作；入口判断仍为 ' + s.routeCount + ' 次');
    render(); focusAfterAdvance(previouslyFocused); announce('历史事实已补齐，保留原任务状态；没有新的路由调用'); return;
  }
  if (connection !== 'online') return;
  if (s.phase === 'submitting') {
    s.hostReceived = true; s.phase = 'received'; entry('Host · 样例回执', 'Host 已收到输入', '输入尚未准入或入队，下一步检查处理范围。'); record('Host 收到输入；尚未进入原生输入队列');
  } else if (s.phase === 'received') {
    if (guard(s.inputSnapshot)) {
      s.runMode = s.inputSnapshot.mode; s.runPolicy = s.inputSnapshot.policy;
      if (s.runMode === 'fixed') { s.phase = 'ready_admit'; entry('Host · 模式回执', '固定 Pro，入口跳过 Jev', '按你的固定意图确定处理方式，仍等待本次输入准入。'); record('人工固定优先；入口 Jev 0 次，尚未准入'); }
      else { s.phase = 'routing'; record('Jev 判断开始：仅使用规则准入候选；当前输入未入队'); }
    }
  } else if (s.phase === 'routing') {
    s.routeCount++; s.phase = 'ready_admit';
    entry('Host · 采用回执', '已选用 Pro，等待输入准入', '候选说明：适合本样例的分析与整合；不是 Jev 生成的自然语言理由。');
    record('Jev 建议 Pro → 原生 owner 采纳；请求与输出尚未开始');
  } else if (s.phase === 'ready_admit') {
    if (!guard(s.inputSnapshot)) { render(); focusAfterAdvance(previouslyFocused); announce(statusText(s)[0]); return; }
    s.admitted = true; s.submittedMaterials = s.inputSnapshot.materials.map(material => ({ ...material })); s.phase = 'running';
    entry('Host · 准入回执', '本次输入已准入，进入原生执行', '选定材料和模式已绑定当前任务；之后的草稿材料修改用于下一次提交。');
    record('原生输入准入完成 → AgentLoop；有效模式 ' + s.runMode + '，数据范围 ' + s.runPolicy);
  } else if (s.phase === 'answer_requested') {
    s.month = s.pendingAnswer.month; s.currency = s.pendingAnswer.currency;
    s.pendingAnswer = null; s.resumePhase = null;
    s.phase = 'running'; s.checks[1].done = true;
    entry('Host · 答复回执', '统计口径已经采用', s.month + ' · ' + s.currency + '；订单与退款分别核对。');
    record('用户口径答复已接受，并进入任务上下文');
  } else if (s.phase === 'pausing') {
    s.phase = 'paused'; if (s.expert && !s.expert.status.includes('已完成')) s.expert.status = '当前工作已收尾，后续推进暂停';
    record('当前样例工作及对应子任务收尾回执到达；后续推进已暂停');
  } else if (s.phase === 'stopping') {
    s.phase = 'stopped'; if (s.expert && !s.expert.status.includes('已完成')) { s.expert.status = '取消与收尾已确认；阶段结果保留'; s.expert.cancelled = true; }
    record('当前样例任务及子任务停止收尾；其他会话未受影响，已有外部动作不撤销');
  } else if (s.phase === 'resume_requested') {
    if (guard(s.resumeSnapshot)) {
      s.admitted = true; s.runMode = s.resumeSnapshot.mode; s.runPolicy = s.resumeSnapshot.policy;
      s.submittedMaterials = s.resumeSnapshot.materials.map(material => ({ ...material }));
      s.phase = nextExecutionPhase(s); s.continuation = null;
      if (s.expert && !s.expert.cancelled && !s.expert.status.includes('已完成')) s.expert.status = '父任务已明确续做；保留已有专家结果';
      entry('Host · 恢复回执', s.hasGoal ? '恢复已激活，从未完成的检查继续' : '当前任务已允许继续，保留未完成检查', s.hasGoal ? '已确认原生 Goal activation；不重新生成已有成果，不重放未知写操作。' : '已确认当前任务执行范围；不创建持续 Goal，不重新生成已有成果，不重放未知写操作。');
      record(s.hasGoal ? '人类恢复授权 → revision / 范围检查 → activation armed → 原生续轮；无入口重新路由' : '人类继续授权 → 当前任务范围检查 → 继续原任务；无入口重新路由，没有创建持续 Goal');
    }
  } else if (s.phase === 'expert_restart') {
    s.expert.cancelled = false;
    s.expert.status = '新子任务实际启动回执已到达；使用保留的阶段材料';
    s.phase = nextExecutionPhase(s);
    entry('Host · 新委派回执', '已重新交接专家检查', '旧子任务保持取消；明确续做授权后创建新的子任务，关联已有阶段成果，不重放旧 run。');
    record('明确人类续做授权 → 原生 ctx.subagents 新子 run → 实际启动；旧 run 保持取消');
  } else if (s.phase === 'recovering') {
    s.recoveryPending = false; s.phase = nextExecutionPhase(s);
    entry('工具 · 样例证据', '已取得错误详情，保留成果继续', '已读取材料不可用的错误回执。现在继续未完成检查，不重复之前的写入或专家启动。');
    record('只读错误证据取得；未重放写操作，未重复启动专业 Agent');
  } else if (s.phase === 'source_retry') {
    performEvent(definitions.resume.events[0]);
    if (s.checks[1].done) { s.verificationPending = false; s.cursor = 0; s.phase = 'running'; }
    else s.phase = 'verification_blocked';
  } else if (s.phase === 'running') {
    const events = definitions[current].events;
    if (s.cursor + 1 < events.length) { s.cursor++; performEvent(events[s.cursor]); }
  } else return;
  render(); focusAfterAdvance(previouslyFocused); announce(statusText(s)[0]);
}

$('task-form').addEventListener('submit', event => {
  event.preventDefault(); saveDraft();
  const s = active();
  if (connection !== 'online') return;
  if (s.phase === 'restore_wait') { restoreCurrent(); return; }
  if (!['idle', 'complete'].includes(s.phase)) return;
  if (s.phase === 'complete') {
    const draft = s.draft, mode = s.mode, policy = s.policy, materials = s.materials;
    sessions[current] = initialSession(current);
    Object.assign(active(), { draft, mode, policy, materials, phase: 'idle' });
  }
  active().inputSnapshot = snapshotDraft(active());
  active().phase = 'submitting';
  entry('你', '本地输入回显', active().inputSnapshot.draft);
  record('本地提交：等待 Host 收到回执，不能声称已准入或入队');
  render(); announce('输入已本地显示，等待 Host 回执');
});
$('task-input').addEventListener('input', () => active().draft = $('task-input').value);
$('mode').addEventListener('change', () => { active().mode = $('mode').value; renderComposerPolicy(active()); announce(active().inputSnapshot || active().admitted ? '处理模式用于下一次提交，不改变已提交输入' : '当前草稿处理模式已调整'); });
$('data-policy').addEventListener('change', () => { active().policy = $('data-policy').value; renderComposerPolicy(active()); announce('当前草稿数据范围已调整；已发送内容不撤回'); });
$('scope-toggle').addEventListener('click', () => { active().scopeOpen = !active().scopeOpen; render(); });
$('add-samples').addEventListener('click', () => {
  const s = active();
  definitions[current].materials.forEach((name, index) => { if (!s.materials.some(item => item.name === name)) s.materials.push({ id: 'sample-' + index, name, sample: true }); });
  render(); announce('样例材料已加入当前草稿，没有读取真实文件');
});
$('file-input').addEventListener('change', event => {
  const names = Array.from(event.target.files || [], file => file.name);
  names.forEach(name => active().materials.push({ id: 'filename-' + (++fileSequence), name, sample: false }));
  event.target.value = '';
  render(); announce('已添加 ' + names.length + ' 个文件名；未读取文件内容，成果仍使用独立样例');
});
$('next-event').addEventListener('click', advance);
$('pause-current').addEventListener('click', () => {
  const s = active(); s.previousPhase = s.phase; s.phase = 'pausing';
  record('当前样例暂停请求已接纳，等待工作与子任务收尾；并非立即暂停');
  render(); announce('暂停请求已接纳，等待收尾');
});
$('stop-current').addEventListener('click', () => {
  const s = active(); if (!['paused', 'pausing'].includes(s.phase)) s.previousPhase = s.phase; s.phase = 'stopping';
  record('当前样例停止请求已接纳，等待结算；不清空成果，不停止其他会话');
  render(); announce('停止当前任务及其子任务的请求已接纳，等待收尾');
});
$('continue-current').addEventListener('click', restoreCurrent);
$('simulate-failure').addEventListener('click', () => {
  const s = active(); s.previousPhase = 'running'; s.recoveryPending = true; s.phase = 'failed';
  entry('工具 · 样例错误', '执行失败，已有成果仍可用', '固定错误样例：一份核验材料暂时不可读。继续会先检查错误证据，不重放未知写操作。');
  record('tool/result failure；阶段产物保留，任务未验收'); render(); announce('执行失败，资料与成果保留，可明确继续');
});
function reconnect() {
  if (connection !== 'offline') return;
  connection = 'syncing'; render(); announce('重连请求已接纳，下一事件只补齐事实，不重新路由');
}
$('connection-toggle').addEventListener('click', () => {
  if (connection === 'offline') { reconnect(); return; }
  connection = 'offline'; render(); announce('连接中断，资料仍可读；不能推断任务已经停止');
});
$('reconnect').addEventListener('click', reconnect);
$('reset-current').addEventListener('click', () => {
  sessions[current] = initialSession(current);
  $('task-input').value = active().draft; $('mode').value = active().mode; $('data-policy').value = active().policy;
  render(); announce('只重置当前离线样例；其他会话及全局连接状态保留');
});
document.querySelectorAll('[data-scenario]').forEach(button => button.addEventListener('click', () => switchSession(button.dataset.scenario)));
document.querySelectorAll('[data-side-panel]').forEach(button => button.addEventListener('click', () => { active().sidePanel = button.dataset.sidePanel; render(); }));
$('side-toggle').addEventListener('click', () => {
  const desktop = $('desktop'); const open = desktop.dataset.sideOpen !== 'true';
  desktop.dataset.sideOpen = String(open); $('side-toggle').setAttribute('aria-expanded', String(open));
});
$('workspaces-toggle').addEventListener('click', () => {
  const desktop = $('desktop'); const open = desktop.dataset.workspacesOpen !== 'true';
  desktop.dataset.workspacesOpen = String(open); $('workspaces-toggle').setAttribute('aria-expanded', String(open));
});
$('theme-toggle').addEventListener('click', () => {
  const light = document.documentElement.dataset.theme !== 'light';
  document.documentElement.dataset.theme = light ? 'light' : 'dark';
  $('theme-toggle').textContent = light ? '切换深色' : '切换浅色';
});
$('conversation-tab').addEventListener('click', () => { active().pane = 'conversation'; render(); });
$('preview-tab').addEventListener('click', () => { const s = active(); if (s.artifacts.length) openArtifact(s.previewId || s.artifacts[0].id, $('preview-tab')); });
$('back-to-task').addEventListener('click', () => {
  active().pane = 'conversation'; render();
  if (previousArtifactTrigger?.isConnected) previousArtifactTrigger.focus({ preventScroll: true }); else $('conversation-tab').focus({ preventScroll: true });
});
$('new-progress').addEventListener('click', () => {
  $('conversation').scrollTop = $('conversation').scrollHeight; active().newProgress = false; $('new-progress').hidden = true;
});
$('conversation').addEventListener('scroll', () => {
  const area = $('conversation'); if (area.scrollTop + area.clientHeight >= area.scrollHeight - 24) { active().newProgress = false; $('new-progress').hidden = true; }
});
$('download-artifact').addEventListener('click', () => {
  const artifact = active().artifacts.find(item => item.id === active().previewId);
  if (!artifact) return;
  const url = URL.createObjectURL(new Blob([artifact.text], { type: 'text/plain;charset=utf-8' }));
  const link = node('a'); link.href = url; link.download = artifact.title + '-设计样例.txt'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  announce('已下载独立编写的样例成果');
});
$('copy-artifact').addEventListener('click', async () => {
  const artifact = active().artifacts.find(item => item.id === active().previewId);
  if (!artifact) return;
  try { await navigator.clipboard.writeText(artifact.text); announce('样例成果已复制'); }
  catch (error) { announce('浏览器未允许复制，请在中央预览中选择样例文字'); $('preview-content').setAttribute('tabindex', '0'); $('preview-content').focus({ preventScroll: true }); }
});

render();
