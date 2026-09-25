/* ============================================================================
 * 认知资产 · 核心层（cognition-assets/core.js）
 *
 * 从零重写的认知资产前端。与旧实现（skills.js 里 4600 行 + skills-bindings
 * 分散绑定 + 175 行面板标记）的三点结构差异：
 *
 *  1. 单一命名空间 `window.CogAssets`：api / store / router / ui / actions
 *     各司其职，视图只依赖这一份契约；
 *  2. 状态驱动渲染：所有数据进 store，动作完成后 `reload()` 重取 + `render()` 
 *     重画，不存在"哪个 DOM 谁负责"的隐性分工；
 *  3. 事件全在一个委托层（app.js）：所有交互走 `data-go` / `data-act`，
 *     不再有散落各处的 addEventListener。
 *
 * 后端契约（IPC）不变：本文件是唯一调用窗口。
 * ========================================================================== */
(function () {
  'use strict';

  const NS = window.CogAssets = window.CogAssets || {};
  NS.version = '2.0.0';

  /* ────────────────────────── i18n ────────────────────────── */

  /** 取文案：优先 locale，缺键时用内联回退。与渲染层全局 t() 同源。 */
  function T(key, fallback, vars) {
    let text = key;
    try {
      if (typeof window.t === 'function') text = window.t(key, vars);
    } catch (_) { /* locale 未就绪时退回 key */ }
    if (!text || text === key) text = fallback != null ? fallback : key;
    if (vars) {
      // 命中 locale 与回退两条路径都做占位替换：回退文案同样带 {n} 占位，
      // 不替换的话缺键语言下数字会原样显示成 "{n}"。
      for (const [k, v] of Object.entries(vars)) text = text.replace(`{${k}}`, String(v));
    }
    return text;
  }
  NS.T = T;

  /* ────────────────────────── 基础工具 ────────────────────────── */

  const esc = (value) => (typeof window.escapeHtml === 'function'
    ? window.escapeHtml(value == null ? '' : String(value))
    : String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;'));
  NS.esc = esc;

  /* ── 显示截断（对齐后端 catalogTruncate）：截断、去尾标点、省略号 ── */
  function truncateText(value, limit) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (text.length <= limit) return text;
    return text.slice(0, limit).replace(/[，、；：,;:\-—\s]+$/, '') + '…';
  }
  NS.truncateText = truncateText;

  /* ── 语义融合（移植自 statement-fusion.ts）：句级三档融入 ──
   * 重述（重叠≥0.50 且新句更长/近全等）→ 保留更长；
   * 改写（重叠≥0.45）→ 新替旧；
   * 增量 → 追加到尾部。截断 4000 字。 */
  const FUSION_STATEMENT_LIMIT = 4000;
  const RESTATED_OVERLAP = 0.50;
  const RESTATED_LENGTH_RATIO = 1.8;
  const RESTATED_NEAR_TOTAL = 0.75;
  const REWRITE_OVERLAP = 0.45;

  function fusionBigrams(text) {
    const normalized = String(text || '').replace(/\s+/g, '');
    const grams = new Set();
    for (let i = 0; i + 1 < normalized.length; i += 1) grams.add(normalized.slice(i, i + 2));
    return grams;
  }
  function fusionOverlapCoefficient(left, right) {
    const a = fusionBigrams(left), b = fusionBigrams(right);
    if (!a.size || !b.size) return 0;
    let shared = 0;
    a.forEach(function (g) { if (b.has(g)) shared += 1; });
    return shared / Math.min(a.size, b.size);
  }
  function fusionSplitSentences(text) {
    return String(text || '').replace(/([。！？!?；;\n])/g, '$1\u0001').split('\u0001').map(function (x) { return x.trim(); }).filter(Boolean);
  }
  function fuseStatements(oldStatement, incoming) {
    const oldSentences = fusionSplitSentences(oldStatement);
    const newSentences = fusionSplitSentences(incoming);
    if (!oldSentences.length) {
      const statement = String(incoming || '').trim().slice(0, FUSION_STATEMENT_LIMIT);
      return { statement: statement, added: statement ? [statement] : [], replaced: [], keptCount: 0, truncated: (incoming || '').trim().length > FUSION_STATEMENT_LIMIT };
    }
    if (!newSentences.length) return { statement: oldStatement, added: [], replaced: [], keptCount: oldSentences.length, truncated: false };
    const working = oldSentences.slice();
    for (const sentence of newSentences) {
      let bestIndex = -1, bestOverlap = 0;
      for (let i = 0; i < working.length; i += 1) {
        const overlap = fusionOverlapCoefficient(sentence, working[i]);
        if (overlap > bestOverlap) { bestOverlap = overlap; bestIndex = i; }
      }
      if (bestIndex === -1) { working.push(sentence); continue; }
      const lengthRatio = sentence.length / working[bestIndex].length;
      if ((bestOverlap >= RESTATED_OVERLAP && lengthRatio >= RESTATED_LENGTH_RATIO) || bestOverlap >= RESTATED_NEAR_TOTAL) {
        if (sentence.length > working[bestIndex].length) working[bestIndex] = sentence;
      } else if (bestOverlap >= REWRITE_OVERLAP) {
        working[bestIndex] = sentence;
      } else {
        working.push(sentence);
      }
    }
    const joined = working.join('');
    return { statement: joined.slice(0, FUSION_STATEMENT_LIMIT), replaced: [], keptCount: working.length, truncated: joined.length > FUSION_STATEMENT_LIMIT };
  }
  NS.fuseStatements = fuseStatements;
  NS.resolveMergeChainTarget = resolveMergeChainTarget;
  NS.isAutoCaptureEligible = isAutoCaptureEligible;
  NS.dedupRefs = dedupRefs;

  /* ── 归并链跟随（对齐后端 promote 实时语义查重）：目标 archived 时 ──
   * 落到 mergedIntoAssetId 指向的最终存活目标，防止链式归并死循环。 */
  function resolveMergeChainTarget(asset, allAssets) {
    let cur = asset;
    const seen = new Set([String(cur.id)]);
    while (cur.mergedIntoAssetId) {
      const next = (allAssets || []).find(function (a) { return String(a.id) === String(cur.mergedIntoAssetId); });
      if (!next || seen.has(String(next.id))) break;
      seen.add(String(next.id));
      cur = next;
    }
    return cur;
  }

  /* ── 自动采纳门禁（对齐 isAutoCaptureEligible）：只有 pending_review ──
   * 且非高风险的候选可自动写入；其余转待确认由用户手动处理。 */
  function isAutoCaptureEligible(candidate) {
    const caps = candidate.capabilities || {};
    return String(candidate.status || '') === 'pending_review'
      && String(candidate.risk || 'low') !== 'high'
      && (caps.canConfirm !== false);
  }

  /* ── 证据引用去重（对齐 normalizeCognitionSourceRefs seen-set）── */
  function dedupRefs(refs) {
    const seen = new Set();
    const out = [];
    for (const ref of refs || []) {
      const key = String(ref);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(ref);
    }
    return out;
  }

  const toArr = (value, keys) => {
    if (Array.isArray(value)) return value;
    for (const key of keys || []) {
      if (value && Array.isArray(value[key])) return value[key];
    }
    return [];
  };

  const fmtDate = (value) => {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  };
  NS.fmtDate = fmtDate;

  const toast = (message, variant) => {
    if (typeof window.uiToast === 'function') window.uiToast(message, { variant: variant || 'success' });
  };
  NS.toast = toast;

  const alertUser = async (message) => {
    if (typeof window.uiAlert === 'function') await window.uiAlert(message);
  };
  NS.alertUser = alertUser;

  const confirmUser = async (message, danger) => {
    if (danger && typeof window.uiConfirmDanger === 'function') {
      return !!(await window.uiConfirmDanger({ message, dangerLabel: T('common.confirm', '确认'), cancelLabel: T('common.cancel', '取消') }));
    }
    if (typeof window.uiConfirm === 'function') return !!(await window.uiConfirm(message));
    return false;
  };
  NS.confirmUser = confirmUser;

  /** 文本输入弹窗（specs/016 经验归档的必填原因）：返回输入串，取消返回 null。
   *  与 confirmUser 同一来源（dialogs.js 的 uiPrompt），不引入新的弹窗形态；
   *  取不到共享弹窗时返回 null（fail-closed：宁可不做，不绕道 window.prompt）。 */
  const promptUser = async (message) => {
    if (typeof window.uiPrompt === 'function') {
      try { return await window.uiPrompt(message); } catch (_) { return null; }
    }
    return null;
  };
  NS.promptUser = promptUser;

  /* ────── 拦截原因可读化（2026-09-25 验收修复 US-601 AC4 / US-604 AC1）──────
   * 主进程的准入判定给两样东西：code（分类）与 blockRule（具体规则标识）。
   * 此前渲染层把 Error.message 原文甩给用户——英文 + 内部 id，等于"被拦了但
   * 不知道被什么拦"（验收问题⑤）。现在一律按 blockRule 翻四语规则名，code 只
   * 作兜底；任何分支都不上屏原文，未知规则走兜底文案（如实说"当前不可引用"，
   * 不替主进程编一条规则）。 */
  function blockReasonText(error) {
    const rule = String((error && error.blockRule) || '');
    if (rule === 'paused') return T('cognition.block_reason_paused', '这条内容已被你暂停，当前不能引用');
    if (rule === 'archived') return T('cognition.block_reason_archived', '这条内容已归档，当前不能引用');
    if (rule === 'revoked') return T('cognition.block_reason_revoked', '这条内容已撤回使用，当前不能引用');
    if (rule === 'deleted') return T('cognition.block_reason_deleted', '这条内容已删除（保留期内可恢复），当前不能引用');
    if (rule === 'purged') return T('cognition.block_reason_purged', '这条内容已被彻底删除，不能引用');
    if (rule === 'inactive') return T('cognition.block_reason_inactive', '这条内容当前不在生效状态，不能引用');
    if (rule === 'missing') return T('cognition.block_reason_missing', '这条内容不存在，或已被彻底删除');
    if (rule === 'source_unavailable') return T('cognition.block_reason_source_unavailable', '来源授权已撤回或来源记录已失效，不能继续引用');
    if (rule === 'agent') return T('cognition.block_reason_agent', '接收方不在这条内容允许的 Agent 范围内');
    if (rule === 'scope') return T('cognition.block_reason_scope', '这条内容声明的作用范围不包含当前场景');
    if (rule === 'sensitivity_high') return T('cognition.block_reason_sensitivity_high', '这条内容的敏感级高于本次允许的上限');
    if (rule === 'sensitivity_unknown') return T('cognition.block_reason_sensitivity_unknown', '这条内容还没分过敏感级，不敢默认放行');
    if (rule === 'maturity') return T('cognition.block_reason_maturity', '这条内容的使用契约不允许这样带入');
    if (rule === 'forbidden_context') return T('cognition.block_reason_forbidden_context', '当前任务命中了这条内容声明的禁用场景');
    if (rule === 'not_applicable_context') return T('cognition.block_reason_not_applicable_context', '当前任务与这条内容声明的适用场景不匹配');
    if (rule === 'version_changed') return T('cognition.block_reason_version_changed', '引用的版本已经变化，请重新选择');
    if (rule === 'versions_missing') return T('cognition.block_reason_versions_missing', '引用版本的内容快照缺失，本次无法带入');
    if (rule === 'expired') return T('cognition.block_reason_expired', '这次引用已过期，请重新引用');
    if (rule === 'not_committed') return T('cognition.block_reason_not_committed', '这次引用还没确认，尚未生效');
    // 兜底：没有具体规则标识时退回分类码，仍不给用户看英文原文。
    const code = String((error && error.code) || '');
    if (code === 'projection_asset_inactive') return T('cognition.block_reason_inactive', '这条内容当前不在生效状态，不能引用');
    if (code === 'projection_source_unavailable') return T('cognition.block_reason_source_unavailable', '来源授权已撤回或来源记录已失效，不能继续引用');
    if (code === 'projection_asset_missing') return T('cognition.block_reason_missing', '这条内容不存在，或已被彻底删除');
    if (code === 'projection_asset_ineligible') return T('cognition.block_reason_ineligible', '权限范围不允许这样用（作用域、适用条件或可用 Agent 不匹配）');
    return T('cognition.block_reason_unknown', '这条内容当前不可引用');
  }
  NS.blockReasonText = blockReasonText;

  /* ────── 经验目录枚举 → 人话（specs/016 R6：纯函数导出，用例直测）──────
   *  口径与主进程对齐：分组措辞沿用 task-level-precipitation 的既有中文
   *  （lesson=可复用经验 / workflow=已验证的工作流程 / gap=待修正经验），
   *  任务类型对齐 userScopeLabel（SCOPE_LABELS）。未知值一律中性兜底，
   *  不裸出内部枚举、不编造结论。 */
  const EXPERIENCE_TYPE_TEXTS = {
    lesson: ['cognition.experience_group_lesson', '可复用经验'],
    workflow: ['cognition.experience_group_workflow', '已验证的工作流程'],
    gap: ['cognition.experience_group_gap', '待修正经验'],
    uncategorized: ['cognition.experience_group_uncategorized', '未分类经验'],
  };
  function experienceTypeLabel(value) {
    const entry = EXPERIENCE_TYPE_TEXTS[String(value || '')];
    return entry ? T(entry[0], entry[1]) : T('cognition.experience_group_uncategorized', '未分类经验');
  }
  /** 分组键：未知/缺失类型兜底到 uncategorized 组（Edge Case「判不出→未分类」）。 */
  function experienceGroupKey(value) {
    return EXPERIENCE_TYPE_TEXTS[String(value || '')] ? String(value) : 'uncategorized';
  }
  const EXPERIENCE_TASK_TYPE_TEXTS = {
    report: ['cognition.experience_task_type_report', '报告类任务'],
    code: ['cognition.experience_task_type_code', '代码类任务'],
    review: ['cognition.experience_task_type_review', '审查类任务'],
    product: ['cognition.experience_task_type_product', '产品类任务'],
    general: ['cognition.experience_task_type_general', '通用'],
  };
  function experienceTaskTypeLabel(value) {
    const entry = EXPERIENCE_TASK_TYPE_TEXTS[String(value || '')];
    return entry ? T(entry[0], entry[1]) : T('cognition.experience_task_type_unknown', '未知任务类型');
  }
  const EXPERIENCE_VERIFICATION_TEXTS = {
    inferred: ['cognition.experience_verification_inferred', '推断的（未经确认）'],
    needs_confirmation: ['cognition.experience_verification_needs_confirmation', '待确认'],
    confirmed: ['cognition.experience_verification_confirmed', '已确认'],
    unknown: ['cognition.experience_verification_unknown', '验证状态未知'],
  };
  function experienceVerificationLabel(value) {
    const entry = EXPERIENCE_VERIFICATION_TEXTS[String(value || '')];
    return entry ? T(entry[0], entry[1]) : T('cognition.experience_verification_unknown', '验证状态未知');
  }
  /** 迁移跳过/失败理由码 → 人话（E7/E8 稳定码逐条；未知码中性兜底，
   *  不上屏主进程 message 原文）。 */
  const EXPERIENCE_MIGRATION_REASON_TEXTS = {
    no_kstar_provenance: ['cognition.experience_migration_skip_no_kstar_provenance', '无 KSTAR 沉淀标记（不是任务复盘沉淀的）'],
    capture_line: ['cognition.experience_migration_skip_capture_line', '会话整理线产出（不属于任务经验）'],
    preference_scan_line: ['cognition.experience_migration_skip_preference_scan_line', '偏好扫描线产出（不属于任务经验）'],
    ok: ['cognition.experience_migration_reason_ok', '已迁入'],
    already_migrated: ['cognition.experience_migration_reason_already_migrated', '此前已迁移过'],
    asset_not_found: ['cognition.experience_migration_reason_asset_not_found', '资产记录已不存在'],
    freeze_failed: ['cognition.experience_migration_reason_freeze_failed', '冻结历史引用失败（资产保持原状）'],
    experience_write_failed: ['cognition.experience_migration_reason_experience_write_failed', '写入经验失败（资产保持原状）'],
    asset_removal_failed: ['cognition.experience_migration_reason_asset_removal_failed', '迁出资产记录失败（经验已写入，可重试）'],
  };
  function experienceMigrationReasonText(value) {
    const entry = EXPERIENCE_MIGRATION_REASON_TEXTS[String(value || '')];
    return entry ? T(entry[0], entry[1]) : T('cognition.experience_migration_skip_unknown', '不符合迁移条件');
  }
  /** 状态章（经验自己的四态，与资产章分开——两域状态机不同，文案各自演进）。 */
  const EXPERIENCE_STATUS_TEXTS = {
    active: ['cognition.experience_status_active', '生效中'],
    paused: ['cognition.experience_status_paused', '已暂停'],
    archived: ['cognition.experience_status_archived', '已归档'],
    merged: ['cognition.experience_status_merged', '已并入'],
  };
  function experienceStatusLabel(value) {
    const entry = EXPERIENCE_STATUS_TEXTS[String(value || '')];
    return entry ? T(entry[0], entry[1]) : T('cognition.experience_status_unknown', '状态未知');
  }
  NS.experience = {
    typeLabel: experienceTypeLabel,
    groupKey: experienceGroupKey,
    taskTypeLabel: experienceTaskTypeLabel,
    verificationLabel: experienceVerificationLabel,
    migrationReasonText: experienceMigrationReasonText,
    statusLabel: experienceStatusLabel,
  };

  /** 经验管理动作的失败文案（E3~E6 的错误是英文 message、无 code）：按已知
   *  message 片段翻四语，认不出原样透出（与候选码表同一条纪律——宁可露出
   *  英文也不吞失败）。跨类型合并给专门文案（R5 键表）。 */
  function experienceActionErrorText(error) {
    const raw = String((error && error.message) || error || '');
    if (raw.includes('requires the same experienceType')) return T('cognition.experience_merge_same_type_required', '只能合并同类型的经验');
    if (raw.includes('is terminal and cannot be modified') || raw.includes('has already been merged')) return T('cognition.experience_error_terminal', '这条经验已是终态（已归档或已并入），不能再修改');
    if (raw.includes('experience not found')) return T('cognition.experience_error_not_found', '这条经验已经不在了，可能已被归档或并入');
    if (raw.includes('invalid') && raw.includes('experience')) return T('cognition.experience_error_invalid', '这次操作没有生效：参数不合法');
    return raw || T('cognition.experience_error_generic', '这次操作没有完成，请稍后重试。');
  }
  NS.experienceActionErrorText = experienceActionErrorText;

  /** 引用被拦/失败的统一出口：资产标题 + 规则名。只给标题（不给内部 id、
   *  不给正文——受限资产正文不得进界面，US-604 AC3）。 */
  async function reportBlocked(error, title) {
    const reason = blockReasonText(error);
    const name = String(title || '').trim();
    const message = name
      ? T('cognition.attach_blocked_named', '《{title}》没有被引用：{reason}', { title: name, reason })
      : T('cognition.attach_blocked_unnamed', '引用未生效：{reason}', { reason });
    if (typeof window.uiAlert === 'function') { await alertUser(message); return; }
    toast(message, 'warning');
  }
  NS.reportBlocked = reportBlocked;

  /* ────────────────────────── API 客户端 ────────────────────────── */

  const api = {
    /** 唯一 IPC 出口。错误统一抛 Error（带 code 与 blockRule），调用方 try/catch 兜底。 */
    async call(channel, payload) {
      const result = await window.cogseed.invoke(channel, payload || {});
      if (result && result.ok === false) {
        const error = new Error(result.error || result.message || `ipc failed: ${channel}`);
        error.code = result.code || '';
        // 具体规则标识（US-604 AC1）：界面据此说明"哪条规则拦的"，
        // 而不是把主进程的英文原文甩给用户。
        error.blockRule = result.blockRule || '';
        // 结构化业务返回体不能被这一层吞掉（specs/015 US-702 T022）：版本冲突
        // 是"被拒绝的一次确认"，不是普通失败——渲染层要靠 versionConflict 里
        // 的版本号才能如实提示并按当前在用版重新展示差异。只搬运字段，不做判定。
        if (result.versionConflict) error.versionConflict = result.versionConflict;
        if (result.state) error.state = result.state;
        throw error;
      }
      return result == null ? {} : result;
    },
    /** 容错读：失败返回 fallback 并记录到 store.errors，页面照常渲染。 */
    async soft(channel, payload, fallback) {
      try {
        return await api.call(channel, payload);
      } catch (error) {
        store.errors.push({ channel, message: String(error && error.message || error) });
        return fallback;
      }
    },
  };
  NS.api = api;

  /* ────────────────────────── 状态仓库 ────────────────────────── */

  const store = {
    loaded: false,
    loading: false,
    errors: [],
    assets: [],
    candidates: [],
    captures: [],
    captureCounts: {},
    captureSettings: null,
    /** 资产详情按需拉的版本链（版本组 2026-09-16）：{assetId, versions}。 */
    assetVersions: null,
    /** 确认更新撞版本冲突的就地状态（specs/015 US-702 T022，2026-09-25）：
     *  {candidateId, baselineVersion, currentVersion, targetVersionUsed,
     *   currentStatement, versionsLoading, versionsFailed} 或 null。
     *  只表达一个事实——"这次确认没有生效，资产在你确认前被改过"，并给冲突块
     *  提供**当前在用版正文**（重展示差异的数据源）。候选仍是待处理；这里不存
     *  任何"已完成"语义，处置（重锚/稍后/拒绝）后立即清空。 */
    candidateVersionConflict: null,
    /** KSTAR 溯源（2026-09-17）：{[episodeId]: {goal,status,at}} 摘要缓存；
     *  kstarEpisode 为点开中的单条详情 {episodeId, episode, review}。 */
    kstarSummaries: null,
    /** 已请求过且拿到响应的 kse id（2026-09-18）：区分「还没拉到」与「确实
     *  没有」——前者维持兜底文案，后者如实显示「来源记录不可用」；顺带
     *  止住缺失 id 永远进不了缓存、每次 notify 重发同一次 IPC 的循环。 */
    kstarSummariesSettled: [],
    kstarEpisode: null,
    /** 会话标题缓存（2026-09-25 验收修复 US-603）：{[cid]: title}。证据来源里
     *  的 cid 要翻成用户看得懂的会话名，且候选/资产/版本/使用记录/KSTAR 五处
     *  必须同名。来源目录只有 100 条窗口，窗口外的会话此前一律退化成「一段
     *  对话」；conversationTitlesSettled 记「已请求且确认查无」的 cid——查无
     *  即来源失效，界面如实显示「来源记录不可用」，不是裸 id。 */
    conversationTitles: {},
    conversationTitlesSettled: [],
    /** 正被"模型自选"挂着的资产 id（2026-09-18）：面板目录视图据此标"模型挂着"，
     *  用户不必翻会话才知道模型给哪个任务挂了东西。 */
    modelSelectedAssetIds: [],
    /** KSTAR 任务复盘列表（kstar-episodes tab）：kstar.episodes.list 的记录。 */
    kstarEpisodes: null,
    /** 改进分析结论（specs/015 US-701 AC3 / T016）：{items, loading, failed, stale}，
     *  null = 还没拉过。数据源 = 只读通道 `kstar.improvement.outcomes.list`（倒序）。
     *  只读分区用；结论不是待办，不参与任何计数。 */
    improvementOutcomes: null,
    /** 失败面（`kstar.failures.list`，specs/015 T016 接上）：{items, loading, failed}，
     *  null = 还没拉过。只有真的存在失败类结论时才拉（整集合读取，不给无失败的用户白付）。 */
    kstarFailures: null,
    /** 经验目录（specs/016 US-801，「经验」页签）：{items, loading, failed, stale}，
     *  null = 还没拉过。items 是 E1 列表行（目录行，天然不含 body）；拉全量
     *  （status:'all'）再由视图过滤——列表只摆 active/paused，归档/并入的终态
     *  条目留在 store 里供详情深链与合并目标比对用。 */
    experiences: null,
    /** 经验详情（E2 按需拉）：{experienceId, experience, loading, failed}。 */
    experienceDetail: null,
    /** 存量迁移（E7/E8）：{preview, previewLoading, previewFailed, lastRun}。
     *  preview 是只读扫描结果；lastRun 是最近一次 run/status 的回执（可核对
     *  「已迁/未迁/原因」，不满足于一枚 toast）。 */
    experienceMigration: null,
    /** 标签库（specs/012 US-201，T012/T013 数据源）：{items, loading, failed,
     *  stale}；items 是 recall.tags.list 的 TagView——排序口径（assetCount DESC
     *  常用置顶）在主进程定死，渲染层不重排。null = 还没拉过。 */
    tags: null,
    /** 列表批量打标（specs/012 T011）：{running, done, total, updated,
     *  unchanged, failed}；failed 是逐项失败清单（**不截断**），中断后已完成
     *  项保留、可重跑（幂等）。null = 不在批量流程中。 */
    tagBatch: null,
    /** 多选态选中的资产 id（T011）：只在 route.tagSelect 多选态消费；
     *  批量结束后保留（重跑同一批），退出多选才清空。 */
    tagSelectIds: [],
    /** 批量三选一语义：'add' | 'remove' | 'replace'（replace 与 add/remove
     *  不同时给——三语义不混，contracts/ipc.md §2.2）。 */
    tagBatchOp: 'add',
    /** 标签管理弹层的行内编辑态：正在重命名的 tagId（空 = 无）。 */
    tagManageEdit: '',
    /** 标签管理弹层的合并态：{sourceId, sourceName, targetName}（null = 无）。
     *  确认前必须先显示影响面（T013）。 */
    tagManageMerge: null,
    /** 「可能重复的标签」建议（T013，只读）：[{sourceName, targetName, reason}]；
     *  null = 还没拉过；[] = 没有建议（如实呈现空态）。 */
    tagSuggestions: null,
    sources: [],
    tree: null,
    proofs: [],
    /** 「真实使用」白名单（2026-09-25 US-602）：由主进程单一定义、随
     *  `recall.timeline.list` 载荷下发；列表侧「最近使用」与详情侧使用记录共用它。
     *  缺失时按空集处理（fail-closed）——绝不回落成"不过滤"（那正是缺陷本体）。 */
    realUsageKinds: [],
    /** 资产详情的采用回执（2026-09-25 US-602 AC5/AC6）：{assetId, items, loading}。
     *  「实际采用」只认这里（回执 applied），usage_recorded 一律归「被带入任务」。 */
    adoptionReceipts: null,
    /** 整理详情页的「对话上下文」（2026-09-15 详情页改造）：{captureId, data}
     *  按任务缓存；data 为 null 表示上下文不可用（详情页降级渲染）。 */
    captureContext: null,
    /** 整理页：会话列表是否展开全部（默认收拢 5 条）。 */
    organizeListExpanded: false,
    /** 路由：{name, category, assetId, candidateId, proofEventId, captureBucket, captureId, sourceIssueOpen} */
    route: { name: 'tree', category: '', assetId: '', candidateId: '', proofEventId: '', captureBucket: '', captureId: '', sourceIssueOpen: '', kstarEpisodeId: '', assetVersionId: '', assetEdit: '', assetVersionDiff: '', assetVersionsExpanded: '', assetView: '', familyRename: '', ontologyBox: '', experienceId: '', tagFilter: '', tagMode: '', tagUntagged: '', tagSelect: '', tagOverlay: '' },
    backStack: [],
    /** 上一帧的路由名：渲染层据此判断「离开 ontology 页」需要先归还本体 section。 */
    prevRouteName: 'tree',
  };
  NS.store = store;

  /** 派生统计：全部从这里取，视图不自己算口径。 */
  NS.stats = function stats() {
    const s = store;
    const confirmed = s.assets.filter((a) => String(a.status || 'active') !== 'archived').length;
    // 待确认口径（2026-09-16 B1 统一）：需要判断且未被"稍后处理"静音——
    // 与 views.candidateAwaiting 同一份口径（countsAsPending && !isSnoozed），
    // deferred 不再占「待确认」名额（三套口径 7/5/0 分叉的修复）。
    const pending = s.candidates.filter((c) => (c.capabilities && c.capabilities.countsAsPending) && !(c.capabilities && c.capabilities.isSnoozed)).length;
    const validated = s.assets.filter((a) => a.maturity === 'effectiveness_validated').length;
    const transferOk = s.assets.filter((a) => a.maturity === 'transfer_validated' || a.maturity === 'effectiveness_validated').length;
    const sourceIssues = s.sources
      .flatMap((group) => (Array.isArray(group.items) ? group.items : []))
      // 用户主动暂停的来源（reason=source_paused）不算"需要处理"——用户
      // 自己停的，再提示他去处理自相矛盾；连接器断开等真故障的 paused
      // 仍计入（2026-09-14 修：实机出现 [paused] source_paused 假警报）。
      // 执行失败轮次同样不算（2026-09-16）：与 views.sourceItemNeedsAttention
      // 同口径，agent 执行失败不是用户可修复的来源故障。
      .filter((item) => String(item.kind || '') !== 'execution_evaluation'
        && (item.status === 'failed'
          || (item.status === 'paused' && String(item.statusReason || '') !== 'source_paused'))).length;
    const failedTasks = Number(s.captureCounts && s.captureCounts.failed || 0);
    // 任务执行失败（承接表 01 / G1，2026-09-26 补落点）：会话最后一回合没
    // 得到回复且没有整理记录——那是**任务**失败了（不是整理失败），反馈要与
    // 「整理任务需要重试」分开说。
    const captureConvIds = new Set((Array.isArray(s.captures) ? s.captures : [])
      .map((capture) => String((capture || {}).conversationId || '')).filter(Boolean));
    const taskFailed = (Array.isArray(s.sources) ? s.sources : [])
      .flatMap((group) => (Array.isArray(group && group.items) ? group.items : []))
      .filter((item) => item && item.lastTurnFailed === true
        && !captureConvIds.has(String(item.id || ''))).length;
    const coveredAssets = new Set(s.proofs.map((p) => String((p.refs || {}).assetId || '')).filter(Boolean)).size;
    const attention = s.assets.filter((a) => String(a.status || 'active') === 'paused' || String(a.status || '') === 'archived').length;
    return { confirmed, pending, validated, transferOk, sourceIssues, failedTasks, taskFailed, coveredAssets, proofCount: s.proofs.length, attention };
  };

  /* ────────────────────────── 数据加载 ────────────────────────── */

  const LOADERS = {
    async snapshot() {
      store.errors = [];
      // 注：cognition.inbox.list（治理待办：未分级/规则缺边界等）与
      // recall.teaching.list 的拉取在 2026-09-14 撤下——治理待办在新 UI 尚无
      // 处理出口（分级/边界编辑入口），报了也无处处理；等动作入口恢复后
      // 连同动作指引一起重上。渠道契约本身未变，随时可接回。
      // 解构顺序必须与数组顺序**逐项对齐**：多插一个请求就要同步插名字，
      // 否则 assets 之后的每一项都串位（真机抓出过一次：待办显示空态而 IPC
      // 实际有 39 条，候选/任务/来源也全错）。
      const [assets, candidates, captures, settings, sources, inbox] = await Promise.all([
        api.soft('recall.assets.list', {}, {}),
        api.soft('recall.candidates.list', {}, {}),
        // scope:'all'：整理页要展示完整历史（含系统判定无留存内容的静默
        // 记录）。后端保证静默记录零候选读取，这里多拉的记录不产生模型开销。
        api.soft('recall.captures.list', { limit: 40, scope: 'all' }, {}),
        api.soft('recall.captures.settings.get', {}, {}),
        // limit:100=IPC 上限（审计 C1 修复，2026-09-16）：此前不传 limit 走
        // 后端默认 25，会话超 25 个后整理页静默丢行。满 100 时视图侧另有提示。
        api.soft('recall.sources.list', { limit: 100 }, {}),
        // 治理待办（2026-09-25 重上，specs/008 T051）：当初撤下是因为"报了警却
        // 无处处理"；现在每类都有落点——候选/提议/拿不准项/巡检发现有处置动作，
        // 资产类（未分级/缺边界/来源失效）落到资产详情的编辑入口。可用动作由读
        // 模型给出（`item.actions`），渲染层只渲染、不自己判。
        api.soft('cognition.inbox.list', {}, {}),
      ]);
      store.assets = toArr(assets, ['assets', 'items']);
      store.candidates = toArr(candidates, ['candidates', 'items']);
      store.captures = toArr(captures, ['items', 'captures', 'tasks']);
      store.captureCounts = (captures && captures.counts) || {};
      store.captureSettings = (settings && settings.settings) || settings || null;
      store.sources = toArr(sources, ['groups', 'sources']);
      store.inbox = toArr(inbox, ['items']);
      // 治理分组（specs/010 T013）：**顺带**从同一返回体取 groups，不新增 loader
      // 条目（解构顺序断言是既有锚点）。缺失/非数组 = null → 渲染层退回扁平清单。
      store.inboxGroups = inbox && Array.isArray(inbox.groups) ? inbox.groups : null;
      // 证明链服务资产详情内的使用记录区与成熟度展示，失败不阻塞主快照。
      // 通道是语义化的时间线（recall.timeline.list）：每条事件带 refs
      // （assetId / transferProofId / usageReceiptId / version）。
      const proofs = await api.soft('recall.timeline.list', { limit: 500 }, {});
      store.proofs = toArr(proofs, ['items', 'events']);
      // 白名单随载荷走（US-602 FR-004/FR-011）：主进程是唯一定义处，渲染层只消费。
      store.realUsageKinds = Array.isArray(proofs && proofs.realUsageKinds)
        ? proofs.realUsageKinds.map((kind) => String(kind || '')).filter(Boolean)
        : [];
      // 改进分析结论不在主快照里（只读、按需拉）：动作后的 reload 把它标 stale，
      // 下次进「待我处理」页签时重拉——复盘确认/沉淀都会改结论，不能一直吃旧值。
      if (store.improvementOutcomes) store.improvementOutcomes = { ...store.improvementOutcomes, stale: true };
      // 经验目录同理（specs/016）：主快照不带经验（隔离边界——经验通道不进
      // 资产快照的请求集合），但任何 reload 都可能伴随经验变化（沉淀改道后
      // 资产侧动作间接影响不了经验，这里纯粹是「跨页签动作后回来别吃旧值」）。
      if (store.experiences) store.experiences = { ...store.experiences, stale: true };
      // 标签库（specs/012）：打标/重命名/合并/删除都改计数，任何 reload 后都
      // 让标签列表按需重拉（loadTags 的 stale 守卫会跳过没拉过的场景）。
      if (store.tags) store.tags = { ...store.tags, stale: true };
      store.loaded = true;
    },
    async tree() {
      const result = await api.soft('recall.tree.read', { rebuild: true }, {});
      const tree = result && result.tree ? result.tree : result;
      if (tree && (tree.nodes || tree.edges || tree.error)) store.tree = tree;
    },
  };
  NS.loaders = LOADERS;

  const listeners = new Set();
  NS.onChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
  NS.reload = async function reload(options) {
    const opts = options || {};
    if (opts.tree) { await LOADERS.tree(); listeners.forEach((fn) => fn()); return; }
    if (store.loading) return;
    store.loading = true;
    listeners.forEach((fn) => fn());
    try {
      await LOADERS.snapshot();
    } finally {
      store.loading = false;
      listeners.forEach((fn) => fn());
    }
  };
  NS.notify = () => listeners.forEach((fn) => fn());

  /** 整理详情页按需拉「对话上下文」（本次整理实际读到的消息 + 参与角色）。
   *  按任务缓存；失败降级为 data:null（不进全局 errors——上下文缺席不该
   *  触发「部分数据读取失败」横幅吓人）。 */
  NS.loadCaptureContext = async function loadCaptureContext(captureId) {
    const id = String(captureId || '');
    if (!id || (store.captureContext && store.captureContext.captureId === id)) return;
    store.captureContext = { captureId: id, loading: true };
    NS.notify();
    let data = null;
    try {
      const result = await api.call('recall.captures.context', { captureId: id });
      data = (result && result.context) || null;
    } catch (error) {
      // 捕获记录不存在/会话清理：data 保持 null，详情页给降级文案。
    }
    if (!store.captureContext || store.captureContext.captureId !== id) return;
    store.captureContext = { captureId: id, data };
    NS.notify();
  };

  /** 标签库（specs/012 T012/T013 数据源）：只拉 active（筛选条/打标候选/
   *  管理弹层的主清单）；已停用/已合并在管理弹层打开时按需带 retired 重拉。
   *  失败记 failed（读不到 ≠ 没有标签：筛选条静默不渲染，不吓人）。 */
  NS.loadTags = async function loadTags(options) {
    const opts = options || {};
    const state = store.tags;
    if (!opts.force && !opts.includeRetired && state && !state.stale && !state.failed) return;
    if (!opts.force && opts.includeRetired && state && state.includeRetired && !state.stale && !state.failed) return;
    store.tags = {
      items: (state && state.items) || [],
      loading: true,
      failed: false,
      stale: false,
      includeRetired: Boolean(opts.includeRetired),
    };
    NS.notify();
    let items = [];
    let failed = false;
    try {
      const result = await api.call('recall.tags.list', opts.includeRetired ? { includeRetired: true } : {});
      items = (result && Array.isArray(result.tags)) ? result.tags : [];
    } catch (error) {
      failed = true;
    }
    store.tags = { items, loading: false, failed, stale: false, includeRetired: Boolean(opts.includeRetired) };
    NS.notify();
  };

  /** 「可能重复的标签」建议（T013，只读；只建议不合并）。管理弹层打开时拉。 */
  NS.loadTagSuggestions = async function loadTagSuggestions(force) {
    if (!force && Array.isArray(store.tagSuggestions)) return;
    let suggestions = [];
    try {
      const result = await api.call('recall.tags.suggestions', {});
      suggestions = (result && Array.isArray(result.suggestions)) ? result.suggestions : [];
    } catch (error) {
      suggestions = [];
    }
    store.tagSuggestions = suggestions;
    NS.notify();
  };

  /** 标签筛选的纯判定件（views 与用例共用同一份口径，T012）：
   *  「未分类」= !tags || length===0；并集(any)=命中任一；交集(all)=全部命中。
   *  三种组合的空集语义（契约 renderer-seams §一）：
   *  - 仅「未分类」→ 只看未打标；
   *  - 「未分类」+ 名单(any) → 命中任一 **或** 未打标（未分类 = 并集里的一项）；
   *  - 「未分类」+ 名单(all) → 恒空集（一条资产不可能既有标签又没有）。 */
  NS.matchesTagFilter = function matchesTagFilter(asset, names, untagged, mode) {
    const tags = (Array.isArray(asset.tags) ? asset.tags : []).map((entry) => String(entry || '').trim().toLocaleLowerCase());
    const wanted = (Array.isArray(names) ? names : []).map((name) => String(name || '').trim().toLocaleLowerCase()).filter(Boolean);
    const isUntagged = tags.length === 0;
    if (!wanted.length) return untagged ? isUntagged : true;
    const hit = mode === 'all'
      ? wanted.every((name) => tags.includes(name))
      : wanted.some((name) => tags.includes(name));
    if (!untagged) return hit;
    return mode === 'all' ? false : (hit || isUntagged);
  };

  /** 路由里的标签筛选解析：tagFilter 用 \u001f 连接（标签名可含逗号，不能用
   *  逗号做分隔）；tagMode ''/'all'（缺省 = 并集 any）。 */
  NS.parseTagFilterRoute = function parseTagFilterRoute(route) {
    const joined = String((route && route.tagFilter) || '');
    const names = joined.split('\u001f').map((name) => name.trim()).filter(Boolean);
    return {
      names,
      untagged: String((route && route.tagUntagged) || '') === '1',
      mode: String((route && route.tagMode) || '') === 'all' ? 'all' : 'any',
    };
  };
  NS.joinTagFilter = function joinTagFilter(names) {
    return names.filter(Boolean).join('\u001f');
  };

  /** 标签管理/更多 弹层的接线（T012「更多」/T013 管理）：弹层 markup 由
   *  views 放进持久壳的槽位（#ca-tag-overlay-slot），这里把它过
   *  uiModalController（焦点圈/Escape/滚动锁共享件），每次渲染按槽位当前
   *  DOM 重建控制器——槽位不随内容区重渲染被拔掉，控制器在弹层打开期间
   *  保持同一实例，焦点不乱跳。 */
  let tagOverlayController = null;
  NS.wireTagOverlay = function wireTagOverlay() {
    if (typeof document === 'undefined' || typeof window.uiModalController !== 'function') return;
    const slot = document.getElementById('ca-tag-overlay-slot');
    const overlay = slot ? slot.querySelector(':scope > [data-tag-overlay]') : null;
    if (!overlay) {
      // 弹层已关（路由切走/槽位清空）：把还开着的控制器收掉（解锁 body 滚动）。
      if (tagOverlayController && tagOverlayController.isOpen()) {
        tagOverlayController.close('unmounted', { restoreFocus: false });
      }
      tagOverlayController = null;
      return;
    }
    if (tagOverlayController && tagOverlayController.overlay === overlay && tagOverlayController.isOpen()) return;
    const dialog = overlay.querySelector('[role="dialog"]');
    if (!dialog) return;
    tagOverlayController = window.uiModalController({
      overlay,
      dialog,
      onRequestClose: () => {
        router.go({
          name: String(store.route.name || 'overview'),
          category: String(store.route.category || ''),
          tagFilter: String(store.route.tagFilter || ''),
          tagMode: String(store.route.tagMode || '') === 'all' ? 'all' : '',
          tagUntagged: String(store.route.tagUntagged || '') === '1' ? '1' : '',
          tagSelect: String(store.route.tagSelect || '') === '1' ? '1' : '',
          tagOverlay: '',
        }, { replace: true });
      },
    });
    tagOverlayController.open();
  };

  /** 后台巡检状态（specs/008 US-405）：开关 + 最近一轮的概要。
   *  失败降级为空——巡检读不到不该让整理页报"部分数据读取失败"。 */
  NS.loadInspection = async function loadInspection() {
    if (store.inspection && !store.inspection.stale) return;
    store.inspection = { loading: true, settings: (store.inspection && store.inspection.settings) || null, latestRun: (store.inspection && store.inspection.latestRun) || null };
    NS.notify();
    let settings = null;
    let latestRun = null;
    try {
      const [settingsResult, runsResult] = await Promise.all([
        api.call('recall.inspection.settings', {}),
        api.call('recall.inspection.list', { limit: 1 }),
      ]);
      settings = (settingsResult && settingsResult.settings) || null;
      latestRun = ((runsResult && runsResult.runs) || [])[0] || null;
    } catch (error) {
      settings = null;
      latestRun = null;
    }
    store.inspection = { loading: false, settings, latestRun };
    NS.notify();
  };

  /** 整理报告按需拉取（specs/008 US-403）。按次缓存；失败降级为空列表——
   *  报告读不到不该让整页报"部分数据读取失败"，它只是整理页的一块。 */
  NS.loadCleanupReports = async function loadCleanupReports() {
    if (store.cleanupReports && !store.cleanupReports.stale) return;
    store.cleanupReports = { loading: true, reports: (store.cleanupReports && store.cleanupReports.reports) || [] };
    NS.notify();
    let reports = [];
    try {
      const result = await api.call('recall.cleanup.list', { limit: 20 });
      reports = (result && result.reports) || [];
    } catch (error) {
      reports = [];
    }
    store.cleanupReports = { loading: false, reports };
    NS.notify();
  };

  /** 资产详情按需拉版本链（版本组 2026-09-16）。按资产缓存；失败降级为
   *  空列表（版本链区静默不渲染）。`force`（specs/015 T022）：版本冲突后必须
   *  重拉——缓存里的链正是冲突前那一份，拿它重展示差异等于拿旧差异糊弄用户。 */
  NS.loadAssetVersions = async function loadAssetVersions(assetId, force) {
    const id = String(assetId || '');
    if (!id || (!force && store.assetVersions && store.assetVersions.assetId === id)) return;
    store.assetVersions = { assetId: id, loading: true };
    NS.notify();
    let versions = [];
    let usage = [];
    let audit = [];
    let frozen = [];
    try {
      const result = await api.call('recall.assets.versions.list', { assetId: id });
      versions = (result && result.versions) || [];
      usage = (result && result.usage) || [];
      audit = (result && result.audit) || [];
      frozen = (result && result.frozen) || [];
    } catch (error) {
      versions = [];
      usage = [];
      audit = [];
      frozen = [];
    }
    if (!store.assetVersions || store.assetVersions.assetId !== id) return;
    store.assetVersions = { assetId: id, versions, usage, audit, frozen };
    NS.notify();
  };

  /** 资产详情按需拉采用回执（2026-09-25 US-602 AC5/AC6）。按资产缓存；失败降级
   *  为空列表——「实际采用」区静默不渲染，但使用记录区仍如实显示"证据不足"口径
   *  （宁可少显示，也不把没证据的事说成已采用）。 */
  NS.loadAdoptionReceipts = async function loadAdoptionReceipts(assetId) {
    const id = String(assetId || '');
    if (!id || (store.adoptionReceipts && store.adoptionReceipts.assetId === id)) return;
    store.adoptionReceipts = { assetId: id, items: [], loading: true };
    NS.notify();
    let items = [];
    try {
      const result = await api.call('recall.assets.adoptionReceipts', { assetId: id });
      items = (result && result.receipts) || [];
    } catch (error) {
      items = [];
    }
    if (!store.adoptionReceipts || store.adoptionReceipts.assetId !== id) return;
    store.adoptionReceipts = { assetId: id, items };
    NS.notify();
  };

  /** 批量补 kse 摘要（2026-09-18 抽共用入口）：结果并入缓存；本次请求里
   *  响应没有的 id 记进 settled——没有就是没有，chip 据此如实显示「来源
   *  记录不可用」；失败不记（读不到 ≠ 不存在，保持兜底文案）。 */
  async function fetchKstarEpisodeSummaries(rawIds) {
    const wanted = [...new Set((rawIds || []).map(String).filter((id) => id.startsWith('kse-')))];
    if (!wanted.length) return;
    const have = store.kstarSummaries || {};
    const settled = store.kstarSummariesSettled || [];
    const missing = wanted.filter((id) => !have[id] && !settled.includes(id));
    if (!missing.length) return;
    try {
      const result = await api.call('recall.kstar.episodes.summaries', { ids: missing });
      const summaries = (result && result.summaries) || [];
      store.kstarSummaries = {
        ...(store.kstarSummaries || {}),
        ...Object.fromEntries(summaries.map((s) => [String(s.id), s])),
      };
      const returned = new Set(summaries.map((s) => String(s.id)));
      store.kstarSummariesSettled = [...new Set([...(store.kstarSummariesSettled || []), ...missing.filter((id) => !returned.has(id))])];
      NS.notify();
    } catch (error) {
      // 摘要缺席只影响 chip 文案，不阻断详情；失败不记 settled。
    }
  }

  /** KSTAR 溯源（2026-09-17）：资产详情证据含 kse 引用时批量拉任务目标
   *  摘要（chip 显示用）；失败静默（chip 退回占位标题）。
   *  2026-09-18 修：此前只取资产级 evidenceRefs，版本块渲染读的却是
   *  snapshot.evidenceRefs——历史版本的 kse id 从没拉过摘要，永远命中不了
   *  缓存。现在把已加载版本的快照证据一并纳入（版本异步到达后，onChange
   *  会再触发一次，新 id 自然补拉）。 */
  NS.loadKstarEpisodeSummaries = async function loadKstarEpisodeSummaries(assetId) {
    const id = String(assetId || '');
    const asset = store.assets.find((a) => String(a.id) === id);
    if (!asset) return;
    const refs = [...(asset.evidenceRefs || [])];
    if (store.assetVersions && String(store.assetVersions.assetId || '') === id) {
      for (const version of store.assetVersions.versions || []) {
        refs.push(...((version.snapshot && version.snapshot.evidenceRefs) || []));
      }
    }
    await fetchKstarEpisodeSummaries(refs.map((ref) => String(ref.id || '')));
  };

  /** 批量补会话标题（2026-09-25 验收修复 US-603）：与 kse 摘要同一套防循环
   *  模式——已命中的不再请求，响应里没有的 cid 记进 settled（查无 = 来源已
   *  失效，界面据此显示「来源记录不可用」）；请求失败不记 settled（读不到 ≠
   *  不存在，下次渲染再试）。只有真的拿到新数据才 notify，避免失败时无限重渲染。 */
  async function fetchConversationTitles(rawIds) {
    const wanted = [...new Set((rawIds || []).map((id) => String(id || '').trim()).filter(Boolean))];
    if (!wanted.length) return;
    const have = store.conversationTitles || {};
    const settled = store.conversationTitlesSettled || [];
    const missing = wanted.filter((id) => !Object.prototype.hasOwnProperty.call(have, id) && !settled.includes(id));
    if (!missing.length) return;
    let changed = false;
    // IPC 单次上限 50（contracts/ipc.md C7）：分批取满，不做隐式截断——截断会
    // 让"没问到"与"查无此会话"混为一谈，界面就会误报来源失效。
    for (let start = 0; start < missing.length; start += 50) {
      const batch = missing.slice(start, start + 50);
      try {
        const result = await api.call('conversations.titles', { cids: batch });
        const titles = (result && result.titles) || [];
        const returned = new Set(titles.map((row) => String(row.cid)));
        store.conversationTitles = {
          ...(store.conversationTitles || {}),
          ...Object.fromEntries(titles.map((row) => [String(row.cid), String(row.title || '')])),
        };
        const absent = batch.filter((id) => !returned.has(id));
        if (absent.length) {
          store.conversationTitlesSettled = [...new Set([...(store.conversationTitlesSettled || []), ...absent])];
        }
        changed = true;
      } catch (error) {
        // 标题缺席只影响来源文案（退回泛称或「来源记录不可用」），不阻断详情。
      }
    }
    if (changed) NS.notify();
  }

  /** 资产详情的会话类证据 + 使用记录事件的 cid 一起补标题（使用记录要「可定位
   *  会话」，US-602 AC2）。版本快照里的证据一并纳入——与 kse 摘要同一处坑：
   *  历史版本的引用此前从没拉过。 */
  NS.loadConversationTitles = async function loadConversationTitles(assetId) {
    const id = String(assetId || '');
    const ids = [];
    const asset = store.assets.find((a) => String(a.id) === id);
    if (asset) {
      for (const ref of asset.evidenceRefs || []) {
        if (String(ref && ref.kind || '') === 'conversation') ids.push(String(ref.id || ''));
      }
    }
    if (store.assetVersions && String(store.assetVersions.assetId || '') === id) {
      for (const version of store.assetVersions.versions || []) {
        for (const ref of (version.snapshot && version.snapshot.evidenceRefs) || []) {
          if (String(ref && ref.kind || '') === 'conversation') ids.push(String(ref.id || ''));
        }
      }
    }
    for (const proof of store.proofs || []) {
      const refs = (proof && proof.refs) || {};
      if (id && String(refs.assetId || '') !== id) continue;
      if (refs.conversationId) ids.push(String(refs.conversationId));
    }
    await fetchConversationTitles(ids);
  };

  /** 按 id 批量补（候选详情/整理页用，与 loadKstarEpisodeSummariesByIds 同形）：
   *  只收会话类引用，其余 kind 由解析器各自处理。 */
  NS.loadConversationTitlesByIds = async function loadConversationTitlesByIds(refs) {
    const ids = (refs || [])
      .filter((ref) => String((ref && ref.kind) || '') === 'conversation')
      .map((ref) => String((ref && ref.id) || ''));
    await fetchConversationTitles(ids);
  };

  /** 模型自选挂载的资产（2026-09-18）：confirmed 的 model_selected 投影里
   *  出现的资产 id 集合；失败静默（标记缺席不影响目录）。 */
  NS.loadModelSelectedAssets = async function loadModelSelectedAssets() {
    try {
      const result = await api.call('recall.projections.list', { status: 'confirmed', limit: 100 });
      const projections = (result && result.projections) || [];
      const ids = [];
      for (const projection of projections) {
        if (String(projection.authorization || '') !== 'model_selected') continue;
        for (const assetId of projection.assetIds || []) ids.push(String(assetId));
      }
      const next = [...new Set(ids)];
      // 防重入（2026-09-18 P0 修复）：onChange 每次 notify 都会调本函数——若
      // 无条件再 notify 就成了"加载→重画→再加载"死循环，整页被拖死。集合没变
      // 就直接返回（对照 loadKstarEpisodes 的守卫）。
      const prev = Array.isArray(store.modelSelectedAssetIds) ? store.modelSelectedAssetIds : [];
      const changed = prev.length !== next.length || next.some((id) => !prev.includes(id));
      if (!changed) return;
      store.modelSelectedAssetIds = next;
      NS.notify();
    } catch (error) {
      // 标记拿不到不影响目录本身。
    }
  };

  /** 按 kse id 批量补复盘摘要（候选详情页用：候选不是资产，走不了
   *  loadKstarEpisodeSummaries 的按资产入口——候选的 kse 引用来自
   *  sourceRefs/evidenceRefs）。 */
  NS.loadKstarEpisodeSummariesByIds = async function loadKstarEpisodeSummariesByIds(ids) {
    await fetchKstarEpisodeSummaries(ids);
  };

  /** 点开单条任务复盘详情（就地展开块）。 */
  NS.loadKstarEpisode = async function loadKstarEpisode(episodeId) {
    const id = String(episodeId || '');
    if (!id) return;
    store.kstarEpisode = { episodeId: id };
    NS.notify();
    let data = null;
    try {
      data = await api.call('recall.kstar.episode.read', { episodeId: id });
    } catch (error) {
      data = null;
    }
    if (!store.kstarEpisode || String(store.kstarEpisode.episodeId) !== id) return;
    store.kstarEpisode = { episodeId: id, episode: data && data.episode, review: data && data.review };
    NS.notify();
  };

  /** KSTAR 任务复盘列表（kstar-episodes tab）：一次性拉最近复盘过的任务。 */
  NS.loadKstarEpisodes = async function loadKstarEpisodes(force) {
    if (!force && Array.isArray(store.kstarEpisodes)) return;
    const prev = store.kstarEpisodes;
    store.kstarEpisodes = [];
    try {
      const result = await api.soft('kstar.episodes.list', { limit: 50 }, { episodes: [] });
      const episodes = (result && (result.episodes || result.items)) || [];
      store.kstarEpisodes = [...episodes].sort((left, right) => String(right.updatedAt || right.createdAt || '').localeCompare(String(left.updatedAt || left.createdAt || '')));
    } catch (error) {
      // 列表缺席只影响 tab 内容，恢复上一份避免整页空白。
      store.kstarEpisodes = prev || [];
    }
    NS.notify();
  };

  /* ────────── 经验目录数据装载（specs/016 US-801，通道 E1/E2/E7/E8）───────────
   *  与改进分析同一套按需模式：不进主快照（经验通道与资产快照隔离），进
   *  「经验」页签才拉；失败记 failed（读不到 ≠ 没有，空态与失败分开呈现）。
   *  所有通道只读，动作（暂停/类型/合并/归档/迁移）在 actions 层。 */

  /** 经验列表（E1）：status:'all' 一次拉全（≤200，E1 上限），视图侧过滤
   *  active/paused——避免为两个非终态各发一次请求；stale 由 snapshot 打、
   *  动作后 force 重拉。 */
  NS.loadExperiences = async function loadExperiences(force) {
    if (store.experiences && !force && !store.experiences.stale && !store.experiences.failed) return;
    store.experiences = { items: store.experiences && store.experiences.items || [], loading: true, failed: false, stale: false };
    NS.notify();
    let items = [];
    let failed = false;
    try {
      const result = await api.call('recall.experiences.list', { status: 'all', limit: 200 });
      items = (result && result.experiences) || [];
    } catch (error) {
      failed = true;
    }
    store.experiences = { items, loading: false, failed, stale: false };
    NS.notify();
  };

  /** 经验详情（E2）：按条缓存；不存在（已归档仍可读，物理删除后查无）如实
   *  记 failed——详情页给「读不到」文案，不冒充空条目。 */
  NS.loadExperienceDetail = async function loadExperienceDetail(experienceId, force) {
    const id = String(experienceId || '');
    if (!id) return;
    if (!force && store.experienceDetail && store.experienceDetail.experienceId === id && !store.experienceDetail.failed) return;
    store.experienceDetail = { experienceId: id, loading: true, failed: false };
    NS.notify();
    let experience = null;
    let failed = false;
    try {
      const result = await api.call('recall.experiences.read', { experienceId: id });
      experience = (result && result.experience) || null;
      if (!experience) failed = true;
    } catch (error) {
      failed = true;
    }
    if (!store.experienceDetail || String(store.experienceDetail.experienceId) !== id) return;
    store.experienceDetail = { experienceId: id, experience, loading: false, failed };
    NS.notify();
  };

  /** 迁移预览（E7 只读）：扫描结果进 store，界面据此逐条核对后显式发起。 */
  NS.loadExperienceMigrationPreview = async function loadExperienceMigrationPreview(force) {
    const state = store.experienceMigration;
    if (!force && state && state.preview && !state.previewFailed) return;
    store.experienceMigration = { preview: state && state.preview, previewLoading: true, previewFailed: false, lastRun: state && state.lastRun };
    NS.notify();
    let preview = null;
    let previewFailed = false;
    try {
      preview = await api.call('recall.experiences.migration.preview', {});
    } catch (error) {
      previewFailed = true;
    }
    const current = store.experienceMigration;
    store.experienceMigration = { preview, previewLoading: false, previewFailed, lastRun: current && current.lastRun };
    NS.notify();
  };

  /** 迁移状态（E8 只读）：最近一次 run 的回执；从未跑过时 migrationId 为
   *  null——界面如实说「还没执行过」，不把空态误报成失败。 */
  NS.loadExperienceMigrationStatus = async function loadExperienceMigrationStatus() {
    const state = store.experienceMigration;
    store.experienceMigration = { preview: state && state.preview, previewLoading: false, previewFailed: state && state.previewFailed || false, lastRun: null, statusLoading: true };
    NS.notify();
    let lastRun = null;
    try {
      const result = await api.call('recall.experiences.migration.status', {});
      lastRun = result && result.migrationId ? result : null;
    } catch (error) {
      lastRun = null;
    }
    const current = store.experienceMigration;
    store.experienceMigration = { preview: current && current.preview, previewLoading: false, previewFailed: current && current.previewFailed || false, lastRun, statusLoading: false };
    NS.notify();
  };

  /* ────────── 改进分析（specs/015 US-701 AC3 / T016）与依据链数据装载 ──────────
   * 两个只读通道都不进主快照：结论是「进待我处理页签才需要」，失败面更是整集合
   * 读取——只有真的存在失败类结论时才拉，不给没有失败的用户白付这份开销。
   * 路由副作用放在 core（与 app.js 的 onChange 编排同一套模式；本批只动
   * views/core 两个文件，见 specs/015 T016）。 */

  /** 改进分析结论（`kstar.improvement.outcomes.list`，倒序，只读）。
   *  失败记 `failed`（读不到 ≠ 没有：空态与读取失败必须分开呈现）；`force` 重拉。 */
  NS.loadImprovementOutcomes = async function loadImprovementOutcomes(force) {
    if (store.improvementOutcomes && !force && !store.improvementOutcomes.stale) return;
    store.improvementOutcomes = { items: [], loading: true, failed: false, stale: false };
    NS.notify();
    let items = [];
    let failed = false;
    try {
      const result = await api.call('kstar.improvement.outcomes.list', { limit: 50 });
      items = (result && result.outcomes) || [];
    } catch (error) {
      failed = true;
    }
    store.improvementOutcomes = { items, loading: false, failed, stale: false };
    NS.notify();
  };

  /** 失败面（`kstar.failures.list`，只读）：失败类结论的就地详情数据源。 */
  NS.loadKstarFailures = async function loadKstarFailures(force) {
    if (store.kstarFailures && !force && !store.kstarFailures.failed) return;
    store.kstarFailures = { items: [], loading: true, failed: false };
    NS.notify();
    let items = [];
    let failed = false;
    try {
      const result = await api.call('kstar.failures.list', {});
      items = (result && result.failures) || [];
    } catch (error) {
      failed = true;
    }
    store.kstarFailures = { items, loading: false, failed };
    NS.notify();
  };

  const IMPROVEMENT_FAILURE_CONCLUSIONS = new Set(['analysis_failed', 'submit_failed']);

  /** 进「待我处理」页签：补拉结论；有失败类结论时补拉失败面；顺手补复盘摘要
   *  （来源任务 chip 要显示任务目标，而不是兜底"一次任务"）。各 loader 自带
   *  缓存/在途守卫，这里只做"什么时候该拉"的判断。 */
  NS.onChange(() => {
    if (String((store.route && store.route.name) || '') !== 'review') return;
    const state = store.improvementOutcomes;
    if (!state || state.failed || state.stale) { void NS.loadImprovementOutcomes(); return; }
    if (state.loading) return;
    const items = Array.isArray(state.items) ? state.items : [];
    void NS.loadKstarEpisodeSummariesByIds(items.map((row) => String(row.episodeId || '')));
    if (!store.kstarFailures || store.kstarFailures.failed) {
      if (items.some((row) => IMPROVEMENT_FAILURE_CONCLUSIONS.has(String(row.conclusion || '')))) {
        void NS.loadKstarFailures();
      }
    }
  });

  /** 进候选详情：依据链的采用证据按目标方法补拉（`recall.assets.adoptionReceipts`，
   *  与资产详情「实际采用记录」同一个只读口、同一份缓存）；同次任务的复盘摘要
   *  可能不在候选的引用里（在 learningProvenance.episodeId 上），这里补上。 */
  NS.onChange(() => {
    const candidateId = String((store.route && store.route.candidateId) || '');
    if (!candidateId) return;
    const candidate = store.candidates.find((c) => String(c.id) === candidateId);
    if (!candidate) return;
    const targetAssetId = String(candidate.targetAssetId || '');
    if (targetAssetId) void NS.loadAdoptionReceipts(targetAssetId);
    const episodeId = String((candidate.learningProvenance && candidate.learningProvenance.episodeId) || '');
    if (episodeId) void NS.loadKstarEpisodeSummariesByIds([episodeId]);
  });

  /* ────────────────────────── 路由 ────────────────────────── */

  /* 2026-09-15 全模块重构：按最小闭环收敛为三个 tab;使用记录并入资产详情、
   * 经验(KSTAR)与来源健康常态页砍除(来源改为异常驱动,只在待我处理出现)。 */
  /* 2026-09-21 HTML 原型 v7 迁移：三页签扩成五页签——认知树 / 个人本体 /
   * 我的认知 / 待我处理 / 整理。默认落地认知树(原型的信息架构：树是第一眼)。
   * 「我的认知」不再承载树图主界面,树拆成独立全屏页(Phase 3)。 */
  const TABS = [
    { id: 'tree', titleKey: 'cognition.tab_tree', title: '认知树' },
    { id: 'ontology', titleKey: 'cognition.tab_ontology', title: '个人本体' },
    { id: 'overview', titleKey: 'cognition.tab_overview', title: '我的认知' },
    // 经验页签（specs/016 US-801 AC3）：任务收口沉淀的经验与正式资产完全
    // 隔离——独立页签、独立通道（recall.experiences.*）、不进资产列表。
    // 位置定在「我的认知」之后「待我处理」之前：经验是从任务里学到的
    // 认知沉淀，紧挨资产域，但排在待办之前（待办是时效性入口）。
    { id: 'experiences', titleKey: 'cognition.tab_experiences', title: '经验' },
    { id: 'review', titleKey: 'cognition.tab_review', title: '待我处理' },
    { id: 'organize', titleKey: 'cognition.tab_organize', title: '整理' },
  ];
  NS.TABS = TABS;
  // 归边判定 NS.isKstarAsset / NS.isKstarCandidate 由 views.js 定义
  //（2026-09-17 B 档两线分开；渲染层唯一消费方，跟着渲染代码走）。

  const router = {
    go(next, options) {
      const opts = options || {};
      const current = store.route;
      // 先把 next 归一到同一形状再比（部分键字面量 vs 全键展开的序列化恒不等，
      // 连点同一 tab 会堆积重复栈项——2026-09-14 终审修）。
      const merged = Object.assign({ name: 'tree', category: '', assetId: '', candidateId: '', proofEventId: '', captureBucket: '', captureId: '', sourceIssueOpen: '', kstarEpisodeId: '', assetVersionId: '', assetEdit: '', assetVersionDiff: '', assetVersionsExpanded: '', assetView: '', familyRename: '', ontologyBox: '', experienceId: '', tagFilter: '', tagMode: '', tagUntagged: '', tagSelect: '', tagOverlay: '' }, next);
      const same = JSON.stringify(current) === JSON.stringify(merged);
      if (!opts.replace && !same) store.backStack.push(Object.assign({}, current));
      store.route = merged;
      // 滚动不在这里清零（2026-09-17 修）：views.render 的 restoreScroll 按
      // routeKey 判定——页面级路由变了回顶，就地展开（使用记录/版本详情/
      // KSTAR 复盘）保持原位。此前无条件清零会把展开后的视口打回页面顶部。
      NS.notify();
    },
    back() {
      const prev = store.backStack.pop();
      if (prev) router.go(prev, { replace: true });
    },
  };
  NS.router = router;

  /* ────────────────────────── 错误文案（自 skills-bindings.js 迁入） ────────────────────────── */
  /* 后端抛的 message 是内部契约语言（`no successful transfer proof for task
   * run`、`recall candidate is terminal` 等），不能原样给用户看：按 result.code
   * 翻译；取不到已知码时退回原始 error——宁可露出英文也不吞掉失败。
   * 码表：proof-service.ts::recallProofError / candidate-capabilities.ts /
   * promotion.ts::PromotionBlockReason。 */

  const RECALL_CANDIDATE_ERROR_TEXTS = {
    recall_candidate_terminal: ['cognition.candidate_error_terminal',
      '这条候选已经处理过了（已确认、已拒绝或已失效），不能再改。回「待我处理」看当前待办。'],
    recall_candidate_not_promotable: ['cognition.candidate_error_not_promotable',
      '这条候选现在不能确认为正式资产。'],
    recall_candidate_not_found: ['cognition.candidate_error_not_found',
      '这条候选已经不在了，可能已被处理或已过期。'],
    recall_candidate_duplicate: ['cognition.candidate_error_duplicate',
      '已经有一条内容相同的候选，先去处理那一条。'],
    recall_candidate_handoff_incomplete: ['cognition.candidate_error_handoff_incomplete',
      '上一次确认没有走完，资产还没落定。先重试确认，再修改内容。'],
    recall_candidate_evidence_insufficient: ['cognition.candidate_error_evidence_insufficient',
      '证据不足：补上可追溯的证据引用后才能确认。'],
    recall_candidate_risk_gate: ['cognition.candidate_error_risk_gate',
      '这是高风险变更，需要你单独确认后才能保存。'],
    recall_candidate_non_asset_decision: ['cognition.candidate_error_non_asset_decision',
      '这条候选的结论是「保持当前版本」或「拒绝」，不走确认为资产这条路。'],
    recall_candidate_security_blocked: ['cognition.candidate_error_security_blocked',
      '内容被认知安全闸门拦下，不能沉淀为资产。'],
    recall_candidate_unknown_source: ['cognition.candidate_error_unknown_source',
      '有一条证据引用在来源列表里找不到，不能保存。证据只能从真实来源中选取。'],
    recall_candidate_similar_asset: ['cognition.candidate_error_similar_asset',
      '检测到与现有资产高度相似——确认是新条目，还是同一条的修订（改为更新）。'],
    recall_capture_not_review_ready: ['cognition.candidate_error_capture_not_review_ready',
      '它所属的沉淀任务还没到可复核状态，稍后再确认。'],
    recall_capture_writing: ['cognition.candidate_error_capture_writing',
      '它所属的沉淀任务正在写入，等这一次写完再试。'],
  };

  /** 晋升闸门的拦截原因。与 promotion.ts::PromotionBlockReason 一一对应。 */
  const RECALL_PROMOTION_BLOCK_TEXTS = {
    personal_is_project_fact: ['cognition.candidate_block_personal_is_project_fact',
      '这是项目或任务事实，它属于项目，不属于「关于我」。'],
    template_not_reusable_structure: ['cognition.candidate_block_template_not_reusable_structure',
      '模板要的是从来源里抽出来的可复用结构，指向原文件本身不算。'],
    skill_not_executable: ['cognition.candidate_block_skill_not_executable',
      '方法要写成可执行、可检验的样子，能力自述不算。'],
    rule_boundary_required: ['cognition.candidate_block_rule_boundary_required',
      '规则要先确认适用与禁止范围。'],
    judgment_is_meta_commentary: ['cognition.candidate_block_judgment_is_meta_commentary',
      '这段判断是在评价这条候选本身，不是可复用的内容。'],
    type_conflicts_with_existing: ['cognition.candidate_block_type_conflicts_with_existing',
      '同一句话已经以另一种类型存在，分类不可信；先裁定它到底属于哪一类。'],
  };

  /** 单条晋升阻断原因 → 用户文案（候选确认卡内联说明用）。 */
  NS.promotionBlockText = function promotionBlockText(reason) {
    const entry = RECALL_PROMOTION_BLOCK_TEXTS[reason];
    return entry ? T(entry[0], entry[1]) : '';
  };

  /** 把 IPC 失败体（{code, error, blockRule, promotionReasons}）翻成给用户看的话。 */
  NS.recallErrorText = function recallErrorText(result) {
    const code = String((result && result.code) || '');
    // 资产准入/挂载类失败（2026-09-25 US-604 AC1/AC7）：走规则名映射，并如实说明
    // 「这次操作没有生效」——绝不把主进程的英文原文与内部 id 甩给用户。
    if (code.startsWith('projection_') || (result && result.blockRule)) {
      return T('cognition.action_not_applied', '这次操作没有生效：{reason}', { reason: blockReasonText(result) });
    }
    // 治理处置的稳定错误码（specs/010 T021/T030）：补条件未过门禁（没落库）、
    // 版本冲突（别的改动先落了）。都如实说"这次没有生效"，不甩原文。
    if (code === 'invalid_boundary') {
      return T('cognition.inbox_error_boundary_invalid', '条件没有通过规则门禁——没有保存，请补齐后再试。');
    }
    if (code === 'version_conflict') {
      return T('cognition.inbox_error_version_conflict', '这条资产刚被别的改动更新过（版本冲突），请重试。');
    }
    if (code === 'promotion_blocked') {
      const reasons = Array.isArray(result && result.promotionReasons) ? result.promotionReasons : [];
      const lines = reasons
        .map((reason) => RECALL_PROMOTION_BLOCK_TEXTS[reason])
        .filter(Boolean)
        .map((entry) => `· ${T(entry[0], entry[1])}`);
      const head = T('cognition.candidate_error_promotion_blocked', '这条候选还不够格成为正式资产：');
      return lines.length
        ? `${head}\n${lines.join('\n')}`
        : `${head}${T('cognition.candidate_error_promotion_blocked_unknown', '请检查内容、类型与作用范围。')}`;
    }
    const entry = RECALL_CANDIDATE_ERROR_TEXTS[code];
    if (entry) return T(entry[0], entry[1]);
    return (result && result.error) || T('cognition.candidate_error_generic', '这次操作没有完成，请稍后重试。');
  };

  /** 手动沉淀（整理会话）失败的错误文案：已知内部消息翻成人话，
   *  未知错误原样透出（不吞失败）。自 skills-bindings.js 迁入。 */
  NS.captureErrorText = function captureErrorText(error) {
    const raw = String(error && error.message ? error.message : error || '').trim();
    const messages = {
      'conversation has no completed exchange': ['cognition.capture_error_no_completed_exchange', '当前会话还没有完成一轮问答，暂时无法沉淀。'],
      'conversation is still waiting for a response': ['cognition.capture_error_waiting_response', '当前会话仍在等待回复，完成后才能沉淀。'],
      'recall capture is disabled': ['cognition.capture_error_disabled', '沉淀功能已关闭，请先在沉淀设置中开启。'],
      'conversation not found': ['cognition.capture_error_conversation_not_found', '找不到这个会话，暂时无法沉淀。'],
    };
    const localized = messages[raw];
    if (localized) return T(localized[0], localized[1]);
    return raw || T('cognition.capture_error_unknown', '沉淀任务发生未知错误');
  };

  /* ────────────────────────── 动作层 ────────────────────────── */
  /* 所有写操作收口在这里：调用 IPC → toast → reload。视图里不允许直接 invoke。 */

  const CANDIDATE_CHANNELS = {
    reject: 'recall.candidates.reject',
    ignore: 'recall.candidates.ignore',
    'keep-current': 'recall.candidates.keepCurrent',
    defer: 'recall.candidates.defer',
    resume: 'recall.candidates.resume',
  };

  // originKindOf 已随出身收敛退役（2026-09-20）：「模型记的=已确定」，
  // 出身三值不再是显示或行为维度；出身章与转正动作一并移除。

  /* ── 确认更新撞版本冲突的就地处置（specs/015 US-702 T022）────────────────
   * 确认时主进程在 `updateAbilityAsset` **锁内**比对"候选锚定的版本"与"当前
   * 在用版"；不一致就返回结构化冲突（资产零改动、候选不落终态）。渲染层在这
   * 里做三件事：
   *  ① 把冲突摆成页面状态（视图据此如实说"这次没有生效"）——决不静默覆盖、
   *     决不当成成功、**决不自动重试**；
   *  ② 重取资产与**版本链**（缓存里那份正是冲突前的旧链，拿它展示差异等于拿
   *     旧差异糊弄用户），从中取当前在用版正文喂给冲突块；
   *  ③ 等用户看过"对当前版差异"后点「按当前版本重新确认」——那一次点击才带
   *     `confirmBaselineVersion`（见 actions.decideCandidate 的 rebase 分支）。
   * 候选在此之后仍是待处理（`recall.candidates.read` 的真实状态），本函数不写
   * 任何终态、不改候选。 */
  async function openCandidateVersionConflict(candidate, conflict) {
    const candidateId = String(candidate.id || '');
    const targetAssetId = String(candidate.targetAssetId || '');
    store.candidateVersionConflict = {
      candidateId,
      baselineVersion: String((conflict && conflict.baselineVersion) || ''),
      currentVersion: String((conflict && conflict.currentVersion) || ''),
      targetVersionUsed: String((conflict && conflict.targetVersionUsed) || ''),
      currentStatement: '',
      /** 当前在用版的快照（versions.list 里那一版）：冲突块按它逐字段重摆
       *  「当前 → 拟生效」的差异。读不到就是 null——界面据此如实说读不到。 */
      currentSnapshot: null,
      versionsLoading: !!targetAssetId,
      versionsFailed: false,
    };
    NS.notify();
    if (targetAssetId) store.assetVersions = null;
    // 资产列表与版本链都重取：正文与在用版号要一致（冲突正是"它们变了"）。
    await NS.reload();
    if (!targetAssetId) return;
    await NS.loadAssetVersions(targetAssetId, true);
    const state = store.candidateVersionConflict;
    if (!state || state.candidateId !== candidateId) return;
    const versions = (store.assetVersions && String(store.assetVersions.assetId || '') === targetAssetId)
      ? store.assetVersions.versions
      : [];
    const row = (versions || []).find((v) => String(v.version) === String(state.currentVersion));
    const snapshot = (row && row.snapshot) || null;
    const statement = String((snapshot && snapshot.statement) || '').trim();
    // 读不到正文（版本链没拉到/当前版号在链里找不到）如实记为失败：冲突块说
    // "没能读到当前版本正文"，不拿空的或旧的正文冒充。
    store.candidateVersionConflict = {
      ...state, currentSnapshot: snapshot, currentStatement: statement, versionsLoading: false, versionsFailed: !statement,
    };
    NS.notify();
  }

  const actions = {
    /** 采纳：可选携带编辑后的字段（adjust=true 时从表单读取）。 */
    async adoptCandidate(candidateId, formValues) {
      const candidate = store.candidates.find((c) => c.id === candidateId);
      if (!candidate) return;
      // 版本冲突后的**再次确认**（specs/015 T022③）：冲突状态还挂在这个候选上
      // 时，用户这次点击就是"我已看过对当前在用版的差异，再确认一次"——把
      // `confirmBaselineVersion = 冲突返回的当前在用版` 带下去，主进程在资产锁内
      // 再校验一次。这只是把用户这一次点击的意图传下去，**不是自动重试**：撞了
      // 冲突就停下（见下面的 catch），没有任何代码会替用户重发。
      const conflictState = store.candidateVersionConflict
        && String(store.candidateVersionConflict.candidateId) === String(candidateId)
        ? store.candidateVersionConflict
        : null;
      const confirmBaselineVersion = String((conflictState && conflictState.currentVersion) || '');
      if (candidate.risk === 'high') {
        const ok = await confirmUser(T('cognition.candidate_high_risk_confirm', '这是高风险资产变更。确认继续保存吗？'));
        if (!ok) return;
      }
      if (formValues) {
        await api.call('recall.candidates.update', Object.assign({
          candidateId,
          value: candidate.value || '',
          suggestedAction: candidate.suggestedAction || 'create',
          risk: candidate.risk || 'low',
          expiresAt: candidate.expiresAt,
          taskRunId: candidate.taskRunId,
          targetAssetId: candidate.targetAssetId,
          // 证据与适用/禁止边界不在表单里编辑：原样带回，防止一次"调整后采纳"
          // 把候选原有的证据链与边界静默清空。
          sourceRefs: candidate.evidenceRefs || candidate.sourceRefs || [],
          evidenceRefs: candidate.evidenceRefs || candidate.sourceRefs || [],
          applicableWhen: candidate.applicableWhen || [],
          forbiddenWhen: candidate.forbiddenWhen || [],
        }, formValues));
      } else if (!String(candidate.suggestedScope || '').trim()) {
        await alertUser(T('cognition.candidate_scope_required', '先填写作用范围：没有范围的资产不会被带入任何任务。'));
        return;
      }
      // 版本组防分裂（2026-09-16）：create 候选与现有资产语义高度相似时后端
      // 拦下并返回专用错误码——问用户"仍存新条目"还是回来改为更新。
      // 重锚声明只挂在"主确认"这一次调用上：相似资产的二次选择（`promote(true)`）
      // 是另一条分流，主进程对 create 落点也没有版本比对面。
      const promote = (force, baseline) => api.call('recall.candidates.promote', {
        candidateId,
        forceCreateSimilar: force,
        ...(candidate.risk === 'high' ? { riskAcknowledged: true } : {}),
        ...(baseline ? { confirmBaselineVersion: baseline } : {}),
      });
      let result;
      try {
        result = await promote(false, confirmBaselineVersion);
      } catch (error) {
        // 版本冲突（specs/015 US-702）：这条资产在确认前被改过——**这次没有
        // 生效**（不是部分生效、更不是静默覆盖）。把结构化冲突摆到页面上，按
        // 当前在用版重新展示差异并等用户显式重新确认；不自动重试。
        if (error && error.versionConflict) {
          await openCandidateVersionConflict(candidate, error.versionConflict);
          return;
        }
        if (error && error.code === 'recall_candidate_similar_asset') {
          const info = String(error.message || '').replace(/^similar asset [^ ]+ /, '').replace(/ \(score [\d.]+\)$/, '');
          // 相似确认改双选（2026-09-17 报告建议 F）：此前用「确认=新条目 /
          // 取消=改为更新」——取消不等于取消，用户凭"别乱存"的本能点取消
          // 会被推进一个没预期的流程。uiChoice 三义各归其位：存为新条目 /
          // 更新到该条 / 先不动（真取消）。
          let choice = null;
          if (typeof window.uiChoice === 'function') {
            choice = await window.uiChoice({
              title: T('cognition.candidate_similar_choice_title', '检测到与现有资产高度相似'),
              message: T('cognition.candidate_similar_choice_message', '这条候选与「{info}」高度相似。要怎么处理？', { info }),
              choices: [
                { id: 'create', label: T('cognition.candidate_similar_choice_create', '存为新条目') },
                { id: 'update', label: T('cognition.candidate_similar_choice_update', '更新到该条资产'), style: '' },
              ],
              cancelLabel: T('cognition.candidate_similar_choice_cancel', '先不动'),
            });
          } else {
            choice = await confirmUser(T('cognition.candidate_similar_asset_confirm', '检测到与现有资产高度相似（{info}）。确认 = 保存为新条目；取消 = 改为对它的更新。', { info })) ? 'create' : 'update';
          }
          if (choice === 'create') {
            result = await promote(true);
          } else if (choice === 'update') {
            const match = String(error.message || '').match(/^similar asset ([A-Za-z0-9-]+)/);
            const targetAssetId = match ? match[1] : '';
            if (targetAssetId) {
              await api.call('recall.candidates.update', {
                candidateId,
                judgment: candidate.judgment,
                value: candidate.value || '',
                summary: candidate.summary || '',
                suggestedType: candidate.suggestedType,
                suggestedScope: candidate.suggestedScope || 'general',
                suggestedAction: 'update',
                targetAssetId,
                risk: candidate.risk || 'low',
                sourceRefs: candidate.evidenceRefs || candidate.sourceRefs || [],
                evidenceRefs: candidate.evidenceRefs || candidate.sourceRefs || [],
              });
              toast(T('cognition.candidate_switched_to_update', '已改为更新——请对照差异后确认'));
              await NS.reload();
            }
            return;
          } else {
            return; // 先不动：真正的取消，什么都不发生。
          }
        } else {
          throw error;
        }
      }
      // 存量候选没有记录任务当时的版本（`versionCheckSkipped`）：主进程没有可
      // 核对的对象，这次确认照常生效——但必须如实说清"无法核对改进对象"，绝不
      // 假装核过（T022⑤）。这条只出现在确认成功的返回体上。
      if (result && result.versionCheckSkipped === true) {
        toast(T('cognition.candidate_version_check_skipped', '这条候选没有记录任务当时的版本，无法核对改进对象；本次确认按当前内容生效。'), 'warning');
      }
      // 确认已落地：冲突状态不再成立（重锚成功也走这里）。
      store.candidateVersionConflict = null;
      // 晋升可能改变个人画像投影：异步刷新本体，失败只提醒不阻断（资产已落库）。
      void (async () => {
        if (typeof window.refreshPersonalOntology !== 'function') return;
        try {
          await window.refreshPersonalOntology();
        } catch (error) {
          toast(T('personalOntology.profile_sync_warning', '资产已保存，个人画像自动更新未完成，稍后可重试。'), 'warning');
        }
      })();
      if (result && result.assetId) {
        toast(T('cognition.candidate_promoted', '已成为正式资产'), 'success');
        // 检修剪：update 候选确认会 bump 目标资产版本——曾缓存的版本链失效。
        if (candidate && candidate.targetAssetId) store.assetVersions = null;
        router.go({ name: 'overview', assetId: result.assetId });
      } else {
        toast(T('cognition.candidate_promoted', '已成为正式资产'), 'success');
        router.go({ name: 'review' });
      }
      await NS.reload();
    },
    async decideCandidate(candidateId, action) {
      const channel = CANDIDATE_CHANNELS[action];
      if (!channel) return;
      await api.call(channel, { candidateId });
      // 已处置（稍后/拒绝/忽略）：冲突提示不再成立——候选已离开待确认。
      if (store.candidateVersionConflict && String(store.candidateVersionConflict.candidateId) === String(candidateId)) {
        store.candidateVersionConflict = null;
      }
      if (action === 'defer') {
        // 「稍后处理」的提示与导航随语境分流（2026-09-16 子安口径）：
        // 整理页=内容被送进待我处理，提示去向；待我处理页内=人已在此，
        // "已进入待处理"没有信息量，处理完这条直接回列表即反馈。
        if (String(store.route && store.route.name || '') === 'review') {
          router.go({ name: 'review' });
        } else {
          toast(T('cognition.candidate_deferred', '已进入待处理'));
        }
      } else {
        toast({ reject: T('cognition.candidate_rejected', '已拒绝'), ignore: T('cognition.candidate_ignored', '已忽略') }[action] || T('common.done', '已完成'));
      }
      await NS.reload();
    },
    async rateProof(proofId, feedback, extra) {
      await api.call('recall.proofs.effectiveness.feedback', Object.assign({ transferProofId: proofId, feedback }, extra || {}));
      toast(T('cognition.proof_rating_done', '已记下这次评价'));
      await NS.reload();
    },
    async assetAction(assetId, action) {
      const channels = {
        pause: 'recall.assets.pause', resume: 'recall.assets.resume', revoke: 'recall.assets.revoke',
        archive: 'recall.assets.archive', restore: 'recall.assets.restore',
        delete: 'recall.assets.delete', purge: 'recall.assets.purge',
      };
      const channel = channels[action];
      if (!channel) return;
      const dangerCopy = {
        delete: T('cognition.asset_delete_confirm', '删除会从资产列表移除该资产，但保留历史；确认删除？'),
        purge: T('cognition.asset_purge_confirm', '彻底清除会删除全部历史与证据，且不可恢复。确认清除？'),
        revoke: T('cognition.asset_revoke_confirm', '撤回使用只影响未来的任务，历史记录保留。确认撤回？'),
      };
      if (dangerCopy[action]) {
        const ok = await confirmUser(dangerCopy[action], true);
        if (!ok) return;
      }
      await api.call(channel, { assetId });
      // 删除给时间感（报告建议 G）：保留期常量 30 天在后端标注 TODO(产品确
      // 认)，文案先按现值显示，定稿后同步。
      toast(action === 'delete'
        ? T('cognition.asset_delete_done_retention', '已删除，30 天内可在「已删除」中恢复')
        : T('cognition.asset_action_done', '已完成'));
      if (action === 'delete' || action === 'purge') router.go({ name: 'overview' });
      await NS.reload();
    },
    /** 选用历史版本为在用版（版本组 2026-09-16）：切指针不产生新版本号。 */
    async selectAssetVersion(assetId, version) {
      await api.call('recall.assets.versions.select', { assetId, version });
      toast(T('cognition.asset_version_selected', '已选用 v{n}', { n: String(version) }));
      store.assetVersions = null;
      await NS.reload();
    },
    /** 发起一轮大扫除（specs/008 US-403）：只做不改变含义的整理，拿不准的进清单。 */
    async runCleanup() {
      store.cleanupReports = { loading: true, reports: (store.cleanupReports && store.cleanupReports.reports) || [] };
      NS.notify();
      try {
        const result = await api.call('recall.cleanup.run', { trigger: 'user' });
        const report = (result && result.report) || null;
        toast(T('cognition.cleanup_done', '整理完成：执行 {applied} 项，拿不准 {uncertain} 项', {
          applied: String(((report && report.items) || []).filter((item) => item.status === 'applied').length),
          uncertain: String(((report && report.uncertain) || []).length),
        }));
        store.cleanupReports = { loading: false, stale: true, reports: [] };
      } catch (error) {
        store.cleanupReports = { loading: false, stale: true, reports: [] };
        throw error;
      }
      await NS.reload();
    },
    /** 待办处置（specs/008 T051；specs/010 扩展可选参数）：动作由读模型给出，
     *  这里只转发。没有一键动作的类别不在这里——渲染层也不给按钮。
     *  `params`（specs/010）：classify 带 `level`；set_boundary 带
     *  `applicableWhen`/`forbiddenWhen`；keep/merge 带 `targetAssetId`。 */
    async resolveInboxItem(id, action, params) {
      const payload = { id: String(id || ''), action: String(action || '') };
      if (params && params.level) payload.level = String(params.level);
      if (params && Array.isArray(params.applicableWhen)) payload.applicableWhen = params.applicableWhen.map(String);
      if (params && Array.isArray(params.forbiddenWhen)) payload.forbiddenWhen = params.forbiddenWhen.map(String);
      if (params && params.targetAssetId) payload.targetAssetId = String(params.targetAssetId);
      await api.call('cognition.inbox.resolve', payload);
      toast(T('cognition.inbox_resolved', '已处理'));
      await NS.reload();
    },
    /** 聚合条目批量定级（specs/010 T023/T025）：逐条结果如实上屏——部分失败
     *  不是整体失败，也不谎报全绿。返回结果供调用方做行内明细呈现。 */
    async classifyAssetsBatch(assetIds, level) {
      const ids = (Array.isArray(assetIds) ? assetIds : []).map(String).filter(Boolean);
      const result = await api.call('recall.assets.sensitivity.batch', { assetIds: ids, level: String(level || '') });
      const applied = Array.isArray(result && result.applied) ? result.applied.length : 0;
      const failed = Array.isArray(result && result.failed) ? result.failed : [];
      const skipped = Array.isArray(result && result.skipped) ? result.skipped.length : 0;
      if (!failed.length) {
        toast(T('cognition.inbox_batch_done', '已分级 {applied} 条（跳过 {skipped} 条）', { applied: String(applied), skipped: String(skipped) }));
      } else {
        toast(T('cognition.inbox_batch_partial', '分级 {applied} 条，{failed} 条没成功——失败的留在待办里', { applied: String(applied), failed: String(failed.length) }));
      }
      await NS.reload();
      return { applied, failed, skipped };
    },
    /** 「已删除」列表按需拉（specs/008 US-306/T051）：保留期剩余天数由服务端现算。 */
    async loadDeletedAssets() {
      if (store.deletedAssets && !store.deletedAssets.stale) return;
      store.deletedAssets = { loading: true, items: (store.deletedAssets && store.deletedAssets.items) || [], total: (store.deletedAssets && store.deletedAssets.total) || 0 };
      NS.notify();
      let items = [];
      let total = 0;
      try {
        const result = await api.call('recall.assets.deleted.list', { limit: 200 });
        items = (result && result.items) || [];
        total = Number(result && result.total) || items.length;
      } catch (error) {
        items = [];
        total = 0;
      }
      store.deletedAssets = { loading: false, items, total };
      NS.notify();
    },
    /** 保留期内的「立即彻底删除」（入口只在这里，specs/008 US-306 口径）。 */
    async purgeDeletedAsset(assetId) {
      await api.call('recall.assets.deleted.purgeNow', { assetId: String(assetId || '') });
      toast(T('cognition.deleted_purged', '已彻底删除：内容与记录一并清除，不可恢复'));
      store.deletedAssets = { loading: false, stale: true, items: (store.deletedAssets && store.deletedAssets.items) || [], total: (store.deletedAssets && store.deletedAssets.total) || 0 };
      await NS.reload();
    },
    /** 巡检开关（specs/008 US-405 T049）：关掉之后不再自动运行；
     *  手动触发不受影响（那是用户自己要的）。 */
    async setInspectionEnabled(enabled) {
      await api.call('recall.inspection.settings.set', { enabled: Boolean(enabled) });
      toast(enabled
        ? T('cognition.inspection_switch_on_toast', '已开启后台巡检')
        : T('cognition.inspection_switch_off_toast', '已关闭后台巡检：不再自动巡检'));
      store.inspection = { loading: false, stale: true, settings: (store.inspection && store.inspection.settings) || null, latestRun: (store.inspection && store.inspection.latestRun) || null };
      await NS.reload();
    },
    /** 手动跑一轮巡检（与开关无关）。 */
    async runInspection() {
      await api.call('recall.inspection.run', {});
      const result = await api.call('recall.inspection.list', { limit: 1 });
      const run = ((result && result.runs) || [])[0] || null;
      toast(T('cognition.inspection_done', '巡检完成：发现 {n} 条待处理', { n: String(((run && run.findings) || []).length) }));
      store.inspection = { loading: false, stale: true, settings: (store.inspection && store.inspection.settings) || null, latestRun: run };
      await NS.reload();
    },
    /** 逐项回滚：报告项自带的锚点就是回滚入口（US-404 已建的机制，不另造一套）。 */
    async rollbackCleanupItem(assetId, version) {
      await api.call('recall.assets.rollback', { assetId, version });
      toast(T('cognition.cleanup_rolled_back', '已回滚到整理前的内容（生成新版本）'));
      store.cleanupReports = { loading: false, stale: true, reports: (store.cleanupReports && store.cleanupReports.reports) || [] };
      await NS.reload();
    },
    /** 拿不准项的处置：只给意见，不执行动作（当初就是因为拿不准才没动手）。 */
    async decideCleanupItem(reportId, assetId, decision) {
      await api.call('cognition.inbox.resolve', { id: `cleanup:${reportId}:${assetId}`, action: decision });
      toast(decision === 'reject'
        ? T('cognition.cleanup_decided_dismissed', '已标记不管，从清单移走')
        : T('cognition.cleanup_decided_deferred', '已放到回头再看'));
      store.cleanupReports = { loading: false, stale: true, reports: (store.cleanupReports && store.cleanupReports.reports) || [] };
      await NS.reload();
    },
    /** 一步回滚到某次改动前（specs/008 US-404 T030）：拿旧版内容生成**新版本**，
     *  历史不回退（已引用旧版的任务不受影响），回滚本身也进台账。
     *  与「切回此版」的分工：那是切在用指针、不产生新版本；这是留一次改动痕迹，
     *  所以"改动 → 回滚"在履历里成对出现，看得出发生过什么。 */
    async rollbackAsset(assetId, version) {
      await api.call('recall.assets.rollback', { assetId, version });
      toast(T('cognition.asset_rollback_done', '已回滚到 v{n} 的内容（生成新版本）', { n: String(version) }));
      store.assetVersions = null;
      await NS.reload();
    },
    /** 真删单个版本（2026-09-17）：物理移除该版本记录；引用它的已确认注入
     *  在服务端冻结内容副本后继续可用。危险操作，双按钮确认。 */
    async deleteAssetVersion(assetId, version) {
      const ok = await confirmUser(T('cognition.asset_version_delete_confirm',
        '永久删除 v{n}，不可恢复。引用过它的已确认注入会继续使用保留的内容副本。确认删除？', { n: String(version) }), true);
      if (!ok) return;
      await api.call('recall.assets.versions.delete', { assetId, version });
      toast(T('cognition.asset_version_deleted', '已删除 v{n}', { n: String(version) }));
      if (String(store.route.assetVersionId || '') === String(version)) {
        router.go({ name: 'overview', assetId: String(store.route.assetId || ''), assetVersionId: '' }, { replace: true });
      }
      store.assetVersions = null;
      await NS.reload();
    },
    /** 基于某一版修改（2026-09-17 子安口径：编辑入口只在版本行）：历史版
     *  先设为在用（select 通道，切指针不产新版本），再进入编辑——"切回+
     *  编辑"合一步，每个版本都能成为编辑起点。 */
    async editFromVersion(assetId, version) {
      const asset = (store.assets || []).find((a) => String(a.id) === String(assetId));
      if (!asset) return;
      if (String(asset.activeVersion || asset.version) !== String(version)) {
        await api.call('recall.assets.versions.select', { assetId, version });
        toast(T('cognition.asset_version_selected', '已选用 v{n}', { n: String(version) }));
        store.assetVersions = null;
        await NS.reload();
      }
      router.go({ name: 'overview', assetId, assetVersionId: '', assetVersionDiff: '', assetEdit: '1' }, { replace: true });
    },
    /** 族改名（2026-09-22 快赢）：组头内联输入 → recall.families.rename
     *  批量写族内全部成员的 familyName；空名=恢复默认短名。 */
    async renameFamily(anchorAssetId) {
      const input = document.querySelector(`[data-family-name]`);
      const name = input ? String(input.value || '').trim() : '';
      await api.call('recall.families.rename', { anchorAssetId, name });
      toast(name ? T('cognition.family_renamed', '已命名为「{name}」', { name }) : T('cognition.family_name_cleared', '已恢复默认名'));
      router.go({ name: 'overview', familyRename: '' }, { replace: true });
      await NS.reload();
    },
    async enterFamilyRename(anchorAssetId) {
      router.go({ name: 'overview', familyRename: anchorAssetId }, { replace: true });
    },
    async exitFamilyRename() {
      router.go({ name: 'overview', familyRename: '' }, { replace: true });
    },
    /** 用户主动使用（2026-09-19）：把这条资产钉到最近会话——confirmed 投影
     *  + 投影卡，下一轮起注入命中，卡上可撤销。lastConversationCid 由
     *  state.js 记录（切面板不清空）；还没进过任何对话时给出口径提示。 */
    async attachAssetToConversation(assetId) {
      const cid = (typeof lastConversationCid !== 'undefined' && lastConversationCid) ? String(lastConversationCid) : '';
      if (!cid) {
        toast(T('cognition.asset_use_in_chat_no_chat', '还没有可用的对话——先在任意会话里说一句话，再回来钉它。'));
        return;
      }
      const asset = store.assets.find((a) => String(a.id) === String(assetId));
      try {
        const result = await api.call('recall.projections.attachToConversation', { assetId, conversationId: cid });
        if (result && result.ok) {
          toast(T('cognition.asset_use_in_chat_done', '已挂到当前对话：下一轮起生效，会话里的卡片可随时撤销。'));
        }
      } catch (error) {
        // 拦截必须可见并说明规则（US-604 AC1）：此前这里没有 try/catch，失败
        // 只落 logger，用户看到的是"点了没反应"——静默忽略正是验收问题⑤。
        await NS.reportBlocked(error, asset && asset.title);
      }
    },
    // confirmAssetOrigin（转正）已随出身收敛退役（2026-09-20）：模型记的=已
    // 确定，出身升格动作失去意义；views 侧按钮已删。
    /** 手动编辑资产（2026-09-17 报告建议 A）：改动自己写的话不该以"系统先
     *  产候选"为前提。与现值逐字段比对，无实际修改不提交——后端没有内容
     *  等价检查，相同内容也会 bump 出空版本。 */
    async editAsset(assetId) {
      const card = document.querySelector('.ca-asset-edit');
      const asset = (store.assets || []).find((a) => String(a.id) === String(assetId));
      if (!card || !asset) return;
      const raw = (name) => { const el = card.querySelector(`[data-f="${name}"]`); return el ? String(el.value || '').trim() : ''; };
      const splitList = (text) => (text ? String(text).split(/[、;；,，\n]/).map((s) => s.trim()).filter(Boolean) : []);
      const payload = {
        title: raw('title'),
        statement: raw('statement'),
        applicableWhen: splitList(raw('applicable')),
        forbiddenWhen: splitList(raw('forbidden')),
      };
      // 谁能看见（2026-09-19 刀一·面板暴露）：scopePolicy 白名单的 Agent/空间
      // 维度在此编辑；与现值不同才随保存提交（不产空版本），空输入＝清除限制。
      const policy = asset.scopePolicy || {};
      const visibleAgents = splitList(raw('visible-agents'));
      const visibleSpaces = splitList(raw('visible-spaces'));
      const visibilityChanged = JSON.stringify(visibleAgents) !== JSON.stringify(policy.agentIds || [])
        || JSON.stringify(visibleSpaces) !== JSON.stringify(policy.workspaceIds || []);
      if (visibilityChanged) {
        payload.scopePolicy = {
          ...(visibleAgents.length ? { agentIds: visibleAgents } : {}),
          ...(visibleSpaces.length ? { workspaceIds: visibleSpaces } : {}),
        };
      }
      // 敏感级（specs/010 T026）：分段控件只在用户点选后才带 data-level——
      // 没点＝维持现状（未分级不预设 L0）；点了且与现值不同才随保存提交。
      const sensitivityEl = card.querySelector('[data-f="sensitivity"]');
      const pickedLevel = sensitivityEl ? String(sensitivityEl.getAttribute('data-level') || '') : '';
      const sensitivityChanged = Boolean(pickedLevel) && pickedLevel !== String(asset.sensitivity || '');
      if (sensitivityChanged) payload.sensitivity = pickedLevel;
      const unchanged = payload.title === String(asset.title || '')
        && payload.statement === String(asset.statement || '')
        && JSON.stringify(payload.applicableWhen) === JSON.stringify((asset.applicableWhen || []))
        && JSON.stringify(payload.forbiddenWhen) === JSON.stringify((asset.forbiddenWhen || []))
        && !visibilityChanged
        && !sensitivityChanged;
      const exitEdit = () => router.go({ name: 'overview', assetId, assetEdit: '' }, { replace: true });
      if (unchanged) {
        toast(T('cognition.asset_edit_unchanged', '内容没有变化，未保存'));
        exitEdit();
        return;
      }
      const result = await api.call('recall.assets.update', { assetId, ...payload, reason: 'user manual edit' });
      const version = String((result && result.asset && result.asset.version) || '');
      toast(T('cognition.asset_edit_saved', '已保存为新版本 v{n}', { n: version }));
      store.assetVersions = null;
      exitEdit();
      await NS.reload();
    },
    /** 推荐卡「知道了」（2026-09-21 Phase 5 闭环）：确认已了解系统建议
     *  （暂停/返工），后端清除 recommendedAction 并写 recommendation_cleared
     *  审计。推荐是告知不是强制——确认只清卡，不改变资产状态。 */
    async acknowledgeAssetRecommendation(assetId) {
      const result = await api.call('recall.assets.update', {
        assetId,
        acknowledgeRecommendation: true,
        reason: 'user acknowledged recommendation',
      });
      if (!result || !result.ok) return;
      toast(T('cognition.asset_recommend_cleared', '已确认，推荐卡已清除'));
      store.assetVersions = null;
      await NS.reload();
    },
    /** 两版合并为新版（2026-09-17 报告建议 H）：把所选版正文接在在用版正文
     *  之后存为新版本（只合并正文，标题/范围取在用版）；合并后可用「编辑」
     *  整理措辞。合成结果与在用版相同则不提交（后端无内容等价检查）。 */
    async mergeAssetVersion(assetId, version) {
      const state = store.assetVersions;
      const asset = (store.assets || []).find((a) => String(a.id) === String(assetId));
      if (!state || state.assetId !== String(assetId) || !asset) return;
      const pick = (v) => (state.versions || []).find((x) => String(x.version) === String(v));
      const activeV = pick(asset.activeVersion || asset.version);
      const targetV = pick(version);
      if (!activeV || !targetV) return;
      const activeText = String((activeV.snapshot && activeV.snapshot.statement) || '').trim();
      const targetText = String((targetV.snapshot && targetV.snapshot.statement) || '').trim();
      if (!targetText || targetText === activeText) {
        toast(T('cognition.asset_version_merge_same', '所选版正文与在用版一致，无需合并'));
        return;
      }
      const ok = await confirmUser(T('cognition.asset_version_merge_confirm',
        '将把 v{n} 的正文接在在用版正文之后，保存为新版本；保存后可用「编辑」整理措辞。确认合并？', { n: String(version) }), true);
      if (!ok) return;
      const merged = `${activeText}\n\n${targetText}`;
      const result = await api.call('recall.assets.update', {
        assetId, statement: merged, reason: `merge versions v${String(asset.activeVersion || asset.version)}+v${String(version)}`,
      });
      toast(T('cognition.asset_edit_saved', '已保存为新版本 v{n}', { n: String((result && result.asset && result.asset.version) || '') }));
      store.assetVersions = null;
      await NS.reload();
    },
    /** 同义资产归并（2026-09-16 存量治理）：本条并入目标条目（版本链续接、
     *  本条归档）。破坏性低但影响面大（两条合一），双重确认。 */
    async mergeAssets(sourceAssetId, targetAssetId) {
      const target = (store.assets || []).find((a) => String(a.id) === String(targetAssetId));
      const ok = await confirmUser(T('cognition.asset_merge_confirm', '将把本条的全部历史版本并入「{title}」，本条归档不再单独显示。确认合并？', { title: (target && target.title) || targetAssetId }), true);
      if (!ok) return;
      await api.call('recall.assets.merge', { sourceAssetId, targetAssetId });
      toast(T('cognition.asset_merge_done', '已合并为同一版本组'));
      // 检修剪：target 的版本链缓存必须失效（曾在本次会话打开过它的详情）。
      store.assetVersions = null;
      router.go({ name: 'overview', assetId: targetAssetId });
      await NS.reload();
    },
    /* ── 经验目录管理（specs/016 US-803，契约 E3~E6）──────────────────────
     *  四个动作全走经验专属通道（与 recall.assets.* 零调用——隔离边界）；
     *  危险动作（归档/合并）二次确认，归档原因必填（uiPrompt 收集，进台账）。 */
    /** 动作后的统一刷新：列表 force 重拉；仍停在这条详情上时详情也重拉。 */
    async refreshExperience(experienceId) {
      await NS.loadExperiences(true);
      if (experienceId && String(store.route.experienceId || '') === String(experienceId)) {
        await NS.loadExperienceDetail(experienceId, true);
      }
    },
    async experienceStatusToggle(experienceId, action) {
      if (action !== 'pause' && action !== 'resume') return;
      try {
        await api.call('recall.experiences.setStatus', { experienceId, action });
      } catch (error) { throw new Error(experienceActionErrorText(error)); }
      toast(action === 'pause'
        ? T('cognition.experience_paused_toast', '已暂停：新任务的清单不再带入这条经验')
        : T('cognition.experience_resumed_toast', '已恢复：下一轮清单重新带入'));
      await this.refreshExperience(experienceId);
    },
    async experienceSetType(experienceId, type) {
      if (!['lesson', 'workflow', 'gap', 'uncategorized'].includes(String(type || ''))) return;
      try {
        await api.call('recall.experiences.setType', { experienceId, experienceType: type });
      } catch (error) { throw new Error(experienceActionErrorText(error)); }
      toast(T('cognition.experience_type_changed_toast', '已调整为「{type}」', { type: experienceTypeLabel(type) }));
      await this.refreshExperience(experienceId);
    },
    async experienceMerge(sourceExperienceId, targetExperienceId) {
      const target = ((store.experiences && store.experiences.items) || [])
        .find((row) => String(row.id) === String(targetExperienceId));
      // 危险动作二次确认（R1 seam 契约）：合并把 source 的来源与证据并入目标、
      // source 转「已并入」不再单独显示——影响的条目名必须出现在确认文案里。
      const ok = await confirmUser(T('cognition.experience_merge_confirm', '将把本条的全部来源与证据并入「{title}」，本条转为「已并入」不再单独显示。确认合并？', { title: (target && target.title) || T('cognition.experience_merge_pick_target', '所选目标') }), true);
      if (!ok) return;
      try {
        await api.call('recall.experiences.merge', { sourceExperienceId, targetExperienceId });
      } catch (error) { throw new Error(experienceActionErrorText(error)); }
      toast(T('cognition.experience_merge_done', '已合并：来源与历史并入目标条目'));
      // 合并后看目标条目（同 mergeAssets 的落点：结果在哪，人就被带到哪）。
      if (String(store.route.experienceId || '') === String(sourceExperienceId)) {
        router.go({ name: 'experiences', experienceId: targetExperienceId });
      }
      await NS.loadExperiences(true);
      await NS.loadExperienceDetail(targetExperienceId, true);
    },
    async experienceArchive(experienceId) {
      // 归档原因必填（E6 契约）：先收原因——这一步本身就是一次显式确认；
      // 再走危险确认，与资产删除的二次确认口径一致。
      const reason = await promptUser(T('cognition.experience_archive_reason_prompt', '填写这条经验过期或失效的清理原因（必填，会记录进台账）'));
      if (reason == null) return; // 取消 = 不动
      if (!String(reason).trim()) {
        toast(T('cognition.experience_archive_reason_required', '清理原因必填：没有原因的归档不会被接受。'), 'warning');
        return;
      }
      const ok = await confirmUser(T('cognition.experience_archive_confirm', '归档后这条经验不再进入任何清单；历史与已冻结的引用仍可读。确认归档？'), true);
      if (!ok) return;
      try {
        await api.call('recall.experiences.archive', { experienceId, reason: String(reason).trim() });
      } catch (error) { throw new Error(experienceActionErrorText(error)); }
      toast(T('cognition.experience_archive_done', '已归档：已记录原因与时间'));
      // 归档后回列表（详情对象已终态，继续停在详情没有管理出口）。
      if (String(store.route.experienceId || '') === String(experienceId)) {
        router.go({ name: 'experiences', experienceId: '' }, { replace: true });
      }
      await this.refreshExperience(experienceId);
    },
    /* ── 存量迁移（specs/016 US-801，契约 E7/E8）────────────────────────── */
    async experienceMigrationPreview() {
      await NS.loadExperienceMigrationPreview(true);
    },
    async experienceMigrationRun(assetIds) {
      const ids = [...new Set((assetIds || []).map((id) => String(id || '').trim()).filter(Boolean))];
      if (!ids.length) return;
      const ok = await confirmUser(T('cognition.experience_migration_run_confirm', '将迁移以上 {n} 条经验类资产：先冻结历史引用，再写入经验目录并从资产库迁出；跳过与失败会如实列出。确认执行？', { n: String(ids.length) }), true);
      if (!ok) return;
      let result;
      try {
        result = await api.call('recall.experiences.migration.run', { assetIds: ids });
      } catch (error) { throw new Error(experienceActionErrorText(error)); }
      const migrated = (result && result.migrated) || 0;
      const skipped = (result && result.skipped) || 0;
      const failed = (result && result.failed) || 0;
      // 结果走 uiAlert 可核对（R1：toast 一句话了事不满足「可核对」），
      // 随后重拉预览与列表——预览清单必须反映迁出后的真实存量。
      await alertUser(T('cognition.experience_migration_result', '迁移完成：已迁 {migrated} 条，跳过 {skipped} 条，失败 {failed} 条', { migrated: String(migrated), skipped: String(skipped), failed: String(failed) }));
      // 结果同时摆进折叠区（lastRun 可核对），并重拉预览与列表——预览清单
      // 必须反映迁出后的真实存量。
      store.experienceMigration = { preview: null, previewLoading: false, previewFailed: false, lastRun: result || null };
      NS.notify();
      await NS.loadExperiences(true);
      void NS.loadExperienceMigrationPreview(true);
      return result;
    },
    async experienceMigrationStatus() {
      await NS.loadExperienceMigrationStatus();
      const lastRun = store.experienceMigration && store.experienceMigration.lastRun;
      if (!lastRun) {
        toast(T('cognition.experience_migration_none_run', '还没有执行过迁移'), 'warning');
        return;
      }
      const migrated = lastRun.migrated || 0;
      const skipped = lastRun.skipped || 0;
      const failed = lastRun.failed || 0;
      toast(T('cognition.experience_migration_last_run', '上次迁移：已迁 {migrated} 条，跳过 {skipped} 条，失败 {failed} 条', { migrated: String(migrated), skipped: String(skipped), failed: String(failed) }));
    },
    /* ── 标签系统（specs/012 US-201，T010 单打标 / T011 批量 / T013 管理）───
     *  写路径全走 recall.assets.tags.set|batch 与 recall.tags.rename|merge|delete
     *  （主进程侧唯一写路径 updateAbilityAsset）；批量按 ≤200/批循环，进度与
     *  逐项失败清单进 store.tagBatch（中断后已完成项保留、可重跑：同名标签
     *  不会重复加）。 */
    async refreshTags(includeRetired) {
      await NS.reload();
      await NS.loadTags({ force: true, includeRetired: Boolean(includeRetired) });
    },
    /** 单条打标（T010，整组替换语义）。 */
    async setAssetTags(assetId, tags) {
      await api.call('recall.assets.tags.set', { assetId, tags });
      toast(T('cognition.tag_added_toast', '已打标'));
      await this.refreshTags();
    },
    async addAssetTag(assetId, name) {
      const asset = (store.assets || []).find((row) => String(row.id) === String(assetId));
      if (!asset) return;
      const raw = String(name || '').trim();
      if (!raw) return;
      const key = (value) => String(value || '').trim().toLocaleLowerCase();
      const current = Array.isArray(asset.tags) ? asset.tags : [];
      // 同名（大小写不敏感）不新增第二枚（renderer-seams §2.1）。
      if (current.some((entry) => key(entry) === key(raw))) {
        toast(T('cognition.tag_duplicate_hint', '已有同名标签（不区分大小写），不再重复添加'), 'warning');
        return;
      }
      await this.setAssetTags(assetId, [...current, raw]);
    },
    async removeAssetTag(assetId, name) {
      const asset = (store.assets || []).find((row) => String(row.id) === String(assetId));
      if (!asset) return;
      const key = (value) => String(value || '').trim().toLocaleLowerCase();
      const current = Array.isArray(asset.tags) ? asset.tags : [];
      const next = current.filter((entry) => key(entry) !== key(name));
      if (next.length === current.length) return;
      await api.call('recall.assets.tags.set', { assetId, tags: next });
      toast(T('cognition.tag_removed_toast', '已移除「{name}」', { name: String(name || '') }));
      await this.refreshTags();
    },
    /** 列表批量打标（T011）：三选一语义（replace 与 add/remove 不混）；
     *  整批 IPC 拒绝时按本地名单逐项记失败，失败清单不截断。 */
    async batchTags(names, opOverride) {
      const op = opOverride || store.tagBatchOp || 'add';
      const ids = [...store.tagSelectIds];
      if (!ids.length) { toast(T('cognition.tag_batch_none_selected', '先勾选要打标的资产'), 'warning'); return; }
      const key = (value) => String(value || '').trim().toLocaleLowerCase();
      const wanted = (Array.isArray(names) ? names : [names]).map((value) => String(value || '').trim()).filter(Boolean);
      if (!wanted.length) { toast(T('cognition.tag_batch_no_tags', '先填标签名'), 'warning'); return; }
      const seen = new Set();
      const unique = wanted.filter((value) => {
        if (seen.has(key(value))) return false;
        seen.add(key(value));
        return true;
      });
      const opPayload = op === 'replace' ? { replace: unique } : op === 'remove' ? { remove: unique } : { add: unique };
      store.tagBatch = { running: true, done: 0, total: ids.length, updated: 0, unchanged: 0, failed: [] };
      NS.notify();
      let updated = 0;
      let unchanged = 0;
      const failed = [];
      const CHUNK = 200;
      for (let at = 0; at < ids.length; at += CHUNK) {
        const chunk = ids.slice(at, at + CHUNK);
        try {
          const result = await api.call('recall.assets.tags.batch', { assetIds: chunk, op: opPayload });
          const report = (result && result.report) || { updated: 0, unchanged: 0, items: [] };
          updated += Number(report.updated || 0);
          unchanged += Number(report.unchanged || 0);
          failed.push(...(report.items || []).filter((item) => String(item.status || '') === 'failed'));
        } catch (error) {
          failed.push(...chunk.map((assetId) => ({
            assetId,
            title: ((store.assets || []).find((row) => String(row.id) === String(assetId)) || {}).title || '',
            note: String((error && error.message) || error),
            status: 'failed',
          })));
        }
        store.tagBatch = { running: true, done: Math.min(at + CHUNK, ids.length), total: ids.length, updated, unchanged, failed };
        NS.notify();
      }
      store.tagBatch = { running: false, done: ids.length, total: ids.length, updated, unchanged, failed };
      NS.notify();
      toast(T('cognition.tag_batch_done', '批量完成：改 {updated} 条，未变 {unchanged} 条，失败 {failed} 条', { updated: String(updated), unchanged: String(unchanged), failed: String(failed.length) }), failed.length ? 'warning' : 'success');
      await this.refreshTags(String(store.route.tagOverlay || '') === 'manage');
    },
    /** 管理三动作（T013）。合并前必须显示影响面；删除确认语含「只摘除标签，
     *  资产本身不受影响」；完成 toast 的数字与实际一致（0 条不显示数字）。 */
    async renameTag(tagId) {
      const input = document.querySelector('[data-tag-rename-input]');
      const name = input ? String(input.value || '').trim() : '';
      if (!name) return;
      const key = (value) => String(value || '').trim().toLocaleLowerCase();
      const tag = ((store.tags && store.tags.items) || []).find((row) => String(row.id) === String(tagId));
      const old = String((tag && tag.name) || '');
      if (key(name) === key(old)) { store.tagManageEdit = ''; NS.notify(); return; }
      const ok = await confirmUser(T('cognition.tag_rename_confirm', '改名后，引用旧名「{old}」的 {n} 条资产会一并改为「{name}」。确认改名？', { old, name, n: String(Number((tag && tag.assetCount) || 0)) }));
      if (!ok) return;
      const result = await api.call('recall.tags.rename', { tagId, name });
      const updated = Number((result && result.report && result.report.updated) || 0);
      toast(updated
        ? T('cognition.tag_renamed_toast', '已改名，{n} 条资产同步更新', { n: String(updated) })
        : T('cognition.tag_renamed_toast_zero', '已改名'));
      store.tagManageEdit = '';
      await this.refreshTags(true);
    },
    async mergeTag(sourceId, targetName) {
      const key = (value) => String(value || '').trim().toLocaleLowerCase();
      const items = (store.tags && store.tags.items) || [];
      const source = items.find((row) => String(row.id) === String(sourceId));
      const target = items.find((row) => row.state === 'active'
        && String(row.id) !== String(sourceId)
        && key(row.name) === key(targetName));
      if (!source || !target) {
        toast(T('cognition.tag_merge_need_target', '先选择要并入的目标标签'), 'warning');
        return;
      }
      const ok = await confirmUser(T('cognition.tag_merge_impact', '将把 {n} 条资产的「{source}」改为「{target}」，源标签将停用。确认合并？', { n: String(Number(source.assetCount || 0)), source: source.name, target: target.name }), true);
      if (!ok) return;
      const result = await api.call('recall.tags.merge', { sourceTagId: source.id, targetTagId: target.id });
      const updated = Number((result && result.report && result.report.updated) || 0);
      toast(updated
        ? T('cognition.tag_merged_toast', '合并完成，{n} 条资产同步更新', { n: String(updated) })
        : T('cognition.tag_merged_toast_zero', '合并完成'));
      store.tagManageMerge = null;
      await this.refreshTags(true);
    },
    async deleteTag(tagId) {
      const tag = ((store.tags && store.tags.items) || []).find((row) => String(row.id) === String(tagId));
      if (!tag) return;
      const ok = await confirmUser(T('cognition.tag_delete_confirm', '只摘除标签，资产本身不受影响。确认停用「{name}」？', { name: String(tag.name || '') }), true);
      if (!ok) return;
      const result = await api.call('recall.tags.delete', { tagId });
      const updated = Number((result && result.report && result.report.updated) || 0);
      toast(updated
        ? T('cognition.tag_deleted_toast', '已停用，{n} 条资产同步更新', { n: String(updated) })
        : T('cognition.tag_deleted_toast_zero', '已停用'));
      await this.refreshTags(true);
    },
    async sourceAction(kind, sourceId, action) {
      const channels = {
        pause: 'recall.sources.pause', resume: 'recall.sources.resume',
        retry: 'recall.sources.retry', reconnect: 'recall.sources.reconnect',
      };
      const channel = channels[action];
      if (!channel) return;
      await api.call(channel, { kind, sourceId });
      toast(T('common.done', '已完成'));
      await NS.reload();
    },
    async teachingRevoke(signalId) {
      await api.call('recall.teaching.revoke', { signalId });
      toast(T('cognition.teaching_revoke_done', '已撤销这条教学记录'));
      await NS.reload();
    },
    async captureAction(captureId, action) {
      // 行内动作直接用后端语义 id（run_now / pause / resume / cancel / retry），
      // 与 vocabulary.CAPTURE_ACTION 的键一字不差；导航类动作（去确认 / 打开
      // 会话等）在 app.js 委托层分流，不到这里。
      const channels = {
        pause: 'recall.captures.pause', resume: 'recall.captures.resume', cancel: 'recall.captures.cancel',
        retry: 'recall.captures.retry', run_now: 'recall.captures.runNow',
      };
      const channel = channels[action];
      if (!channel) return;
      if (action === 'cancel') {
        const ok = await confirmUser(T('cognition.capture_cancel_confirm', '确认取消这个整理任务？'));
        if (!ok) return;
      }
      await api.call(channel, { captureId });
      toast(T('common.done', '已完成'));
      await NS.reload();
    },
    /** 批量控制：ids 由调用方收敛到「当前已加载且该动作可执行」的行。只做
     *  批量重试（2026-09-21 原型 v7 定调）：批量「立即整理」入口不迁移——
     *  每次立即整理都是一次模型额度消耗，用户旅程只需逐条处理；后端
     *  batchRunNow 能力保留但前端不再触达。 */
    async captureBatch(action, ids) {
      if (action !== 'retry' || !ids.length) return;
      const result = await api.call('recall.captures.batchRetry', { captureIds: ids });
      const outcome = (result && result.result) || { succeeded: [], failed: [] };
      if (outcome.failed && outcome.failed.length) {
        toast(T('cognition.capture_batch_partial', '已处理 {ok} 条，{fail} 条没有成功（多为状态已变化）', { ok: String(outcome.succeeded.length), fail: String(outcome.failed.length) }), 'warning');
      } else {
        toast(T('cognition.capture_batch_done', '已处理 {n} 条', { n: String(outcome.succeeded.length) }));
      }
      await NS.reload();
      return outcome;
    },
    async organizeConversation(conversationId) {
      const created = await api.call('recall.captures.historicalAutoStart', { conversationId });
      const capture = created && created.capture;
      // 「开始整理」按钮的语义就是立即提炼：后端这一步只建 waiting_manual 任务
      // （runNow 是既定的唯一额度消耗入口，2026-09-15 用户实测反馈点了没响应），
      // 这里紧跟的那次 runNow 就是按钮点击本身——显式、且只此一次。
      if (capture && capture.status === 'waiting_manual') {
        await api.call('recall.captures.runNow', { captureId: capture.id });
      }
      toast(T('cognition.capture_started', '已开始整理'));
      await NS.reload();
    },
    async updateCaptureSettings(patch) {
      const result = await api.call('recall.captures.settings.update', patch);
      store.captureSettings = (result && result.settings) || store.captureSettings;
      toast(T('common.saved', '已保存'));
      await NS.reload();
    },
  };
  NS.actions = actions;

  /** 旧全局入口兼容（boot.js 的深链调用它）。 */
  /** 从会话消息的 [asset:<id>] 引用卡跳转到认知资产详情页。
   *  conversation.js 调用；不依赖调用方已在认知资产页。
   *  （旧定义在 skills-bindings.js，其词法依赖随 skills.js 瘦身删除，迁到这里。） */
  window.openCognitionAssetById = function openCognitionAssetById(assetId) {
    if (!assetId) return false;
    showRecallPanel();
    router.go({ name: 'overview', category: '', assetId: String(assetId) });
    return true;
  };

  /* ────────────────────────── 个人本体（内嵌工作台） ────────────────────────── */
  /* #panel-personal-ontology 整体内嵌在 #panel-recall（index.html，含骨架与
   * 「返回认知树」按钮），渲染函数来自 personal-ontology.js（随 recall 特性组
   * 加载）。旧实现的显隐控制在 skills.js 被删的 4549 行里；此处接管：
   * overview 常驻入口（views.js）+ boot.js 深链 + 面板内返回按钮。 */

  function showRecallPanel() {
    try {
      if (typeof window._setViewFromSidebar === 'function') window._setViewFromSidebar('recall');
      else document.getElementById('recall-btn')?.click();
    } catch (_) { /* 面板切换失败也要完成路由 */ }
  }

  /** 整理记录行 → 打开来源会话：与「继续工作」「运行中心」同一条全局通道
   *  （setView('conversation', cid)），失败提示而不静默吞掉。 */
  NS.openConversation = function openConversation(conversationId) {
    const cid = String(conversationId || '').trim();
    if (!cid) return false;
    if (typeof window.setView === 'function') {
      window.setView('conversation', cid);
      return true;
    }
    toast(T('cognition.capture_open_conversation_unavailable', '当前页面无法直接打开会话，请从对话列表进入'), 'warning');
    return false;
  };

  function wireOntologyBackButton(section) {
    const back = section.querySelector('[data-cognition-subview-tree]');
    if (!back || back.dataset.ontologyBackWired === '1') return;
    back.dataset.ontologyBackWired = '1';
    back.addEventListener('click', () => { NS.closePersonalOntology(); });
  }

  /* ───────────── 个人本体独立页(2026-09-21 五页签迁移) ───────────── */
  /* 本体不再是"隐藏 ca-root + 整屏替换"的独立形态,而是五页签里的一个路由:
   * 渲染层在 ca-scroll 里放 #ca-ontology-mount,再由这里把 index.html 的
   * #skills-cognition-personal-ontology section 从 parking 容器移进 mount,
   * 调 renderPersonalOntology()。离开路由时先归还 parking 再擦除内容区——
   * section 始终是同一个 DOM 节点,本体内部状态(_pocSelected 等)不销毁。 */

  NS.unmountPersonalOntology = function unmountPersonalOntology() {
    const section = document.getElementById('skills-cognition-personal-ontology');
    if (!section) return;
    const parking = document.getElementById('ca-ontology-parking');
    if (parking && section.parentElement !== parking) parking.appendChild(section);
    section.hidden = true;
    section.classList.remove('is-standalone');
  };

  NS.mountPersonalOntology = async function mountPersonalOntology() {
    showRecallPanel();
    const section = document.getElementById('skills-cognition-personal-ontology');
    const mount = document.getElementById('ca-ontology-mount');
    if (!section || !mount) return;
    // 深链可能早于特性组加载完成:渲染函数不在时按需补载再画。
    if (typeof window.renderPersonalOntology !== 'function') {
      const load = typeof loadRendererFeature === 'function' ? loadRendererFeature : window.loadRendererFeature;
      if (typeof load === 'function') {
        try { await load('personal-ontology'); } catch (_) { /* 渲染函数缺席时下面跳过 */ }
      }
    }
    if (mount.parentElement && section.parentElement !== mount) mount.appendChild(section);
    section.hidden = false;
    section.classList.add('is-standalone');
    wireOntologyBackButton(section);
    if (typeof window.renderPersonalOntology === 'function') {
      try { await window.renderPersonalOntology(); } catch (_) { /* 本体渲染失败不阻塞主 UI */ }
    }
  };

  NS.openPersonalOntology = function openPersonalOntology() {
    NS.router.go({ name: 'ontology' });
  };

  NS.closePersonalOntology = function closePersonalOntology() {
    NS.router.go({ name: 'tree' });
  };
})();
