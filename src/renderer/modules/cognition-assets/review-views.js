/* ============================================================================
 * 认知资产 · 视图层：系统活动页（cognition-assets/review-views.js）
 *
 * 2026-10-08 U04 收敛：独立「待我处理」页下线，全部治理动作并入系统活动。
 * viewActivity 提供需要关注（默认）与已处理两个视角：
 *  - 需要关注：治理待办 inbox 分组、等待确认候选、证据异常、本体候选、
 *    整理失败可重试的捕获、其他异常折叠——原 viewReview 的可操作内容。
 *  - 已处理：处理记录、已稍后处理、已失效候选、完成的整理记录。
 * 候选详情（route.candidateId）复用 review-candidate.js 的 viewCandidate。
 * ========================================================================== */
(function () {
  'use strict';

  const NS = window.CogAssets;
  if (!NS) return;
  const { T, esc, fmtDate } = NS;
  const S = NS.store;
  const { btn, roleBtn, hero, empty, sectionHead, termNote, otherActions, chip } = NS.ui;
  const {
    card: candidateCard,
    viewCandidate,
    pending: candidatePending,
    awaiting: candidateAwaiting,
    evidenceMostlyUnavailable,
    title: candidateTitle,
    sourceIssuesSection,
    taskFailedSection,
  } = NS.candidate;

  /* ────────────────────────── 视图：系统活动 ────────────────────────── */

  function governanceDetail(route) {
    // A5（2026-09-29）：候选清单读取失败进显式错误态——不再把「没读到」伪装
    // 成「没有要你决定的」空态。P-r1-58（2026-10-02）：读失败判定先于深链
    // 分支——错误态对深链同样成立：先如实报清单读取失败并给重试入口。
    if (S.candidatesError && !route.inboxId && !route.poCandidateId) {
      return `${hero(T('cognition.tab_activity', '系统活动'), '')}
      <div class="sect-block">${empty(
        T('cognition.review_load_failed_title', '清单没能读取'),
        T('cognition.review_load_failed_hint', '待确认内容的清单没有读到。可以稍后重试；重试仍失败时，重启应用通常能恢复。'),
        { label: T('cognition.review_load_retry', '重试'), attrs: { 'data-act': 'retry-candidates' } },
      )}</div>`;
    }
    if (route.candidateId) return viewCandidate(route);
    const doneView = String(route.activityDone || '') === '1';
    const stats = NS.stats();
    const vocab = NS.vocabulary;
    const pending = route.inboxId || route.poCandidateId ? [] : S.candidates.filter(candidatePending);
    const displayState = (c) => String(((c || {}).capabilities || {}).displayState || '');
    const awaiting = pending.filter(candidateAwaiting);
    const broken = awaiting.filter(evidenceMostlyUnavailable);
    const weak = awaiting.filter((c) => !evidenceMostlyUnavailable(c) && displayState(c) === 'weak_evidence');
    const ready = awaiting.filter((c) => !evidenceMostlyUnavailable(c) && displayState(c) !== 'weak_evidence');
    const snoozed = pending.filter((c) => c.capabilities && c.capabilities.isSnoozed);
    const terminal = (route.inboxId || route.poCandidateId ? [] : S.candidates).filter((c) => ['expired', 'superseded'].includes(displayState(c)) && !candidatePending(c)).slice(0, 8);
    const processed = (route.inboxId || route.poCandidateId ? [] : S.candidates)
      .filter((c) => ['confirmed', 'integrated', 'rejected', 'ignored'].includes(String(c.status || '')));
    const processedLabel = (c) => ({
      confirmed: T('cognition.candidate_status_promoted', '已保存'),
      integrated: T('cognition.candidate_status_integrated', '已整理到本体'),
      rejected: T('cognition.candidate_status_rejected', '未保存'),
      ignored: T('cognition.candidate_status_ignored', '已忽略'),
    }[String(c.status || '')] || T('cognition.candidate_status_other', '已处理'));

    /* 捕获记录两口径（C-05：后台跳过/低价值不灌入两列表）：
     *  - 失败/待配置/等待手动：需要关注（可操作——重试或立即开始；手动创建
     *    的整理入口在这里可见，普通筛掉与静默等待不进列表）；
     *  - completed/cancelled：已处理的整理记录；review_ready 的待确认候选
     *    已由候选行表达，不再重复列捕获行；no_candidate（筛掉）不进列表。 */
    const captures = Array.isArray(S.captures) ? S.captures : [];
    const failedCaptures = captures
      .filter((c) => ['failed', 'configuration_required', 'waiting_manual'].includes(String(c.status || '')));
    const doneCapturesAll = captures
      .filter((c) => ['completed', 'cancelled'].includes(String(c.status || '')))
      .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    const capturesDoneExpanded = String(route.activityDone || '') === '1' && S.organizeListExpanded;
    const doneCaptures = capturesDoneExpanded ? doneCapturesAll : doneCapturesAll.slice(0, 10);

    const captureTitle = (c) => (vocab ? vocab.recordTitle(c) : String(c.conversationTitle || T('cognition.capture_untitled_record', '未命名会话的整理')));
    const captureRow = (c, extra) => `
      <div class="cap-row is-clickable" data-act="open-capture-detail" data-id="${esc(c.id)}" role="button" tabindex="0">
        <div class="tw"><div class="tt">${esc(captureTitle(c))}</div>
        <div class="mm"><span>${esc(extra)}</span></div></div>
        <div class="sd">${chip(vocab ? vocab.captureDisplayStatusText(c.displayStatus) : String(c.displayStatus || ''), String(c.status || '') === 'failed' ? 'red' : 'amber')}</div>
      </div>`;

    const attention = [];
    if (stats.sourceIssues) {
      attention.push(`<div class="notice-row" data-act="toggle-source-issues" ${roleBtn()}><div class="notice-copy"><div class="notice-title">${esc(T('cognition.overview_source_issues', '{count} 条来源记录需要处理', { count: String(stats.sourceIssues) }))}</div></div><span class="sp"></span>${btn(T('common.handle', '处理'), 'toggle-source-issues', { small: true, className: 'o' })}</div>`);
    }
    if (stats.taskFailed) {
      attention.push(`<div class="notice-row" data-act="toggle-task-failed" ${roleBtn()}><div class="notice-copy"><div class="notice-title">${esc(T('cognition.overview_task_failed', '{count} 个任务执行失败（未得到回复）', { count: String(stats.taskFailed) }))}</div></div><span class="sp"></span>${btn(T('cognition.review_task_failed_open', '看是哪几次'), 'toggle-task-failed', { small: true, className: 'o' })}</div>`);
    }
    // 治理待办 / 待确认清单（渲染层只渲染读模型给的动作 item.actions）。
    const inboxItems = (route.poCandidateId ? [] : Array.isArray(S.inbox) ? S.inbox : []).filter(row => !route.inboxId || String(row.id) === route.inboxId);
    const inboxGroups = route.poCandidateId ? [] : Array.isArray(S.inboxGroups) ? S.inboxGroups.map(group => ({ ...group, items: (group.items || []).filter(row => !route.inboxId || String(row.id) === route.inboxId) })).filter(group => group.items.length) : null;
    const INBOX_ACTION_LABELS = {
      accept: T('cognition.inbox_action_accept', '保存'),
      reject: T('cognition.inbox_action_reject', '拒绝'),
      ignore: T('cognition.inbox_action_ignore', '忽略'),
    };
    const PROPOSAL_ACTION_LABELS = {
      accept: T('cognition.inbox_action_accept_update', '保存更新'),
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
    const rowTitle = (row) => {
      const raw = String(row.title || '');
      const cut = raw.length > 60 ? `${raw.slice(0, 60)}…` : raw;
      return `<div class="notice-title" title="${esc(raw)}">${esc(cut)}</div>`;
    };
    const boundaryFormRow = (row) => {
      const id = String(row.id || '');
      const boundary = row.boundary && typeof row.boundary === 'object' ? row.boundary : {};
      const joinList = (list) => (Array.isArray(list) ? list.map(String).filter(Boolean).join('、') : '');
      const suffix = id.replace(/[^a-z0-9_-]/gi, '');
      return `<div class="notice-row ca-inbox-boundary" data-inbox-boundary-form>
        <div class="notice-copy">
          ${rowTitle(row)}
          <div class="notice-detail">${esc(T('cognition.inbox_rule_boundary_hint', '没写适用范围的规矩不会被自动带入任务；补齐后才会生效。'))}</div>
          <div class="ca-inbox-boundary-form">
            ${window.uiInput({ id: `inbox-boundary-applicable-${suffix}`, value: joinList(boundary.applicableWhen), attrs: { 'data-f': 'boundary-applicable', placeholder: T('cognition.inbox_boundary_field_applicable', '适用情形') } })}
            ${window.uiInput({ id: `inbox-boundary-forbidden-${suffix}`, value: joinList(boundary.forbiddenWhen), attrs: { 'data-f': 'boundary-forbidden', placeholder: T('cognition.inbox_boundary_field_forbidden', '禁用情形') } })}
            <div class="note">${esc(T('cognition.inbox_boundary_save_effect', '保存后：主进程重新校验，通过后这条规则恢复自动带入；不通过会把原因留在这里。'))}</div>
          </div>
        </div>
        <span class="sp"></span>${btn(T('cognition.inbox_boundary_submit', '保存边界'), 'inbox-boundary-save', { small: true, primary: true, data: { id } })}
      </div>`;
    };
    const flatInboxRow = (row) => {
      if (String(row.kind || '') === 'rule_boundary_missing') return boundaryFormRow(row);
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
      const fallback = actions.length || !row.assetId
        ? ''
        : btn(T('cognition.inbox_go_asset', '去资产详情处理'), 'go-inbox-asset', { small: true, className: 'o', data: { id: String(row.assetId) } });
      return `<div class="notice-row">
        <div class="notice-copy">${rowTitle(row)}${row.detail ? `<div class="notice-detail">${esc(String(row.detail))}</div>` : ''}</div>
        <span class="sp"></span>${fallback}${primaryBtn}${restBtns}
      </div>`;
    };
    const GROUP_TITLES = {
      conflict: T('cognition.inbox_group_conflict', '冲突与重复'),
      other: T('cognition.inbox_group_other', '其他待处理'),
    };
    const GROUP_HINTS = {
      conflict: T('cognition.inbox_classification_conflict_hint', '同一句话被归到两个类型，两边都不会晋升，需要你裁定。'),
    };
    const governanceRow = (row) => {
      const actions = Array.isArray(row.actions) ? row.actions : [];
      const has = (action) => actions.includes(action);
      const id = String(row.id || '');
      const detail = row.aggregate ? '' : row.detail;
      const head = `<div class="notice-copy">${rowTitle(row)}${detail ? `<div class="notice-detail">${esc(String(detail))}</div>` : ''}</div>`;
      if (row.kind === 'classification_conflict' && has('claim')) {
        return `<div class="notice-row">${head}<span class="sp"></span>${btn(T('cognition.inbox_action_claim', '保留这一条'), 'inbox-conflict-claim', { small: true, primary: true, data: { id } })}${otherActions([has('reject') ? btn(INBOX_ACTION_LABELS.reject, 'inbox-resolve', { small: true, className: 'o', data: { id, action: 'reject' } }) : ''].join(''))}</div>`;
      }
      if (row.kind === 'inspection_finding' && (has('keep') || has('merge'))) {
        const anchor = String(row.assetId || '');
        const other = String((row.assetIds || []).find((assetId) => String(assetId) !== anchor) || '');
        return `<div class="notice-row">${head}<span class="sp"></span>${has('keep') ? btn(T('cognition.inbox_action_keep', '保留这一条，归档另一条'), 'inbox-inspection-keep', { small: true, primary: true, data: { id, anchor, target: other } }) : ''}${otherActions([has('merge') ? btn(T('cognition.inbox_action_merge_pair', '合并到这一条'), 'inbox-inspection-merge', { small: true, className: 'o', data: { id, anchor, target: other } }) : '', has('reject') ? btn(FINDING_ACTION_LABELS.reject, 'inbox-resolve', { small: true, className: 'o', data: { id, action: 'reject' } }) : '', has('defer') ? btn(FINDING_ACTION_LABELS.defer, 'inbox-resolve', { small: true, className: 'o', data: { id, action: 'defer' } }) : ''].join(''))}</div>`;
      }
      return flatInboxRow(row);
    };
    const isConfirm = (row) => String(row.urgency || '') === 'confirm';
    const groupBlock = (group, items) => {
      const title = GROUP_TITLES[group.category] || GROUP_TITLES.other;
      const hint = GROUP_HINTS[group.category];
      const rows = items.map((row) => (group.category === 'other' ? flatInboxRow(row) : governanceRow(row))).join('');
      return `<div class="sect-block"><div class="tt">${esc(title)}<span class="note">${esc(String(items.length))}</span></div>${hint ? `<p class="note">${esc(hint)}</p>` : ''}${rows}</div>`;
    };
    const confirmBlocks = [];
    const lowBlocks = [];
    let confirmCount = 0;
    let lowCount = 0;
    if (S.inboxError) {
      confirmBlocks.push(`<div class="sect-block">${empty(
        T('cognition.inbox_load_failed_title', '待确认清单没能读取'),
        T('cognition.inbox_load_failed_hint', '治理待办的清单没有读到，其他分区不受影响。可以稍后重试；重试仍失败时，重启应用通常能恢复。'),
        { label: T('cognition.review_load_retry', '重试'), attrs: { 'data-act': 'refresh' } },
      )}</div>`);
    } else if (inboxGroups && inboxGroups.length) {
      for (const group of inboxGroups) {
        if (!group || !Array.isArray(group.items) || !group.items.length) continue;
        const confirmItems = group.items.filter(isConfirm);
        const lowItems = group.items.filter((row) => !isConfirm(row));
        if (confirmItems.length) { confirmCount += confirmItems.length; confirmBlocks.push(groupBlock(group, confirmItems)); }
        if (lowItems.length) { lowCount += lowItems.length; lowBlocks.push(groupBlock(group, lowItems)); }
      }
    } else if (inboxItems.length) {
      const inboxRows = inboxItems.map(flatInboxRow).join('');
      confirmBlocks.push(`<div class="sect-block"><div class="tt">${esc(T('cognition.inbox_section', '待确认清单'))}<span class="note">${esc(String(inboxItems.length))}</span></div>${inboxRows}</div>`);
      confirmCount += inboxItems.length;
    }
    const poList = (Array.isArray(S.poCandidates) ? S.poCandidates : []).filter(c => !route.poCandidateId || String(c.candidate_id) === route.poCandidateId);
    const needsTotal = confirmCount + ready.length + broken.length + weak.length + poList.length + failedCaptures.length;
    const doneTotal = processed.length + terminal.length + doneCapturesAll.length;

    /* 双视角切换（原型 .activity-view-tabs）：需要关注为默认；完成后转入已处理。 */
    const toggleHtml = `
    <div class="chips ca-activity-toggle">
      ${btn(`${T('cognition.activity_view_attention', '需要关注')} ${needsTotal}`, 'activity-view', { id: '', className: `chip${!doneView ? ' on' : ''}` })}
      ${btn(`${T('cognition.activity_view_done', '已处理')} ${doneTotal}`, 'activity-view', { id: 'done', className: `chip${doneView ? ' on' : ''}` })}
      <span class="note">${esc(T('cognition.activity_toggle_hint', '在这里核对并处理，完成后转入已处理。'))}</span>
    </div>`;

    if (doneView) {
      /* ── 已处理 ── */
      const processedList = processed.length ? `<div class="sect-block fold-processed">${sectionHead(T('cognition.inbox_processed_badge', '处理记录'), String(processed.length))}
      <div class="note sect-note">${esc(T('cognition.inbox_processed_hint', '按处理时间倒序，只显示已处理的决定'))}</div>${processed.map((c) => `
        <div class="vrow">
          <div class="vt"><div class="v1">${esc(candidateTitle(c))}${String(c.status || '') === 'confirmed' && c.promotedAssetId ? ` <span class="chip-link" data-act="go-inbox-asset" data-id="${esc(String(c.promotedAssetId))}" ${roleBtn()}>${esc(T('cognition.review_promoted_go', '查看这条资产'))}</span>` : ''}${String(c.status || '') === 'integrated' && c.ontologyHandoff?.recordIds?.length ? ` <span class="chip-link" data-act="open-ontology" data-module-id="${esc(String(c.ontologyHandoff.moduleIds?.[0] || ''))}" data-record-id="${esc(String(c.ontologyHandoff.recordIds[0]))}" ${roleBtn()}>${esc(T('cognition.candidate_detail_open_ontology', '查看本体记录'))}</span>` : ''}</div>
          <div class="v2">${esc(fmtDate(c.updatedAt || c.createdAt))} · ${esc(processedLabel(c))}</div></div>
        </div>`).join('')}</div>` : '';
      /* 大扫除报告与后台体检事件（specs/018 T060 时间流并入；U04 随系统活动
       * 收敛进「已处理·整理记录」）：一句人话 + 时间 + 落点；发起入口在设置页。 */
      const cleanupEvents = ((S.cleanupReports && Array.isArray(S.cleanupReports.reports)) ? S.cleanupReports.reports : [])
        .slice(0, 3)
        .map((report) => {
          const merged = (report.items || []).filter((item) => item.status === 'applied').length;
          return {
            at: String(report.createdAt || ''),
            html: `<div class="cap-row is-clickable" data-act="open-cleanup-report" data-report="${esc(String(report.id))}" role="button" tabindex="0">
            <div class="tw"><div class="tt">${esc(report.mode === 'report_only'
              ? T('cognition.activity_event_check', '检查完成，生成 {n} 项建议；内容未修改', { n: String((report.uncertain || []).length) })
              : merged
              ? T('cognition.activity_event_cleanup', '整理合并 {n} 条重复项', { n: String(merged) })
              : T('cognition.activity_event_cleanup_empty', '整理完成，没有重复项需要合并'))}</div>
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
          html: `<div class="cap-row is-clickable" data-act="go-review" role="button" tabindex="0">
            <div class="tw"><div class="tt">${esc(found
              ? T('cognition.activity_event_inspection', '定期检查发现 {n} 条待处理', { n: String(found) })
              : T('cognition.activity_event_inspection_clean', '定期检查完成，没有发现问题'))}</div>
            <div class="mm"><span>${esc(fmtDate(run.startedAt))}</span></div></div>
            <div class="sd">${btn(T('cognition.activity_event_inspection_go', '去看看'), 'go-review', { small: true, primary: found > 0 })}</div>
          </div>`,
        });
      }
      const capturesDone = (doneCapturesAll.length || cleanupEvents.length || inspectionEvents.length)
        ? `<div class="sect-block">${sectionHead(T('cognition.activity_captures_done_title', '整理记录'), String(doneCapturesAll.length + cleanupEvents.length + inspectionEvents.length))}
      <div class="note sect-note">${esc(T('cognition.activity_captures_done_hint', '最近完成的会话整理；筛掉的低价值会话不进入系统活动。'))}</div>
      ${doneCaptures.map((c) => captureRow(c, `${vocab ? vocab.captureDisplayStatusText(c.displayStatus) : ''} · ${esc(fmtDate(c.updatedAt || c.createdAt))}`)).join('')}
      ${[...cleanupEvents, ...inspectionEvents].sort((left, right) => String(right.at).localeCompare(String(left.at))).map((entry) => entry.html).join('')}
      ${doneCapturesAll.length > doneCaptures.length ? btn(T('cognition.organize_list_expand', '显示全部'), 'toggle-organize-list', { small: true, className: 'o' }) : ''}</div>` : '';
      const snoozedFold = '';
      const terminalFold = terminal.length ? `<details class="details fold fold-terminal"><summary>${esc(T('cognition.review_group_terminal', '已失效的候选'))}<span class="n">${terminal.length}</span></summary><div class="dbody"><div class="note">${esc(T('cognition.review_group_terminal_note', '已过期或被取代，仅保留记录'))}</div>${terminal.map((c) => candidateCard(c, false)).join('')}</div></details>` : '';
      const allEmpty = !processedList && !capturesDone && !snoozedFold && !terminalFold;
      return `${hero(T('cognition.tab_activity', '系统活动'), T('cognition.activity_subtitle', '只记录筛选后的认知变化；普通聊天保留在原有聊天历史中。'))}
      ${toggleHtml}
      ${allEmpty ? `<div class="sect-block">${empty(
        T('cognition.activity_done_empty_title', '还没有处理记录'),
        T('cognition.activity_done_empty_hint', '处理过的建议和完成的整理会出现在这里。'),
      )}</div>` : `${processedList}${capturesDone}${snoozedFold}${terminalFold}`}
      ${typeof NS.ontologyActivitySection === 'function' ? NS.ontologyActivitySection() : ''}
      ${typeof NS.improvementAnalysisSection === 'function' ? NS.improvementAnalysisSection(route) : ''}`;
    }

    /* ── 需要关注（默认） ── */
    const decideCount = confirmCount + ready.length;
    const lowTotal = lowCount + snoozed.length;
    const evidenceCount = broken.length + weak.length;
    const allQuiet = !attention.length && !confirmCount && !lowCount && !pending.length && !terminal.length && !processed.length && !poList.length && !failedCaptures.length && !S.inboxError;
    const leadNum = (value, anchor) => `<span class="chip-link ca-jump-num" data-act="review-jump" data-id="${esc(anchor)}" aria-label="${esc(T('cognition.review_lead_jump_aria', '跳到「{where}」', { where: anchor === 'ca-review-decide' ? T('cognition.review_queue_decide', '要你拍板') : T('cognition.review_lead_evidence', '条证据要补') }))}" ${roleBtn()}>${esc(String(value))}</span>`;
    const decidePart = decideCount
      ? `${leadNum(decideCount, 'ca-review-decide')} ${esc(T('cognition.review_lead_decide', '件事等你拍板'))}`
      : '';
    const evidencePart = evidenceCount ? `${leadNum(evidenceCount, 'ca-review-evidence')} ${esc(T('cognition.review_lead_evidence', '条证据要补'))}` : '';
    const lowPart = lowTotal ? esc(T('cognition.review_lead_low', '{n} 条不急，先收着', { n: String(lowTotal) })) : '';
    const leadHtml = [decidePart, evidencePart, lowPart].filter(Boolean).length
      ? `<div class="sub">${[decidePart, evidencePart, lowPart].filter(Boolean).join(' · ')}</div>`
      : '';
    const promoted = S.lastPromoted && (Date.now() - Number(S.lastPromoted.at || 0) < 120000)
      ? S.lastPromoted
      : null;
    const truncate = (text, limit) => (NS.truncateText ? NS.truncateText(text, limit) : String(text || '').slice(0, limit));
    const promotedHtml = promoted ? `<div class="notice-stack ca-promoted-note"><div class="notice-row">
      <div class="notice-copy"><div class="notice-title">${esc(T('cognition.review_promoted_title', '已确认 · 已保存为正式资产'))}</div>
      ${promoted.title ? `<div class="notice-detail">${esc(truncate(promoted.title, 60))}</div>` : ''}</div>
      <span class="sp"></span>${promoted.assetId ? btn(T('cognition.review_promoted_go', '查看这条资产'), 'go-inbox-asset', { id: String(promoted.assetId), small: true, primary: true }) : ''}
    </div></div>` : '';
    const decideHtml = decideCount || S.inboxError ? `<div id="ca-review-decide">${sectionHead(T('cognition.review_queue_decide', '要你拍板'), String(decideCount))}
      <div class="note sect-note">${esc(T('cognition.review_queue_decide_hint', '每条都卡在这里等你：动作与后果写在条上，处理一条少一条。'))}</div>
      ${confirmBlocks.join('')}
      ${ready.length ? `${sectionHead(T('cognition.review_group_wait', '等待你确认'), String(ready.length))}<div class="note sect-note">${esc(T('cognition.review_group_wait_note', '保存后生成第一版，来源与撤销入口都保留'))} · ${esc(termNote('candidate'))}</div>${ready.map((c) => candidateCard(c, false)).join('')}` : ''}</div>` : '';
    const lowHtml = lowTotal ? `<details class="details fold fold-low"><summary>${esc(T('cognition.review_queue_low', '低打扰'))}<span class="n">${lowTotal}</span></summary><div class="dbody"><div class="note">${esc(T('cognition.review_queue_low_hint', '不急，但不会自己消失：有空时逐条处理。'))}</div>${lowBlocks.join('')}</div></details>` : '';
    const attentionHtml = attention.length
      ? `<details class="details fold fold-attention"${String(route.sourceIssueOpen || '') === 'open' ? ' open' : ''}><summary>${esc(T('cognition.review_other_issues', '其他异常'))}<span class="n">${attention.length}</span></summary><div class="dbody"><div class="note">${esc(T('cognition.review_other_issues_hint', '不是等你拍板的事：整理没跑成、任务没得到回复、来源读取异常。'))}</div>${attention.join('')}${sourceIssuesSection(route)}${taskFailedSection(route)}</div></details>`
      : '';
    /* 旧个人本体候选留在同一收件箱，但只能转入 Recall 共同审核后再保存。 */
    const poKindLabel = (kind) => {
      const map = {
        rule: ['cognition.review_onto_kind_rule', '规则'],
        preference: ['cognition.review_onto_kind_about', '关于我'],
        instance: ['cognition.review_onto_kind_about', '关于我'],
        property: ['cognition.review_onto_kind_about', '关于我'],
        relation: ['cognition.review_onto_kind_about', '关于我'],
      };
      const hit = map[String(kind || '')] || ['cognition.review_onto_kind_other', '其他'];
      return T(hit[0], hit[1]);
    };
    const sourceAlive = (candidateId) => {
      const raw = String(candidateId || '');
      if (!raw.startsWith('asset-backflow-')) return true;
      const assetId = raw.slice('asset-backflow-'.length);
      return (S.assets || []).some((asset) => String(asset.id) === assetId
        && !['deleted', 'purged', 'revoked'].includes(String(asset.status || 'active')));
    };
    const ontologyHtml = S.poCandidatesError
      ? `<div class="sect-block">${sectionHead(T('cognition.review_group_ontology', '本体候选'), '!')}
        <div class="note sect-note">${esc(T('cognition.review_ontology_load_failed', '本体候选没能读取，稍后重试。'))}</div></div>`
      : poList.length
        ? `<div class="sect-block" id="ca-review-ontology">${sectionHead(T('cognition.review_group_ontology', '本体候选'), String(poList.length))}
      <div class="note sect-note">${esc(T('cognition.review_group_ontology_note', '系统从对话与正式资产里提出、等你决定要不要记进档案的条目；确认后进入档案，驳回即丢弃。'))}</div>
      ${poList.map((c) => {
        const cid = String(c.candidate_id || '');
        const dead = cid ? !sourceAlive(cid) : false;
        const restricted = ['restricted', 'sensitive'].includes(String(c.sensitivity || 'standard'));
        return `<div class="ca-review-row">
        ${chip(poKindLabel(c.kind), c.kind === 'rule' ? 'blue' : 'green')}
        ${dead ? chip(T('cognition.review_onto_stale_source', '来源已删除'), 'red') : ''}
        <span class="ca-review-row-text">${esc(String(c.summary || c.memory_text || ''))}</span>
        ${restricted ? `<span class="note">${esc(T('cognition.review_ontology_restricted_transfer', '这条旧候选标记为仅本人可见，不能转入任务可用资产。'))}</span>` : ''}
        <span class="sp"></span>
        ${cid && !dead && !restricted ? btn(T('cognition.review_ontology_transfer', '移入共同审核'), 'po-cand-transfer', { id: cid, small: true, primary: true }) : ''}
        ${cid ? btn(T('cognition.review_ontology_reject', '驳回'), 'po-cand-reject', { id: cid, small: true, primary: !dead }) : ''}
      </div>`;
      }).join('')}</div>`
        : '';
    /* 整理失败可重试（U04：从原「系统活动」任务流的 attention 桶收敛而来；
     * 只列失败/待配置捕获，普通筛掉与等待类不进列表）。 */
    const failedHtml = failedCaptures.length ? `<div class="sect-block">${sectionHead(T('cognition.activity_failed_captures_title', '整理失败，可重试'), String(failedCaptures.length))}
      <div class="note sect-note">${esc(T('cognition.activity_failed_captures_hint', '夜间自动重试次数有限；停在这里的可以手动重试，或打开详情查看原因。'))}</div>
      ${failedCaptures.map((c) => {
        const actions = Array.isArray(c.actions) ? c.actions : [];
        const retryBtn = actions.includes('retry')
          ? btn(T('cognition.capture_action_retry', '重试'), 'capture-action', { id: c.id, data: { action: 'retry' }, small: true, primary: true })
          : actions.includes('run_now')
            ? btn(T('cognition.capture_action_run_now', '立即开始'), 'capture-action', { id: c.id, data: { action: 'run_now' }, small: true, primary: true })
            : '';
        return `
      <div class="cap-row is-clickable" data-act="open-capture-detail" data-id="${esc(c.id)}" role="button" tabindex="0">
        <div class="tw"><div class="tt">${esc(captureTitle(c))}</div>
        <div class="mm"><span>${esc(vocab ? vocab.captureReasonText(c.displayReason) : T('cognition.capture_display_reason_other', '原因未记录'))} · ${esc(fmtDate(c.updatedAt || c.createdAt))}</span></div></div>
        <div class="sd">${retryBtn}</div>
      </div>`;
      }).join('')}</div>` : '';
    return `${hero(T('cognition.tab_activity', '系统活动'), T('cognition.activity_subtitle', '只记录筛选后的认知变化；普通聊天保留在原有聊天历史中。'), leadHtml)}
    ${promotedHtml}
    ${toggleHtml}
    ${ontologyHtml}
    ${allQuiet ? `<div class="sect-block">${empty(
      T('cognition.inbox_empty', '没有需要你确认的事项。'),
      T('cognition.review_all_quiet_hint', '现在没有要你决定的，系统继续在后台沉淀；有新待办时会回到这里。'),
    )}</div>` : `${decideHtml}
    ${broken.length || weak.length ? `<div id="ca-review-evidence">
    ${broken.length ? `${sectionHead(T('cognition.review_group_evidence', '来源需要核对的候选'), String(broken.length))}<div class="note sect-note">${esc(T('cognition.review_group_evidence_note', '部分来源暂时无法核对，不代表会话已删除。打开候选查看原文与可用来源，再决定是否保存。'))}</div>${broken.map((c) => candidateCard(c, true)).join('')}` : ''}
    ${weak.length ? `${sectionHead(T('cognition.review_group_weak', '证据不足（先补证据）'), String(weak.length))}<div class="note sect-note">${esc(T('cognition.review_group_weak_note', '可以修改内容并补上证据后保存，或先稍后处理'))}</div>${weak.map((c) => candidateCard(c, false)).join('')}` : ''}
    </div>` : ''}
    ${lowHtml}`}
    ${snoozed.length ? `<details class="details fold fold-snoozed"><summary>${esc(T('cognition.review_group_snoozed', '已稍后处理'))}<span class="n">${snoozed.length}</span></summary><div class="dbody"><div class="note">${esc(T('cognition.review_group_snoozed_note', '静音中，不计入待确认'))}</div>${snoozed.map((c) => candidateCard(c, false)).join('')}</div></details>` : ''}
    ${failedHtml}
    ${attentionHtml}`;
  }

  const normalizeActivityText = value => String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
  function activityScope(scope) {
    const key = ['general', 'report', 'code', 'review', 'product'].includes(scope) ? 'cognition.capture.scope_' + scope : '';
    return key ? T(key, scope) : scope || T('cognition.activity_scope_unknown', '范围待核对');
  }
  const activityDecisionLabels = {
    create: ['cognition.activity_decision_create', '确认保存'], update: ['cognition.activity_decision_update', '核对更新'],
    limit_scope: ['cognition.activity_decision_limit_scope', '核对范围'], pause: ['cognition.activity_decision_pause', '确认停用'],
    keep_current: ['cognition.activity_decision_keep_current', '确认保留现有内容'], reject: ['cognition.activity_decision_reject', '确认忽略'],
  };
  const activityOutcomeLabels = {
    confirmed: ['cognition.activity_outcome_confirmed', '已保存'], integrated: ['cognition.activity_outcome_integrated', '已纳入本体'],
    rejected: ['cognition.activity_outcome_rejected', '已拒绝'], ignored: ['cognition.activity_outcome_ignored', '已忽略'], expired: ['cognition.activity_outcome_expired', '已过期'],
    update: ['cognition.activity_outcome_update', '已更新'], limit_scope: ['cognition.activity_outcome_limit_scope', '已调整范围'], pause: ['cognition.activity_outcome_pause', '已停用'],
    keep_current: ['cognition.activity_outcome_keep_current', '已保留现有内容'], reject: ['cognition.activity_outcome_reject', '已忽略'],
  };
  const activityExclusionLabels = {
    task_local: ['cognition.activity_excluded_task_local', '此记录明确属于当次临时内容，已退出日常活动列表；原文与来源仍然保留。'],
    execution_record: ['cognition.activity_excluded_execution_record', '此记录属于执行或计数记录，已退出日常活动列表；原文与来源仍然保留。'],
    already_current: ['cognition.activity_excluded_already_current', '现行认知已包含完全相同的内容和范围，无需重复确认；原建议与来源仍然保留。'],
    isolated_source: ['cognition.activity_excluded_isolated_source', '此来源未接入日常认知治理；历史内容保留用于追溯。'],
  };
  function activityResult(candidate, waiting) {
    const action = candidate.suggestedAction || 'create';
    const label = waiting ? activityDecisionLabels[action] : activityOutcomeLabels[candidate.status === 'confirmed' && action !== 'create' ? action : candidate.status];
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
      const waiting = candidateAwaiting(c) && !['confirmed', 'integrated', 'rejected', 'ignored', 'expired', 'superseded'].includes(String(c.status || ''));
      if (!waiting && !['confirmed', 'integrated', 'rejected', 'ignored', 'expired'].includes(c.status)) continue;
      if (c.status === 'weak_observation' && !c.capabilities?.countsAsPending) continue;
      const action = c.suggestedAction || 'create';
      const result = activityResult(c, waiting);
      const activityAt = waiting ? c.createdAt || c.updatedAt || '' : c.updatedAt || c.createdAt || '';
      const row = { key: 'candidate:' + c.id, title: candidateTitle(c), detail: c.judgment || c.value || '', scope: activityScope(c.suggestedScope), rawAt: activityAt, at: fmtDate(activityAt), result: waiting && c.activityDeferredAt ? T('cognition.activity_deferred_result', '稍后 · 待处理') : result, route: { candidateId: c.id }, candidateIds: [c.id] };
      // 只折叠完全相同、同范围且同治理边界的建议；不同冲突/版本/风险绝不能合并。
      const hasConflict = (S.inbox || []).some(item => item.candidateId === c.id && item.kind !== 'candidate_pending_review');
      const identity = waiting && !hasConflict ? JSON.stringify([normalizeActivityText(c.judgment), c.suggestedType, normalizeActivityText(c.suggestedScope), action, c.targetAssetId, c.targetVersionUsed, c.scopePolicy, c.applicableWhen, c.forbiddenWhen, c.risk, c.capabilities?.displayState, c.capabilities?.eligibility])
        : !waiting && c.reviewDecisionId ? JSON.stringify(['decision', c.reviewDecisionId, c.promotedAssetId || c.targetAssetId, c.suggestedType, c.suggestedScope, normalizeActivityText(c.judgment)]) : row.key;
      const previous = decisionGroups.get(identity);
      if (previous) { previous.candidateIds.push(c.id); continue; }
      decisionGroups.set(identity, row);
      (waiting ? attention : done).push(row);
    }
    for (const item of S.inbox || []) {
      if (item.candidateId && item.kind === 'candidate_pending_review' && (excluded.has(item.candidateId) || candidates.some(c => c.id === item.candidateId && !candidateAwaiting(c)))) continue;
      if (item.candidateId && candidates.some(c => c.id === item.candidateId && NS.isKstarCandidate?.(c))) continue;
      const existing = item.candidateId ? attention.find(row => row.candidateIds.includes(item.candidateId)) : null;
      if (existing) {
        if (item.kind === 'candidate_pending_review') continue;
        if (!existing.route.inboxId) { existing.route = { inboxId: String(item.id) }; existing.key = 'inbox:' + item.id; existing.result = T('cognition.activity_check', '需要核对'); continue; }
        if (existing.route.inboxId === String(item.id)) continue;
      }
      attention.push({ key: 'inbox:' + item.id, title: item.title || item.summary || '', detail: item.detail || '', scope: activityScope(item.scope), rawAt: item.updatedAt || item.createdAt || '', at: fmtDate(item.updatedAt || item.createdAt), result: T('cognition.activity_check', '需要核对'), route: { inboxId: String(item.id) }, candidateIds: [] });
    }
    for (const c of (S.poCandidates || []).filter(c => !c.activityExclusionReason)) attention.push({ key: 'legacy:' + c.candidate_id, title: c.summary || c.memory_text || '', detail: T('cognition.activity_legacy_review', '核对旧内容是否值得保留'), scope: T('cognition.activity_scope_unknown', '范围待核对'), rawAt: c.recorded_time || c.created_at || '', at: fmtDate(c.recorded_time || c.created_at), result: T('cognition.activity_check', '需要核对'), route: { poCandidateId: c.candidate_id }, candidateIds: [] });
    // 本体逐次保存历史只在对应对象的详情查看；共同确认结果由候选的 integrated 记录承载。
    return { attention, done, excludedCount: excluded.size };
  }
  NS.activityModel = activityModel;

  const ACTIVITY_PAGE_SIZE = 50;
  const ACTIVITY_ACTIONS = Object.freeze(['activity-select', 'activity-tab', 'activity-clear', 'activity-page-select', 'activity-close', 'activity-next', 'activity-save-draft', 'activity-defer', 'activity-history']);
  const ACTIVITY_WRITE_ACTIONS = Object.freeze(['activity-save-draft', 'activity-defer']);
  const activityDrafts = new Map();
  let activitySelection = '';
  let activityDrawer = false;
  let activityRendered = false;
  let activityWasNarrow = false;
  let activityQueryTimer;
  const candidateFields = { type: 'suggestedType', judgment: 'judgment', value: 'value', uncertainty: 'uncertainty', summary: 'summary', scope: 'suggestedScope', applicable: 'applicableWhen', forbidden: 'forbiddenWhen' };
  const narrowActivity = () => !!window.matchMedia && window.matchMedia('(max-width: 960px), (max-height: 480px)').matches;
  const activityRoute = (patch = {}) => Object.assign({}, S.route, { name: 'activity', candidateId: '', inboxId: '', poCandidateId: '' }, patch);
  function selectedActivityKey(route) {
    return route.candidateId ? 'candidate:' + route.candidateId : route.inboxId ? 'inbox:' + route.inboxId : route.poCandidateId ? 'legacy:' + route.poCandidateId : activitySelection;
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
    if (processed) candidate.capabilities = Object.assign({}, candidate.capabilities, { canEdit: false, canPromote: false, canReject: false, canContinueOntology: false, isTerminal: true });
    const actor = original.processingActor;
    const reason = original.processingReason || original.decisionNote;
    const processing = processed ? `<div class="ca-activity-processing" role="status"><strong>${esc(row.result)} · ${esc(T('cognition.activity_readonly', '本记录为只读'))}</strong><p>${esc(T('cognition.activity_actor', '处理者'))}：${esc(actor || T('cognition.activity_actor_unknown', '历史记录未提供'))}</p><p>${esc(T('cognition.activity_reason', '处理依据'))}：${esc(reason || T('cognition.activity_reason_unknown', '历史记录未提供处理依据'))}</p></div>` : '';
    return processing + NS.candidate.formCard(candidate, { compact: true }) + (row.candidateIds.length > 1 ? `<p class="note">${esc(T('cognition.activity_related_proposals', '相同建议已在列表合并，原始建议和来源仍分别保留。'))} ${esc(String(row.candidateIds.length))}</p>` : '');
  }
  function activityInboxDetail(row, processed) {
    const item = (S.inbox || []).find(item => String(item.id) === String(row.route.inboxId));
    if (!item) return empty(T('cognition.activity_item_missing', '这条变化暂时无法定位'), T('cognition.activity_item_missing_hint', '请返回列表核对最新处理结果。'));
    const actions = !processed && Array.isArray(item.actions) ? item.actions : [];
    const id = String(item.id), kind = String(item.kind || '');
    const linked = [item.assetId, ...(item.assetIds || [])].filter(Boolean).filter((id, index, ids) => ids.indexOf(id) === index).map(id => S.assets.find(asset => String(asset.id) === String(id))).filter(Boolean);
    const pair = linked.map((asset, index) => `<section class="ca-activity-linked"><span class="note">${esc(T('cognition.activity_linked_asset', '关联资产'))} ${String.fromCharCode(65 + index)} · v${esc(String(asset.activeVersion || asset.version || ''))}</span><h3>${esc(asset.title || '')}</h3><p class="note">${esc(activityScope(asset.scope))}</p><p class="content-text">${esc(asset.statement || '')}</p>${btn(T('cognition.inbox_go_asset', '去资产详情处理'), 'go-inbox-asset', { id: asset.id, small: true })}</section>`).join('');
    let form = '';
    let buttons = '';
    if (kind === 'rule_boundary_missing' && !processed) {
      const boundary = item.boundary || {};
      form = `<div class="notice-row ca-inbox-boundary" data-inbox-boundary-form><label class="field"><span>${esc(T('cognition.inbox_boundary_field_applicable', '适用情形'))}</span>${window.uiTextarea({ id: 'ca-boundary-applicable', value: (boundary.applicableWhen || []).join('；'), attrs: { 'data-f': 'boundary-applicable' } })}</label><label class="field"><span>${esc(T('cognition.inbox_boundary_field_forbidden', '禁用情形'))}</span>${window.uiTextarea({ id: 'ca-boundary-forbidden', value: (boundary.forbiddenWhen || []).join('；'), attrs: { 'data-f': 'boundary-forbidden' } })}</label>${btn(T('cognition.inbox_boundary_submit', '保存边界'), 'inbox-boundary-save', { id, primary: true })}</div>`;
    } else {
      if (kind === 'classification_conflict' && actions.includes('claim')) buttons += btn(T('cognition.inbox_action_claim', '保留这一条'), 'inbox-conflict-claim', { id, primary: true });
      if (kind === 'inspection_finding') {
        for (const [index, asset] of linked.entries()) if (actions.includes('keep')) buttons += btn(T('cognition.activity_keep_pair', '保留 {name}，归档另一条', { name: String.fromCharCode(65 + index) }), 'inbox-inspection-keep', { id, primary: index === 0, data: { anchor: asset.id } });
        if (actions.includes('merge') && linked.length) buttons += btn(T('cognition.inbox_action_merge_pair', '合并到这一条'), 'inbox-inspection-merge', { id, data: { anchor: linked[0].id } });
      }
      const labels = kind === 'asset_change_pending' ? { accept: T('cognition.inbox_action_accept_update', '保存更新'), reject: T('cognition.inbox_action_reject_proposal', '拒绝'), defer: T('cognition.inbox_action_defer_later', '稍后处理') } : { accept: T('cognition.inbox_action_accept', '保存'), reject: T('cognition.inbox_action_dismiss', '不管它'), ignore: T('cognition.inbox_action_ignore', '忽略'), defer: T('cognition.inbox_action_look_later', '回头再看') };
      for (const action of actions.filter(action => Object.prototype.hasOwnProperty.call(labels, action))) buttons += btn(labels[action], 'inbox-resolve', { id, data: { action }, primary: action === 'accept' });
      if (!buttons && item.assetId) buttons = btn(T('cognition.inbox_go_asset', '去资产详情处理'), 'go-inbox-asset', { id: item.assetId, primary: true });
    }
    const candidate = item.candidateId && S.candidates.find(candidate => String(candidate.id) === String(item.candidateId));
    const source = candidate ? `<div class="sect-block"><p class="content-text">${esc(candidate.judgment || '')}</p>${NS.ui.evidenceGroupsHtml(candidate.evidenceRefs || candidate.sourceRefs || [])}</div>` : '';
    return `${item.detail ? `<p class="note">${esc(item.detail)}</p>` : ''}${source}${pair}${form}${buttons ? `<div class="actions actions-right">${buttons}</div>` : ''}`;
  }
  function activityDetail(row, processed) {
    if (!row) return empty(T('cognition.activity_select_item', '选择一项查看详情'), T('cognition.activity_select_hint', '在左侧浏览建议，核对内容与来源后逐项处理。'));
    let content;
    if (row.route.candidateId) content = activityCandidate(row, processed);
    else if (row.route.inboxId) content = activityInboxDetail(row, processed);
    else content = governanceDetail(Object.assign({}, row.route, { name: 'activity' }));
    let fixedActions = '';
    const actionPattern = row.route.candidateId ? /<div class="actions actions-right" data-activity-primary-actions>([\s\S]*?)<\/div>/ : /<div class="actions actions-right">([\s\S]*?)<\/div>/;
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
    const subtitle = candidate ? `${operation} · ${NS.ui.categoryLabel(candidate.suggestedType)}` : row.scope;
    const risk = candidate && ['medium', 'high'].includes(candidate.risk)
      ? chip(candidate.risk === 'high' ? T('cognition.activity_risk_high', '高风险候选') : T('cognition.activity_risk_medium', '需谨慎核对'), 'amber')
      : candidate ? chip(T('cognition.activity_risk_normal', '普通候选'), 'line') : '';
    return `<header class="ca-activity-detail-head"><div class="ca-activity-detail-heading"><h2>${esc(detailTitle)}</h2><p>${esc(subtitle)}</p></div><div class="ca-activity-detail-badges">${risk}${processed ? chip(row.result, 'line') : ''}${btn(T('common.close', '关闭'), 'activity-close', { small: true, className: 'o' })}</div></header><div class="ca-activity-detail-body" data-activity-key="${esc(row.key)}">${content}</div><footer class="ca-activity-detail-footer">${fixedActions}${processed ? btn(T('cognition.activity_next_item', '下一项'), 'activity-next', { small: true }) + btn(T('cognition.activity_back_pending', '返回需要关注 ›'), 'activity-tab', { id: 'attention', small: true, className: 'o' }) : ''}</footer>`;
  }
  function viewActivity(route) {
    const model = activityModel();
    const isNarrow = narrowActivity();
    if (!activityRendered && isNarrow && (route.candidateId || route.inboxId || route.poCandidateId)) activityDrawer = true;
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
    if (!selected && (route.candidateId || route.inboxId || route.poCandidateId)) {
      selected = [...model.attention, ...model.done].find(row => row.key === key || row.candidateIds.includes(route.candidateId));
      if (!selected && route.candidateId && S.candidates.some(c => c.id === route.candidateId)) selected = { key, route: { candidateId: route.candidateId }, candidateIds: [route.candidateId], result: activityResult(S.candidates.find(c => c.id === route.candidateId), false) };
    }
    if (!selected && (route.inboxId || route.poCandidateId)) selected = { key, route: { inboxId: route.inboxId, poCandidateId: route.poCandidateId }, candidateIds: [], result: '' };
    if (!selected && !narrowActivity()) selected = rows[0];
    if (selected) activitySelection = selected.key;
    const showDrawer = isNarrow && !!selected && activityDrawer;
    const table = rows.length ? `<table class="ca-activity-table"><thead><tr><th>${esc(T('cognition.activity_proposed_change', '建议变化'))}</th><th>${esc(T('cognition.activity_scope', '适用范围'))}</th><th>${esc(T('cognition.activity_time', '发生时间'))}</th><th>${esc(T(processed ? 'cognition.activity_result' : 'cognition.activity_decision', processed ? '处理结果' : '需要你决定'))}</th></tr></thead><tbody>${rows.map(row => `<tr role="button" tabindex="0" aria-pressed="${selected?.key === row.key}" aria-label="${esc(row.title + '，' + row.result)}" class="${selected?.key === row.key ? 'is-selected' : ''}" data-act="activity-select" data-id="${esc(row.key)}"><td><strong>${esc(row.title)}</strong><p>${esc(normalizeActivityText(row.detail))}</p></td><td>${esc(row.scope)}</td><td>${esc(row.at)}</td><td>${esc(row.result)}<span aria-hidden="true"> ›</span></td></tr>`).join('')}</tbody></table>`
      : empty(T(processed ? 'cognition.activity_done_empty' : 'cognition.activity_empty', processed ? '暂无已处理的认知变化' : '当前没有需要关注的认知变化'), T(route.activityQuery ? 'cognition.activity_search_empty' : 'cognition.activity_empty_hint', route.activityQuery ? '没有匹配的变化，请调整搜索条件。' : '没有有价值的结果时，这里保持空白。'));
    const failed = S.candidatesError || S.inboxError || S.poCandidatesError;
    const pages = Math.max(1, Math.ceil(all.length / ACTIVITY_PAGE_SIZE));
    const detailProcessed = processed || (!!selected?.route.candidateId && model.done.some(row => row.candidateIds.includes(selected.route.candidateId)));
    return `<section class="ca-activity-page">${hero(T('cognition.tab_activity', '系统活动'), T('cognition.activity_page_hint', '集中浏览建议，逐项核对后处理。'))}
      <div class="ca-activity-tabs" ${showDrawer ? 'inert' : ''} role="tablist" aria-label="${esc(T('cognition.activity_views', '活动视角'))}">${['attention', 'done'].map((view, index) => window.uiButton({ label: T(index ? 'cognition.activity_done' : 'cognition.activity_attention', index ? '已处理' : '需要关注') + ' ' + (index ? model.done.length : model.attention.length), className: processed === !!index ? 'is-active' : '', attrs: { role: 'tab', 'aria-selected': String(processed === !!index), 'data-act': 'activity-tab', 'data-id': view } })).join('')}</div>
      <div class="ca-activity-toolbar" ${showDrawer ? 'inert' : ''}><div class="ca-prototype-search">${window.uiIconHtml('cognition-search')}${window.uiInput({ id: 'ca-activity-query', type: 'search', value: route.activityQuery || '', placeholder: T('cognition.activity_search_placeholder', '搜索标题、摘要或适用范围'), attrs: { 'aria-label': T('cognition.activity_search', '搜索变化内容或适用范围') } })}</div>${route.activityQuery ? btn(T('cognition.activity_clear_search', '清空搜索'), 'activity-clear', { small: true }) : ''}<span class="ca-activity-sync" ${failed ? 'role="alert"' : 'role="status"'}>${esc(S.loading ? T('cognition.activity_loading', '正在读取活动…') : failed ? T('cognition.activity_read_failed', '部分变化未能读取，请重试；不能据此判断没有待处理内容。') : T('cognition.activity_updated', '已更新'))}</span>${btn(T(failed ? 'common.retry' : 'common.refresh', failed ? '重试' : '刷新'), 'refresh', { small: true })}</div>
      <div class="ca-activity-layout"><div class="ca-activity-list" ${showDrawer ? 'inert' : ''}><div class="ca-activity-table-wrap">${table}</div><div class="ca-activity-pagination"><span>${esc(T('cognition.activity_pagination', '每页 50 条 · 第 {start}–{end} 条 / 共 {total} 条（合并后）', { start: String(all.length ? page * ACTIVITY_PAGE_SIZE + 1 : 0), end: String(Math.min(all.length, (page + 1) * ACTIVITY_PAGE_SIZE)), total: String(all.length) }))}</span><div>${btn(T('common.previous', '上一页'), 'activity-page-select', { id: String(page - 1), small: true, disabled: page === 0 })}<span>${page + 1} / ${pages}</span>${btn(T('common.next', '下一页'), 'activity-page-select', { id: String(page + 1), small: true, disabled: page + 1 >= pages })}</div></div><p class="ca-activity-list-note">${esc(T('cognition.activity_list_note', '条目按来源时间排序；不同类型分别处理，不提供批量接受。'))}<span>${esc(T('cognition.activity_keyboard', '↑ ↓ 浏览 · Enter 打开详情 · Esc 关闭'))}</span>${processed ? `<span>${esc(T('cognition.activity_save_is_not_use', '保存不代表任务已采用。'))}</span>` : ''}</p></div><aside class="ca-activity-detail${showDrawer ? ' is-drawer-open' : ''}" aria-label="${esc(T('cognition.activity_detail', '活动详情'))}" ${showDrawer ? 'role="dialog" aria-modal="true"' : ''}>${activityDetail(selected, detailProcessed)}</aside></div>${showDrawer ? window.uiButton({ label: T('common.close', '关闭'), role: 'ghost', className: 'ca-activity-scrim', attrs: { 'data-act': 'activity-close', 'aria-label': T('common.close', '关闭'), tabindex: '-1' } }) : ''}</section>`;
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
      if (act === 'cand-type') { const card = el.closest?.('.ca-activity-detail .ca-candidate-detail'); if (card) { const candidateId = String(card.dataset.candId); activityDrafts.set(candidateId, Object.assign({}, activityDrafts.get(candidateId) || {}, { suggestedType: id })); } return false; }
      if (act === 'cand-decide' && !(await mayLeaveActivity())) return true;
      if (!ACTIVITY_ACTIONS.includes(act)) return false;
      if (el.disabled || el.getAttribute('disabled') !== null) return true;
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
          if (!candidate || candidate.capabilities?.isTerminal) return true;
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
      if (property === 'suggestedType') card.dataset.candType = String(field.value);
      const candidateId = String(card.dataset.candId);
      const draft = Object.assign({}, activityDrafts.get(candidateId) || {}, { suggestedType: card.dataset.candType });
      draft[property] = ['applicableWhen', 'forbiddenWhen'].includes(property) ? String(field.value).split(/\r?\n/).map(value => value.trim()).filter(Boolean) : String(field.value);
      activityDrafts.set(candidateId, draft);
      if (S.activityDraftValidation) delete S.activityDraftValidation[candidateId];
      card.querySelector?.('[data-draft-validation]')?.remove?.();
      if (property === 'suggestedType') NS.notify();
      return true;
    },
    async handleKeydown(event) {
      if (event.isComposing) return false;
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
