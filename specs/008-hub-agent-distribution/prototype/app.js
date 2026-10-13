/* Hub S3 · Agent 分发与贡献 —— 客户端侧高保真原型（里层页面）。
   结构对照客户端真实页面：一级侧栏 → 「智能体 / 技能 / 连接」页 → 二级菜单（智能体 / MCP与工具 / 技能 / 资料库 / IM）。
   本期只改「智能体」这一项内部。其余二级菜单保持现状，原型里只显示「本期不改动」。
   各种状态都尽量通过真实入口点出来（不依赖外层导览条）：
     · 安装各种情况   → 「更多」市场里每张卡片对应一种情况
     · 贡献各种情况   → 自建 Agent 卡片的「贡献」
     · 更新失败       → 详情里点「更新」
     · 未登录         → 侧栏账号条 → 退出登录，再点「贡献」
   外层导览条仅评审用，真实客户端里没有。
   全部为内存模拟数据：不接 IPC、账号、Hub；刷新会重置。Hub Skill 的 ID 格式取真实的 12 位十六进制，但都是示意值，
   不是真实 ID。系统内置 Skill 能否被 Agent 引用未核实，原型不把它当依赖来源（见 spec D-10）。 */
(function () {
  'use strict';

  const W = window;
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = (sel) => document.querySelector(sel);
  const icon = (name, cls) => W.uiIconHtml(name, cls || 'hubc-icon');

  /* ---------- 共享组件薄封装 ---------- */
  const btn = (label, o) => {
    const x = o || {};
    return W.uiButton({ label, role: x.role || 'secondary', size: x.size || 'md', icon: x.icon, disabled: x.disabled, loading: x.loading, className: x.cls, attrs: { 'data-act': x.act, 'data-arg': x.arg, id: x.id, title: x.title } });
  };
  const TONE = { success: 'success', pending: 'attention', review: 'attention', rejected: 'critical', neutral: 'neutral' };
  const pill = (kind, label, check) => W.uiStatusPill({ label, tone: TONE[kind] || 'neutral', check });
  const badge = (tone, label) => W.uiBadge({ label, tone });
  const srcTag = (src) => W.uiTag({ label: src === 'hub' ? 'Hub 分发' : src === 'preset' ? 'Hub 分发 · 预置' : '随智能体提供', variant: src === 'hub' ? 'outline' : src === 'preset' ? 'accent' : 'solid' });
  const chip = (t, extra) => `<span class="agent-card-chip${extra ? ' ' + extra : ''}">${esc(t)}</span>`;
  const DEP_BADGE = { ok: ['success', '已具备'], need: ['attention', '需安装'], bad: ['critical', '不可用'] };
  function note(kind, title, body) {
    const inner = `<p><strong>${esc(title)}</strong></p>${body ? `<p>${esc(body)}</p>` : ''}`;
    if (kind === 'bad') return `<div class="hubc-alert" role="alert">${inner}</div>`;
    if (kind === 'warn') return `<div class="hubc-alert" role="status">${inner}</div>`;
    return `<div class="ap-note ap-note--${kind}" role="status">${inner}</div>`;
  }
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, 3200); }
  function avatar(tone, size) {
    const c = { green: ['#E2F5EC', '#0A7A55'], blue: ['#E4EEF9', '#355D89'], peach: ['#FBEBDD', '#8A5A14'], lilac: ['#EEE7F8', '#6A4FA3'] }[tone || 'green'];
    const px = size || 32;
    return `<span class="avatar-circle agent-card-avatar" style="--avatar-bg:${c[0]};--avatar-fg:${c[1]};width:${px}px;height:${px}px">${W.uiIconHtml('sparkles', '').replace('<svg ', `<svg width="${Math.round(px * 0.55)}" height="${Math.round(px * 0.55)}" `)}</span>`;
  }

  /* ---------- 导览（里层是唯一数据源）----------
     group: main = 导览条常驻；edge = 折叠区「异常场景」；其余 = 折叠区「全部阶段」（深链接仍可用）。 */
  const TOUR = [
    { key: 'agents', label: '智能体页', group: 'main', view: 'agents' },
    { key: 'market', label: '更多 · Agent 市场', group: 'main', view: 'market' },
    { key: 'contribute-preview', label: '贡献预览', group: 'main', view: 'contribute', scn: 'preview', contrib: 'my-expense' },
    { key: 'mine', label: '我的贡献', group: 'main', view: 'mine' },
    { key: 'send-lost', label: '响应丢失', group: 'edge', view: 'contribute', scn: 'lost', contrib: 'my-expense' },
    { key: 'guest-login', label: '未登录点贡献', group: 'edge', view: 'agents', auth: 'guest', modal: 'login' },
    { key: 'agents-installed', label: '安装后的智能体页', view: 'agents', inst: ['expense'] },
    { key: 'task', label: '使用（示意）', view: 'agents', inst: ['expense'], modal: 'task' },
    { key: 'agent-detail', label: '已装详情 · 有更新', view: 'agent-detail', agent: 'expense', inst: ['expense'] },
    { key: 'update-fail', label: '更新失败保留旧版', view: 'agent-detail', agent: 'expense', inst: ['expense'], scn: 'update-fail' },
    { key: 'deps-blocked', label: '依赖已停用', view: 'agent-detail', agent: 'travel', inst: ['travel'] },
    { key: 'market-detail', label: '市场详情', view: 'market-detail', agent: 'expense' },
    { key: 'bundled-skill', label: '随包 Skill 的安装', group: 'main', view: 'market-detail', agent: 'claim' },
    { key: 'min-app-version', label: '需更新客户端', view: 'market-detail', agent: 'meeting' },
    { key: 'hub-disabled', label: '依赖已停用（市场）', view: 'market-detail', agent: 'invoice' },
    { key: 'tampered', label: '摘要不一致', view: 'market-detail', agent: 'contract', autorun: true },
    { key: 'scan-unavailable', label: '扫描不可用', view: 'market-detail', agent: 'data', autorun: true },
    { key: 'install', label: '安装确认', view: 'market-detail', agent: 'expense', modal: 'install' },
    { key: 'install-fail', label: '依赖安装失败', view: 'market-detail', agent: 'sheet', autorun: true },
    { key: 'contribute-blocked', label: '私钥拦截', view: 'contribute', scn: 'blocked', contrib: 'my-mail' },
    { key: 'sending', label: '提交中', view: 'contribute', scn: 'sending', contrib: 'my-expense' },
    { key: 'resubmit', label: '退回重提', view: 'mine', sel: 'c2', modal: 'resubmit' },
  ];

  const s = { key: 'agents', view: 'agents', agent: 'expense', scn: '', auth: 'in', inst: new Set(), attempts: {}, tab: 'agents', cat: 'all', contrib: 'my-expense', file: '', sel: 'c1', type: 'all', filter: 'all', timers: [], modal: null, menu: false, pending: null, declared: { source: '', version: '', terms: false, share: false, skills: false } };

  /* ---------- 模拟数据 ---------- */
  const mk = (id, name, tone, desc, over) => Object.assign({
    id, name, ver: '1.0.0', source: '官方', author: 'CogSeed 官方', cat: '办公', tone, desc,
    scenario: '日常办公中的材料整理与核对。', inputs: '任务说明 + 材料文件', deliver: '整理后的结果与待办清单',
    flow: ['读取所选材料', '按规则处理', '输出结果与待办'], prereq: '需要在任务中选择材料文件。',
    compat: 'CogSeed 1.3.0+ · macOS / Windows', digest: `sha256:${id.slice(0, 4)}…e1f0`, scan: '已通过 · 低风险', updated: '1.0.0 · 首个发布版本', deps: [],
  }, over);
  const QA = { src: 'hub', id: 'a3f09c21b7e4', name: '依据材料作答（示意）', req: '', state: 'ok', note: '本机已具备（随客户端预置的 Hub 内容），无需下载' };
  const bundledDep = (dir, name) => ({ src: 'bundled', id: 'skills/' + dir + '/', name, req: '', state: 'need', note: '随 Agent 一起安装，仅该 Agent 使用' });
  const hubDep = (id, name, req) => ({ src: 'hub', id, name: `${name}（示意）`, req, state: 'need', note: '本机未安装，将从 Hub 获取' });
  const AGENTS = {
    expense: mk('expense-precheck', '报销材料预检助手', 'green', '整理报销材料，按制度规则预检，输出补件清单与可提交的材料摘要。不含审批提交。', {
      ver: '1.2.0', scenario: '员工在提交报销前，快速核对发票、行程与说明是否齐全合规。', inputs: '报销说明 + 发票/行程单/付款凭证（图片或 PDF）', deliver: '材料清单、预检结论（通过/需补件）、补件清单、材料摘要',
      flow: ['读取并归类所选材料', '抽取发票关键字段', '按制度规则逐项预检', '汇总补件清单与材料摘要'], prereq: '需要在任务中选择材料文件；不会连接公司系统，不会提交审批。',
      digest: 'sha256:7c1e…a90b', scan: '已通过 · 低风险（Hub 扫描 + 客户端复核）', updated: '1.2.0 · 补充住宿类规则',
      deps: [QA, hubDep('5e1c8a02d9b3', '发票字段抽取', '^1.0'), hubDep('9b27f4a1c0e6', '报销制度预检', '^2.1')],
    }),
    travel: mk('travel-reimb-organizer', '差旅报销材料整理', 'blue', '按行程归集差旅发票与行程单，生成按日期排序的材料清单。', {
      ver: '0.9.0', source: '社区贡献', author: 'lin', scenario: '出差回来后整理住宿、交通、餐饮材料。', digest: 'sha256:2fd4…c311', updated: '0.9.0 · 首个发布版本',
      deps: [QA, { src: 'hub', id: '9b27f4a1c0e6', name: '报销制度预检（示意）', req: '^2.0', state: 'bad', note: '该 Skill 已被 Hub 停用；Agent 暂不可用，不会误报可用' }],
    }),
    claim: mk('invoice-ocr-claim', '发票识别报销助手', 'green', '识别发票图片中的字段，再按制度预检并输出补件清单。', {
      ver: '1.0.0', cat: '办公', source: '社区贡献', author: 'chen', scenario: '手里是发票照片或扫描件，需要先识别再预检。', inputs: '发票图片 + 任务说明', deliver: '识别结果与补件清单',
      flow: ['识别发票图片中的字段', '调用 Hub Skill 抽取并归类', '按制度规则预检', '输出补件清单'], prereq: '需要在任务中选择发票图片。',
      digest: 'sha256:c5d2…7e08', updated: '1.0.0 · 首个发布版本',
      deps: [QA, hubDep('5e1c8a02d9b3', '发票字段抽取', '^1.0'), bundledDep('invoice-ocr', '发票文字识别')],
    }),
    meeting: mk('meeting-notes-pro', '会议纪要助手 Pro', 'peach', '整理会议录音转写，输出纪要与待办。', {
      ver: '2.0.0', cat: '通用', minApp: '1.4.0', compat: 'CogSeed 1.4.0+ · macOS / Windows',
      deps: [hubDep('b6a21e0f93c4', '会议转写', '^2.0')],
    }),
    invoice: mk('invoice-archive', '发票归档助手', 'lilac', '把发票按月份与类型归档，生成台账。', {
      ver: '1.1.0', deps: [QA, { src: 'hub', id: 'c4d8e2a17f05', name: '发票分类（示意）', req: '^1.2', state: 'bad', note: '该 Skill 已被 Hub 停用，无法安装；Agent 暂不可用' }],
    }),
    contract: mk('contract-review', '合同审阅助手', 'blue', '抽取合同关键条款并标出风险点。', { ver: '1.0.3', cat: '办公', digest: 'sha256:9a07…b2c4', deps: [hubDep('1f6a9d3b82c7', '合同条款抽取', '^1.0')] }),
    data: mk('data-weekly', '数据周报助手', 'green', '汇总表格数据，生成周报草稿。', { ver: '1.0.1', cat: '数据', deps: [hubDep('7a0e5c9d4b21', '表格汇总', '^1.0')] }),
    sheet: mk('table-cleaner', '表格整理助手', 'peach', '清洗与规范化导出的表格。', { ver: '0.8.0', cat: '数据', deps: [hubDep('e82b1f60a3d9', '表格清洗', '^1.0'), hubDep('3d9c47b1e0a5', 'CSV 规范化', '^1.0')] }),
  };
  const MARKET_ORDER = ['expense', 'claim', 'travel', 'meeting', 'invoice', 'contract', 'data', 'sheet'];
  const NAMES = { 'my-expense': '报销材料整理助手', 'my-weekly': '周报整理助手', 'my-mail': '客户邮件助手', standup: '周会纪要助手' };
  Object.keys(AGENTS).forEach((k) => { NAMES[k] = AGENTS[k].name; NAMES[AGENTS[k].id] = AGENTS[k].name; });
  const MINE = [
    { id: 'my-expense', name: '报销材料整理助手', desc: '整理报销材料并按制度预检，输出补件清单。', skills: 3 },
    { id: 'my-weekly', name: '周报整理助手', desc: '把本周任务整理成周报草稿。', skills: 1 },
    { id: 'my-mail', name: '客户邮件助手', desc: '起草并润色客户邮件。', skills: 2 },
  ];
  const isInst = (id) => s.inst.has(id);
  function depsFor(a, key) {
    const deps = a.deps.map((d) => ({ ...d }));
    if (isInst(key)) deps.forEach((d) => { if (d.state === 'need') { d.state = 'ok'; d.note = '已安装'; } });
    return deps;
  }

  /* 贡献：按所点的 Agent 给出不同的提交副本 */
  /* 提交副本：与 agent-package-v1 一致——agent.json（作者原文，不含 version / created_at / updated_at，
     本机设置已移除）、可选 README.md、skills/<名字>/（随包私有 Skill，SKILL.md 带 ownerAgent）。 */
  function filesFor(id) {
    if (id === 'my-weekly') {
      return {
        'agent.json': '{\n  "agent_id": "my-weekly",\n  "name": "周报整理助手",\n  "description_zh": "把本周任务整理成周报草稿。",\n  "workflow": "1. 读取本周任务 2. 归类 3. 生成周报草稿",\n  "category": "office",\n  "skill_list": ["a3f09c21b7e4"]\n}',
      };
    }
    return {
      'agent.json': '{\n  "agent_id": "my-expense",\n  "name": "报销材料整理助手",\n  "description_zh": "整理报销材料并按制度预检，输出补件清单。",\n  "workflow": "1. 读取材料 2. 抽取发票字段 3. 按制度预检 4. 汇总补件清单",\n  "category": "office",\n  "skill_list": ["a3f09c21b7e4", "5e1c8a02d9b3", "my-ocr-helper"]\n}',
      'skills/my-ocr-helper/SKILL.md': '---\nname: my-ocr-helper\ndescription: 识别发票图片中的文字\nownerAgent: my-expense\n---\n\n读取用户选择的发票图片，输出结构化文字。',
    };
  }
  const BUNDLED = { 'my-expense': ['my-ocr-helper'], 'my-weekly': [], 'my-mail': ['mail-tone'] };
  /* 本机处理项：只给本机预览看，不上传，Hub 不需要知道处理了什么。只会移除字段，不改正文。 */
  const STRIPPED = {
    'my-expense': [['版本与时间戳', 'created_at / updated_at'], ['连接器实例', 'enabled_connectors'], ['模型偏好', 'default_model']],
    'my-weekly': [['版本与时间戳', 'created_at / updated_at'], ['连接器实例', 'enabled_connectors']],
  };
  const HISTORY = [
    { id: 'c1', type: 'agent', name: '报销材料整理助手', stable: 'agt_8f3a21', ver: '1.0.0', st: 'pending', stText: '待审核', pub: '—', at: '10-09 10:12', note: '已提交，等待审核。审核绑定本次提交版本 1.0.0；随 Agent 提交的技能 my-ocr-helper 一并审核。' },
    { id: 'c2', type: 'agent', name: '差旅报销材料整理', stable: 'agt_77c0d4', ver: '0.8.0', st: 'rejected', stText: '已退回', pub: '—', at: '10-07 16:40', note: '退回原因：工作流中包含个人邮箱地址，请移除后重新提交。' },
    { id: 'c3', type: 'agent', name: '周会纪要助手', stable: 'agt_12ab90', ver: '2.0.0', st: 'review', stText: '已通过，待发布', pub: 'v1.0.0', at: '10-08 09:05', note: '审核已通过，但尚未发布，因此还不会出现在公开市场。需有发布权限的运营确认发布。' },
    { id: 'c4', type: 'agent', name: '周报整理助手', stable: 'agt_5d6e11', ver: '1.1.0', st: 'success', stText: '已发布', pub: 'v1.1.0', at: '09-30 11:20', note: '已发布，其他用户可在「更多」里安装。可提交新版本。' },
    { id: 's1', type: 'skill', name: '图片压缩技能', stable: 'skl_31b9c0', ver: '1.0.2', st: 'success', stText: '已发布', pub: 'v1.0.2', at: '09-26 14:02', note: '已发布，其他用户可在技能的「更多」里安装。' },
  ];

  /* ---------- 定时器 / 弹窗 ---------- */
  function clearTimers() { s.timers.forEach(clearTimeout); s.timers = []; }
  function later(fn, ms) { s.timers.push(setTimeout(fn, ms)); }
  function closeDialog() { if (s.modal) { s.modal.close(null, 'code'); s.modal = null; } }
  function dialog(title, bodyHtml, actions, size) {
    closeDialog();
    const acts = actions || [];
    const m = W.uiModal({ title, bodyHtml, size: size || 'md', closeLabel: '关闭', actions: acts.map((a, i) => ({ id: String(i), label: a.label, role: a.role || 'secondary' })) });
    s.modal = m;
    m.then((r) => { if (s.modal === m) s.modal = null; if (r && r.reason === 'action') { const a = acts[Number(r.value)]; if (a && a.run) a.run(); } });
    return m;
  }

  /* ---------- 通用片段 ---------- */
  const heading = (title, sub, right) => `<header class="hubc-heading"><div><h1>${esc(title)}</h1>${sub ? `<p>${esc(sub)}</p>` : ''}</div>${right || ''}</header>`;
  const backline = (label, target, backLabel) => `<div class="hubc-backline">${btn(backLabel, { role: 'ghost', size: 'sm', icon: 'chevron-left', act: 'goto', arg: target })}<span class="hubc-backline__sep" aria-hidden="true">/</span><span>${esc(label)}</span></div>`;
  function depList(deps, hubLabel) {
    return ['hub', 'preset', 'bundled'].map((src) => {
      const rows = deps.filter((d) => d.src === src); if (!rows.length) return '';
      return `<div class="ap-group"><h3>${src === 'hub' ? hubLabel : src === 'preset' ? 'Hub 分发中的预置 Skill（随客户端预置）' : '随 Agent 一起安装的 Skill（仅该 Agent 使用，不进入你的技能列表，也不会覆盖同名技能）'}</h3><ul class="ap-deps">${rows.map((d) => { const c = DEP_BADGE[d.state]; return `<li class="ap-dep"><div><strong>${esc(d.name)}</strong> ${srcTag(d.src)}</div>${badge(c[0], c[1])}<small><span class="ap-mono">${esc(d.id)}</span>${[d.req, d.note].filter(Boolean).map((x) => ' · ' + esc(x)).join('')}</small></li>`; }).join('')}</ul></div>`;
    }).join('');
  }

  /* ================= 智能体页（真实 Agent 页结构） ================= */
  function agentCard(o) {
    const actions = `${o.chips || ''}${o.contribute ? btn('贡献', { size: 'sm', cls: 'agent-card-contribute', act: 'contribute', arg: o.id, title: '贡献到 Hub' }) : ''}${btn('使用', { role: 'primary', size: 'sm', cls: 'agent-card-use', act: 'use', arg: o.id, disabled: o.disabled })}`;
    return `<div class="agent-card ui-resource-card${o.off ? ' is-disabled' : ''}" data-id="${esc(o.id)}">
      <button type="button" class="agent-card-open" data-act="${o.detail ? 'open-agent' : 'toast'}" data-arg="${esc(o.detail || '本期原型只展开已装 Agent 的详情')}" aria-label="管理：${esc(o.name)}"></button>
      <div class="agent-card-header">${avatar(o.tone)}<div class="agent-card-title"><span class="agent-card-name">${esc(o.name)}</span>${o.meta ? `<span class="agent-card-meta">${o.meta}</span>` : ''}</div>${W.uiIconButton({ label: '更多操作', icon: 'more-horizontal', className: 'agent-card-more', attrs: { 'data-act': 'toast', 'data-arg': '停用、卸载等操作在详情页' } })}</div>
      <div class="agent-card-desc">${esc(o.desc)}</div>
      <div class="agent-card-actions">${actions}</div></div>`;
  }
  function vAgentsGrid() {
    const mine = MINE.map((m) => agentCard({ id: m.id, name: m.name, desc: m.desc, tone: 'green', meta: chip('办公'), chips: chip(`${m.skills} 技能`), contribute: true }));
    const plat = [];
    s.inst.forEach((k) => { const a = AGENTS[k]; if (!a || k === 'travel') return; plat.push(agentCard({ id: k, detail: k, name: a.name, desc: a.desc, tone: a.tone, meta: chip(`v${a.ver}`, 'is-version') + chip(a.cat), chips: chip(a.source === '官方' ? '官方' : '社区贡献') + (k === 'expense' ? chip('有更新', 'is-version') : '') + chip(`${a.deps.length} 技能`) })); });
    plat.push(agentCard({ id: 'travel', detail: 'travel', name: AGENTS.travel.name, desc: AGENTS.travel.desc, tone: 'blue', meta: chip('v0.9.0', 'is-version') + chip('办公'), chips: chip('社区贡献') + chip('依赖已停用') + chip('2 技能'), disabled: true }));
    plat.push(agentCard({ id: 'standup', name: '周会纪要助手', desc: '整理周会录音转写，输出纪要与待办。', tone: 'peach', meta: chip('v2.0.0', 'is-version') + chip('通用'), chips: chip('官方') + chip('1 技能'), off: true, disabled: true }));
    const sec = (label, list) => `<section class="agents-source-section"><div class="agents-source-section-head">${esc(label)} · ${list.length}</div><div class="agents-source-section-grid ui-resource-grid">${list.join('')}</div></section>`;
    return `<div class="agents-grid-view" id="agents-grid-view">
      <div class="agents-grid-header"><div class="agents-grid-header-titles"><span class="agents-grid-title">AI 团队</span><span class="agents-grid-subtitle">每个成员都是一个智能体——@ 它、编成小队、派任务。</span></div></div>
      <div class="agents-resource-toolbar">
        <div class="marketplace-categories agents-categories">${W.uiSegmentedControl({ ariaLabel: '智能体分类', value: s.cat, items: [['all', '全部'], ['office', '办公'], ['general', '通用']].map((x) => ({ value: x[0], label: x[1], attrs: { 'data-act': 'cat', 'data-arg': x[0] } })) })}</div>
        <div class="agents-resource-toolbar-controls"><div class="agents-search-field">${W.uiInput({ id: 'agents-search', type: 'search', placeholder: '搜索智能体', attrs: { 'aria-label': '搜索智能体' } })}</div>
          <div class="header-actions">${btn('+ 创建', { size: 'sm', act: 'toast', arg: '创建流程不在本期范围' })}${btn('我的贡献', { size: 'sm', act: 'goto', arg: 'mine' })}${btn('更多', { size: 'sm', act: 'goto', arg: 'market' })}</div></div></div>
      <div class="agents-grid-scroll"><div class="agents-grid ui-resource-grid is-sectioned">${sec('自定义', mine)}${sec('平台', plat)}</div></div></div>`;
  }

  /* 已安装 Agent 详情 */
  function vAgentDetail() {
    const a = AGENTS[s.agent]; const deps = depsFor(a, s.agent); const bad = deps.some((d) => d.state === 'bad');
    const comm = a.source === '社区贡献';
    let upd = '';
    if (!comm) upd = s.scn === 'update-fail' ? note('warn', '更新到 1.3.0 失败，已保留 1.2.0，仍可正常使用', '有 1 个任务正在使用 1.2.0；更新不会影响它。可以稍后重试。') : note('info', '有新版本 1.3.0', '正在运行的 1 个任务继续使用 1.2.0，新任务才使用新版本。');
    const actions = [
      btn('使用', { role: 'primary', size: 'sm', act: 'use', arg: s.agent, disabled: bad }),
      !comm ? btn(s.scn === 'update-fail' ? '重试更新' : '更新', { size: 'sm', act: 'update' }) : btn('转为我的版本', { size: 'sm', act: 'convert' }),
      btn('停用', { size: 'sm', act: 'disable' }), btn('卸载', { size: 'sm', role: 'danger', act: 'uninstall' }),
    ].join('');
    return `<div class="agents-detail-view" id="agents-detail-view" style="display:flex"><div class="agents-detail-col"><div class="agents-detail-content" style="display:block">
      <div class="agents-detail-header"><div class="agents-detail-title-row">${btn('返回', { size: 'sm', act: 'goto', arg: 'agents' })}${avatar(a.tone)}<div class="agents-detail-name">${esc(a.name)}</div><span class="agents-detail-source">${esc(a.source)}${comm ? ' · ' + esc(a.author) : ''} · v${esc(a.ver)}</span><div class="detail-actions">${actions}</div></div></div>
      <div class="agents-detail-body ap-detail-wrap">
        ${bad ? note('bad', 'Agent 暂不可用', '依赖的 Skill 已被 Hub 停用，「使用」已停用，不会显示可用。你可以转为自己的版本后改用其他 Skill，或等待恢复。') : upd}
        <div class="agents-detail-section"><div class="agents-detail-label">简介</div><div class="agents-detail-desc">${esc(a.desc)}</div></div>
        <div class="agents-detail-section"><div class="agents-detail-label">依赖的技能</div>${depList(deps, 'Hub 分发的 Skill')}</div>
        <div class="agents-detail-section agents-detail-section-workflow"><div class="agents-detail-label">工作流程</div><ol class="ap-steps">${a.flow.map((f) => `<li>${esc(f)}</li>`).join('')}</ol></div>
      </div></div></div></div>`;
  }

  /* ================= 更多：Agent 市场（真实 panel-marketplace 结构） ================= */
  function installLabel(k) {
    const a = AGENTS[k]; const deps = a.deps;
    if (isInst(k) || k === 'travel') return { label: '已安装', dis: true };
    if (a.minApp) return { label: `需 CogSeed ${a.minApp}+`, dis: true };
    if (deps.some((d) => d.state === 'bad')) return { label: '依赖已停用', dis: true };
    return { label: '安装', dis: false };
  }
  function mpCard(k) {
    const a = AGENTS[k]; const st = installLabel(k);
    return `<div class="marketplace-card ui-resource-card" data-id="${esc(a.id)}">
      <div class="marketplace-card-header">${avatar(a.tone)}<span class="marketplace-card-name">${esc(a.name)}</span></div>
      <div class="marketplace-card-desc">${esc(a.desc)}</div>
      <div class="marketplace-card-footer"><div class="marketplace-card-meta"><span class="marketplace-card-chip is-version">v${esc(a.ver)}</span><span class="marketplace-card-chip">${esc(a.cat)}</span><span class="marketplace-card-chip">${a.source === '官方' ? '官方' : '社区贡献'}</span></div>
        <div class="marketplace-card-actions">${W.uiButton({ label: st.label, role: 'primary', size: 'sm', disabled: st.dis, attrs: { 'data-act': 'open-market', 'data-arg': k } })}${btn('详情', { size: 'sm', act: 'open-market', arg: k })}</div></div></div>`;
  }
  function vMarket() {
    return `<section class="panel active" id="panel-marketplace"><div class="marketplace-grid-view" id="marketplace-grid-view" style="display:flex">
      <div class="marketplace-header">${btn('返回', { size: 'sm', act: 'goto', arg: 'agents' })}
        <div class="marketplace-tabs"><button type="button" class="marketplace-tab active is-active" data-act="toast" data-arg="技能市场沿用现有页面">智能体</button><button type="button" class="marketplace-tab" data-act="toast" data-arg="技能市场沿用现有页面">技能</button><button type="button" class="marketplace-tab marketplace-tab--oss" data-act="toast" data-arg="本期不涉及"><span>开源项目</span><span class="marketplace-tab-new">NEW</span></button></div>
        <div class="marketplace-search-wrap"><input type="text" class="marketplace-search" placeholder="搜索" aria-label="搜索"></div>${W.uiButton({ label: '搜索', role: 'primary', size: 'sm', attrs: { 'data-act': 'toast', 'data-arg': '搜索（模拟）' } })}</div>
      <div class="marketplace-categories">${W.uiSegmentedControl({ ariaLabel: '分类', value: 'all', items: [{ value: 'all', label: '全部' }, { value: 'office', label: '办公' }, { value: 'general', label: '通用' }] })}</div>
      <div class="marketplace-body"><div class="marketplace-grid">${MARKET_ORDER.map(mpCard).join('')}</div></div></div></section>`;
  }
  function vMarketDetail() {
    const a = AGENTS[s.agent]; const deps = depsFor(a, s.agent);
    const st = installLabel(s.agent); const need = deps.filter((d) => d.state === 'need');
    const unsupported = !!a.minApp;
    const bad = deps.some((d) => d.state === 'bad');
    let alerts = '';
    if (unsupported) alerts = note('bad', '需升级 CogSeed 才能使用', `该 Agent 声明的最低客户端版本是 ${a.minApp}，你当前是 1.3.0。升级前不能安装，也不会显示可用。`);
    else if (bad) alerts = note('bad', 'Agent 暂不可用', '依赖的 Skill 已被 Hub 停用，无法安装。');
    else if (isInst(s.agent)) alerts = note('success', '已安装并可用', '所有依赖就绪，已出现在智能体页「平台」里。');
    else if (need.length) alerts = note('info', `安装将同时获取 ${need.length} 个依赖`, '安装前会先列出依赖清单，确认后才开始获取；下载后会校验发布物摘要并做安全检查。');
    return `<section class="panel active" id="panel-marketplace"><div class="marketplace-detail-view" id="marketplace-detail-view" style="display:flex">
      <div class="marketplace-detail-header">${btn('返回', { size: 'sm', act: 'goto', arg: 'market' })}<span class="marketplace-detail-avatar-slot">${avatar(a.tone)}</span>
        <div class="marketplace-detail-title-wrap"><span class="marketplace-detail-title">${esc(a.name)}</span><span class="marketplace-detail-meta-row"><span class="marketplace-card-chip is-version">v${esc(a.ver)}</span><span class="marketplace-card-chip">${esc(a.cat)}</span><span class="marketplace-card-chip">${esc(a.source)}${a.source === '社区贡献' ? ' · ' + esc(a.author) : ''}</span></span></div>
        ${W.uiButton({ label: st.label, role: 'primary', size: 'sm', disabled: st.dis, attrs: { 'data-act': 'open-install' } })}</div>
      <div class="marketplace-detail-body"><div class="agents-detail-body marketplace-detail-body-inner ap-detail-wrap">${alerts}
        <div class="ap-detail-grid"><div class="ap-main-col">
          <div class="agents-detail-section"><div class="agents-detail-label">它能做什么</div><dl class="ap-kv"><dt>适用场景</dt><dd>${esc(a.scenario)}</dd><dt>输入</dt><dd>${esc(a.inputs)}</dd><dt>交付结果</dt><dd>${esc(a.deliver)}</dd><dt>使用前提</dt><dd>${esc(a.prereq)}</dd></dl></div>
          <div class="agents-detail-section agents-detail-section-workflow"><div class="agents-detail-label">工作流程</div><ol class="ap-steps">${a.flow.map((f) => `<li>${esc(f)}</li>`).join('')}</ol></div>
          <div class="agents-detail-section"><div class="agents-detail-label">依赖的技能</div><p class="ap-meta">按情形（需下载 / 预置）分别校验、分别提示。</p>${depList(deps, 'Hub 分发的 Skill')}</div></div>
          <aside class="ap-section"><dl class="ap-kv"><dt>版本</dt><dd>${esc(a.ver)}（${esc(a.updated)}）</dd><dt>作者与来源</dt><dd>${esc(a.author)} · ${esc(a.source)}</dd><dt>客户端兼容</dt><dd>${esc(a.compat)}</dd><dt>发布物摘要</dt><dd class="ap-mono">${esc(a.digest)}</dd><dt>安全检查</dt><dd>${esc(a.scan)}</dd></dl><p class="ap-fine">审核标识不替代执行时的用户授权。</p><p class="ap-fine">发布物摘要与安全检查结果需要 Hub 提供 Agent 的摘要字段（D-09），实现里暂未接入，这里仅作示意。</p></aside></div>
      </div></div></div></section>`;
  }

  /* ---------- 安装：依赖 → 校验摘要 → 安全检查（失败原因由所点的 Agent 决定） ---------- */
  function installDialog() {
    const k = s.agent; const a = AGENTS[k]; const deps = depsFor(a, k);
    const rows = deps.map((d) => `<li><span><strong>${esc(d.name)}</strong> ${srcTag(d.src)}<br><small class="ap-mono">${esc(d.id)} · ${esc(d.req)}</small></span>${d.state === 'ok' ? badge('success', '已具备，直接复用') : d.src === 'bundled' ? badge('attention', '随 Agent 安装') : badge('attention', '将从 Hub 安装')}</li>`).join('');
    const nHub = deps.filter((d) => d.src === 'hub').length, nPre = deps.filter((d) => d.state === 'ok').length, nBun = deps.filter((d) => d.src === 'bundled').length;
    dialog('确认安装', `<p>将安装「${esc(a.name)}」v${esc(a.ver)}，并<strong>同时安装</strong>：${nHub} 个 Hub Skill${nBun ? `、${nBun} 个随 Agent 提交的 Skill` : ''}${nPre ? `；${nPre} 个本机已具备的直接复用，不会升级` : ''}。确认前不会写入本机。</p><ul class="ap-modal-list">${rows}</ul><p class="ap-fine">全部依赖就绪后 Agent 才可用。下载后会校验发布物摘要并做安全检查；任一步失败，整个安装失败，Agent 不会被记录，你现有的 Agent 与进行中的任务不受影响。</p>`,
      [{ label: '取消' }, { label: '确认安装', role: 'primary', run: runInstall }]);
  }
  function runInstall() {
    const k = s.agent; const a = AGENTS[k]; const deps = depsFor(a, k);
    const attempt = (s.attempts[k] = (s.attempts[k] || 0) + 1);
    const outcome = k === 'contract' ? 'digest' : k === 'data' ? 'scan' : (k === 'sheet' && attempt === 1) ? 'dep' : 'ok';
    const rows = deps.map((d, i) => `<li><span><strong>${esc(d.name)}</strong> ${srcTag(d.src)}</span><span id="pc-${i}">${badge(d.state === 'ok' ? 'success' : 'neutral', d.state === 'ok' ? '已具备' : '等待')}</span></li>`).join('')
      + `<li><span>校验发布物摘要</span><span id="pc-digest">${badge('neutral', '等待')}</span></li><li><span>安全检查</span><span id="pc-scan">${badge('neutral', '等待')}</span></li>`;
    const total = deps.length + 2;
    const bar = (n) => W.uiProgressBar({ ariaLabel: '安装进度', value: n, max: total });
    const m = dialog('正在安装', `<div id="inst-bar">${bar(deps.filter((d) => d.state === 'ok').length)}</div><ul class="ap-modal-list">${rows}</ul><p class="ap-fine">正在获取依赖……</p>`, [{ label: '取消', run: clearTimers }]);
    let done = deps.filter((d) => d.state === 'ok').length; let t = 300; let failed = '';
    const mark = (sel, tone, text) => { const c = m.dialog.querySelector(sel); if (c) c.innerHTML = badge(tone, text); m.dialog.querySelector('#inst-bar').innerHTML = bar(done); };
    const need = deps.map((d, i) => [d, i]).filter((x) => x[0].state !== 'ok');
    need.forEach(([d, i], n) => {
      later(() => {
        if (!m.dialog.isConnected || failed) return;
        if (outcome === 'dep' && n === need.length - 1) { failed = 'dep'; mark('#pc-' + i, 'critical', '失败'); return; }
        done += 1; mark('#pc-' + i, 'success', '已安装');
      }, t += 700);
    });
    later(() => { if (!m.dialog.isConnected || failed) return; if (outcome === 'digest') { failed = 'digest'; mark('#pc-digest', 'critical', '不一致'); return; } done += 1; mark('#pc-digest', 'success', '一致'); }, t += 600);
    later(() => { if (!m.dialog.isConnected || failed) return; if (outcome === 'scan') { failed = 'scan'; mark('#pc-scan', 'attention', '未完成'); return; } done += 1; mark('#pc-scan', 'success', '通过'); }, t += 600);
    later(() => {
      if (!m.dialog.isConnected) return;
      closeDialog();
      if (failed === 'dep') dialog('安装失败', `<p>「${esc(deps[deps.length - 1].name)}」下载中断。<strong>整个安装已回滚</strong>：Agent 未被记录，也不会出现在智能体页。已有内容未受影响。</p>`, [{ label: '关闭' }, { label: '重试', role: 'primary', run: runInstall }]);
      else if (failed === 'digest') dialog('已拒绝安装', '<p><strong>内容与发布记录不一致，可能被篡改。</strong>客户端计算的发布物摘要与 Hub 记录不符。已保留本机现有可用版本，未做任何改动。</p><p class="ap-fine">不会显示“校验通过”。</p>', [{ label: '关闭', role: 'primary' }]);
      else if (failed === 'scan') dialog('安全检查未完成', '<p>扫描服务暂时不可用。在检查完成前不会显示“已通过”，<strong>也不能安装</strong>。已保留现有可用版本。</p>', [{ label: '关闭' }, { label: '稍后重试', role: 'primary', run: runInstall }]);
      else { s.inst.add(k); toast('已安装，所有依赖就绪。已出现在智能体页「平台」里。'); go('agents-installed-keep'); }
    }, t + 700);
  }
  function taskDialog(name) {
    dialog(`使用「${name || '报销材料预检助手'}」（示意）`, `<p class="ap-fine">以下为示意输入与输出，不是真实模型结果。</p><div class="ap-two" style="margin-top:var(--space-2)"><div><strong>输入</strong><pre class="ap-pre">报销说明：上海出差 2 天
材料：酒店发票.pdf、高铁行程单.png、付款凭证.png</pre></div><div><strong>交付结果</strong><pre class="ap-pre">预检结论：需补件
✔ 酒店发票完整
✔ 高铁行程单与说明一致
✘ 缺少餐饮发票 × 1</pre></div></div>`, [{ label: '关闭' }], 'lg');
  }
  function loginDialog() {
    dialog('此功能需要登录', `<p>贡献 Agent 需要先登录。登录后会回到「贡献 · ${esc(NAMES[s.contrib] || '报销材料整理助手')}」继续。</p><p class="ap-fine">关闭或登录失败时留在当前页面，不会检查或上传任何内容。</p>`,
      [{ label: '取消' }, { label: '前往 Web 登录', role: 'primary', run: () => { s.auth = 'in'; paintSidebar(); toast('已登录（模拟）。继续贡献。'); startContribute(s.contrib); } }]);
  }
  function resubmitDialog() {
    dialog('修改后重提', '<p>被退回的提交不能直接再次送审。修改后将作为<strong>新的提交</strong>重新做本机检查、预览、声明与审核，<strong>不沿用旧批准</strong>。</p><p class="ap-fine">退回原因：工作流中包含个人邮箱地址。</p>', [{ label: '取消' }, { label: '继续修改', role: 'primary', run: () => startContribute('my-expense') }]);
  }

  /* ================= 贡献页（hubc-* 结构） ================= */
  function steps(current) {
    const labels = ['本机检查', '预览与声明', '提交审核'];
    return `<ol class="hubc-steps" aria-label="贡献流程">${labels.map((l, i) => { const st = i < current ? 'done' : i === current ? 'current' : 'todo'; return `<li class="hubc-step is-${st}"${st === 'current' ? ' aria-current="step"' : ''}><span class="hubc-step__mark" aria-hidden="true">${st === 'done' ? icon('check') : i + 1}</span><span class="hubc-step__label">${l}</span></li>`; }).join('')}</ol>`;
  }
  const checkRow = (tone, mark, name, detail) => `<li class="hubc-check-row is-${tone}">${icon(mark)}<strong>${esc(name)}</strong><span>${esc(detail)}</span></li>`;
  function startContribute(id) {
    s.contrib = id;
    if (id === 'my-mail') go('contribute-blocked'); else go('contribute-preview-' + id);
  }
  function vContribute() {
    const id = s.contrib; const name = NAMES[id] || '报销材料整理助手';
    const cur = s.scn === 'blocked' ? 0 : s.scn === 'preview' ? 1 : 2;
    const head = `${backline('贡献智能体', 'agents', '返回智能体')}${heading('贡献智能体', `把「${name}」贡献到 Hub。提交后先进入审核；审核通过后还需要发布才会出现在目录里。`, pill('neutral', '仅提交审核'))}${steps(cur)}`;
    const wrap = (body) => `<div class="hubc-page">${head}<div class="hubc-stage">${body}</div></div>`;
    if (s.scn === 'blocked') return wrap(`<section class="hubc-panel"><div class="hubc-section-head"><div><h2>本机检查发现了阻断项</h2><p>检查完成前，没有任何文件离开本机。只拦最明显的密钥格式（私钥、pem），不保证识别所有隐私。</p></div>${pill('rejected', '已阻断')}</div>
      <ul class="hubc-check-list">${checkRow('success', 'check-circle', '引用的技能', 'Hub 技能 1 · 随智能体提供 1')}${checkRow('success', 'check-circle', '本机设置', '已移除')}${checkRow('critical', 'x-circle', 'skills/mail-tone/scripts/send.py', '含 SSH 私钥格式，不能提交')}</ul>
      ${note('bad', '已阻断，未上传任何内容', '在 skills/mail-tone/scripts/send.py 中发现私钥格式（规则 private_key_block）。请删除后重新检查。你对提交的内容负责，客户端只拦截最明显的格式。')}
      <div class="hubc-submit-actions">${btn('返回修改', { act: 'goto', arg: 'agents' })}</div></section>`);
    if (s.scn === 'sending') return wrap(`<section class="hubc-panel"><div class="hubc-section-head"><div><h2>正在提交</h2><p id="send-msg">正在上传已确认的提交内容……</p></div>${pill('pending', '提交中')}</div>
      <div id="send-bar">${W.uiProgressBar({ ariaLabel: '提交进度', value: 0, max: 100 })}</div><p class="ap-fine">提交固定版本 1.0.0 · 幂等键 idem-7f3a</p><div class="hubc-submit-actions">${btn('取消提交', { act: 'cancel-send' })}</div></section>`);
    if (s.scn === 'lost') return wrap(`<section class="hubc-panel"><div class="hubc-section-head"><div><h2>提交结果</h2></div>${pill('pending', '未到达')}</div>
      ${note('warn', '未到达，请重试', '网络中断，Hub 未确认收到。你的本地内容完整保留。重试使用同一幂等键 idem-7f3a，不会产生重复投稿。结论只有“已到达”或“未到达”，没有中间态。')}
      <div class="hubc-submit-actions">${btn('重试提交', { role: 'primary', icon: 'upload', act: 'retry-send' })}</div></section>`);
    const FILES = filesFor(id); const bundled = BUNDLED[id] || [];
    if (!FILES[s.file]) s.file = Object.keys(FILES)[0];
    const fileRows = Object.keys(FILES).map((f) => `<li class="hubc-file${f === s.file ? ' is-selected' : ''}">${W.uiButton({ label: f, role: 'ghost', size: 'sm', icon: 'file-text', attrs: { 'data-act': 'pick-file', 'data-arg': f, 'aria-pressed': f === s.file ? 'true' : 'false' } })}<span class="hubc-file__size">${FILES[f].length} B</span></li>`).join('');
    const strip = (STRIPPED[id] || STRIPPED['my-weekly']).map((x) => `<li>${badge('critical', '已移除')}<span><strong>${esc(x[0])}</strong> <span class="ap-mono">${esc(x[1])}</span></span></li>`).join('');
    const refRows = [`<li class="ap-dep"><div><strong>依据材料作答（示意）</strong> ${srcTag('hub')}</div>${badge('success', '仅引用 · 不随包提交')}</li>`];
    if (id === 'my-expense') refRows.push(`<li class="ap-dep"><div><strong>发票字段抽取（示意）</strong> ${srcTag('hub')}</div>${badge('success', '仅引用 · 不随包提交')}</li>`);
    bundled.forEach((b) => refRows.push(`<li class="ap-dep"><div><strong>${esc(b)}</strong> ${srcTag('bundled')}</div>${badge('attention', '将随智能体提交')}<small>你本机的技能，随这个智能体一起提交审核，只有它能使用。</small></li>`));
    const d = s.declared; const ok = d.source && /^\d+\.\d+\.\d+/.test(d.version || '') && d.terms && d.share && (bundled.length ? d.skills : true);
    return wrap(`<div class="hubc-preview-head hubc-section-head"><div><h2>提交预览</h2><p>下列内容会随这次贡献发给 Hub。实际提交与此逐项一致；预览之外的任何本机数据都不会发出。</p></div>${pill('success', '只读预览', true)}</div>
      <div class="hubc-preview"><section class="hubc-file-list" aria-label="将提交的文件"><div class="hubc-panel-head"><span>将提交的文件</span><span>${Object.keys(FILES).length} 个</span></div><ul>${fileRows}</ul><p class="hubc-panel-foot">已是处理后的最终副本</p></section>
        <section class="hubc-file-content" aria-label="文件内容" aria-live="polite"><div class="hubc-panel-head">${icon('file-text')}<strong>${esc(s.file)}</strong><span>只读</span></div><pre>${esc(FILES[s.file])}</pre></section></div>
      <section class="hubc-panel"><h2>这个智能体用到的技能</h2><p class="ap-meta">引用 Hub 技能不需要额外确认${bundled.length ? '；你本机的技能会随这个智能体一起提交' : ''}。</p><ul class="ap-deps">${refRows.join('')}</ul></section>
      <section class="hubc-panel"><h2>已在本机移除</h2><p class="ap-meta">这些字段已从提交副本中移除。你本机的智能体不变，Hub 也不会知道移除了什么。客户端只拦最明显的密钥格式（私钥、pem），其余内容请你在预览里自己确认。</p><ul class="ap-strip">${strip}</ul></section>
      <section class="hubc-panel"><h2>版本与声明</h2>
        <div class="hubc-declaration">${W.uiField({ id: 'ap-version', label: '版本号', required: true, requiredLabel: '必填', optionalLabel: '选填', hint: '语义化版本，例如 1.0.0。提交新版本时必须高于已发布的版本。', control: { kind: 'input', type: 'text', value: d.version || '', placeholder: '1.0.0', attrs: { 'data-act': 'decl-version' } } })}<div class="ui-field"><div class="ui-field__label-row"><span class="ui-field__label">来源声明</span><span class="ui-field__requirement">必填</span></div>
          ${W.uiSegmentedControl({ ariaLabel: '来源声明', value: d.source, items: [['original', '原创'], ['third', '基于第三方材料']].map((x) => ({ value: x[0], label: x[1], attrs: { 'data-act': 'decl-source', 'data-arg': x[0] } })) })}</div>
          ${W.uiField({ id: 'ap-origin-note', label: '来源说明', optionalLabel: '选填', requiredLabel: '必填', control: { kind: 'textarea', placeholder: '补充来源说明（选填）', attrs: { rows: 2 } } })}</div>
        <div class="hubc-check"><span class="hubc-check__control">${W.uiCheckbox({ id: 'ap-accept-terms', label: '接受条款', checked: d.terms, attrs: { 'data-act': 'decl-terms' } })}</span><label for="ap-accept-terms">我已阅读并接受《CogSeed 社区贡献条款》v1.0（示意）</label></div>
        <div class="hubc-check"><span class="hubc-check__control">${W.uiCheckbox({ id: 'ap-accept-share', label: '授权共享', checked: d.share, attrs: { 'data-act': 'decl-share' } })}</span><label for="ap-accept-share">我确认负责维护这个智能体。</label></div>
        ${bundled.length ? `<div class="hubc-check"><span class="hubc-check__control">${W.uiCheckbox({ id: 'ap-accept-skills', label: '随 Agent 提交技能', checked: d.skills, attrs: { 'data-act': 'decl-skills' } })}</span><label for="ap-accept-skills">这些技能也会同时贡献：${esc(bundled.join('、'))}（只能被这个智能体使用）。</label></div>` : ''}
        <p class="hubc-privacy">${icon('shield-check')}<span>连接器设置、模型偏好、安装状态和其他智能体都不会被发送。</span></p></section>
      <div class="hubc-submit-bar"><div><strong>提交后进入待审核</strong><span>${bundled.length ? '一次提交同时包含 Agent 和自建技能；' : ''}审核通过后仍需发布，才会进入 Hub 市场。</span></div><div class="hubc-submit-actions">${btn('提交审核', { role: 'primary', icon: 'upload', act: 'submit', disabled: !ok })}</div></div>`);
  }
  function finishSend() {
    const msg = $('#send-msg'); if (!msg) return;
    msg.textContent = '已完整到达。状态：待审核（绑定提交版本 1.0.0）。';
    later(() => { toast('已提交，进入待审核'); go('mine'); }, 900);
  }

  /* ================= 我的贡献（Agent 与 Skill 同页，类型切换） ================= */
  function vMine() {
    const F = { all: () => true, pending: (h) => h.st === 'pending', rejected: (h) => h.st === 'rejected', published: (h) => h.st === 'success' || h.st === 'review' };
    const TY = { all: () => true, agent: (h) => h.type === 'agent', skill: (h) => h.type === 'skill' };
    const list = HISTORY.filter(F[s.filter]).filter(TY[s.type]);
    const rows = list.map((h) => `<li class="hubc-row${h.id === s.sel ? ' is-selected' : ''}"><div class="hubc-row__name">${W.uiButton({ label: h.name, role: 'ghost', size: 'sm', attrs: { 'data-act': 'pick-hist', 'data-arg': h.id, 'aria-pressed': h.id === s.sel ? 'true' : 'false' } })}<small>${h.type === 'agent' ? '智能体' : '技能'} · ${esc(h.stable)}</small></div><div class="hubc-row__cell">${pill(h.st, h.stText)}<small>${esc(h.at)}</small></div><div class="hubc-row__cell">${esc(h.pub)}</div></li>`).join('');
    const h = HISTORY.find((x) => x.id === s.sel) || HISTORY[0];
    const acts = h.st === 'rejected' ? btn('修改并重提', { role: 'primary', act: 'open-resubmit' })
      : h.st === 'success' && h.type === 'agent' ? btn('提交新版本', { role: 'primary', act: 'contribute', arg: 'my-weekly' })
        : h.st === 'pending' ? btn('撤回待审核提交', { role: 'danger', act: 'toast', arg: '撤回待审核提交的口径待确认（原型不执行）' }) : '';
    const typeSwitch = W.uiSegmentedControl({ ariaLabel: '内容类型', value: s.type, items: [['all', '全部类型'], ['agent', '智能体'], ['skill', '技能']].map((x) => ({ value: x[0], label: x[1], attrs: { 'data-act': 'type', 'data-arg': x[0] } })) });
    const filters = W.uiSegmentedControl({ ariaLabel: '筛选贡献状态', value: s.filter, items: [['all', '全部'], ['pending', '待审核'], ['rejected', '已退回'], ['published', '通过/已发布']].map((x) => ({ value: x[0], label: x[1], attrs: { 'data-act': 'filter', 'data-arg': x[0] } })) });
    const n = (k) => HISTORY.filter(F[k]).length;
    return `<div class="hubc-page">${backline('我的贡献', 'agents', '返回智能体')}
      ${heading('我的贡献', '查看提交与审核状态。「通过审核」与「已发布可获取」是两件事。', btn('刷新', { icon: 'refresh', act: 'toast', arg: '已刷新（模拟）' }))}
      <div class="hubc-summary"><span><strong>${HISTORY.length}</strong>项贡献</span><span><strong>${n('pending')}</strong>待审核</span><span><strong>${n('published')}</strong>已通过/发布</span><small>最近同步 09:42</small></div>
      <div class="hubc-toolbar"><div class="ap-type-switch">${typeSwitch}${filters}</div></div>
      <div class="hubc-master"><section class="hubc-list" aria-label="贡献列表"><div class="hubc-list__head"><span>名称</span><span>最近提交</span><span>当前发布版本</span></div>${rows ? `<ul>${rows}</ul>` : W.uiEmptyState({ title: '没有匹配的贡献', hint: '调整筛选条件后再查看。' })}</section>
      <aside class="hubc-detail" aria-label="贡献详情"><h2>${esc(h.name)}</h2><span class="hubc-detail__id">${h.type === 'agent' ? '智能体' : '技能'} · ${esc(h.stable)} · 提交版本 ${esc(h.ver)}</span>${pill(h.st, h.stText)}
        <div class="hubc-block"><span>最近提交</span><strong>v${esc(h.ver)} · ${esc(h.at)}</strong><p>${esc(h.note)}</p></div><div class="hubc-detail__actions">${acts}</div></aside></div></div>`;
  }

  /* ================= 外壳：一级页 + 二级菜单 ================= */
  const TABS = [['agents', '智能体'], ['mcp', 'MCP与工具'], ['skills', '技能'], ['sources', '资料库'], ['touchpoints', 'IM']];
  function connectionsPage() {
    const tabs = TABS.map((t) => `<button type="button" class="connections-tab ui-tab${s.tab === t[0] ? ' is-active' : ''}" role="tab" aria-selected="${s.tab === t[0]}" tabindex="${s.tab === t[0] ? 0 : -1}" data-act="tab" data-arg="${t[0]}">${t[1]}</button>`).join('');
    let pane;
    if (s.tab !== 'agents') pane = `<div class="ap-inert-pane">「${esc(TABS.find((t) => t[0] === s.tab)[1])}」本期不改动，保持现有页面。</div>`;
    else {
      const inner = s.view === 'agent-detail' ? vAgentDetail() : s.view === 'contribute' ? `<div class="hubc-view" style="display:flex">${vContribute()}</div>` : s.view === 'mine' ? `<div class="hubc-view" style="display:flex">${vMine()}</div>` : vAgentsGrid();
      pane = `<div class="connections-tab-pane" id="connections-pane-agents"><section class="panel connections-embedded-panel" id="panel-agents">${inner}</section></div>`;
    }
    return `<section class="panel ui-resource-page active" id="panel-connections"><div class="app-top-drag-strip" aria-hidden="true"></div>
      <div id="connections-page-header">${W.uiPageHeader({ title: '智能体 / 技能 / 连接' })}</div>
      <div class="connections-container"><div class="connections-tabs ui-tabs" role="tablist" aria-label="智能体 / 技能 / 连接">${tabs}</div><div class="connections-body">${pane}</div></div></section>`;
  }

  /* 侧栏：最近任务 + 账号条（真实标记；账号条菜单含「退出登录 / 登录 Hub」） */
  function paintSidebar() {
    const list = $('#conversation-list');
    if (list && !list.innerHTML) list.innerHTML = [['项目周报整理', '2天'], ['调研材料核对', '2天'], ['技能说明优化', '3天']].map((c) => `<div class="conv-item"><div class="conv-item-row"><div class="conv-item-title">${esc(c[0])}</div><span class="conv-item-time">${esc(c[1])}</span></div></div>`).join('');
    const root = $('#hub-account-chip-root'); if (!root || !W.uiUserMenuTrigger) return;
    const signed = s.auth === 'in';
    const identity = signed ? { name: '雨萱', description: '个人工作空间', avatar: { text: '雨', variant: 'gradient' } } : { name: '本地用户', description: '个人工作空间', avatar: { text: '本', variant: 'gradient' } };
    const items = signed ? [{ action: 'sign-out', label: '退出登录', icon: 'log-out', danger: true, separatorBefore: true }] : [{ action: 'sign-in', label: '登录 Hub', icon: 'user', separatorBefore: true }];
    root.classList.toggle('is-open', s.menu);
    root.innerHTML = `${W.uiUserMenuTrigger({ id: 'hub-account-chip', open: s.menu, name: identity.name, description: identity.description, avatar: identity.avatar, ariaLabel: `用户菜单：${identity.name}` })}<div class="hub-chip-menu" id="hub-account-chip-menu" role="menu"${s.menu ? '' : ' hidden'}>${W.uiUserMenuPanel({ ...identity, items })}</div>`;
    if (W.hydrateUiIcons) W.hydrateUiIcons(root);
  }

  function render() {
    const main = $('#main-content');
    main.innerHTML = s.view === 'market' ? vMarket() : s.view === 'market-detail' ? vMarketDetail() : connectionsPage();
    if (W.hydrateUiIcons) W.hydrateUiIcons(document);
    try { parent.postMessage({ type: 'state', key: s.key }, '*'); } catch (e) { /* 独立打开时忽略 */ }
  }

  function go(key) {
    clearTimers(); closeDialog(); s.menu = false;
    let t = null;
    if (key === 'agents-installed-keep') { Object.assign(s, { key: 'agents', view: 'agents', scn: '', tab: 'agents' }); s.pending = null; }
    else {
      t = TOUR.find((x) => x.key === key);
      if (!t && key.startsWith('contribute-preview-')) { s.contrib = key.slice('contribute-preview-'.length); t = { ...TOUR.find((x) => x.key === 'contribute-preview'), contrib: s.contrib }; }
      if (t) {
        Object.assign(s, { key: t.key, view: t.view, scn: t.scn || '', agent: t.agent || s.agent, auth: t.auth || s.auth, tab: 'agents' });
        if (t.inst) t.inst.forEach((i) => s.inst.add(i));
        if (t.contrib) s.contrib = t.contrib;
        if (t.sel) s.sel = t.sel;
        if (t.key === 'contribute-preview' || t.key === 'contribute-blocked') { s.file = ''; s.declared = { source: '', terms: false, share: false, skills: false }; }
      } else { Object.assign(s, { key: '', view: key, scn: '', tab: 'agents' }); }
      s.pending = t;
    }
    try { history.replaceState(null, '', '?v=' + encodeURIComponent(s.key || key)); } catch (e) { /* 忽略 */ }
    render(); paintSidebar();
    if (t && t.modal === 'install') installDialog();
    if (t && t.modal === 'login') loginDialog();
    if (t && t.modal === 'resubmit') resubmitDialog();
    if (t && t.modal === 'task') taskDialog('报销材料预检助手');
    if (t && t.autorun) { later(() => runInstall(), 200); }
    if (t && t.scn === 'sending') {
      let p = 0;
      const tick = () => { const b = $('#send-bar'); if (!b) return; p += 18; b.innerHTML = W.uiProgressBar({ ariaLabel: '提交进度', value: Math.min(p, 100), max: 100 }); if (p < 100) later(tick, 350); else finishSend(); };
      later(tick, 300);
    }
  }

  /* ---------- 更新：真实路径是点「更新」→ 确认 → 失败，保留旧版 ---------- */
  function runUpdate() {
    const m = dialog('正在更新到 1.3.0', `<div id="up-bar">${W.uiProgressBar({ ariaLabel: '更新进度', value: 1, max: 3 })}</div><p class="ap-fine">正在获取新版本与依赖……运行中的任务不受影响。</p>`, [{ label: '取消', run: clearTimers }]);
    later(() => { const b = m.dialog.querySelector('#up-bar'); if (b) b.innerHTML = W.uiProgressBar({ ariaLabel: '更新进度', value: 2, max: 3 }); }, 700);
    later(() => { if (!m.dialog.isConnected) return; closeDialog(); s.scn = 'update-fail'; render(); toast('更新失败：已保留 1.2.0，仍可正常使用'); }, 1500);
  }

  /* ---------- 事件 ---------- */
  document.addEventListener('click', (e) => {
    const chipBtn = e.target.closest('#hub-account-chip');
    if (chipBtn) { s.menu = !s.menu; paintSidebar(); return; }
    const chipItem = e.target.closest('[data-chip-action]');
    if (chipItem) {
      const a = chipItem.getAttribute('data-chip-action'); s.menu = false;
      if (a === 'sign-out') dialog('退出登录', '<p>确定退出登录吗？本地数据不会受影响。</p>', [{ label: '取消' }, { label: '退出登录', role: 'danger', run: () => { s.auth = 'guest'; paintSidebar(); toast('已退出登录。再点自建 Agent 的「贡献」会提示登录。'); } }], 'sm');
      else { s.auth = 'in'; toast('已登录（模拟）'); }
      paintSidebar(); return;
    }
    if (s.menu && !e.target.closest('#hub-account-chip-root')) { s.menu = false; paintSidebar(); }
    const el = e.target.closest('[data-act]'); if (!el) return;
    const act = el.getAttribute('data-act'); const arg = el.getAttribute('data-arg');
    switch (act) {
      case 'tab': s.tab = arg; render(); break;
      case 'goto': { const t = TOUR.find((x) => x.view === arg && !x.scn && !x.modal && !x.autorun && !x.inst); go(t ? t.key : arg); break; }
      case 'cat': s.cat = arg; render(); break;
      case 'open-agent': Object.assign(s, { view: 'agent-detail', key: '', agent: arg, scn: '' }); render(); break;
      case 'open-market': Object.assign(s, { view: 'market-detail', key: '', agent: arg, scn: '' }); render(); break;
      case 'open-install': installDialog(); break;
      case 'use': taskDialog(NAMES[arg]); break;
      case 'contribute': s.contrib = arg; if (s.auth === 'guest') loginDialog(); else startContribute(arg); break;
      case 'pick-file': s.file = arg; render(); break;
      case 'decl-source': s.declared.source = arg; render(); break;
      case 'submit': go('sending'); break;
      case 'cancel-send': clearTimers(); toast('已取消提交，本地内容保留'); go('contribute-preview-' + s.contrib); break;
      case 'retry-send': toast('同一幂等键重试：已完整到达，未产生重复投稿'); go('sending'); break;
      case 'pick-hist': s.sel = arg; render(); break;
      case 'filter': s.filter = arg; render(); break;
      case 'type': s.type = arg; render(); break;
      case 'open-resubmit': resubmitDialog(); break;
      case 'toast': toast(arg); break;
      case 'update': dialog(s.scn === 'update-fail' ? '重试更新' : '更新到 1.3.0', s.scn === 'update-fail' ? '<p>上次更新失败，已保留 1.2.0。再次失败仍会保留旧版。</p>' : '<p>更新内容：新增住宿类规则，依赖 <span class="ap-mono">9b27f4a1c0e6</span> 升级到 ^2.2（将一并获取）。</p><p><strong>正在运行的 1 个任务继续使用 1.2.0，新任务才使用 1.3.0。</strong></p>', [{ label: '取消' }, { label: '确认更新', role: 'primary', run: runUpdate }]); break;
      case 'disable': dialog('停用 Agent', '<p>停用后将阻断<strong>新的</strong>使用；已在运行的任务保持当前版本。可随时恢复。</p>', [{ label: '取消' }, { label: '停用', role: 'primary', run: () => toast('已停用（原型不执行）') }]); break;
      case 'uninstall': dialog('卸载 Agent', '<p>将卸载此 Agent。<strong>不会删除其他 Agent 共用的 Skill</strong>：<span class="ap-mono">9b27f4a1c0e6</span>（报销制度预检，示意）仍被「差旅报销材料整理」使用，将保留。</p><p class="ap-fine">卸载后不会被自动装回。</p>', [{ label: '取消' }, { label: '卸载', role: 'danger', run: () => toast('已卸载，共用 Skill 保留（原型不执行）') }]); break;
      case 'convert': dialog('转为我的版本', '<p>将生成一份属于你的副本，之后<strong>不会被远程更新或停用修改</strong>。原社区版本不受影响。</p>', [{ label: '取消' }, { label: '转为我的版本', role: 'primary', run: () => toast('已转为我的版本（原型不执行）') }]); break;
      default: break;
    }
  });
  document.addEventListener('change', (e) => {
    const el = e.target.closest('input[data-act]'); if (!el) return;
    const act = el.getAttribute('data-act');
    if (act === 'decl-terms') s.declared.terms = el.checked;
    if (act === 'decl-share') s.declared.share = el.checked;
    if (act === 'decl-skills') s.declared.skills = el.checked;
    if (act === 'decl-version') s.declared.version = el.value;
    render();
  });
  const announce = () => { try { parent.postMessage({ type: 'ready', tour: TOUR.map((t) => ({ key: t.key, label: t.label, group: t.group || 'other' })) }, '*'); parent.postMessage({ type: 'state', key: s.key }, '*'); } catch (e) { /* 独立打开时忽略 */ } };
  window.addEventListener('message', (e) => { const d = e.data || {}; if (d.type === 'go') go(d.key); else if (d.type === 'hello') announce(); });

  window.addEventListener('DOMContentLoaded', () => {
    paintSidebar();
    if (W.hydrateUiIcons) W.hydrateUiIcons(document);
    const q = new URLSearchParams(location.search).get('v');
    go(q && TOUR.some((t) => t.key === q) ? q : 'agents');
    announce();
  });
})();
