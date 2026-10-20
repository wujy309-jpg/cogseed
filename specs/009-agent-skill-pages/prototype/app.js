/* S4 · 智能体 / 技能页面改版 —— 客户端侧高保真原型（里层页面），v0.4（2026-10-18 会议 #2 结论）。
   结构对照客户端真实页面：一级侧栏 → 「智能体 / 技能 / 连接」页 → 二级菜单（智能体 / MCP与工具 / 技能 / 资料库 / IM）。
   本期只改「智能体」「技能」两项内部；其余二级菜单保持现状，原型里只显示「本期不改动」。
   样式全部来自客户端真实 CSS，控件来自客户端 ui*.js 组件工厂（见 app.html）。
   v0.4 的页面分工：
     · 智能体首页 = 主智能体 / 外接智能体 / 平台（全部来自 Hub 分发；原随包内置的迁移为「已安装」，与用户装的一致）
     · 技能首页   = 平台（同上）；没有其他分组
     · 安装 / 使用：没装过的平台内容按钮叫「安装」（安装中… → 变「使用」，留在原处）；详情里直接点示例 = 先安装再发送（一步）
     · 我的智能体 = 只放用户自己创建的；我的技能 = 一个网格，卡片标「自定义 / 本机已有」，顶部按来源筛选（本机已有 = 外部包 + 全局文件夹，只读）；自建可「贡献」；「我的」页工具栏有「我的贡献」（首页不再重复放）
     · 我的贡献 = 照客户端现有页面（hub-contributions.js renderMine）：汇总、类型 / 状态筛选、搜索、列表 + 详情
     · 已安装的智能体 / 技能（原「管理」）= 只放从平台安装的：停用 / 启用、卸载；本机已有的技能在「我的技能」里管（一样东西只放一处）
     · 不再区分「客户端自带」：D-11 已关闭
     · 停用有依赖的技能：先列出会受影响的智能体再确认；停用后智能体标「依赖已停用」、「使用」与示例不可点（与 S3 平台停用一致），详情里可一键启用该技能
     · 有更新：卡片 / 已安装行标「有更新」，详情底部「更新到 vX」；失败保留旧版
     · 未登录：本机内容照常；平台组只显示已安装的并提示登录；安装、贡献先要求登录
     · 断网 / Hub 不可用：只显示已安装的，不做兜底（服务器故障属运维范畴）
     · 不展示「N 万人在用」（本期只采集，不展示）
   外层导览条仅评审用，真实客户端里没有。
   全部为内存模拟数据：不接 IPC、账号、Hub；刷新会重置。名称、版本、示例均为示意，须与 Hub 端确认真实字段。 */
