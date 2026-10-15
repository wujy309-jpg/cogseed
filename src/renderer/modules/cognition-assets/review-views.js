/* ============================================================================
 * 认知资产 · 视图层：系统活动页（cognition-assets/review-views.js）
 *
 * 2026-10-12 收敛：系统活动只承接已形成的夜间认知建议和真实处理历史。
 * viewActivity 提供需要关注（默认）与已处理两个视角：
 *  - 需要关注：夜间价值判断通过、提取完成且证据齐全的具体认知建议。
 *  - 已处理：保留候选的真实终态与历史；后台任务和治理问题不入列。
 * 候选详情（route.candidateId）复用 review-candidate.js 的 viewCandidate。
 * ========================================================================== */
(function () {
  'use strict';

  const NS = window.CogAssets;
  if (!NS) return;
  const { T, esc, fmtDate } = NS;
  const S = NS.store;
  const { btn, hero, empty, chip } = NS.ui;
  const {
    evidenceMostlyUnavailable,
    title: candidateTitle,
  } = NS.candidate;

  /* ────────────────────────── 视图：系统活动 ────────────────────────── */

  const normalizeActivityText = value => String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
  function activityScope(scope) {
    const key = ['general', 'personal', 'report', 'code', 'review', 'product'].includes(scope) ? 'cognition.capture.scope_' + scope : '';
    return key ? T(key, scope) : scope || T('cognition.activity_scope_unknown', '范围待核对');
  }
  const activityDecisionLabels = {
    create: ['cognition.activity_decision_create', '确认保存'], update: ['cognition.activity_decision_update', '核对更新'],
    limit_scope: ['cognition.activity_decision_limit_scope', '核对范围'], pause: ['cognition.activity_decision_pause', '确认停用'],
    keep_current: ['cognition.activity_decision_keep_current', '确认保留现有内容'], reject: ['cognition.activity_decision_reject', '确认忽略'],
  };
  const activityOutcomeLabels = {
    confirmed: ['cognition.activity_outcome_confirmed', '已保存'], integrated: ['cognition.activity_outcome_integrated', '已纳入本体'],
    rejected: ['cognition.activity_outcome_rejected', '已拒绝'], ignored: ['cognition.activity_outcome_ignored', '已忽略'], superseded: ['cognition.candidate_status_expired', '已失效'], expired: ['cognition.activity_outcome_expired', '已过期'],
    update: ['cognition.activity_outcome_update', '已更新'], limit_scope: ['cognition.activity_outcome_limit_scope', '已调整范围'], pause: ['cognition.activity_outcome_pause', '已停用'],
    keep_current: ['cognition.activity_outcome_keep_current', '已保留现有内容'], reject: ['cognition.activity_outcome_reject', '已忽略'],
  };
  function activityResult(candidate, waiting) {
    if (!waiting) {
      // A proposed action describes intent, not the recorded outcome of a completed write.
      if (candidate.status === 'confirmed' && !candidate.promotedAssetId)
        return T('cognition.activity_result_unlocated', '保存结果待核对');
      const label = activityOutcomeLabels[candidate.status];
      return label ? T(label[0], label[1]) : T('cognition.activity_check', '需要核对');
    }
    if (NS.candidate.saveOutcomeUncertain(candidate)) return T('cognition.activity_result_unlocated', '保存结果待核对');
    const caps = candidate.capabilities || {};
    const reasons = caps.ineligibleReasons || [];
    const target = (S.assets || []).find(asset => String(asset.id) === String(candidate.targetAssetId));
    if (S.candidateVersionConflict?.candidateId === candidate.id || (target && candidate.targetVersionUsed
      && String(target.activeVersion || target.version) !== String(candidate.targetVersionUsed)))
      return T('cognition.activity_attention_version', '需重核版本');
    if (reasons.includes('type_conflicts_with_existing')) return T('cognition.activity_attention_conflict', '需裁定冲突');
    if (reasons.some(reason => ['rule_boundary_required', 'rule_missing_boundary'].includes(reason))) return T('cognition.activity_attention_boundary', '需补充边界');
    if (caps.displayState === 'weak_evidence' || evidenceMostlyUnavailable(candidate) || reasons.includes('evidence_missing'))
      return T('cognition.activity_attention_evidence', '需补充或核对证据');
    if (caps.eligibility === 'ineligible') return T('cognition.activity_attention_content', '需修改内容后重核');
    const label = activityDecisionLabels[candidate.suggestedAction || 'create'];
    return label ? T(label[0], label[1]) : T('cognition.activity_check', '需要核对');
  }
  function activityModel() {
    const attention = [], done = [];
    const candidates = S.candidates || [];
    const excluded = new Set(candidates.filter(c => c.activityExclusionReason || NS.isKstarCandidate?.(c)).map(c => c.id));
    const decisionGroups = new Map();
    const sorted = [...candidates].sort((a,b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)));
    for (const c of sorted) {
      if (excluded.has(c.id)) continue;
      const waiting = NS.candidate.attentionReady(c);
      if (!waiting && !['confirmed', 'integrated', 'rejected', 'ignored', 'expired', 'superseded'].includes(c.status)) continue;
      if (c.status === 'weak_observation' && !c.capabilities?.countsAsPending) continue;
      const action = c.suggestedAction || 'create';
      const result = activityResult(c, waiting);
      const activityAt = waiting ? c.createdAt || c.updatedAt || '' : c.updatedAt || c.createdAt || '';
      const row = { key: 'candidate:' + c.id, title: candidateTitle(c), detail: c.judgment || c.value || '', scope: activityScope(c.suggestedScope), rawAt: activityAt, at: fmtDate(activityAt), result: waiting && (c.activityDeferredAt || c.capabilities?.isSnoozed) ? T('cognition.activity_deferred_result', '稍后 · 待处理') + ' · ' + result : result, route: { candidateId: c.id }, candidateIds: [c.id] };
      // 只折叠完全相同、同范围且同治理边界的建议；不同冲突/版本/风险绝不能合并。
      const hasConflict = (S.inbox || []).some(item => item.candidateId === c.id && item.kind !== 'candidate_pending_review');
      const identity = waiting && !hasConflict && !NS.candidate.saveOutcomeUncertain(c) ? JSON.stringify([normalizeActivityText(c.judgment), c.suggestedType, normalizeActivityText(c.suggestedScope), action, c.targetAssetId, c.targetVersionUsed, c.scopePolicy, c.applicableWhen, c.forbiddenWhen, c.risk, c.capabilities?.displayState, c.capabilities?.eligibility, c.ontologyFormation])
        : !waiting && c.reviewDecisionId ? JSON.stringify(['decision', c.reviewDecisionId, c.promotedAssetId || c.targetAssetId, c.suggestedType, c.suggestedScope, normalizeActivityText(c.judgment)]) : row.key;
      const previous = decisionGroups.get(identity);
      if (previous) { previous.candidateIds.push(c.id); continue; }
      decisionGroups.set(identity, row);
      (waiting ? attention : done).push(row);
    }
    // Asset update approvals already have their own version-checked decision service.
    // Project them directly; never manufacture nightly extraction provenance.
    for (const proposal of S.assetApprovals || []) {
      if (!proposal?.id || !proposal.assetId || !proposal.payload || !Array.isArray(proposal.fields)
        || !['pending', 'deferred', 'confirmed', 'rejected', 'superseded'].includes(proposal.state)) continue;
      const asset = (S.assets || []).find(item => String(item.id) === String(proposal.assetId));
      const waiting = ['pending', 'deferred'].includes(proposal.state);
      const label = proposal.state === 'confirmed' ? T('cognition.activity_outcome_update', '已更新')
        : proposal.state === 'rejected' ? T('cognition.inbox_action_reject', '拒绝')
          : proposal.state === 'superseded' ? T('cognition.candidate_status_expired', '已失效')
            : proposal.state === 'deferred' ? T('cognition.activity_deferred_result', '稍后 · 待处理')
              : T('cognition.candidate_status_pending', '待确认');
      const at = waiting ? proposal.createdAt : proposal.decidedAt || proposal.createdAt;
      (waiting ? attention : done).push({ key: 'approval:' + proposal.id,
        title: asset?.title || proposal.assetId, detail: proposal.reason, scope: activityScope(asset?.scope),
        result: label, rawAt: at, at: fmtDate(at), route: { approvalId: proposal.id }, candidateIds: [],
      });
    }
    // 本体逐次保存历史只在对应对象的详情查看；共同确认结果由候选的 integrated 记录承载。
    return { attention, done, excludedCount: excluded.size };
  }
  NS.activityModel = activityModel;

  const ACTIVITY_PAGE_SIZE = 50;
  const ACTIVITY_ACTIONS = Object.freeze(['activity-select', 'activity-tab', 'activity-clear', 'activity-page-select', 'activity-close', 'activity-next', 'activity-save-draft', 'activity-defer', 'activity-history', 'activity-undo-automatic', 'activity-approval', 'formation-recheck']);
  const ACTIVITY_WRITE_ACTIONS = Object.freeze(['activity-save-draft', 'activity-defer']);
  const activityDrafts = new Map();
  let activitySelection = '';
  let activityDrawer = false;
  let activityRendered = false;
  let activityWasNarrow = false;
  let activityQueryTimer;
  const candidateFields = { contentCategory: 'contentCategory', judgment: 'judgment', value: 'value', uncertainty: 'uncertainty', summary: 'summary', scope: 'suggestedScope', applicable: 'applicableWhen', forbidden: 'forbiddenWhen' };
  const narrowActivity = () => !!window.matchMedia && window.matchMedia('(max-width: 960px), (max-height: 480px)').matches;
  const activityRoute = (patch = {}) => Object.assign({}, S.route, { name: 'activity', candidateId: '', inboxId: '', poCandidateId: '', captureId: '', approvalId: '' }, patch);
  function selectedActivityKey(route) {
    return route.approvalId ? 'approval:' + route.approvalId : route.candidateId ? 'candidate:' + route.candidateId : route.inboxId ? 'inbox:' + route.inboxId : route.poCandidateId ? 'legacy:' + route.poCandidateId : activitySelection;
  }
  function activityRowsFor(route, model = activityModel()) {
    const processed = route.activityView === 'done' || route.activityDone === '1';
    const query = normalizeActivityText(route.activityQuery).toLocaleLowerCase();
    return (processed ? model.done : model.attention).filter(row => normalizeActivityText(row.title + ' ' + row.detail + ' ' + row.scope + ' ' + row.result).toLocaleLowerCase().includes(query)).sort((a,b) => String(b.rawAt).localeCompare(String(a.rawAt)));
  }
  function activityCandidate(row, processed) {
    const original = S.candidates.find(c => String(c.id) === String(row.route.candidateId));
    if (!original) return '';
    const draft = activityDrafts.get(String(original.id));
    const candidate = Object.assign({}, original, draft || {});
    // A processed record stays read-only even if a stale server snapshot carries old capabilities.
    if (processed || !NS.candidate.attentionReady(original)) candidate.capabilities = Object.assign({}, candidate.capabilities, { canEdit: false, canPromote: false, canReject: false, canContinueOntology: false, isTerminal: processed || !!original.capabilities?.isTerminal });
    const actor = original.processingActor;
    const reason = original.processingReason || original.decisionNote;
    const processing = processed ? `<div class="ca-activity-processing" role="status"><strong>${esc(row.result)} · ${esc(T('cognition.activity_readonly', '本记录为只读'))}</strong><p>${esc(T('cognition.activity_actor', '处理者'))}：${esc(actor || T('cognition.activity_actor_unknown', '历史记录未提供'))}</p><p>${esc(T('cognition.activity_reason', '处理依据'))}：${esc(reason || T('cognition.activity_reason_unknown', '历史记录未提供处理依据'))}</p></div>` : '';
    return processing + NS.candidate.formCard(candidate, { compact: true }) + (row.candidateIds.length > 1 ? `<p class="note">${esc(T('cognition.activity_related_proposals', '相同建议已在列表合并，原始建议和来源仍分别保留。'))} ${esc(String(row.candidateIds.length))}</p>` : '');
  }
  const approvalFields = ['statement', 'scope', 'applicableWhen', 'forbiddenWhen', 'tags'];
  function readableApproval(proposal) {
    const fields = [...new Set([...(proposal.fields || []), ...Object.keys(proposal.payload || {})])];
    return fields.length > 0 && fields.every(key => approvalFields.includes(key));
  }
  function activityApproval(row, processed) {
    const proposal = (S.assetApprovals || []).find(item => String(item.id) === String(row.route.approvalId));
    if (!proposal) return '';
    const asset = (S.assets || []).find(item => String(item.id) === String(proposal.assetId));
    const read = (label, value) => `<dl class="ca-approval-fact"><dt>${esc(label)}</dt><dd class="content-text">${esc(Array.isArray(value) ? value.join('；') : value || T('cognition.activity_not_recorded', '未记录'))}</dd></dl>`;
    const labels = {
      statement: T('cognition.asset_version_diff_statement', '正文'), scope: T('cognition.asset_version_diff_scope', '适用范围'),
      applicableWhen: T('cognition.asset_version_applicable', '适用场景'), forbiddenWhen: T('cognition.asset_version_forbidden', '禁用场景'),
      tags: T('cognition.asset_edit_field_tags', '标签'),
    };
    const target = asset ? T('cognition.activity_approval_target', '目标：{title} · 当前 v{current} · 提议基于 v{baseline}', { title: asset.title, current: asset.version, baseline: proposal.baselineVersion }) : T('cognition.activity_target_missing', '未读到目标资产');
    const requestedFields = [...new Set([...proposal.fields, ...Object.keys(proposal.payload)])];
    const fields = requestedFields.filter(key => Object.prototype.hasOwnProperty.call(labels, key));
    const canConfirm = readableApproval(proposal) && !processed && !S.candidatesError && !S.assetsError && asset && ['active', 'paused'].includes(asset.status) && String(asset.version) === String(proposal.baselineVersion);
    return `<section class="ca-review-target">${read(T('cognition.activity_target_label', '目标 / 版本'), target)}</section>
      <section class="ca-review-content"><h3>${esc(T('cognition.activity_approval_proposed', '拟更新内容'))}</h3>${fields.map(key => read(labels[key], proposal.payload[key])).join('')}</section>
      <details class="details ca-review-chain"><summary>${esc(T('cognition.activity_chain_title', '依据与版本对比'))}</summary>${fields.map(key => read(labels[key], proposal.beforeValues?.[key])).join('')}</details>
      <section class="ca-review-evidence"><h3>${esc(T('cognition.activity_approval_basis', '提议依据'))}</h3><p class="content-text">${esc(proposal.reason)}</p>${processed ? read(T('cognition.activity_result', '处理结果'), row.result) : ''}<p class="note">${esc(T('cognition.activity_approval_origin', 'AI 提出的资产修改建议；是否生效以审批结果与版本记录为准。'))}</p></section>
      <section class="ca-review-impact"><h3>${esc(T('cognition.activity_impact_title', '保存的影响'))}</h3><p>${esc(T('cognition.activity_approval_impact', '批准后更新目标资产并记录新版本；稍后处理保留待审批状态，拒绝会关闭此提议。'))}</p>${!processed && !canConfirm ? `<p role="status">${esc(T('cognition.activity_approval_blocked', '目标资产不可用、版本已变化或清单读取失败，请刷新核对后再处理。'))}</p>` : ''}${processed ? read(T('cognition.activity_time', '发生时间'), fmtDate(proposal.decidedAt || proposal.createdAt)) : ''}</section>
      ${processed ? '' : `<div class="actions actions-right" data-activity-primary-actions>${btn(T('cognition.activity_save_update', '保存更新'), 'activity-approval', { id: proposal.id, data: { decision: 'confirm' }, primary: true, disabled: !canConfirm })}${btn(T('cognition.activity_defer', '稍后处理'), 'activity-approval', { id: proposal.id, data: { decision: 'defer' }, disabled: !!S.candidatesError })}${btn(T('cognition.inbox_action_reject', '拒绝'), 'activity-approval', { id: proposal.id, data: { decision: 'reject' }, danger: true, disabled: !!S.candidatesError })}</div>`}`;
  }
  function activityDetail(row, processed) {
    if (!row) return empty(T('cognition.activity_select_item', '选择一项查看详情'), T('cognition.activity_select_hint', '在左侧浏览建议，核对内容与来源后逐项处理。'));
    let content;
    if (row.route.candidateId) content = activityCandidate(row, processed);
    else if (row.route.approvalId) content = activityApproval(row, processed);
    else content = '';
    let fixedActions = '';
    const actionPattern = (row.route.candidateId || row.route.approvalId) ? /<div class="actions actions-right" data-activity-primary-actions>([\s\S]*?)<\/div>/ : /<div class="actions actions-right">([\s\S]*?)<\/div>/;
    content = content.replace(actionPattern, (match, actions) => { fixedActions = actions; return ''; });
    const original = row.route.candidateId && S.candidates.find(item => String(item.id) === String(row.route.candidateId));
    const candidate = original ? Object.assign({}, original, processed ? {} : activityDrafts.get(String(original.id)) || {}) : null;
    const action = candidate?.suggestedAction || 'create';
    const operation = candidate ? ({
      create: T('cognition.activity_operation_create', '建议新增'), update: T('cognition.activity_operation_update', '建议更新'),
      limit_scope: T('cognition.activity_operation_boundary', '建议补充边界'), pause: T('cognition.activity_operation_pause', '建议暂停'),
      keep_current: T('cognition.activity_history_keep', '保留现有内容'), reject: T('cognition.inbox_action_reject', '拒绝'),
    }[action] || row.result) : row.result;
    const detailTitle = candidate ? String(candidate.summary || row.title) : row.title;
    const subtitle = candidate ? operation : row.route.approvalId ? T('cognition.activity_operation_update', '建议更新') : row.scope;
    const risk = candidate && ['medium', 'high'].includes(candidate.risk)
      ? chip(candidate.risk === 'high' ? T('cognition.activity_risk_high', '高风险候选') : T('cognition.activity_risk_medium', '需谨慎核对'), 'amber')
      : candidate ? chip(T('cognition.activity_risk_normal', '普通候选'), 'line') : '';
    return `<header class="ca-activity-detail-head"><div class="ca-activity-detail-heading"><h2>${esc(detailTitle)}</h2><p>${esc(subtitle)}</p></div><div class="ca-activity-detail-badges">${risk}${chip(row.result, processed ? 'line' : 'amber')}${btn(T('common.close', '关闭'), 'activity-close', { small: true, className: 'o' })}</div></header><div class="ca-activity-detail-body" data-activity-key="${esc(row.key)}">${content}</div><footer class="ca-activity-detail-footer">${fixedActions}${processed ? btn(T('cognition.activity_next_item', '下一项'), 'activity-next', { small: true }) + btn(T('cognition.activity_back_pending', '返回需要关注 ›'), 'activity-tab', { id: 'attention', small: true, className: 'o' }) : ''}</footer>`;
  }
  function viewActivity(route) {
    const model = activityModel();
    const isNarrow = narrowActivity();
    if (!activityRendered && isNarrow && (route.candidateId || route.approvalId || route.inboxId || route.poCandidateId)) activityDrawer = true;
    if (activityRendered && isNarrow !== activityWasNarrow) activityDrawer = false;
    activityRendered = true; activityWasNarrow = isNarrow;
    const processed = route.activityView === 'done' || route.activityDone === '1';
    const all = activityRowsFor(route, model);
    const page = Math.max(0, Math.min(Number(route.activityPage) || 0, Math.max(0, Math.ceil(all.length / ACTIVITY_PAGE_SIZE) - 1)));
    const rows = all.slice(page * ACTIVITY_PAGE_SIZE, (page + 1) * ACTIVITY_PAGE_SIZE);
    S.activityRows = rows;
    const key = selectedActivityKey(route);
    let selected = all.find(row => row.key === key || row.candidateIds.includes(route.candidateId));
    // Deep links can refer to an excluded or already processed item; retain its original content.
    if (!selected && (route.candidateId || route.approvalId || route.inboxId || route.poCandidateId)) {
      selected = [...model.attention, ...model.done].find(row => row.key === key || row.candidateIds.includes(route.candidateId));
      if (!selected && route.candidateId) {
        const historical = S.candidates.find(c => c.id === route.candidateId);
        if (historical) selected = { key, title: candidateTitle(historical), detail: historical.judgment || '',
          scope: activityScope(historical.suggestedScope), route: { candidateId: route.candidateId },
          candidateIds: [route.candidateId], result: activityResult(historical, false) };
      }
    }

    if (!selected && !narrowActivity()) selected = rows[0];
    if (selected) activitySelection = selected.key;
    const showDrawer = isNarrow && !!selected && activityDrawer;
    const failed = S.candidatesError;
    const incomplete = failed || S.loading;
    const table = rows.length ? `<table class="ca-activity-table"><thead><tr><th>${esc(T('cognition.activity_proposed_change', '建议变化'))}</th><th>${esc(T('cognition.activity_scope', '适用范围'))}</th><th>${esc(T('cognition.activity_time', '发生时间'))}</th><th>${esc(T(processed ? 'cognition.activity_result' : 'cognition.activity_decision', processed ? '处理结果' : '需要你决定'))}</th></tr></thead><tbody>${rows.map(row => `<tr role="button" tabindex="0" aria-pressed="${selected?.key === row.key}" aria-label="${esc(row.title + '，' + row.result)}" class="${selected?.key === row.key ? 'is-selected' : ''}" data-act="activity-select" data-id="${esc(row.key)}"><td><strong>${esc(row.title)}</strong><p>${esc(normalizeActivityText(row.detail))}</p></td><td>${esc(row.scope)}</td><td>${esc(row.at)}</td><td>${esc(row.result)}<span aria-hidden="true"> ›</span></td></tr>`).join('')}</tbody></table>`
      : incomplete ? empty(T(S.loading ? 'cognition.activity_loading' : 'cognition.review_load_failed_title', S.loading ? '正在读取活动…' : '清单没能读取'), T('cognition.activity_read_failed', '部分变化未能读取，请重试；不能据此判断没有待处理内容。')) : empty(T(processed ? 'cognition.activity_done_empty' : 'cognition.activity_empty', processed ? '暂无已处理的认知变化' : '当前没有需要关注的认知变化'), T(route.activityQuery ? 'cognition.activity_search_empty' : 'cognition.activity_empty_hint', route.activityQuery ? '没有匹配的变化，请调整搜索条件。' : '没有有价值的结果时，这里保持空白。'));
    const pages = Math.max(1, Math.ceil(all.length / ACTIVITY_PAGE_SIZE));
    const detailProcessed = processed || (!!selected?.route.approvalId && model.done.some(row => row.key === selected.key)) || (!!selected?.route.candidateId && model.done.some(row => row.candidateIds.includes(selected.route.candidateId)));
    return `<section class="ca-activity-page">${hero(T('cognition.tab_activity', '系统活动'), T('cognition.activity_page_hint', '集中浏览建议，逐项核对后处理。'))}
      <div class="ca-activity-tabs" ${showDrawer ? 'inert' : ''} role="tablist" aria-label="${esc(T('cognition.activity_views', '活动视角'))}">${['attention', 'done'].map((view, index) => window.uiButton({ label: T(index ? 'cognition.activity_done' : 'cognition.activity_attention', index ? '已处理' : '需要关注') + ' ' + (incomplete ? T('cognition.activity_count_unknown', '待核对') : index ? model.done.length : model.attention.length), className: processed === !!index ? 'is-active' : '', attrs: { role: 'tab', 'aria-selected': String(processed === !!index), 'data-act': 'activity-tab', 'data-id': view } })).join('')}</div>
      <div class="ca-activity-toolbar" ${showDrawer ? 'inert' : ''}><div class="ca-prototype-search">${window.uiIconHtml('cognition-search')}${window.uiInput({ id: 'ca-activity-query', type: 'search', value: route.activityQuery || '', placeholder: T('cognition.activity_search_placeholder', '搜索标题、摘要或适用范围'), attrs: { 'aria-label': T('cognition.activity_search', '搜索变化内容或适用范围') } })}</div>${route.activityQuery ? btn(T('cognition.activity_clear_search', '清空搜索'), 'activity-clear', { small: true }) : ''}<span class="ca-activity-sync" ${failed ? 'role="alert"' : 'role="status"'}>${esc(S.loading ? T('cognition.activity_loading', '正在读取活动…') : failed ? T('cognition.activity_read_failed', '部分变化未能读取，请重试；不能据此判断没有待处理内容。') : T('cognition.activity_updated', '已更新'))}</span>${btn(T(failed ? 'common.retry' : 'common.refresh', failed ? '重试' : '刷新'), 'refresh', { small: true })}</div>
      <div class="ca-activity-layout"><div class="ca-activity-list" ${showDrawer ? 'inert' : ''}><div class="ca-activity-table-wrap">${table}</div><div class="ca-activity-pagination"><span>${esc(T('cognition.activity_pagination', '每页 50 条 · 第 {start}–{end} 条 / 共 {total} 条（合并后）', { start: String(all.length ? page * ACTIVITY_PAGE_SIZE + 1 : 0), end: String(Math.min(all.length, (page + 1) * ACTIVITY_PAGE_SIZE)), total: incomplete ? T('cognition.activity_count_unknown', '待核对') : String(all.length) }))}</span><div>${btn(T('common.previous', '上一页'), 'activity-page-select', { id: String(page - 1), small: true, disabled: page === 0 })}<span>${page + 1} / ${pages}</span>${btn(T('common.next', '下一页'), 'activity-page-select', { id: String(page + 1), small: true, disabled: page + 1 >= pages })}</div></div><p class="ca-activity-list-note">${esc(T('cognition.activity_list_note', '条目按来源时间排序；逐项处理，不提供批量接受。'))}<span>${esc(T('cognition.activity_keyboard', '↑ ↓ 浏览 · Enter 打开详情 · Esc 关闭'))}</span>${processed ? `<span>${esc(T('cognition.activity_save_is_not_use', '保存不代表任务已采用。'))}</span>` : ''}</p></div>${window.uiCard({ tag: 'section', readonly: true, className: 'ca-activity-detail' + (showDrawer ? ' is-drawer-open' : ''), attrs: { 'aria-label': T('cognition.activity_detail', '活动详情'), ...(showDrawer ? { role: 'dialog', 'aria-modal': 'true' } : {}) }, bodyHtml: activityDetail(selected, detailProcessed) })}</div>${showDrawer ? window.uiButton({ label: T('common.close', '关闭'), role: 'ghost', className: 'ca-activity-scrim', attrs: { 'data-act': 'activity-close', 'aria-label': T('common.close', '关闭'), tabindex: '-1' } }) : ''}</section>`;
  }

  async function mayLeaveActivity() {
    const id = activitySelection.startsWith('candidate:') ? activitySelection.slice(10) : '';
    if (!id || !activityDrafts.has(id)) return true;
    const leave = await NS.confirmUser(T('cognition.activity_unsaved_leave', '有尚未保存的修改。放弃修改并离开这条建议？'));
    if (leave) activityDrafts.delete(id);
    return !!leave;
  }
  function selectActivityRow(row, focusDetail = false) {
    if (!row) return;
    activitySelection = row.key;
    activityDrawer = narrowActivity();
    activityWasNarrow = narrowActivity();
    NS.router.go(activityRoute(row.route), { replace: true });
    if (focusDetail) document.querySelector?.('.ca-activity-detail [data-act="activity-close"]')?.focus();
  }
  NS.activityController = {
    handledActions: ACTIVITY_ACTIONS,
    writeActions: ACTIVITY_WRITE_ACTIONS,
    captureRenderState(root) {
      const body = root?.querySelector?.('.ca-activity-detail-body');
      const list = root?.querySelector?.('.ca-activity-table-wrap');
      if (!body && !list) return null;
      return {
        key: body?.dataset.activityKey || '',
        bodyTop: body?.scrollTop || 0,
        listTop: list?.scrollTop || 0,
        listLeft: list?.scrollLeft || 0,
        fields: Array.from(body?.querySelectorAll?.('[data-f]') || []).map(field => ({
          name: field.dataset.f,
          top: field.scrollTop || 0,
          left: field.scrollLeft || 0,
          active: field === document.activeElement,
          start: field.selectionStart,
          end: field.selectionEnd,
          direction: field.selectionDirection,
        })),
        disclosures: Array.from(body?.querySelectorAll?.('details') || []).map(details => details.open),
      };
    },
    restoreRenderState(root, state) {
      const body = root?.querySelector?.('.ca-activity-detail-body');
      const list = root?.querySelector?.('.ca-activity-table-wrap');
      if (list && state) { list.scrollTop = state.listTop; list.scrollLeft = state.listLeft; }
      if (!body) return;
      // 新条目从头阅读；后台更新同一条目时，保留阅读位置和输入光标。
      const sameItem = state?.key && state.key === body.dataset.activityKey;
      if (sameItem) {
        Array.from(body.querySelectorAll?.('details') || []).forEach((details, index) => {
          if (state.disclosures[index] !== undefined) details.open = state.disclosures[index];
        });
      }
      for (const field of Array.from(body.querySelectorAll?.('[data-f]') || [])) {
        const saved = sameItem && state.fields.find(item => item.name === field.dataset.f);
        if (saved?.active) {
          field.focus?.({ preventScroll: true });
          if (typeof saved.start === 'number' && typeof field.setSelectionRange === 'function') {
            try { field.setSelectionRange(saved.start, saved.end, saved.direction); } catch (_) { /* Native selects do not have text selection. */ }
          }
        }
        field.scrollTop = saved ? saved.top : 0;
        field.scrollLeft = saved ? saved.left : 0;
      }
      body.scrollTop = sameItem ? state.bodyTop : 0;
    },
    async handleClick(el) {
      const act = el.dataset.act, id = el.dataset.id || '';
      if (activityQueryTimer) { window.clearTimeout(activityQueryTimer); activityQueryTimer = undefined; }
      if (act === 'cand-decide' && !(await mayLeaveActivity())) return true;
      if (!ACTIVITY_ACTIONS.includes(act)) return false;
      if (el.disabled || el.getAttribute('disabled') !== null) return true;
      if (act === 'formation-recheck') {
        if (activityDrafts.has(id)) {
          await NS.alertUser(T('cognition.formation_recheck_save_first', '请先“保存修改并校验”，保留你的修改，再重新核对关联本体建议。'));
          return true;
        }
        await NS.actions.recheckCandidateFormation(id);
        return true;
      }
      if (act === 'activity-approval') {
        const proposal = (S.assetApprovals || []).find(item => String(item.id) === id);
        const decision = el.dataset.decision;
        if (!proposal || !['pending', 'deferred'].includes(proposal.state) || S.candidatesError
          || !['confirm', 'defer', 'reject'].includes(decision)) return true;
        if (decision === 'confirm') {
          const asset = (S.assets || []).find(item => String(item.id) === String(proposal.assetId));
          if (S.assetsError || !readableApproval(proposal) || !asset || !['active', 'paused'].includes(asset.status) || String(asset.version) !== String(proposal.baselineVersion)) return true;
        }
        const operation = this.beginDecision();
        el.setAttribute('aria-busy', 'true'); el.setAttribute('disabled', 'disabled');
        try {
          let result;
          // The IPC client throws for ok:false, including conflicts. Re-read in
          // finally so a failed response cannot leave a superseded item editable.
          try { result = await NS.api.call('recall.assets.approval.decide', { proposalId: id, decision }); }
          finally { await NS.reload(); }
          if (!result?.ok) throw new Error(result?.message || T('cognition.activity_approval_blocked', '目标资产不可用、版本已变化或清单读取失败，请刷新核对后再处理。'));
          if (decision !== 'defer') this.afterDecision('', false, operation);
          NS.notify();
        } catch (error) { await NS.alertUser(NS.recallErrorText ? NS.recallErrorText(error) : String(error.message || error)); }
        finally { el.removeAttribute('aria-busy'); el.removeAttribute('disabled'); }
        return true;
      }
      if (act === 'activity-undo-automatic') {
        const candidate = S.candidates.find(item => String(item.id) === id);
        if (!candidate?.capabilities?.canUndoAutomatic || el.getAttribute('aria-busy') === 'true') return true;
        el.setAttribute('aria-busy', 'true'); el.setAttribute('disabled', 'disabled');
        try {
          const result = await NS.api.call('recall.candidates.undoAutomaticPreview', { candidateId: id });
          const preview = result.preview;
          if (!result.ok || !preview?.token || !Array.isArray(preview.ontologyChanges)) throw new Error(T('cognition.automatic_undo_changed', '保存内容已有变化，请刷新后重新核对。'));
          if (preview.alreadyUndone) { await NS.reload(); return true; }
          const note = T('cognition.automatic_undo_preserves_history', '原决定和版本历史继续保留。有后续修改或引用时，系统会要求重新核对。');
          const change = preview.assetChange;
          const assetHtml = change ? `<section class="ca-review-notice"><h3>${esc(change.title)}</h3><h4>${esc(T('cognition.automatic_undo_before', '当前内容：'))}</h4><p class="content-text">${esc(change.before)}</p><h4>${esc(T('cognition.automatic_undo_after', '恢复后的内容：'))}</h4><p class="content-text">${esc(change.action === 'delete' ? T('cognition.automatic_undo_delete', '撤销新增：移入已删除，保留历史。') : change.after)}</p></section>` : '';
          const ontologyHtml = preview.ontologyChanges.length ? NS.candidate.formationPreviewHtml({ ...candidate,
            ontologyFormation: { schemaVersion: 1, reason: note, blockedReasons: [], requiresTReview: false,
              previewChanges: preview.ontologyChanges.map(item => ({ ...item, intent: 'undo_command', recordId: item.after.id,
                box: item.after.kind === 'rule' ? 'R' : ['module', 'definition', 'reference'].includes(item.after.kind) ? 'T' : 'A' })) } }, true) : '';
          if (typeof window.uiModal !== 'function' || !document.getElementById('ca-root')) throw new Error(T('cognition.automatic_undo_changed', '保存内容已有变化，请刷新后重新核对。'));
          const dialog = window.uiModal({ title: T('cognition.automatic_undo_title', '撤销本次自动保存'), size: 'md',
            closeLabel: T('common.close', '关闭'), bodyHtml: `<p>${esc(note)}</p>${assetHtml}${ontologyHtml}`,
            actions: [{ id: 'cancel', label: T('common.cancel', '取消') }, { id: 'confirm', label: T('common.confirm', '确认'), role: 'danger' }] });
          document.getElementById('ca-root').appendChild(dialog.overlay);
          if ((await dialog).value !== 'confirm') return true;
          const saved = await NS.api.call('recall.candidates.undoAutomatic', { candidateId: id, previewToken: preview.token });
          if (!saved.ok || !saved.candidate?.automaticUndo) throw new Error(T('cognition.automatic_undo_changed', '保存内容已有变化，请刷新后重新核对。'));
          delete (S.activityHistory || {})[id];
          await NS.reload();
        } catch (error) { await NS.alertUser(NS.recallErrorText ? NS.recallErrorText(error) : String(error.message || error)); }
        finally { el.removeAttribute('aria-busy'); el.removeAttribute('disabled'); NS.notify(); }
        return true;
      }
      if (act === 'activity-history') {
        if (!S.candidates.some(item => String(item.id) === id)) return true;
        const histories = S.activityHistory || (S.activityHistory = {});
        const state = histories[id] || (histories[id] = { open: false, items: [], loaded: false, loading: false });
        state.open = state.error ? true : !state.open;
        if (!state.open || state.loaded || state.loading) { NS.notify(); return true; }
        state.loading = true; state.error = ''; NS.notify();
        try {
          const result = await NS.api.call('recall.candidates.history', { candidateId: id });
          if (!Array.isArray(result.items)) throw new Error(T('cognition.activity_history_unavailable', '本条处理记录暂时无法读取，请重试。'));
          state.items = result.items; state.loaded = true;
        } catch (error) { state.error = T('cognition.activity_history_unavailable', '本条处理记录暂时无法读取，请重试。'); }
        finally { state.loading = false; NS.notify(); }
        return true;
      }
      if (ACTIVITY_WRITE_ACTIONS.includes(act)) {
        if (el.getAttribute('aria-busy') === 'true') return true;
        el.setAttribute('aria-busy', 'true'); el.setAttribute('disabled', 'disabled');
        const operation = this.beginDecision();
        try {
          const candidate = S.candidates.find(item => String(item.id) === id);
          if (!candidate || !NS.candidate.attentionReady(candidate)) return true;
          const card = el.closest?.('.ca-candidate-detail') || el.closest?.('.ca-activity-detail')?.querySelector('.ca-candidate-detail');
          const values = {};
          for (const [field, property] of Object.entries(candidateFields)) {
            const control = card?.querySelector('[data-f="' + field + '"]');
            if (control) values[property] = ['applicableWhen', 'forbiddenWhen'].includes(property) ? String(control.value).split(/\r?\n/).map(value => value.trim()).filter(Boolean) : String(control.value);
          }
          if (card?.dataset.candType) values.suggestedType = card.dataset.candType;
          if (act === 'activity-save-draft') {
            const result = await NS.api.call('recall.candidates.update', Object.assign({}, candidate, values, { candidateId: id, sourceRefs: candidate.sourceRefs || candidate.evidenceRefs || [], evidenceRefs: candidate.evidenceRefs || candidate.sourceRefs || [] }));
            if (!result?.candidate?.id) throw new Error(T('cognition.activity_draft_missing', '没有读到保存后的候选，请刷新后核对。'));
            S.candidates[S.candidates.findIndex(item => String(item.id) === id)] = result.candidate;
            activityDrafts.delete(id);
            (S.activityDraftValidation || (S.activityDraftValidation = {}))[id] = true;
            if (S.activityHistory?.[id]) S.activityHistory[id].loaded = false;
            NS.toast(T('cognition.activity_draft_saved', '修改已保存；正式保存仍以最新校验结果为准。'), 'success'); NS.notify();
          } else {
            if (!(await mayLeaveActivity())) return true;
            const result = await NS.api.call('recall.candidates.defer', { candidateId: id });
            if (!result?.candidate?.id) throw new Error(T('cognition.activity_defer_missing', '没有读到稍后处理的结果，请刷新后核对。'));
            S.candidates[S.candidates.findIndex(item => String(item.id) === id)] = result.candidate;
            NS.toast(T('cognition.activity_deferred_hint', '已标记稍后处理，仍保留在需要关注中。')); this.afterDecision(id, true, operation); NS.notify();
          }
        } catch (error) { await NS.alertUser(NS.recallErrorText ? NS.recallErrorText(error) : String(error.message || error)); }
        finally { el.removeAttribute('aria-busy'); el.removeAttribute('disabled'); }
        return true;
      }
      if (!(await mayLeaveActivity())) return true;
      if (act === 'activity-select') selectActivityRow((S.activityRows || []).find(row => row.key === id), narrowActivity());
      else if (act === 'activity-tab') { activitySelection = ''; activityDrawer = false; NS.router.go(activityRoute({ activityView: id, activityDone: id === 'done' ? '1' : '', activityPage: '', activityQuery: '' }), { replace: true }); }
      else if (act === 'activity-clear') NS.router.go(activityRoute({ activityQuery: '', activityPage: '' }), { replace: true });
      else if (act === 'activity-page-select') { activitySelection = ''; activityDrawer = false; NS.router.go(activityRoute({ activityPage: id }), { replace: true }); }
      else if (act === 'activity-next') this.afterDecision('', true);
      else if (act === 'activity-close') { activityDrawer = false; NS.router.go(activityRoute(), { replace: true }); const row = Array.from(document.querySelectorAll?.('[data-act="activity-select"]') || []).find(node => node.dataset.id === activitySelection); row?.focus(); }
      return true;
    },
    handleInput(event) {
      const field = event.target;
      if (field.id === 'ca-activity-query' && !event.isComposing) {
        if (activityQueryTimer) window.clearTimeout(activityQueryTimer);
        const value = field.value, caret = field.selectionStart;
        activityQueryTimer = window.setTimeout(async () => { if (!(await mayLeaveActivity())) return; NS.router.go(activityRoute({ activityQuery: value, activityPage: '' }), { replace: true }); const input = document.getElementById('ca-activity-query'); input?.focus(); try { input?.setSelectionRange(caret, caret); } catch (_) { /* search inputs do not support selection in all engines */ } }, 180);
        return true;
      }
      const card = field.closest?.('.ca-activity-detail .ca-candidate-detail');
      const property = candidateFields[field.dataset?.f];
      if (!card || !property) return false;
      const candidateId = String(card.dataset.candId);
      const draft = Object.assign({}, activityDrafts.get(candidateId) || {}, { suggestedType: card.dataset.candType });
      draft[property] = ['applicableWhen', 'forbiddenWhen'].includes(property) ? String(field.value).split(/\r?\n/).map(value => value.trim()).filter(Boolean) : String(field.value);
      activityDrafts.set(candidateId, draft);
      if (S.activityDraftValidation) delete S.activityDraftValidation[candidateId];
      card.querySelector?.('[data-draft-validation]')?.remove?.();
      return true;
    },
    async handleKeydown(event) {
      if (event.isComposing || event.keyCode === 229) return false;
      if (event.key === 'Tab' && activityDrawer && narrowActivity()) {
        const controls = Array.from(document.querySelectorAll('.ca-activity-detail button:not(:disabled), .ca-activity-detail input:not(:disabled), .ca-activity-detail textarea:not(:disabled), .ca-activity-detail select:not(:disabled), .ca-activity-detail [tabindex="0"]')).filter(control => !control.hidden && control.getAttribute('aria-hidden') !== 'true');
        if (controls.length && ((event.shiftKey && event.target === controls[0]) || (!event.shiftKey && event.target === controls[controls.length - 1]))) { event.preventDefault(); (event.shiftKey ? controls[controls.length - 1] : controls[0]).focus(); }
        return false;
      }
      if (event.key === 'Escape' && activityDrawer) { event.preventDefault(); await this.handleClick({ dataset: { act: 'activity-close' }, getAttribute: () => null }); return true; }
      const row = event.target.closest?.('[data-act="activity-select"]');
      if (!row) return false;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); const rows = Array.from(document.querySelectorAll('[data-act="activity-select"]')); const index = rows.indexOf(row); rows[Math.max(0, Math.min(rows.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))]?.focus(); return true; }
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); await this.handleClick(row); return true; }
      return false;
    },
    async guardNavigation() { if (activityQueryTimer) { window.clearTimeout(activityQueryTimer); activityQueryTimer = undefined; } return mayLeaveActivity(); },
    clearDraft(candidateId) { activityDrafts.delete(String(candidateId)); },
    beginDecision() { return { selection: activitySelection, routeName: S.route.name, view: S.route.activityView || S.route.activityDone || '', query: S.route.activityQuery || '', page: S.route.activityPage || '' }; },
    afterDecision(candidateId, nextOnly = false, operation) {
      if (candidateId) activityDrafts.delete(String(candidateId).replace(/^candidate:/, ''));
      if (operation && (S.route.name !== operation.routeName || activitySelection !== operation.selection || (S.route.activityView || S.route.activityDone || '') !== operation.view || (S.route.activityQuery || '') !== operation.query || (S.route.activityPage || '') !== operation.page)) return false;
      const previous = S.activityRows || [];
      const index = previous.findIndex(row => row.key === activitySelection || row.candidateIds.includes(candidateId));
      const available = activityRowsFor(S.route);
      const next = nextOnly ? available[(Math.max(0, available.findIndex(row => row.key === activitySelection)) + 1) % available.length] : available.find(row => row.key === previous[index + 1]?.key) || available[Math.min(Math.max(0, index), available.length - 1)];
      activitySelection = next?.key || '';
      NS.router.go(activityRoute(Object.assign({}, next?.route || {}, { activityPage: String(Math.max(0, Math.floor(available.indexOf(next) / ACTIVITY_PAGE_SIZE))) })), { replace: true });
      return true;
    },
  };

  NS.viewActivity = viewActivity;
  // 兼容别名：旧深链/测试曾调 NS.viewReview；行为同 viewActivity（review 路由
  // 已在 router.go 归一到 activity）。
  NS.viewReview = viewActivity;
})();
