/* ============================================================================
 * 认知资产 · 视图层（cognition-assets/views.js）
 *
 * 纯函数式渲染：每个视图接收 (store, route) 产出 HTML 字符串；
 * 事件全部靠 data-go（导航）与 data-act（动作）交给 app.js 的委托层。
 * 视图之间不互相调用，共享零件只有本文件顶部的 build* 系列。
 * ========================================================================== */
(function () {
  'use strict';

  const NS = window.CogAssets;
  if (!NS) return;
  const { T, esc, fmtDate } = NS;
  const S = NS.store;

  /* ────────────────────────── 共享零件 ────────────────────────── */

  /* 按钮一律走共享 uiButton 工厂（shared-ui-adoption-guard 约束：本模块不落
   * 裸控件）。皮肤由 cognition-assets.css 的「原型移植段」按 .btn 修饰类给出：
   * 默认 = 浅绿实底（原型 .btn.g）、primary = 深绿实底（.btn）、danger = 红（.btn.d）、
   * 需要描边白底时用 className: 'o'。 */
  const btn = (label, act, options) => {
    const opts = options || {};
    /* chip / rnm 是完整自管皮肤（白底选中态 / 无框文字钮），不吃默认浅绿
       实底——否则 .btn.g 双类特异性压过 .chip，所有筛选 chip 都像选中态
       （2026-09-21 子安真机抓出）。 */
    const ownSkin = /(^|\s)(chip|rnm|backlink)(\s|$)/.test(opts.className || '');
    const variant = opts.danger ? 'd' : opts.primary ? '' : ownSkin ? '' : 'g';
    const classes = ['btn', variant, opts.small ? 'sm' : '', opts.className || ''].filter(Boolean).join(' ');
    // opts.data 的键统一补 data- 前缀：uiButton 的 attrs 白名单只放行
    // id/role/title/aria-*/data-*，裸键（action/batch/kind…）会被静默丢弃——
    // 2026-09-14 前端重建起这里的行内动作属性一直没渲染出来，委托层读到
    // 的 dataset.action 恒为 undefined（2026-09-15 修，整理记录重构时抓出）。
    const dataAttrs = Object.assign(
      {},
      ...Object.entries(opts.data || {}).map(([key, value]) => ({ [`data-${key}`]: value })),
    );
    return window.uiButton({
      label,
      className: classes,
      role: opts.danger ? 'danger' : opts.primary ? 'primary' : 'secondary',
      size: opts.small ? 'sm' : 'md',
      ...(opts.icon ? { icon: opts.icon } : {}),
      ...(opts.disabled ? { disabled: true } : {}),
      attrs: Object.assign(
        {},
        act ? { 'data-act': act } : {},
        opts.id != null ? { 'data-id': String(opts.id) } : {},
        dataAttrs,
        opts.title ? { title: opts.title } : {},
      ),
    });
  };

  /** 行内可选块（chip 单选、tab、折叠头等富内容控件）：不用裸 button，
   *  用 div[role=button]——键盘 Enter/Space 由 app.js 委托层统一触发，
   *  与资产列表行（data-go-asset）同一交互契约。 */
  const roleBtn = (extra = '') => `role="button" tabindex="0"${extra ? ` ${extra}` : ''}`;

  /* 状态/来源章：原型 .tag（小圆角色块）。'line' 是「中性信息」档，落到
   * 原型最弱的 .tag.gray——它比绿色章弱一档，不会跟状态章抢注意力。 */
  const TAG_TONE = { green: 'green', amber: 'amber', red: 'red', blue: 'blue', line: 'gray' };
  const chip = (label, tone) => `<span class="tag ${TAG_TONE[tone] || 'gray'}">${esc(label)}</span>`;

  const stat = (value, label, tone) => `<div class="stat"><div class="v${tone ? ` ${tone}` : ''}">${esc(String(value))}</div><div class="l">${esc(label)}</div></div>`;
  const statsRow = (items) => `<div class="stats">${items.map(([v, l, tone]) => stat(v, l, tone)).join('')}</div>`;

  /* 页头：原型把统计卡与「当前任务选用」卡都收进 .hero（不是页头右侧的小块）。 */
  const hero = (title, hint, inner) => `
    <div class="hero">
      <h1>${esc(title)}</h1>
      ${hint ? `<div class="sub">${esc(hint)}</div>` : ''}
      ${inner || ''}
    </div>`;

  /* 页头 + 右侧操作（原型整理页：标题、说明、右侧「沉淀设置」入口）。 */
  const heroRow = (title, hint, right) => `
    <div class="hero hero-row">
      <div class="hero-main">
        <h1>${esc(title)}</h1>
        ${hint ? `<div class="sub">${esc(hint)}</div>` : ''}
      </div>
      ${right || ''}
    </div>`;

  /** 共享图标（icons.js）取用：缺席时用等义字符兜底（icons.js 由全局
   *  加载，认知资产模块晚于它；防御性兜底保证任何加载顺序下可用）。 */
  const uiIcon = (name, className, fallback) => (typeof window.uiIconHtml === 'function'
    ? window.uiIconHtml(name, className)
    : fallback);

  const empty = (title, hint, action) => {
    if (typeof window.uiEmptyState !== 'function') throw new Error('cognition assets require uiEmptyState');
    return window.uiEmptyState({
      kind: action ? 'actionable' : hint ? 'explained' : 'quiet',
      title,
      ...(hint ? { hint, icon: 'circle' } : {}),
      ...(action ? { action } : {}),
    });
  };

  /* 小节标题：原型 .sect = 标题 + 计数 + 撑开的细线 + 右侧操作。 */
  const sectionHead = (title, note, right) => `
    <div class="sect"><strong class="sect-t">${esc(title)}</strong>${note ? `<span class="n">${esc(note)}</span>` : ''}<span class="sp"></span>${right || ''}</div>`;

  /* ────────────── 人话术语表 + 三层披露共享件（specs/018 T001/T002）──────────────
   * 病根之二：界面词是工程词（候选/作用边界/扩权/回执），用户没有这些概念。
   * 术语表在展示层统一翻译，数据层口径一个不动；钉死口径（「实际采用」「被带入」
   * 「保留期 30 天」）只加脚注、不改写。TERM_TABLE 形态 = [词条键, 界面词,
   * 脚注键, 脚注]，相邻字符串字面量让 i18n 覆盖扫描（literalPattern）扫得到，
   * 四语缺一门即红。 */
  const TERM_TABLE = {
    candidate: ['cognition.term_candidate', '系统注意到的一件事', 'cognition.term_candidate_note', '等你点头才记入你的认知'],
    kstar: ['cognition.term_kstar', '那次任务的复盘', 'cognition.term_kstar_note', '任务收口后系统总结的得失'],
    boundary: ['cognition.term_boundary', '什么时候用、什么时候别用', 'cognition.term_boundary_note', '没写适用范围的规矩不会被自动带入任务'],
    sensitivity: ['cognition.term_sensitivity', '敏感档位', 'cognition.term_sensitivity_note', '决定这条能被带去哪些任务'],
    escalation: ['cognition.term_escalation', '能去的地方变多了', 'cognition.term_escalation_note', '需要你确认这次放宽'],
    receipt: ['cognition.term_receipt', '使用记录', 'cognition.term_receipt_note', '只记真实用过（实际采用），仅被带入不算'],
    family: ['cognition.term_family', '同一来源的一组', '', ''],
    projection: ['cognition.term_projection', '带进对话的内容', '', ''],
    inspection: ['cognition.term_inspection', '后台体检', 'cognition.term_inspection_note', '只报不改，发现的问题进「待我处理」'],
  };
  const term = (id) => {
    const row = TERM_TABLE[id];
    return row ? T(row[0], row[1]) : '';
  };
  const termNote = (id) => {
    const row = TERM_TABLE[id];
    return row && row[2] ? T(row[2], row[3]) : '';
  };
  /** 首次出现脚注：一行 note（分号连接），没有脚注的术语自动跳过。 */
  const termFootnote = (ids) => {
    const notes = (ids || []).map(termNote).filter(Boolean);
    return notes.length ? `<p class="note term-footnote">${esc(notes.join('；'))}</p>` : '';
  };

  /** 折叠区统一用法（T002）：技术细节与低频记录默认收起，内容不丢。 */
  const foldBlock = (title, count, hint, body, cls) => `<details class="details fold${cls ? ` ${cls}` : ''}"><summary>${esc(title)}${count != null ? `<span class="n">${esc(String(count))}</span>` : ''}${hint ? `<span class="note">${esc(hint)}</span>` : ''}</summary><div class="dbody">${body}</div></details>`;

  /** 「其他处理」折叠（T002 三件套）：主按钮留给推荐动作，其余动作收这里。 */
  const otherActions = (buttonsHtml) => (buttonsHtml
    ? `<details class="details ca-other-actions"><summary>${esc(T('cognition.other_actions', '其他处理'))}</summary><div class="dbody"><div class="actions actions-right">${buttonsHtml}</div></div></details>`
    : '');

  const CATEGORIES = [
    ['personal', 'cognition.asset_category_personal', '关于我'],
    ['rule', 'cognition.asset_category_rule', '规则与偏好'],
    ['template', 'cognition.asset_category_template', '模板与范例'],
    ['skill_method', 'cognition.asset_category_skill_method', '技能与方法'],
    // 2026-09-21 原型 v7 第四类:事实与知识(项目/环境/领域/工具链的稳定事实)。
    ['fact', 'cognition.asset_category_fact', '事实与知识'],
  ];
  const categoryLabel = (type) => {
    const hit = CATEGORIES.find(([id]) => id === type);
    return hit ? T(hit[1], hit[2]) : T('cognition.asset_category_other', '其他');
  };

  // 状态章（2026-09-22 快赢）：active 从「已确认」改为「生效中」——与出身章
  // 「模型记的」并置时旧词读起来像"被确认过"，实际语义只是"当前在用"。
  // 顺带走 T() 补四语（此前硬编码中文，四语界面也显示中文）。
  const ASSET_STATUS = {
    active: [() => T('cognition.asset_status.active', '生效中'), 'green'],
    paused: [() => T('cognition.asset_status.paused', '已暂停'), 'amber'],
    archived: [() => T('cognition.asset_status.archived', '已归档'), ''],
    deleted: [() => T('cognition.asset_status.deleted', '已删除'), 'red'],
    purged: [() => T('cognition.asset_status.purged', '已清除'), 'red'],
    revoked: [() => T('cognition.asset_status.revoked', '已撤回'), 'red'],
  };
  const assetStatusChip = (asset) => {
    const entry = ASSET_STATUS[String(asset.status || 'active')];
    const [label, tone] = entry ? [entry[0](), entry[1]] : [T('cognition.asset_status_unknown', '状态未知'), ''];
    // 刀三（2026-09-22）：成熟度章收敛两态——transfer+ 统一「已实证」，未验证
    // 不摆章；工作名待认知树映射层统一定名。
    const maturity = ['transfer_validated', 'effectiveness_validated'].includes(String(asset.maturity || ''))
      ? chip(T('cognition.maturity_validated', '已实证'), 'green')
      : '';
    return chip(label, tone) + maturity;
  };
  // originChip（出身章「模型记的/系统沉淀」）已随出身收敛退役（2026-09-20）：
  // 模型记下来的=已确定，出身不再是显示维度；详情页转正按钮同批移除。
  /** 详情页头部章（2026-09-17 用户视角重构）：正常状态（active）不摆任何
   *  章——自己确认过的资产不需要解释；只有异常状态（暂停/删除/撤回等）
   *  才出章提醒。成熟度章只在列表行显示（快速识别），不进详情头部。 */
  const detailStatusChip = (asset) => {
    const status = String(asset.status || 'active');
    if (status === 'active') return '';
    const entry = ASSET_STATUS[status];
    const [label, tone] = entry ? [entry[0](), entry[1]] : [status, ''];
    return chip(label, tone);
  };

  /** 来源目录索引：证据解析与"多数不可用"判断共用这一份。 */
  function sourceIndex() {
    const index = new Map();
    for (const group of S.sources) {
      for (const item of (Array.isArray(group.items) ? group.items : [])) {
        if (item && item.id) index.set(String(item.id), item);
      }
    }
    return index;
  }

  /* ────────── 来源解析：唯一解析器 + 唯一呈现出口（2026-09-25 US-603）──────────
   * 修复前：候选与版本证据走 evidenceChip，资产详情的证据引用块却绕过它直接
   * esc(refId) 上屏，内部 id（immediate-* / kse-* / turn-*）就这么露给用户；
   * 来源异常行还有 `title || id` 的裸 id 兜底。现在解析规则收敛成
   * resolveSourceRef 一份、呈现收敛成 evidenceChip 一份，五处（候选 / 资产 /
   * 版本 / 使用记录 / KSTAR）共用 → 同一来源必然同名（AC1）。
   * 铁律：任何状态下都不得把 rawId 当显示名（AC3）。
   * 状态语义（诚实优先，且对"查无"一律 fail-closed）：
   *   available    解析出可读名（会话标题 / 复盘目标 / 文件名；含"存在但未起名"
   *                的会话，此时 name 为空由呈现层给泛称）
   *   immediate    对话中当场记（合成 id，本就没有独立出处）
   *   processing   来源整理中（目录里有，标题还没生成）
   *   unavailable  查无此来源（已删 / 无处核对 / 类型可辨但无从核对）
   *                →「来源记录不可用」，绝不回落裸 id */
  function resolveSourceRef(ref) {
    const raw = (ref && typeof ref === 'object') ? ref : {};
    const rawId = String(raw.id || raw.conversationId || raw.ref || '').trim();
    const kind = String(raw.kind || '').trim();
    const view = { kind, rawId, name: '', state: 'unavailable', openRoute: 'none', openTarget: '' };
    const asConversation = () => {
      if (!rawId || rawId.startsWith('immediate-')) return;
      view.openRoute = 'conversation';
      view.openTarget = rawId;
    };
    const inlineTitle = String(raw.title || raw.conversationTitle || raw.name || '').trim();
    // KSTAR 复盘优先于来源自带 title：ref 上那个 title 是写入时的机器串
    // （"KSTAR requirement episode"），用户要看的是这次任务的目标摘要。
    // degraded（写入时就解析不到）或已结算仍无摘要 = 确实没有这条，如实说不可用
    // 且不给可点假入口；"还没拉到"不在此列（读不到 ≠ 不存在）——维持可点与泛称。
    if (rawId.startsWith('kse-')) {
      const settled = (S.kstarSummariesSettled || []).includes(rawId);
      const summary = (S.kstarSummaries && S.kstarSummaries[rawId]) || null;
      if (raw.degraded || (settled && !summary)) return view;
      view.state = 'available';
      view.name = summary && summary.goal ? String(summary.goal).slice(0, 24) : '';
      view.openRoute = 'kstar';
      view.openTarget = rawId;
      return view;
    }
    // 写入时已带可读标题的来源（数据层已解析过）。
    if (inlineTitle) {
      view.name = inlineTitle;
      view.state = 'available';
      if (kind === 'conversation') asConversation();
      return view;
    }
    if (!rawId) return view;
    // 「对话中当场记」：合成 id，没有独立出处——不是被删，诚实标注。
    if (rawId.startsWith('immediate-')) { view.state = 'immediate'; return view; }
    const item = sourceIndex().get(rawId);
    if (item) {
      const itemTitle = String(item.title || '').trim();
      if (itemTitle) {
        view.name = itemTitle;
        view.state = 'available';
        // 目录项自带 kind 时以它为准（ref 上的 kind 可能是遗留词）。刻意先取
        // 独立变量再比较，不写成内联短路取值：cognition-chain-view 的源码守护
        // 按裸源码扫描（连注释一起），那种形状会被判成"机器码可能漏进展示文案"。
        const itemKind = String((item && item.kind) || '');
        if (kind === 'conversation' || itemKind === 'conversation') asConversation();
        return view;
      }
      if (['pending', 'processing'].includes(String(item.status || ''))) { view.state = 'processing'; return view; }
    }
    if (kind === 'conversation') {
      // 批量标题口（conversations.titles）补目录 100 条窗口外的会话；命中即有名。
      const titles = S.conversationTitles || {};
      if (Object.prototype.hasOwnProperty.call(titles, rawId)) {
        view.name = String(titles[rawId] || '').trim();
        view.state = 'available';
        asConversation();
        return view;
      }
      // 目录与标题口都查无 → 来源确实失效。**fail-closed，不软化**：宁可如实说
      // 「来源记录不可用」，也不给一个听起来正常却无从核对的泛称（既有契约，
      // 由 test/renderer/recall-source-display.test.ts 守住）。
      return view;
    }
    // 其余 kind 拿不到名字（如 turn-* 执行记录）：同样按不可用呈现——存在但
    // 无从核对，与"已删除"给用户的信息量一样，都不该退化成裸 id。
    return view;
  }

  // 来源三态（2026-09-20 修复「来源已删」误判）：available=目录命中/整理中；
  // immediate=对话中当场记（无独立会话出处——不是被删，诚实标注不计弱证据）；
  // unavailable=查无（引用的会话已不存在或无处核对）。
  // 2026-09-25 起判据统一由 resolveSourceRef 给出，本函数只做三态收敛——
  // 「待我处理」的断链口径与修复前完全一致（available/processing 算在，其余算
  // 不可用），不随呈现层一起漂。
  function sourceRefKind(ref) {
    const view = resolveSourceRef(ref);
    if (view.state === 'immediate') return 'immediate';
    return (view.state === 'available' || view.state === 'processing') ? 'available' : 'unavailable';
  }
  // 「对话中记」候选身份：captureKey `immediate-` 前缀（新）或引用 id 的
  // `immediate-` 前缀（存量）——两个信号源同前缀。
  function isImmediateCandidate(candidate) {
    if (candidate && typeof candidate.captureKey === 'string' && candidate.captureKey.startsWith('immediate-')) return true;
    return evidenceRefs(candidate).some((ref) => String(ref && ref.id || '').startsWith('immediate-'));
  }
  function sourceRefUnavailable(ref) {
    return sourceRefKind(ref) === 'unavailable';
  }
  function evidenceRefs(candidate) {
    return candidate.evidenceRefs || candidate.sourceRefs || [];
  }
  // 归组口径：按 id 去重（sourceRefs/evidenceRefs 存储上就是同内容双份），
  // 且「对话中当场记」不计弱证据——只有目录真查无的才算。
  function evidenceMostlyUnavailable(candidate) {
    const refs = evidenceRefs(candidate);
    if (!refs.length) return false;
    const seen = new Set();
    let unavailable = 0;
    let total = 0;
    for (const ref of refs) {
      const id = String(ref && (ref.id || ref.conversationId || ref.ref) || '').trim();
      if (id && seen.has(id)) continue;
      if (id) seen.add(id);
      total += 1;
      if (sourceRefKind(ref) === 'unavailable') unavailable += 1;
    }
    if (!total) return false;
    return unavailable * 2 > total;
  }
  /** 证据条目的**唯一**呈现出口（2026-09-17 子安"看不懂"口径：每类带类型前缀；
   *  2026-09-25 US-603：一律经 resolveSourceRef，任何分支都不上屏裸 id）。
   *  可解析的来源给回看入口（会话跳转 / 复盘展开），其余只显名。 */
  const evidenceChip = (ref) => {
    const view = resolveSourceRef(ref);
    if (view.state === 'immediate') return chip(T('cognition.evidence_immediate_note', '对话中当场记（无独立会话出处）'), 'line');
    if (view.state === 'unavailable') return chip(T('cognition.source_unavailable_label', '来源记录不可用'), 'line');
    if (view.state === 'processing') return chip(T('cognition.evidence_source_processing', '来源整理中'), 'line');
    if (view.openRoute === 'kstar') {
      const label = T('cognition.evidence_task_review', '任务复盘：{title}', {
        title: view.name || T('cognition.evidence_task_review_generic', '一次任务'),
      });
      return `<span class="tag blue chip-link" data-act="open-kstar-episode" data-id="${esc(view.rawId)}" ${roleBtn()} title="${esc(T('cognition.kstar_episode_open_hint', '查看这次任务的复盘'))}">${esc(label)}</span>`;
    }
    if (view.kind === 'user_teaching_signal') return chip(T('cognition.evidence_teaching', '你的一次明确表态'), 'line');
    if (view.kind === 'conversation') {
      if (String((ref && ref.subtype) || '') === 'message') return chip(T('cognition.evidence_message', '对话里的一条消息'), 'line');
      const label = view.name
        ? T('cognition.evidence_conversation_named', '对话：《{name}》', { name: view.name })
        : T('cognition.evidence_conversation_generic', '一段对话');
      // 可解析到会话就给回看入口（US-603 AC2）：点回原对话核对证据。
      if (view.openRoute === 'conversation' && view.openTarget) {
        return `<span class="tag gray chip-link" data-act="open-conversation" data-id="${esc(view.openTarget)}" ${roleBtn()} title="${esc(T('cognition.evidence_conversation_open_hint', '回到这段对话'))}">${esc(label)}</span>`;
      }
      return chip(label, 'line');
    }
    if (view.name) return chip(view.name, 'line');
    // 类型可辨但拿不到名字（如 turn-* 执行记录）：给中性泛称，不编造名字、
    // 也不回落裸 id。
    return chip(T('cognition.evidence_fallback', '来源记录'), 'line');
  };
  const isKstarEvidenceRef = (ref) => String(ref.kind || '') === 'execution' && String(ref.id || '').startsWith('kse-');
  /** 血统判据只认"还活着"的证据（2026-09-18 乙档）：被标 degraded 的复盘
   *  证据（写入时解析不到对应记录）不算 KSTAR 血统——查无的引用不能当出身。
   *  分组展示仍按形状走 isKstarEvidenceRef：一条脏证据也要显示在它该在的
   *  组里，只是标明不可用。 */
  const isLiveKstarEvidenceRef = (ref) => isKstarEvidenceRef(ref) && ref.degraded !== true;
  /** 归边判定（2026-09-17 B 档）：纯渲染层口径，不动主进程——身上挂有
   *  KSTAR 任务复盘证据（kind=execution 且 id 前缀 kse-），或带 KSTAR 学习
   *  信号/溯源（learningSignal.source=review|preference_scan、
   *  learningProvenance）即归 KSTAR 线。reason=review_decision 不能用作
   *  判据：对话线候选确认的版本也写这个前缀（两线共用确认队列）。
   *  挂 NS 供列表过滤与测试共用。 */
  NS.isKstarAsset = function isKstarAsset(asset) {
    if (!asset) return false;
    if (asset.learningProvenance) return true;
    const signal = asset.learningSignal;
    if (signal && ['review', 'preference_scan'].includes(String(signal.source || ''))) return true;
    return (asset.evidenceRefs || []).some(isLiveKstarEvidenceRef);
  };
  NS.isKstarCandidate = function isKstarCandidate(candidate) {
    if (!candidate) return false;
    if (candidate.learningSignal || candidate.learningProvenance) return true;
    return (candidate.sourceRefs || []).some((ref) => String(ref.id || '').startsWith('kse-') && ref.degraded !== true);
  };
  /** 证据分组（2026-09-17 B 档两线分开）：KSTAR 任务复盘一组、对话与表态
   *  一组，各带一句来源说明——两线证据混排一排正是"杂揉"观感的来源。 */
  const evidenceGroupsHtml = (refs) => {
    const kstar = refs.filter(isKstarEvidenceRef);
    const chat = refs.filter((ref) => !isKstarEvidenceRef(ref));
    const group = (titleKey, title, hintKey, hint, list) => list.length
      ? `<div class="evgroup">
          <div class="evgroup-title">${esc(T(titleKey, title))}<span class="note">${esc(T(hintKey, hint))}</span></div>
          <div class="chips">${list.map(evidenceChip).join('')}</div>
        </div>`
      : '';
    return group('cognition.evidence_group_kstar', '任务复盘', 'cognition.evidence_group_kstar_hint', '任务完结后系统复盘学到的', kstar)
      + group('cognition.evidence_group_chat', '对话与你的表态', 'cognition.evidence_group_chat_hint', '日常对话里总结出来的', chat);
  };

  /** 原始记录清洗（2026-09-17）：实际产出里会有 markdown 记号（**、##、代码
   *  块），原样展示是一坨看不懂的技术文本——去记号、折叠代码块、压空白。 */
  function stripMarkdown(text) {
    return String(text || '')
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/[`*#>_|]+/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }
  /** 长值折叠（specs/015 依据链复用件）：短值直出，超长/多行值套既有折叠样式
   *  （ca-tl-body/ca-tl-text，与整理详情的消息体同款）——不新造控件、不加 CSS。
   *  原生 <details> 自带三角标记，展开/收起无需 JS。 */
  function foldValue(text, limit) {
    const raw = String(text || '').trim();
    if (!raw) return '';
    const max = Number.isFinite(limit) ? Number(limit) : 160;
    const oneLine = raw.replace(/\s+/g, ' ').trim();
    if (raw.length <= max && !raw.includes('\n')) return `<p class="note">${esc(raw)}</p>`;
    return `<details class="ca-tl-body"><summary>${esc(oneLine.slice(0, max))}…</summary><div class="ca-tl-text">${esc(raw)}</div></details>`;
  }

  /** 归因枚举 → 人话（2026-09-17）：此前直接透传 execution_gap/unclear 这类
   *  内部枚举，用户看不懂"为什么"。 */
  const ATTRIBUTION_LABELS = {
    knowledge_gap: ['cognition.attribution_knowledge_gap', '缺相关知识'],
    rule_gap: ['cognition.attribution_rule_gap', '规则不合适'],
    template_gap: ['cognition.attribution_template_gap', '缺合适的模板'],
    skill_gap: ['cognition.attribution_skill_gap', '缺对应技能'],
    execution_gap: ['cognition.attribution_execution_gap', '执行环节没做到位'],
    unclear: ['cognition.attribution_unclear', '原因不明确'],
  };
  function attributionLabel(value) {
    const entry = ATTRIBUTION_LABELS[String(value || '')];
    return entry ? T(entry[0], entry[1]) : '';
  }

  /** 任务经过块（2026-09-17 二次改，白话化）：点证据 chip 就地展开"当时
   *  这次任务发生了什么"——字段是内部语言（attribution 枚举、markdown
   *  原文、与目标重复的 expectedResult），逐项翻成人话：当时的目标 /
   *  实际发生（清洗+截断）/ 结果 / 为什么 / 学到的。 */
  function kstarEpisodeSection(route) {
    const id = String(route.kstarEpisodeId || '');
    if (!id) return '';
    const state = S.kstarEpisode;
    if (!state || state.episodeId !== id) {
      return `<div class="sect-block"><div class="sub">${esc(T('cognition.kstar_episode_loading', '正在读取这次任务的经过…'))}</div></div>`;
    }
    const review = state.review || {};
    const goal = String((state.episode && state.episode.goal) || '').trim();
    const expected = stripMarkdown(review.expectedResult);
    const actual = stripMarkdown(review.actualResult).slice(0, 160);
    const outcomeText = {
      better_than_expected: T('cognition.review_outcome_better', '比预期好'),
      met_expected: T('cognition.review_outcome_met', '符合预期'),
      worse_than_expected: T('cognition.review_outcome_worse', '比预期差'),
      unclear: T('cognition.review_outcome_unclear', '结果不明'),
    }[String(review.outcome || '')] || '';
    const row = (label, value) => value ? `<div class="meta-item"><span class="meta-k">${esc(label)}</span><span class="meta-v">${esc(String(value))}</span></div>` : '';
    return `<div class="sect-block ca-episode-detail">
      <div class="tt">${esc(T('cognition.kstar_episode_detail_title', '这次任务的经过'))}</div>
      <div class="meta-row">
        ${row(T('cognition.kstar_episode_goal_label', '当时的任务'), goal)}
        ${expected && expected !== goal ? row(T('cognition.review_signal_expected', '期望的结果'), expected) : ''}
        ${row(T('cognition.review_signal_actual', '实际发生'), actual)}
        ${row(T('cognition.review_signal_outcome', '结果'), outcomeText)}
        ${row(T('cognition.review_signal_attribution', '为什么'), attributionLabel(review.attribution))}
        ${row(T('cognition.kstar_lesson_label', '沉淀的经验'), review.lesson)}
      </div>
      ${btn(T('common.close', '收起'), 'open-kstar-episode', { id: '', small: true })}
    </div>`;
  }

  const candidatePending = (candidate) => !!(candidate.capabilities && candidate.capabilities.countsAsPending);
  /** 候选来源徽章（2026-09-16 KSTAR 融合）：三条产出线可辨——KSTAR 复盘
   *  （learningSignal/learningProvenance）、KSTAR 偏好（source=preference_scan，
   *  确定性扫描线）、会话整理（capture 线，无信号）。KSTAR 两条线的徽章
   *  文案必须带 "KSTAR" 前缀（子安口径：用户可辨，不接受裸"任务复盘"）。 */
  function candidateSourceBadge(candidate) {
    const signal = candidate.learningSignal;
    if (signal && String(signal.source || '') === 'preference_scan') {
      return chip(T('cognition.source_pref_scan', '偏好扫描'));
    }
    if (signal || candidate.learningProvenance) return chip(T('cognition.source_kstar_review', '任务复盘'));
    if (isImmediateCandidate(candidate)) return chip(T('cognition.source_immediate', '对话中记'));
    return chip(T('cognition.source_capture', '会话整理'));
  }
  /** 复盘结果枚举 → 人话（三处共用：任务经过 / 复盘依据 / 依据链）。 */
  function reviewOutcomeText(value) {
    return {
      better_than_expected: T('cognition.review_outcome_better', '比预期好'),
      met_expected: T('cognition.review_outcome_met', '符合预期'),
      worse_than_expected: T('cognition.review_outcome_worse', '比预期差'),
      unclear: T('cognition.review_outcome_unclear', '结果不明'),
    }[String(value || '')] || '';
  }

  /** KSTAR 候选的复盘依据块（2026-09-16）：预期/实际/结果四行——知道"这条
   *  是从哪次成败学来的"，确认保存才心里有底。
   *  更新型候选不再走这里（依据链已含预期→实际段，避免同屏两份）。 */
  function reviewSignalBlock(candidate) {
    const signal = candidate.learningSignal;
    const provenance = candidate.learningProvenance;
    if (!signal && !provenance) return '';
    const outcomeText = reviewOutcomeText(signal && signal.outcome);
    const row = (label, value) => value ? `<div class="meta-item"><span class="meta-k">${esc(label)}</span><span class="meta-v">${esc(String(value).slice(0, 200))}</span></div>` : '';
    return `<div class="sect-block">
      <div class="tt">${esc(T('cognition.review_signal_title', '复盘依据'))}</div>
      <div class="meta-row">
        ${row(T('cognition.review_signal_expected', '期望的结果'), stripMarkdown(signal && signal.expectedResult))}
        ${row(T('cognition.review_signal_actual', '实际发生'), stripMarkdown(signal && signal.actualResult).slice(0, 160))}
        ${row(T('cognition.review_signal_outcome', '结果'), outcomeText)}
        ${row(T('cognition.review_signal_attribution', '为什么'), attributionLabel(provenance && provenance.attribution))}
      </div>
    </div>`;
  }

  /* ────────────── 依据链（specs/015 US-701 AC1/AC2，2026-09-25）──────────────
   * 更新型候选（update / limit_scope 且带目标方法）把「凭什么改这条方法」摊开：
   * 原方法与版本 / 同次任务 / 预期→实际 / 采用证据 / 为什么改 / 适用范围 / 改动点。
   * 口径：
   *  - 来源名一律走唯一解析器 resolveSourceRef（铁律：任何状态都不上屏 rawId）；
   *  - 长值复用既有折叠样式（foldValue），不新造控件、不加 CSS；
   *  - 只渲染候选自己的字段与已核对的回执摘要，**不整条 dump 记录**——受限正文
   *    不进界面；学习信号里的机器码评分（内部字段）一概不上屏；
   *  - 存量候选没有 targetVersionUsed 时如实说"无法核对改进对象"，不伪造版本；
   *  - 新建型没有"原方法"可回指，返回空串（措辞仍是「保存并使用」）。 */

  /** 结论 reason 是主进程写的人话短句，但句子里嵌了内部 id（「aa-…」/「ksf-…」）——
   *  US-603 铁律：rawId 不上屏。已知资产换标题、其余换泛称，句子其余部分照原样。
   *  只认主进程真的会写进结论的那几种前缀（aa/aur/kio/kse/ksf/ksr/ksp/rcand/rcap/
   *  immediate）：宁可漏掉没见过的前缀，也不拿通用规则去改人话里的连字符词。 */
  const INTERNAL_ID_RE = /\b(?:aa|aur|kio|kse|ksf|ksr|ksp|rcand|rcap|immediate)-[A-Za-z0-9-]{2,}\b/g;
  function stripInternalIds(text) {
    return String(text || '').replace(INTERNAL_ID_RE, (id) => {
      const asset = S.assets.find((row) => String(row.id) === id);
      if (asset) return String(asset.title || '').trim() || T('cognition.improvement_ref_asset_generic', '这条方法');
      return T('cognition.improvement_ref_generic', '相关记录');
    });
  }

  /** 采用证据段（依据链第④段）：唯一权威 = usage 回执 `applied`（只读通道
   *  `recall.assets.adoptionReceipts` 按目标方法拉，见 core.loadAdoptionReceipts）。
   *  候选记录了 taskRunId（同次任务）时只认那一次：对不上就如实说这次任务里没有，
   *  不拿别的任务的采用记录凑数；存量候选没有 taskRunId 时才展示该方法的采用记录。 */
  function adoptionEvidenceHtml(candidate, target) {
    const state = (S.adoptionReceipts && String(S.adoptionReceipts.assetId || '') === String(target.id))
      ? S.adoptionReceipts
      : null;
    const items = (state && Array.isArray(state.items)) ? state.items : [];
    const applied = items.filter((receipt) => String(receipt.status || '') === 'applied');
    const taskRunId = String(candidate.taskRunId || '');
    const scoped = taskRunId ? applied.filter((receipt) => String(receipt.taskRunId || '') === taskRunId) : [];
    const picked = taskRunId ? scoped : applied;
    if (picked.length) {
      const first = picked[0];
      const version = String(first.assetVersion || '');
      const names = (Array.isArray(first.evidence) ? first.evidence : [])
        .map((ref) => resolveSourceRef(ref))
        .map((view) => view.name)
        .filter(Boolean);
      return [
        `<p class="note">${esc(version
          ? T('cognition.chain_adoption_line', '任务里实际采用了 v{version}', { version })
          : T('cognition.chain_adoption_line_bare', '任务里实际采用了这条方法'))}</p>`,
        names.length ? `<p class="note">${esc(T('cognition.adoption_evidence_line', '证据：{names}', { names: names.join('、') }))}</p>` : '',
        picked.length > 1 ? `<p class="note">${esc(T('cognition.chain_adoption_more', '另有 {n} 条采用记录', { n: String(picked.length - 1) }))}</p>` : '',
      ].filter(Boolean).join('');
    }
    // 还没读到（或正在读）：说"正在读"，不说"没有"——读不到 ≠ 没有。
    if (!state || state.loading) {
      return `<p class="note">${esc(T('cognition.chain_adoption_loading', '正在读取采用证据…'))}</p>`;
    }
    return `<p class="note">${esc(taskRunId
      ? T('cognition.chain_adoption_task_missing', '这次任务里没有查到实际采用的记录（只被带入不算采用）。')
      : T('cognition.chain_adoption_empty', '没有查到这条方法的实际采用记录。'))}</p>`;
  }

  /** 这条候选正在展示的"版本冲突"状态（core.openCandidateVersionConflict 写入）。
   *  冲突后依据链必须按**当前在用版**说话：正文与在用版号都以冲突返回体为准
   *  （资产列表即使没刷新成功，也不许拿旧版号/旧正文冒充当前版）。 */
  function candidateConflictState(candidate) {
    const state = S.candidateVersionConflict;
    if (!state || String(state.candidateId) !== String((candidate || {}).id)) return null;
    return state;
  }

  function improvementChainBlock(candidate) {
    const mutating = ['update', 'limit_scope'].includes(String(candidate.suggestedAction || ''));
    if (!mutating || !candidate.targetAssetId) return '';
    const target = S.assets.find((a) => String(a.id) === String(candidate.targetAssetId));
    if (!target) return '';
    const conflict = candidateConflictState(candidate);
    const activeVersion = String((conflict && conflict.currentVersion) || target.activeVersion || target.version || '1');
    // 冲突态下正文只认冲突返回体那一份（core 刚强制重拉的当前在用版快照）：
    // 读不到就说读不到，**不退回资产列表里的旧正文**——拿旧正文当"当前版"
    // 正是这一步要消灭的假象。
    const activeStatement = (conflict
      ? String(conflict.currentStatement || '')
      : String(target.statement || '')).trim();
    const usedVersion = String(candidate.targetVersionUsed || '');
    // 既有版本核对预提示原样保留（展示期口径；确认期冲突是另一回事）。
    const mismatch = usedVersion && usedVersion !== activeVersion
      ? `<div class="warn">${esc(T('cognition.candidate_version_mismatch', '核对改进对象：任务当时使用的是 v{used}，该资产当前在用 v{active}——确认这次更新应作用在当前在用版上。', { used: usedVersion, active: activeVersion }))}</div>`
      : '';
    const fusionNote = `<div class="note">${esc(T('cognition.candidate_fusion_note', '确认后会把这段内容与下面的当前版本融合成一个新版本（旧内容保留、可随时切回），不是覆盖。'))}</div>`;
    const field = (label, inner) => `<div class="field"><span>${esc(label)}</span>${inner}</div>`;

    // ① 原方法与版本：方法名 + 「任务当时用 v{n} / 当前在用 v{m}」。
    const targetName = String(target.title || '').trim() || T('cognition.candidate_untitled', '未命名候选');
    const targetField = field(
      T('cognition.chain_target_label', '这条改进针对的方法'),
      `<p class="note">${esc(targetName)}</p><p class="note">${esc(usedVersion
        ? T('cognition.chain_target_versions', '任务当时用 v{used}，当前在用 v{active}', { used: usedVersion, active: activeVersion })
        : T('cognition.chain_target_no_version', '这条候选没有记录任务当时的版本（存量数据），无法核对改进对象。'))}</p>`,
    );

    // ② 同次任务：优先 learningProvenance.episodeId，退回候选自带的 KSTAR 复盘证据引用；
    //    来源名走唯一解析器（点 chip 就地展开这次任务的经过）。
    const provenanceEpisodeId = String((candidate.learningProvenance && candidate.learningProvenance.episodeId) || '');
    const evidenceEpisodeId = String((evidenceRefs(candidate).find(isKstarEvidenceRef) || {}).id || '');
    const episodeId = provenanceEpisodeId || evidenceEpisodeId;
    const taskField = field(
      T('cognition.chain_task_label', '同次任务'),
      episodeId
        ? `<div class="chips">${evidenceChip({ kind: 'execution', id: episodeId })}</div>`
        : `<p class="note">${esc(T('cognition.chain_task_missing', '这条改进没有关联到具体的任务复盘，无法回看当时的经过。'))}</p>`,
    );

    // ③ 预期 → 实际（learningSignal）：期望 / 实际 / 结果，长值折叠。
    const signal = candidate.learningSignal || {};
    const expected = stripMarkdown(signal.expectedResult);
    const actual = stripMarkdown(signal.actualResult);
    const outcomeText = reviewOutcomeText(signal.outcome);
    const signalLines = [
      expected ? foldValue(`${T('cognition.review_signal_expected', '期望的结果')}：${expected}`) : '',
      actual ? foldValue(`${T('cognition.review_signal_actual', '实际发生')}：${actual}`) : '',
      outcomeText ? `<div class="chips">${chip(outcomeText, 'line')}</div>` : '',
    ].filter(Boolean).join('');
    const signalField = field(
      T('cognition.chain_signal_label', '预期 → 实际'),
      signalLines || `<p class="note">${esc(T('cognition.chain_signal_missing', '这次改进没有记录预期与实际结果。'))}</p>`,
    );

    // ④ 采用证据
    const adoptionField = field(T('cognition.chain_adoption_label', '采用证据'), adoptionEvidenceHtml(candidate, target));

    // ⑤ 为什么改：不确定的地方 + 带来的价值（候选既有字段）。
    const reasonLines = [
      String(candidate.uncertainty || '').trim()
        ? foldValue(`${T('cognition.chain_uncertainty_label', '还不确定的地方')}：${String(candidate.uncertainty).trim()}`)
        : '',
      String(candidate.value || '').trim()
        ? foldValue(`${T('cognition.chain_value_label', '带来的价值')}：${String(candidate.value).trim()}`)
        : '',
    ].filter(Boolean).join('');
    const reasonField = field(
      T('cognition.chain_reason_label', '为什么改'),
      reasonLines || `<p class="note">${esc(T('cognition.chain_reason_missing', '这条候选没有记录改动原因。'))}</p>`,
    );

    // ⑥ 适用范围（沿用资产侧的既有措辞）。
    const applicable = (Array.isArray(candidate.applicableWhen) ? candidate.applicableWhen : []).map(String).filter(Boolean);
    const forbidden = (Array.isArray(candidate.forbiddenWhen) ? candidate.forbiddenWhen : []).map(String).filter(Boolean);
    const scopeLines = [
      applicable.length ? foldValue(`${T('cognition.asset_version_applicable', '适用场景')}：${applicable.join('；')}`) : '',
      forbidden.length ? foldValue(`${T('cognition.asset_version_forbidden', '禁用场景')}：${forbidden.join('；')}`) : '',
    ].filter(Boolean).join('');
    const scopeField = field(
      T('cognition.asset_scope_label', '适用范围'),
      scopeLines || `<p class="note">${esc(T('cognition.chain_scope_missing', '这条候选没有限定适用范围。'))}</p>`,
    );

    // ⑦ 改动点：当前在用版正文（长值折叠）+ 拟生效内容的位置提示。
    //    拟生效的正文就在紧跟本块的编辑区/正文里：这里再复制一份，用户改了控件
    //    上面的摘要还是旧文本（"显示 A 实际 B"）——所以只指位置，不复制内容。
    //    正处版本冲突时按冲突块的口径说话（当前在用版正文 / 确定性读不到）。
    const changedField = conflict
      ? field(
        T('cognition.chain_changed_label', '改动点'),
        activeStatement
          ? foldValue(`${T('cognition.candidate_current_version', '当前版本（v{n}）', { n: activeVersion })}：${activeStatement}`)
          : `<p class="note">${esc(T('cognition.candidate_version_conflict_body_missing', '没能读到当前在用版的正文，无法核对改进对象——先刷新页面再试；也可以先稍后处理或拒绝。'))}</p>`,
      )
      : field(
        T('cognition.chain_changed_label', '改动点'),
        `${foldValue(`${T('cognition.candidate_current_version', '当前版本（v{n}）', { n: activeVersion })}：${activeStatement}`)}<p class="note">${esc(T('cognition.chain_proposed_hint', '这条候选拟生效的内容在下面，可对照当前版本核对。'))}</p>`,
      );

    return `<div class="sect-block ca-chain">
      ${mismatch}
      <div class="tt">${esc(T('cognition.improvement_chain_title', '改进依据'))}</div>
      ${targetField}
      ${taskField}
      ${signalField}
      ${adoptionField}
      ${reasonField}
      ${scopeField}
      ${changedField}
      ${fusionNote}
    </div>`;
  }

  /* ────────────── 确认更新撞版本冲突（specs/015 US-702 T022，2026-09-25）──────
   * 确认时主进程在资产锁内判定"候选锚定的版本 ≠ 当前在用版"：这次**没有生效**
   * （资产零改动、候选仍待处理）。这里做四件事：
   *  ① 如实说清"没生效、也没覆盖"（不静默覆盖，更不假装成功）；
   *  ② 按**当前在用版**重新摆一次差异——正文取 versions.list 的当前在用版快照
   *     （core 已强制重拉，不是候选生成时那份旧差异）；
   *  ③ 给「按当前版本重新确认」——只有用户点它才会重发这次确认（core.adoptCandidate
   *     在该候选仍有冲突状态时随这次点击带 `confirmBaselineVersion = 当前在用版`），
   *     绝不自动重试；
   *  ④ 拿不到当前在用版正文时如实说"无法核对改进对象"，且**不给**重锚按钮
   *     （用户没看过最新差异就重锚 = 又一次盲确认，正是本流程要消灭的东西；
   *     稍后处理/拒绝仍在，不至于死锁）。存量候选没有版本锚点（versionCheckSkipped）
   *     走的是依据链既有的"无法核对改进对象"表述，同样没有重锚按钮。 */
  function candidateVersionConflictBlock(candidate, canPromote) {
    const state = candidateConflictState(candidate);
    if (!state) return '';
    const used = String(state.targetVersionUsed || '');
    const baseline = String(state.baselineVersion || used || '');
    const current = String(state.currentVersion || '');
    const field = (text, inner) => `<div class="field"><span>${esc(text)}</span>${inner}</div>`;
    // ① 不静默覆盖：事实优先，版本号读不全时退回不给数字的表述（不编版本号）。
    const notApplied = baseline && current
      ? T('cognition.candidate_version_conflict_not_applied', '这条方法在你确认之前被改过（v{baseline} → v{current}），这次确认没有生效，也没有覆盖现在的版本。', { baseline, current })
      : T('cognition.candidate_version_conflict_not_applied_plain', '这条方法在你确认之前被改过，这次确认没有生效，也没有覆盖现在的版本。');
    const head = `<div class="warn">${esc(notApplied)}</div>
      <div class="tt">${esc(T('cognition.candidate_version_conflict_title', '按当前在用版重新核对'))}</div>`;

    // 读不到当前在用版正文：如实说，不给重锚按钮（见文件头 ④）。
    if (state.versionsLoading) {
      return `<div class="sect-block ca-version-conflict" data-version-conflict="${esc(String(candidate.id || ''))}">
        ${head}<p class="note">${esc(T('cognition.candidate_version_conflict_loading', '正在读取当前在用版的正文…'))}</p>
      </div>`;
    }
    const snapshot = state.currentSnapshot || null;
    const currentStatement = String(((snapshot || {}).statement) || '').trim();
    if (state.versionsFailed || !currentStatement) {
      return `<div class="sect-block ca-version-conflict" data-version-conflict="${esc(String(candidate.id || ''))}">
        ${head}<p class="note">${esc(T('cognition.candidate_version_conflict_body_missing', '没能读到当前在用版的正文，无法核对改进对象——先刷新页面再试；也可以先稍后处理或拒绝。'))}</p>
      </div>`;
    }

    // ② 按当前在用版重新摆差异：短字段逐项「当前 → 拟生效」，正文两份摊开。
    //    只列真的不同的项（对齐资产侧版本对比的呈现口径），全同则明说一致。
    const text = (value) => (Array.isArray(value) ? value.join('、') : String(value || '')).trim() || '—';
    const rows = [
      [T('cognition.asset_version_diff_title_field', '标题'), text(snapshot.title), text(candidate.summary)],
      [T('cognition.asset_edit_field_applicable', '适用场景'), text(snapshot.applicableWhen), text(candidate.applicableWhen)],
      [T('cognition.asset_edit_field_forbidden', '禁用场景'), text(snapshot.forbiddenWhen), text(candidate.forbiddenWhen)],
      [T('cognition.asset_version_diff_scope', '适用范围'), text(snapshot.scope), text(candidate.suggestedScope)],
    ].filter((row) => row[1] !== row[2]);
    const fieldDiffRows = rows.length
      ? rows.map(([name, from, to]) => `<div class="meta-item"><span class="meta-k">${esc(name)}</span><span class="meta-v">${esc(from)} → ${esc(to)}</span></div>`).join('')
      : `<p class="note">${esc(T('cognition.asset_version_diff_same', '两版内容一致。'))}</p>`;
    const bodyFields = [
      field(T('cognition.candidate_version_conflict_current_body', '当前在用（v{n}）的正文', { n: current }), foldValue(currentStatement)),
      field(T('cognition.candidate_version_conflict_proposed_body', '这条候选拟生效的内容'), foldValue(String(candidate.judgment || ''))),
    ].join('');
    // ③ 再次确认：只有用户点它才重发确认（act 与「确认更新」同一个写入通道，
    //    区别由 core 侧的冲突状态承载——附带 confirmBaselineVersion = 当前在用版），
    //    绝不自动重试。重锚按钮只在能摆出差异时给（见文件头 ④）。
    const rebase = canPromote && current
      ? `<div class="actions actions-right">${btn(T('cognition.candidate_version_conflict_rebase', '按当前版本重新确认'), 'cand-adopt-with-form', { id: candidate.id, data: { rebase: '1' }, primary: true })}</div>`
      : '';
    return `<div class="sect-block ca-version-conflict" data-version-conflict="${esc(String(candidate.id || ''))}">
      ${head}
      ${fieldDiffRows}
      ${bodyFields}
      <div class="note">${esc(T('cognition.candidate_fusion_note', '确认后会把这段内容与下面的当前版本融合成一个新版本（旧内容保留、可随时切回），不是覆盖。'))}</div>
      ${rebase}
    </div>`;
  }

  /** 待确认口径（2026-09-16 B1 统一）：需要用户判断且未被"稍后处理"静音。
   *  统计卡与全局 stats 共用这一份（单一事实源），杜绝 7/5/0 三数分叉；
   *  deferred 行仍在列表可见（子安口径：与待确认同形态），只是不占
   *  "等待确认"名额并带「已稍后处理」标注。 */
  const candidateAwaiting = (candidate) => candidatePending(candidate) && !(candidate.capabilities && candidate.capabilities.isSnoozed);
  /** 候选显示名（2026-09-16 修）：优先模型提炼的 summary 短标题——此前
   *  judgment 截断 60 字优先，卡片名成了"内容前缀"看不懂；无 summary 的
   *  存量候选用类别 + 判断前 12 字克制兜底，两者皆空给未命名。 */
  const candidateTitle = (candidate) => {
    const summary = String(candidate.summary || '').trim();
    if (summary) return summary.length > 24 ? `${summary.slice(0, 24)}…` : summary;
    const judgment = String(candidate.judgment || '').trim();
    if (judgment) {
      const label = categoryLabel(candidate.suggestedType);
      return `${label ? `${label} · ` : ''}${judgment.slice(0, 12)}${judgment.length > 12 ? '…' : ''}`;
    }
    return T('cognition.candidate_untitled', '未命名候选');
  };

  /* ── 决策三态与按钮名（specs/015 US-702 T023，2026-09-25）──────────────
   * 判据只有一个：**改的是已存在的那条方法**才说「确认更新」——即
   * `suggestedAction ∈ {update, limit_scope}` **且**带 `targetAssetId`。
   *  - 没有目标方法的候选（`create`，或 `update` 却缺 `targetAssetId`）一律按
   *    新建型渲染：对不存在的旧版说"更新"是假话；
   *  - `pause` 提案（主进程走 pauseAbilityAsset，没有版本比对面）也保持既有
   *    措辞：它既不是"更新成新版"，也没有可重锚的差异面；
   *  - 「稍后处理 / 拒绝」的**更新型**文案与 008 审批卡片共用同一批词条：
   *    产品口径是"两边三态与按钮名统一"（spec.md L40），共用键从源头杜绝
   *    两处各写一套后漂移；新建型的「保存并使用 / 不保存」保持既有措辞。 */
  const candidateUpdateType = (candidate) => {
    const action = String((candidate || {}).suggestedAction || '');
    return (action === 'update' || action === 'limit_scope') && !!String((candidate || {}).targetAssetId || '');
  };
  const candidateDecisionLabels = (candidate) => (candidateUpdateType(candidate)
    ? {
      promote: T('recall.asset_approval.confirm', '确认更新'),
      defer: T('recall.asset_approval.defer', '稍后处理'),
      reject: T('recall.asset_approval.reject', '拒绝'),
    }
    : {
      promote: T('cognition.candidate_save_and_use', '保存并使用'),
      defer: T('cognition.candidate_defer_action', '稍后处理'),
      reject: T('cognition.candidate_reject', '不保存'),
    });

  /* 整理任务行内动作（整理记录行与整理详情共用）：主按钮按优先级取一个，
   * 暂停/取消作次级；导航类动作（去确认/配置模型）在 app.js 分流，控制类走
   * capture-action（与后端 actions 语义 id 一字不差）。 */
  const CAPTURE_PRIMARY_ORDER = ['review_candidates', 'run_now', 'resume', 'retry', 'configure_model', 'view_assets'];
  const CAPTURE_NAV_ACTS = { review_candidates: 'go-review', configure_model: 'go-configure-model' };
  function captureActionButtons(capture) {
    const vocab = NS.vocabulary;
    const actions = Array.isArray(capture.actions) ? capture.actions : [];
    const primary = CAPTURE_PRIMARY_ORDER.find((action) => actions.includes(action));
    const primaryBtn = primary === 'view_assets'
      ? btn(T('cognition.capture_action_view_assets', '查看资产'), 'open-asset', { id: (capture.linkedAssetIds || [])[0] || '', small: true, primary: true })
      : primary && CAPTURE_NAV_ACTS[primary]
        ? btn(vocab ? vocab.captureActionText(primary) : primary, CAPTURE_NAV_ACTS[primary], { small: true, primary: true })
        : primary
          ? btn(vocab ? vocab.captureActionText(primary) : primary, 'capture-action', { id: capture.id, data: { action: primary }, small: true, primary: true })
          : '';
    const secondaryBtns = ['pause', 'cancel'].filter((action) => actions.includes(action)).map((action) => btn(
      vocab ? vocab.captureActionText(action) : action,
      'capture-action',
      { id: capture.id, data: { action }, small: true, danger: action === 'cancel' },
    )).join('');
    return primaryBtn + secondaryBtns;
  }

  /* ────────────────────────── 认知树 v4（光斑有机版） ────────────────────────── */
  /* 垂直轴 = 处理梯度：土壤（来源与整理）→ 根（待确认候选）→ 干（个人本体）
     → 枝（四类资产）→ 冠（已验证）。层级语义（2026-09-21 原型 v7 契约）：
     枝端光斑 = 大方向分类；叶片 = 细分方向（家族组名 → 标题冒号前主题 →
     标题，同方向合并计数）；单条资产不渲染成光斑——树上没有资产级节点，
     树冠/根部各只有一个聚合光斑。视觉走 Organic Biophilic：贝塞尔枝、
     径向渐变光斑、锥形树干；SVG viewBox 自适应，无需手动 resize 重绘。 */

  /** 叶片方向派生 + 同方向合并计数。返回 [[方向名, n], ...]（按量降序）。
   *  取名口径与原型一致：优先族名，其次标题冒号/箭头前的头段。
   *  （specs/012 T016 定调：族名 = **同源血缘**，不是主题分类——主题分类
   *  见资产的 `tags`；这里只是拿血缘名当叶片的默认方向名，逻辑不动。） */
  function branchDirections(assets) {
    const map = new Map();
    for (const a of assets) {
      const title = String(a.title || '').trim();
      if (!title) continue;
      const family = String(a.familyName || '').trim();
      const colonAt = Math.min(...[title.indexOf(':'), title.indexOf('：'), title.indexOf('→')].filter((i) => i > 0).concat([title.length]));
      const theme = family || (colonAt < title.length ? title.slice(0, colonAt).trim() : '') || title;
      const key = theme.slice(0, 14);
      if (!key) continue;
      map.set(key, (map.get(key) || 0) + 1);
    }
    return [...map.entries()].sort((x, y) => y[1] - x[1]);
  }

  /** 四主枝（2026-09-21 第四枝定调）：技能与方法 / 事实与知识 / 规则与偏好 / 模板与范例。
   *  side/len/y 是原型 v7 的几何参数：两条上枝（y=.32）分列左右，两条下枝（y=.72）更短。 */
  const TREE_BRANCHES = [
    /* y = 枝端高度系数（占干顶以下可用地面的比例，越大越高）。下枝组
       0.32 → 0.44：原值末梢扫到近土面、下垂像柳树（2026-09-21 子安真机
       抓出），抬高后接近真实树形。 */
    { id: 'skill_method', key: 'cognition.tree_branch_skill_method', fallback: '技能与方法', side: -1, len: 400, y: 0.44 },
    { id: 'fact', key: 'cognition.tree_branch_fact', fallback: '事实与知识', side: 1, len: 360, y: 0.44 },
    { id: 'rule', key: 'cognition.tree_branch_rule', fallback: '规则与偏好', side: -1, len: 286, y: 0.72 },
    { id: 'template', key: 'cognition.tree_branch_template', fallback: '模板与范例', side: 1, len: 304, y: 0.72 },
  ];

  /* ── 认知树图示（原型 v7 drawTree 的移植）─────────────────────────────
     原型按容器实测像素画图（viewBox 自适应），所以这里同样产出「以当前
     视口尺寸为坐标」的 SVG：宽高由 treeViewport() 量出，容器 resize 后
     重画一次。视觉层次：土壤 → 根芽 → 枝上大方向 → 树冠已验证，
     枝端光斑=分类、叶片=细分方向。 */

  /** 容器像素尺寸：原型读 svg.clientWidth/clientHeight，画完一帧后就有了
   *  真值；首帧（容器里还没有 svg）退回 1240×760，app.js 量到不一致会重画一次。 */
  let treeSize = { W: 1240, H: 760 };
  function treeViewport() {
    const el = typeof document !== 'undefined' ? document.getElementById('ca-tree-svg') : null;
    if (el && el.clientWidth) treeSize = { W: el.clientWidth, H: el.clientHeight };
    return treeSize;
  }

  /** 单个光斑（原型 spotSvg）：halo 双层 + 实心核 + 可选 KSTAR 点 + 可选标签。 */
  function spotSvg(o) {
    const kstar = o.kstar
      ? `<circle class="spot-kstar" cx="${(o.x + o.r * 0.72).toFixed(1)}" cy="${(o.y - o.r * 0.72).toFixed(1)}" r="4"/>`
      : '';
    const hasLabel = o.tx !== undefined && o.ty !== undefined;
    const labelText = o.title.length > 16 ? `${o.title.slice(0, 15)}…` : o.title;
    return `<g class="spot${o.sel ? ' sel' : ''}" ${roleBtn(`data-act="${esc(o.act)}"${o.id ? ` data-id="${esc(o.id)}"` : ''} data-title="${esc(o.title)}" data-sub="${esc(o.sub || '')}" aria-label="${esc(o.aria || o.title)}"`)}>
      ${o.glow ? `<circle class="halo" cx="${o.x.toFixed(1)}" cy="${o.y.toFixed(1)}" r="${(o.r * 2.1).toFixed(1)}" fill="${o.color}" opacity=".24" filter="url(#ca-tree-glow)"/>` : ''}
      <circle class="halo" cx="${o.x.toFixed(1)}" cy="${o.y.toFixed(1)}" r="${(o.r + 5).toFixed(1)}" fill="${o.color}" opacity=".12"/>
      <circle class="core" cx="${o.x.toFixed(1)}" cy="${o.y.toFixed(1)}" r="${o.r}" fill="${o.color}" stroke="var(--color-white)" stroke-width="1.8"/>
      ${kstar}
      ${hasLabel ? `<text ${o.labelId ? `id="${esc(o.labelId)}" ` : ''}x="${o.tx.toFixed(1)}" y="${o.ty.toFixed(1)}" text-anchor="middle" class="spot-label">${esc(labelText)}</text>` : ''}
    </g>`;
  }

  function treeFigure(info, directions) {
    const { W, H } = treeViewport();
    const cx = W / 2;
    const groundY = H - 148;
    /* 树冠几何：云团坐在树干顶上（冠底盖过干顶 ~62px），窗口再高也不脱开
       （2026-09-21 子安真机两连抓出）。clamp 防矮窗口把云团顶出画布。 */
    const trunkTop = groundY - 392;
    const crownCy = Math.max(96, trunkTop - 56);
    const pending = Number(info.pending || 0);
    const validated = Number(info.validated || 0);
    const catCount = (id) => Number((info.counts || {})[id] || 0);

    /* defs：树干/枝条/叶片/树冠/光斑五套渐变 + 柔光滤镜（与原型同名同色）。 */
    let g = `<defs>
      <filter id="ca-tree-glow" x="-80%" y="-80%" width="260%" height="260%">
        <feGaussianBlur stdDeviation="6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
      <linearGradient id="ca-trunk-grad" x1="0" x2="1">
        <stop offset="0" class="trunk-hi"/><stop offset=".48" class="trunk-mid"/><stop offset="1" class="trunk-lo"/>
      </linearGradient>
      <linearGradient id="ca-branch-grad" x1="0" x2="1">
        <stop offset="0" class="branch-hi"/><stop offset="1" class="branch-lo"/>
      </linearGradient>
      <linearGradient id="ca-leaf-grad" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" class="leaf-hi"/><stop offset="1" class="leaf-lo"/>
      </linearGradient>
      <radialGradient id="ca-crown-grad" gradientUnits="userSpaceOnUse" cx="${cx}" cy="${crownCy - 90}" r="${330}">
        <stop offset="0" class="crown-1"/><stop offset=".55" class="crown-2"/><stop offset="1" class="crown-3"/>
      </radialGradient>
      <radialGradient id="ca-orb-grad" cx=".36" cy=".3" r=".78">
        <stop offset="0" class="orb-1"/><stop offset=".58" class="orb-2"/><stop offset="1" class="orb-3"/>
      </radialGradient>
    </defs>`;

    /* 树冠：八圆聚成一顶有轮廓的冠（userSpaceOnUse 渐变让它读成一个
       连续形体，而不是三个椭圆的叠影），左上一道高光；中央白底药丸
       承载「被真用过 N」（与枝牌同一视觉语言），整冠可点=已验证资产，
       落点「我的认知」默认按最近真实使用排（018 T021）。 */
    const crownTitle = validated
      ? T('cognition.tree_crown_validated', '被真用过 {n}', { n: String(validated) })
      : T('cognition.tree_crown_empty', '还没有被真用过的');
    const pillY = crownCy - 20;
    g += `<g class="spot" ${roleBtn(`data-act="open-overview" data-title="${esc(crownTitle)}" data-sub="${esc(T('cognition.tree_crown_sub', '被真用过的都在树冠——点开按最近真实使用排'))}" aria-label="${esc(crownTitle)}"`)}>
      <circle cx="${cx}" cy="${crownCy}" r="118" fill="url(#ca-crown-grad)"/>
      <circle cx="${cx - 150}" cy="${crownCy + 30}" r="80" fill="url(#ca-crown-grad)"/>
      <circle cx="${cx + 150}" cy="${crownCy + 30}" r="80" fill="url(#ca-crown-grad)"/>
      <circle cx="${cx - 72}" cy="${crownCy - 72}" r="76" fill="url(#ca-crown-grad)"/>
      <circle cx="${cx + 72}" cy="${crownCy - 72}" r="76" fill="url(#ca-crown-grad)"/>
      <circle cx="${cx}" cy="${crownCy - 96}" r="66" fill="url(#ca-crown-grad)"/>
      <circle cx="${cx - 205}" cy="${crownCy + 58}" r="52" fill="url(#ca-crown-grad)"/>
      <circle cx="${cx + 205}" cy="${crownCy + 58}" r="52" fill="url(#ca-crown-grad)"/>
      <ellipse cx="${cx - 60}" cy="${crownCy - 92}" rx="92" ry="34" class="crown-sheen"/>
      <rect x="${cx - 85}" y="${pillY}" width="170" height="40" rx="20" class="branch-plate"/>
      <circle cx="${cx - 55}" cy="${pillY + 20}" r="5" class="crown-dot"/>
      <text x="${cx + 8}" y="${pillY + 26}" text-anchor="middle" class="branch-plate-name">${esc(crownTitle)}</text>
      <text x="${cx}" y="${pillY + 66}" text-anchor="middle" class="crown-sub">${esc(T('cognition.tree_crown_sub', '被真用过的都在树冠——点开按最近真实使用排'))}</text>
    </g>`;

    /* 树干：有机锥形 + 竖排「个人本体」（点开=本体独立页）。 */
    g += `<path d="M ${cx - 22} ${groundY - 20} C ${cx - 25} ${groundY - 152}, ${cx - 12} ${groundY - 248}, ${cx - 9} ${trunkTop} L ${cx + 9} ${trunkTop} C ${cx + 14} ${groundY - 244}, ${cx + 25} ${groundY - 146}, ${cx + 22} ${groundY - 20} Z" fill="url(#ca-trunk-grad)"/>
      <path d="M ${cx - 8} ${groundY - 35} C ${cx - 10} ${groundY - 160}, ${cx - 4} ${groundY - 258}, ${cx - 3} ${trunkTop + 20}" class="trunk-ridge-light" stroke-width="4"/>
      <path d="M ${cx + 10} ${groundY - 70} C ${cx + 12} ${groundY - 160}, ${cx + 7} ${groundY - 265}, ${cx + 6} ${trunkTop + 60}" class="trunk-ridge-dark" stroke-width="2.5"/>
      <g class="spot" ${roleBtn(`data-act="open-ontology" data-title="${esc(T('cognition.ontology_entry_title', '个人本体'))}" data-sub="${esc(T('cognition.ontology_entry_hint', '我是谁、我怎么工作：画像与偏好的结构化整理'))}" aria-label="${esc(T('cognition.ontology_entry_title', '个人本体'))}"`)}>
        <text x="${cx + 1}" y="${groundY - 310}" text-anchor="middle" class="trunk-name">个<tspan x="${cx + 1}" dy="35">人</tspan><tspan x="${cx + 1}" dy="35">本</tspan><tspan x="${cx + 1}" dy="35">体</tspan></text>
      </g>`;
    /* 树干光斑：竖排名下方一颗绿核，给「可点」一个看得见的落点（光斑走
       spotSvg 统一形态；点击落点与树干同是 open-ontology）。 */
    g += spotSvg({
      kind: 'trunk', x: cx + 1, y: groundY - 190, r: 9, color: 'url(#ca-orb-grad)', glow: true, act: 'open-ontology',
      title: T('cognition.ontology_entry_title', '个人本体'),
      sub: T('cognition.ontology_entry_hint', '我是谁、我怎么工作：画像与偏好的结构化整理'),
      aria: T('cognition.ontology_entry_title', '个人本体'),
    });

    /* 大方向枝：一根枝一个光斑；叶片（药丸）承载下一层细分方向。
       枝长在窄窗按可用半宽收敛（原型按固定长度画，只在整窗宽度下成立；
       收敛后桌面宽度下与原值一致，窄窗才变短，枝牌不会顶出画布）。 */
    const maxLen = Math.max(200, W / 2 - 96);
    for (const branch of TREE_BRANCHES) {
      const len = Math.min(branch.len, maxLen);
      const end = { x: cx + branch.side * len, y: groundY - branch.y * (groundY - 190) };
      const originY = end.y + 96;
      const x0 = cx + branch.side * 17;
      const c1x = cx + branch.side * 124;
      const c1y = originY + 10;
      const c2x = end.x - branch.side * 104;
      const c2y = end.y + 26;
      const branchPath = `M ${x0} ${originY} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${end.x} ${end.y}`;
      g += `<path d="${branchPath}" stroke="url(#ca-branch-grad)" stroke-width="10" fill="none" stroke-linecap="round" opacity=".92"/>
        <path d="${branchPath}" class="branch-ridge" stroke-width="2.5" transform="translate(0,-2.2)"/>`;
      const label = T(branch.key, branch.fallback);
      const dirs = directions[branch.id] || [];
      const ts = dirs.length === 1 ? [0.66] : dirs.length === 2 ? [0.48, 0.8] : [0.4, 0.66, 0.9];
      dirs.slice(0, 3).forEach((dir, i) => {
        const t = ts[i] || 0.7;
        const mt = 1 - t;
        const px = mt * mt * mt * x0 + 3 * mt * mt * t * c1x + 3 * mt * t * t * c2x + t * t * t * end.x;
        const py = mt * mt * mt * originY + 3 * mt * mt * t * c1y + 3 * mt * t * t * c2y + t * t * t * end.y;
        const upper = i % 2 === 0;
        const stemX = px + branch.side * (26 + (i % 2) * 5);
        const stemY = py + (upper ? -20 : 18);
        const stemPath = `M ${px.toFixed(1)} ${py.toFixed(1)} Q ${((px + stemX) / 2 + branch.side * 3).toFixed(1)} ${((py + stemY) / 2).toFixed(1)} ${stemX.toFixed(1)} ${stemY.toFixed(1)}`;
        const angle = branch.side === -1 ? (upper ? 204 : 158) : (upper ? -22 : 22);
        const text = dir[1] > 1 ? `${dir[0]} ×${dir[1]}` : dir[0];
        /* 药丸宽度按字宽估算（中文 11px、英文 6px），超宽截断到能放下的
           字数——原型的数据集标签短，不会溢出；真实数据里标题头段可以很
           长，不截会顶出药丸外。 */
        const textLen = (value) => [...value].reduce((n, ch) => n + (/[\u4e00-\u9fa5]/.test(ch) ? 11 : 6), 0);
        const pillW = Math.max(82, Math.min(156, textLen(text) + 24));
        const fitted = (() => {
          if (textLen(text) <= pillW - 16) return text;
          let out = '';
          for (const ch of text) {
            if (textLen(`${out}${ch}…`) > pillW - 16) break;
            out += ch;
          }
          return `${out}…`;
        })();
        const pillX = stemX + branch.side * 16 - pillW / 2;
        let pillY = upper ? stemY - 48 : stemY + 20;
        /* 枝牌（end.x±84，end.y-73..-30）被叶药丸压住时翻到枝下方——
           t=0.9 的上侧叶正好撞牌（2026-09-21 真机抓出）。 */
        const hitsPlate = !(pillX + pillW < end.x - 84 || pillX > end.x + 84
          || pillY + 24 < end.y - 73 || pillY > end.y - 30);
        if (hitsPlate) pillY = stemY + 20;
        g += `<g class="leaf" role="img" aria-label="${esc(T('cognition.tree_leaf_aria', '{label}，细分方向 {n} 条', { label: dir[0], n: String(dir[1]) }))}">
          <path d="${stemPath}" class="leaf-stem" stroke-width="2"/>
          <g transform="translate(${stemX.toFixed(1)} ${stemY.toFixed(1)}) rotate(${angle})">
            <path d="M0 0 C13,-14 34,-14 45,0 C34,14 13,14 0,0 Z" fill="url(#ca-leaf-grad)" class="leaf-blade"/>
            <path d="M3 0 H39" class="leaf-vein" stroke-width="1"/>
          </g>
          <rect x="${pillX.toFixed(1)}" y="${pillY.toFixed(1)}" width="${pillW.toFixed(1)}" height="24" rx="12" class="leaf-pill"/>
          <text x="${(pillX + pillW / 2).toFixed(1)}" y="${(pillY + 16).toFixed(1)}" text-anchor="middle" class="leaf-pill-text">${esc(fitted)}</text>
        </g>`;
      });
      const count = catCount(branch.id);
      g += `<rect x="${end.x - 84}" y="${end.y - 73}" width="168" height="43" rx="12" class="branch-plate"/>
        <text x="${end.x}" y="${end.y - 55}" text-anchor="middle" class="branch-plate-name">${esc(label)} · ${count}</text>
        <text x="${end.x}" y="${end.y - 39}" text-anchor="middle" class="branch-plate-sub">${esc(T('cognition.tree_branch_dirs', '{n} 个细分方向', { n: String(dirs.length) }))}</text>`;
      g += spotSvg({
        kind: 'branch', id: branch.id, x: end.x, y: end.y, r: 12, color: 'url(#ca-orb-grad)', glow: true,
        sel: String(S.route.category || '') === branch.id,
        act: 'filter-cat',
        title: `${label} · ${count}`,
        sub: T('cognition.tree_branch_hint', '{label} · {n} 条；点击进入该分类的资产明细', { label, n: String(count) }),
        aria: T('cognition.tree_branch_aria', '{label}：{n} 条资产，点开分类明细', { label, n: String(count) }),
      });
    }

    /* 根：根须图案 + 唯一一个光斑（点开=待确认候选清单）。 */
    g += `<g class="root-hairs" stroke-width="5">
      <path d="M ${cx - 5} ${groundY - 36} C ${cx - 42} ${groundY - 26}, ${cx - 78} ${groundY - 20}, ${cx - 118} ${groundY - 6}"/>
      <path d="M ${cx - 5} ${groundY - 30} C ${cx - 30} ${groundY - 16}, ${cx - 52} ${groundY - 10}, ${cx - 74} ${groundY + 2}"/>
      <path d="M ${cx + 5} ${groundY - 36} C ${cx + 42} ${groundY - 26}, ${cx + 78} ${groundY - 20}, ${cx + 118} ${groundY - 6}"/>
      <path d="M ${cx + 5} ${groundY - 30} C ${cx + 30} ${groundY - 16}, ${cx + 52} ${groundY - 10}, ${cx + 74} ${groundY + 2}"/>
      <path d="M ${cx} ${groundY - 24} C ${cx - 4} ${groundY - 12}, ${cx + 4} ${groundY - 6}, ${cx} ${groundY + 4}"/></g>
      <rect x="${cx - 7}" y="${groundY - 40}" width="14" height="42" class="root-collar"/>
      ${spotSvg({ kind: 'root', x: cx, y: groundY - 52, r: 12, color: 'var(--amber-dot)', glow: true, act: 'go-review', title: pending ? T('cognition.tree_root_pending', '{n} 条新芽等你确认', { n: String(pending) }) : T('cognition.tree_root_empty', '暂无待确认'), sub: T('cognition.tree_root_go', '点开去拍板'), labelId: 'ca-root-n', tx: cx, ty: groundY - 72 })}
      <rect x="${cx - 7}" y="${groundY - 24}" width="14" height="26" class="root-collar"/>`;

    /* 土壤：会话与采集记录的来源层（点开=系统活动的时间流，018 T021）。 */
    g += `<g class="spot" ${roleBtn(`data-act="go-organize" data-title="${esc(T('cognition.tree_soil_title', '系统活动：会话整理、夜间沉淀都在这里'))}" data-sub="${esc(T('cognition.tree_soil_hint', '会话与记录在这里生根'))}" aria-label="${esc(T('cognition.tree_soil_label', '土壤 · 记录 {s} · 整理 {c}', { s: String(Number(info.sources || 0)), c: String(Number(info.captures || 0)) }))}"`)}>
      <rect x="${cx - 330}" y="${groundY + 2}" width="660" height="58" rx="12" class="soil-band"/>
      <text x="${cx}" y="${groundY + 27}" text-anchor="middle" class="soil-title">${esc(T('cognition.tree_soil_label', '土壤 · 记录 {s} · 整理 {c}', { s: String(Number(info.sources || 0)), c: String(Number(info.captures || 0)) }))}</text>
      <text x="${cx}" y="${groundY + 46}" text-anchor="middle" class="soil-sub">${esc(T('cognition.tree_soil_hint', '会话与记录在这里生根'))}</text>
    </g>`;

    return `<svg id="ca-tree-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${esc(T('cognition.tree_panel_title', '我的认知树'))}">${g}</svg>`;
  }

  /* ────────────────────────── 资产详情 ────────────────────────── */

  /* 会话名 join：使用记录事件只带 conversationId，用户看不懂裸 id——按来源
   * 清单里的会话项翻成标题；join 不到（会话已删/老数据无此字段）用泛称，
   * 不编造名字。整句叙事见 proofSentence。（2026-09-15 自独立使用记录页
   * 迁入资产详情，成为资产详情的使用记录区。） */
  function conversationNames() {
    const names = new Map();
    for (const group of S.sources) {
      for (const item of Array.isArray(group.items) ? group.items : []) {
        if (item.kind === 'conversation' && item.id) names.set(String(item.id), String(item.title || ''));
      }
    }
    // 目录只有 100 条窗口，窗口外的会话此前一律退化成「一次对话里」（US-602
    // AC2「可定位会话」不成立）。批量标题口是权威，覆盖目录里的同名旧值。
    const titles = S.conversationTitles || {};
    for (const cid of Object.keys(titles)) {
      const title = String(titles[cid] || '').trim();
      if (title) names.set(String(cid), title);
    }
    return names;
  }
  function proofWherePhrase(names, conversationId) {
    const name = conversationId ? names.get(String(conversationId)) : '';
    // name 不在此处 esc：proofSentence 的返回值整体过 esc（T() 只做占位
    // 替换），内层再转义会把 & < > 显示成实体（双重转义）。
    return name
      ? T('cognition.proof_where_named', '对话《{name}》里', { name })
      : T('cognition.proof_where_generic', '一次对话里');
  }
  /** 事件整句化：一句话说明在什么时间、哪个对话里被怎么用。
   *  knownVersions：该资产现存的版本号集合——使用记录忠实保留历史，引用
   *  的版本可能已被删除（版本真删上线后很常见），裸标 v5 用户会懵"v5 是
   *  啥，我只有 v1/v2"；不在集合内的标注"当时的版本后来已删除"。 */
  function proofSentence(names, proof, knownVersions) {
    const refs = proof.refs || {};
    const when = fmtDate(proof.occurredAt);
    const where = proofWherePhrase(names, refs.conversationId);
    const version = refs.version
      ? (knownVersions && knownVersions.size && !knownVersions.has(String(refs.version))
        ? T('cognition.proof_version_deleted', '（当时的 v{n}，该版本后来已删除）', { n: String(refs.version) })
        : T('cognition.proof_version_suffix', '（v{n}）', { n: String(refs.version) }))
      : '';
    const kind = String(proof.kind || '');
    if (kind === 'usage_recorded') {
      // 按 outcome 说清"怎么用到的"（2026-09-25 US-602 AC4/AC5）：宿主注入、
      // 模型自读、派发授予一律不宣称"被实际采用"——是否采用只看「实际采用记录」
      // （有据回执）。旧记录没有 outcome，按中性"带进上下文"表述。
      const outcome = String(refs.usageOutcome || '');
      if (outcome === 'agent_read') {
        return T('cognition.proof_sentence_agent_read', '{when}，{where}的模型读取了这条内容{version}', { when, where, version });
      }
      if (outcome === 'dispatched') {
        return T('cognition.proof_sentence_dispatched', '{when}，这条内容被派发给执行者{version}', { when, version });
      }
      if (outcome === 'succeeded' || outcome === 'degraded' || outcome === 'rejected') {
        return T('cognition.proof_sentence_transfer', '{when}，{where}的这次使用已核对结果{version}', { when, where, version });
      }
      if (outcome === 'feedback_positive' || outcome === 'feedback_negative') {
        return T('cognition.proof_sentence_feedback', '{when}，你对这次使用给了评价{version}', { when, version });
      }
      return T('cognition.proof_sentence_brought_in', '{when}，{where}的这次任务把这条内容带进了上下文{version}', { when, where, version });
    }
    if (kind === 'projection_confirmed') {
      return T('cognition.proof_sentence_projected', '{when}，在{where}被带入任务{version}', { when, where, version });
    }
    if (kind === 'projection_revoked') {
      // 模型自选的撤销要在使用记录里看得见（2026-09-18）：否则"我撤过它"没有
      // 任何痕迹，只剩一堆"被带入任务"。
      return T('cognition.proof_sentence_attachment_revoked', '{when}，{where}的这次挂载被你撤销（此后的回合不再带上）', { when, where });
    }
    if (kind === 'asset_created') {
      return T('cognition.proof_sentence_created', '{when}，这条内容被创建', { when });
    }
    if (kind === 'asset_version') {
      return T('cognition.proof_sentence_version', '{when}，保存了新版本{version}', { when, version });
    }
    if (kind === 'asset_version_selected') {
      return T('cognition.proof_sentence_version_selected', '{when}，选用 v{n} 为在用版本', { when, n: String(refs.version || '') });
    }
    return T('cognition.proof_sentence_unknown', '{when}，{title}', { when, title: proofEventTitle(proof) });
  }

  /** 「被带入任务」计数（唯一公式，列表行 / 目录行 / 详情摘要共用）：
   *  白名单事件（来自主进程）+ 防重复——一次带入在数据层会产生两条记录
   *  （projection_confirmed 与同投影的 usage_recorded/injected），必须按投影去重，
   *  否则一次带入被数成两次。没有投影关联的 usage 行只在明确是"另一条路线"
   *  （模型自读 / 派发 / 迁移核对 / 你的评价）时才另计；否则视作该投影自身的记录，
   *  **宁可少算不多算**。撤销事件单列不计。 */
  function broughtInCountFor(assetId) {
    const realKinds = new Set(Array.isArray(S.realUsageKinds) ? S.realUsageKinds : []);
    const items = S.proofs.filter((proof) => realKinds.has(String(proof.kind || ''))
      && String((proof.refs || {}).assetId || '') === String(assetId));
    const confirmedProjectionIds = new Set(items
      .filter((p) => String(p.kind || '') === 'projection_confirmed')
      .map((p) => String((p.refs || {}).projectionId || ''))
      .filter(Boolean));
    const separateRoutes = new Set(['agent_read', 'dispatched', 'succeeded', 'degraded', 'rejected', 'feedback_positive', 'feedback_negative']);
    return items.filter((p) => String(p.kind || '') === 'projection_confirmed').length
      + items.filter((p) => {
        if (String(p.kind || '') !== 'usage_recorded') return false;
        const refs = p.refs || {};
        const projectionId = String(refs.projectionId || '');
        if (projectionId) return !confirmedProjectionIds.has(projectionId);
        return separateRoutes.has(String(refs.usageOutcome || ''));
      }).length;
  }

  /** 资产详情的使用记录区（原独立「使用记录」页的按资产切片）。 */
  function assetUsageSection(asset, route) {
    const realKinds = new Set(Array.isArray(S.realUsageKinds) ? S.realUsageKinds : []);
    const items = S.proofs
      .filter((p) => String((p.refs || {}).assetId || '') === String(asset.id))
      // 真实使用事件（白名单来自主进程，与列表侧同一份）+ 撤销事件：撤销要看得见
      //（AC3），但不计入任何次数。版本保存、选用切换、治理操作都不是使用。
      .filter((p) => realKinds.has(String(p.kind || '')) || String(p.kind || '') === 'projection_revoked')
      .sort((left, right) => String(right.occurredAt || '').localeCompare(String(left.occurredAt || '')));
    if (!items.length) {
      return `<div class="sect-block"><div class="sub">${esc(T('cognition.asset_no_proofs_section', '还没有被真实使用过。资产在任务中被真正使用、并留下可核对的记录后，会出现在这里。'))}</div></div>`;
    }
    const names = conversationNames();
    // 现存版本集合（bug3）：只认版本链里实际存在的版本——asset.version 是
    // 只增游标（真删不回退，防引用错位），不能当"现存"用；链未加载时不
    // 标注（拿不准宁可显示普通后缀，不误标"已删除"）。
    const knownVersions = new Set();
    if (S.assetVersions && S.assetVersions.assetId === String(asset.id) && Array.isArray(S.assetVersions.versions)) {
      knownVersions.add(String(asset.activeVersion || ''));
      for (const v of S.assetVersions.versions) knownVersions.add(String(v.version));
    }
    // 「被带入任务」计数走唯一公式（与目录行、列表侧同口径）。
    const broughtInCount = broughtInCountFor(asset.id);
    // 「实际采用」只认有据回执（AC5/AC6）：applied 才算采用，contradicted 单列，
    // 其余（usage_unknown / considered_not_applicable / available_no_opportunity）
    // 如实显示为「证据不足」——不夸大成全部采用，也不谎称失败。
    const receipts = (S.adoptionReceipts && String(S.adoptionReceipts.assetId || '') === String(asset.id)
      && Array.isArray(S.adoptionReceipts.items))
      ? S.adoptionReceipts.items
      : [];
    const appliedCount = receipts.filter((r) => String(r.status || '') === 'applied').length;
    const contradictedCount = receipts.filter((r) => String(r.status || '') === 'contradicted').length;
    const unknownCount = receipts.filter((r) => !['applied', 'contradicted'].includes(String(r.status || ''))).length;
    const summaryLine = [
      broughtInCount ? T('cognition.proof_projected_times', '被带入任务 {n} 次', { n: String(broughtInCount) }) : '',
      appliedCount ? T('cognition.adoption_applied_times', '实际采用 {n} 次', { n: String(appliedCount) }) : '',
      contradictedCount ? T('cognition.adoption_contradicted_times', '被否定 {n} 次', { n: String(contradictedCount) }) : '',
      unknownCount ? T('cognition.adoption_unknown_times', '证据不足 {n} 次', { n: String(unknownCount) }) : '',
    ].filter(Boolean).join(' · ');
    const rows = items.slice(0, 20).map((proof) => {
      const refs = proof.refs || {};
      const isOpen = String(route.proofEventId) === String(proof.id);
      const transferProofId = String(refs.transferProofId || '');
      const kind = String(proof.kind || '');
      let ratingHtml = '';
      if (isOpen) {
        // 评价闸门（对齐后端 E_RECALL_* 口径）：只有「被实际使用」
        // （usage_recorded）且留下迁移证明的事件才可评。
        if (kind === 'usage_recorded' && transferProofId) {
          ratingHtml = `<div class="ca-rating"><strong>${esc(T('cognition.proof_rate_question', '这次用得怎么样？'))}</strong>
            <div class="actions">${PROOF_FEEDBACKS.map(([value, key, fb]) => btn(T(key, fb), 'proof-rate', { id: transferProofId, data: { feedback: value, proof: proof.id } })).join('')}</div>
            <div class="note-zone">
              ${window.uiTextarea({ id: `ca-proof-note-${esc(proof.id)}`, placeholder: T('cognition.proof_note_optional_placeholder', '可补充一句你观察到的变化（可选；先写再点评，说明会随评价一起附上）'), attrs: { 'data-f': 'note' } })}
            </div>
          </div>`;
        } else {
          ratingHtml = `<div class="ca-rating"><p class="note">${esc(T('cognition.proof_rating_blocked_no_transfer', '这次还没有形成可评价的使用记录。'))}</p></div>`;
        }
      }
      return `
      <div class="ca-proof-row${isOpen ? ' is-open' : ''}">
        <div class="ca-proof-event" data-act="proof-toggle" data-id="${esc(proof.id)}" ${roleBtn()}>
          <span class="ca-proof-dot" aria-hidden="true"></span>
          <span class="ca-proof-body"><strong class="ca-proof-sentence">${esc(proofSentence(names, proof, knownVersions))}</strong></span>
        </div>
        ${ratingHtml}
      </div>`;
    }).join('');
    return `<div class="sect-block">
      ${sectionHead(T('cognition.asset_usage_section', '使用记录'), summaryLine)}
      <div class="ca-proof-list">${rows}</div>
      ${items.length > 20 ? `<div class="sub">${esc(T('cognition.asset_usage_more', '仅显示最近 {n} 条', { n: '20' }))}</div>` : ''}
    </div>`;
  }

  /** 实际采用记录（2026-09-25 US-602 AC5/AC6）：唯一权威 = usage 回执 applied。
   *  每条给出同次任务（时间）、具体版本、执行事件类型与产物位置（证据来源名走统一
   *  解析器，不裸 id）；contradicted 单列；其余如实标「证据不足 · 未知」——不夸大
   *  成全部采用，也不谎称失败。没有回执时说明"还没有可核对的采用证据"。 */
  function assetAdoptionSection(asset) {
    const state = S.adoptionReceipts;
    const items = (state && String(state.assetId || '') === String(asset.id) && Array.isArray(state.items))
      ? state.items
      : [];
    if (!items.length) {
      return `<div class="sect-block">${sectionHead(T('cognition.adoption_section', '实际采用记录'))}
        <div class="sub">${esc(T('cognition.adoption_empty', '还没有可核对的采用证据。任务里真正用到、并留下可核对痕迹的记录才会出现在这里。'))}</div></div>`;
    }
    const statusLabel = (status) => {
      if (status === 'applied') return T('cognition.adoption_status_applied', '已实际采用');
      if (status === 'contradicted') return T('cognition.adoption_status_contradicted', '被否定');
      if (status === 'considered_not_applicable') return T('cognition.adoption_status_not_applicable', '这次不适用');
      if (status === 'available_no_opportunity') return T('cognition.adoption_status_no_opportunity', '没有使用机会');
      return T('cognition.adoption_status_unknown', '证据不足 · 未知');
    };
    const evidenceKindLabel = (kind) => {
      if (kind === 'tool_call') return T('cognition.adoption_evidence_tool_call', '工具调用');
      if (kind === 'agent_action') return T('cognition.adoption_evidence_agent_action', '执行动作');
      if (kind === 'artifact') return T('cognition.adoption_evidence_artifact', '产物');
      if (kind === 'final_output') return T('cognition.adoption_evidence_final_output', '最终输出');
      return '';
    };
    const rows = items.map((receipt) => {
      const version = String(receipt.assetVersion || '');
      const kindLabel = evidenceKindLabel(String(receipt.evidenceKind || ''));
      const names = (Array.isArray(receipt.evidence) ? receipt.evidence : [])
        .map((ref) => resolveSourceRef(ref))
        .map((view) => view.name)
        .filter(Boolean);
      const meta = [version ? `v${version}` : '', fmtDate(receipt.createdAt), kindLabel].filter(Boolean).join(' · ');
      const evidenceLine = names.length
        ? `<div class="sub">${esc(T('cognition.adoption_evidence_line', '证据：{names}', { names: names.join('、') }))}</div>`
        : '';
      return `<div class="ca-proof-row">
        <div class="ca-proof-body">
          <strong class="ca-proof-sentence">${esc(statusLabel(String(receipt.status || '')))}</strong>
          ${meta ? `<span class="note">${esc(meta)}</span>` : ''}
        </div>
        ${evidenceLine}
      </div>`;
    }).join('');
    const applied = items.filter((r) => String(r.status || '') === 'applied').length;
    const contradicted = items.filter((r) => String(r.status || '') === 'contradicted').length;
    const unknown = items.length - applied - contradicted;
    const note = [
      T('cognition.adoption_applied_times', '实际采用 {n} 次', { n: String(applied) }),
      contradicted ? T('cognition.adoption_contradicted_times', '被否定 {n} 次', { n: String(contradicted) }) : '',
      unknown ? T('cognition.adoption_unknown_times', '证据不足 {n} 次', { n: String(unknown) }) : '',
    ].filter(Boolean).join(' · ');
    return `<div class="sect-block">
      ${sectionHead(T('cognition.adoption_section', '实际采用记录'), note)}
      <div class="ca-proof-list">${rows}</div>
    </div>`;
  }

  /** 资产详情「为什么这一轮排在前面」（specs/012 T020 / US-202 AC4）：使用
   *  记录区里的折叠小节，解释这条资产最近一轮在目录里的推荐排序依据。
   *  数据 = recall.catalog.ranking（注入回执的 ranking 拆解，只读）——由
   *  app.js 按详情页资产异步取回后挂在 NS.rankingWhy（本文件不改 core）。
   *  呈现纪律：缺的因子不显示（不是 0）；缺席给一句人话；旧回执没有
   *  ranking → 如实说「没有记录」，不编造；weightsSource=invalid-fallback
   *  → 醒目提示「你的权重配置没生效」。 */
  function assetRankingWhySection(asset) {
    if (!['active', 'paused'].includes(String(asset.status || 'active'))) return '';
    const state = NS.rankingWhy;
    const mine = state && String(state.assetId || '') === String(asset.id) ? state : null;
    let body;
    if (!mine || mine.loading) {
      body = `<div class="sub">${esc(T('cognition.ranking_loading', '正在取这一轮的排序依据…'))}</div>`;
    } else if (mine.failed) {
      body = `<div class="sub">${esc(T('cognition.ranking_load_failed', '排序依据暂时取不到（读取失败），可以稍后再试。'))}</div>`;
    } else if (!mine.turnId) {
      // 使用记录里找不到这条资产的任何回合 → 它没进过当轮目录（空态契约）。
      body = `<div class="sub">${esc(T('cognition.ranking_not_in_catalog', '这一轮没有进入目录'))}</div>`;
    } else if (!mine.item || mine.item.explainable === false) {
      body = `<div class="sub">${esc(T('cognition.ranking_no_record', '这一轮没有记录排序依据'))}</div>`;
    } else {
      const FACTOR_LABELS = {
        relevance: T('cognition.ranking_factor_relevance', '内容相关'),
        adoption: T('cognition.ranking_factor_adoption', '实际采用'),
        scene: T('cognition.ranking_factor_scene', '场景'),
        maturity: T('cognition.ranking_factor_maturity', '成熟度'),
      };
      const num = (value) => Number(value || 0).toFixed(2);
      const rows = (Array.isArray(mine.item.factors) ? mine.item.factors : []).map((factor) => `
        <div class="ca-rank-row">
          <span class="ca-rank-name">${esc(FACTOR_LABELS[factor.name] || String(factor.name || ''))}</span>
          <span class="ca-rank-raw">${esc(num(factor.raw))}</span>
          <span class="ca-rank-weight">× ${esc(Number(factor.weight || 0).toFixed(1))}</span>
          <span class="ca-rank-contrib">= ${esc(num(factor.contribution))}</span>
        </div>`).join('');
      // 缺席因子 = 不进分子也不进分母：给一句人话说明（scene/relevance 之外
      // 的因子在场恒定，不会缺席——出现未知缺席名时不编理由，只如实不显示）。
      const ABSENT_NOTES = {
        scene: T('cognition.ranking_scene_absent_note', '这一轮会话没有项目归属，所以场景不计分'),
        relevance: T('cognition.ranking_relevance_absent_note', '这一轮没有可比对的任务文本，内容相关不计分'),
      };
      const absent = (Array.isArray(mine.item.excluded) ? mine.item.excluded : [])
        .map((name) => ABSENT_NOTES[name] || '')
        .filter(Boolean)
        .map((note) => `<p class="note">${esc(note)}</p>`)
        .join('');
      const source = String(mine.item.weightsSource || '');
      const sourceNote = source === 'invalid-fallback'
        ? `<p class="note ca-rank-warn">${esc(T('cognition.ranking_weights_invalid_note', '你的权重配置没生效（配置不合法），当前用的是默认权重'))}</p>`
        : source === 'default'
          ? `<p class="note">${esc(T('cognition.ranking_source_default_note', '当前使用默认权重'))}</p>`
          : '';
      body = `
        <div class="ca-rank-rows">${rows}</div>
        <div class="sub"><strong>${esc(T('cognition.ranking_total', '加权总分 {score}', { score: num(mine.item.score) }))}</strong></div>
        ${absent}
        ${sourceNote}
        <p class="note">${esc(T('cognition.ranking_why_hint', '权重可在「整理 → 沉淀设置」里调整；改完下一轮对话生效。'))}</p>`;
    }
    return `<div class="sect-block ca-rank-why" data-ranking-why>
      <details class="details">
        <summary>${esc(T('cognition.ranking_why_title', '为什么这一轮排在前面'))}</summary>
        <div class="dbody">${body}</div>
      </details>
    </div>`;
  }

  /** 版本来源标签（2026-09-17 报告建议 E）：reason 是审计字段（多为机器
   *  生成），直接透传用户读不懂；先归一成来源种类，标签走 locale，原文
   *  收进展开块"变更说明"。reason 归一只认数据层的固定英文前缀（core 写
   *  reason 时用英文常量，不随界面语言变——否则归一化会跟着漂）。 */
  function versionSourceKind(v) {
    const reason = String(v.reason || '');
    if (reason.startsWith('review_decision:')) return 'decision';
    if (reason.startsWith('legacy ') || reason.includes('(2026-08-15)') || reason.includes('(2026-09-13')) return 'migration';
    if (reason.startsWith('merged from ') || reason.startsWith('merged active version')) return 'merge';
    if (reason.startsWith('user rollback to v')) return 'rollback';
    if (reason === 'evidence merged from candidate dedup') return 'dedup';
    if (reason.startsWith('merge versions v')) return 'version_merge';
    if (reason.startsWith('user manual edit')) return 'manual';
    return v.actor === 'user' ? 'manual' : 'system';
  }
  const VERSION_SOURCE_LABELS = {
    // 「确认沉淀」（2026-09-17 改）：review_decision 前缀两线通用（对话线
    // 候选确认与 KSTAR 复盘确认都写它），此前文案「候选确认」是内部流程
    // 词汇——用户视角这一版是"确认后沉淀下来的"。
    decision: ['cognition.asset_version_src_decision', '确认沉淀'],
    migration: ['cognition.asset_version_src_migration', '系统迁移'],
    merge: ['cognition.asset_version_src_merge', '归并'],
    rollback: ['cognition.asset_version_src_rollback', '回退'],
    dedup: ['cognition.asset_version_src_dedup', '证据归并'],
    version_merge: ['cognition.asset_version_src_version_merge', '版本合并'],
    manual: ['cognition.asset_version_src_manual', '手动编辑'],
    system: ['cognition.asset_version_src_system', '系统'],
  };
  function versionSourceLabel(v) {
    const entry = VERSION_SOURCE_LABELS[versionSourceKind(v)] || VERSION_SOURCE_LABELS.system;
    return T(entry[0], entry[1]);
  }

  /** 两版字段级对比（2026-09-17 报告建议 C）：两版全量快照已在渲染层
   *  （versions.list），前端自算任意两版——通道只返回相邻版本对，覆盖
   *  不了"v3 vs 在用 v2"。展示顺序照主进程 CHANGE_ORDER：边界→范围→
   *  正文→证据→标题；无差异明说"内容一致"。 */
  function assetVersionDiffBlock(asset, baseV, targetV) {
    const a = (baseV && baseV.snapshot) || {};
    const b = (targetV && targetV.snapshot) || {};
    const text = (value) => (Array.isArray(value) ? value.join('、') : String(value || '')) || '—';
    const rows = [
      [T('cognition.asset_edit_field_applicable', '适用场景'), text(a.applicableWhen), text(b.applicableWhen)],
      [T('cognition.asset_edit_field_forbidden', '禁用场景'), text(a.forbiddenWhen), text(b.forbiddenWhen)],
      [T('cognition.asset_version_diff_scope', '适用范围'), text(a.scope), text(b.scope)],
      [T('cognition.asset_version_diff_statement', '正文'), text(a.statement), text(b.statement)],
      [T('cognition.asset_version_diff_evidence', '证据数量'), String((a.evidenceRefs || []).length), String((b.evidenceRefs || []).length)],
      [T('cognition.asset_version_diff_title_field', '标题'), text(a.title), text(b.title)],
    ].filter((row) => row[1] !== row[2]);
    const title = T('cognition.asset_version_diff_line', '版本对比：v{a}（在用） → v{b}', { a: String((baseV && baseV.version) || '?'), b: String((targetV && targetV.version) || '?') });
    if (!rows.length) {
      return `<div class="sect-block ca-version-diff"><div class="tt">${esc(title)}</div><p class="note">${esc(T('cognition.asset_version_diff_same', '两版内容一致。'))}</p></div>`;
    }
    return `<div class="sect-block ca-version-diff">
      <div class="tt">${esc(title)}</div>
      ${rows.map(([label, from, to]) => `<div class="meta-item"><span class="meta-k">${esc(label)}</span><span class="meta-v">${esc(from)} → ${esc(to)}</span></div>`).join('')}
    </div>`;
  }

  /** 单个版本的展开详情（2026-09-17）：列表行只给 80 字预览，点行看全文与
   * 逐项信息；非在用版就地提供「删除此版本」（真删：物理移除，引用它的
   * 已确认注入在服务端冻结了内容副本）。 */
  /** 适用范围白话化（2026-09-17 随详细信息下沉版本块提取共用）。 */
  function scopeLabelText(raw) {
    const value = String(raw || '');
    if (!value) return T('cognition.asset_scope_unset', '还没设置');
    // 白话映射覆盖中英两种内部写法（2026-09-17 修 personal 裸英文）：
    // 后端 scope 是自由文本，认得出的常见形态翻人话，认不出原样显示。
    if (/全局|画像|general/.test(value)) return T('cognition.asset_scope_all', '所有对话');
    if (value === 'personal') return T('cognition.asset_scope_personal', '个人对话');
    return value;
  }
  /** 版本快照的来源行（2026-09-17 下沉）：按该版快照的学习信号判定 KSTAR
   *  血统；无信号（会话整理线）不显示——返回空串即可被行渲染跳过。 */
  function snapshotOriginText(signal, provenance) {
    const source = provenance ? 'review'
      : signal && ['review', 'preference_scan'].includes(String(signal.source || '')) ? String(signal.source) : '';
    if (!source) return '';
    return source === 'preference_scan'
      ? T('cognition.asset_origin_pref_scan', '来自偏好扫描')
      : T('cognition.asset_origin_kstar', '来自那次任务的复盘');
  }

  function assetVersionDetailBlock(asset, v, isActive, usage) {
    const snap = v.snapshot || {};
    const usageText = usage
      ? [usage.applied ? T('cognition.asset_usage_applied', '实际采用 {n} 次', { n: String(usage.applied) }) : '',
        usage.contradicted ? T('cognition.asset_usage_contradicted', '被否定 {n} 次', { n: String(usage.contradicted) }) : '']
        .filter(Boolean).join(' · ')
      : '';
    const evidenceCount = Array.isArray(snap.evidenceRefs) ? snap.evidenceRefs.length : 0;
    const rowHtml = (label, value) => value ? `<div class="meta-item"><span class="meta-k">${esc(label)}</span><span class="meta-v">${esc(String(value))}</span></div>` : '';
    // 对比/合并的目标与基准都在版本链里；diff 就地展开（报告建议 C），
    // 合并两版为新版（报告建议 H）也挂这里——查看与危险操作集中在展开块。
    const versions = (S.assetVersions && S.assetVersions.versions) || [];
    const activeV = versions.find((x) => String(x.version) === String(asset.activeVersion || asset.version));
    const showDiff = String(S.route.assetVersionDiff || '') === String(v.version);
    // 编辑入口只在版本行（2026-09-17 子安口径）：每个版本（含在用版）都能
    // 成为编辑起点——在用版直接编辑，历史版先设为在用再编辑（合一步）。
    const editFromBtn = btn(T('cognition.asset_edit_from_version', '基于此版修改'), 'edit-from-version', { id: asset.id, data: { version: String(v.version) }, small: true, primary: true });
    const actions = isActive
      ? `${editFromBtn}<span class="note">${esc(T('cognition.asset_version_active_locked', '当前在用版本不可删除；先选用其他版本，再删除它。'))}</span>`
      : `${editFromBtn}
        ${btn(showDiff ? T('cognition.asset_version_diff_hide', '收起对比') : T('cognition.asset_version_diff_show', '与在用版对比'), 'diff-asset-version', { id: asset.id, data: { version: String(v.version) }, small: true })}
        ${btn(T('cognition.asset_version_merge', '与在用版合并为新版'), 'merge-asset-version', { id: asset.id, data: { version: String(v.version) }, small: true })}
        ${btn(T('cognition.asset_version_delete', '删除此版本'), 'delete-asset-version', { id: asset.id, data: { version: String(v.version) }, danger: true, small: true })}`;
    // 详细信息与证据按版本下沉（2026-09-17 子安口径）：范围/怎么来的/证据
    // 本就存于每版快照、各版不同——跟版本走，顶部不再显示资产级副本。
    // 证据 chips 点开「这次任务的经过」也挂块内（展开态走路由，重画不丢）。
    return `<div class="sect-block ca-version-detail">
      <div class="tt">${esc(T('cognition.asset_version_detail_title', '版本详情'))} · v${esc(String(v.version))}</div>
      <p class="note">${esc(String(snap.statement || ''))}</p>
      <div class="meta-row">
        ${rowHtml(T('cognition.asset_scope_label', '适用范围'), scopeLabelText(snap.scope))}
        ${rowHtml(T('cognition.asset_version_applicable', '适用场景'), (Array.isArray(snap.applicableWhen) ? snap.applicableWhen : []).join('；'))}
        ${rowHtml(T('cognition.asset_version_forbidden', '禁用场景'), (Array.isArray(snap.forbiddenWhen) ? snap.forbiddenWhen : []).join('；'))}
        ${rowHtml(T('cognition.asset_origin_label', '怎么来的'), snapshotOriginText(snap.learningSignal, snap.learningProvenance))}
        ${rowHtml(T('cognition.asset_version_reason_label', '变更说明'), [versionSourceLabel(v), fmtDate(v.at)].filter(Boolean).join(' · '))}
        ${rowHtml(T('cognition.asset_version_usage_label', '使用效果'), usageText)}
      </div>
      ${evidenceCount ? `${evidenceGroupsHtml(snap.evidenceRefs)}${kstarEpisodeSection(S.route)}` : ''}
      <div class="actions actions-right">${actions}</div>
      ${showDiff && activeV ? assetVersionDiffBlock(asset, activeV, v) : ''}
    </div>`;
  }

  /** 版本链（2026-09-16 版本组）：V1 归入同条目可展开；在用=指针可切换，
   *  「选用此版」走 select-asset-version（内容同步、不产生新版本号）。
   *  守卫 ≥1 版即显示（2026-09-17 下沉改）：详细信息和证据都归版本展开
   *  块——单版本资产的证据也要有位置可看。 */
  function assetVersionsSection(asset) {
    const state = S.assetVersions;
    if (!state || state.assetId !== String(asset.id) || !Array.isArray(state.versions) || state.versions.length < 1) return '';
    const active = String(asset.activeVersion || asset.version || '');
    const usageByVersion = new Map((state.usage || []).map((u) => [String(u.version), u]));
    // 冻结引用按版本（主进程现算）：这一版被多少个**已确认投影**引用过。
    // 「已有更新的版本」标记认这个，不认 KSTAR 采用回执——后者为空时标记永不出现
    // （2026-09-25 合并态走查：v1 被 8 条投影冻结，界面却没有标记）。
    const frozenByVersion = new Set((state.frozen || []).map((f) => String(f.version)));
    // 空版本标记（2026-09-16）：与相邻版内容一字不差的版本（系统迁移垫高/
    // 旧版归并搬运）显示"内容未变"，避免"两版一模一样"被误读为出错。
    const contentKey = (snap) => `${snap.title || ''}\n${snap.statement || ''}`;
    const sortedAsc = [...state.versions].sort((left, right) => Number(left.version) - Number(right.version));
    const unchangedAfter = new Set(sortedAsc.filter((v, i) => i > 0 && contentKey(v.snapshot || {}) === contentKey(sortedAsc[i - 1].snapshot || {})).map((v) => String(v.version)));
    // 来源标签（报告建议 E）：reason 原文收展开块，行上只给归一化标签。
    // 系统迁移产生的空版本默认折叠（报告建议 E）：与相邻版一字不差的
    // 迁移垫版本整行隐藏，尾部给展开入口——用户扫版本链时分得清"哪些是
    // 我真的改过、哪些只是系统垫高了号"。
    const isNoiseVersion = (v) => versionSourceKind(v) === 'migration' && unchangedAfter.has(String(v.version));
    const expanded = !!S.route.assetVersionsExpanded;
    const noiseCount = state.versions.filter(isNoiseVersion).length;
    const visibleVersions = expanded ? state.versions : state.versions.filter((v) => !isNoiseVersion(v));
    const rows = [...visibleVersions]
      .sort((left, right) => Number(right.version) - Number(left.version))
      .map((v) => {
        const isActive = String(v.version) === active;
        const title = String((v.snapshot && v.snapshot.title) || asset.title || '');
        const usage = usageByVersion.get(String(v.version));
        const usageText = usage
          ? [usage.applied ? T('cognition.asset_usage_applied', '实际采用 {n} 次', { n: String(usage.applied) }) : '',
            usage.contradicted ? T('cognition.asset_usage_contradicted', '被否定 {n} 次', { n: String(usage.contradicted) }) : '']
            .filter(Boolean).join(' · ')
          : '';
        // 内容摘要（2026-09-16 用户反馈：两版只显示标题看不出差异，也看不到
        // 具体内容）——正文截 80 字进 meta，标题相同的内容差异由此可辨。
        const statement = String((v.snapshot && v.snapshot.statement) || '').replace(/\s+/g, ' ').trim();
        const statementPreview = statement.length > 80 ? `${statement.slice(0, 80)}…` : statement;
        const meta = [statementPreview, fmtDate(v.at), versionSourceLabel(v), unchangedAfter.has(String(v.version)) ? T('cognition.asset_version_unchanged', '内容未变（系统迁移/搬运）') : '', usageText].filter(Boolean).join(' · ');
        // 已被任务引用过（冻结引用，或 KSTAR 判过采用/否定）的历史版本：明说
        // 「已有更新的版本」。引用它的任务仍按当时冻结的内容执行（服务端按副本
        // 供给），所以这不是错误状态，只是"你看的这一版已经不是最新的"——用户
        // 据此决定切回还是接受新版。文案复用既有的 `asset_version_latest_note`
        // （2026-09-17 头部提示移除后留下的孤儿键，四语已齐）：概念一字不差，
        // 不再造一个近义键。
        // 判据是"被引用过"= 冻结引用计数 > 0 **或** 有采用回执；只有回执那一半
        // 会因回执库为空而恒假，所以冻结引用是主判据（2026-09-25 修）。
        const superseded = !isActive
          && (frozenByVersion.has(String(v.version)) || (!!usage && (usage.total || 0) > 0));
        const side = isActive
          ? chip(T('cognition.asset_version_active', '在用'), 'green')
          : `${superseded ? window.uiTag({ label: T('cognition.asset_version_latest_note', '已有更新的版本'), variant: 'version' }) : ''}${btn(T('cognition.asset_version_select', '切回此版'), 'select-asset-version', { id: asset.id, data: { version: String(v.version) }, small: true })}`;
        // 行可点开（2026-09-17）：点行就地展开该版本全文详情；再点收起。
        const open = String(S.route.assetVersionId || '') === String(v.version);
        return `<div class="row is-flat is-clickable" data-act="open-asset-version" data-version="${esc(String(v.version))}" ${roleBtn()}>
          <div class="tw"><div class="tt">v${esc(String(v.version))} · ${esc(title)}</div><div class="mm">${esc(meta)}</div></div>
          <div class="sd">${side}</div>
        </div>
        ${open ? assetVersionDetailBlock(asset, v, isActive, usage) : ''}`;
      }).join('');
    // 头部「已有更新的版本」下钻已随头部重构移除（2026-09-17）：版本信息
    // 全部归版本区——每行展开块内本就有「与在用版对比」，头部不再重复。
    const noiseToggle = noiseCount
      ? `<div class="sub">${btn(expanded
        ? T('cognition.asset_versions_noise_hide', '收起系统迁移版本')
        : T('cognition.asset_versions_noise_show', '显示 {n} 条系统迁移产生的空版本', { n: String(noiseCount) }),
      'toggle-asset-versions-noise', { id: asset.id, small: true })}</div>`
      : '';
    return `<div class="sect-block"><div class="tt">${esc(T('cognition.asset_versions_section', '版本记录'))}</div>${rows}${noiseToggle}</div>`;
  }

  /** 资产编辑表单（2026-09-17 报告建议 A）：预填在用版现值；保存产生新
   *  版本（core.editAsset 先比对，无实际修改不提交——后端相同内容也会
   *  bump 出空版本）。类型与范围不在此改：类型变更走候选线重审，范围
   *  自由文本会再触发 scope 迁移。
   *  敏感级（specs/010 T026）：三档分段控件随表单走——未分级时三档都不
   *  选中、不预设 L0；用户点了哪档保存时才带 sensitivity，没点就不改。 */
  function assetEditForm(asset) {
    const fieldHtml = (label, inner) => `<label class="field"><span>${esc(label)}</span>${inner}</label>`;
    const joinList = (list) => (Array.isArray(list) ? list.join('、') : '');
    const fid = (name) => `ca-asset-edit-${name}-${esc(asset.id)}`;
    const sensitivityControl = window.uiSegmentedControl({
      ariaLabel: T('cognition.inbox_ask_classify', '补充敏感级分类'),
      items: ['L0', 'L1', 'L2'].map((level) => ({ label: level, value: level, attrs: { 'data-level': level } })),
      value: asset.sensitivity,
      attrs: { 'data-act': 'inbox-classify-level', 'data-key': `ca-asset-edit-sensitivity-${esc(asset.id)}`, 'data-f': 'sensitivity' },
    });
    return `<div class="sect-block ca-asset-edit">
      <div class="tt">${esc(T('cognition.asset_edit_title', '编辑资产'))}</div>
      <p class="note">${esc(T('cognition.asset_edit_hint', '保存后会产生一个新版本；当前内容仍完整保留在版本记录里。'))}</p>
      ${fieldHtml(T('cognition.asset_edit_field_title', '标题'), window.uiInput({ id: fid('title'), value: String(asset.title || ''), attrs: { 'data-f': 'title' } }))}
      ${fieldHtml(T('cognition.asset_edit_field_statement', '正文'), window.uiTextarea({ id: fid('statement'), value: String(asset.statement || ''), attrs: { 'data-f': 'statement' } }))}
      ${fieldHtml(T('cognition.asset_edit_field_applicable', '适用场景（多条用顿号分隔）'), window.uiInput({ id: fid('applicable'), value: joinList(asset.applicableWhen), attrs: { 'data-f': 'applicable' } }))}
      ${fieldHtml(T('cognition.asset_edit_field_forbidden', '禁用场景（多条用顿号分隔）'), window.uiInput({ id: fid('forbidden'), value: joinList(asset.forbiddenWhen), attrs: { 'data-f': 'forbidden' } }))}
      ${fieldHtml(T('cognition.asset_edit_field_sensitivity', '敏感级（未分级不等于 L0；不选＝维持现状）'), sensitivityControl)}
      ${fieldHtml(T('cognition.asset_edit_field_visible_agents', '谁能看见·Agent（id 用顿号分隔，留空＝不限制）'), window.uiInput({ id: fid('visible-agents'), value: joinList(asset.scopePolicy && asset.scopePolicy.agentIds), attrs: { 'data-f': 'visible-agents' } }))}
      ${fieldHtml(T('cognition.asset_edit_field_visible_spaces', '谁能看见·空间（id 用顿号分隔，留空＝不限制）'), window.uiInput({ id: fid('visible-spaces'), value: joinList(asset.scopePolicy && asset.scopePolicy.workspaceIds), attrs: { 'data-f': 'visible-spaces' } }))}
      <div class="actions actions-right">
        ${btn(T('common.cancel', '取消'), 'asset-edit-cancel', { id: asset.id })}
        ${btn(T('cognition.asset_edit_save', '保存为新版本'), 'asset-edit-save', { id: asset.id, primary: true })}
      </div>
    </div>`;
  }

  function assetDetail(asset, route) {
    // 编辑态（2026-09-17 报告建议 A）：正文区替换为编辑表单——改自己写的
    // 话不该以"系统先产候选"为前提；保存走 recall.assets.update（+1 版本，
    // 与候选采纳产出的版本同链）。类型与范围不在表单里：类型变更走候选线
    // 重审，范围自由文本会再触发 scope 迁移产空版本。
    // 资产级状态与开关贴着标题（2026-09-17 二改，子安红线口径）：标题右侧
    // 放总开关、标题下方一句实时生效说明——资产级信息归顶部（正文是内容、
    // 不是状态说明的挂载点）。异常态（删除/归并）仍走下方独立块。
    const editing = !!route.assetEdit && ['active', 'paused'].includes(String(asset.status || 'active'));
    const statusKind = String(asset.status || 'active');
    const statusOn = statusKind === 'active';
    const switchable = statusKind === 'active' || statusKind === 'paused';
    const switchEl = window.uiSwitch({
      label: T('cognition.asset_switch_label', '自动带入新任务'),
      checked: statusOn,
      attrs: {
        'data-act': 'asset-action',
        'data-id': asset.id,
        'data-action': statusOn ? 'pause' : 'resume',
      },
    });
    const switchHint = statusOn
      ? T('cognition.asset_switch_on_hint', '使用中：这条资产会自动带入你的新任务，作为背景知识提供给 AI')
      : T('cognition.asset_switch_off_hint', '已暂停：新任务不再自动带入这条资产；历史与使用记录全部保留，随时可打开');
    const topControl = statusKind === 'deleted'
      ? `<div class="sect-block"><p class="note">${esc(T('cognition.asset_deleted_hint', '已删除的资产在保留期内可恢复；恢复后重新出现在常用资产。'))}</p><div class="actions">${btn(T('cognition.asset_restore_deleted', '恢复'), 'asset-action', { id: asset.id, data: { action: 'restore' }, primary: true, small: true })}</div></div>`
      : statusKind === 'archived'
        ? `<div class="sect-block"><p class="note">${esc(T('cognition.asset_archived_note', '已归并：这条资产已并入另一条资产，历史版本完整保留在并入目标的版本记录中。'))}</p></div>`
        : '';
    // 详细信息与证据已按版本下沉（2026-09-17 子安口径）：范围/怎么来的/证据
    // 各版不同、存于各版快照——归版本展开块显示，顶部不再放资产级副本。
    const moreRow = (label, hint, action) => `
      <div class="ca-more-row">
        <div class="ca-more-copy"><strong>${esc(label)}</strong><span>${esc(hint)}</span></div>
        ${btn(label, 'asset-action', { id: asset.id, data: { action }, danger: true, small: true })}
      </div>`;
    /* 三段式重构（specs/018 T040~T042）：首屏固定三段——是什么 / 来历 /
     * 用过吗；版本历史、使用明细、实际采用记录、排序依据、标签、台账、归并
     * 收进「详情与历史」折叠区（T041，默认收起，内容不丢）。 */
    /* 来历（T040②）：来源会话 chip、那次任务的复盘 chip——可点回。解析一律
     * 走唯一解析器 + 唯一呈现出口（evidenceChip，2026-09-25 US-603 口径）；
     * legacy 字符串形态的来源先归一成 {id} 再解析。 */
    const refs = (asset.evidenceRefs || [])
      .map((ref) => ((ref && typeof ref === 'object') ? ref : { id: String(ref || '') }))
      .filter((ref) => String(ref.id || '').trim());
    const originSection = `<div class="sect-block">
      <div class="sub"><strong>${esc(T('cognition.asset_origin_section', '来历'))}</strong>${refs.length ? `<span class="note">${String(refs.length)}</span>` : ''}</div>
      ${refs.length ? evidenceGroupsHtml(refs) : `<div class="sub">${esc(T('cognition.asset_origin_empty', '没有可追溯的来源记录。'))}</div>`}
    </div>`;
    /* 用过吗（T040③/T042）：实际采用 N 次 · 最近一次 {when}（可点回那次会话
     * 或任务）· 被带入 N 次。口径零改动：实际采用=applied 回执（钉死口径），
     * 被带入走 broughtInCountFor 唯一公式；逐条明细在「详情与历史」折叠区。 */
    const realKinds = new Set(Array.isArray(S.realUsageKinds) ? S.realUsageKinds : []);
    const realProofs = S.proofs
      .filter((p) => realKinds.has(String(p.kind || '')) && String((p.refs || {}).assetId || '') === String(asset.id))
      .sort((left, right) => String(right.occurredAt || '').localeCompare(String(left.occurredAt || '')));
    const lastProof = realProofs[0] || null;
    const receipts = (S.adoptionReceipts && String(S.adoptionReceipts.assetId || '') === String(asset.id)
      && Array.isArray(S.adoptionReceipts.items)) ? S.adoptionReceipts.items : [];
    const appliedCount = receipts.filter((r) => String(r.status || '') === 'applied').length;
    const broughtIn = broughtInCountFor(asset.id);
    const usedSummary = [
      appliedCount ? T('cognition.adoption_applied_times', '实际采用 {n} 次', { n: String(appliedCount) }) : '',
      lastProof ? T('cognition.asset_last_used_at', '最近真用过 {when}', { when: fmtDate(lastProof.occurredAt) }) : '',
      broughtIn ? T('cognition.proof_projected_times', '被带入任务 {n} 次', { n: String(broughtIn) }) : '',
    ].filter(Boolean).join(' · ');
    const lastRef = lastProof
      ? ((lastProof.refs || {}).conversationId
        ? { kind: 'conversation', id: String(lastProof.refs.conversationId) }
        : String((lastProof.refs || {}).episodeId || '').startsWith('kse-') ? { kind: 'execution', id: String(lastProof.refs.episodeId) } : null)
      : null;
    const usedSection = `<div class="sect-block">
      <div class="sub"><strong>${esc(T('cognition.asset_used_section', '用过吗'))}</strong></div>
      ${termFootnote(['receipt'])}
      ${usedSummary
        ? `<div class="chips ca-used-line"><span class="note">${esc(usedSummary)}</span>${lastRef ? evidenceChip(lastRef) : ''}</div>`
        : `<div class="sub">${esc(T('cognition.asset_no_proofs_section', '还没有被真实使用过。资产在任务中被真正使用、并留下可核对的记录后，会出现在这里。'))}</div>`}
    </div>`;
    /* 状态章三件（T040①）：类型 / 生效中（正常态也出章，018 覆盖 2026-09-17
     * 「正常不摆章」的减噪决策）/ 敏感档位（术语表脚注语义由待办分组区承担）。 */
    const sensitivityTag = (() => {
      if (!['active', 'paused'].includes(String(asset.status || 'active'))) return '';
      const level = asset.sensitivity ? String(asset.sensitivity) : '';
      const tag = level
        ? window.uiTag({ label: level, variant: 'version' })
        : window.uiTag({ label: T('cognition.asset_sensitivity_unclassified', '未分级'), variant: 'outline' });
      return `<span class="ca-fact"><span class="note">${esc(term('sensitivity'))}</span> ${tag}</span>`;
    })();
    const factsLine = `<div class="sub ca-detail-facts">
      ${chip(categoryLabel(asset.type))}
      ${assetStatusChip(asset)}
      ${sensitivityTag}
    </div>`;
    /* 「详情与历史」折叠区（T041）：版本历史 / 使用明细 / 实际采用记录 /
     * 排序依据 / 标签 / 归并收这里，默认收起、内容不丢。台账（生命周期
     * 记录）紧随其后自成一行折叠，同为默认收起——同为「按需展开」层。 */
    const historyFold = foldBlock(
      T('cognition.asset_history_fold', '详情与历史'),
      null,
      T('cognition.asset_history_fold_hint', '版本历史、使用明细、实际采用记录、标签、台账与归并都在这里，内容一样全。'),
      `${assetTagsSection(asset)}${assetVersionsSection(asset)}${assetUsageSection(asset, route)}${assetRankingWhySection(asset)}${assetAdoptionSection(asset)}${assetMergeSection(asset)}`,
      'ca-detail-history',
    );
    const recommendWarn = (() => {
      /* 推荐卡（告警位，紧贴页头）：recommendedAction 数据存在时渲染。 */
      const ra = asset.recommendedAction;
      if (!ra || !['active', 'paused'].includes(String(asset.status || ''))) return '';
      const label = ra === 'pause'
        ? T('cognition.asset_recommend_pause', '系统建议暂停使用这条资产')
        : T('cognition.asset_recommend_rework', '系统建议返工这条资产');
      const reason = asset.recommendationReason || '';
      const btnHtml = btn(T('cognition.asset_recommend_ack', '知道了'), 'asset-recommend-ack', { id: asset.id, small: true });
      return `<div class="warn" style="display:flex;align-items:flex-start;gap:9px">
          <div style="flex:1"><b>${esc(label)}</b>
            <div class="note" style="margin-top:3px">${esc(T('cognition.asset_recommend_reason', '原因'))}：${esc(reason)}</div></div>
          ${btnHtml}</div>`;
    })();
    return `
    ${btn(T('cognition.asset_back', '← 返回列表'), 'go-back', { className: 'backlink' })}
    <div class="card ca-asset-detail">
      ${topControl}
      ${recommendWarn}
      <div class="rowline">
        <div>
          <h1>${esc(asset.title || asset.id)}</h1>
          ${switchable ? `<div class="sub">${esc(switchHint)}</div>` : ''}
        </div>
        <div class="right">${switchable ? switchEl : detailStatusChip(asset)}${['active'].includes(String(asset.status || 'active')) ? btn(T('cognition.asset_use_in_chat', '用到当前对话'), 'asset-use-in-chat', { id: asset.id, small: true }) : ''}</div>
      </div>
      ${editing ? assetEditForm(asset) : `<p class="content-text">${esc(asset.statement || '')}</p>`}
      ${factsLine}
      ${originSection}
      ${usedSection}
      ${historyFold}
      ${(() => {
        /* 审计履历块：auditRows.slice(0,12) + 超限提示。动作标签显式列全
         * （与 asset-service.ts::AbilityAssetAuditRecord 的 action 联合类型
         * 一一对应），i18n 覆盖门禁按 T() 调用点扫描，动态拼键扫不到。 */
        const AUDIT_ACTION_LABELS = {
          created: T('cognition.audit_created', '创建'),
          updated: T('cognition.audit_updated', '更新内容'),
          paused: T('cognition.audit_paused', '暂停使用'),
          resumed: T('cognition.audit_resumed', '恢复使用'),
          revoked: T('cognition.audit_revoked', '撤回使用'),
          archived: T('cognition.audit_archived', '归档'),
          deleted: T('cognition.audit_deleted', '删除'),
          purged: T('cognition.audit_purged', '彻底清除'),
          restored: T('cognition.audit_restored', '恢复删除'),
          rolled_back: T('cognition.audit_rolled_back', '版本回滚'),
          version_selected: T('cognition.audit_version_selected', '切换在用版本'),
          version_deleted: T('cognition.audit_version_deleted', '删除版本'),
          merged_from: T('cognition.audit_merged_from', '归并来源'),
          merged_into: T('cognition.audit_merged_into', '归并入'),
          maturity_downgraded: T('cognition.audit_maturity_downgraded', '成熟度降档'),
          maturity_advanced: T('cognition.audit_maturity_advanced', '成熟度升档'),
          maturity_corrected: T('cognition.audit_maturity_corrected', '成熟度修正'),
          pause_recommended: T('cognition.audit_pause_recommended', '系统建议暂停'),
          rework_recommended: T('cognition.audit_rework_recommended', '系统建议返工'),
          recommendation_cleared: T('cognition.audit_recommendation_cleared', '推荐已确认'),
          cross_scope_confirmed: T('cognition.audit_cross_scope_confirmed', '跨范围确认'),
          cross_scope_withdrawn: T('cognition.audit_cross_scope_withdrawn', '跨范围撤回'),
          // 资产管家安全网（specs/008 US-404）。
          danger_snapshot: T('cognition.audit_danger_snapshot', '危险操作前留档'),
          danger_confirmed: T('cognition.audit_danger_confirmed', '危险操作已确认'),
          danger_denied: T('cognition.audit_danger_denied', '危险操作未确认'),
          attempt_blocked: T('cognition.audit_attempt_blocked', '操作被拦下'),
        };
        /* 台账四项（specs/008 US-404 T029）：谁（actor）/ 何时（at）/ 前后值 / 依据，
         * 四项都要在界面上看得见——只给一句"更新内容"等于没账。 */
        const AUDIT_ACTOR_LABELS = {
          user: T('cognition.audit_actor_user', '你'),
          ai: T('cognition.audit_actor_ai', 'AI'),
          system: T('cognition.audit_actor_system', '系统'),
        };
        // 台账来自版本链读口（同一个资产、同一次拉取）。此前只认 asset.audit，
        // 而那个字段从来没有被赋过值——这一整块审计区是死的（2026-09-25 真机抓出）。
        const auditRows = Array.isArray(asset.audit) && asset.audit.length
          ? asset.audit
          : (S.assetVersions && String(S.assetVersions.assetId) === String(asset.id) && Array.isArray(S.assetVersions.audit)
            ? S.assetVersions.audit
            : []);
        const rows = auditRows.slice(0, 12);
        if (!rows.length) return '';
        const items = rows.map(function (row) {
          const label = AUDIT_ACTION_LABELS[String(row.action)] || String(row.action);
          const actor = AUDIT_ACTOR_LABELS[String(row.actor || '')] || '';
          // 依据取 `reason`（权威字段）优先、`note` 兜底：写入时两者同源，但只认
          // note 会让"有 reason 没有 note"的记录在界面上丢掉依据。
          const basis = row.reason || row.note;
          const note = basis ? ' · ' + esc(String(basis)) : '';
          const head = (actor ? esc(actor) + ' · ' : '') + '<b>' + esc(label) + '</b>' + note;
          // 前后值摘要（台账四项之一）：正文类字段在服务端已截成"字数·前缀"，
          // 这里只负责显示，不做二次加工。
          const change = (row.before || row.after)
            ? '<div class="sub">' + esc(String(row.before || '—')) + ' → ' + esc(String(row.after || '—')) + '</div>'
            : '';
          // 一步回滚入口（US-404 T030）：服务端给了回滚锚点才给按钮——从 before
          // 摘要里反解版本号是解析展示文本，迟早会错。
          const canRollback = !!row.rollbackAnchor
            && !['archived', 'deleted', 'purged', 'revoked'].includes(String(asset.status || 'active'));
          const rollback = canRollback
            ? '<div class="sub">' + btn(T('cognition.audit_rollback_to_before', '回滚到这次改动前'),
              'rollback-asset', { id: asset.id, data: { version: String(row.rollbackAnchor) }, small: true }) + '</div>'
            : '';
          return '<div class="proc-row"><span class="when">' + esc(fmtDate(row.at)) + '</span>'
            + '<span style="flex:1">' + head + change + rollback + '</span></div>';
        }).join('');
        const tip = auditRows.length > 12
          ? '<div class="note" style="margin-top:6px">' + esc(T('cognition.audit_truncated', '仅显示最近 12 条；真实环境由审计流提供完整履历。')) + '</div>'
          : '';
        return '<details class="details" style="margin-top:14px"><summary>' + esc(T('cognition.audit_section', '生命周期记录')) + '</summary><div class="dbody">' + items + tip + '</div></details>';
      })()}
      <div class="ca-more-wrap">
        ${btn(T('cognition.asset_more', '更多操作'), 'toggle-asset-more', { className: 'ca-more-toggle' })}
        <div class="ca-more" data-asset-more hidden>
          ${moreRow(T('cognition.asset_delete', '删除'), T('cognition.asset_delete_hint', '从资产列表移除，历史记录保留'), 'delete')}
          ${moreRow(T('cognition.asset_revoke', '撤回使用'), T('cognition.asset_revoke_hint', '只影响未来的任务'), 'revoke')}
          ${moreRow(T('cognition.asset_purge', '彻底清除'), T('cognition.asset_purge_hint', '删除全部历史与证据，不可恢复'), 'purge')}
        </div>
      </div>
    </div>`;
  }

  /** 存量治理（2026-09-16）：同义资产归并面板——同类型的其他条目可选为
   *  归并目标，本条版本链并入它（本条归档、较新内容为在用）。 */
  function assetMergeSection(asset) {
    const sameType = S.assets
      .filter((a) => String(a.id) !== String(asset.id)
        && a.type === asset.type
        && !['archived', 'deleted', 'purged', 'revoked'].includes(String(a.status || 'active')))
      .slice(0, 8);
    if (!sameType.length) return '';
    const rows = sameType.map((other) => `<div class="row is-flat">
      <div class="tw"><div class="tt">${esc(other.title || other.id)}</div><div class="mm">v${esc(String(other.activeVersion || other.version || '1'))}</div></div>
      <div class="sd">${btn(T('cognition.asset_merge_into', '并入这条'), 'merge-asset', { id: asset.id, data: { target: String(other.id) }, small: true })}</div>
    </div>`).join('');
    return `<details class="details">
      <summary>${esc(T('cognition.asset_merge_section', '与另一条合并（同一认知的重复条目）'))}</summary>
      <p class="note">${esc(T('cognition.asset_merge_hint', '把本条的全部历史版本并入所选条目：较新的内容成为其新版本，本条归档不再单独显示。'))}</p>
      ${rows}
    </details>`;
  }

  /* ────────────────────────── 视图：我的认知 ────────────────────────── */

  /** 大类分组（2026-09-22 清单 #2·面板侧）：按 same_family 关系做连通分量，
   *  一组＝一个大类；组名默认取组内最近更新的资产标题（族命名功能挂本体分组，
   *  后续轮接）；无族关系的资产归入无血缘组。视图与筛选都保留原行为——
   *  分组只改变排列，不改变可见性。
   *  （specs/012 T008：族名 = 同源血缘，**不是**主题分类（主题分类见 tags）；
   *  呈现话术已降级——组头计数/无组文案在 i18n 改值，本函数逻辑零改动。） */
  function familyGroupsOf(assets) {
    const parent = new Map(assets.map((asset) => [String(asset.id), String(asset.id)]));
    const find = (id) => { let root = id; while (parent.get(root) !== root) root = parent.get(root); return root; };
    const union = (a, b) => { const ra = find(a); const rb = find(b); if (ra !== rb) parent.set(ra > rb ? rb : ra, ra > rb ? ra : rb); };
    const byId = new Map(assets.map((asset) => [String(asset.id), asset]));
    for (const asset of assets) {
      for (const relation of asset.relations || []) {
        if (relation.kind !== 'same_family') continue;
        if (byId.has(String(relation.assetId))) union(String(asset.id), String(relation.assetId));
      }
    }
    const groups = new Map();
    for (const asset of assets) {
      const root = find(String(asset.id));
      const bucket = groups.get(root) || [];
      bucket.push(asset);
      groups.set(root, bucket);
    }
    const named = [];
    let unsorted = [];
    /* 组名兜底短名（2026-09-21 修）：原来直接 slice(0,10)，把
       「沟通风格偏好（2026-09-19 明确提出）：…」切成「沟通风格偏好（2026」——
       括号/日期被腰斩，读起来是乱码。改成先取自然头段（到冒号/括号/间隔号
       为止），仍超长才截断加省略号。 */
    const shortName = (rawTitle) => {
      const raw = String(rawTitle || '').trim();
      const head = raw.split(/[：:（(【[·—]/)[0].trim();
      const base = head || raw;
      return base.length > 12 ? `${base.slice(0, 12)}…` : base;
    };
    for (const bucket of groups.values()) {
      if (bucket.length >= 2) {
        // 组名（2026-09-22 族可命名）：用户起的名优先；默认短名取用得最多的
        // 那条资产标题的头段。
        const namedOne = bucket.find((a) => String(a.familyName || '').trim());
        const fallback = bucket.slice().sort((a, b) => String(b.title || '').length - String(a.title || '').length)[0];
        const title = namedOne
          ? String(namedOne.familyName).trim()
          : shortName(fallback?.title);
        named.push({ title, anchorId: String(bucket[0].id), named: Boolean(namedOne), assets: bucket });
      } else {
        unsorted = unsorted.concat(bucket);
      }
    }
    named.sort((a, b) => String(b.assets.length).localeCompare(String(a.assets.length)));
    if (unsorted.length) named.push({ title: '', anchorId: '', named: false, assets: unsorted });
    return named;
  }

  /* ────────────────────────── 视图:认知树(独立页) ────────────────────────── */
  /* 2026-09-21 五页签迁移:树从「我的认知」页顶部的卡片拆成独立全屏页。
   * 树只讲结构(冠/枝/干/根/土),资产明细全部留在「我的认知」——两个入口
   * 一份事实源,树上的每次点击都是导航而不是就地展开。 */

  function viewTree(route) {
    const stats = NS.stats();
    const counts = {};
    for (const [id] of CATEGORIES) counts[id] = S.assets.filter((a) => a.type === id && !['archived', 'deleted', 'purged', 'revoked'].includes(String(a.status || 'active'))).length;
    const sourceCount = S.sources.reduce((n, group) => n + (Array.isArray(group.items) ? group.items.length : 0), 0);
    const captureCount = Array.isArray(S.captures) ? S.captures.length : 0;
    // 计数口径(计划 4.4):已验证 = 成熟度达标且 active;待确认走 stats 口径
    // (countsAsPending && !isSnoozed);叶片方向按枝派生。
    const validated = S.assets.filter((a) => String(a.status || 'active') === 'active'
      && (a.maturity === 'transfer_validated' || a.maturity === 'effectiveness_validated')).length;
    const directions = { kstar: [] };
    for (const branch of TREE_BRANCHES) {
      const assets = S.assets.filter((a) => a.type === branch.id
        && !['archived', 'deleted', 'purged', 'revoked'].includes(String(a.status || 'active')));
      directions[branch.id] = branchDirections(assets);
      if (assets.some((a) => NS.isKstarAsset && NS.isKstarAsset(a))) directions.kstar.push(branch.id);
    }
    /* 原型 v7 树页：整页一棵树 + 顶部一条读法提示 + 底部图例，
       没有页头卡片。018 T020：读法提示升级为页头导语（一页一问：
       「我的认知长什么样、有什么新变化」），旧 read_hint 与图例重复，
       就此退场（T023）。 */
    return `
      <div class="tree-stage${S.loading && !S.loaded ? ' is-loading' : ''}">
        <div class="fl-top">
          <div class="ft ft-title">${esc(T('cognition.tree_panel_title', '我的认知树'))}</div>
          <div class="ft">${esc(T('cognition.tree_page_hint', '这棵树是你的认知全景：土壤是记录与来源，根部是待确认的候选，枝上是正式资产，树冠是被真实复用验证过的。'))}</div>
          <div class="ft">${btn(T('cognition.catalog_view_back', '列表视图'), 'asset-view', { id: '', small: true, className: 'o' })}</div>
        </div>
        ${treeFigure({ counts, pending: stats.pending, validated, sources: sourceCount, captures: captureCount }, directions)}
        <div class="fl-bottom">
          <div class="legend">
            <span class="k"><span class="dt" style="background:var(--green)"></span>${esc(T('cognition.tree_legend_validated', '被真用过'))}</span>
            <span class="k"><span class="dt" style="background:var(--green-line)"></span>${esc(T('cognition.tree_legend_asset', '资产'))}</span>
            <span class="k"><span class="dt" style="background:var(--blue)"></span>${esc(T('cognition.tree_legend_kstar', '任务复盘学的'))}</span>
            <span class="k"><span class="dt" style="background:var(--amber-dot)"></span>${esc(T('cognition.tree_legend_pending', '新芽（待确认）'))}</span>
            <span class="legend-hint">${esc(T('cognition.tree_legend_hint', '枝端光斑 = 大方向 · 叶片 = 细分方向 · 悬停看详情'))}</span>
          </div>
        </div>
        <div class="tip" id="ca-tree-tip" role="tooltip"></div>
      </div>`;
  }

  /* ────────────────────────── 视图:个人本体(独立页挂载点) ────────────────────────── */
  /* 本体页的真实内容不在本文件:render() 把这个 mount 放进内容区后,由
   * core.mountPersonalOntology 把 index.html 里的本体 section 移进来并调
   * window.renderPersonalOntology()——本体模块自持状态,切页不销毁。 */

  function viewOntology() {
    return '<div id="ca-ontology-mount" class="ca-ontology-mount"></div>';
  }

  /* ────────────────────────── 标签系统（specs/012 US-201，T010~T013）──────────────────────────
   * 全部走共享控件（uiTag/uiInput/uiCheckbox/uiSegmentedControl/uiProgressBar/
   * uiModalController），零裸控件；可见文案一律 T() 内联（i18n 门禁扫得到）；
   * 渲染层只按主进程给的标签顺序消费（assetCount 常用置顶），不重排。 */

  /** 标签库快照的 active 子集（T012：筛选条只显示 assetCount>0 的 active）。 */
  const activeTagsWithAssets = () => ((S.tags && Array.isArray(S.tags.items)) ? S.tags.items : [])
    .filter((tag) => tag && String(tag.state || 'active') === 'active' && Number(tag.assetCount || 0) > 0);

  /** 标签筛选路由解析的取用件：真机恒走 core.parseTagFilterRoute（唯一处）；
   *  极简测试夹具（只装 views 不装 core 的 NS 桩）按同一口径就地兜底，标签
   *  筛选在桩里自然退化为「未启用」。 */
  const tagRouteState = (route) => {
    if (typeof NS.parseTagFilterRoute === 'function') return NS.parseTagFilterRoute(route);
    return {
      names: [],
      untagged: String((route && route.tagUntagged) || '') === '1',
      mode: String((route && route.tagMode) || '') === 'all' ? 'all' : 'any',
    };
  };

  /** 资产详情「标签」section（T010）：已有标签 uiTag + 移除；uiInput + 候选
   *  下拉（<details>+chips）+「添加」；回车提交在 app.js 委托层带 IME 守卫。
   *  空态 = 「未分类」+ 一句引导。提交走整组替换（core.setAssetTags）。 */
  function assetTagsSection(asset) {
    if (!['active', 'paused'].includes(String(asset.status || 'active'))) return '';
    const tags = Array.isArray(asset.tags) ? asset.tags : [];
    const key = (value) => String(value || '').trim().toLocaleLowerCase();
    const existingKeys = new Set(tags.map((entry) => key(entry)));
    const candidates = activeTagsWithAssets()
      .filter((tag) => !existingKeys.has(key(tag.name)))
      .slice(0, 8);
    const chipsHtml = tags.map((name) => `
      <span class="ca-tag-item">
        ${window.uiTag({ label: String(name), variant: 'outline', className: 'ca-tag-chip' })}
        ${btn(T('cognition.tag_remove', '移除'), 'tag-remove', { id: asset.id, data: { name: String(name) }, small: true, className: 'rnm' })}
      </span>`).join('');
    const inputId = `ca-tag-add-${esc(String(asset.id))}`;
    return `
      <div class="sect-block" data-asset-tags>
        <div class="sub"><strong>${esc(T('cognition.tag_section', '标签'))}</strong>${tags.length ? `<span class="note">${String(tags.length)}</span>` : ''}</div>
        ${tags.length
          ? `<div class="chips ca-tags-row">${chipsHtml}</div>`
          : `<p class="note">${esc(T('cognition.tag_empty', '未分类'))} · ${esc(T('cognition.tag_empty_hint', '打标签后可在列表里按主题筛选'))}</p>`}
        <div class="chips ca-tags-row">
          ${window.uiInput({
            id: inputId,
            placeholder: T('cognition.tag_add_placeholder', '新标签，回车或点「添加」'),
            className: 'litxt ca-tag-input',
            attrs: { 'data-tag-input': '1', 'data-asset-id': String(asset.id), maxlength: '20' },
          })}
          ${btn(T('cognition.tag_add', '添加'), 'tag-add', { id: asset.id, small: true })}
          ${candidates.length ? `
            <details class="details ca-tag-candidates">
              <summary>${esc(T('cognition.tag_candidates', '选择已有标签'))}</summary>
              <div class="chips">${candidates.map((tag) => btn(String(tag.name), 'tag-add', { id: asset.id, data: { name: String(tag.name), preset: '1' }, className: 'chip' })).join('')}</div>
            </details>` : ''}
        </div>
      </div>`;
  }

  /** 标签筛选行（T012）：类型 chips 旁的另一根轴；只显示 assetCount>0 的
   *  active + 「未分类」chip（计数按其它筛选生效后算）+ 交/并集切换 +
   *  「更多」弹层 + 「管理标签」入口。空库（无任何可显示 chip）不渲染该行。 */
  function tagFilterBar(route, baseAssets) {
    if (String(route.category || '') === 'deleted') return '';
    const tagState = tagRouteState(route);
    const tags = activeTagsWithAssets();
    // 空库（无任何可显示标签）→ 整行不显示：库为空时「未分类 = 全量」，
    // 摆一个只会筛出全量的 chip 只会误导（spec Edge：筛选不误伤）。
    if (!tags.length) return '';
    const untaggedCount = baseAssets.filter((asset) => (Array.isArray(asset.tags) ? asset.tags : []).length === 0).length;
    const visible = tags.slice(0, 12);
    const hiddenCount = Math.max(0, tags.length - visible.length);
    const key = (value) => String(value || '').trim().toLocaleLowerCase();
    const chipOf = (name, count) => {
      const on = tagState.names.some((entry) => key(entry) === key(name));
      return btn(`${name} ${count}`, 'filter-tag', { id: name, className: `chip${on ? ' on' : ''}` });
    };
    const countOf = (name) => baseAssets.filter((asset) => (Array.isArray(asset.tags) ? asset.tags : [])
      .some((entry) => key(entry) === key(name))).length;
    const chips = visible
      .filter((tag) => countOf(tag.name) > 0 || tagState.names.some((entry) => key(entry) === key(tag.name)))
      .map((tag) => chipOf(tag.name, countOf(tag.name)));
    const untaggedChip = untaggedCount > 0 || tagState.untagged
      ? btn(`${T('cognition.tag_untagged', '未分类')} ${untaggedCount}`, 'filter-untagged', { className: `chip${tagState.untagged ? ' on' : ''}` })
      : '';
    const modeToggle = window.uiSegmentedControl({
      ariaLabel: T('cognition.tag_filter_label', '标签'),
      value: tagState.mode,
      items: [
        { label: T('cognition.tag_filter_any', '任一标签'), value: 'any', attrs: { 'data-act': 'filter-tag-mode', 'data-mode': 'any' } },
        { label: T('cognition.tag_filter_all', '同时具备'), value: 'all', attrs: { 'data-act': 'filter-tag-mode', 'data-mode': 'all' } },
      ],
    });
    const active = tagState.names.length > 0 || tagState.untagged;
    return `
      <div class="pillbox ca-tag-filter${active ? ' is-on' : ''}">
        <div class="chips">
          ${chips.join('')}
          ${untaggedChip}
          ${hiddenCount ? btn(T('cognition.tag_more', '更多'), 'tag-more', { className: 'chip' }) : ''}
        </div>
        ${modeToggle}
        ${btn(T('cognition.tag_manage', '管理标签'), 'tag-manage', { small: true, className: 'o' })}
      </div>`;
  }

  /** 「未分类」+「同时具备」= 永远空集：给明确空态说明（T012 Edge）。 */
  const tagFilterContradiction = (route) => {
    const state = tagRouteState(route);
    return state.untagged && state.mode === 'all' && state.names.length > 0;
  };

  /** 多选态批量条（T011）：已选 N / 全选本页 / 清空 + 三选一语义 + 标签输入
   *  + 执行 + 可见进度（uiProgressBar）+ 逐项失败清单（不截断）。 */
  function tagBatchBar(route, pageAssets) {
    const selected = new Set((S.tagSelectIds || []).map(String));
    const op = String(S.tagBatchOp || 'add');
    const batch = S.tagBatch || null;
    const seg = window.uiSegmentedControl({
      ariaLabel: T('cognition.tag_batch_op_aria', '批量操作语义'),
      value: op,
      items: [
        { label: T('cognition.tag_batch_op_add', '打标'), value: 'add', attrs: { 'data-act': 'tag-batch-op', 'data-op': 'add' } },
        { label: T('cognition.tag_batch_op_remove', '去标'), value: 'remove', attrs: { 'data-act': 'tag-batch-op', 'data-op': 'remove' } },
        { label: T('cognition.tag_batch_op_replace', '替换为'), value: 'replace', attrs: { 'data-act': 'tag-batch-op', 'data-op': 'replace' } },
      ],
    });
    const progress = batch
      ? `
        <div class="ca-tag-progress">
          ${window.uiProgressBar({
            ariaLabel: T('cognition.tag_batch_progress', '批量打标中 {done}/{total}', { done: String(batch.done), total: String(batch.total) }),
            value: batch.done,
            max: Math.max(1, batch.total),
          })}
          <span class="note">${esc(T('cognition.tag_batch_progress', '批量打标中 {done}/{total}', { done: String(batch.done), total: String(batch.total) }))}</span>
        </div>
        ${batch.failed && batch.failed.length ? `
          <div class="ca-tag-failures">
            <p class="note"><strong>${esc(T('cognition.tag_batch_failed_title', '有 {n} 条没成功：', { n: String(batch.failed.length) }))}</strong></p>
            ${batch.failed.map((item) => `<p class="note">· ${esc(item.title || item.assetId)}${item.note ? ` — ${esc(item.note)}` : ''}</p>`).join('')}
            <p class="note">${esc(T('cognition.tag_batch_failed_note', '可重跑：已完成的项不会重复改。'))}</p>
            ${btn(T('cognition.tag_batch_dismiss', '收起失败清单'), 'tag-batch-dismiss', { small: true, className: 'rnm' })}
          </div>` : ''}`
      : '';
    return `
      <div class="ca-batch-bar" data-tag-batch-bar>
        <span class="sub">${esc(T('cognition.tag_selected_count', '已选 {n} 条', { n: String(selected.size) }))}</span>
        ${btn(T('cognition.tag_select_all', '全选本页'), 'tag-select-all', { small: true, className: 'rnm' })}
        ${btn(T('cognition.tag_select_clear', '清空'), 'tag-select-clear', { small: true, className: 'rnm' })}
        ${btn(T('cognition.tag_select_exit', '退出多选'), 'tag-select-mode', { small: true, className: 'rnm' })}
        <span class="sp"></span>
        ${seg}
        ${window.uiInput({
          id: 'ca-tag-batch-input',
          placeholder: T('cognition.tag_batch_tags_label', '标签（多个用顿号分隔）'),
          className: 'litxt ca-tag-input',
          attrs: { 'data-tag-batch-input': '1' },
        })}
        ${btn(T('cognition.tag_batch_run', '执行'), 'tag-batch-run', { small: true, primary: true, disabled: Boolean(batch && batch.running) })}
        ${progress}
      </div>`;
  }

  /** 管理弹层 / 「更多」弹层（T013/T012「更多」）：markup 落进持久壳槽位
   *  （#ca-tag-overlay-slot，render() 维护），由 core.wireTagOverlay 过
   *  uiModalController。不新建页面。 */
  function tagOverlayHtml(route) {
    const mode = String(route.tagOverlay || '');
    if (mode !== 'more' && mode !== 'manage') return '';
    const allItems = (S.tags && Array.isArray(S.tags.items)) ? S.tags.items : [];
    const active = allItems.filter((tag) => String(tag.state || 'active') === 'active');
    const retired = allItems.filter((tag) => String(tag.state || '') === 'merged' || String(tag.state || '') === 'archived');
    const busy = Boolean(S.tagBatch && S.tagBatch.running);
    if (mode === 'more') {
      const state = tagRouteState(route);
      const key = (value) => String(value || '').trim().toLocaleLowerCase();
      const rows = active.filter((tag) => Number(tag.assetCount || 0) > 0).map((tag) => btn(
        `${tag.name} ${tag.assetCount}`,
        'filter-tag',
        { id: String(tag.name), className: `chip${state.names.some((entry) => key(entry) === key(tag.name)) ? ' on' : ''}` },
      )).join('');
      return `
        <div class="ui-modal-overlay" data-tag-overlay="more" hidden>
          <section class="ui-modal ui-modal--sm" role="dialog" aria-modal="true" aria-labelledby="ca-tag-more-title">
            <header class="ui-modal__header"><h2 class="ui-modal__title" id="ca-tag-more-title">${esc(T('cognition.tag_more_title', '全部标签'))}</h2></header>
            <div class="ui-modal__body"><div class="chips">${rows || `<p class="note">${esc(T('cognition.tag_manage_empty', '还没有标签——先在资产上打一个。'))}</p>`}</div></div>
          </section>
        </div>`;
    }
    // manage：三动作 + 同义建议（只建议）+ 已停用/已合并折叠区 + 批量进度。
    const suggestions = Array.isArray(S.tagSuggestions) ? S.tagSuggestions : [];
    const editId = String(S.tagManageEdit || '');
    const mergeState = S.tagManageMerge || null;
    const rowOf = (tag) => {
      if (String(tag.id) === editId) {
        return `
          <div class="row is-flat">
            <div class="tw"><div class="tt">${esc(tag.name)}</div>
              ${window.uiInput({ id: `ca-tag-rename-${esc(tag.id)}`, value: String(tag.name), className: 'litxt', attrs: { 'data-tag-rename-input': '1', maxlength: '20' } })}</div>
            <div class="sd">${btn(T('common.save', '保存'), 'tag-rename-save', { id: tag.id, small: true, primary: true })}${btn(T('common.cancel', '取消'), 'tag-rename-cancel', { small: true, className: 'rnm' })}</div>
          </div>`;
      }
      if (mergeState && String(mergeState.sourceId) === String(tag.id)) {
        const key = (value) => String(value || '').trim().toLocaleLowerCase();
        const targets = active.filter((other) => other.id !== tag.id).slice(0, 12);
        const targetSet = mergeState.targetName
          ? `<p class="note">${esc(T('cognition.tag_merge_target_set', '并入「{name}」', { name: mergeState.targetName }))}</p>`
          : `<p class="note">${esc(T('cognition.tag_merge_need_target', '先选择要并入的目标标签'))}</p>`;
        return `
          <div class="row is-flat">
            <div class="tw"><div class="tt">${esc(tag.name)} → ?</div>
              <p class="note">${esc(T('cognition.tag_merge_pick_target', '选择要并入的目标标签：'))}</p>
              <div class="chips">${targets.map((other) => btn(String(other.name), 'tag-merge-target', { id: tag.id, data: { name: String(other.name) }, className: `chip${mergeState.targetName && key(mergeState.targetName) === key(other.name) ? ' on' : ''}` })).join('')}</div>
              ${targetSet}</div>
            <div class="sd">${btn(T('cognition.tag_merge_confirm', '确认合并'), 'tag-merge-confirm', { id: tag.id, small: true, primary: true, disabled: busy })}${btn(T('common.cancel', '取消'), 'tag-merge-cancel', { small: true, className: 'rnm' })}</div>
          </div>`;
      }
      return `
        <div class="row is-flat">
          <div class="tw"><div class="tt">${esc(tag.name)}</div>
            <div class="mm">${esc(T('cognition.tag_asset_count', '{n} 条资产', { n: String(Number(tag.assetCount || 0)) }))}</div></div>
          <div class="sd">
            ${btn(T('cognition.tag_rename', '重命名'), 'tag-rename', { id: tag.id, small: true, className: 'rnm' })}
            ${btn(T('cognition.tag_merge', '合并'), 'tag-merge', { id: tag.id, small: true, className: 'rnm' })}
            ${btn(T('cognition.tag_delete', '停用'), 'tag-delete', { id: tag.id, small: true, danger: true })}
          </div>
        </div>`;
    };
    const suggestionHtml = suggestions.length ? `
      <div class="sect-block">
        <div class="sub"><strong>${esc(T('cognition.tag_suggestions', '可能重复的标签'))}</strong><span class="note">${esc(T('cognition.tag_suggestions_hint', '只是建议，不会自动合并'))}</span></div>
        ${suggestions.map((item) => `
          <div class="row is-flat">
            <div class="tw"><div class="tt">${esc(item.sourceName)} → ${esc(item.targetName)}</div>
              <div class="mm">${esc(item.reason === 'alias'
                ? T('cognition.tag_suggestion_reason_alias', '别名命中')
                : T('cognition.tag_suggestion_reason_similar', '名字相似'))}</div></div>
            <div class="sd">${btn(T('cognition.tag_suggestion_merge', '合并这组'), 'tag-suggestion-merge', { id: String(item.sourceName), data: { target: String(item.targetName) }, small: true })}</div>
          </div>`).join('')}
      </div>` : '';
    const retiredHtml = retired.length ? `
      <details class="details">
        <summary>${esc(T('cognition.tag_retired_section', '已停用 / 已合并的标签'))}</summary>
        <div class="dbody">
          ${retired.map((tag) => `
            <div class="row is-flat">
              <div class="tw"><div class="tt">${esc(tag.name)}</div>
                <div class="mm">${esc(String(tag.state) === 'merged'
                  ? T('cognition.tag_retired_state_merged', '已合并')
                  : T('cognition.tag_retired_state_archived', '已停用'))}${(tag.formerNames || []).length ? ` · ${esc(T('cognition.tag_retired_former', '曾用名：{names}', { names: tag.formerNames.join('、') }))}` : ''}${(tag.aliases || []).length ? ` · ${esc(T('cognition.tag_retired_aliases', '别名：{names}', { names: tag.aliases.join('、') }))}` : ''}</div></div>
            </div>`).join('')}
        </div>
      </details>` : '';
    const progress = S.tagBatch ? `
      <div class="ca-tag-progress">
        ${window.uiProgressBar({
          ariaLabel: T('cognition.tag_batch_progress', '批量打标中 {done}/{total}', { done: String(S.tagBatch.done), total: String(S.tagBatch.total) }),
          value: S.tagBatch.done,
          max: Math.max(1, S.tagBatch.total),
        })}
        <span class="note">${esc(T('cognition.tag_batch_progress', '批量打标中 {done}/{total}', { done: String(S.tagBatch.done), total: String(S.tagBatch.total) }))}</span>
      </div>` : '';
    return `
      <div class="ui-modal-overlay" data-tag-overlay="manage" hidden>
        <section class="ui-modal ui-modal--lg" role="dialog" aria-modal="true" aria-labelledby="ca-tag-manage-title">
          <header class="ui-modal__header"><h2 class="ui-modal__title" id="ca-tag-manage-title">${esc(T('cognition.tag_manage_title', '管理标签'))}</h2></header>
          <div class="ui-modal__body">
            ${active.length ? active.map(rowOf).join('') : `<p class="note">${esc(T('cognition.tag_manage_empty', '还没有标签——先在资产上打一个。'))}</p>`}
            ${suggestionHtml}
            ${retiredHtml}
            ${progress}
          </div>
          <footer class="ui-modal__footer">${btn(T('common.close', '关闭'), 'tag-overlay-close', {})}</footer>
        </section>
      </div>`;
  }

  function viewOverview(route) {
    const stats = NS.stats();
    // 两线不拆列表（2026-09-17 二次定调；2026-09-26 specs/017 整改一收窄）：
    // 全量列表+每条 KSTAR 资产打徽章（子安口径：出身标记直接带 KSTAR 字样）。
    // KSTAR 独立筛选档已退役——原位置改放「经验」分类档；已删除档保留全部
    //（保留期恢复入口只有这一处）。
    const counts = {};
    for (const [id] of CATEGORIES) counts[id] = S.assets.filter((a) => a.type === id && !['archived', 'deleted', 'purged', 'revoked'].includes(String(a.status || 'active'))).length;
    // 每个资产的最近使用时间（时间线里 occurredAt 的最大值）：列表行此前
    // 硬编码「最近无使用记录」，被真实复用过的资产也这么显示（终审修）。
    // 每个资产的最近使用时间（**只算「真实使用」**）：白名单由主进程单一定义、
    // 随载荷下发（2026-09-25 US-602 FR-004），列表与详情共用同一份。
    // 修复前这里对全部事件取 occurredAt 最大值——创建、保存版本、治理操作都会
    // 把「最近使用」刷新成今天，与详情侧口径打架（缺陷本体）。
    const realKinds = new Set(Array.isArray(S.realUsageKinds) ? S.realUsageKinds : []);
    const lastUseByAsset = new Map();
    for (const proof of S.proofs) {
      if (!realKinds.has(String(proof.kind || ''))) continue;
      const assetId = String((proof.refs || {}).assetId || '');
      const at = String(proof.occurredAt || '');
      if (!assetId || !at) continue;
      const current = lastUseByAsset.get(assetId);
      if (!current || at > current) lastUseByAsset.set(assetId, at);
    }
    const lastUseText = (assetId) => {
      const at = lastUseByAsset.get(String(assetId));
      return at
        ? T('cognition.asset_last_used_at', '最近真用过 {when}', { when: fmtDate(at) })
        : T('cognition.asset_last_use', '还没被用过');
    };
    /* 导语（specs/018 T030）：hero 统计条并入导语两个可点数字——
     * {n} 条认知（点开滚到列表）· {m} 条等你确认（去「待我处理」）。
     * n 与默认列表同口径（排除已删除/归档等隐藏态——stats.confirmed 口径
     * 更宽，真机上出现过 18 vs 16 的两个数字打架）。
     * 0 值分段不出现（迭代轮 2 猎区 1：空库时「0 条认知 · 0 条等你确认」
     * 与下方空态重复且无信息量，导语让位给空态的引导文案）。
     * 「当前任务选用」卡仍撤（2026-09-21 口径不变）。 */
    const visibleAssetCount = S.assets.filter((a) => !['archived', 'deleted', 'purged', 'revoked'].includes(String(a.status || 'active'))).length;
    const leadNum = (value, anchor) => `<span class="chip-link ca-jump-num" data-act="review-jump" data-id="${esc(anchor)}" ${roleBtn()}>${esc(String(value))}</span>`;
    const assetsPart = visibleAssetCount
      ? `${leadNum(visibleAssetCount, 'ca-asset-list')} ${esc(T('cognition.overview_lead_assets', '条认知'))}`
      : '';
    const pendingPart = stats.pending
      ? `<span class="chip-link ca-jump-num" data-act="go-review" ${roleBtn()}>${esc(String(stats.pending))}</span> ${esc(T('cognition.overview_lead_pending', '条等你确认'))}`
      : '';
    const heroLead = [assetsPart, pendingPart].filter(Boolean).length
      ? `<div class="sub">${[assetsPart, pendingPart].join(' · ')}</div>`
      : '';
    const heroHtml = hero(
      T('cognition.overview_title', '我的认知资产'),
      '',
      heroLead,
    );
    if (route.assetId) {
      const asset = S.assets.find((a) => String(a.id) === String(route.assetId));
      // 详情视图不显示统计条：那是列表页的上下文，详情页只讲这一条资产
      //（使用记录已并入详情，2026-09-15）。
      if (asset) return hero(T('cognition.overview_title', '我的认知资产'), '') + assetDetail(asset, route);
    }
    // 列表口径（2026-09-17 报告建议 G，顺带修 bug）：默认视图只放正常态
    // （archived/deleted/purged/revoked 都不混进来——此前只排除 archived，
    // 已删除资产会漏进「全部」）；「已删除」单列一档，保留期内可自助恢复。
    // purged/revoked 不单列（墓碑无内容/终态）。
    const HIDDEN_STATUS = ['archived', 'deleted', 'purged', 'revoked'];
    const deletedCount = S.assets.filter((a) => String(a.status || 'active') === 'deleted').length;
    // 经验档（specs/017 整改一）：经验不再单独成页签、KSTAR 不再单独成档——
    // pillbox 在原 KSTAR 位置给一个「经验」分类档（计数=非终态经验条目），
    // 档内渲染经验目录（SC-001 隔离照旧：只读 S.experiences，零资产混入）。
    const experienceItems = (((S.experiences && S.experiences.items) || []))
      .filter((item) => ['active', 'paused'].includes(String(item.status || 'active')));
    const filteredByType = route.category === 'deleted'
      ? S.assets.filter((a) => String(a.status || 'active') === 'deleted')
      : S.assets.filter((a) => !HIDDEN_STATUS.includes(String(a.status || 'active'))
        && (!route.category || a.type === route.category));
    // 标签筛选（specs/012 T012）：与类型筛选 AND 叠加、各自独立可清空；
    // Array.filter 保序——筛完仍按主进程给的顺序，渲染层不重排。
    const tagFilterState = tagRouteState(route);
    const tagFilterActive = Boolean(tagFilterState.names.length || tagFilterState.untagged)
      && typeof NS.matchesTagFilter === 'function';
    const filtered = tagFilterActive && route.category !== 'deleted'
      ? filteredByType.filter((a) => NS.matchesTagFilter(a, tagFilterState.names, tagFilterState.untagged, tagFilterState.mode))
      : filteredByType;
    // 「未分类」+「同时具备」恒为空集：明确说，不给一屏空白。
    const tagContradiction = route.category !== 'deleted' && tagFilterContradiction(route);
    const chips = [['', T('common.all', '全部'), S.assets.filter((a) => !HIDDEN_STATUS.includes(String(a.status || 'active'))).length]]
      .concat(CATEGORIES.map(([id, key, fallback]) => [id, T(key, fallback), counts[id]]))
      .concat([['experiences', T('cognition.assets_experiences_tab', '经验'), experienceItems.length]])
      .concat(deletedCount ? [['deleted', T('cognition.assets_deleted_tab', '已删除'), deletedCount]] : []);
    const pillboxHtml = `<div class="pillbox">${chips.map(([id, label, count]) => btn(`${label} ${count}`, 'filter-cat', { id, className: `chip${String(route.category || '') === id ? ' on' : ''}` })).join('')}</div>`;
    // 经验详情深链（experienceId）：仍归「我的认知」页；返回落点由 app.js
    // go-back 归到经验档（category='experiences'）。
    if (route.experienceId) return `${hero(T('cognition.overview_title', '我的认知资产'), '')}${viewExperienceDetail(route)}`;
    // 「经验」档：页头 + 分类档条 + 经验目录 + 存量迁移区。资产专属工具
    //（批量打标/目录视图/标签筛选/KSTAR 复盘折叠区）不进这个档（整改一第 3 条）。
    if (route.category === 'experiences') {
      return `${heroHtml}
        ${sectionHead(T('cognition.experience_title', '经验目录'), String(experienceItems.length))}
        ${pillboxHtml}
        <div class="note list-caption">${esc(T('cognition.experience_subtitle', '任务收口后沉淀的经验：哪类任务怎么做成了、栽在哪。经验与正式资产分开管理，互不混入。'))}</div>
        ${experienceDirectoryHtml()}
        ${experienceMigrationSection()}`;
    }
    /** 目录视图行（2026-09-18）：把"模型看到的那份目录"原样搬到面板上——
     *  标题 + 一句话 + 类型/范围/版本/用没用过。模型看目录挑资产、用户看同一份
     *  目录核对它的判断，两边看到的是同一件事。 */
    const catalogRow = (asset) => {
      const statement = String(asset.statement || '').replace(/\s+/g, ' ').trim();
      const oneLine = statement.split(/[。！？!?]/)[0] || statement;
      const used = broughtInCountFor(asset.id);
      const meta = [
        categoryLabel(asset.type),
        scopeLabelText(asset.scope),
        `v${String(asset.activeVersion || asset.version || '1')}`,
        // 目录行与列表/详情同口径（2026-09-25 US-602）：只算「被带入任务」，
        // 不把宿主注入说成"用过"，更不说成"实际采用"。
        used ? T('cognition.catalog_used_times', '被带入任务 {n} 次', { n: String(used) }) : T('cognition.catalog_never_used', '还没被带入过'),
      ].join(' · ');
      return `<div class="row" data-go-asset="${esc(asset.id)}" role="button" tabindex="0">
        <div class="tw">
          <div class="tt">${esc(asset.title || asset.id)}</div>
          ${oneLine ? `<div class="catline">${esc(oneLine.slice(0, 60))}</div>` : ''}
          <div class="mm">${esc(meta)}</div>
        </div>
        <div class="sd">${(S.modelSelectedAssetIds || []).includes(String(asset.id)) ? chip(T('cognition.catalog_model_attached', '模型挂着'), 'blue') : ''}${assetStatusChip(asset)}<span class="chev" aria-hidden="true">›</span></div>
      </div>`;
    };
    const catalogView = String(route.assetView || '') === 'catalog';
    /* 「管理」模式（specs/018 T031）：目录视图 / 批量打标 / 多选 / 同源分组
     * 默认不可见，收进这个小切换；普通用户默认视图永远只见列表。
     * 深链兜底：assetView=catalog 视同进入管理（旧深链不死链）。 */
    const manageMode = String(route.manage || '') === '1' || catalogView;
    // 多选态（specs/012 T011）：仅列表视图（目录/已删除档不给批量打标）；
    // 行左侧 uiCheckbox、行点击变成勾选（不再挂 data-go-asset 跳详情）。
    const tagSelectOn = String(route.tagSelect || '') === '1' && !catalogView && route.category !== 'deleted';
    const tagSelectedIds = new Set((S.tagSelectIds || []).map(String));
    const plainRow = (asset) => {
      // 行三事实（specs/018 T032）：类型 / 最近真用过（或「还没被用过」）/
      // 被带入 N 次。版本号收进详情（行上不再是第四件事）。
      const used = broughtInCountFor(asset.id);
      if (!tagSelectOn) return `
        <div class="row" data-go-asset="${esc(asset.id)}" role="button" tabindex="0">
          <div class="tw">
            <div class="tt">${esc(asset.title || asset.id)}</div>
            <div class="mm">${esc([
              categoryLabel(asset.type),
              lastUseText(asset.id),
              used ? T('cognition.catalog_used_times', '被带入任务 {n} 次', { n: String(used) }) : T('cognition.catalog_never_used', '还没被带入过'),
            ].join(' · '))}</div>
          </div>
          <div class="sd">${NS.isKstarAsset(asset) ? chip(T('cognition.asset_kstar_badge', 'KSTAR'), 'blue') : ''}${assetStatusChip(asset)}<span class="chev" aria-hidden="true">›</span></div>
        </div>`;
      const tags = Array.isArray(asset.tags) ? asset.tags : [];
      return `
        <div class="row">
          <div class="tw">
            <div class="tt">${window.uiCheckbox({
              id: `ca-tag-sel-${esc(String(asset.id))}`,
              label: String(asset.title || asset.id),
              checked: tagSelectedIds.has(String(asset.id)),
              attrs: { 'data-act': 'tag-select-toggle', 'data-id': String(asset.id) },
            })}<span>${esc(asset.title || asset.id)}</span></div>
            <div class="mm">${esc(categoryLabel(asset.type))} · v${esc(String(asset.activeVersion || asset.version || '1'))}${tags.length ? ` · ${esc(tags.join('、'))}` : ` · ${esc(T('cognition.tag_untagged', '未分类'))}`}</div>
          </div>
          <div class="sd">${NS.isKstarAsset(asset) ? chip(T('cognition.asset_kstar_badge', 'KSTAR'), 'blue') : ''}${assetStatusChip(asset)}</div>
        </div>`;
    };
    // 「已删除」行（specs/008 US-306/T051）：保留期剩余天数由服务端现算
    // （recall.assets.deleted.list），并给出**唯一**的「立即彻底删除」入口。
    // 注意：行上不能挂 data-go-asset——委托层先判 data-go-asset 再判 data-act，
    // 嵌在里面的按钮会被行跳转吃掉。所以点击区只在标题上。
    const deletedState = S.deletedAssets || null;
    const deletedById = new Map(((deletedState && deletedState.items) || []).map((item) => [String(item.id), item]));
    const deletedRow = (asset) => {
      const info = deletedById.get(String(asset.id)) || null;
      const retention = !info
        ? ''
        : info.retentionUnknown
          ? T('cognition.deleted_retention_unknown', '删除时间不可用：既不能恢复，也不会自动到期，请联系支持')
          : T('cognition.deleted_retention_left', '保留期还剩 {n} 天', { n: String(info.retentionDaysLeft ?? 0) });
      return `<div class="row">
        <div class="tw">
          <div class="tt"><a href="#" data-go-asset="${esc(String(asset.id))}">${esc(asset.title || asset.id)}</a></div>
          <div class="mm">${esc(categoryLabel(asset.type))} · v${esc(String(asset.activeVersion || asset.version || '1'))}${retention ? ` · ${esc(retention)}` : ''}</div>
        </div>
        <div class="sd">${assetStatusChip(asset)}${btn(T('cognition.deleted_purge_now', '立即彻底删除'), 'purge-deleted-asset', { small: true, danger: true, data: { id: String(asset.id) } })}</div>
      </div>`;
    };
    /* 默认排序（specs/018 T032）：按最近真实使用排（口径＝US-602 白名单，
     * 不是推荐分——「列表不按推荐分排序」的钉死口径不变）；没用过的排后面。
     * 管理模式保持主进程顺序 + 同源血缘分组（管理视角，默认不可见）。 */
    const lastUseAt = (asset) => String(lastUseByAsset.get(String(asset.id)) || '');
    const orderedAssets = manageMode ? filtered
      : [...filtered].sort((a, b) => lastUseAt(b).localeCompare(lastUseAt(a)));
    let listHtml = orderedAssets.length
      ? orderedAssets.map((asset) => (route.category === 'deleted'
        ? deletedRow(asset)
        : catalogView ? catalogRow(asset) : plainRow(asset))).join('')
      : route.category === 'deleted'
        ? empty(
          T('cognition.deleted_empty', '没有已删除的资产'),
          T('cognition.deleted_empty_hint', '删除的资产会在这里保留 30 天：期内可恢复，也可以在这里立即彻底删除。'),
        )
      : tagContradiction
        // 「未分类」∩「同时具备」恒空集（T012 Edge）：明确说清原因与出路，
        // 不给一屏无解释的空白。
        ? `<div class="note list-caption">${esc(T('cognition.tag_filter_empty_all', '「未分类」和「同时具备」一起选时，没有资产能两边都满足。切回「任一标签」，或取消「未分类」。'))}</div>`
        : empty(
          T('cognition.tree_empty', '还没有正式资产'),
          T('cognition.tree_empty_hint', '你在「待我处理」点过「确认」的事，会出现在这里。'),
          // 空态引导（specs/018 T033）：下一步去哪写死——去待我处理。
          { label: T('cognition.overview_empty_go_review', '去待我处理'), attrs: { 'data-act': 'go-review' } },
        );
    // 同源血缘分组只在「管理」模式出现（specs/018 T031）；目录视图=模型视角
    // 保持平铺。「已删除」列表**不分组**：那里要的是保留期剩余天数与彻底
    // 删除入口，按族分组只会把"还剩几天"埋进分组标题下面。
    if (orderedAssets.length && manageMode && !catalogView && route.category !== 'deleted') {
      const groups = familyGroupsOf(orderedAssets);
      listHtml = groups.map((group) => {
        const renaming = String(route.familyRename || '') === group.anchorId && group.anchorId;
        return `
        <div class="fam-hd">
          <span class="nm">${renaming
            ? `${window.uiInput({ id: `ca-family-name-${esc(group.anchorId)}`, value: group.title || '', attrs: { 'data-family-name': '1', maxlength: '40' }, className: 'litxt' })}${btn(T('common.save', '保存'), 'family-rename-save', { id: group.anchorId, className: 'rnm' })}${btn(T('common.cancel', '取消'), 'family-rename-cancel', { className: 'rnm is-muted' })}`
            : group.title
              ? `${esc(group.title)} <span class="n">${esc(T('cognition.family_group_count', '{n} 条同源', { n: String(group.assets.length) }))}</span>${group.anchorId ? btn(group.named ? T('cognition.family_rename_done', '改血缘名') : T('cognition.family_rename', '命名同源血缘'), 'family-rename', { id: group.anchorId, className: 'rnm' }) : ''}`
              : `<span class="n">${esc(T('cognition.family_unsorted', '无同源血缘'))}</span>`}</span>
          <span class="sp"></span>
        </div>
        ${group.assets.map((asset) => plainRow(asset)).join('')}
      `;
      }).join('');
    }
    /* 工具入口（specs/018 T031）：默认只有「树视图」+「管理」小切换；
     * 管理模式下才出现 批量打标 / 目录视图（多选条随 tagSelect 出）。
     * 「已删除」档不出现批量与目录入口（保留期语义优先）。 */
    const toolButtons = `${route.category !== 'deleted' ? btn(T('cognition.tree_view_toggle', '树视图'), 'asset-view', { id: 'tree', small: true, className: 'o' }) : ''}${manageMode
      ? `${route.category !== 'deleted' ? btn(T('cognition.tag_batch_entry', '批量打标'), 'tag-select-mode', { small: true, className: 'o' }) : ''}${btn(catalogView ? T('cognition.catalog_view_back', '列表视图') : T('cognition.catalog_view_toggle', '目录视图'), 'asset-view', { id: catalogView ? '' : 'catalog', small: true, className: 'o' })}${btn(T('cognition.overview_manage_exit', '退出管理'), 'overview-manage-toggle', { small: true, className: 'o' })}`
      : btn(T('cognition.overview_manage_entry', '管理'), 'overview-manage-toggle', { small: true, className: 'o' })}`;
    return `${heroHtml}
      <div id="ca-asset-list">
      ${sectionHead(
        catalogView ? T('cognition.catalog_view_title', '资产目录（模型视角）') : T('cognition.overview_list_title', '资产明细'),
        String(filtered.length),
        toolButtons,
      )}
      ${catalogView ? `<div class="note list-caption">${esc(T('cognition.catalog_view_hint', '这就是模型挑资产时看的那份目录：一行一条；要看全文点进去。'))}</div>` : ''}
      ${!catalogView && route.category !== 'deleted' && !manageMode ? `<div class="note list-caption">${esc(T('cognition.overview_sort_note', '按最近真实使用排在前；类型 / 最近真用过 / 被带入次数写在每行上。'))}</div>` : ''}
      ${pillboxHtml}
      ${tagFilterBar(route, filteredByType)}
      ${tagSelectOn ? tagBatchBar(route, filtered) : ''}
      ${listHtml}
      </div>
      ${kstarEpisodesSection(route)}`;
  }

  /* ────────────────────────── 视图：经验目录（specs/016 US-801/803）─────────────────────────
   * 经验与资产完全隔离（SC-001）：本区只消费 recall.experiences.* 通道的数据
   * （store.experiences / store.experienceDetail），资产列表零混入；反过来
   * 资产页也不读这里的数据。结构全部复用既有形态（card/row/meta-row/chips/
   * details 折叠），不新增 page-local 结构（structural registry 免登记）。 */

  /** 来源任务 chip（唯一出口）：回看复用既有 open-kstar-episode 深链，不新建
   *  跳转机制。goal 用 E1/E2 载荷里主进程截好的任务目标，展示侧再压 24 字
   *  ——chip 是短标签不是正文区；episodeId 缺席时如实标「来源记录不可用」。 */
  function experienceSourceChip(exp) {
    const episodeId = String((exp.sourceTask && exp.sourceTask.episodeId) || (exp.source && exp.source.episodeId) || '');
    const goal = String((exp.sourceTask && exp.sourceTask.goal) || (exp.source && exp.source.taskGoal) || '');
    if (!episodeId) return chip(T('cognition.experience_source_missing', '来源任务记录不可用'), 'line');
    const label = T('cognition.experience_source_task', '来源任务：《{goal}》', {
      goal: NS.truncateText(goal, 24) || T('cognition.evidence_task_review_generic', '一次任务'),
    });
    return `<span class="tag blue chip-link" data-act="open-kstar-episode" data-id="${esc(episodeId)}" ${roleBtn()} title="${esc(T('cognition.kstar_episode_open_hint', '查看这次任务的复盘'))}">${esc(label)}</span>`;
  }

  /** 列表行：标题 + 来源任务（可点回看）+ 任务类型/验证状态/结果一行元信息。
   *  行本身点开详情（open-experience）；异常态（暂停）出章，正常态不出。 */
  function experienceRow(item) {
    const status = String(item.status || 'active');
    const meta = [
      NS.experience.taskTypeLabel(item.taskType),
      NS.experience.verificationLabel(item.verificationState),
      reviewOutcomeText(item.outcome),
    ].filter(Boolean).join(' · ');
    return `<div class="row is-flat is-clickable" data-act="open-experience" data-id="${esc(item.id)}" ${roleBtn()}>
      <div class="tw">
        <div class="tt">${esc(item.title || '')}</div>
        <div class="catline">${experienceSourceChip(item)}</div>
        ${meta ? `<div class="mm">${esc(meta)}</div>` : ''}
      </div>
      <div class="sd">${status === 'paused' ? chip(NS.experience.statusLabel(status), 'amber') : ''}<span class="chev" aria-hidden="true">›</span></div>
    </div>`;
  }

  /** 合并目标区（US-803 AC1）：复用既有列表行形态，只列**同类型**且非终态的
   *  其他经验——跨类型合并在选择面就被排除（后端仍会拒绝并说明）。 */
  function experienceMergeSection(exp) {
    const others = ((S.experiences && S.experiences.items) || [])
      .filter((row) => String(row.id) !== String(exp.id)
        && NS.experience.groupKey(row.experienceType) === NS.experience.groupKey(exp.experienceType)
        && ['active', 'paused'].includes(String(row.status || 'active')))
      .slice(0, 8);
    if (!others.length) return '';
    const rows = others.map((other) => `<div class="row is-flat">
      <div class="tw"><div class="tt">${esc(other.title || '')}</div><div class="mm">${esc(NS.experience.taskTypeLabel(other.taskType))}</div></div>
      <div class="sd">${btn(T('cognition.experience_merge_into', '并入这条'), 'experience-merge', { id: exp.id, data: { target: String(other.id) }, small: true })}</div>
    </div>`).join('');
    return `<details class="details">
      <summary>${esc(T('cognition.experience_merge_section', '与另一条同类经验合并'))}</summary>
      <p class="note">${esc(T('cognition.experience_merge_hint', '同一条经验的重复条目可合并：来源任务与证据全部并入所选条目，本条不再单独显示。'))}</p>
      ${rows}
    </details>`;
  }

  /** 台账动作 → 人话（与 experience-service 的 history action 一一对应；
   *  未知动作中性兜底，不裸出内部枚举）。 */
  function experienceHistoryLabel(action) {
    return {
      paused: T('cognition.experience_history_paused', '暂停带入'),
      resumed: T('cognition.experience_history_resumed', '恢复带入'),
      type_changed: T('cognition.experience_history_type_changed', '类型调整'),
      merged: T('cognition.experience_history_merged', '并入其他经验'),
      merged_from: T('cognition.experience_history_merged_from', '接收并入'),
      archived: T('cognition.experience_history_archived', '归档清理'),
    }[String(action || '')] || T('cognition.experience_history_unknown', '管理操作');
  }

  /** 详情视图（E2 载荷）：正文 + 预期/实际 + 适用/禁用范围 + 证据引用 +
   *  合并来源 + 台账 + 四个管理动作（T029）。 */
  function viewExperienceDetail(route) {
    const id = String(route.experienceId || '');
    const state = S.experienceDetail;
    const back = btn(T('cognition.experience_back', '← 返回经验目录'), 'go-back', { className: 'backlink' });
    if (!state || String(state.experienceId) !== id || state.loading) {
      return `${back}<div class="card">${empty(T('cognition.experience_detail_loading', '正在读取这条经验…'))}</div>`;
    }
    if (state.failed || !state.experience) {
      return `${back}<div class="card">${empty(T('cognition.experience_detail_failed', '这条经验读取失败或已不存在'))}</div>`;
    }
    const exp = state.experience;
    const status = String(exp.status || 'active');
    const terminal = status === 'archived' || status === 'merged';
    const metaRow = (label, valueHtml) => valueHtml
      ? `<div class="meta-item"><span class="meta-k">${esc(label)}</span><span class="meta-v">${valueHtml}</span></div>`
      : '';
    // 验证状态一行：状态 + 结果（结果沿用复盘语境的既有四语文案，不另造词）。
    // 改进幅度与置信度这两个内部度量字段不上屏——specs/015 对 views.js 有
    // 「内部字段整个文件一次都不提」的源码级墓碑，R5 键表也刻意未列它们。
    const verification = exp.verification || {};
    const verificationValue = [
      NS.experience.verificationLabel(verification.state),
      reviewOutcomeText(verification.outcome),
    ].filter(Boolean).join(' · ');
    const applicable = (exp.applicableWhen || []).filter(Boolean);
    const forbidden = (exp.forbiddenWhen || []).filter(Boolean);
    const evidence = (exp.evidenceRefs || [])
      .map((ref) => ((ref && typeof ref === 'object') ? ref : { id: String(ref || '') }))
      .filter((ref) => String(ref.id || '').trim());
    const mergedFrom = exp.mergedFrom || [];
    const historyRows = (exp.history || []).slice(-12).reverse();
    const switchable = status === 'active' || status === 'paused';
    return `${back}
    <div class="card ca-experience-detail">
      <div class="rowline">
        <div>
          <h1>${esc(exp.title || '')}</h1>
          <div class="sub">${esc([
            NS.experience.typeLabel(exp.experienceType),
            NS.experience.taskTypeLabel(exp.taskType),
            fmtDate(exp.updatedAt || exp.createdAt),
          ].filter(Boolean).join(' · '))}</div>
        </div>
        <div class="right">${chip(NS.experience.statusLabel(status), status === 'active' ? 'green' : status === 'paused' ? 'amber' : '')}</div>
      </div>
      <p class="content-text">${esc(exp.body || '')}</p>
      <div class="sect-block">
        <div class="meta-row">
          ${metaRow(T('cognition.experience_meta_type', '经验类型'), esc(NS.experience.typeLabel(exp.experienceType)))}
          ${metaRow(T('cognition.experience_meta_task_type', '学自哪类任务'), esc(NS.experience.taskTypeLabel(exp.taskType)))}
          ${metaRow(T('cognition.experience_meta_scope', '可用在哪类任务'), esc(NS.experience.taskTypeLabel(exp.scope)))}
          ${metaRow(T('cognition.experience_meta_source', '来源任务'), experienceSourceChip(exp))}
          ${metaRow(T('cognition.experience_meta_verification', '验证状态'), esc(verificationValue))}
        </div>
      </div>
      ${(() => {
        // 预期/实际（来自复盘 review，可缺）：长值走既有折叠，不新造控件。
        const expected = foldValue(exp.expected, 120);
        const actual = foldValue(exp.actual, 120);
        if (!expected && !actual) return '';
        return `<div class="sect-block">
          <div class="meta-row">
            ${expected ? `<div class="meta-item"><span class="meta-k">${esc(T('cognition.experience_expected', '当时的预期'))}</span><span class="meta-v">${expected}</span></div>` : ''}
            ${actual ? `<div class="meta-item"><span class="meta-k">${esc(T('cognition.experience_actual', '实际发生'))}</span><span class="meta-v">${actual}</span></div>` : ''}
          </div>
        </div>`;
      })()}
      ${(() => {
        // 适用/禁用范围：缺失 = 没记录过（不是"无限制"，data-model §1）——
        // 显式标注未记录，避免被读成"哪里都能用"。
        const listHtml = (rows) => rows.map((row) => esc(String(row))).join('、');
        return `<div class="sect-block">
          <div class="meta-row">
            <div class="meta-item"><span class="meta-k">${esc(T('cognition.experience_applicable', '适用范围'))}</span><span class="meta-v">${applicable.length ? listHtml(applicable) : esc(T('cognition.experience_applicable_missing', '没有记录过适用范围'))}</span></div>
            <div class="meta-item"><span class="meta-k">${esc(T('cognition.experience_forbidden', '禁用范围'))}</span><span class="meta-v">${forbidden.length ? listHtml(forbidden) : esc(T('cognition.experience_forbidden_missing', '没有记录过禁用范围'))}</span></div>
          </div>
        </div>`;
      })()}
      ${experienceMergedIntoBlock(exp)}
      ${mergedFrom.length ? `<div class="sect-block">
        <div class="sub"><strong>${esc(T('cognition.experience_merged_from_section', '并入来源'))}<span class="note">${String(mergedFrom.length)}</span></strong></div>
        ${mergedFrom.map((entry) => `<div class="row is-flat is-clickable" data-act="open-experience" data-id="${esc(String(entry.id || ''))}" ${roleBtn()}>
          <div class="tw"><div class="tt">${esc(entry.title || '')}</div>
          <div class="mm">${esc(T('cognition.experience_merged_from_at', '并入于 {when}', { when: fmtDate(entry.mergedAt) }))}</div></div>
        </div>`).join('')}
      </div>` : ''}
      ${(() => {
        // 证据引用块：一律走唯一呈现出口 evidenceChip（内部 id 不上屏）。
        if (!evidence.length) return '';
        const rowsHtml = evidence.map((ref) => `<div class="evrow">${evidenceChip(ref)}</div>`).join('');
        return `<div class="sect-block"><div class="sub"><strong>${esc(T('cognition.asset_evidence_section', '证据引用'))}<span class="note">${String(evidence.length)}</span></strong></div>${rowsHtml}</div>`;
      })()}
      ${(() => {
        // 管理动作（T029）：终态（已归档/已并入）无管理出口，只说明现状。
        if (!switchable) {
          const note = status === 'merged'
            ? T('cognition.experience_merged_into_note', '这条经验已并入另一条；来源与历史在并入目标上完整保留。')
            : T('cognition.experience_archived_note', '这条经验已归档清理，不再进入任何清单；归档原因与时间记录在台账里。');
          return `<div class="sect-block"><p class="note">${esc(note)}</p></div>`;
        }
        const otherTypes = ['lesson', 'workflow', 'gap', 'uncategorized']
          .filter((type) => NS.experience.groupKey(type) !== NS.experience.groupKey(exp.experienceType));
        return `<div class="sect-block ca-experience-actions">
          <div class="sub"><strong>${esc(T('cognition.experience_manage_section', '管理'))}</strong></div>
          <div class="chips">
            ${btn(status === 'active'
              ? T('cognition.experience_action_pause', '暂停带入')
              : T('cognition.experience_action_resume', '恢复带入'),
            'experience-status-toggle', { id: exp.id, data: { action: status === 'active' ? 'pause' : 'resume' }, small: true })}
            ${otherTypes.map((type) => btn(NS.experience.typeLabel(type), 'experience-set-type', { id: exp.id, data: { type }, small: true, className: 'o', title: T('cognition.experience_action_set_type', '调整类型') })).join('')}
            ${btn(T('cognition.experience_action_archive', '归档清理'), 'experience-archive', { id: exp.id, small: true, danger: true })}
          </div>
          <p class="note">${esc(status === 'active'
            ? T('cognition.experience_action_pause_hint', '暂停后新任务的清单不再带入这条经验；历史与引用记录全部保留，随时可恢复。')
            : T('cognition.experience_action_resume_hint', '已暂停：恢复后下一轮清单重新带入。'))}</p>
        </div>
        ${experienceMergeSection(exp)}`;
      })()}
      ${historyRows.length ? `<details class="details" style="margin-top:14px">
        <summary>${esc(T('cognition.experience_history_section', '管理台账'))}</summary>
        <div class="dbody">${historyRows.map((row) => {
          const actor = String(row.actor || '') === 'user' ? T('cognition.audit_actor_user', '你') : String(row.actor || '') === 'system' ? T('cognition.audit_actor_system', '系统') : '';
          const change = (row.from || row.to)
            ? `（${esc(String(row.from || '—'))} → ${esc(String(row.to || '—'))}）`
            : '';
          const reason = row.reason ? ` · ${esc(String(row.reason))}` : '';
          return `<div class="proc-row"><span class="when">${esc(fmtDate(row.at))}</span><span style="flex:1">${actor ? `${esc(actor)} · ` : ''}<b>${esc(experienceHistoryLabel(row.action))}</b>${change}${reason}</span></div>`;
        }).join('')}</div>
      </details>` : ''}
    </div>`;
  }

  /** merged 终态的去向提示：有目标 id 时给跳转（经验记录不物理删除，
   *  详情仍可读），没有就只说明。函数名避开同名字段（exp.mergedIntoExperienceId）。 */
  function experienceMergedIntoBlock(exp) {
    const targetId = String(exp.mergedIntoExperienceId || '');
    if (String(exp.status || '') !== 'merged' || !targetId) return '';
    return `<div class="sect-block">
      <div class="meta-item"><span class="meta-k">${esc(T('cognition.experience_merged_into_label', '并入去向'))}</span><span class="meta-v"><span class="tag blue chip-link" data-act="open-experience" data-id="${esc(targetId)}" ${roleBtn()}>${esc(T('cognition.experience_open_target', '查看并入后的条目'))}</span></span></div>
    </div>`;
  }

  /** 存量迁移区（US-801 AC2）：页签底部折叠区。预览（只读扫描）→ 逐条核对
   *  → 显式发起（run 必须带 assetIds，单条/批量两个入口都来自可见清单）；
   *  跳过理由与上次结果如实列出（「可核对」，不满足于一枚 toast）。 */
  function experienceMigrationSection() {
    const state = S.experienceMigration;
    const preview = state && state.preview;
    const lastRun = state && state.lastRun;
    const previewItems = (preview && preview.items) || [];
    let body = `<p class="note">${esc(T('cognition.experience_migration_hint', '扫描资产库中带任务复盘沉淀标记的经验类资产，逐条确认后迁入经验目录；迁移会先冻结历史引用，再迁出资产记录。'))}</p>`;
    if (state && state.previewLoading) {
      body += `<p class="note">${esc(T('cognition.experience_migration_scanning', '正在扫描可迁移的存量…'))}</p>`;
    } else if (state && state.previewFailed) {
      body += `<p class="note">${esc(T('cognition.experience_migration_scan_failed', '扫描失败，可重试。'))}${btn(T('common.retry', '重试'), 'experience-migration-preview', { small: true })}</p>`;
    } else if (preview) {
      body += `<p class="note">${esc(T('cognition.experience_migration_preview_count', '扫描 {scanned} 条：可迁 {migratable} 条，跳过 {skipped} 条', {
        scanned: String(preview.scanned || 0),
        migratable: String(preview.migratable || 0),
        skipped: String(preview.skipped || 0),
      }))}</p>`;
      const skipReasons = (preview.skippedReasons) || [];
      if (skipReasons.length) {
        body += `<div class="note">${skipReasons.map((row) => `· ${esc(NS.experience.migrationReasonText(row.reason))} × ${esc(String(row.count || 0))}`).join('<br>')}</div>`;
      }
      if (previewItems.length) {
        body += previewItems.map((item) => `<div class="row is-flat">
          <div class="tw">
            <div class="tt">${esc(item.title || '')}</div>
            <div class="mm">${esc([
              categoryLabel(item.assetType),
              NS.experience.typeLabel(item.experienceTypeGuess),
              item.frozenProjections ? T('cognition.experience_migration_frozen_refs', '将冻结 {n} 处历史引用', { n: String(item.frozenProjections) }) : '',
            ].filter(Boolean).join(' · '))}</div>
          </div>
          <div class="sd">${btn(T('cognition.experience_migration_run_one', '迁这一条'), 'experience-migration-run', { data: { asset: String(item.assetId || '') }, small: true })}</div>
        </div>`).join('');
        body += `<div class="actions">${btn(T('cognition.experience_migration_run_all', '迁移以上 {n} 条', { n: String(previewItems.length) }), 'experience-migration-run', { data: { assets: previewItems.map((item) => String(item.assetId || '')).filter(Boolean).join(',') }, primary: true, small: true })}</div>`;
      } else {
        body += `<p class="note">${esc(T('cognition.experience_migration_nothing', '没有可迁移的存量：资产库里没有带任务复盘沉淀标记的经验类资产。'))}</p>`;
      }
    } else {
      body += `<div class="actions">${btn(T('cognition.experience_migration_scan', '扫描可迁移的存量'), 'experience-migration-preview', { small: true })}</div>`;
    }
    if (lastRun) {
      const titleById = new Map(previewItems.map((item) => [String(item.assetId || ''), String(item.title || '')]));
      const details = (lastRun.details) || [];
      body += `<div class="sect-block">
        <div class="tt">${esc(T('cognition.experience_migration_last_run', '上次迁移：已迁 {migrated} 条，跳过 {skipped} 条，失败 {failed} 条', {
          migrated: String(lastRun.migrated || 0),
          skipped: String(lastRun.skipped || 0),
          failed: String(lastRun.failed || 0),
        }))}</div>
        ${details.slice(0, 20).map((row) => `<div class="proc-row"><span style="flex:1">${esc(titleById.get(String(row.assetId || '')) || T('cognition.experience_migration_detail_untitled', '（一条经验类资产）'))}</span><span class="note">${esc(NS.experience.migrationReasonText(row.reason))}</span></div>`).join('')}
      </div>`;
    }
    body += `<div class="actions">${btn(T('cognition.experience_migration_view_status', '查看上次迁移结果'), 'experience-migration-status', { small: true, className: 'o' })}</div>`;
    return `<details class="details ca-experience-migration">
      <summary>${esc(T('cognition.experience_migration_title', '存量迁移'))}<span class="note">${esc(T('cognition.experience_migration_short_hint', '把旧的 KSTAR 经验类资产迁入经验目录'))}</span></summary>
      <div class="dbody">${body}</div>
    </details>`;
  }

  /** 经验目录本体（specs/017 整改一：由独立页签改嵌「我的认知」经验档）：
   *  按经验类型分组（lesson → workflow → gap → uncategorized 固定顺序，只摆
   *  非空组）；列表只放非终态（active/paused——archived/merged 是终态，不再
   *  占目录；合并的来源在目标详情的「并入来源」里可见）。三态分开：
   *  载入中 / 读取失败（给重试）/ 空态。 */
  function experienceDirectoryHtml() {
    const state = S.experiences;
    if (!state || state.loading) {
      return `<div class="card">${empty(T('cognition.experience_loading', '正在读取经验目录…'))}</div>`;
    }
    if (state.failed) {
      // 读不到 ≠ 没有（五态要求）：失败与空态分开，失败给重试出口。
      return `<div class="card">${empty(T('cognition.experience_load_failed', '经验目录读取失败'))}${btn(T('common.retry', '重试'), 'refresh', { small: true })}</div>`;
    }
    const items = ((state.items) || []).filter((item) => ['active', 'paused'].includes(String(item.status || 'active')));
    const groups = ['lesson', 'workflow', 'gap', 'uncategorized'].map((type) => ({
      type,
      rows: items.filter((item) => NS.experience.groupKey(item.experienceType) === type),
    })).filter((group) => group.rows.length);
    return groups.length
      ? groups.map((group) => `${sectionHead(NS.experience.typeLabel(group.type), String(group.rows.length))}
          <div class="card">${group.rows.map(experienceRow).join('')}</div>`).join('')
      : `<div class="card">${empty(
        T('cognition.experience_empty', '还没有沉淀下来的经验'),
        T('cognition.experience_empty_hint', '任务完结、复盘沉淀出经验后会出现在这里；经验与正式资产分开管理。'),
      )}</div>`;
  }

  /* ────────────────────────── 视图：待我处理 ────────────────────────── */

  function candidateCard(candidate, broken) {
    const refs = evidenceRefs(candidate);
    const refsHtml = refs.length
      ? `<div class="c4">${esc(T('cognition.candidate_source', '来源'))}：${refs.slice(0, 4).map((ref) => {
        // 2026-09-25 US-603：候选卡的来源名也走唯一解析器——此前它自带一套兜底
        // （ref.title || '会话记录'），目录窗口外的会话在这里显示不出名字，与
        // 资产详情/版本/使用记录/KSTAR 四处不同名。
        const view = resolveSourceRef(ref);
        if (view.state === 'immediate') return esc(T('cognition.evidence_immediate_note', '对话中当场记（无独立会话出处）'));
        if (view.state === 'processing') return esc(T('cognition.evidence_source_processing', '来源整理中'));
        if (view.state === 'unavailable') return esc(T('cognition.source_unavailable_label', '来源记录不可用'));
        if (view.name) return esc(view.name);
        return esc(view.kind === 'conversation'
          ? T('cognition.evidence_conversation_generic', '一段对话')
          : T('cognition.evidence_fallback', '来源记录'));
      }).join(' · ')}</div>`
      : '';
    const warnHtml = broken
      ? `<div class="warn">${esc(T('cognition.candidate_evidence_all_unavailable', '这条候选的大部分来源记录已被删除，无法核对证据。建议补充新证据后保存，或选择不保存。'))}</div>`
      : '';
    /* 三件套（specs/018 T011）：主按钮 = 推荐动作（确认），其余动作收「其他处理」。
     * 直接确认沿既有 cand-adopt-with-form 通道：卡片不在 .ca-candidate-detail 里，
     * readCandidateForm 就近找不到表单 → 按未携带编辑确认（内容原样保存）。
     * 卡片整体不再是点击区——标题行与「看内容与证据」进详情，避免行内按钮
     * 与卡片跳转抢点击（2026-09-26 旅程雕刻前的老问题，这次一并解掉）。 */
    const caps = candidate.capabilities || {};
    const labels = candidateDecisionLabels(candidate);
    const primaryLabel = candidateUpdateType(candidate)
      ? T('recall.asset_approval.confirm', '确认更新')
      : T('cognition.review_card_confirm', '确认');
    const primaryBtn = caps.canPromote
      ? btn(primaryLabel, 'cand-adopt-with-form', { id: candidate.id, small: true, primary: true })
      : '';
    const othersHtml = otherActions([
      caps.canDefer ? btn(labels.defer, 'cand-decide', { id: candidate.id, data: { action: 'defer' }, small: true, className: 'o' }) : '',
      caps.canReject ? btn(labels.reject, 'cand-decide', { id: candidate.id, data: { action: 'reject' }, small: true, className: 'o' }) : '',
      btn(T('cognition.review_card_open_detail', '看内容与证据'), 'open-candidate', { id: candidate.id, small: true, className: 'o' }),
    ].join(''));
    return `
    <div class="cand${broken ? ' is-broken' : ''}">
      <div class="c1" data-act="open-candidate" data-id="${esc(candidate.id)}" role="button" tabindex="0">${esc(candidateTitle(candidate))}<span class="chev" aria-hidden="true">›</span></div>
      <div class="c2">${chip(categoryLabel(candidate.suggestedType))}${candidateSourceBadge(candidate)}${(candidate.capabilities && candidate.capabilities.isSnoozed) ? chip(T('cognition.candidate_snoozed', '已稍后处理'), 'amber') : ''}${broken ? chip(T('cognition.candidate_evidence_weak', '来源已删'), 'amber') : chip(T('cognition.candidate_evidence_ok', '证据充足'), 'green')}</div>
      <div class="c3">${esc(String(candidate.judgment || candidate.value || '').slice(0, 220))}</div>
      ${refsHtml}${warnHtml}
      ${(primaryBtn || othersHtml) ? `<div class="c5 ca-card-actions">${primaryBtn}${othersHtml}</div>` : ''}
    </div>`;
  }

  /** 来源异常的判定与统计（与 stats.sourceIssues 同口径）：failed，或非用户
   *  主动暂停的 paused。2026-09-15 重构：来源健康不再有常态页，异常条目
   *  就地展开在「待我处理」，健康时完全沉默。 */
  function sourceItemNeedsAttention(item) {
    // 执行失败轮次（execution_evaluation/failed）不算来源异常（2026-09-16）：
    // 它是 agent 执行失败的历史记录，不是用户能修复的数据源——进异常区只
    // 显示成 turn-哈希 + 无效重试；执行失败在对话侧已可见。
    if (String(item.kind || '') === 'execution_evaluation') return false;
    return item.status === 'failed'
      || (item.status === 'paused' && String(item.statusReason || '') !== 'source_paused');
  }
  function sourceIssueItems() {
    return S.sources
      .flatMap((group) => (Array.isArray(group.items) ? group.items : []))
      .filter(sourceItemNeedsAttention);
  }
  /** 来源异常展开区：只讲需要处理的那几条（标题/原因人话/动作）。 */
  function sourceIssuesSection(route) {
    const issues = sourceIssueItems();
    if (!issues.length) return '';
    const open = String(route.sourceIssueOpen || '') === 'open';
    if (!open) return '';
    const vocab = NS.vocabulary;
    const rows = issues.slice(0, 20).map((item) => {
      const reasonText = vocab ? vocab.sourceReasonText(item.statusReason) : '';
      // 重试只给 actions 里真支持 retry 的项（2026-09-16）：无差别给重试会让
      // 不支持重试的来源（如 actions 仅 remove）点了无效、误导用户。
      const actions = Array.isArray(item.actions) ? item.actions : [];
      const action = item.status === 'failed' && actions.includes('retry')
        ? btn(T('cognition.source_retry', '重试'), 'source-action', { id: item.id, data: { action: 'retry', kind: item.kind }, small: true })
        : item.status !== 'failed' && actions.includes('resume')
          ? btn(T('cognition.source_resume', '恢复'), 'source-action', { id: item.id, data: { action: 'resume', kind: item.kind }, small: true })
          : '';
      return `<div class="row is-flat">
        <div class="tw">
          <div class="tt">${esc(String(item.title || '').trim() || T('cognition.evidence_fallback', '来源记录'))}</div>
          <div class="mm">${esc(vocab ? vocab.kindLabel(item.kind) : T('cognition.source_kind_other', '其他来源'))}${reasonText ? ` · ${esc(reasonText)}` : ''}</div>
        </div>
        <div class="sd">${action}</div>
      </div>`;
    }).join('');
    return `<div class="card">${rows}
      ${issues.length > 20 ? `<div class="sub">${esc(T('cognition.source_issues_more', '仅显示前 {n} 条', { n: '20' }))}</div>` : ''}
    </div>`;
  }

  /* ───────────────── KSTAR 复盘历史区块（2026-09-17 二次定调） ─────────────────
   * 两线不拆 tab：KSTAR 任务复盘作为「我的认知」页底部折叠区（默认收起），
   * 每场被复盘的任务一行，点行就地展开完整复盘（复用 kstarEpisodeSection）。 */
  function kstarEpisodesSection(route) {
    const episodes = Array.isArray(S.kstarEpisodes) ? S.kstarEpisodes : [];
    const openId = String(route.kstarEpisodeId || '');
    const rows = (episodes || []).map((ep) => {
      // goal 兼容两种形态：kstar.episodes.list 返回平铺 goal 字段（精简
      // 摘要）；完整 episode 记录里在 t.userGoal——此前只读后者，列表
      // 全显示"（未记录目标）"（2026-09-17 子安实测抓出）。
      const goal = String(ep.goal || (ep.t && ep.t.userGoal) || '').trim();
      const at = String(ep.updatedAt || ep.createdAt || '');
      const isOpen = openId === String(ep.id || '');
      return `<div class="row is-flat is-clickable" data-act="open-kstar-episode" data-id="${esc(String(ep.id || ''))}" ${roleBtn()}>
        <div class="tw">
          <div class="tt">${esc(goal || T('cognition.kstar_episode_no_goal', '（未记录目标）'))}</div>
          <div class="mm">${esc(fmtDate(at))}</div>
        </div>
      </div>${isOpen ? kstarEpisodeSection(route) : ''}`;
    }).join('');
    const body = episodes === null
      ? `<div class="card">${empty(T('cognition.kstar_episodes_loading', '正在读取任务复盘列表…'))}</div>`
      : episodes.length
        ? `<div class="card">${rows}</div>`
        : `<div class="card">${empty(T('cognition.kstar_episodes_empty', '还没有被复盘过的任务'))}</div>`;
    return `<details class="details ca-kstar-episodes"${openId ? ' open' : ''}>
      <summary>${esc(T('cognition.evidence_group_kstar', '任务复盘'))}<span class="note">${esc(T('cognition.kstar_episodes_hint', '任务完结后系统自动复盘：当时的任务、实际发生、为什么、学到的经验。点开看完整复盘。'))}</span></summary>
      ${body}
    </details>`;
  }

  /* ────────── 改进分析（只读分区，specs/015 US-701 AC3 / T016）──────────────
   * 分析过但**没形成候选**的结论如实列出：结论标签 + 人话原因 + 来源任务 + 时间。
   * 这里只读、**不进待办**（结论是终态快照，不是要用户决定的事）；失败类结论给一个
   * 就地展开的「看失败详情」，数据来自既有失败面 `kstar.failures.list`。
   * 隐私口径：只渲染契约里明列的字段（结论/原因/来源任务/时间 + 失败环节），
   * **不整条 dump 记录**——受限正文不进界面；`errorMessage` 原文也不上屏。 */
  const IMPROVEMENT_CONCLUSIONS = {
    no_update: ['cognition.improvement_conclusion_no_update', '无需更新', 'line'],
    insufficient_evidence: ['cognition.improvement_conclusion_insufficient_evidence', '证据不足', 'amber'],
    analysis_failed: ['cognition.improvement_conclusion_analysis_failed', '分析失败', 'red'],
    submit_failed: ['cognition.improvement_conclusion_submit_failed', '提交失败', 'red'],
  };
  const IMPROVEMENT_FAILURE_CONCLUSIONS = new Set(['analysis_failed', 'submit_failed']);
  const IMPROVEMENT_FAILURE_STAGES = {
    capture: ['cognition.improvement_failure_stage_capture', '沉淀'],
    review_inference: ['cognition.improvement_failure_stage_review_inference', '复盘分析'],
    precipitation: ['cognition.improvement_failure_stage_precipitation', '沉淀落库'],
    control_receipt: ['cognition.improvement_failure_stage_control_receipt', '回执下发'],
  };

  /** 失败详情（就地展开，只读）：环节 + 时间 + 失败标识——够用户/支持去失败面核对，
   *  又不把内部错误原文（可能是内部措辞或夹带正文）搬上屏。 */
  function improvementFailureDetail(outcome) {
    const state = S.kstarFailures;
    const episodeId = String(outcome.episodeId || '');
    const items = (state && Array.isArray(state.items))
      ? state.items.filter((failure) => String(failure.episodeId || '') === episodeId)
      : [];
    const rows = items.slice(0, 5).map((failure) => {
      const stageEntry = IMPROVEMENT_FAILURE_STAGES[String(failure.stage || '')];
      const stage = stageEntry
        ? T(stageEntry[0], stageEntry[1])
        : T('cognition.improvement_failure_stage_other', '未知环节');
      const at = String(failure.at || '');
      const code = String(failure.errorCode || '');
      return `<div class="rowline">
        <span class="note">${esc(stage)}${at ? ` · ${esc(fmtDate(at))}` : ''}</span>
        ${code ? `<span class="note">${esc(T('cognition.improvement_failure_code', '失败标识：{code}', { code }))}</span>` : ''}
      </div>`;
    }).join('');
    const body = !state || state.loading
      ? `<p class="note">${esc(T('cognition.improvement_failure_loading', '正在读取失败详情…'))}</p>`
      : rows || `<p class="note">${esc(T('cognition.improvement_failure_empty', '失败记录里暂时没有查到这条的详情。'))}</p>`;
    return `<details class="details"><summary>${esc(T('cognition.improvement_failure_detail', '看失败详情'))}</summary><div class="dbody">${body}</div></details>`;
  }

  function improvementOutcomeRow(outcome, route) {
    const conclusion = String(outcome.conclusion || '');
    // 认不出的结论给中性标签，不编造"无需更新"这类具体结论（不冒充）。
    const entry = IMPROVEMENT_CONCLUSIONS[conclusion]
      || ['cognition.improvement_conclusion_other', '分析结论', 'line'];
    const episodeId = String(outcome.episodeId || '');
    const at = String(outcome.updatedAt || outcome.createdAt || '');
    const reason = stripInternalIds(String(outcome.reason || '').trim());
    const isOpen = String(route.kstarEpisodeId || '') === episodeId;
    return `<div class="row is-flat">
      <div class="tw">
        <div class="tt">${chip(T(entry[0], entry[1]), entry[2])}</div>
        <div class="mm">${episodeId
          ? evidenceChip({ kind: 'execution', id: episodeId })
          : esc(T('cognition.improvement_task_missing', '这次分析没有关联到具体的任务复盘。'))}${at ? ` · ${esc(fmtDate(at))}` : ''}</div>
        ${reason ? foldValue(reason) : ''}
        ${IMPROVEMENT_FAILURE_CONCLUSIONS.has(conclusion) ? improvementFailureDetail(outcome) : ''}
      </div>
    </div>${isOpen ? kstarEpisodeSection(route) : ''}`;
  }

  function improvementAnalysisSection(route) {
    const state = S.improvementOutcomes;
    const items = (state && Array.isArray(state.items)) ? state.items : [];
    const title = T('cognition.improvement_section', '改进分析');
    // 收敛语义（data-model §2 的「实现期最简」）：同一 episode 已经产出候选时，
    // 不再摆该 episode 的「无需更新」——"无需更新"与"这里有更新提议"同屏自相矛盾。
    // 只隐藏这一种组合，其余结论照旧（隐藏依据是已加载的候选，不猜）。
    const candidateEpisodes = new Set(S.candidates
      .map((row) => String((row.learningProvenance && row.learningProvenance.episodeId) || ''))
      .filter(Boolean));
    const visible = items.filter((row) => !(
      String(row.conclusion || '') === 'no_update'
      && candidateEpisodes.has(String(row.episodeId || ''))
    ));
    if (state && !state.loading && !state.failed && visible.length) {
      // 有结论时收进折叠区（默认收起）：它是记录，不与上面的待办抢注意力。
      return `<details class="details fold ca-improvement">
        <summary>${esc(title)}<span class="n">${visible.length}</span></summary>
        <div class="dbody">
          <div class="note">${esc(T('cognition.improvement_section_hint', '分析过但没有形成候选的结论：只作记录，不需要你处理。'))}</div>
          ${visible.map((outcome) => improvementOutcomeRow(outcome, route)).join('')}
        </div>
      </details>`;
    }
    // 读取中 / 读取失败 / 空态三态分开（五态要求：读不到 ≠ 没有）。
    const body = !state || state.loading
      ? `<p class="note">${esc(T('cognition.improvement_loading', '正在读取改进分析结论…'))}</p>`
      : state.failed
        ? `<div class="rowline"><span class="note">${esc(T('cognition.improvement_read_failed', '改进分析结论暂时读不到。'))}</span>${btn(T('common.retry', '重试'), 'refresh', { small: true, className: 'o' })}</div>`
        : empty(
          T('cognition.improvement_empty', '还没有改进分析结论'),
          T('cognition.improvement_empty_hint', '任务复盘后如果分析出要改进的方法，结论会出现在这里；形成候选的会进「等待你确认」。'),
        );
    return `<div class="sect-block ca-improvement-empty">${sectionHead(title)}${body}</div>`;
  }

  function viewReview(route) {
    if (route.candidateId) return viewCandidate(route);
    const stats = NS.stats();
    // 两线不拆（2026-09-17 二次定调）：KSTAR 提案与对话候选同池确认，
    // 候选卡自带来源徽章（KSTAR 复盘/KSTAR 偏好/会话整理）区分出身。
    // 分组顺序（2026-09-21 原型 v7 契约）：等待确认 → 来源已删 → 证据不足
    // → 已稍后处理 → 终态折叠 → 处理记录折叠——需要行动的组永远排在
    // 低打扰组之前，分组依据全部来自后端 capabilities，不看本地 status 猜。
    const pending = S.candidates.filter(candidatePending);
    const displayState = (c) => String(((c || {}).capabilities || {}).displayState || '');
    const awaiting = pending.filter(candidateAwaiting);
    const broken = awaiting.filter(evidenceMostlyUnavailable);
    const weak = awaiting.filter((c) => !evidenceMostlyUnavailable(c) && displayState(c) === 'weak_evidence');
    const ready = awaiting.filter((c) => !evidenceMostlyUnavailable(c) && displayState(c) !== 'weak_evidence');
    const snoozed = pending.filter((c) => c.capabilities && c.capabilities.isSnoozed);
    const terminal = S.candidates.filter((c) => ['expired', 'superseded'].includes(displayState(c)) && !candidatePending(c)).slice(0, 8);
    const processed = S.candidates
      .filter((c) => ['confirmed', 'rejected', 'ignored'].includes(String(c.status || '')))
      .slice(0, 5);
    // 处理结果按真实状态如实显示——此前无论保存还是拒绝都写「已保存」，
    // 与筛选口径（confirmed/rejected/ignored 三种）不符（用户实测抓出）。
    const processedLabel = (c) => ({
      confirmed: T('cognition.candidate_status_promoted', '已保存'),
      rejected: T('cognition.candidate_status_rejected', '未保存'),
      ignored: T('cognition.candidate_status_ignored', '已忽略'),
    }[String(c.status || '')] || T('cognition.candidate_status_other', '已处理'));
    const attention = [];
    // 注：治理待办（cognition.inbox：未分级 / 规则缺边界 / 分类冲突等）曾在此
    // 列出，但新 UI 尚无资产分级与边界编辑入口——报了警却无处处理，只会
    // 制造焦虑（2026-09-14 撤下）。等治理动作入口恢复后，连同每类的动作
    // 指引一起重上。此处只保留有明确处理出口的两条。
    if (stats.sourceIssues) {
      // 来源异常就地展开（2026-09-15：来源健康无常态页，异常驱动）。
      // specs/017 整改二：正文回正文字色——颜色只留给短状态章，不再整句刷黄。
      attention.push(`<div class="notice-row" data-act="toggle-source-issues" ${roleBtn()}><div class="notice-copy"><div class="notice-title">${esc(T('cognition.overview_source_issues', '{count} 条来源记录需要处理', { count: String(stats.sourceIssues) }))}</div></div><span class="sp"></span>${btn(T('common.handle', '处理'), 'toggle-source-issues', { small: true, className: 'o' })}</div>`);
    }
    if (stats.failedTasks) {
      // 落点（2026-09-15）：重试按钮在「整理」页的任务流里。
      attention.push(`<div class="notice-row" data-act="go-organize" ${roleBtn()}><div class="notice-copy"><div class="notice-title">${esc(T('cognition.overview_failed_tasks', '{count} 个整理任务需要重试', { count: String(stats.failedTasks) }))}</div></div><span class="sp"></span>${btn(T('common.handle', '处理'), 'go-organize', { small: true, className: 'o' })}</div>`);
    }
    if (stats.taskFailed) {
      // 任务执行失败（承接表 01 / G1）：与整理失败**分别反馈**——这是任务没跑
      // 出结果（未得到回复），重跑入口在会话本身，不是整理重试。
      attention.push(`<div class="notice-row" data-act="go-organize" ${roleBtn()}><div class="notice-copy"><div class="notice-title">${esc(T('cognition.overview_task_failed', '{count} 个任务执行失败（未得到回复）', { count: String(stats.taskFailed) }))}</div></div><span class="sp"></span>${btn(T('common.handle', '处理'), 'go-organize', { small: true, className: 'o' })}</div>`);
    }
    // 治理待办 / 待确认清单（2026-09-25 重上，specs/008 T051；2026-09-26 分组呈现，
    // specs/010 T014~T016 / US-301）：分组可用时按「治理待办」分区呈现（顺序由主进程
    // groupCognitionInbox 唯一给出：冲突 → 扩权 → 缺边界 → 未分级 → 其他）；拿不到
    // groups（旧主进程 / 读失败）时**逐字退回**既有扁平清单。渲染层只渲染读模型给的
    // 动作（`item.actions`），不自己判"哪些动作可用"；取词一律内联 T()。
    const inboxItems = Array.isArray(S.inbox) ? S.inbox : [];
    const inboxGroups = Array.isArray(S.inboxGroups) ? S.inboxGroups : null;
    const INBOX_ACTION_LABELS = {
      accept: T('cognition.inbox_action_accept', '确认'),
      reject: T('cognition.inbox_action_reject', '拒绝'),
      defer: T('cognition.inbox_action_defer', '稍后处理'),
      ignore: T('cognition.inbox_action_ignore', '忽略'),
    };
    const PROPOSAL_ACTION_LABELS = {
      accept: T('cognition.inbox_action_accept_update', '确认更新'),
      defer: T('cognition.inbox_action_defer_later', '稍后处理'),
      reject: T('cognition.inbox_action_reject_proposal', '拒绝'),
    };
    const FINDING_ACTION_LABELS = {
      reject: T('cognition.inbox_action_dismiss', '不管它'),
      defer: T('cognition.inbox_action_look_later', '回头再看'),
    };
    const actionLabelsFor = (kind) => (kind === 'asset_change_pending'
      ? PROPOSAL_ACTION_LABELS
      : kind === 'cleanup_uncertain' || kind === 'inspection_finding' ? FINDING_ACTION_LABELS : INBOX_ACTION_LABELS);
    // 标题一行截断（2026-09-26 真机取证）：inbox 的 title 可能是资产正文全文，
    // 五行大标题把整页压垮；全文进 title 悬浮，行上只给一句能扫的。
    const rowTitle = (row) => {
      const raw = String(row.title || '');
      const cut = raw.length > 60 ? `${raw.slice(0, 60)}…` : raw;
      return `<div class="notice-title" title="${esc(raw)}">${esc(cut)}</div>`;
    };
    // 既有扁平行的渲染（降级路径与「其他」组共用，语义不变）。
    // 三件套（specs/018 T011）：首个动作 = 推荐动作（primary 视觉），
    // 其余收「其他处理」折叠；没有一键动作的仍给资产详情落点。
    const flatInboxRow = (row) => {
      const actions = Array.isArray(row.actions) ? row.actions : [];
      const labels = actionLabelsFor(String(row.kind || ''));
      const [recommended, ...rest] = actions;
      const primaryBtn = recommended
        ? btn(labels[recommended] || String(recommended), 'inbox-resolve', {
          small: true, primary: true, data: { id: String(row.id || ''), action: String(recommended) },
        })
        : '';
      const restBtns = otherActions(rest.map((action) => btn(labels[action] || String(action), 'inbox-resolve', {
        small: true, className: 'o', data: { id: String(row.id || ''), action: String(action) },
      })).join(''));
      // 没有一键动作的：给落点（资产详情里的编辑入口），而不是只报警。
      const fallback = actions.length || !row.assetId
        ? ''
        : btn(T('cognition.inbox_go_asset', '去资产详情处理'), 'go-inbox-asset', { small: true, className: 'o', data: { id: String(row.assetId) } });
      return `<div class="notice-row">
        <div class="notice-copy">${rowTitle(row)}${row.detail ? `<div class="notice-detail">${esc(String(row.detail))}</div>` : ''}</div>
        <span class="sp"></span>${fallback}${primaryBtn}${restBtns}
      </div>`;
    };
    // ── 治理分区的取词（内联，i18n 门禁扫得到；不信任主进程下发的 titleKey）──
    // 组名走人话术语表（specs/018 §4）：扩权/作用边界/分级都是工程词，
    // 界面词换成用户视角的说法；组内 hint 承担首次出现的白话脚注。
    const GROUP_TITLES = {
      conflict: T('cognition.inbox_group_conflict', '冲突与重复'),
      escalation: term('escalation'),
      boundary: `${term('boundary')}${T('cognition.inbox_group_not_written', '（还没写）')}`,
      unclassified: T('cognition.inbox_group_sensitivity_unset', '还没定{level}', { level: term('sensitivity') }),
      other: T('cognition.inbox_group_other', '其他待处理'),
    };
    const GROUP_HINTS = {
      conflict: T('cognition.inbox_classification_conflict_hint', '同一句话被归到两个类型，两边都不会晋升，需要你裁定。'),
      escalation: T('cognition.inbox_sensitivity_escalated_hint', '这条资产能带去的目的地变多了，需要你确认这次放宽。'),
      boundary: T('cognition.inbox_rule_boundary_hint', '没写适用范围的规矩不会被自动带入任务；补齐后才会生效。'),
      unclassified: T('cognition.inbox_sensitivity_unclassified_hint', '未分级不等于 L0：分级前不会被带往声明了敏感上限的目的地。'),
    };
    // ── 敏感级三档控件（specs/010 T011）：未分级时三档都不选中 ──
    const levelControl = (key, current) => window.uiSegmentedControl({
      ariaLabel: T('cognition.inbox_ask_classify', '补充敏感级分类'),
      items: ['L0', 'L1', 'L2'].map((level) => ({ label: level, value: level, attrs: { 'data-level': level } })),
      value: current,
      attrs: { 'data-act': 'inbox-classify-level', 'data-key': String(key) },
    });
    // ── 各分区的行渲染器（动作仍以 item.actions 为准，渲染层不自判）──
    const governanceRow = (row) => {
      const actions = Array.isArray(row.actions) ? row.actions : [];
      const has = (action) => actions.includes(action);
      const id = String(row.id || '');
      // 聚合行的 detail 与组 hint 同文（真机截图取证）：不重复摆第二遍。
      const detail = row.aggregate ? '' : row.detail;
      const head = `<div class="notice-copy">${rowTitle(row)}${detail ? `<div class="notice-detail">${esc(String(detail))}</div>` : ''}</div>`;
      if (row.kind === 'sensitivity_escalated') {
        return `<div class="notice-row">${head}<span class="sp"></span>${has('accept') ? btn(T('cognition.inbox_action_escalation_accept', '确认这次放宽'), 'inbox-escalation-accept', { small: true, primary: true, data: { id } }) : ''}${otherActions(has('reject') ? btn(T('cognition.inbox_action_escalation_reject', '驳回，维持原级'), 'inbox-escalation-reject', { small: true, danger: true, data: { id } }) : '')}</div>`;
      }
      if (row.kind === 'rule_boundary_missing' && has('set_boundary')) {
        // 就地补条件表单（specs/010 T029；specs/017 整改二：字段说明 + 保存
        // 后果）：预填当前条件，保存前主进程过同一道闸门。
        const formId = `inbox-bnd-${String(row.assetId || id).replace(/[^A-Za-z0-9_-]/g, '')}`;
        const boundary = row.boundary || {};
        // 表单默认收起（真机取证：38 条待办每条摊开两个空输入框=一屏墙）；
        // 「补条件」一键展开，展开后才是要填的字段与保存后果。
        return `<div class="notice-row inbox-governance-form" data-inbox-boundary-form>
          ${head}
          <div class="sd">${btn(T('cognition.inbox_form_open', '补条件'), 'inbox-form-toggle', { small: true, primary: true, data: { id } })}</div>
          <div class="inbox-inline-fields" data-inbox-boundary-body hidden>
            <label class="field"><span>${esc(T('cognition.inbox_boundary_field_applicable', '适用情形'))}</span>${window.uiInput({ id: `${formId}-applicable`, value: (boundary.applicableWhen || []).join('、'), attrs: { 'data-f': 'applicableWhen' } })}</label>
            <label class="field"><span>${esc(T('cognition.inbox_boundary_field_forbidden', '禁用情形'))}</span>${window.uiInput({ id: `${formId}-forbidden`, value: (boundary.forbiddenWhen || []).join('、'), attrs: { 'data-f': 'forbiddenWhen' } })}</label>
            <p class="note inbox-effect-note">${esc(T('cognition.inbox_boundary_save_effect', '保存后：主进程重新校验，通过后这条规则恢复自动带入；不通过会把原因留在这里。'))}</p>
            <div class="inbox-field-actions">${btn(T('cognition.inbox_action_set_boundary', '保存条件'), 'inbox-boundary-save', { small: true, data: { id } })}</div>
          </div>
        </div>`;
      }
      if (row.kind === 'sensitivity_unclassified' && has('classify')) {
        const aggregate = row.aggregate;
        if (aggregate && Array.isArray(aggregate.assetIds) && aggregate.count > 1) {
          // 聚合条目（specs/010 T025 → 018 T012 折叠收口）：默认一行
          // 「{n} 条没定敏感档 · 一次搞定」，展开才见名单与批量控件；
          // 失败逐条留在待办。分桶 chips 降级为筛选项（specs/018 T061）
          // 之外，这是「概览计数与分组计数重复」的另一半收口。
          return `<div class="notice-row inbox-governance-form">
            ${head}
            <details class="details inbox-batch-names">
              <summary><span class="n">${esc(String(aggregate.count))}</span>${esc(T('cognition.inbox_batch_summary', '条没定敏感档'))} · ${esc(T('cognition.inbox_batch_fix', '一次搞定'))}</summary>
              <div class="dbody">
                <ul class="inbox-batch-list">${aggregate.assetIds.map((assetId) => `<li>${esc(String(assetId))}</li>`).join('')}</ul>
                <p class="note inbox-effect-note">${esc(T('cognition.inbox_classify_batch_hint', '选好档位点「批量定级」：名单里的资产立即生效；个别失败的会留在待办里单独处理。'))}</p>
                <div class="inbox-field-actions">${levelControl(id, undefined)}
                  ${btn(T('cognition.inbox_action_classify_batch', '批量定级'), 'inbox-classify-batch', { small: true, primary: true, data: { id, ids: aggregate.assetIds.join(',') } })}
                </div>
              </div>
            </details>
          </div>`;
        }
        return `<div class="notice-row inbox-governance-form">
          ${head}<span class="sp"></span>
          <div class="inbox-inline-fields"><div class="inbox-field-actions">${levelControl(id, undefined)}
            ${btn(T('cognition.inbox_action_classify', '保存分级'), 'inbox-classify-apply', { small: true, primary: true, data: { id } })}
          </div></div>
        </div>`;
      }
      if (row.kind === 'classification_conflict' && has('claim')) {
        return `<div class="notice-row">${head}<span class="sp"></span>${btn(T('cognition.inbox_action_claim', '保留这一条'), 'inbox-conflict-claim', { small: true, primary: true, data: { id } })}${otherActions([has('reject') ? btn(INBOX_ACTION_LABELS.reject, 'inbox-resolve', { small: true, className: 'o', data: { id, action: 'reject' } }) : '', has('defer') ? btn(INBOX_ACTION_LABELS.defer, 'inbox-resolve', { small: true, className: 'o', data: { id, action: 'defer' } }) : ''].join(''))}</div>`;
      }
      if (row.kind === 'inspection_finding' && (has('keep') || has('merge'))) {
        // 巡检冲突/重复（specs/010 T033）：选边归档或合并。目标 = 本行锚定的
        // 资产（data-anchor）；data-target 携带另一方 id（展示与测试锚点）。
        const anchor = String(row.assetId || '');
        const other = String((row.assetIds || []).find((assetId) => String(assetId) !== anchor) || '');
        return `<div class="notice-row">${head}<span class="sp"></span>${has('keep') ? btn(T('cognition.inbox_action_keep', '保留这一条，归档另一条'), 'inbox-inspection-keep', { small: true, primary: true, data: { id, anchor, target: other } }) : ''}${otherActions([has('merge') ? btn(T('cognition.inbox_action_merge_pair', '合并到这一条'), 'inbox-inspection-merge', { small: true, className: 'o', data: { id, anchor, target: other } }) : '', has('reject') ? btn(FINDING_ACTION_LABELS.reject, 'inbox-resolve', { small: true, className: 'o', data: { id, action: 'reject' } }) : '', has('defer') ? btn(FINDING_ACTION_LABELS.defer, 'inbox-resolve', { small: true, className: 'o', data: { id, action: 'defer' } }) : ''].join(''))}</div>`;
      }
      // 其余（含没有就地处断动作的）沿用既有扁平行（落点按钮同现状）。
      return flatInboxRow(row);
    };
    // ── 决策队列（specs/018 v2 · 2026-09-26 真机重做）：后端 urgency
    //（confirm/low_disturbance）决定分区；组名只作区内小节；计数三口径
    // 统一成「要你拍板 / 低打扰 / 证据异常」，与页签角标同一来源。
    const isConfirm = (row) => String(row.urgency || '') === 'confirm';
    const groupBlock = (group, items) => {
      const title = GROUP_TITLES[group.category] || GROUP_TITLES.other;
      const hint = GROUP_HINTS[group.category];
      const rows = items.map((row) => (group.category === 'other' ? flatInboxRow(row) : governanceRow(row))).join('');
      // 计数口径（T016）：未分级显示 total（被折叠的总数），其余显示条目数；
      // 按 urgency 拆开后，仅当本拆分区持有全组条目时才取 total。
      const shown = group.category === 'unclassified' && items.length === group.items.length
        ? Number(group.total || items.length) : items.length;
      return `<div class="sect-block"><div class="tt">${esc(title)}<span class="note">${esc(String(shown))}</span></div>${hint ? `<p class="note">${esc(hint)}</p>` : ''}${rows}</div>`;
    };
    const confirmBlocks = [];
    const lowBlocks = [];
    let confirmCount = 0;
    let lowCount = 0;
    if (inboxGroups && inboxGroups.length) {
      for (const group of inboxGroups) {
        if (!group || !Array.isArray(group.items) || !group.items.length) continue;
        const confirmItems = group.items.filter(isConfirm);
        const lowItems = group.items.filter((row) => !isConfirm(row));
        if (confirmItems.length) { confirmCount += confirmItems.length; confirmBlocks.push(groupBlock(group, confirmItems)); }
        if (lowItems.length) { lowCount += lowItems.length; lowBlocks.push(groupBlock(group, lowItems)); }
      }
    } else if (inboxItems.length) {
      // 降级路径：拿不到 groups（旧主进程/读失败）逐字退回既有扁平清单。
      const inboxRows = inboxItems.map(flatInboxRow).join('');
      confirmBlocks.push(`<div class="sect-block"><div class="tt">${esc(T('cognition.inbox_section', '待确认清单'))}<span class="note">${esc(String(inboxItems.length))}</span></div>${inboxRows}</div>`);
      confirmCount += inboxItems.length;
    }
    const decideCount = confirmCount + ready.length;
    const lowTotal = lowCount + snoozed.length;
    const evidenceCount = broken.length + weak.length;
    const allQuiet = !attention.length && !confirmCount && !lowCount && !pending.length && !terminal.length && !processed.length;
    /* 导语（specs/018 T010）：一句话回答「现在要我拍板什么」。概览计数收成
     * 导语里两个可点数字（拍板数 / 证据异常数），点数字滚到对应分区——
     * 统计条与分组计数的重复就此砍掉。预计分钟 = 每条约一分钟的经验值。 */
    const leadNum = (value, anchor) => `<span class="chip-link ca-jump-num" data-act="review-jump" data-id="${esc(anchor)}" ${roleBtn()}>${esc(String(value))}</span>`;
    const minutes = Math.max(decideCount, 1);
    /* 分段拼导语（迭代轮 1 修）：拍板数为 0 时不再写「0 件事等你拍板 ·
     * 预计 1 分钟」（自相矛盾）——拍板段只在 >0 时出现，锚点也随之恒在。 */
    const decidePart = decideCount
      ? `${leadNum(decideCount, 'ca-review-decide')} ${esc(T('cognition.review_lead_decide', '件事等你拍板'))} · ${esc(T('cognition.review_lead_minutes', '预计 {m} 分钟（每条约一分钟）', { m: String(minutes) }))}`
      : '';
    const evidencePart = evidenceCount ? `${leadNum(evidenceCount, 'ca-review-evidence')} ${esc(T('cognition.review_lead_evidence', '条证据要补'))}` : '';
    const lowPart = lowTotal ? esc(T('cognition.review_lead_low', '{n} 条不急，先收着', { n: String(lowTotal) })) : '';
    const leadHtml = [decidePart, evidencePart, lowPart].filter(Boolean).length
      ? `<div class="sub">${[decidePart, evidencePart, lowPart].filter(Boolean).join(' · ')}</div>`
      : '';
    /* 去向提示（specs/018 T014）：确认后两分钟内回到本页，行内提示
     * 「已确认 · 它长在树上了（去看）」。纯呈现状态——core 只存标题与时间，
     * 到期自然消失，不新增任何动作；「去看」走既有 asset-view=tree 导航。 */
    const promoted = S.lastPromoted && (Date.now() - Number(S.lastPromoted.at || 0) < 120000)
      ? S.lastPromoted
      : null;
    const truncate = (text, limit) => (NS.truncateText ? NS.truncateText(text, limit) : String(text || '').slice(0, limit));
    const promotedHtml = promoted ? `<div class="notice-stack ca-promoted-note"><div class="notice-row">
      <div class="notice-copy"><div class="notice-title">${esc(T('cognition.review_promoted_title', '已确认 · 它长在树上了'))}</div>
      ${promoted.title ? `<div class="notice-detail">${esc(truncate(promoted.title, 60))}</div>` : ''}</div>
      <span class="sp"></span>${btn(T('cognition.review_promoted_go', '去看'), 'asset-view', { id: 'tree', small: true, primary: true })}
    </div></div>` : '';
    const decideHtml = decideCount ? `<div id="ca-review-decide">${sectionHead(T('cognition.review_queue_decide', '要你拍板'), String(decideCount))}
      <div class="note sect-note">${esc(T('cognition.review_queue_decide_hint', '每条都卡在这里等你：动作与后果写在条上，处理一条少一条。'))}</div>
      ${confirmBlocks.join('')}
      ${ready.length ? `${sectionHead(T('cognition.review_group_wait', '等待你确认'), String(ready.length))}<div class="note sect-note">${esc(T('cognition.review_group_wait_note', '确认后会创建 v1，并保留来源与撤销入口'))} · ${esc(termNote('candidate'))}</div>${ready.map((c) => candidateCard(c, false)).join('')}` : ''}</div>` : '';
    const lowHtml = lowTotal ? `<details class="details fold fold-low"><summary>${esc(T('cognition.review_queue_low', '低打扰'))}<span class="n">${lowTotal}</span></summary><div class="dbody"><div class="note">${esc(T('cognition.review_queue_low_hint', '不急，但不会自己消失：有空时逐条处理。'))}</div>${lowBlocks.join('')}</div></details>` : '';
    /* 「其他异常」组（specs/018 T013）：整理失败 / 任务执行失败 / 来源异常
     * 不再混在治理区——它们不是拍板事项，归页尾折叠；展开态跟随
     * route.sourceIssueOpen，点「处理」不会把刚展开的名单又折回去。 */
    const attentionHtml = attention.length
      ? `<details class="details fold fold-attention"${String(route.sourceIssueOpen || '') === 'open' ? ' open' : ''}><summary>${esc(T('cognition.review_other_issues', '其他异常'))}<span class="n">${attention.length}</span></summary><div class="dbody"><div class="note">${esc(T('cognition.review_other_issues_hint', '不是等你拍板的事：整理没跑成、任务没得到回复、来源读取异常；处理入口在「系统活动」。'))}</div>${attention.join('')}${sourceIssuesSection(route)}</div></details>`
      : '';
    return `${hero(T('cognition.review_title', '待我处理'), '', leadHtml)}
    ${promotedHtml}
    ${allQuiet ? `<div class="sect-block">${empty(
      T('cognition.inbox_empty', '没有需要你确认的事项。'),
      T('cognition.review_all_quiet_hint', '现在没有要你决定的，系统继续在后台沉淀；有新待办时会回到这里。'),
      { label: T('cognition.review_empty_go_activity', '去看看系统在忙什么'), attrs: { 'data-act': 'go-organize' } },
    )}</div>` : `${decideHtml}
    ${broken.length || weak.length ? `<div id="ca-review-evidence">
    ${broken.length ? `${sectionHead(T('cognition.review_group_evidence', '来源已删除的候选'), String(broken.length))}<div class="note sect-note">${esc(T('cognition.review_group_evidence_note', '这些候选的原始出处已被删除；可以点开确认后仍要保存，或选择不保存'))}</div>${broken.map((c) => candidateCard(c, true)).join('')}` : ''}
    ${weak.length ? `${sectionHead(T('cognition.review_group_weak', '证据不足（先补证据）'), String(weak.length))}<div class="note sect-note">${esc(T('cognition.review_group_weak_note', '可以修改内容并补上证据后保存，或先稍后处理'))}</div>${weak.map((c) => candidateCard(c, false)).join('')}` : ''}
    </div>` : ''}
    ${lowHtml}`}
    ${snoozed.length ? `<details class="details fold fold-snoozed"><summary>${esc(T('cognition.review_group_snoozed', '已稍后处理'))}<span class="n">${snoozed.length}</span></summary><div class="dbody"><div class="note">${esc(T('cognition.review_group_snoozed_note', '静音中，不计入待确认'))}</div>${snoozed.map((c) => candidateCard(c, false)).join('')}</div></details>` : ''}
    ${terminal.length ? `<details class="details fold fold-terminal"><summary>${esc(T('cognition.review_group_terminal', '已失效的候选'))}<span class="n">${terminal.length}</span></summary><div class="dbody"><div class="note">${esc(T('cognition.review_group_terminal_note', '已过期或被取代，仅保留记录'))}</div>${terminal.map((c) => candidateCard(c, false)).join('')}</div></details>` : ''}
    ${processed.length ? `<details class="details fold fold-processed"><summary>${esc(T('cognition.inbox_processed_badge', '处理记录'))}<span class="n">${processed.length}</span></summary><div class="dbody"><div class="note">${esc(T('cognition.inbox_processed_hint', '按处理时间倒序，只显示已处理的决定'))}</div>${processed.map((c) => `
      <div class="vrow">
        <div class="vt"><div class="v1">${esc(candidateTitle(c))}${String(c.status || '') === 'confirmed' ? ` <span class="chip-link" data-act="asset-view" data-id="tree" ${roleBtn()}>${esc(T('cognition.review_promoted_go_tree', '长在树上了，去看'))}</span>` : ''}</div>
        <div class="v2">${esc(fmtDate(c.updatedAt || c.createdAt))} · ${esc(processedLabel(c))}</div></div>
      </div>`).join('')}</div></details>` : ''}
    ${attentionHtml}`;
  }

  /* ────────────────────────── 视图：候选详情 ────────────────────────── */

  /* 候选确认表单（2026-09-15 自 viewCandidate 抽出共享）：
   *  - candidateFormBody：纯表单区（警示/类型/判断/高级/证据+动作），
   *    供整理详情页合并进执行信息卡（外层由调用方提供 ca-candidate-detail
   *    标识——cand-type 与 readCandidateForm 靠它就近定位）；
   *  - candidateFormCard：带卡壳与标题行的完整卡（候选详情页用）。
   *  控件 id 带候选 id 后缀：一页多卡时全局 id 不重复（读取靠 [data-f]）。 */
  /** 候选卡的适用范围（承接表 02 / G2，2026-09-26 补落点）：新建型候选此前
   *  只显正文与来源，用户看不到它将来在什么范围生效。作用域 + 适用/禁用
   *  场景三行；一个都没有时如实说「没有限定」，不编造默认。更新型候选的
   *  适用范围已由依据链（improvementChainBlock ⑥）呈现，不重复。 */
  function candidateScopeField(candidate) {
    const field = (label, inner) => `<label class="field"><span>${esc(label)}</span>${inner}</label>`;
    const scope = String(candidate.suggestedScope || '').trim();
    const applicable = (Array.isArray(candidate.applicableWhen) ? candidate.applicableWhen : []).map(String).filter(Boolean);
    const forbidden = (Array.isArray(candidate.forbiddenWhen) ? candidate.forbiddenWhen : []).map(String).filter(Boolean);
    const lines = [
      scope ? foldValue(`${T('cognition.candidate_scope_domain', '作用域')}：${scope}`) : '',
      applicable.length ? foldValue(`${T('cognition.asset_version_applicable', '适用场景')}：${applicable.join('；')}`) : '',
      forbidden.length ? foldValue(`${T('cognition.asset_version_forbidden', '禁用场景')}：${forbidden.join('；')}`) : '',
    ].filter(Boolean).join('');
    return `<div class="sect-block">${field(
      T('cognition.asset_scope_label', '适用范围'),
      lines || `<p class="note">${esc(T('cognition.chain_scope_missing', '这条候选没有限定适用范围。'))}</p>`,
    )}</div>`;
  }

  function candidateFormBody(candidate) {
    const refs = evidenceRefs(candidate);
    const broken = evidenceMostlyUnavailable(candidate);
    // 能力一律按主进程下发的 capability 判定，**缺失即视为只读**——与旧模块
    // "treats a candidate without capabilities as read-only instead of guessing"
    // 的口径一致。2026-09-20 统一：此前同一函数里并存三种读法（canEdit 用
    // `capabilities && …`、canPromote 用真值、canDefer/canReject 用 `!== false`），
    // 于是"capabilities 缺失"时仍会渲染出「稍后处理 / 拒绝」——正是本 PR 要消灭的
    // 那类必然失败的按钮。
    const caps = candidate.capabilities || {};
    const canEdit = !!caps.canEdit;
    const canPromote = !!caps.canPromote;
    const canDefer = !!caps.canDefer;
    const canReject = !!caps.canReject;
    const edit = canEdit;
    const field = (label, inner) => `<label class="field"><span>${esc(label)}</span>${inner}</label>`;
    // 更新候选的差异确认卡（2026-09-16 版本组）：旧版全文对照 + 版本核对
    // 提示——任务所用版与当前在用版不一致时，确认前先核对改进对象。
    // 2026-09-25（specs/015 T014）：原「当前版本」差异区扩为**依据链**区块
    // （原方法与版本 / 同次任务 / 预期→实际 / 采用证据 / 为什么改 / 适用范围 /
    // 改动点，见 improvementChainBlock）。更新型候选的预期→实际由依据链呈现，
    // 不再叠加一份「复盘依据」，避免同屏两处同内容。
    const chainHtml = improvementChainBlock(candidate);
    // 确认时撞版本冲突的处置块（specs/015 T022）：就地说明"没生效"、按当前在用版
    // 重摆差异、给「按当前版本重新确认」。它只描述这一次确认的事实，不改变候选的
    // 待处理性质（候选仍可稍后处理/拒绝）。
    const conflictHtml = candidateVersionConflictBlock(candidate, canPromote);
    // 决策动作同样按 capability 收敛（2026-09-20 修）：终态候选（confirmed /
    // rejected / ignored）的映射是 canDefer=false、canReject=false、isTerminal=true，
    // 此前这两个按钮**无条件**渲染，用户点下去必然被后端状态机拒绝——旧 skills.js
    // 模块有一条 "never renders decision actions for terminal candidates" 的用例守着，
    // 2026-09-15 #266 重写时没带过来。口径见函数开头：缺失 capabilities 即只读。
    // 按钮名按型分支（specs/015 T023）：更新型说「确认更新」，新建型说「保存并使用」。
    const decisionLabels = candidateDecisionLabels(candidate);
    const actionsHtml = `<div class="actions actions-right">
        ${canPromote ? btn(decisionLabels.promote, 'cand-adopt-with-form', { id: candidate.id, primary: true }) : ''}
        ${canDefer ? btn(decisionLabels.defer, 'cand-decide', { id: candidate.id, data: { action: 'defer' }, className: 'o' }) : ''}
        ${canReject ? btn(decisionLabels.reject, 'cand-decide', { id: candidate.id, data: { action: 'reject' }, danger: true }) : ''}
      </div>`;
    return `
      ${broken ? `<div class="warn">${esc(T('cognition.candidate_evidence_all_unavailable', '这条候选的大部分来源记录已被删除，无法核对证据。建议补充新证据后保存，或选择不保存。'))}</div>` : ''}
      ${candidate.mergedIntoAssetId ? `<div class="note">${esc(T('cognition.candidate_merged_into', '这条与已有资产相似：确认后会并入那条资产（融合出新版本），不会另开一条。'))}</div>` : ''}
      ${chainHtml ? '' : reviewSignalBlock(candidate)}
      ${chainHtml}
      ${chainHtml ? '' : candidateScopeField(candidate)}
      ${conflictHtml}
      ${edit ? `
        ${field(T('cognition.type', '类型'), `<div class="chips">${CATEGORIES.map(([id, key, fb]) => { const on = String(candidate.suggestedType || '') === id; return `<span class="ca-chip ca-chip-opt${on ? ' is-green' : ''}" data-act="cand-type" data-id="${esc(id)}" ${roleBtn(`aria-pressed="${on ? 'true' : 'false'}"`)}>${esc(T(key, fb))}</span>`; }).join('')}</div>`)}
        ${field(T('cognition.judgment', '具体内容'), window.uiTextarea({ id: `ca-cand-judgment-${esc(candidate.id)}`, value: candidate.judgment || '', attrs: { 'data-f': 'judgment' } }))}
        <details class="details">
          <summary>${esc(T('cognition.candidate_advanced', '高级选项（通常不用改）'))}</summary>
          ${field(T('cognition.candidate_scope_label', '作用范围'), window.uiInput({ id: `ca-cand-scope-${esc(candidate.id)}`, value: candidate.suggestedScope || '', placeholder: T('cognition.candidate_scope_placeholder', '例如：仅产品工作空间'), attrs: { 'data-f': 'scope' } }))}
          <div class="note">${esc(T('cognition.candidate_scope_hint', '建议用受控词：general=跨对话通用；report/code/review/product=任务类型。自由文本在自动投影中可能匹配不上任务。'))}</div>
          ${field(T('cognition.summary', '摘要'), window.uiInput({ id: `ca-cand-summary-${esc(candidate.id)}`, value: candidate.summary || '', attrs: { 'data-f': 'summary' } }))}
        </details>
        <div class="ca-detail-foot">
          ${field(T('cognition.evidence_refs', '证据引用'), refs.length ? evidenceGroupsHtml(refs) : `<span class="note">${esc(T('cognition.candidate_no_evidence', '没有可追溯的证据引用；确认前建议先补证。'))}</span>`)}
          ${kstarEpisodeSection(S.route)}
          ${(() => {
            /* 保存并使用被能力门控关掉时必须说明原因——否则用户面前只有
               稍后/拒绝两个出口，不知道为什么不能确认（2026-09-21 真机抓出）。 */
            const capsAll = candidate.capabilities || {};
            const reasons = Array.isArray(capsAll.ineligibleReasons) ? capsAll.ineligibleReasons : [];
            if (canPromote || !reasons.length) return '';
            const lines = reasons.map((r) => NS.promotionBlockText ? NS.promotionBlockText(r) : '').filter(Boolean);
            if (!lines.length) return '';
            return `<div class="note cand-block-note">${esc(T('cognition.candidate_error_promotion_blocked', '这条候选还不够格成为正式资产：'))}${lines.map((line) => `<br>· ${esc(line)}`).join('')}<br>${esc(T('cognition.candidate_block_hint', '修改内容或类型使其合格后，「保存并使用」会自动出现。'))}</div>`;
          })()}
          ${actionsHtml}
        </div>
      ` : `
        <p class="content-text">${esc(candidate.judgment || '')}</p>
        ${field(T('cognition.candidate_scope_label', '作用范围'), `<span class="ca-v">${esc(candidate.suggestedScope || T('cognition.asset_scope_unset', '未设置'))}</span>`)}
        ${refs.length ? evidenceGroupsHtml(refs) : ''}
        ${kstarEpisodeSection(S.route)}
        ${actionsHtml}
      `}`;
  }

  function candidateFormCard(candidate) {
    const broken = evidenceMostlyUnavailable(candidate);
    /* 标题=完整 summary（不再截 24 字）：这是用户要确认的东西的名字，
       截断后「看起来没有标题」（2026-09-21 子安真机抓出）；CSS 限 3 行。 */
    const fullTitle = String(candidate.summary || candidate.judgment || T('cognition.candidate_untitled', '未命名候选')).trim();
    return `
    <div class="card ca-candidate-detail" data-cand-id="${esc(candidate.id)}" data-cand-type="${esc(candidate.suggestedType || '')}">
      <div class="cand-head">
        ${chip(T('cognition.candidate_status_pending', '待确认'), 'amber')}${chip(categoryLabel(candidate.suggestedType))}${broken ? chip(T('cognition.candidate_evidence_weak', '证据不足'), 'amber') : ''}
      </div>
      <h2 class="cand-title">${esc(fullTitle)}</h2>
      ${candidateFormBody(candidate)}
    </div>`;
  }

  function viewCandidate(route) {
    const candidate = S.candidates.find((c) => String(c.id) === String(route.candidateId));
    // 顶部「返回」按钮（原卡片底部的返回列表按钮已删，返回入口收在此处）。
    const backHtml = btn(`← ${T('common.back', '返回')}`, 'go-back', { className: 'backlink' });
    if (!candidate) {
      return `${backHtml}${hero(T('cognition.candidate_detail_title', '候选详情'), '')}${empty(T('cognition.candidate_detail_missing', '这条候选已不在待处理列表中'), '')}`;
    }
    return `${backHtml}
    ${hero(
      T('cognition.candidate_detail_title', '确认内容，也确认它该在什么范围生效'),
      T('cognition.candidate_detail_hint', '确认后会创建正式资产的第一个版本，并保留来源与撤销入口。'),
    )}
    ${candidateFormCard(candidate)}`;
  }

  /* ────────────────────────── 使用记录零件（2026-09-15 自独立页迁入资产详情） ────────────────────────── */

  const PROOF_FEEDBACKS = [
    ['positive', 'cognition.proof_carried_in', '有用'],
    ['rework', 'cognition.proof_rework', '没用对'],
    ['neutral', 'cognition.proof_no_diff', '没差别'],
    ['invalid', 'cognition.proof_degraded', '说不清'],
  ];

  /** 时间线事件标题：优先用 kind（稳定枚举）映射成人话；英文标题仅作兜底。
   *  此前只映射了 title 的三种英文串，usage_recorded / projection_confirmed
   *  两类漏网（用户实测"看不懂"），全部补齐；未知事件原样显示不编造。 */
  const EVENT_TITLES = {
    asset_created: ['cognition.proof_event_created', '已创建资产'],
    asset_version: ['cognition.proof_event_version', '版本已保存'],
    asset_updated: ['cognition.proof_event_updated', '资产已更新'],
    projection_confirmed: ['cognition.proof_event_projection', '被带入一次任务'],
    usage_recorded: ['cognition.proof_event_usage', '任务中被实际使用'],
    catalog_hint_unused: ['cognition.proof_event_catalog_hint_unused', '相关而未被用'],
  };
  const EVENT_TITLE_BY_TEXT = {
    'Asset created': EVENT_TITLES.asset_created,
    'Asset version saved': EVENT_TITLES.asset_version,
    'Asset updated': EVENT_TITLES.asset_updated,
  };
  const proofEventTitle = (proof) => {
    const byKind = EVENT_TITLES[String(proof.kind || '')];
    if (byKind) return T(byKind[0], byKind[1]);
    const raw = String(proof.outcome || proof.title || proof.kind || '');
    const byText = EVENT_TITLE_BY_TEXT[raw];
    if (byText) return T(byText[0], byText[1]);
    // title 可能是历史数据里的自然语言标题，保留原文；outcome/kind 是内部
    // 枚举，认不出时宁可给占位文案也不裸 snake_case 机器码。
    if (proof.title) return String(proof.title);
    return T('cognition.proof_event_other', '证明事件');
  };

  /* ────────────────────────── 视图：整理（任务流 + 策略） ────────────────────────── */

  /* ────────────────────────── 沉淀设置页（2026-09-15 自页首抽屉升级） ──────────────────────────
   * 入口=整理页右上齿轮。核心是「夜间自动沉淀」条状卡：右侧开关、中间可选
   * 开始时间；开启时联动「先问我」——产出的候选进「待我处理」等批准/调整
   *（而非自动采纳）。原抽屉的整理功能开关与候选确认方式也收在 this 页。 */

  /** 推荐排序权重卡（specs/012 T020 / US-202 AC6，契约 renderer-seams §七）：
   *  4 个数值 uiInput（0~10、步进 0.1）+ 恢复默认 + 保存；保存/校验失败
   *  **就地报错**（不整页重画——重画会吃掉刚输入的值）；读不到权重时如实
   *  说明并禁编辑，不摆假数字。生效口径：下一轮目录构建（提示语不谎称立即）。 */
  function rankingWeightsCard() {
    const state = NS.rankingWeights;
    const title = T('cognition.ranking_weights_title', '推荐排序权重');
    const FACTORS = [
      ['relevance', T('cognition.ranking_weights_factor_relevance', '内容相关权重')],
      ['adoption', T('cognition.ranking_weights_factor_adoption', '实际采用权重')],
      ['scene', T('cognition.ranking_weights_factor_scene', '场景权重')],
      ['maturity', T('cognition.ranking_weights_factor_maturity', '成熟度权重')],
    ];
    const field = (label, inner) => `<label class="field"><span>${esc(label)}</span>${inner}</label>`;
    const sourceNote = (src) => (src === 'invalid-fallback'
      ? `<p class="note ca-rank-warn">${esc(T('cognition.ranking_weights_invalid_note', '你的权重配置没生效（配置不合法），当前用的是默认权重'))}</p>`
      : src === 'default' ? `<p class="note">${esc(T('cognition.ranking_source_default_note', '当前使用默认权重'))}</p>` : '');
    if (!state || state.loading) {
      return `<div class="card ca-setcard">
        <div class="tt">${esc(title)}</div>
        <p class="note">${esc(T('cognition.ranking_weights_loading', '正在读取权重设置…'))}</p>
      </div>`;
    }
    if (state.failed) {
      return `<div class="card ca-setcard" data-ranking-weights>
        <div class="tt">${esc(title)}</div>
        <p class="note">${esc(T('cognition.ranking_weights_load_failed', '权重设置暂时读不到（读取失败），所以这里暂时不能编辑。'))}</p>
      </div>`;
    }
    const weights = state.weights || {};
    const inputs = FACTORS.map(([key, label]) => field(label, window.uiInput({
      id: `ca-rank-w-${key}`,
      type: 'number',
      className: 'ca-rank-w-input',
      value: String(weights[key] != null ? weights[key] : ''),
      attrs: { min: '0', max: '10', step: '0.1', 'data-w': key },
    }))).join('');
    return `<div class="card ca-setcard" data-ranking-weights>
      <div class="rowline">
        <div><div class="tt">${esc(title)}</div>
        <div class="sub">${esc(T('cognition.ranking_weights_hint', '影响认知资产目录的推荐排序。保存后下一轮对话生效（不用改代码）；四个都填 0 或超出 0~10 会被拒绝，原值保持。'))}</div></div>
      </div>
      ${sourceNote(String(state.source || ''))}
      <div class="ca-rank-w-form">${inputs}</div>
      <p class="note ca-w-error" data-ranking-weights-error hidden></p>
      <div class="actions actions-right">
        ${btn(T('cognition.ranking_weights_reset', '恢复默认'), 'ranking-weights-reset', { small: true, className: 'o' })}
        ${btn(T('cognition.ranking_weights_save', '保存'), 'ranking-weights-save', { small: true, primary: true })}
      </div>
    </div>`;
  }

  /** 大扫除 section（specs/017 整改三）：入口从整理页头收进沉淀设置页——
   *  可直接发起、显示最近一次报告摘要、给完整报告入口（报告页复用既有
   *  viewCleanup 与 open-cleanup 路由，不重写报告逻辑）。 */
  function cleanupSettingsSection() {
    const state = S.cleanupReports;
    const reports = state && Array.isArray(state.reports) ? state.reports : [];
    const loading = Boolean(state && state.loading);
    const latest = reports[0] || null;
    const summary = latest
      ? T('cognition.cleanup_latest', '最近一次：{when} · 执行 {applied} 项 · 拿不准 {uncertain} 项', {
        when: fmtDate(latest.createdAt),
        applied: String((latest.items || []).filter((item) => item.status === 'applied').length),
        uncertain: String((latest.uncertain || []).length),
      })
      : T('cognition.cleanup_none_yet', '还没跑过大扫除：发起一次，跑完这里会出现逐项报告（改了什么、为什么、怎么回滚）。');
    return `${sectionHead(T('cognition.cleanup_entry', '大扫除'), reports.length ? String(reports.length) : '')}
    <div class="card ca-setcard">
      <div class="rowline">
        <div>
          <div class="sub">${esc(T('cognition.cleanup_run_hint', '只做不改变含义的整理（标题标点规范化、正文一字不差的重复归并）；拿不准的列出来等你决定，不擅自处置。'))}</div>
          <div class="sub">${esc(summary)}</div>
        </div>
        <div class="right">
          ${btn(loading ? T('cognition.cleanup_running', '正在整理…') : T('cognition.cleanup_run', '发起大扫除'), 'run-cleanup', { small: true, primary: true, disabled: loading })}
          ${latest ? btn(T('cognition.cleanup_open_report', '查看完整报告'), 'open-cleanup', { small: true, className: 'o' }) : ''}
        </div>
      </div>
    </div>`;
  }

  function viewOrganizeSettingsPage() {
    // 「整理功能」总开关卡已撤（specs/017 整改三）：「已开启+关闭按钮」读不懂
    // 且关闭是破坏性动作；后端 enabled 字段与契约保留，整理页的「已关闭」
    // warn 路径也保留（只是 UI 上不再可达）。
    const settings = S.captureSettings || {};
    const model = S.captureModel || null;
    const nightlyOn = String(settings.executionPolicy || 'manual') === 'nightly';
    const reviewAuto = String(settings.reviewPolicy || 'auto') === 'auto';
    const nightlyStart = String(settings.nightlyStart || '02:00');
    return `${hero(
      T('cognition.organize_settings_title', '沉淀设置'),
      T('cognition.organize_settings_hint', '决定系统什么时候自动沉淀、沉淀出的内容要不要先经过你。'),
    )}
    <div class="card ca-setcard">
      <div class="rowline">
        <div><div class="tt">${esc(T('cognition.model_state_title', '模型状态'))}</div>
        <div class="sub">${esc(model && model.configured
          ? (model.authorizationRequired
            ? T('cognition.model_state_auth', '模型已配置但授权未完成：整理会在需要模型时停住，先去完成授权。')
            : T('cognition.model_state_ok', '模型已配置，自动整理可用。'))
          : T('cognition.model_state_missing', '还没配置模型：自动整理与候选提炼都跑不起来。'))}</div></div>
        <div class="right">${btn(T('cognition.model_state_open', '去应用设置'), 'go-configure-model', { small: true, className: 'o' })}</div>
      </div>
    </div>
    <div class="card ca-setting-row">
      <div class="ca-setting-copy">
        <div class="tt">${esc(T('cognition.nightly_capture_title', '夜间自动沉淀'))}</div>
        <div class="sub">${esc(T('cognition.nightly_capture_hint', '夜间在所选时间自动整理当天结束的会话（消耗模型额度）；产出的内容进入「待我处理」，等你批准或调整。'))}</div>
      </div>
      ${nightlyOn ? `<label class="ca-setting-time"><span>${esc(T('cognition.nightly_capture_time', '开始时间'))}</span>${window.uiInput({ id: 'ca-nightly-start', type: 'time', value: nightlyStart, attrs: { 'data-act': 'nightly-time' } })}</label>` : ''}
      ${window.uiSwitch({ label: T('cognition.nightly_capture_title', '夜间自动沉淀'), checked: nightlyOn, attrs: { 'data-act': 'nightly-toggle' } })}
    </div>
    <div class="card ca-setcard">
      <div class="rowline">
        <div class="tt">${esc(T('cognition.capture_review_title', '候选怎么确认'))}</div>
      </div>
      <div class="ca-subnav">
        ${btn(T('cognition.capture_review_auto', '自动采纳'), 'capture-review-toggle', { id: 'auto', className: `chip${reviewAuto ? ' is-on' : ''}` })}
        ${btn(T('cognition.capture_review_manual', '先问我'), 'capture-review-toggle', { id: 'manual', className: `chip${!reviewAuto ? ' is-on' : ''}` })}
      </div>
      <p class="note">${esc(T(reviewAuto ? 'cognition.capture_review_auto_note' : 'cognition.capture_review_manual_note', reviewAuto ? '符合条件的候选会自动采纳（不再询问）' : '候选先进入待确认，由你决定'))}</p>
    </div>
    ${rankingWeightsCard()}
    ${cleanupSettingsSection()}
    ${inspectionSettingsCard()}
    <div class="ca-settings-foot">
      <span class="note">${esc(T('cognition.settings_back_to_activity_hint', '这里改的一切，效果都在「系统活动」的时间线上看得到。'))}</span>
      ${btn(T('cognition.settings_back_to_activity', '去系统活动'), 'go-organize', { small: true, className: 'o' })}
    </div>`;
  }

  /* ────────────────────────── 视图：整理（任务流 + 策略） ──────────────────────────
   * 2026-09-15 全模块重构：原「从历史会话整理」「整理记录」「设置与管理→
   * 整理方式」三处合并为一。一行 = 一个会话 × 它的整理任务（含无留存内容
   * 的静默记录）；策略收成页首抽屉；分桶筛选与批量入口保留。 */

  /** 整理报告（specs/008 US-403）：大扫除逐项产出、逐项可回滚。
   *
   *  报告存在的意义是"用户能自己核对"——所以每一项都显示改了什么、为什么、
   *  以及一个回滚入口；拿不准的项单列，等用户给个处置意见（不擅自处置）。 */
  /** 后台巡检卡（specs/018 Step 4/5）：开关与手动触发收进设置页；
   *  系统活动页只留只读轮次摘要（inspectionRoundCard）。只报不改的口径不变。 */
  function inspectionSettingsCard() {
    const inspection = S.inspection || null;
    const inspectionOn = Boolean(inspection && inspection.settings && inspection.settings.enabled);
    const latestRun = inspection && inspection.latestRun ? inspection.latestRun : null;
    return `<div class="card ca-setcard">
      <div class="rowline">
        <div>
          <div class="tt">${esc(T('cognition.inspection_title', '后台巡检'))}</div>
          <div class="sub">${esc(T('cognition.inspection_hint', '定期扫一遍资产库，发现重复 / 过时 / 冲突就列进「待我处理」。只报不改：巡检不会动你的资产。'))}</div>
          ${latestRun ? `<div class="sub">${esc(T('cognition.inspection_last_run', '最近一轮：{when} · 发现 {n} 条', {
            when: fmtDate(latestRun.startedAt), n: String(((latestRun.findings || [])).length),
          }))}</div>` : ''}
        </div>
        <div class="right">
          ${window.uiSwitch({
            label: T('cognition.inspection_title', '后台巡检'),
            checked: inspectionOn,
            attrs: { 'data-act': 'inspection-toggle' },
          })}
          ${btn(T('cognition.inspection_run_now', '立即巡检一次'), 'run-inspection', { small: true, className: 'o' })}
        </div>
      </div>
    </div>`;
  }

  /** 巡检轮次摘要（系统活动页只读记录）：扫了多少、怎么触发、发现去了哪。 */
  function inspectionRoundCard() {
    const inspection = S.inspection || null;
    const latestRun = inspection && inspection.latestRun ? inspection.latestRun : null;
    if (!latestRun) return '';
    return `${sectionHead(T('cognition.inspection_title', '后台巡检'), String((latestRun.findings || []).length))}
    <div class="card ca-setcard"><div class="rowline"><div>
      <div class="sub">${esc(T('cognition.inspection_last_run', '最近一轮：{when} · 发现 {n} 条', { when: fmtDate(latestRun.startedAt), n: String((latestRun.findings || []).length) }))}</div>
      <div class="sub">${esc(T('cognition.inspection_round_meta', '扫描 {scanned} 条 · 触发：{trigger} · 发现进「待我处理」，只报不改', { scanned: String(latestRun.scanned || 0), trigger: String(latestRun.trigger || '') === 'manual' ? T('cognition.inspection_trigger_manual', '手动') : T('cognition.inspection_trigger_scheduled', '定时') }))}</div>
    </div></div></div>`;
  }

  function viewCleanup(route) {
    const state = S.cleanupReports;
    const reports = state && Array.isArray(state.reports) ? state.reports : [];
    const selectedId = String(route.cleanupReportId || '');
    const report = reports.find((row) => String(row.id) === selectedId) || reports[0] || null;
    const loading = Boolean(state && state.loading);
    // 页头走共享 uiPageHeader（契约是紧凑单行 + 最多三个次要操作，没有副标题位）；
    // 说明放正文里的 note，不塞进页头。
    const header = window.uiPageHeader({
      title: T('cognition.cleanup_title', '大扫除与整理报告'),
      actions: [{
        label: loading ? T('cognition.cleanup_running', '正在整理…') : T('cognition.cleanup_run', '发起大扫除'),
        loading,
        disabled: loading,
        attrs: { 'data-act': 'run-cleanup' },
      }],
    });
    const hint = `<p class="note">${esc(T('cognition.cleanup_run_hint', '只做不改变含义的整理（标题标点规范化、正文一字不差的重复归并）；拿不准的列出来等你决定，不擅自处置。'))}</p>`;
    if (!report) {
      return `<div class="ca-page">${header}${hint}${empty(
        T('cognition.cleanup_empty', '还没有整理报告'),
        T('cognition.cleanup_empty_hint', '发起一次大扫除：整理完会产出一份逐项清单，改了哪几条、为什么、怎么回滚都在上面。'),
      )}</div>`;
    }

    const KIND_LABELS = {
      title_normalized: T('cognition.cleanup_kind_title_normalized', '标题规范化'),
      merged_duplicate: T('cognition.cleanup_kind_merged_duplicate', '重复归并'),
    };
    const STATUS_LABELS = {
      applied: T('cognition.cleanup_status_applied', '已执行'),
      failed: T('cognition.cleanup_status_failed', '失败'),
      uncertain: T('cognition.cleanup_status_uncertain', '拿不准'),
      skipped: T('cognition.cleanup_status_skipped', '已跳过'),
    };
    const items = Array.isArray(report.items) ? report.items : [];
    const uncertain = Array.isArray(report.uncertain) ? report.uncertain : [];
    const appliedCount = items.filter((item) => item.status === 'applied').length;
    // 认不出的枚举一律走人话兜底，**不裸出机器码**（本模块的既有约定，
    // 有守护测试盯着）；资产名从快照解析，解析不到也给一句话，不裸出内部 id。
    const unknownLabel = (table, key, fallback) => table[key] || fallback;
    const assetTitle = (assetId) => {
      const found = (Array.isArray(S.assets) ? S.assets : []).find((row) => String(row.id) === String(assetId));
      return found && found.title ? String(found.title) : T('cognition.cleanup_item_asset', '这条资产');
    };
    const reportRows = reports.map((row) => `<div class="row is-flat is-clickable ${String(row.id) === String(report.id) ? 'is-selected' : ''}" data-act="open-cleanup-report" data-report="${esc(String(row.id))}" ${roleBtn()}>
      <div class="tw"><div class="tt">${esc(fmtDate(row.createdAt))}</div><div class="mm">${esc(T('cognition.cleanup_row_summary', '执行 {applied} 项 · 拿不准 {uncertain} 项', {
        applied: String((row.items || []).filter((item) => item.status === 'applied').length),
        uncertain: String((row.uncertain || []).length),
      }))}</div></div>
      <div class="sd">${row.interrupted ? window.uiTag({ label: T('cognition.cleanup_status_interrupted', '中断过'), variant: 'outline' }) : ''}</div>
    </div>`).join('');
    const itemRows = items.length ? items.map((item) => `<div class="row is-flat">
      <div class="tw">
        <div class="tt">${esc(unknownLabel(KIND_LABELS, item.kind, T('cognition.cleanup_kind_unknown', '整理动作')))} · <a href="#" data-go-asset="${esc(String(item.assetId))}">${esc(assetTitle(item.assetId))}</a></div>
        <div class="mm">${esc(String(item.before || '—'))} → ${esc(String(item.after || '—'))}</div>
        <div class="mm">${esc(String(item.reason || ''))}${item.note ? ` · ${esc(String(item.note))}` : ''}</div>
      </div>
      <div class="sd">
        ${window.uiTag({ label: unknownLabel(STATUS_LABELS, item.status, T('cognition.cleanup_status_unknown', '状态未知')), variant: item.status === 'applied' ? 'success' : 'outline' })}
        ${item.status === 'applied' && item.rollbackAnchor ? btn(T('cognition.cleanup_rollback', '回滚这一项'), 'rollback-cleanup-item', {
          small: true,
          data: { id: String(item.assetId), version: String(item.rollbackAnchor) },
        }) : ''}
      </div>
    </div>`).join('') : `<p class="note">${esc(T('cognition.cleanup_no_items', '这一轮没有需要改动的地方。'))}</p>`;
    const uncertainRows = uncertain.map((entry) => `<div class="row is-flat">
      <div class="tw">
        <div class="tt">${esc(String(entry.title || assetTitle(entry.assetId)))}</div>
        <div class="mm">${esc(String(entry.question || ''))}</div>
        <div class="mm">${esc(String(entry.reason || ''))}</div>
      </div>
      <div class="sd">${entry.decision
        ? window.uiTag({
          label: entry.decision === 'dismissed' ? T('cognition.cleanup_decided_dismissed', '已标记不管') : T('cognition.cleanup_decided_deferred', '已放到回头再看'),
          variant: 'outline',
        })
        : `${btn(T('cognition.cleanup_dismiss', '不管它'), 'cleanup-uncertain-dismiss', { small: true, data: { id: String(entry.assetId), report: String(report.id) } })}${btn(T('cognition.cleanup_defer', '回头再看'), 'cleanup-uncertain-defer', { small: true, data: { id: String(entry.assetId), report: String(report.id) } })}`}
      </div>
    </div>`).join('');
    return `<div class="ca-page">${header}${hint}
      ${report.interrupted ? `<div class="sect-block"><p class="note">${esc(T('cognition.cleanup_interrupted', '这轮中断过：已执行项仍然有效、可逐项回滚；未执行的保持原状。'))}</p></div>` : ''}
      <div class="sect-block"><div class="tt">${esc(T('cognition.cleanup_summary', '扫描 {scanned} 条 · 执行 {applied} 项 · 拿不准 {uncertain} 项', {
        scanned: String(report.scanned || 0), applied: String(appliedCount), uncertain: String(uncertain.length),
      }))}</div>
      ${Array.isArray(report.skippedSteps) && report.skippedSteps.length
        ? `<p class="note">${esc(T('cognition.cleanup_skipped', '本轮跳过：{steps}', { steps: report.skippedSteps.join('；') }))}</p>`
        : ''}</div>
      <div class="sect-block"><div class="tt">${esc(T('cognition.cleanup_items', '逐项改动'))}</div>${itemRows}</div>
      ${uncertain.length ? `<div class="sect-block"><div class="tt">${esc(T('cognition.cleanup_uncertain_section', '拿不准的（未改动）'))}</div>${uncertainRows}</div>` : ''}
      ${reports.length > 1 ? `<div class="sect-block"><div class="tt">${esc(T('cognition.cleanup_reports', '历史报告'))}</div>${reportRows}</div>` : ''}
      
    </div>`;
  }

  function viewOrganizeTasks(route) {
    const vocab = NS.vocabulary;

    // 只取会话级项：同组里还有 subtype:message 的消息级溯源项（id=msg- 哈希、
    // 无会话标题，供证据 chip 解析），混进任务流会显示成裸哈希行且不属于任何
    // 筛选桶（2026-09-16 真机抓出；后端 limit 不足时用它补位）。排除法保兼容。
    const conversationItems = S.sources
      .filter((g) => String(g.kind || '') === 'conversation' || (g.items || []).some((i) => i.kind === 'conversation'))
      .flatMap((g) => (Array.isArray(g.items) ? g.items : []))
      .filter((item) => String(item.subtype || '') !== 'message');
    // 任务关联（含 silent：无留存内容的记录也如实显示）：每会话取最相关一条。
    const CLASS_ORDER = { active: 0, attention: 1, done: 2, silent: 3 };
    const captureByConv = new Map();
    for (const capture of (Array.isArray(S.captures) ? S.captures : [])) {
      const prev = captureByConv.get(capture.conversationId);
      const rank = (row) => (CLASS_ORDER[row.bucket] !== undefined ? CLASS_ORDER[row.bucket] : 9);
      if (!prev
        || rank(capture) < rank(prev)
        || (rank(capture) === rank(prev) && String(capture.updatedAt || '') > String(prev.updatedAt || ''))) {
        captureByConv.set(capture.conversationId, capture);
      }
    }
    const bucketOf = (capture) => (capture.bucket || (
      // 兜底口径与后端对齐（2026-09-15）：no_candidate 对用户就是"已完成"，
      // 行上显示的正是「已完成」——不能让它只出现在「全部」里。
      capture.status === 'no_candidate' ? 'done'
        : ['failed', 'configuration_required', 'review_ready', 'paused', 'waiting_manual'].includes(capture.status) ? 'attention'
          : ['completed', 'cancelled'].includes(capture.status) ? 'done' : 'active'));
    /** 真·整理中：排队/提炼/写入（通常几十秒）。等待类（等你手动开始/静默期/
     *  夜间窗口）不算——2026-09-15 修正：waiting_manual 曾被显示成「整理中」，
     *  但它的动作是「立即整理」，列表与详情自相矛盾。 */
    const isRunning = (capture) => ['queued', 'extracting', 'writing'].includes(String(capture.status));

    let rows = conversationItems.map((conv) => ({ conv, capture: captureByConv.get(conv.id) || null }));
    // 低价值归类（2026-09-16「无需沉淀」分类，子安口径）：寒暄命中即归类
    //（无视任务——整理过的寒暄如「hi」也从「已完成」移入）；回复失败仅对
    // 无任务行（失败会话被整理过=用户已主动处理过）。取代旧的 messageCount
    // 前端隐藏过滤——判定信号由后端出，前端不猜，宁漏勿误伤。
    const isExcludedRow = (row) => Boolean(row.conv.chatLike || (!row.capture && row.conv.lastTurnFailed));
    // 真正跑着的（queued/extracting/writing）恒在最顶，其余按会话最近活动。
    rows.sort((left, right) => {
      const leftActive = left.capture && isRunning(left.capture) ? 1 : 0;
      const rightActive = right.capture && isRunning(right.capture) ? 1 : 0;
      if (leftActive !== rightActive) return rightActive - leftActive;
      return String(right.conv.updatedAt || right.conv.createdAt || '')
        .localeCompare(String(left.conv.updatedAt || left.conv.createdAt || ''));
    });
    const normalRows = rows.filter((row) => !isExcludedRow(row));
    const excludedRows = rows.filter(isExcludedRow);
    // 「全部」含低价值行（2026-09-16 子安口径）：默认视图展示所有会话，低
    // 价值行带标注；任务三桶只数正常行（寒暄任务行已移入无需沉淀）。
    const filtered = route.captureBucket === 'excluded' ? excludedRows
      : route.captureBucket
        ? normalRows.filter((row) => row.capture && bucketOf(row.capture) === route.captureBucket)
        : rows;
    // chip 计数与列表行同口径（2026-09-16 修复）：列表每会话只显示最相关
    // 一条任务，同一会话的多次整理（重试/夜间多轮）会让后端 buckets 的记录
    // 数大于列表行数——chip 必须数 rows，点开筛选看到的行数才和数字对得上。
    const rowBucketCounts = { attention: 0, active: 0, silent: 0, done: 0 };
    for (const row of normalRows) if (row.capture) rowBucketCounts[bucketOf(row.capture)] += 1;
    // 批量入口口径：只作用于「当前已加载且该动作在 actions 里」的行——立即
    // 整理每条都是一次模型额度消耗，绝不按后端计数隐式扩大范围。
    const retryableIds = (Array.isArray(S.captures) ? S.captures : []).filter((capture) => (capture.actions || []).includes('retry'));

    const listLimit = S.organizeListExpanded ? filtered.length : Math.min(5, filtered.length);
    const visibleRows = filtered.slice(0, listLimit);

    const rowHtml = (row) => {
      const { conv, capture } = row;
      const convTime = fmtDate(conv.updatedAt || conv.createdAt);
      const excluded = isExcludedRow(row);
      // 低价值行的原因 chip（2026-09-16）：寒暄/失败分别注明。
      const excludedTag = excluded
        ? (conv.chatLike
          ? chip(T('cognition.capture_excluded_chatty', '纯寒暄'))
          : chip(T('cognition.capture_excluded_failed', '未得到回复')))
        : '';
      if (!capture) {
        // 低价值无任务行：标题可点回看会话内容，「开始整理」位置改为
        // 「无需整理」提示（2026-09-16 子安口径：内容可看，但不再给整理入口）。
        if (excluded) {
          return `
          <div class="cap-row">
            <div class="tw"><div class="tt is-link" data-act="open-conversation" data-id="${esc(conv.id)}" ${roleBtn()} title="${esc(T('cognition.capture_action_open_conversation', '打开会话'))}">${esc(conv.title || T('cognition.evidence_conversation_generic', '一段对话'))}</div>
            <div class="mm"><span>${esc(convTime)}</span></div></div>
            <div class="sd">${excludedTag}${chip(T('cognition.capture_excluded_action_hint', '无需整理'), 'amber')}</div>
          </div>`;
        }
        return `
        <div class="cap-row">
          <div class="tw"><div class="tt">${esc(conv.title || T('chat.untitled', '未命名对话'))}</div>
          <div class="mm"><span>${esc(convTime)}</span></div></div>
          <div class="sd">${btn(T('cognition.capture_manual_history_create', '开始整理'), 'organize-conv', { id: conv.id, small: true, className: 'g' })}</div>
        </div>`;
      }
      const detailLink = `data-act="open-capture-detail" data-id="${esc(capture.id)}"`;
      const titleHtml = `<div class="tt is-link" ${detailLink} ${roleBtn()} title="${esc(T('cognition.capture_detail_open_hint', '查看整理情况'))}">${esc(vocab ? vocab.recordTitle(capture) : String(capture.conversationTitle || conv.title || T('cognition.capture_untitled_record', '未命名会话的整理')))}</div>`;
      const pending = Number(capture.reviewSummary && capture.reviewSummary.pending) || 0;
      /* 事件句（specs/018 T060）：一行 = 一句人话 + 时间 + 落点。四型——
       * 整理了会话→产出候选 / 夜间沉淀跑完 / 大扫除 / 后台体检（后两类在
       * 时间流另行并入）；等待与失败类沿用原因白话（vocabulary 唯一出口）。 */
      const nightly = String(capture.executionPolicy || '') === 'nightly';
      const eventLine = isRunning(capture)
        ? T('cognition.activity_event_running', '正在整理这段会话…')
        : nightly && pending
          ? T('cognition.activity_event_nightly', '夜间沉淀跑完 → {n} 条新候选', { n: String(pending) })
          : nightly
            ? T('cognition.activity_event_nightly_empty', '夜间沉淀跑完，没有值得记下的内容')
            : pending
              ? T('cognition.activity_event_session', '整理了这段会话 → 产出 {n} 条候选', { n: String(pending) })
              : '';
      const reasonText = vocab ? vocab.captureReasonText(capture.displayReason) : T('cognition.capture_display_reason_other', '原因未记录');
      const metaText = [eventLine || reasonText, convTime].filter(Boolean).join(' · ');
      // 用 isRunning 判定「整理中」（仅排队/提炼/写入）：等待类显示原因
      // chip；等待手动开始的行直接给「立即整理」按钮（不必进详情页）。
      /* 低价值行（纯寒暄/未回复）不给「立即整理」——行上同时摆「纯寒暄」
         和「立即整理」是自相矛盾的口径（2026-09-21 子安抓出「界面混乱」）；
         与无任务的低价值行同款「无需整理」提示，点标题可回看内容。 */
      /* 落点按钮（018 T060）：产出候选 →「去处理」（go-review）；
       * 等待手动 →「立即整理」；运行中不给按钮（正在跑）。 */
      const actions = Array.isArray(capture.actions) ? capture.actions : [];
      const primaryAction = !excluded && !isRunning(capture) && actions.includes('run_now')
        ? btn(T('cognition.capture_action_run_now', '立即整理'), 'capture-action', { id: capture.id, data: { action: 'run_now' }, small: true, primary: true })
        : !excluded && !isRunning(capture) && pending && actions.includes('review_candidates')
          ? btn(vocab ? vocab.captureActionText('review_candidates') : T('cognition.capture_action_review_candidates', '去确认'), 'go-review', { small: true, primary: true })
          : excluded && !isRunning(capture)
            ? chip(T('cognition.capture_excluded_action_hint', '无需整理'), 'amber')
            : '';
      const sideHtml = isRunning(capture)
        ? btn(T('cognition.organize_active_label', '整理中'), '', { small: true, primary: true, disabled: true })
        : `${excludedTag}${chip(
          vocab ? vocab.captureDisplayStatusText(capture.displayStatus) : T('cognition.capture_display_status_other', '状态未知'),
          capture.displayStatus === 'failed' ? 'red' : (capture.displayStatus === 'review_ready' || capture.displayStatus === 'completed') ? 'green' : 'amber',
        )}${primaryAction}`;
      return `
        <div class="cap-row">
          <div class="tw">${titleHtml}<div class="mm"><span>${esc(metaText)}</span></div></div>
          <div class="sd">${sideHtml}</div>
        </div>`;
    };

    const chips = [['', T('common.all', '全部')], ['attention', null], ['active', null], ['done', null],
      ...(excludedRows.length ? [['excluded', null]] : [])]
      .map(([id, label]) => {
        const text = label || (vocab ? vocab.captureBucketText(id) : id);
        const count = id === '' ? rows.length : id === 'excluded' ? excludedRows.length : rowBucketCounts[id];
        return btn(`${text} ${count}`, 'capture-filter', {
          id,
          className: `chip${String(route.captureBucket || '') === id ? ' on' : ''}`,
        });
      }).join('');
    // 批量入口只保留「重试失败」(2026-09-21 原型 v7 定调):批量「立即整理」
    // 会诱导用户跳过逐条处理,且每次都是模型额度消耗——施工矩阵明确不迁移,
    // 单条任务行上的「立即整理」保留。

    // 页首右侧只留一个设置入口（2026-09-15 子安标注）：原型是一枚
    // 「沉淀设置」文字按钮（tbtn），我们走共享 uiButton + icons.js 的
    // settings 图标（团队规范：图标不手写 SVG）。
    /* 系统事件并入时间流（specs/018 T060）：大扫除报告与后台体检作为
     * 时间线事件呈现（一句人话 + 时间 + 落点）；仅在未选分桶筛选时出现
     * （它们不属于任何整理分桶）。发起入口在「设置」页（不重复摆卡）。 */
    const cleanupEvents = ((S.cleanupReports && Array.isArray(S.cleanupReports.reports)) ? S.cleanupReports.reports : [])
      .slice(0, 3)
      .map((report) => {
        // 0 归并是合法结果（跑了但没找到可归并的）——给空态专用句，
        // 不写「归并 0 条重复」（迭代轮 2 猎区 1）。
        const merged = (report.items || []).filter((item) => item.status === 'applied').length;
        return {
          at: String(report.createdAt || ''),
          html: `<div class="cap-row">
          <div class="tw"><div class="tt">${esc(merged
            ? T('cognition.activity_event_cleanup', '大扫除归并 {n} 条重复', { n: String(merged) })
            : T('cognition.activity_event_cleanup_empty', '大扫除跑完，没有要归并的'))}</div>
          <div class="mm"><span>${esc(fmtDate(report.createdAt))}</span></div></div>
          <div class="sd">${btn(T('cognition.activity_event_see_report', '看报告'), 'open-cleanup-report', { small: true, className: 'o', data: { report: String(report.id) } })}</div>
        </div>`,
        };
      });
    const inspectionEvents = [];
    if (S.inspection && S.inspection.latestRun) {
      const run = S.inspection.latestRun;
      const found = (run.findings || []).length;
      inspectionEvents.push({
        at: String(run.startedAt || ''),
        html: `<div class="cap-row">
          <div class="tw"><div class="tt">${esc(found
            ? T('cognition.activity_event_inspection', '后台体检发现 {n} 处疑点', { n: String(found) })
            : T('cognition.activity_event_inspection_clean', '后台体检跑完，没发现问题'))}</div>
          <div class="mm"><span>${esc(fmtDate(run.startedAt))}</span></div></div>
          <div class="sd">${btn(T('cognition.activity_event_inspection_go', '去看看'), 'go-review', { small: true, primary: found > 0 })}</div>
        </div>`,
      });
    }
    const timelineEntries = [
      ...visibleRows.map((row) => ({
        at: String(row.conv.updatedAt || row.conv.createdAt || ''),
        pinned: Boolean(row.capture && isRunning(row.capture)),
        html: rowHtml(row),
      })),
      ...(route.captureBucket ? [] : [...cleanupEvents, ...inspectionEvents]),
    ].sort((left, right) => (right.pinned ? 1 : 0) - (left.pinned ? 1 : 0)
      || String(right.at).localeCompare(String(left.at)));
    return `${heroRow(
      T('cognition.tab_activity', '系统活动'),
      T('cognition.activity_lead', '系统替你干了什么：整理会话、夜间沉淀、大扫除、后台体检——做了什么、产出了什么、去哪看，按时间倒序排在这条线上。'),
      // 大扫除入口已收进沉淀设置页（specs/017 整改三）；018 T060 起本页
      // 只保留事件时间流，发起类入口都在设置页。
      `${btn(T('cognition.organize_settings_title', '沉淀设置'), 'go-organize-settings', { className: 'o', icon: 'settings' })}`,
    )}
    ${!S.captureSettings || S.captureSettings.enabled === false ? `<div class="warn">${esc(T('cognition.capture_disabled_note', '整理功能已关闭：不再开始新的整理；已创建任务和「我的认知」资产不受影响。'))}</div>` : ''}
    ${S.captureSettings && S.captureSettings.enabled !== false && retryableIds.length ? `<div class="toolbar"><div class="toolbar-right">${retryableIds.length ? btn(T('cognition.capture_batch_retry', '重试失败（{n}）', { n: String(retryableIds.length) }), 'capture-batch', { data: { batch: 'retry' }, small: true, className: 'o' }) : ''}</div></div>` : ''}
    ${(Array.isArray(S.captures) ? S.captures : []).some((c) => bucketOf(c) === 'active') ? `<div class="note toolbar-note">${esc(T('cognition.capture_running_note', '有任务正在跑：任务完成后这一页会自动更新，不用手动刷新。'))}</div>` : ''}
    <div class="pillbox"><div class="chips">${chips}</div></div>
    ${timelineEntries.length ? timelineEntries.map((entry) => entry.html).join('') : empty(T('cognition.capture_tasks_empty', '暂无整理任务'), T('cognition.capture_tasks_empty_hint', '一轮会话结束后，系统会在静默期结束后创建整理任务。'), { label: T('cognition.organize_settings_title', '沉淀设置'), attrs: { 'data-act': 'go-organize-settings' } })}
    ${conversationItems.length >= 100 ? `<div class="note">${esc(T('cognition.capture_sources_truncated', '仅显示最近 100 个会话（来源拉取上限）'))}</div>` : ''}
    ${filtered.length > 5 ? `<div class="list-more">${btn(S.organizeListExpanded
      ? T('cognition.capture_list_collapse', '收起')
      : T('cognition.capture_list_expand', '查看全部 {n} 个会话', { n: String(filtered.length) }), 'toggle-organize-list', { small: true, className: 'o' })}</div>` : ''}
    <div class="note footnote">${esc(T('cognition.capture_bucket_scope_note', '口径说明：分桶按每个会话最相关的一次整理任务计算；「需要我处理」包括待确认与被暂停的记录，比「待我处理」页只数失败的口径宽；「无需沉淀」是寒暄会话或最近一轮失败且无任务的会话。'))}</div>
    ${improvementAnalysisSection(route)}`;
  }

  /* 整理详情（2026-09-15 新增）：一条整理任务的完整执行情况——状态与当前
   * 步骤、时间与模型用量、候选产出与已沉淀资产；动作与整理记录行同一套
   * 语义（captureActionButtons），标题可回来源会话。 */
  /* 整理结果区（2026-09-15 详情页改造）：三态——有候选（结构化卡 + 证据
   *  映射到时间线消息）/ 进行中 / 无候选（模型理由 + 筛选原因白话）。 */
  const CAPTURE_CANDIDATE_STATUS = {
    pending_review: ['cognition.capture_detail_candidate_pending', '待确认'],
    deferred: ['cognition.capture_detail_candidate_pending', '待确认'],
    confirmed: ['cognition.capture_detail_candidate_confirmed', '已保存'],
    rejected: ['cognition.capture_detail_candidate_rejected', '未保存'],
    ignored: ['cognition.capture_detail_candidate_ignored', '已忽略'],
  };
  function captureCandidateStatus(status) {
    const hit = CAPTURE_CANDIDATE_STATUS[String(status || '')];
    const label = hit ? T(hit[0], hit[1]) : T('cognition.capture_detail_candidate_other', '已处理');
    const tone = status === 'confirmed' ? 'green'
      : (status === 'rejected' || status === 'ignored') ? 'line'
        : status === 'pending_review' || status === 'deferred' ? 'amber' : '';
    return { label, tone };
  }

  function captureResultSection(capture, messageBySourceId) {
    const vocab = NS.vocabulary;
    const candidates = (Array.isArray(capture.candidateIds) ? capture.candidateIds : [])
      .map((id) => (Array.isArray(S.candidates) ? S.candidates : []).find((row) => String(row.id) === String(id)))
      .filter(Boolean);
    const running = ['queued', 'extracting', 'writing', 'waiting_quiet', 'waiting_completion', 'waiting_manual', 'scheduled'].includes(String(capture.status));
    // 三分呈现（2026-09-15 子安口径）：
    //  - 待确认候选 → 下方表单区（可编辑），结果区只给一行指引；
    //  - 已保存候选 → 成果在「已沉淀资产」区（含完整 statement），结果区不重复；
    //  - 未保存候选（拒绝/忽略/过期）→ 结果区展示**完整内容块**（判断全文 +
    //    类型/作用域 + 证据映射 + 未保存标记）——"不保存之后也要看得到
    //    当时整理出的具体内容"，不再只剩一行截断标题。
    const pendingEditable = candidates.filter((candidate) => candidatePending(candidate)
      && candidate.capabilities && candidate.capabilities.canEdit);
    const rejectedCandidates = candidates.filter((candidate) => !pendingEditable.includes(candidate)
      && candidate.status !== 'confirmed');
    const savedCount = candidates.length - pendingEditable.length - rejectedCandidates.length;
    let body = '';
    if (candidates.length) {
      const cardHtml = rejectedCandidates.map((candidate) => {
        const { label, tone } = captureCandidateStatus(candidate.status);
        const scope = String(candidate.suggestedScope || '').trim();
        const evidenceBits = (candidate.evidenceRefs || candidate.sourceRefs || []).map((ref) => {
          const message = messageBySourceId.get(String(ref.id || ''));
          return message
            ? `<span class="tag gray">${esc(T('cognition.capture_detail_evidence_from', '来自消息 {label} · {when}', { label: message.label, when: fmtDate(message.ts) }))}</span>`
            : evidenceChip(ref);
        }).slice(0, 6).join(' ');
        return `<div class="ca-result-item">
          <div class="ca-result-head">
            ${chip(categoryLabel(candidate.suggestedType))}
            ${scope ? `<span class="note">${esc(scope)}</span>` : ''}
            <span class="right">${chip(label, tone)}</span>
          </div>
          <p class="content-text">${esc(String(candidate.judgment || '').trim() || candidateTitle(candidate))}</p>
          ${evidenceBits ? `<div class="chips">${evidenceBits}</div>` : ''}
        </div>`;
      }).join('');
      body = `${pendingEditable.length
        ? `<div class="note">${esc(T('cognition.capture_detail_pending_hint', '发现 {n} 条待确认内容，在下方卡片中查看和确认。', { n: String(pendingEditable.length) }))}</div>`
        : ''}${cardHtml}${savedCount && !pendingEditable.length && !rejectedCandidates.length
        ? `<div class="note">${esc(T('cognition.capture_detail_saved_hint', '这次整理的内容已保存为资产（见下方「已沉淀资产」）。'))}</div>`
        : ''}`;
    } else if (running) {
      body = `<div class="note">${esc(T('cognition.capture_detail_result_pending', '整理还在进行，完成后这里会列出从这段对话发现的内容。'))}</div>`;
    } else {
      const modelReason = String(capture.noCandidateReason || '').trim();
      const filterText = vocab && capture.filterReason ? vocab.captureFilterReasonText(capture.filterReason) : '';
      body = `
      ${empty(T('cognition.capture_detail_result_none_title', '没有发现值得留存的内容'))}
      ${filterText ? `<div class="note">${esc(T('cognition.capture_detail_filter_label', '筛选原因'))}：${esc(filterText)}</div>` : ''}
      ${modelReason ? `<blockquote class="ca-quote">${esc(modelReason)}</blockquote>` : ''}`;
    }
    return `<div class="card ca-result-card">${sectionHead(T('cognition.capture_detail_result_title', '整理结果'))}${body}</div>`;
  }

  /* 对话上下文区：参与角色 + 消息时间线（展示口径 = 本次整理实际读到的消息，
   *  与模型看到的一致）；价值信号 chips 说明「为什么是这段」。 */
  function captureConversationSection(capture, context) {
    const vocab = NS.vocabulary;
    const signals = (Array.isArray(capture.screeningSignals) ? capture.screeningSignals : [])
      .filter((signal) => signal !== 'manual_selection');
    const signalChips = signals.length
      ? `<span class="chips">${signals.map((signal) => chip(vocab ? vocab.captureSignalText(signal) : T('cognition.capture_signal_other', '其他信号'), 'line')).join(' ')}</span>`
      : '';
    if (!context || context.loading) {
      const hint = context && context.loading
        ? T('cognition.capture_detail_context_loading', '正在读取对话上下文…')
        : T('cognition.capture_detail_context_unavailable', '消息内容不可用（会话可能已被清理或迁移）。');
      return `<div class="card">${sectionHead(T('cognition.capture_detail_context_title', '对话上下文'), '', signalChips)}<div class="note">${esc(hint)}</div></div>`;
    }
    const nameById = new Map((context.participants || []).map((p) => [String(p.id), p]));
    const actorName = (actorId) => {
      if (actorId === 'user') return T('cognition.capture_detail_you', '你');
      if (actorId === 'commander') return T('cognition.capture_detail_commander', '指挥官');
      const participant = nameById.get(String(actorId));
      return participant ? participant.name : T('cognition.capture_detail_actor_unknown', '未知参与者');
    };
    const rows = (context.messages || []).map((message) => {
      const text = String(message.text || '');
      const oneLine = text.replace(/\s+/g, ' ').trim();
      const isShort = text.length <= 200 && !text.includes('\n');
      const bodyHtml = isShort
        ? `<div class="ca-tl-text">${esc(text)}</div>`
        : `<details class="ca-tl-body"><summary>${esc(oneLine.slice(0, 140))}${oneLine.length > 140 ? '…' : ''}</summary><div class="ca-tl-text">${esc(text)}</div></details>`;
      const artifacts = (message.artifacts || []);
      return `
      <div class="ca-tl-row is-${message.role === 'user' ? 'user' : 'assistant'}">
        <span class="ca-tl-dot" aria-hidden="true"></span>
        <div class="ca-tl-main">
          <div class="ca-tl-head"><b>${esc(actorName(message.from))}</b><span class="note">${esc(message.label)} · ${esc(fmtDate(message.ts))}</span></div>
          ${bodyHtml}
          ${message.truncated ? `<div class="note">${esc(T('cognition.capture_detail_msg_truncated', '内容过长，已截断'))}</div>` : ''}
          ${artifacts.length ? `<div class="chips">${artifacts.map((artifact) => chip(artifact.title || artifact.id, 'line')).join(' ')}</div>` : ''}
        </div>
      </div>`;
    }).join('');
    const participantsHtml = (context.participants || []).length
      ? `<div class="chips ca-participants">${(context.participants || []).map((p) => chip(actorName(p.id), p.kind === 'user' ? 'green' : '')).join(' ')}</div>`
      : '';
    return `<div class="card">
      ${sectionHead(T('cognition.capture_detail_context_title', '对话上下文'), '', signalChips)}
      ${participantsHtml ? `${sectionHead(T('cognition.capture_detail_participants_title', '参与角色'))}${participantsHtml}` : ''}
      ${sectionHead(T('cognition.capture_detail_messages_title', '消息时间线'))}
      <div class="ca-tl">${rows}</div>
    </div>`;
  }

  /** 整理过程五步进度条：stage 驱动（extracting 期间 4s 轮询自推进），
   *  当前步高亮、已过步打勾感（is-done）；非提炼期不显示（结果区已终态）。 */
  const CAPTURE_STAGE_ORDER = ['model_check', 'recall_view', 'model_extraction', 'candidate_save', 'asset_write'];
  function captureStageStepper(stage) {
    if (!stage) return '';
    const vocab = NS.vocabulary;
    const currentAt = CAPTURE_STAGE_ORDER.indexOf(String(stage));
    if (currentAt < 0) return '';
    return `<div class="ca-steps-bar" role="progressbar" aria-label="${esc(T('cognition.capture_detail_stage', '当前步骤'))}">
      ${CAPTURE_STAGE_ORDER.map((id, index) => `<span class="ca-step${index === currentAt ? ' is-current' : ''}${index < currentAt ? ' is-done' : ''}">${esc(vocab ? vocab.captureStageText(id) : id)}</span>`).join('<i class="ca-step-arrow" aria-hidden="true">→</i>')}
    </div>`;
  }

  function viewCaptureDetail(route) {
    const vocab = NS.vocabulary;
    const backHtml = btn(`← ${T('common.back', '返回')}`, 'go-back', { className: 'backlink' });
    const capture = (Array.isArray(S.captures) ? S.captures : [])
      .find((row) => String(row.id) === String(route.captureId));
    if (!capture) {
      return `${backHtml}${empty(T('cognition.capture_detail_missing', '这条整理任务不存在或已被清理'), '')}`;
    }
    // 上下文缓存命中当前任务才用（防串页）；sourceId 索引供证据映射。
    const contextHit = S.captureContext
      && String(S.captureContext.captureId) === String(route.captureId)
      ? S.captureContext : null;
    const context = contextHit ? contextHit.data : null;
    const messageBySourceId = new Map(
      ((context && context.messages) || []).map((message) => [String(message.sourceId), message]),
    );
    // 待确认候选的编辑表单块（2026-09-15 子安标注：与执行信息卡合并为一张
    // 卡，在时间/用量/动作之下显示）。外层带 ca-candidate-detail 标识但不带
    // card——cand-type 与 readCandidateForm 靠 closest 就近定位，多候选时
    // 各块互不串值。
    const pendingFormBlocks = (Array.isArray(capture.candidateIds) ? capture.candidateIds : [])
      .map((id) => (Array.isArray(S.candidates) ? S.candidates : []).find((row) => String(row.id) === String(id)))
      .filter((row) => row && candidatePending(row) && row.capabilities && row.capabilities.canEdit)
      .map((candidate) => `<div class="ca-candidate-detail ca-pending-block" data-cand-id="${esc(candidate.id)}" data-cand-type="${esc(candidate.suggestedType || '')}">${candidateFormBody(candidate)}</div>`)
      .join('');
    const summary = capture.reviewSummary || {};
    /** 卡头元信息项：浅色标签 + 墨色值，流式排（空值不占位）。 */
    const metaItem = (label, value) => (value
      ? `<span class="meta-item"><i>${esc(label)}</i>${esc(value)}</span>`
      : '');
    const totalSec = Number(capture.durationMs) > 0 ? Math.round(Number(capture.durationMs) / 1000) : 0;
    const durationText = totalSec > 0
      ? (totalSec < 60
        ? T('cognition.capture_duration_sec', '{n} 秒', { n: String(totalSec) })
        : T('cognition.capture_duration_min', '{n} 分 {s} 秒', { n: String(Math.floor(totalSec / 60)), s: String(totalSec % 60) }))
      : '';
    const tokens = Number(capture.modelUsage && capture.modelUsage.totalTokens) || 0;
    const statusTone = capture.displayStatus === 'failed' ? 'red'
      : (capture.displayStatus === 'completed' || capture.displayStatus === 'review_ready') ? 'green' : 'amber';
    const receipts = Array.isArray(capture.confirmedAssetReceipts) ? capture.confirmedAssetReceipts : [];
    // 卡头状态三态（2026-09-15 子安口径）：已完成 · 已保存（有沉淀资产）/
    // 已完成 · 未保存（候选被拒且无资产）/ 原状态文案。文案复用候选状态键。
    const settledRows = (Array.isArray(capture.candidateIds) ? capture.candidateIds : [])
      .map((id) => (Array.isArray(S.candidates) ? S.candidates : []).find((row) => String(row.id) === String(id)))
      .filter(Boolean);
    const hasSaved = receipts.length > 0 || (Number(summary.promoted) || 0) > 0;
    const hasUnsaved = !hasSaved && settledRows.some((row) => ['rejected', 'ignored', 'expired'].includes(String(row.status)));
    const statusLabel = vocab
      ? vocab.captureDisplayStatusText(capture.displayStatus)
      : T('cognition.capture_display_status_other', '状态未知');
    const headStatus = capture.displayStatus === 'completed'
      ? (hasSaved
        ? { label: `${statusLabel} · ${T('cognition.capture_detail_candidate_confirmed', '已保存')}`, tone: 'green' }
        : hasUnsaved
          ? { label: `${statusLabel} · ${T('cognition.capture_detail_candidate_rejected', '未保存')}`, tone: 'amber' }
          : { label: statusLabel, tone: statusTone })
      : { label: statusLabel, tone: statusTone };
    // 已沉淀资产（2026-09-15 合并卡 + 内联内容）：直接展示沉淀的正文
    //（statement 取自 S.assets 快照，零后端改动），「查看资产」降为项内次级
    // 入口；快照缺该资产（已删除等）时退回「类型 · 版本」，不裸出内部 id。
    const depositBlocks = receipts.map((receipt) => {
      const asset = (Array.isArray(S.assets) ? S.assets : [])
        .find((row) => String(row.id) === String(receipt.assetId));
      const title = asset && asset.title
        ? String(asset.title)
        : `${categoryLabel(receipt.assetType)} · v${String(receipt.version || '1')}`;
      const statement = String((asset && asset.statement) || '').trim();
      return `<div class="ca-deposit-item">
        <div class="ca-deposit-head">${chip(categoryLabel(receipt.assetType))}<b>${esc(title)}</b></div>
        ${statement ? `<p class="content-text">${esc(statement)}</p>` : ''}
        <div class="ca-deposit-foot"><span class="note">v${esc(String(receipt.version || '1'))}</span>${btn(T('cognition.capture_action_view_assets', '查看资产'), 'open-asset', { id: receipt.assetId, small: true })}</div>
      </div>`;
    }).join('');
    return `${backHtml}
    ${hero(
      vocab ? vocab.recordTitle(capture) : String(capture.conversationTitle || T('cognition.capture_untitled_record', '未命名会话的整理')),
      vocab ? vocab.captureReasonText(capture.displayReason) : T('cognition.capture_display_reason_other', '原因未记录'),
      statsRow([
        [Number(summary.pending) || 0, T('cognition.capture_metric_review', '待确认')],
        [Number(summary.promoted) || 0, T('cognition.capture_detail_assets', '已沉淀资产')],
        [Number(capture.attempt) || 1, T('cognition.capture_detail_attempt', '尝试次数')],
      ]),
    )}
    ${captureResultSection(capture, messageBySourceId)}
    ${captureConversationSection(capture, contextHit ? (contextHit.loading ? { loading: true } : context) : null)}
    <div class="card ca-capture-panel">
      <div class="ca-capture-head">
        ${chip(headStatus.label, headStatus.tone)}
        <div class="meta-row">
          ${metaItem(T('cognition.capture_detail_created', '创建于'), fmtDate(capture.createdAt))}
          ${metaItem(T('cognition.capture_detail_started', '开始时间'), fmtDate(capture.startedAt))}
          ${metaItem(T('cognition.capture_detail_finished', '结束时间'), fmtDate(capture.finishedAt))}
          ${metaItem(T('cognition.capture_detail_duration', '耗时'), durationText)}
          ${metaItem(T('cognition.capture_detail_tokens', '模型用量'), tokens ? `${tokens} tokens` : '')}
        </div>
        <div class="ca-head-actions">
          ${captureActionButtons({ ...capture, actions: (capture.actions || []).filter((action) => action !== 'review_candidates' && action !== 'view_assets') })}
          ${btn(T('cognition.capture_action_open_conversation', '打开会话'), 'open-conversation', { id: capture.conversationId || '', small: true })}
        </div>
      </div>
      ${captureStageStepper(capture.stage)}
      ${pendingFormBlocks ? `<div class="ca-pending-embed">${pendingFormBlocks}</div>` : ''}
      ${depositBlocks ? `<div class="ca-deposit">${sectionHead(T('cognition.capture_detail_assets', '已沉淀资产'))}${depositBlocks}</div>` : ''}
    </div>`;
  }

  /* ────────────────────────── 渲染入口 ────────────────────────── */

  /** 上一帧的路由指纹与本页滚动位置：同页重画（操作后刷新 / 4s 轮询）保持
   *  滚动位置（此前每次重画都弹回顶部——长列表里 4 秒一跳）；切换页面由
   *  router.go 归零，这里不恢复。 */
  let lastRenderKey = '';
  let treeSettlePass = 0;
  function routeKey(route) {
    return [route.name, route.assetId, route.candidateId, route.captureId, route.category, route.captureBucket, route.experienceId].join('|');
  }

  function render(opts) {
    const options = opts || {};
    const root = document.getElementById('ca-root');
    if (!root) return;
    let route = S.route;
    // 旧深链归一化（specs/018；experiences/kstar 档为 specs/017）：router.go 已在
    // 入栈前归一，这里兜住直接写 store 的路径（持久化恢复/测试装配）。只归一
    // 渲染视角、不回写 store。
    if (route.name === 'organize') route = Object.assign({}, route, { name: 'activity' });
    else if (route.name === 'organize-settings') route = Object.assign({}, route, { name: 'settings' });
    else if (route.name === 'experiences') route = Object.assign({}, route, { name: 'overview', category: route.category || 'experiences' });
    if (route.category === 'kstar') route = Object.assign({}, route, { category: '' });
    const key = routeKey(route);
    const previousScroll = document.getElementById('ca-scroll');
    const restoreScroll = lastRenderKey === key && previousScroll ? previousScroll.scrollTop : 0;
    lastRenderKey = key;
    // 候选详情归「待我处理」、整理详情与大扫除报告归「系统活动」；
    // interactive-tour 靠 data-cognition-page-link="assets"/"captures" 定位 tab。
    // 五页签（specs/018）：review / overview（含树·目录投影与经验档）/ ontology /
    // activity（captureId、cleanup 报告深链归并）/ settings；overview 默认兜底。
    const activeTab = route.name === 'review' || route.candidateId ? 'review'
      : route.name === 'activity' || route.name === 'cleanup' || route.captureId ? 'activity'
        : route.name === 'settings' ? 'settings'
          : route.name === 'ontology' ? 'ontology'
            : route.name === 'tree' ? 'tree' : 'overview';
    const pendingCount = Number(NS.stats().pending || 0);
    const tabsInner = NS.TABS.map((tab) => {
      const active = activeTab === tab.id;
      const extra = tab.id === 'overview' ? ' data-cognition-page-link="assets"' : (tab.id === 'activity' ? ' data-cognition-page-link="captures"' : '');
      // 2026-09-15 子安要求：tab 只留标题，描述小字与 title 悬浮注释删除。
      // 待确认计数走原型 .bdg 角标（原型只在「待我处理」上挂）。
      const badge = tab.id === 'review' && pendingCount ? `<span class="bdg">${pendingCount}</span>` : '';
      return `<div class="ca-tab${active ? ' is-on' : ''}" data-act="tab" data-id="${tab.id}"${extra} ${roleBtn()}>
        <strong>${esc(T(tab.titleKey, tab.title))}</strong>${badge}
      </div>`;
    }).join('');
    let body = '';
    if (S.loading && !S.loaded) {
      // 首载骨架：结构化的三行占位（shimmer 由 CSS 驱动），比纯文字更快有页面感。
      body = `<div class="ca-loading"><div class="ca-skel-row"></div><div class="ca-skel-row"></div><div class="ca-skel-row"></div></div>`;
    } else if (route.name === 'ontology') body = viewOntology(route);
    else if (route.name === 'review') body = viewReview(route);
    else if (route.name === 'activity') body = route.captureId ? viewCaptureDetail(route) : viewOrganizeTasks(route);
    else if (route.name === 'cleanup') body = viewCleanup(route);
    else if (route.name === 'settings') body = viewOrganizeSettingsPage();
    else if (route.name === 'tree') body = viewTree(route);
    else body = viewOverview(route);
    const errorBanner = S.errors.length && S.loaded
      ? `<div class="ca-banner">${esc(T('cognition.partial_load', '部分数据读取失败，页面已用可用数据渲染。'))}${btn(T('common.retry', '重试'), 'refresh', { small: true })}</div>`
      : '';
    // 离开本体路由，或在本体路由上重渲染（轮询/数据刷新触发的 notify）：
    // 都要先把 section 归还 parking——内容区即将整体替换，若不先移走，
    // 本体 DOM 会连同内部状态一起被 innerHTML 销毁，页面从此白一片
    // （Phase 3 挂载契约；2026-09-21 补「本路由重渲染」这半边）。
    if (typeof NS.unmountPersonalOntology === 'function'
      && (S.prevRouteName === 'ontology' || route.name === 'ontology')) {
      const mountedSection = document.getElementById('skills-cognition-personal-ontology');
      if (mountedSection && route.name !== 'ontology') NS.unmountPersonalOntology();
      if (mountedSection && route.name === 'ontology') {
        // 本体路由自身重渲染：mount 点将被重建，先把区段挪出内容区，
        // 随后本渲染尾部的 mountPersonalOntology 会再次移入。
        const mountEl = document.getElementById('ca-ontology-mount');
        if (mountEl && mountedSection.parentElement === mountEl) NS.unmountPersonalOntology();
      }
    }
    S.prevRouteName = route.name;
    // 持久页面壳（2026-09-21 五页签迁移）：ca-app 结构只建一次，此后每次
    // 渲染只更新页签态、横幅与内容区——壳不重建，事件委托与 tab 焦点稳定，
    // 本体挂载节点也不会被无谓地拔掉。语言切换等需要换壳文案时传 rebuild。
    // 壳节点用 id 取：测试沙箱只实现字符串级 innerHTML（getElementById 恒
    // null）时自然退回整串写入，两边行为一致。
    const tabsNav = document.getElementById('ca-tabs-nav');
    const bannerSlot = document.getElementById('ca-banner-slot');
    const main = document.getElementById('ca-scroll');
    // 树页/本体页是「整页高度」型：滚动容器不收滚动、改由页面自己占满
    //（原型 .tree-stage/.onto-page 都是整屏高度，不随内容滚）。
    const stageScroll = route.name === 'tree' || route.name === 'ontology';
    // 列表页/详情页统一收进原型 .wrap（居中 780px 阅读栏）——整屏铺满的
    // 列表行在宽窗里读起来很散，原型就是按阅读栏做的。
    if (!stageScroll) body = `<div class="wrap">${body}</div>`;
    // 标签弹层槽位（specs/012 T012「更多」/T013 管理）：放在持久壳层（不随
    // 内容区 innerHTML 重渲染被拔掉），内容由 render 按 route.tagOverlay 维护；
    // 接线（焦点圈/Escape/滚动锁）在 core.wireTagOverlay，由 app.js 渲染后调用。
    const tagOverlaySlotHtml = tagOverlayHtml(route);
    if (options.rebuild || !tabsNav || !bannerSlot || !main) {
      root.innerHTML = `
        <div class="ca-app">
          <nav class="ca-tabs" id="ca-tabs-nav">${tabsInner}</nav>
          <div class="ca-banner-slot" id="ca-banner-slot">${errorBanner}</div>
          <div class="ca-tag-overlay-slot" id="ca-tag-overlay-slot">${tagOverlaySlotHtml}</div>
          <div class="ca-scroll${stageScroll ? ' is-stage' : ''}" id="ca-scroll">${body}</div>
        </div>`;
    } else {
      tabsNav.innerHTML = tabsInner;
      bannerSlot.innerHTML = errorBanner;
      // 测试沙箱的 getElementById 返回裸对象（只有 innerHTML，没有 classList）：
      // 取不到就跳过切类，与上面的「退回整串写入」同一条守则。
      if (main.classList) main.classList.toggle('is-stage', stageScroll);
      main.innerHTML = body;
      // 弹层只在内容变化时重写（字符串比对），保住打开中的 overlay 节点与焦点。
      // slot !== root 是测试沙箱防呆：简化夹具的 getElementById 对任何 id 都返回
      // 根节点，真机槽位是根的子孙、永不相等——不相等才允许写。
      const slot = document.getElementById('ca-tag-overlay-slot');
      if (slot && slot !== root && slot.innerHTML !== tagOverlaySlotHtml) slot.innerHTML = tagOverlaySlotHtml;
    }
    const scrollRoot = main || document.getElementById('ca-scroll');
    if (scrollRoot && restoreScroll) scrollRoot.scrollTop = restoreScroll;
    // 树的出图尺寸按容器实测像素定（见 treeViewport）：首帧容器里还没有
    // svg，只知占位尺寸；挂载后量真值，不一致就重画一次收敛（最多两跳，
    // 防抖动循环）。横幅出现/消失改变内容区高度时也靠这一步跟上。
    if (route.name === 'tree' && treeSettlePass < 2 && typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => {
        const svg = document.getElementById('ca-tree-svg');
        if (!svg || !svg.clientWidth) return;
        const [w, h] = String(svg.getAttribute('viewBox') || '').split(/\s+/).slice(2).map(Number);
        if (w && h && (Math.abs(w - svg.clientWidth) > 1 || Math.abs(h - svg.clientHeight) > 1)) { treeSettlePass += 1; render(); } else treeSettlePass = 0;
      });
    }
    // 进入本体路由：mount 点已在 body 里，交给 core 的挂载编排（加载特性组、
    // 移 section、渲染本体）。异步执行，不阻塞本轮渲染。
    if (route.name === 'ontology' && typeof NS.mountPersonalOntology === 'function') {
      void NS.mountPersonalOntology();
    }
    // 标签弹层接线（specs/012 T012/T013）：DOM 刚写完，就地过 uiModalController
    //（onChange 监听器注册顺序早于 boot 的渲染监听，不能放 app.js 的 notify 里）。
    if (typeof NS.wireTagOverlay === 'function') NS.wireTagOverlay();
  }
  NS.render = render;
  // 共享渲染件（2026-09-20 本体界面重构）：个人本体页复用资产页同一套
  // 章/行形态。只有 IIFE 顶层的件可导出——plainRow/catalogRow 定义在
  // render 内部（闭包捕获每帧状态），不在此列。
  // resolveSourceRef 一并导出（2026-09-25 US-603）：五处来源展示与用例都
  // 认这一份解析结果，避免测试各自复制一套判据。
  NS.ui = { chip, assetStatusChip, resolveSourceRef, evidenceChip };
})();