(function () {
  'use strict';

  const W = window;
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = (sel) => document.querySelector(sel);
  const btn = (label, o) => {
    const x = o || {};
    return W.uiButton({ label, role: x.role || 'secondary', size: x.size || 'md', icon: x.icon, disabled: x.disabled, loading: x.loading, className: x.cls, attrs: { 'data-act': x.act, 'data-arg': x.arg, id: x.id, title: x.title } });
  };
  const chip = (t, extra) => `<span class="agent-card-chip${extra ? ' ' + extra : ''}">${esc(t)}</span>`;
  const schip = (t) => `<span class="skill-card-chip">${esc(t)}</span>`;
  const note = (kind, title, body) => {
    const inner = `<p><strong>${esc(title)}</strong></p>${body ? `<p>${esc(body)}</p>` : ''}`;
    return kind === 'warn' ? `<div class="hubc-alert" role="status">${inner}</div>` : `<div class="ap-note ap-note--${kind}" role="status">${inner}</div>`;
  };
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, 3200); }
  function avatar(tone, px, iconName) {
    const c = { green: ['#E2F5EC', '#0A7A55'], blue: ['#E4EEF9', '#355D89'], peach: ['#FBEBDD', '#8A5A14'], lilac: ['#EEE7F8', '#6A4FA3'] }[tone || 'green'];
    return `<span class="avatar-circle agent-card-avatar" style="--avatar-bg:${c[0]};--avatar-fg:${c[1]};width:${px || 32}px;height:${px || 32}px">${W.uiIconHtml(iconName || 'sparkles', '').replace('<svg ', `<svg width="${Math.round((px || 32) * ((px || 32) >= 64 ? 0.44 : 0.56))}" height="${Math.round((px || 32) * ((px || 32) >= 64 ? 0.44 : 0.56))}" `)}</span>`;
  }
  const skillAvatar = (name) => `<span class="skill-card-avatar" aria-hidden="true">${esc(Array.from(String(name).trim())[0] || '?')}</span>`;

  /* ---------- 导览（里层是唯一数据源）---------- */
  const TOUR = [
    { key: 'agents', label: '智能体 · 首页', group: 'main', tab: 'agent', view: 'home' },
    { key: 'agent-detail', label: '详情弹窗', group: 'main', tab: 'agent', view: 'home', detail: 'hub-weekly-agent' },
    { key: 'agents-mine', label: '我的智能体', group: 'main', tab: 'agent', view: 'mine' },
    { key: 'agents-manage', label: '已安装的智能体', group: 'main', tab: 'agent', view: 'manage' },
    { key: 'skills', label: '技能 · 首页', group: 'main', tab: 'skill', view: 'home' },
    { key: 'skills-mine', label: '我的技能', group: 'main', tab: 'skill', view: 'mine' },
    { key: 'contributions', label: '我的贡献', group: 'main', tab: 'agent', view: 'contrib' },
    { key: 'create', label: '创建智能体', group: 'main', tab: 'agent', view: 'mine', modal: 'create' },
    { key: 'loading', label: '首页加载中', group: 'edge', tab: 'agent', view: 'home', phase: 'loading' },
    { key: 'offline', label: '获取失败（断网）', group: 'edge', tab: 'agent', view: 'home', phase: 'error' },
    { key: 'install-fail', label: '安装失败', group: 'edge', tab: 'agent', view: 'home', failInstall: true },
    { key: 'empty', label: '平台暂无更多内容', group: 'edge', tab: 'agent', view: 'home', phase: 'empty' },
    { key: 'update', label: '有更新', group: 'main', tab: 'agent', view: 'home', detail: 'hub-weekly-agent' },
    { key: 'disable-dep', label: '停用有依赖的技能', group: 'main', tab: 'skill', view: 'manage', autoToggle: 'b-summary' },
    { key: 'dep-off', label: '依赖已停用', group: 'edge', tab: 'agent', view: 'home', detail: 'pre-meeting-minutes', skillOff: ['b-summary'] },
    { key: 'update-fail', label: '更新失败', group: 'edge', tab: 'agent', view: 'home', detail: 'hub-weekly-agent', failUpdate: true },
    { key: 'logged-out', label: '未登录', group: 'main', tab: 'agent', view: 'home', auth: 'out' },
    { key: 'skills-manage', label: '已安装的技能', group: 'main', tab: 'skill', view: 'manage' },
    { key: 'skills-contributions', label: '我的贡献（从技能进入）', tab: 'skill', view: 'contrib' },
    { key: 'detail-uninstalled', label: '详情 · 未安装', tab: 'agent', view: 'home', detail: 'hub-resume-site' },
    { key: 'detail-builtin', label: '详情 · 已安装（老用户迁移来的）', tab: 'agent', view: 'home', detail: 'b-compliance' },
    { key: 'detail-disabled', label: '详情 · 已停用', tab: 'agent', view: 'home', detail: 'pre-project-review' },
    { key: 'detail-own', label: '详情 · 自建', tab: 'agent', view: 'mine', detail: 'c-analyst' },
    { key: 'detail-external', label: '详情 · 外接', tab: 'agent', view: 'home', detail: 'x-codex' },
  ];

  /* ---------- 模拟数据 ----------
     id 前缀即来源（仅原型内部用来决定交互，界面上不区分平台内容的来源）：
     m- 主智能体；x- 外接；hub- / b- / pre- 都是 Hub 分发（b- 原随包内置、pre- 原默认安装，老用户升级后迁移为「已安装」，可停用、卸载）；
     c- 用户创建；g- 本机全局文件夹扫描到的技能；p- 外部包（客户端 open-tier，与全局文件夹同组）。 */
  const ex = (list) => list.map((prompt) => ({ prompt }));
  const KIND = {
    agent: {
      label: '智能体', mine: '我的智能体', cats: [['all', '全部'], ['通用', '通用'], ['业务', '业务'], ['产研', '产研']],
      help: '一句话说明它做什么，作为工作流程的生成依据。确认后可在管理工作台继续编辑。',
      commander: [{ id: 'm-cogseed', name: 'cogseed', cat: '通用', tone: 'green', desc: '理解目标、拆解工作，并选择智能体、技能与工具完成任务。', does: [], examples: ex(['帮我规划这周的工作并拆成任务。', '把这份需求拆成可以分配的任务清单。']) }],
      hub: [
        { id: 'hub-weekly-agent', name: '周报助手', cat: '通用', ver: '1.0.4', tone: 'blue', desc: '根据本周的任务和产出，生成结构清晰的周报并标出风险。', tags: ['周报', '风险提示'], examples: ex(['根据本周的任务，帮我写一份周报，标出风险。', '把上周的周报和这周的合并，指出进度变化。', '根据周报内容，起草一段给领导的简短汇报。']), skills: '周报生成' },
        { id: 'b-compliance', name: '合规审阅员', cat: '业务', ver: '1.0.0', tone: 'blue', desc: '对照制度条款审阅业务材料，列出需复核的差异及其依据。', examples: ex(['对照公司制度审阅这份合同，列出差异。']) },
        { id: 'pre-meeting-minutes', name: '会议纪要助手', cat: '通用', ver: '1.2.0', tone: 'green', desc: '把会议转写整理成议题、决定和待办，标出责任人与截止时间。', tags: ['会议整理', '待办提取', '纪要'], examples: ex(['帮我把今天的会议整理成纪要，列出决定和待办。', '从这段会议记录里提取待办事项，按责任人分组。', '根据这次会议的结论，写一封发给参会人的跟进邮件。']), skills: '会议纪要、文档摘要' },
        { id: 'pre-project-review', name: '项目材料审阅', cat: '业务', ver: '1.1.0', tone: 'green', desc: '梳理项目材料，识别待补充事项，整理复核依据。', tags: ['材料核验', '待补充事项'], examples: ex(['请审阅我提供的项目材料，列出异常清单和来源。']), skills: '文档摘要、数据质量核验' },
        { id: 'hub-contract-review', name: '合同审阅助手', cat: '业务', ver: '1.0.1', tone: 'peach', desc: '抽取合同关键条款，标出风险点并给出修改建议。', tags: ['合同', '风险点'], examples: ex(['请审阅这份合同，标出风险点。', '对比这两个版本的合同，列出差异条款。']), skills: '文档摘要' },
        { id: 'hub-resume-site', name: '简历与个人主页生成器', cat: '通用', ver: '1.0.2', tone: 'blue', desc: '根据你的经历生成简历，并一键做成可分享的个人主页。', tags: ['简历', '个人主页'], examples: ex(['根据我提供的经历，帮我生成一份应聘产品经理的简历。']), skills: '文档摘要' },
        { id: 'hub-expense', name: '报销助手', cat: '业务', ver: '0.9.1', tone: 'peach', desc: '核对票据与报销规则，整理报销明细并提示缺少的材料。', tags: ['票据核对', '报销明细'], examples: ex(['帮我整理本月的报销票据，列出明细和缺少的材料。']), skills: '表格整理、数据质量核验' },
        { id: 'hub-code-review', name: '代码评审助手', cat: '产研', ver: '1.3.0', tone: 'lilac', desc: '阅读改动，指出潜在问题并给出可执行的修改建议。', tags: ['代码评审', '测试建议'], examples: ex(['请评审当前工作目录里的改动，指出风险和需要补的测试。']), skills: '' },
      ],
      custom: [
        { id: 'c-analyst', name: '项目分析师', cat: '业务', tone: 'green', desc: '核对项目材料与报告口径，整理待补材料，输出可复核的项目分析意见。', examples: [] },
        { id: 'c-ops', name: '经营分析师', cat: '业务', tone: 'peach', desc: '汇总运营指标，核对变化原因并生成进展简报。', examples: [] },
      ],
      local: { title: '外接智能体', items: [{ id: 'x-codex', name: 'Codex', cat: '产研', tone: 'lilac', desc: '接入本机 Codex，在项目目录中实现功能、修复问题与重构代码。', examples: [] }] },
    },
    skill: {
      label: '技能', mine: '我的技能', cats: [['all', '全部'], ['通用', '通用'], ['文档处理', '文档处理'], ['数据分析', '数据分析']],
      help: '一句话说明技能要完成的工作。确认后可继续编辑使用说明。',
      commander: [],
      hub: [
        { id: 'b-summary', security: '通过', name: '文档摘要', cat: '文档处理', ver: '1.0.0', desc: '提取长文档的核心结论、关键数字与引用位置。', does: ['提取核心结论与引用位置'], examples: ex(['使用文档摘要，概括这份文档。', '提炼这份报告的三个核心结论。']) },
        { id: 'b-table-check', security: '通过', name: '表格核对', cat: '数据分析', ver: '1.0.0', desc: '核对汇总口径、异常数值和明细之间的对应关系。', does: ['核对汇总与明细'], examples: ex(['使用表格核对，检查这张表。', '核对这张表的合计和明细是否一致。']) },
        { id: 'pre-meeting-notes', security: '通过', name: '会议纪要', cat: '文档处理', ver: '1.0.0', desc: '将会议材料整理为议题、决定与行动清单。', does: ['按议题归并发言', '记录决定、责任人和截止时间', '保留尚未确定的事项'], examples: ex(['使用会议纪要，把我提供的会议记录整理成议题、决定和行动清单。', '把这段会议记录整理成行动清单。']) },
        { id: 'pre-weekly-report', security: '通过', name: '周报生成', cat: '通用', ver: '1.1.0', desc: '根据本周的任务和产出生成结构清晰的周报。', does: ['汇总本周完成的工作', '标出风险和下周计划', '按固定格式输出'], examples: ex(['使用周报生成，根据本周的任务整理一份周报。', '根据这周的任务，列出下周计划。']) },
        { id: 'hub-mail-polish', security: '通过', name: '邮件润色', cat: '通用', ver: '1.0.2', desc: '把邮件草稿改得更得体、更简洁，保留原意。', does: ['调整语气', '精简冗余', '保留原意'], examples: ex(['使用邮件润色，把这封邮件改得更简洁得体。', '把这封邮件改得更客气一些，别太生硬。']) },
        { id: 'hub-ocr', security: '通过', name: 'OCR 文字识别', cat: '文档处理', ver: '1.3.0', desc: '识别图片和扫描件里的文字，输出可编辑文本。', does: ['识别图片文字', '保留段落结构', '输出可编辑文本'], examples: ex(['使用 OCR 文字识别，把这张图片里的文字提取出来。', '把这张发票截图里的文字提取出来。']) },
        { id: 'hub-data-validation', security: '通过', name: '数据质量核验', cat: '数据分析', ver: '1.4.0', desc: '检查缺失值、重复记录和汇总口径。', does: ['找出缺失与重复数据', '核对汇总与明细是否对得上', '输出异常清单及来源'], examples: ex(['使用数据质量核验，检查我提供的表格，列出异常和来源。', '核对这份报表的汇总数和明细是否一致。']) },
        { id: 'hub-table-format', security: '通过', name: '表格整理', cat: '数据分析', ver: '1.0.3', desc: '统一表头与格式，把零散的表格整理成可对比的一张表。', does: ['统一表头和单位', '合并多张结构相近的表', '保留原始文件不改动'], examples: ex(['使用表格整理，把这几张表合并成一张并统一表头。', '把这个文件夹里的几张销售表整理成一张。']) },
        { id: 'hub-doc-convert', security: '通过', name: '文档格式转换', cat: '文档处理', ver: '2.0.0', heavy: true, desc: '在常见办公文档格式之间转换，并尽量保留排版。', does: ['在 Word、PDF、Markdown 之间转换', '保留标题层级与表格', '批量处理多个文件'], examples: ex(['使用文档格式转换，把这份文档转成 PDF。', '把这几份 Word 文档批量转成 Markdown。']) },
      ],
      custom: [
        { id: 'c-caliber', security: '通过', name: '项目报告口径核验', cat: '数据分析', desc: '核对报表期间、币种与合并范围，列出差异和需要补充的依据。', examples: [] },
        { id: 'c-list', security: '待检查', name: '调研材料清单', cat: '文档处理', desc: '按项目材料清单检查缺失项，形成补件清单。', examples: [] },
      ],
      local: { title: '本机已有', items: [
        { id: 'p-pdf-toolkit', name: 'PDF 工具包', pkg: 'github.com/acme/pdf-toolkit · 技能包', skillCount: 3, cat: '文档处理', desc: '外部包提供的 3 项技能：PDF 合并、拆分、加水印。', examples: [] },
        { id: 'p-gh-helper', name: 'gh-helper', pkg: 'github.com/acme/gh-helper · 命令行工具', skillCount: 1, cat: '通用', desc: '命令行工具包；CogSeed 自动生成了 1 份使用说明技能。', examples: [] },
        { id: 'g-report', name: 'report', root: '~/.claude/skills', cat: '文档处理', desc: '2 项报告技能：报告提纲、报告复核。', examples: [] },
        { id: 'g-frontend-design', name: 'frontend-design', root: '~/.codex/skills', cat: '通用', desc: '前端界面设计规范：配色、排版与交互细节。', examples: [] },
      ] },
    },
  };

  /** 已安装：用户装的 hub-weekly-agent，加上老用户升级时迁移过来的原随包内容（b- / pre-），一律当作从平台安装的。 */
  const initInst = () => ({ agent: new Set(['hub-weekly-agent', 'b-compliance', 'pre-meeting-minutes', 'pre-project-review']), skill: new Set(['b-summary', 'b-table-check', 'pre-meeting-notes', 'pre-weekly-report']) });
  const initOff = () => ({ agent: new Set(['pre-project-review', 'c-ops']), skill: new Set() });
  const s = {
    key: 'agents', tab: 'agent', view: 'home', cat: 'all', q: '', phase: 'ready', failInstall: false,
    inst: initInst(), off: initOff(),
    busy: null, err: null, tried: {}, loaded: { agent: false, skill: false },
    created: { agent: { custom: [], external: [] }, skill: { custom: [] } },
    modal: null, timers: [], draft: null,
    contrib: { type: 'all', filter: 'all', q: '', selected: null }, mineSrc: 'all',
    /** 本地技能：全局文件夹总开关（对应客户端设置 global_skill_roots_enabled）与已移除的外部包 */
    globalOn: true, removed: new Set(),
    auth: 'in', upd: null, ver: { agent: {}, skill: {} }, updating: null, updErr: null, failUpdate: false, triedUpd: {},
  };
  /** 有新版本的已安装内容（示意）：id → 新版本号 */
  const initUpd = () => ({ agent: new Map([['hub-weekly-agent', '1.1.0'], ['pre-meeting-minutes', '1.3.0']]), skill: new Map([['b-summary', '1.1.0']]) });
  s.upd = initUpd();
  const customAll = (k) => [...KIND[k].custom, ...s.created[k].custom];
  const localAll = (k) => (k === 'agent' ? [...KIND.agent.local.items, ...s.created.agent.external]
    : KIND.skill.local.items.filter((it) => !s.removed.has(it.id) && (s.globalOn || !it.id.startsWith('g-'))));
  const find = (k, id) => [...KIND[k].commander, ...KIND[k].hub, ...customAll(k), ...localAll(k)].find((x) => x.id === id);
  const originOf = (id) => (id.startsWith('m-') ? 'commander' : /^(hub|b|pre)-/.test(id) ? 'hub' : id.startsWith('x-') ? 'external' : id.startsWith('g-') ? 'global' : id.startsWith('p-') ? 'package' : id.startsWith('c-') ? 'own' : 'platform');
  const isOn = (k, id) => !s.off[k].has(id);
  const isInst = (k, id) => s.inst[k].has(id);
  /** 已在本机、可直接用：除「还没安装的 Hub 内容」以外的一切。 */
  const isLocal = (k, id) => originOf(id) !== 'hub' || isInst(k, id);
  /** 「我的」：智能体只有自建；技能另含「来自包和全局文件夹」。 */
  const mineCount = (k) => customAll(k).length + (k === 'skill' ? localAll(k).length : 0);
  const verOf = (k, it) => s.ver[k][it.id] || it.ver;
  const hasUpdate = (k, id) => isInst(k, id) && s.upd[k].has(id);
  const skillByName = (n) => KIND.skill.hub.find((x) => x.name === n);
  /** 智能体依赖的技能里，被用户停用的那些 */
  const depOffSkills = (it) => (it && it.skills ? it.skills.split('、') : []).map(skillByName).filter((sk) => sk && !isOn('skill', sk.id));
  /** 已安装的智能体里，会用到某个技能的那些 */
  const dependents = (skillId) => { const sk = find('skill', skillId); return sk ? KIND.agent.hub.filter((a) => isInst('agent', a.id) && a.skills && a.skills.split('、').includes(sk.name)) : []; };
  const loggedOut = () => s.auth === 'out';
  const installedHub = (k) => KIND[k].hub.filter((h) => isInst(k, h.id));
  /** 「已安装的…」页的条数：只算从平台安装的 */
  const installedCount = (k) => installedHub(k).length;
  function clearTimers() { s.timers.forEach(clearTimeout); s.timers = []; }
  function later(fn, ms) { s.timers.push(setTimeout(fn, ms)); }
  function closeDialog() { if (s.modal) { s.modal.close(null, 'code'); s.modal = null; } }
  function dialog(title, bodyHtml, actions, size, extra) {
    closeDialog();
    const acts = actions || [];
    const m = W.uiModal({ ...(extra || {}), title, bodyHtml, size: size || 'md', closeLabel: '关闭', actions: acts.map((a, i) => ({ id: String(i), label: a.label, role: a.role || 'secondary' })) });
    s.modal = m;
    m.then((r) => { if (s.modal === m) s.modal = null; if (r && r.reason === 'action') { const a = acts[Number(r.value)]; if (a && a.run) a.run(); } });
    return m;
  }
  const matches = (k, it) => {
    const q = s.q.trim().toLowerCase();
    return (s.cat === 'all' || it.cat === s.cat) && (!q || `${it.name} ${it.desc}`.toLowerCase().includes(q));
  };

  /* ================= 首页 ================= */
  /** 卡片和详情共用一个按钮状态机：安装（没装过）→ 安装中… → 失败可重试；装好后 / 本机已有：使用。 */
  function useButton(k, it, o) {
    const x = o || {}, busy = s.busy === it.id, failed = s.err && s.err.id === it.id;
    if (busy) return btn('安装中…', { role: 'primary', size: x.size, loading: true, disabled: true });
    if (failed) return btn(x.retryLabel || '重试', { role: 'primary', size: x.size, act: 'install', arg: it.id });
    if (!isLocal(k, it.id)) return btn(x.installLabel || '安装', { role: 'primary', size: x.size, cls: x.cls, act: 'install', arg: it.id });
    const blocked = k === 'agent' && depOffSkills(it).length > 0;
    return btn(x.label || '使用', { role: 'primary', size: x.size, icon: x.icon, cls: x.cls, act: 'use', arg: it.id, disabled: !isOn(k, it.id) || blocked, title: blocked ? '依赖的技能已停用，启用后才能使用' : undefined });
  }
  function platformCard(k, it) {
    const failed = s.err && s.err.id === it.id, off = !isOn(k, it.id);
    const depOff = k === 'agent' && isInst(k, it.id) && depOffSkills(it).length;
    const status = failed ? W.uiStatusPill({ label: '安装失败，可重试', tone: 'attention' }) : off ? W.uiStatusPill({ label: '已停用', tone: 'neutral' })
      : depOff ? W.uiStatusPill({ label: '依赖已停用', tone: 'attention' }) : hasUpdate(k, it.id) ? W.uiStatusPill({ label: '有更新', tone: 'success' }) : '';
    return `<div class="marketplace-card ui-resource-card${off ? ' ap-card-off' : ''}" data-id="${esc(it.id)}" data-act="detail" data-arg="${esc(it.id)}">
      <div class="marketplace-card-header">${k === 'agent' ? avatar(it.tone) : skillAvatar(it.name)}<span class="marketplace-card-name">${esc(it.name)}</span></div>
      <div class="marketplace-card-desc">${esc(it.desc)}</div>
      <div class="marketplace-card-footer"><div class="marketplace-card-meta">${status}<span class="marketplace-card-chip">${esc(it.cat)}</span></div>
        <div class="marketplace-card-actions">${useButton(k, it, { size: 'sm' })}</div></div></div>`;
  }
  /** 主智能体、外接智能体、本机已有技能：沿用客户端现有卡片。 */
  function localCard(k, it, tag) {
    const off = !isOn(k, it.id);
    if (k === 'skill') {
      return `<div class="skill-card ui-resource-card${off ? ' is-disabled' : ''}" data-id="${esc(it.id)}" data-act="detail" data-arg="${esc(it.id)}">
        <div class="skill-card-header">${skillAvatar(it.name)}<span class="skill-card-name">${esc(it.name)}</span></div>
        ${it.pkg ? `<div class="skill-card-meta">${esc(it.pkg)}</div>` : ''}<div class="skill-card-desc">${esc(it.desc)}</div>
        <div class="skill-card-actions">${schip(it.cat)}${tag ? schip(tag) : ''}${off ? schip('已停用') : ''}${useButton(k, it, { size: 'sm', cls: 'skill-card-use' })}</div></div>`;
    }
    return `<div class="agent-card ui-resource-card${off ? ' is-disabled' : ''}" data-id="${esc(it.id)}">
      <button type="button" class="agent-card-open" data-act="detail" data-arg="${esc(it.id)}" aria-label="查看：${esc(it.name)}"></button>
      <div class="agent-card-header">${avatar(it.tone)}<div class="agent-card-title"><span class="agent-card-name">${esc(it.name)}</span><span class="agent-card-meta">${chip(it.cat)}</span></div></div>
      <div class="agent-card-desc">${esc(it.desc)}</div>
      <div class="agent-card-actions">${tag ? chip(tag) : ''}${off ? chip('已停用') : ''}${useButton(k, it, { size: 'sm', cls: 'agent-card-use' })}</div></div>`;
  }
  /** 平台：全部来自 Hub 分发，不标来源。排序：已安装的 → 还没安装的。 */
  function platformItems(k) {
    const d = KIND[k];
    const keep = (h) => isInst(k, h.id) || s.busy === h.id || (s.err && s.err.id === h.id);
    const hubVisible = loggedOut() ? d.hub.filter((h) => isInst(k, h.id)) : s.phase === 'ready' ? d.hub : s.phase === 'error' ? d.hub.filter(keep) : d.hub.filter((h) => isInst(k, h.id));
    const got = hubVisible.filter((h) => isInst(k, h.id)), notYet = hubVisible.filter((h) => !isInst(k, h.id));
    return [...got, ...notYet].filter((it) => matches(k, it));
  }
  function section(k, title, cards, extra) {
    const pre = k === 'skill' ? 'skills' : 'agents';
    if (!cards.length && !extra) return '';
    return `<section class="${pre}-source-section" data-group="${esc(title)}"><div class="${pre}-source-section-head">${esc(title)} · ${cards.length}</div>
      <div class="${pre}-source-section-grid ui-resource-grid">${cards.join('')}${extra || ''}</div></section>`;
  }
  function gridHtml(k) {
    const d = KIND[k];
    const commander = d.commander.filter((it) => matches(k, it)).map((it) => localCard(k, it));
    // 技能的「来自包和全局文件夹」是用户本机的，不在首页，放进「我的技能」
    const local = k === 'agent' ? localAll(k).filter((it) => matches(k, it)).map((it) => localCard(k, it, '外接')) : [];
    const platform = platformItems(k).map((it) => platformCard(k, it));
    const skeleton = s.phase === 'loading' ? [0, 1, 2].map(() => `<div class="marketplace-card ui-resource-card">${W.uiSkeleton({ ariaLabel: '正在获取平台内容', withMedia: true, lines: [48, 100, 86] })}</div>`).join('') : '';
    if (!commander.length && !local.length && !platform.length && !skeleton) {
      return W.uiEmptyState({ kind: 'actionable', title: `没有匹配的${d.label}`, action: { label: '清除筛选', attrs: { 'data-act': 'clear' } } });
    }
    const emptyNote = s.phase === 'empty' ? `<p class="ap-fine" id="ap-empty-note">平台暂时没有更多可安装的${d.label}，以上是你已安装的。</p>` : '';
    const platformSec = section(k, '平台', platform, skeleton) + emptyNote;
    const html = k === 'agent'
      ? section(k, '主智能体', commander) + section(k, d.local.title, local) + platformSec
      : platformSec;
    return `<div class="agents-grid ui-resource-grid is-sectioned">${html}</div>`;
  }
  function vHome(k) {
    const d = KIND[k];
    return `<div class="agents-grid-view" id="agents-grid-view">
      <div class="agents-resource-toolbar">
        <div class="marketplace-categories agents-categories">${W.uiSegmentedControl({ ariaLabel: `${d.label}分类`, value: s.cat, items: d.cats.map((x) => ({ value: x[0], label: x[1], attrs: { 'data-act': 'cat', 'data-arg': x[0] } })) })}</div>
        <div class="agents-resource-toolbar-controls"><div class="agents-search-field">${W.uiIconHtml('search', 'agents-search-icon')}${W.uiInput({ id: 'ap-search', type: 'search', placeholder: `搜索${d.label}`, value: s.q, attrs: { 'aria-label': `搜索${d.label}`, autocomplete: 'off' } })}</div>
          <div class="header-actions">${btn(`${d.mine} · ${mineCount(k)}`, { act: 'mine' })}${btn(`已安装的${d.label} · ${installedCount(k)}`, { act: 'to-manage' })}</div></div></div>
      ${s.phase === 'error' ? `<div class="ap-top-note" id="ap-hub-note">${note('warn', '暂时无法获取平台内容', '已安装的仍可使用。')}<div class="ap-top-note__action">${btn('重试', { size: 'sm', act: 'retry' })}</div></div>` : ''}
      ${loggedOut() ? `<div class="marketplace-reconcile-banner ap-banner" id="ap-login-note" role="status"><span>登录后可以查看和安装更多平台${d.label}；已安装的照常可用。</span>${btn('登录', { size: 'sm', act: 'login' })}</div>` : ''}
      <div class="agents-grid-scroll" id="ap-grid">${gridHtml(k)}</div></div>`;
  }

  /* ================= 我的：只放自己创建的 ================= */
  function ownCard(k, it) {
    const off = !isOn(k, it.id);
    const contribute = btn('贡献', { size: 'sm', cls: k === 'skill' ? 'skill-card-contribute' : 'agent-card-contribute', act: 'contribute', arg: it.id, title: '贡献到 Hub' });
    if (k === 'skill') {
      return `<div class="skill-card ui-resource-card${off ? ' is-disabled' : ''}" data-id="${esc(it.id)}" data-act="detail" data-arg="${esc(it.id)}">
        <div class="skill-card-header">${skillAvatar(it.name)}<span class="skill-card-name">${esc(it.name)}</span></div>
        <div class="skill-card-desc">${esc(it.desc)}</div>
        <div class="skill-card-actions">${schip(it.cat)}${schip('自定义')}${off ? schip('已停用') : ''}${contribute}${useButton(k, it, { size: 'sm', cls: 'skill-card-use' })}</div></div>`;
    }
    return `<div class="agent-card ui-resource-card${off ? ' is-disabled' : ''}" data-id="${esc(it.id)}">
      <button type="button" class="agent-card-open" data-act="detail" data-arg="${esc(it.id)}" aria-label="查看：${esc(it.name)}"></button>
      <div class="agent-card-header">${avatar(it.tone)}<div class="agent-card-title"><span class="agent-card-name">${esc(it.name)}</span><span class="agent-card-meta">${chip(it.cat)}</span></div></div>
      <div class="agent-card-desc">${esc(it.desc)}</div>
      <div class="agent-card-actions">${off ? chip('已停用') : ''}${contribute}${useButton(k, it, { size: 'sm', cls: 'agent-card-use' })}</div></div>`;
  }
  function mineGridHtml(k) {
    const label = KIND[k].label, q = s.q.trim(), list = customAll(k).filter((it) => matches(k, it));
    const createEmpty = () => W.uiEmptyState({ kind: 'explained', title: `还没有创建${label}`, hint: '点右上角“+ 创建”开始；创建后可以贡献到平台。' });
    if (k === 'skill') {
      // 一个网格：自定义（可贡献）+ 本机已有（外部包、全局文件夹，只读）；顶部按来源筛选
      const src = s.mineSrc;
      const own = src === 'local' ? [] : list.map((it) => ownCard(k, it));
      const local = src === 'custom' ? [] : localAll(k).filter((it) => matches(k, it)).map((it) => localCard(k, it, '本机已有'));
      if (!own.length && !local.length) {
        if (q) return W.uiEmptyState({ kind: 'explained', title: '没有匹配的内容', hint: '换个关键词试试。' });
        return src === 'local' ? W.uiEmptyState({ kind: 'explained', title: '本机没有外部包或全局文件夹里的技能' }) : createEmpty();
      }
      return `<div class="agents-grid ui-resource-grid">${own.join('')}${local.join('')}</div>`;
    }
    if (!list.length) return q ? W.uiEmptyState({ kind: 'explained', title: '没有匹配的内容', hint: '换个关键词试试。' }) : createEmpty();
    return `<div class="agents-grid ui-resource-grid">${list.map((it) => ownCard(k, it)).join('')}</div>`;
  }
  function vMine(k) {
    const d = KIND[k];
    return `<div class="agents-grid-view" id="agents-grid-view">
      <div class="ap-subpage-head"><div class="hubc-backline">${btn(`返回${d.label}`, { role: 'ghost', size: 'sm', icon: 'chevron-left', act: 'home' })}<span class="hubc-backline__sep" aria-hidden="true">/</span><span>${esc(d.mine)}</span></div></div>
      <div class="agents-resource-toolbar"><div class="marketplace-categories agents-categories">${k === 'skill'
        ? W.uiSegmentedControl({ ariaLabel: `${d.mine}来源`, value: s.mineSrc, items: [['all', '全部'], ['custom', '自定义'], ['local', '本机已有']].map((x) => ({ value: x[0], label: x[1], attrs: { 'data-act': 'mine-src', 'data-arg': x[0] } })) })
        : W.uiSegmentedControl({ ariaLabel: `${d.mine}分类`, value: s.cat, items: d.cats.map((x) => ({ value: x[0], label: x[1], attrs: { 'data-act': 'cat', 'data-arg': x[0] } })) })}</div><div class="agents-resource-toolbar-controls"><div class="agents-search-field">${W.uiIconHtml('search', 'agents-search-icon')}${W.uiInput({ id: 'ap-search', type: 'search', placeholder: `搜索${d.mine}`, value: s.q, attrs: { 'aria-label': `搜索${d.mine}`, autocomplete: 'off' } })}</div>
        <div class="header-actions">${btn('+ 创建', { act: 'create' })}${btn('我的贡献', { act: 'contributions' })}</div></div></div>
      ${k === 'skill' && s.mineSrc !== 'custom' ? localBar() : ''}
      <div class="agents-grid-scroll" id="ap-grid">${mineGridHtml(k)}</div></div>`;
  }

  /* ================= 我的贡献：照客户端现有页面（hub-contributions.js `renderMine`） =================
     类名、文案、状态色、可用操作都取自客户端：hubc-page / hubc-summary / hubc-toolbar / hubc-master / hubc-list / hubc-detail，
     zh.json 的 skills.contribute_mine_*；操作规则同 hub-contributions-model.js `detailActions`。原型只换成内存数据，按钮只给提示。 */
  const CONTRIB = [
    { key: 'k1', title: '项目分析师', type: 'agent', contentId: 'a3f09c21b7e4', status: 'PENDING_REVIEW', submissionId: 's-1031', version: '1.0.0', submittedAt: '2026/10/18 16:20', publishedVersion: '', contentStatus: '' },
    { key: 'k2', title: '项目报告口径核验', type: 'skill', contentId: '9be1d07f2c55', status: 'PUBLISHED', version: '1.2.0', submittedAt: '2026/10/12 10:05', publishedVersion: '1.2.0', contentStatus: 'published' },
    { key: 'k3', title: '调研材料清单', type: 'skill', contentId: '', status: 'RETURNED', submissionId: 's-1018', version: '0.9.0', submittedAt: '2026/10/09 14:42', publishedVersion: '', contentStatus: '', reason: '使用说明缺少示例输入，请补充后重新提交。' },
    { key: 'k4', title: '经营分析师', type: 'agent', contentId: 'c71e5a90d3b8', status: 'ACCEPTED', version: '1.1.0', submittedAt: '2026/10/05 09:30', publishedVersion: '1.0.0', contentStatus: 'published', withdrawal: { status: 'PENDING', reason: '这个版本的数据口径已过时，申请下架。' } },
  ];
  const C_STATUS = { PENDING_REVIEW: ['待审核', 'attention'], PUBLISHED: ['已发布', 'success'], RETURNED: ['已退回', 'critical'], ACCEPTED: ['已接受', 'success'] };
  const C_FILTERS = [['all', '全部'], ['pending', '待审核'], ['rejected', '已退回'], ['published', '已发布'], ['withdrawal', '撤回申请']];
  const C_TYPES = [['all', '全部'], ['agent', '智能体'], ['skill', '技能']];
  const cPill = (st) => W.uiStatusPill({ label: (C_STATUS[st] || [st])[0], tone: (C_STATUS[st] || [0, 'neutral'])[1] });
  function contribVisible() {
    const c = s.contrib, q = c.q.trim().toLowerCase();
    const okFilter = (e) => (c.filter === 'pending' ? e.status === 'PENDING_REVIEW' : c.filter === 'rejected' ? e.status === 'RETURNED'
      : c.filter === 'published' ? !!e.publishedVersion : c.filter === 'withdrawal' ? !!e.withdrawal : true);
    return CONTRIB.filter((e) => (c.type === 'all' || e.type === c.type) && okFilter(e) && (!q || `${e.title} ${e.contentId} ${e.key}`.toLowerCase().includes(q)));
  }
  function contribDetail(e) {
    if (!e) return W.uiEmptyState({ title: '选择一项贡献', hint: '查看状态和可用操作。' });
    const msg = e.status === 'PENDING_REVIEW' ? '运营正在审核此提交。审核前你可以撤回提交。' : e.status === 'RETURNED' ? '提交被退回，请修改后重新提交。'
      : e.publishedVersion ? `当前发布版本 v${e.publishedVersion}。新版本需重新审核和发布。` : '审核已接受，发布角色尚未发布。';
    const b = (label, role, toastText) => W.uiButton({ label, role, attrs: { 'data-act': 'toast', 'data-arg': toastText } });
    const acts = [
      e.contentId ? b(e.status === 'RETURNED' ? '修改后重新提交' : '提交新版本', 'primary', `${e.title}：进入现有贡献流程，提交新版本`) : e.status === 'RETURNED' ? b('修改后重新提交', 'primary', `${e.title}：进入现有贡献流程，修改后重新提交`) : '',
      e.submissionId && e.status === 'PENDING_REVIEW' ? b('撤回投稿', 'danger', `确定撤回这条待处理投稿吗？（沿用现有确认弹窗）`) : '',
      e.contentId && e.contentStatus === 'published' && !(e.withdrawal && e.withdrawal.status === 'PENDING') ? b('申请撤回', 'danger', `${e.title}：打开现有的申请撤回弹窗`) : '',
      e.contentId ? b('撤回记录', 'secondary', `${e.title}：打开现有的撤回记录`) : '',
    ].filter(Boolean).join('');
    return `<h2>${esc(e.title)}</h2><span class="hubc-detail__id">${esc(e.contentId || e.submissionId)}</span>${cPill(e.status)}
      <div class="hubc-block"><span>最近提交</span><strong>${esc(`v${e.version} · ${e.submittedAt}`)}</strong><p>${esc(e.reason || msg)}</p></div>
      ${e.publishedVersion ? `<div class="hubc-block"><span>当前发布版本</span><strong>v${esc(e.publishedVersion)}</strong></div>` : ''}
      ${e.withdrawal ? `<div class="hubc-block"><span>撤回申请</span><strong>待处理</strong><p>${esc(e.withdrawal.reason)}</p></div>` : ''}
      <div class="hubc-detail__actions">${acts}</div>`;
  }
  function contribListHtml() {
    const list = contribVisible();
    if (!list.some((e) => e.key === s.contrib.selected)) s.contrib.selected = list[0] ? list[0].key : null;
    const rows = list.length ? `<ul>${list.map((e) => `<li class="hubc-row${e.key === s.contrib.selected ? ' is-selected' : ''}" data-hubc-row="${esc(e.key)}">
        <div class="hubc-row__name">${W.uiButton({ label: e.title, role: 'ghost', size: 'sm', attrs: { 'data-act': 'c-select', 'data-arg': e.key, 'aria-pressed': e.key === s.contrib.selected ? 'true' : 'false' } })}<small>${esc(`${e.type === 'agent' ? '智能体' : '技能'} · ${e.contentId || e.submissionId}${e.withdrawal ? ' · 待处理' : ''}`)}</small></div>
        <div class="hubc-row__cell">${cPill(e.status)}<small>${esc(e.submittedAt)}</small></div>
        <div class="hubc-row__cell">${esc(e.publishedVersion ? `v${e.publishedVersion}` : '—')}</div></li>`).join('')}</ul>`
      : W.uiEmptyState({ title: '没有匹配的贡献', hint: '调整筛选条件后再查看。' });
    return { rows, detail: contribDetail(list.find((e) => e.key === s.contrib.selected)) };
  }
  function vContrib(k) {
    const d = KIND[k], c = s.contrib, { rows, detail } = contribListHtml();
    const total = CONTRIB.length, pending = CONTRIB.filter((e) => e.status === 'PENDING_REVIEW').length, published = CONTRIB.filter((e) => e.publishedVersion).length;
    const seg = (label, items, value, act) => W.uiSegmentedControl({ ariaLabel: label, value, items: items.map((x) => ({ value: x[0], label: x[1], attrs: { 'data-act': act, 'data-arg': x[0] } })) });
    const col = c.type === 'agent' ? '智能体' : c.type === 'skill' ? '技能' : '内容';
    return `<div class="hubc-view" id="${k === 'agent' ? 'agents' : 'skills'}-contributions-view" style="display:flex" aria-label="我的贡献"><div class="hubc-page" data-hubc-page="mine">
      <div class="hubc-backline">${btn(`返回${d.mine}`, { role: 'ghost', size: 'sm', icon: 'chevron-left', act: 'mine' })}<span class="hubc-backline__sep" aria-hidden="true">/</span><span>我的贡献</span></div>
      <header class="hubc-heading hubc-heading--center"><div><h1>我的贡献</h1><p>查看提交与审核状态，维护已发布的${d.label}。</p></div>${btn('刷新', { icon: 'refresh', act: 'toast', arg: '已从 Hub 刷新贡献记录（示意）' })}</header>
      <div class="hubc-summary"><span><strong>${total}</strong>项贡献</span><span><strong>${pending}</strong>项待审核</span><span><strong>${published}</strong>项已发布</span><small>最近同步 2026/10/19 09:00</small></div>
      <div class="hubc-toolbar"><div data-hubc-types>${seg('按类型筛选', C_TYPES, c.type, 'c-type')}</div><div data-hubc-filters>${seg('筛选贡献状态', C_FILTERS, c.filter, 'c-filter')}</div>
        <div class="hubc-search">${W.uiInput({ id: 'hubc-mine-search', type: 'search', value: c.q, placeholder: '搜索我的贡献', attrs: { 'aria-label': '搜索我的贡献' } })}</div></div>
      <div class="hubc-master"><section class="hubc-list" aria-label="贡献列表"><div class="hubc-list__head"><span>${col}</span><span>最近提交</span><span>当前发布版本</span></div><div data-hubc-list>${rows}</div></section>
        <aside class="hubc-detail" aria-label="贡献详情" data-hubc-detail>${detail}</aside></div></div></div>`;
  }
  function refreshContrib() {
    const list = $('[data-hubc-list]'), det = $('[data-hubc-detail]');
    if (!list || !det) { render(); return; }
    const { rows, detail } = contribListHtml(); list.innerHTML = rows; det.innerHTML = detail;
    if (W.hydrateUiIcons) { W.hydrateUiIcons(list); W.hydrateUiIcons(det); }
  }

  /* ================= 已安装的智能体 / 技能（原「管理」）：只放从平台安装的 =================
     一样东西只放一处：本机已有的技能（全局文件夹、外部包）是用户自己的，只在「我的技能」里，
     在那里停用（详情）、移除外部包（详情）、开关全局文件夹（顶部总开关，客户端设置 global_skill_roots_enabled）。 */
  const sw = (on, label, act, arg) => W.uiSwitch({ label, checked: on, attrs: { 'data-act': act, 'data-arg': arg } });
  function manageRow(k, it) {
    const on = isOn(k, it.id), origin = originOf(it.id);
    const av = k === 'agent' ? avatar(it.tone || 'green') : skillAvatar(it.name);
    return `<li class="ap-manage-row${on ? '' : ' is-off'}" data-id="${esc(it.id)}" data-act="detail" data-arg="${esc(it.id)}">${av}<div class="ap-manage-row__text"><strong>${esc(it.name)}${hasUpdate(k, it.id) ? ` ${W.uiStatusPill({ label: '有更新', tone: 'success' })}` : ''}${k === 'agent' && depOffSkills(it).length ? ` ${W.uiStatusPill({ label: '依赖已停用', tone: 'attention' })}` : ''}</strong><span>${esc(it.desc)}</span></div>${btn('卸载', { role: 'ghost', size: 'sm', act: 'uninstall', arg: it.id })}${sw(on, `${on ? '停用' : '启用'}${it.name}`, 'toggle', it.id)}</li>`;
  }
  const manageSec = (title, inner, extraHead) => `<section class="agents-source-section" data-group="${esc(title)}"><div class="agents-source-section-head ap-manage-head"><span>${esc(title)}</span>${extraHead || ''}</div>${inner}</section>`;
  function vManage(k) {
    const d = KIND[k], list = installedHub(k);
    const counted = list, onN = counted.filter((x) => isOn(k, x.id)).length;
    const hubBody = list.length ? `<ul class="ap-manage-list">${list.map((x) => manageRow(k, x)).join('')}</ul>`
      : W.uiEmptyState({ kind: 'explained', title: `还没有从平台安装的${d.label}`, hint: `在${d.label}页点“安装”后会出现在这里，可以统一停用或卸载。` });
    const body = manageSec(`从平台安装的 · ${list.length}`, hubBody);
    const hint = `这里是你从平台安装的${d.label}，可以停用或卸载；卸载后需要时再安装。`;
    return `<div class="agents-grid-view" id="agents-grid-view">
      <div class="ap-subpage-head"><div class="hubc-backline">${btn(`返回${d.label}`, { role: 'ghost', size: 'sm', icon: 'chevron-left', act: 'home' })}<span class="hubc-backline__sep" aria-hidden="true">/</span><span>已安装的${d.label}</span></div><span class="ap-meta" id="ap-manage-count">已启用 ${onN} / 共 ${counted.length}</span></div>
      <p class="ap-fine ap-manage-hint">${esc(hint)}</p>
      <div class="agents-grid-scroll" id="ap-grid">${body}</div></div>`;
  }
  /** 我的技能顶部：本机已有的技能从哪来 + 全局文件夹总开关（客户端设置 global_skill_roots_enabled） */
  function localBar() {
    const master = `<span class="ap-manage-master">读取 ~/.claude、~/.codex 的技能${sw(s.globalOn, `${s.globalOn ? '关闭' : '开启'}读取全局技能文件夹`, 'global-roots', 'all')}</span>`;
    const text = s.globalOn ? '本机已有的技能来自 ~/.claude、~/.codex 文件夹和外部包，可在详情里停用；外部包可在详情里移除。'
      : '已关闭读取：~/.claude、~/.codex 里的技能不会出现在这里，任务里也不会调用，文件本身不受影响。';
    return `<div class="ap-mine-local" id="ap-mine-local"><span${s.globalOn ? '' : ' id="ap-global-off"'}>${esc(text)}</span>${master}</div>`;
  }
  function toggleGlobalRoots() {
    s.globalOn = !s.globalOn; render();
    toast(s.globalOn ? '已开启读取全局技能文件夹' : '已关闭读取全局技能文件夹，相关技能不再出现在这里');
  }
  function removePackage(id) {
    const it = find('skill', id); if (!it) return;
    dialog(`移除「${it.name}」？`, `<p>将从本机移除这个外部包（${esc(it.pkg.split(' · ')[0])}），它带的 ${it.skillCount} 个技能也一起移除。之后需要可以让 cogseed 重新安装。</p>`,
      [{ label: '取消' }, { label: '移除', role: 'danger', run: () => { s.removed.add(id); s.off.skill.delete(id); render(); toast(`已移除「${it.name}」（含 ${it.skillCount} 个技能）`); } }]);
  }
  function toggle(id, force) {
    const k = s.tab, it = find(k, id); if (!it) return;
    if (k === 'skill' && isOn(k, id) && !force) {
      const deps = dependents(id);
      if (deps.length) {
        dialog(`停用「${it.name}」？`, `<p>以下智能体会用到这个技能，停用后它们将<strong>暂时不能使用</strong>，重新启用技能即可恢复：</p><ul class="ap-list" id="ap-dep-list">${deps.map((a) => `<li>${esc(a.name)}</li>`).join('')}</ul><p class="ap-fine">停用后，任务里不会再调用这个技能。可以随时重新启用。</p>`,
          [{ label: '取消' }, { label: '停用', role: 'danger', run: () => toggle(id, true) }]);
        return;
      }
    }
    if (s.off[k].has(id)) s.off[k].delete(id); else s.off[k].add(id);
    toast(`已${isOn(k, id) ? '启用' : '停用'}「${it.name}」`);
    if (s.modal && s.detailId === id) { closeDialog(); render(); openDetail(id); s.detailId = id; } else render();
  }

  /* ================= 详情弹窗（各类同一种） ================= */
  /* 照客户端已有的「连接器使用弹窗」做（connectors.js `_openConnectorPopup`）：
     uiModal lg（720），图标插在标题栏最前，正文一列，示例是整行 uiButton（右侧图标），操作放 footer。 */
  const META = { commander: () => '主智能体', external: (it) => `${it.cat} · 外接智能体`, own: (it) => `${it.cat} · 我创建的`, global: (it) => `${it.cat} · 来自全局文件夹`, package: (it) => `${it.cat} · 外部包${it.pkg ? `（${it.pkg.split(' · ')[0]}）` : ''}` };
  function openDetail(id) {
    const k = s.tab, it = find(k, id); if (!it) return;
    const origin = originOf(id), local = isLocal(k, id), failed = s.err && s.err.id === id, off = !isOn(k, id);
    const label = KIND[k].label;
    const examples = it.examples && it.examples.length ? it.examples : ex([`请用「${it.name}」帮我处理这项工作。`]);
    const primary = useButton(k, it, { label: `使用${label}`, installLabel: `安装${label}`, icon: 'send', retryLabel: '重试' });
    const toggleBtn = btn(off ? '启用' : '停用', { act: 'toggle', arg: id });
    const upd = hasUpdate(k, id), newVer = upd ? s.upd[k].get(id) : '', updFailed = s.updErr === id;
    const updBtn = !upd ? '' : s.updating === id ? btn('更新中…', { loading: true, disabled: true }) : btn(updFailed ? '重试更新' : `更新到 v${newVer}`, { act: 'update', arg: id });
    const depOff = k === 'agent' && local ? depOffSkills(it) : [];
    const depBtn = depOff.length ? btn(`启用「${depOff[0].name}」`, { act: 'enable-skill', arg: depOff[0].id }) : '';
    const secondary = origin === 'own' ? `${btn('贡献', { act: 'contribute', arg: id })}${btn('管理', { act: 'manage', arg: id })}${toggleBtn}`
      : origin === 'external' ? `${btn('管理', { act: 'manage', arg: id })}${toggleBtn}`
        : origin === 'hub' ? (local && s.busy !== id ? `${toggleBtn}${btn('卸载', { act: 'uninstall', arg: id })}${updBtn}${depBtn}` : '')
          : origin === 'commander' ? '' : origin === 'package' ? `${toggleBtn}${btn('移除', { act: 'remove-pkg', arg: id })}` : toggleBtn;
    const meta = META[origin] ? META[origin](it) : `${it.cat} · 平台${verOf(k, it) ? ` · v${verOf(k, it)}` : ''}${upd ? ` · 可更新到 v${newVer}` : ''}`;
    const skillChips = it.skills ? `<section class="ap-popup-skills"><h3>会用到的技能</h3><div class="ap-inline">${it.skills.split('、').map((n) => `<span class="ap-skillchip${depOff.some((sk) => sk.name === n) ? ' is-off' : ''}">${esc(n)}<small>${depOff.some((sk) => sk.name === n) ? '已停用' : local ? '已就绪' : '随智能体一起安装'}</small></span>`).join('')}</div></section>` : '';
    const does = k === 'skill' && it.does && it.does.length ? `<section class="ap-popup-skills"><h3>能做什么</h3><ul class="ap-checklist">${it.does.map((x) => `<li>${W.uiIconHtml('check', 'ap-check')}<span>${esc(x)}</span></li>`).join('')}</ul></section>` : '';
    const secPill = it.security ? W.uiStatusPill({ label: `安检${it.security}`, tone: it.security === '通过' ? 'success' : 'attention' }) : '';
    const exampleBtns = examples.map((e, i) => W.uiButton({ label: `“${e.prompt}”`, role: 'secondary', iconEnd: 'message-square', className: 'ap-popup-example', disabled: off || s.busy === id || depOff.length > 0, attrs: { 'data-act': 'send', 'data-arg': `${id}|${i}` } })).join('');
    const hint = off ? '启用后点一下就能发送' : depOff.length ? '启用依赖的技能后才能使用' : local ? '点一下就会发送' : '点示例会先安装，再发送';
    const bodyHtml = `<div class="ap-popup-content">
      <p>${esc(it.desc)}</p>
      ${secPill ? `<div class="ap-inline">${secPill}<span class="ap-meta">${local ? '内容已通过检查，可以放心使用' : '安装时会再做一次安全检查'}</span></div>` : ''}
      ${it.tags && it.tags.length ? `<div class="ap-inline">${it.tags.map((t) => chip(t)).join('')}</div>` : ''}
      ${failed ? note('warn', '安装没有完成', `${s.err.message}已保留当前内容，可以再试一次。`) : ''}
      ${depOff.length ? note('warn', '依赖的技能已停用', `「${depOff.map((sk) => sk.name).join('、')}」已被你停用，这个智能体暂时不能使用。点底部的“启用「${depOff[0].name}」”即可恢复。`) : ''}
      ${updFailed ? note('warn', `更新到 v${newVer} 没有完成`, `已保留 v${verOf(k, it)}，仍可正常使用；可以稍后重试。`) : upd ? note('info', `有新版本 v${newVer}`, '更新后新任务使用新版本；正在运行的任务不受影响。') : ''}
      ${off ? note('info', '已停用', '停用后，任务里不会再调用它，@ 也找不到它。点底部的“启用”可以恢复。') : ''}
      ${does}
      <section class="ap-popup-examples"><h3>${label}帮你做<small>${hint}</small></h3>${exampleBtns}</section>
      ${skillChips}</div>`;
    const m = dialog(it.name, bodyHtml, [], 'lg', { description: meta, dismissOnBackdrop: true });
    m.dialog.classList.add('ap-popup');
    const icon = document.createElement('span');
    icon.className = 'ap-popup-icon';
    icon.innerHTML = k === 'agent' ? avatar(it.tone || 'green', 52, 'file-text') : skillAvatar(it.name);
    const header = m.dialog.querySelector('.ui-modal__header');
    header.insertBefore(icon, header.childNodes[0] || null);
    const footer = document.createElement('footer');
    footer.className = 'ui-modal__footer';
    footer.innerHTML = `${secondary ? `<div class="ap-popup-secondary">${secondary}</div>` : ''}${primary}`;
    m.dialog.appendChild(footer);
  }
  function update(id) {
    const k = s.tab, it = find(k, id); if (!it || s.updating) return;
    s.updating = id; s.updErr = null; render(); refreshDetail();
    later(() => {
      s.updating = null;
      if (s.failUpdate && !s.triedUpd[id]) { s.triedUpd[id] = true; s.updErr = id; render(); refreshDetail(); return; }
      const v = s.upd[k].get(id); s.ver[k][id] = v; s.upd[k].delete(id);
      render(); refreshDetail(); toast(`已更新「${it.name}」到 v${v}`);
    }, 1200);
  }
  function loginPrompt(what) {
    dialog('请先登录', `<p>登录后才能${esc(what)}。已安装的智能体和技能不受影响，可以照常使用。</p>`, [{ label: '取消' }, { label: '登录', role: 'primary', run: doLogin }]);
  }
  function doLogin() { s.auth = 'in'; render(); paintSidebar(); toast('已登录（示意：真实客户端走现有登录流程）'); }
  function doLogout() { s.auth = 'out'; s.view = 'home'; render(); paintSidebar(); toast('已退出登录（示意）'); }
  /** 左下角账号：已登录 → 退出登录；未登录 → 登录。真实客户端沿用现有账号菜单与登录流程。 */
  function accountMenu() {
    closeDialog();
    if (loggedOut()) { loginPrompt('使用平台内容'); return; }
    dialog('退出登录', '<p>退出后，已安装的智能体和技能仍可使用；平台上其他内容需要登录后才能查看和安装，贡献也需要登录。</p>',
      [{ label: '取消' }, { label: '退出登录', role: 'danger', run: doLogout }]);
  }
  function refreshDetail() { if (s.modal && s.detailId) { const id = s.detailId; closeDialog(); openDetail(id); s.detailId = id; } }

  /* ================= 安装 / 使用 =================
     「安装」：安装中… → 变「使用」，留在原处；详情里点示例（明确要用）：先安装再直接发送，一步完成。 */
  function enterTask(it, exampleIndex, fetched) {
    closeDialog();
    const pre = fetched ? `已安装「${it.name}」，` : '';
    if (exampleIndex == null) { toast(`${pre}进入新任务，已选中「${it.name}」（沿用现有任务页）`); return; }
    const list = it.examples && it.examples.length ? it.examples : ex([`请用「${it.name}」帮我处理这项工作。`]);
    toast(`${pre}已在新任务中发送：“${list[exampleIndex].prompt}”`);
  }
  /** 安装；then 有值时装好后接着用（详情里点示例），否则只装好、按钮变「使用」。 */
  function install(id, then) {
    const k = s.tab, it = find(k, id); if (!it || s.busy) return;
    s.busy = id; s.err = null; render(); refreshDetail();
    later(() => {
      s.busy = null;
      if (s.failInstall && !s.tried[id]) {
        s.tried[id] = true; s.err = { id, message: `下载「${it.name}」时网络中断。` };
        render(); refreshDetail(); return;
      }
      s.inst[k].add(id); render();
      if (then) { then(it); return; }
      refreshDetail(); toast(`已安装「${it.name}」，点“使用”就能开始`);
    }, it.heavy ? 2200 : 1100);
  }
  function useItem(id, exampleIndex) {
    const k = s.tab, it = find(k, id); if (!it || !isOn(k, id) || s.busy) return;
    if (k === 'agent' && isLocal(k, id) && depOffSkills(it).length) return;
    if (isLocal(k, id)) { enterTask(it, exampleIndex, false); return; }
    install(id, (x) => enterTask(x, exampleIndex, true));
  }
  function uninstall(id) {
    const k = s.tab, it = find(k, id); if (!it) return;
    s.inst[k].delete(id); s.off[k].delete(id); closeDialog(); render(); toast(`已卸载「${it.name}」。需要时可以再安装。`);
  }

  /* ================= 创建 ================= */
  function createDialog(draft, error) {
    const k = s.tab, d = KIND[k], agent = k === 'agent', f = draft || { mode: 0, name: '', intro: '', format: '自动选择', cli: 'Codex' };
    s.draft = f;
    const tabs = agent ? `<div class="ap-inline" role="group" aria-label="创建方式">${[['创建', 0], ['外接', 1]].map(([l, i]) => btn(l, { size: 'sm', role: f.mode === i ? 'primary' : 'secondary', act: 'create-mode', arg: String(i) })).join('')}</div>` : '';
    const ext = agent && f.mode === 1;
    const clis = ext ? `<div class="ap-field"><label>智能体</label><div class="ap-inline">${['Codex', 'Claude Code', 'Hermes', 'OpenClaw', 'WorkBuddy'].map((c) => btn(c, { size: 'sm', role: f.cli === c ? 'primary' : 'secondary', act: 'create-cli', arg: c })).join('')}</div></div>` : '';
    const fmt = agent && !ext ? `<div class="ap-field"><label>输出格式</label><div class="ap-inline">${['自动选择', '普通回复', '数据看板', '交互应用'].map((c) => btn(c, { size: 'sm', role: f.format === c ? 'primary' : 'secondary', act: 'create-format', arg: c })).join('')}</div></div>` : '';
    const body = `<div class="ap-form">${tabs}${clis}
      <div class="ap-field"><label for="ap-name">名称</label>${W.uiInput({ id: 'ap-name', value: f.name, placeholder: agent ? '例如：项目分析师' : '例如：周报整理' })}</div>${fmt}
      <div class="ap-field"><label for="ap-intro">简介</label>${W.uiTextarea({ id: 'ap-intro', value: f.intro, placeholder: agent ? '描述智能体负责的工作' : '描述技能要完成的工作' })}</div>
      <p class="ap-fine">${esc(ext ? '通过 P3394 协议接入，注册为协作节点；接入后出现在智能体页的“外接智能体”里。' : d.help)}</p>${error ? `<p class="ap-error" role="alert">${esc(error)}</p>` : ''}</div>`;
    const m = dialog(`新建${d.label}`, body, [{ label: '取消' }, { label: '确认', role: 'primary', run: () => submitCreate(m, f) }]);
  }
  const readDraft = (m, f) => { const n = m.dialog.querySelector('#ap-name'), i = m.dialog.querySelector('#ap-intro'); return { ...f, name: n ? n.value : f.name, intro: i ? i.value : f.intro }; };
  function submitCreate(m, f0) {
    const k = s.tab, d = KIND[k], f = readDraft(m, f0);
    const fail = (msg) => later(() => createDialog(f, msg), 0);
    const name = (f.name || '').trim(), intro = (f.intro || '').trim();
    if (!name || !intro) return fail('请填写名称和简介');
    if (!/^[A-Za-z0-9_一-鿿-]+$/.test(name)) return fail('名称仅支持中文、字母、数字、下划线和短横线');
    if (k === 'agent' && ['cogseed', 'commander'].includes(name.toLowerCase())) return fail('此名称已保留，请换一个名称');
    const taken = [...d.commander, ...d.hub, ...customAll(k), ...localAll(k)].map((x) => x.name.toLowerCase());
    if (taken.includes(name.toLowerCase())) return fail(`已存在同名${d.label}，请修改名称`);
    const ext = k === 'agent' && f.mode === 1;
    const item = { id: `${ext ? 'x' : 'c'}-${Date.now()}`, name, cat: '通用', tone: 'green', desc: intro, examples: [] };
    if (ext) s.created.agent.external.push(item); else s.created[k].custom.push(item);
    s.view = ext ? 'home' : 'mine'; s.q = ''; s.cat = 'all'; render();
    toast(ext ? `已接入「${name}」，在“外接智能体”里。` : `已创建「${name}」，可在“管理”里继续编辑，也可以贡献到平台。`);
  }

  /* ================= 页面外壳 ================= */
  const TABS = [['agent', '智能体'], ['mcp', 'MCP与工具'], ['skill', '技能'], ['sources', '资料库'], ['touchpoints', 'IM']];
  function connectionsPage() {
    const tabs = TABS.map((t) => `<button type="button" class="connections-tab ui-tab${s.tab === t[0] ? ' is-active' : ''}" role="tab" aria-selected="${s.tab === t[0]}" tabindex="${s.tab === t[0] ? 0 : -1}" data-act="tab" data-arg="${t[0]}">${t[1]}</button>`).join('');
    const live = s.tab === 'agent' || s.tab === 'skill';
    const pane = live
      ? `<div class="connections-tab-pane" id="connections-pane-agents"><section class="panel connections-embedded-panel" id="panel-agents">${s.view === 'mine' ? vMine(s.tab) : s.view === 'manage' ? vManage(s.tab) : s.view === 'contrib' ? vContrib(s.tab) : vHome(s.tab)}</section></div>`
      : `<div class="ap-inert-pane">「${esc(TABS.find((t) => t[0] === s.tab)[1])}」本期不改动，保持现有页面。</div>`;
    return `<section class="panel ui-resource-page active" id="panel-connections"><div class="app-top-drag-strip" aria-hidden="true"></div>
      <div id="connections-page-header">${W.uiPageHeader({ title: '智能体 / 技能 / 连接' })}</div>
      <div class="connections-container"><div class="connections-tabs ui-tabs" role="tablist" aria-label="智能体 / 技能 / 连接">${tabs}</div><div class="connections-body">${pane}</div></div></section>`;
  }
  function paintSidebar() {
    const list = $('#conversation-list');
    if (list && !list.innerHTML) list.innerHTML = [['项目周报整理', '2天'], ['调研材料核对', '2天'], ['技能说明优化', '3天']].map((c) => `<div class="conv-item"><div class="conv-item-row"><div class="conv-item-title">${esc(c[0])}</div><span class="conv-item-time">${esc(c[1])}</span></div></div>`).join('');
    const root = $('#hub-account-chip-root'); if (!root || !W.uiUserMenuTrigger) return;
    const identity = loggedOut() ? { name: '未登录', description: '登录后使用平台内容', avatar: { text: '?' } } : { name: '雨萱', description: '个人工作空间', avatar: { text: '雨', variant: 'gradient' } };
    root.innerHTML = W.uiUserMenuTrigger({ id: 'hub-account-chip', open: false, name: identity.name, description: identity.description, avatar: identity.avatar, ariaLabel: `用户菜单：${identity.name}` });
    if (W.hydrateUiIcons) W.hydrateUiIcons(root);
  }
  function render() {
    $('#main-content').innerHTML = connectionsPage();
    if (W.hydrateUiIcons) W.hydrateUiIcons(document);
    try { parent.postMessage({ type: 'state', key: s.key }, '*'); } catch (e) { /* 独立打开时忽略 */ }
  }
  function refreshGrid() {
    const g = $('#ap-grid');
    if (!g || (s.view !== 'home' && s.view !== 'mine')) { render(); return; }
    g.innerHTML = s.view === 'home' ? gridHtml(s.tab) : mineGridHtml(s.tab);
    if (W.hydrateUiIcons) W.hydrateUiIcons(g);
  }

  function enter(kind, phase) {
    s.tab = kind;
    if (phase) { s.phase = phase; return; }
    if (s.loaded[kind]) { s.phase = 'ready'; return; }
    s.phase = 'loading';
    later(() => { s.loaded[kind] = true; s.phase = 'ready'; if (s.tab === kind && s.view === 'home') refreshGrid(); }, 700);
  }
  function go(key) {
    clearTimers(); closeDialog(); s.busy = null; s.err = null; s.tried = {}; s.q = ''; s.cat = 'all'; s.contrib = { type: 'all', filter: 'all', q: '', selected: null }; s.mineSrc = 'all'; s.globalOn = true; s.removed = new Set();
    const t = TOUR.find((x) => x.key === key) || TOUR[0];
    Object.assign(s, { key: t.key, view: t.view, failInstall: !!t.failInstall });
    s.inst = initInst(); s.off = initOff(); (t.skillOff || []).forEach((x) => s.off.skill.add(x));
    Object.assign(s, { auth: t.auth || 'in', upd: initUpd(), ver: { agent: {}, skill: {} }, updating: null, updErr: null, failUpdate: !!t.failUpdate, triedUpd: {} });
    s.loaded[t.tab] = !t.phase;
    enter(t.tab, t.phase);
    try { history.replaceState(null, '', '?v=' + encodeURIComponent(t.key)); } catch (e) { /* 忽略 */ }
    render(); paintSidebar();
    if (t.detail) { s.detailId = t.detail; openDetail(t.detail); }
    if (t.modal === 'create') createDialog();
    if (t.autoToggle) toggle(t.autoToggle);
  }

  /* ---------- 事件 ---------- */
  document.addEventListener('click', (e) => {
    if (e.target.closest('#hub-account-chip')) { accountMenu(); return; }
    const el = e.target.closest('[data-act]'); if (!el) return;
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') return;
    const act = el.getAttribute('data-act'); const arg = el.getAttribute('data-arg');
    switch (act) {
      case 'tab': if (arg === 'agent' || arg === 'skill') { s.view = 'home'; s.q = ''; s.cat = 'all'; enter(arg); } else { s.tab = arg; } render(); break;
      case 'cat': s.cat = arg; render(); break;
      case 'clear': s.q = ''; s.cat = 'all'; render(); break;
      case 'mine': s.view = 'mine'; s.q = ''; s.cat = 'all'; s.mineSrc = 'all'; render(); break;
      case 'mine-src': s.mineSrc = arg; render(); break;
      case 'to-manage': s.view = 'manage'; s.q = ''; render(); break;
      case 'contributions': closeDialog(); s.view = 'contrib'; s.contrib = { type: 'all', filter: 'all', q: '', selected: null }; render(); break;
      case 'c-type': s.contrib.type = arg; render(); break;
      case 'c-filter': s.contrib.filter = arg; render(); break;
      case 'c-select': s.contrib.selected = arg; refreshContrib(); break;
      case 'login': closeDialog(); doLogin(); break;
      case 'update': update(arg); break;
      case 'enable-skill': { const sk = find('skill', arg); s.off.skill.delete(arg); toast(`已启用「${sk.name}」`); render(); refreshDetail(); break; }
      case 'contribute': if (loggedOut()) { closeDialog(); loginPrompt('贡献到平台'); break; } { const it = find(s.tab, arg); closeDialog(); toast(`开始贡献「${it.name}」：沿用现有贡献流程，提交后在“我的贡献”查看进度`); break; }
      case 'toggle': toggle(arg); break;
      case 'home': s.view = 'home'; s.q = ''; s.cat = 'all'; render(); break;
      case 'retry': s.phase = 'ready'; s.loaded[s.tab] = true; render(); break;
      case 'detail': s.detailId = arg; openDetail(arg); break;
      case 'use': useItem(arg); break;
      case 'install': if (loggedOut()) { loginPrompt('安装平台内容'); break; } install(arg); break;
      case 'send': { const [id, i] = arg.split('|'); s.detailId = id; useItem(id, Number(i)); break; }
      case 'uninstall': uninstall(arg); break;
      case 'remove-pkg': closeDialog(); removePackage(arg); break;
      case 'global-roots': toggleGlobalRoots(); break;
      case 'manage': closeDialog(); toast('打开现有的管理工作台（沿用现有，不在本期改版）'); break;
      case 'create': createDialog(); break;
      case 'create-mode': createDialog({ ...readDraft(s.modal, s.draft), mode: Number(arg) }); break;
      case 'create-cli': createDialog({ ...readDraft(s.modal, s.draft), cli: arg, name: arg.replace(/ /g, ''), intro: `通过 ${arg} 处理项目中的开发任务。` }); break;
      case 'create-format': createDialog({ ...readDraft(s.modal, s.draft), format: arg }); break;
      case 'toast': toast(arg); break;
      default: break;
    }
  });
  let composing = false;
  document.addEventListener('compositionstart', () => { composing = true; });
  document.addEventListener('compositionend', (e) => { composing = false; onSearch(e); });
  document.addEventListener('input', (e) => { if (!composing) onSearch(e); });
  function onSearch(e) {
    const el = e.target; if (!el) return;
    if (el.id === 'hubc-mine-search') { s.contrib.q = el.value; refreshContrib(); return; }
    if (el.id !== 'ap-search') return;
    s.q = el.value; refreshGrid();
  }
  const announce = () => { try { parent.postMessage({ type: 'ready', tour: TOUR.map((t) => ({ key: t.key, label: t.label, group: t.group || 'other' })) }, '*'); parent.postMessage({ type: 'state', key: s.key }, '*'); } catch (e) { /* 独立打开时忽略 */ } };
  window.addEventListener('message', (e) => { const d = e.data || {}; if (d.type === 'go') go(d.key); else if (d.type === 'hello') announce(); });

  window.addEventListener('DOMContentLoaded', () => {
    paintSidebar();
    if (W.hydrateUiIcons) W.hydrateUiIcons(document);
    const q = new URLSearchParams(location.search).get('v');
    go(q && TOUR.some((t) => t.key === q) ? q : 'agents');
    announce();
  });
  W.__s4 = { state: s, go, find, useItem };
})();
