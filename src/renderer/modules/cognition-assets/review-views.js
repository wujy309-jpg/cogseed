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

  function viewActivity(route) {
    // A5（2026-09-29）：候选清单读取失败进显式错误态——不再把「没读到」伪装
    // 成「没有要你决定的」空态。P-r1-58（2026-10-02）：读失败判定先于深链
    // 分支——错误态对深链同样成立：先如实报清单读取失败并给重试入口。
    if (S.candidatesError) {
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
    const pending = S.candidates.filter(candidatePending);
    const displayState = (c) => String(((c || {}).capabilities || {}).displayState || '');
    const awaiting = pending.filter(candidateAwaiting);
    const broken = awaiting.filter(evidenceMostlyUnavailable);
    const weak = awaiting.filter((c) => !evidenceMostlyUnavailable(c) && displayState(c) === 'weak_evidence');
    const ready = awaiting.filter((c) => !evidenceMostlyUnavailable(c) && displayState(c) !== 'weak_evidence');
    const snoozed = pending.filter((c) => c.capabilities && c.capabilities.isSnoozed);
    const terminal = S.candidates.filter((c) => ['expired', 'superseded'].includes(displayState(c)) && !candidatePending(c)).slice(0, 8);
    const processed = S.candidates
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
    const inboxItems = Array.isArray(S.inbox) ? S.inbox : [];
    const inboxGroups = Array.isArray(S.inboxGroups) ? S.inboxGroups : null;
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
    const poList = Array.isArray(S.poCandidates) ? S.poCandidates : [];
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

  NS.viewActivity = viewActivity;
  // 兼容别名：旧深链/测试曾调 NS.viewReview；行为同 viewActivity（review 路由
  // 已在 router.go 归一到 activity）。
  NS.viewReview = viewActivity;
})();
