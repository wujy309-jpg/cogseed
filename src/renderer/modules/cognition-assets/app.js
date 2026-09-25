/* ============================================================================
 * 认知资产 · 引导层（cognition-assets/app.js）
 *
 * 唯一职责：把 core + views 接到真实 DOM 上。
 *  - 挂载：渲染进 #panel-recall > #ca-root；
 *  - 事件：全面板一个委托层（data-act / data-go），新交互只登记一处；
 *  - 生命周期：面板首次激活时拉数据；概览页按需拉认知树。
 * ========================================================================== */
(function () {
  'use strict';

  const NS = window.CogAssets;
  if (!NS) return;
  const { store: S, router, actions: A, T } = NS;

  let treeRequested = false;
  let booted = false;

  /** 写操作集合：点击后按钮进入 pending（禁用+变淡），完成或重画后还原。 */
  const WRITE_ACTIONS = new Set([
    'refresh', 'cand-adopt-with-form', 'cand-decide',
    'asset-action', 'asset-recommend-ack', 'select-asset-version', 'rollback-asset', 'delete-asset-version',
    'run-cleanup', 'rollback-cleanup-item', 'cleanup-uncertain-dismiss', 'cleanup-uncertain-defer',
    'inspection-toggle', 'run-inspection', 'purge-deleted-asset', 'inbox-resolve', 'asset-edit-save', 'family-rename', 'family-rename-save', 'family-rename-cancel', 'edit-from-version', 'merge-asset-version', 'merge-asset', 'source-action', 'capture-action', 'organize-conv',
    // 治理待办就地处断（specs/010 T010）：扩权确认/驳回、冲突选边、巡检
    // 选边/合并、单条与批量定级、补边界保存。全部经 cognition.inbox.resolve
    // 或 recall.assets.sensitivity.batch（core.actions 转发，不在渲染层写）。
    'inbox-escalation-accept', 'inbox-escalation-reject', 'inbox-conflict-claim',
    'inbox-inspection-keep', 'inbox-inspection-merge',
    'inbox-classify-apply', 'inbox-classify-batch', 'inbox-boundary-save',
    'capture-toggle', 'capture-review-toggle', 'proof-rate',
    'capture-batch',
    // 经验目录管理（specs/016 US-803）：四个管理动作 + 迁移执行；preview/status
    // 是只读扫描，不进 pending 集（与 refresh 的口径不同：它们有各自的载入态）。
    'experience-status-toggle', 'experience-set-type', 'experience-merge', 'experience-archive', 'experience-migration-run',
    // 标签系统（specs/012 US-201）：单打标/移除/批量执行/管理三动作都是写通道。
    'tag-add', 'tag-remove', 'tag-batch-run', 'tag-rename-save', 'tag-merge-confirm', 'tag-delete',
    // 推荐排序权重（specs/012 US-202 AC6）：保存走唯一写通道（恢复默认只在
    // 本地回填输入框，不落盘，不进 pending 集）。
    'ranking-weights-save',
  ]);

  /* ────────────────────────── 事件委托 ────────────────────────── */

  function readCandidateForm(anchorEl) {
    // 就近读取（2026-09-15 内嵌表单后一页可能有多张候选卡）：从被点的按钮
    // 向上找最近的表单卡；无锚点时退回全局第一张（兼容旧调用）。
    const card = anchorEl && anchorEl.closest
      ? anchorEl.closest('.ca-candidate-detail')
      : document.querySelector('.ca-candidate-detail');
    if (!card) return null;
    // 只读候选（无任何表单控件）时返回 null：调用方按「未携带编辑」处理，
    // 防止一次「保存并使用」用空串覆盖已有内容。
    if (!card.querySelector('[data-f]')) return null;
    const value = (name) => {
      const el = card.querySelector(`[data-f="${name}"]`);
      return el ? String(el.value || '') : '';
    };
    return {
      suggestedType: String(card.dataset.candType || ''),
      suggestedScope: value('scope'),
      summary: value('summary'),
      judgment: value('judgment'),
    };
  }

  function bindEvents(root) {
    root.addEventListener('click', async (event) => {
      const assetRow = event.target.closest('[data-go-asset]');
      if (assetRow) { router.go({ name: 'overview', assetId: assetRow.dataset.goAsset }); return; }
      const el = event.target.closest('[data-act]');
      if (!el) return;
      const act = el.dataset.act;
      const id = el.dataset.id || '';
      const isWrite = WRITE_ACTIONS.has(act);
      if (isWrite) {
        el.classList.add('is-pending');
        el.setAttribute('disabled', 'disabled');
        el.setAttribute('aria-busy', 'true');
      }
      try {
        switch (act) {
          case 'go-back': {
            // 「返回」按文案回列表（2026-09-17 修）：此前是 router.back()——
            // "返回上一步"，从候选/整理详情跳进资产详情后，点返回退回的是
            // 跳转前的深层页而不是列表，与按钮文案不符。按详情类型归位到
            // 对应列表根（资产详情保留分类筛选）；仍压栈，需要时可再进详情。
            const name = S.route.candidateId ? 'review'
              : S.route.experienceId ? 'experiences'
                : (S.route.captureId || S.route.name === 'organize' || S.route.name === 'organize-settings') ? 'organize'
                  : 'overview';
            router.go({ name, category: name === 'overview' ? String(S.route.category || '') : '' });
            break;
          }
          case 'cand-type': {
            // 类型选择是纯前端态：只更新 chip 选中与卡片 dataset，不触发重画
            // （整页重画会丢失其他字段未保存的输入）。
            const card = el.closest('.ca-candidate-detail');
            if (card) card.dataset.candType = id;
            el.parentElement.querySelectorAll('.ca-chip-opt').forEach((chipEl) => {
              const on = chipEl === el;
              chipEl.classList.toggle('is-green', on);
              chipEl.setAttribute('aria-pressed', on ? 'true' : 'false');
            });
            break;
          }
          case 'toggle-asset-more': {
            const wrap = el.closest('.ca-more-wrap');
            const menu = wrap ? wrap.querySelector('[data-asset-more]') : null;
            if (menu) { menu.hidden = !menu.hidden; el.classList.toggle('is-open', !menu.hidden); }
            break;
          }
          case 'refresh': await NS.reload({ tree: true }); await NS.reload(); break;
          case 'tab': router.go({ name: id }); break;
          case 'filter-cat': router.go({ name: 'overview', category: id }); break;
          // 目录视图切换（2026-09-18）：同一个列表页换一种行形态（模型视角），
          // 不新增 tab。assetView 必须进 router.go 的归一化白名单，否则被丢弃。
          case 'asset-view': router.go({ name: 'overview', assetView: id === 'catalog' ? 'catalog' : '' }); break;
          case 'go-review': router.go({ name: 'review' }); break;
          case 'go-organize': router.go({ name: 'organize' }); break;
          case 'go-configure-model': {
            // configuration_required 的处理出口：模型配置在应用设置页
            // 「设置 → 配置」的模型区。与 model-chip.js / kb-workbench.js 同一条缝：
            // 设置页懒加载，tab 与锚点必须挂在 setView 上，否则落到默认的「数据」tab。
            if (typeof window.setView === 'function') {
              window.setView('settings', undefined, { settingsTab: 'configuration', settingsAnchor: 'models' });
            }
            if (typeof window.activateSettingsTab === 'function') {
              window.activateSettingsTab('configuration', { anchor: 'models' });
            }
            break;
          }
          case 'toggle-source-issues': {
            // 来源异常就地展开（异常驱动：健康时无入口，无常态页）。
            router.go({
              name: 'review',
              sourceIssueOpen: String(S.route.sourceIssueOpen || '') === 'open' ? '' : 'open',
            });
            break;
          }
          case 'go-organize-settings': router.go({ name: 'organize-settings' }); break;
          case 'nightly-toggle': {
            // 夜间自动沉淀开关：开 = nightly（并联动「先问我」——产出进
            // 「待我处理」等批准，而非自动采纳）；关 = 回到纯手动。
            // 开启是额度消耗行为：先确认。
            const on = !(S.captureSettings && String(S.captureSettings.executionPolicy || '') === 'nightly');
            if (on) {
              const ok = await NS.confirmUser(T('cognition.nightly_capture_confirm', '开启后，夜间会在所选时间自动整理当天结束的会话，每次整理都会消耗模型额度。确认开启？'));
              if (!ok) break;
            }
            const previous = S.captureSettings;
            const patch = on
              ? { executionPolicy: 'nightly', reviewPolicy: 'manual' }
              : { executionPolicy: 'manual' };
            S.captureSettings = Object.assign({}, previous, patch);
            NS.notify();
            try {
              await A.updateCaptureSettings(patch);
            } catch (error) {
              S.captureSettings = previous;
              NS.notify();
              throw error;
            }
            break;
          }
          case 'capture-filter': router.go({ name: 'organize', captureBucket: id }); break;
          case 'open-capture-detail': {
            router.go({ name: 'organize', captureId: id });
            void NS.loadCaptureContext(id);
            break;
          }
          case 'open-conversation': NS.openConversation(id); break;
          case 'capture-batch': {
            // 批量动作的条数在渲染时写死进按钮（只数当前已加载且该动作可执行
            // 的行）；这里再次从 store 收敛同一口径，防止路由/数据在确认弹窗
            // 与执行之间变动后多发。只保留批量重试（2026-09-21 原型 v7 定调：
            // 批量「立即整理」入口不迁移，单条任务行的立即整理保留）。
            const runnable = (S.captures || []).filter((capture) => (
              Array.isArray(capture.actions) && capture.actions.includes(el.dataset.batch || '')
            ));
            if (!runnable.length || el.dataset.batch !== 'retry') break;
            const ok = await NS.confirmUser(T('cognition.capture_batch_retry_confirm', '确认重试 {n} 条失败的整理任务？', { n: String(runnable.length) }));
            if (!ok) break;
            await A.captureBatch('retry', runnable.map((capture) => capture.id));
            break;
          }
          case 'open-candidate': router.go({ name: 'review', candidateId: id }); break;
          case 'open-ontology': await NS.openPersonalOntology(); break;
          case 'open-asset': router.go({ name: 'overview', assetId: id }); break;
          case 'open-overview': router.go({ name: 'overview' }); break;
          case 'cand-adopt-with-form': await A.adoptCandidate(id, readCandidateForm(el) || undefined); break;
          case 'cand-decide': await A.decideCandidate(id, el.dataset.action); break;
          case 'asset-action': await A.assetAction(id, el.dataset.action); break;
          case 'asset-recommend-ack': await A.acknowledgeAssetRecommendation(id); break;
          case 'select-asset-version': await A.selectAssetVersion(id, el.dataset.version || ''); break;
          case 'rollback-asset': await A.rollbackAsset(id, el.dataset.version || ''); break;
          case 'run-cleanup': await A.runCleanup(); break;
          case 'inspection-toggle': await A.setInspectionEnabled(!(S.inspection && S.inspection.settings && S.inspection.settings.enabled)); break;
          case 'run-inspection': await A.runInspection(); break;
          case 'purge-deleted-asset': {
            const ok = await confirmUser(T('cognition.deleted_purge_confirm', '彻底删除后内容与记录一并清除、不可恢复。确认删除？'), true);
            if (ok) await A.purgeDeletedAsset(id);
            break;
          }
          case 'inbox-resolve': await A.resolveInboxItem(id, el.dataset.action || ''); break;
          /* ── 治理待办就地处断（specs/010 T010 / contracts/renderer-seams §3）─────────
           *  档位选择只改 DOM 暂存值（不写库）；其余动作全部经 core.actions 走
           *  cognition.inbox.resolve / recall.assets.sensitivity.batch。 */
          case 'inbox-classify-level': {
            // 仅本地选择状态：切选中档、把暂存值记在容器上（契约 §4：不进 store）。
            const pressed = event.target.closest('[data-level]');
            if (!pressed) break;
            el.dataset.level = String(pressed.dataset.level || '');
            el.querySelectorAll('[data-level]').forEach((option) => {
              option.setAttribute('aria-pressed', String(option === pressed));
            });
            break;
          }
          case 'inbox-classify-apply': {
            const control = root.querySelector(`[data-act="inbox-classify-level"][data-key="${CSS.escape(String(id))}"]`);
            const level = control ? String(control.dataset.level || '') : '';
            if (!level) {
              await NS.alertUser(T('cognition.inbox_ask_classify', '补充敏感级分类'));
              break;
            }
            await A.resolveInboxItem(id, 'classify', { level });
            break;
          }
          case 'inbox-classify-batch': {
            const control = root.querySelector(`[data-act="inbox-classify-level"][data-key="${CSS.escape(String(id))}"]`);
            const level = control ? String(control.dataset.level || '') : '';
            if (!level) {
              await NS.alertUser(T('cognition.inbox_ask_classify', '补充敏感级分类'));
              break;
            }
            const assetIds = String(el.dataset.ids || '').split(',').map((value) => value.trim()).filter(Boolean);
            await A.classifyAssetsBatch(assetIds, level);
            break;
          }
          case 'inbox-boundary-save': {
            // 就地读 [data-f]（契约 §4）：多值按顿号/逗号分隔，与资产编辑同口径。
            const form = el.closest('[data-inbox-boundary-form]');
            if (!form) break;
            const readList = (field) => String((form.querySelector(`[data-f="${field}"]`) || {}).value || '')
              .split(/[、,，]/).map((value) => value.trim()).filter(Boolean);
            await A.resolveInboxItem(id, 'set_boundary', {
              applicableWhen: readList('applicableWhen'),
              forbiddenWhen: readList('forbiddenWhen'),
            });
            break;
          }
          case 'inbox-escalation-accept': await A.resolveInboxItem(id, 'accept'); break;
          case 'inbox-escalation-reject': await A.resolveInboxItem(id, 'reject'); break;
          case 'inbox-conflict-claim': await A.resolveInboxItem(id, 'claim'); break;
          case 'inbox-inspection-keep': await A.resolveInboxItem(id, 'keep', { targetAssetId: el.dataset.anchor || '' }); break;
          case 'inbox-inspection-merge': await A.resolveInboxItem(id, 'merge', { targetAssetId: el.dataset.anchor || '' }); break;
          case 'go-inbox-asset': router.go({ name: 'overview', assetId: id }); break;
          case 'open-cleanup': router.go({ name: 'cleanup', cleanupReportId: '' }, { replace: true }); break;
          case 'open-cleanup-report': router.go({ name: 'cleanup', cleanupReportId: String(el.dataset.report || '') }, { replace: true }); break;
          case 'rollback-cleanup-item': await A.rollbackCleanupItem(id, el.dataset.version || ''); break;
          case 'cleanup-uncertain-dismiss': await A.decideCleanupItem(String(el.dataset.report || ''), id, 'reject'); break;
          case 'cleanup-uncertain-defer': await A.decideCleanupItem(String(el.dataset.report || ''), id, 'defer'); break;
          case 'delete-asset-version': await A.deleteAssetVersion(id, el.dataset.version || ''); break;
          case 'edit-asset': {
            // 进入/退出编辑态（纯路由切换，不压返回栈）。
            router.go({ name: 'overview', assetId: String(S.route.assetId || ''), assetEdit: S.route.assetEdit ? '' : '1' }, { replace: true });
            break;
          }
          case 'asset-edit-save': await A.editAsset(id); break;
          case 'asset-use-in-chat': await A.attachAssetToConversation(id); break;
          /* ── 标签系统（specs/012 US-201，T010~T013）──────────────────────────
           *  路由类（筛选/多选/弹层开合/行内编辑态）走 router.go 或 store；
           *  写类转调 core.actions 的标签动作（recall.assets.tags.* / recall.tags.*）。 */
          case 'filter-tag': {
            // 标签 chip 多选（默认并集）：点名切换，独立于类型筛选（AND 叠加）。
            const state = NS.parseTagFilterRoute(S.route);
            const key = (value) => String(value || '').trim().toLocaleLowerCase();
            const names = state.names.some((entry) => key(entry) === key(id))
              ? state.names.filter((entry) => key(entry) !== key(id))
              : [...state.names, id];
            router.go({ name: 'overview', category: String(S.route.category || ''), assetView: String(S.route.assetView || ''), tagFilter: NS.joinTagFilter(names), tagMode: state.mode === 'all' ? 'all' : '', tagUntagged: String(S.route.tagUntagged || '') === '1' ? '1' : '', tagSelect: String(S.route.tagSelect || '') === '1' ? '1' : '' });
            break;
          }
          case 'filter-tag-mode': {
            const next = el.dataset.mode === 'all' ? 'all' : '';
            router.go({ name: 'overview', category: String(S.route.category || ''), assetView: String(S.route.assetView || ''), tagFilter: String(S.route.tagFilter || ''), tagMode: next, tagUntagged: String(S.route.tagUntagged || '') === '1' ? '1' : '', tagSelect: String(S.route.tagSelect || '') === '1' ? '1' : '' });
            break;
          }
          case 'filter-untagged': {
            // 「未分类」筛选生效时顺手进入多选态（renderer-seams §1：批量补标入口）；
            // 取消「未分类」时保持用户原有的多选态，不强行退出。
            const on = String(S.route.tagUntagged || '') === '1';
            const keepSelect = String(S.route.tagSelect || '') === '1' ? '1' : '';
            router.go({ name: 'overview', category: String(S.route.category || ''), assetView: String(S.route.assetView || ''), tagFilter: String(S.route.tagFilter || ''), tagMode: String(S.route.tagMode || '') === 'all' ? 'all' : '', tagUntagged: on ? '' : '1', tagSelect: on ? keepSelect : '1' });
            break;
          }
          case 'tag-more': {
            router.go({ name: 'overview', category: String(S.route.category || ''), assetView: String(S.route.assetView || ''), tagFilter: String(S.route.tagFilter || ''), tagMode: String(S.route.tagMode || '') === 'all' ? 'all' : '', tagUntagged: String(S.route.tagUntagged || '') === '1' ? '1' : '', tagSelect: String(S.route.tagSelect || '') === '1' ? '1' : '', tagOverlay: 'more' });
            break;
          }
          case 'tag-manage': {
            router.go({ name: 'overview', category: String(S.route.category || ''), assetView: String(S.route.assetView || ''), tagFilter: String(S.route.tagFilter || ''), tagMode: String(S.route.tagMode || '') === 'all' ? 'all' : '', tagUntagged: String(S.route.tagUntagged || '') === '1' ? '1' : '', tagSelect: String(S.route.tagSelect || '') === '1' ? '1' : '', tagOverlay: 'manage' });
            break;
          }
          case 'tag-overlay-close': {
            router.go({ name: 'overview', category: String(S.route.category || ''), assetView: String(S.route.assetView || ''), tagFilter: String(S.route.tagFilter || ''), tagMode: String(S.route.tagMode || '') === 'all' ? 'all' : '', tagUntagged: String(S.route.tagUntagged || '') === '1' ? '1' : '', tagSelect: String(S.route.tagSelect || '') === '1' ? '1' : '', tagOverlay: '' }, { replace: true });
            break;
          }
          case 'tag-add': {
            // 预设候选（点已有标签 chip）优先；否则读输入框当前值。
            const preset = el.dataset.preset === '1' ? String(el.dataset.name || '') : '';
            const input = preset ? null : root.querySelector(`[data-tag-input][data-asset-id="${CSS.escape(String(id))}"]`);
            const name = preset || (input ? String(input.value || '') : '');
            await A.addAssetTag(id, name);
            if (input) input.value = '';
            break;
          }
          case 'tag-remove': await A.removeAssetTag(id, el.dataset.name || ''); break;
          case 'tag-select-mode': {
            // 进入/退出多选：退出时清选择（下次进入从零开始）。
            const entering = String(S.route.tagSelect || '') !== '1';
            if (!entering) S.tagSelectIds = [];
            router.go({ name: 'overview', category: String(S.route.category || ''), assetView: String(S.route.assetView || ''), tagFilter: String(S.route.tagFilter || ''), tagMode: String(S.route.tagMode || '') === 'all' ? 'all' : '', tagUntagged: String(S.route.tagUntagged || '') === '1' ? '1' : '', tagSelect: entering ? '1' : '' }, { replace: true });
            NS.notify();
            break;
          }
          case 'tag-select-toggle': {
            const selected = new Set((S.tagSelectIds || []).map(String));
            if (selected.has(String(id))) selected.delete(String(id));
            else selected.add(String(id));
            S.tagSelectIds = [...selected];
            NS.notify();
            break;
          }
          case 'tag-select-all': {
            // 全选本页 = 当前筛选（类型 + 标签）后的可见列表；kstar 档按归边
            // 判定取（与 viewOverview 的 filtered 同一口径）。
            const hidden = ['archived', 'deleted', 'purged', 'revoked'];
            const state = NS.parseTagFilterRoute(S.route);
            const tagActive = Boolean(state.names.length || state.untagged);
            S.tagSelectIds = (S.assets || [])
              .filter((a) => !hidden.includes(String(a.status || 'active')))
              .filter((a) => {
                if (String(S.route.category || '') === 'kstar') return NS.isKstarAsset(a);
                if (S.route.category) return a.type === S.route.category;
                return true;
              })
              .filter((a) => (tagActive ? NS.matchesTagFilter(a, state.names, state.untagged, state.mode) : true))
              .map((a) => String(a.id));
            NS.notify();
            break;
          }
          case 'tag-select-clear': S.tagSelectIds = []; NS.notify(); break;
          case 'tag-batch-op': {
            const op = ['add', 'remove', 'replace'].includes(String(el.dataset.op || '')) ? String(el.dataset.op) : 'add';
            S.tagBatchOp = op;
            NS.notify();
            break;
          }
          case 'tag-batch-run': {
            const input = root.querySelector('[data-tag-batch-input]');
            const names = String(input ? input.value || '' : '')
              .split(/[、;；,，\n]/).map((value) => value.trim()).filter(Boolean);
            await A.batchTags(names);
            if (input && !(S.tagBatch && S.tagBatch.failed && S.tagBatch.failed.length)) input.value = '';
            break;
          }
          case 'tag-batch-dismiss': S.tagBatch = null; NS.notify(); break;
          case 'tag-rename': S.tagManageEdit = String(id || ''); S.tagManageMerge = null; NS.notify(); break;
          case 'tag-rename-save': await A.renameTag(id); break;
          case 'tag-rename-cancel': S.tagManageEdit = ''; NS.notify(); break;
          case 'tag-merge': S.tagManageMerge = { sourceId: String(id || ''), targetName: '' }; S.tagManageEdit = ''; NS.notify(); break;
          case 'tag-merge-target': {
            if (!S.tagManageMerge || String(S.tagManageMerge.sourceId) !== String(id)) break;
            S.tagManageMerge = { ...S.tagManageMerge, targetName: String(el.dataset.name || '') };
            NS.notify();
            break;
          }
          case 'tag-merge-confirm': {
            const state = S.tagManageMerge;
            if (!state || String(state.sourceId) !== String(id)) break;
            await A.mergeTag(state.sourceId, state.targetName);
            break;
          }
          case 'tag-merge-cancel': S.tagManageMerge = null; NS.notify(); break;
          case 'tag-delete': await A.deleteTag(id); break;
          case 'tag-suggestion-merge': {
            // 建议直达（只建议不合并）：预选好目标，进入该源的合并确认态。
            const source = ((S.tags && S.tags.items) || []).find((tag) => String(tag.name) === String(id) && tag.state === 'active');
            if (!source) break;
            S.tagManageMerge = { sourceId: String(source.id), targetName: String(el.dataset.target || '') };
            S.tagManageEdit = '';
            NS.notify();
            break;
          }
          case 'family-rename': await A.enterFamilyRename(id); break;
          case 'family-rename-save': await A.renameFamily(id); break;
          case 'family-rename-cancel': await A.exitFamilyRename(); break;
          case 'asset-edit-cancel': router.go({ name: 'overview', assetId: String(S.route.assetId || ''), assetEdit: '' }, { replace: true }); break;
          case 'edit-from-version': await A.editFromVersion(id, el.dataset.version || ''); break;
          case 'merge-asset-version': await A.mergeAssetVersion(id, el.dataset.version || ''); break;
          case 'open-asset-version': {
            // 点版本行就地展开/收起（模式同 open-kstar-episode）：再点同一行
            // 收起；展开态只存路由键，数据已在 store.assetVersions 里。
            const prev = String(S.route.assetVersionId || '');
            const next = String(el.dataset.version || '');
            const open = next && next !== prev ? next : '';
            router.go({ name: 'overview', assetId: String(S.route.assetId || ''), assetVersionId: open }, { replace: true });
            break;
          }
          case 'diff-asset-version': {
            // 展开块内「与在用版对比」：就地开/收（数据已在渲染层，前端自算）。
            // 必须带全 route 上下文（含 assetVersionId）——否则展开块被默认值清掉。
            const cur = String(S.route.assetVersionDiff || '');
            const next = String(el.dataset.version || '');
            router.go({ name: 'overview', assetId: String(S.route.assetId || ''), assetVersionId: String(S.route.assetVersionId || ''), assetVersionDiff: next && next !== cur ? next : '' }, { replace: true });
            break;
          }
          case 'toggle-asset-versions-noise': {
            router.go({ name: 'overview', assetId: String(S.route.assetId || ''), assetVersionId: String(S.route.assetVersionId || ''), assetVersionsExpanded: S.route.assetVersionsExpanded ? '' : '1' }, { replace: true });
            break;
          }
          case 'open-kstar-episode': {
            // 再点同一 chip 或点「收起」（id 空）即收起；展开时拉详情。
            // 就地展开不动宿主页（2026-09-17 修，子安实测抓出跳回"我的
            // 认知"）：保持当前 name 与全部详情上下文（候选/资产/采集/
            // 版本/经验键），只切 kstarEpisodeId——此前 name 硬编码 overview，
            // 在候选详情点复盘 chip 会整页跳走。
            const prev = String(S.route.kstarEpisodeId || '');
            const next = String(el.dataset.id || '');
            const open = next && next !== prev ? next : '';
            router.go({
              name: String(S.route.name || 'overview'),
              assetId: String(S.route.assetId || ''),
              candidateId: String(S.route.candidateId || ''),
              captureId: String(S.route.captureId || ''),
              assetVersionId: String(S.route.assetVersionId || ''),
              assetVersionDiff: String(S.route.assetVersionDiff || ''),
              experienceId: String(S.route.experienceId || ''),
              kstarEpisodeId: open,
            }, { replace: true });
            if (open) void NS.loadKstarEpisode(open);
            break;
          }
          case 'merge-asset': await A.mergeAssets(id, el.dataset.target || ''); break;
          /* ── 经验目录（specs/016 US-801/803）──────────────────────────── */
          case 'open-experience': router.go({ name: 'experiences', experienceId: id }); break;
          case 'experience-status-toggle': await A.experienceStatusToggle(id, el.dataset.action || 'pause'); break;
          case 'experience-set-type': await A.experienceSetType(id, el.dataset.type || ''); break;
          case 'experience-merge': await A.experienceMerge(id, el.dataset.target || ''); break;
          case 'experience-archive': await A.experienceArchive(id); break;
          case 'experience-migration-preview': await A.experienceMigrationPreview(); break;
          case 'experience-migration-run': {
            // run 必须显式带 assetIds（E7 契约，禁止隐式批量）：单条走
            // data-asset、批量走 data-assets（逗号分隔，来自可见的预览清单）。
            const ids = String(el.dataset.assets || el.dataset.asset || '')
              .split(',').map((value) => value.trim()).filter(Boolean);
            await A.experienceMigrationRun(ids);
            break;
          }
          case 'experience-migration-status': await A.experienceMigrationStatus(); break;
          case 'source-action': await A.sourceAction(el.dataset.kind || '', id, el.dataset.action); break;
          case 'capture-action': await A.captureAction(id, el.dataset.action); break;
          case 'organize-conv': await A.organizeConversation(id); break;
          case 'ranking-weights-reset': {
            // 恢复默认只回填输入框（DOM 就地），不落盘——落盘要点「保存」。
            const card = el.closest('[data-ranking-weights]');
            const defaults = (NS.rankingWeights && NS.rankingWeights.defaults) || {};
            if (card) {
              for (const input of Array.from(card.querySelectorAll('[data-w]'))) {
                const key = String(input.dataset.w || '');
                if (defaults[key] !== undefined) input.value = String(defaults[key]);
              }
              showWeightsError(card, '');
            }
            break;
          }
          case 'ranking-weights-save': {
            // 客户端先挡形状（0~10、不全零），再走唯一写通道；失败就地报错
            // 并保持输入值（不整卡重画），成功才 toast「下一轮生效」+ 重拉。
            const card = el.closest('[data-ranking-weights]');
            if (!card) break;
            const keys = ['relevance', 'adoption', 'scene', 'maturity'];
            const weights = {};
            let invalid = false;
            for (const key of keys) {
              const input = card.querySelector(`[data-w="${key}"]`);
              const value = Number(input ? input.value : Number.NaN);
              if (!Number.isFinite(value) || value < 0 || value > 10) invalid = true;
              weights[key] = value;
            }
            if (invalid || keys.every((key) => Number(weights[key]) === 0)) {
              showWeightsError(card, T('cognition.ranking_weights_invalid_value', '权重需要是 0~10 的数字，且不能全为 0'));
              break;
            }
            try {
              await NS.api.call('recall.catalog.weights.set', { weights });
              showWeightsError(card, '');
              NS.toast(T('cognition.ranking_weights_saved_toast', '已保存，下一轮对话生效'), 'success');
              await loadRankingWeights(true);
            } catch (error) {
              showWeightsError(card, String((error && error.message) || error));
            }
            break;
          }
          case 'capture-toggle': {
            const enabled = !(S.captureSettings && S.captureSettings.enabled !== false);
            if (!enabled) {
              // 关闭自动整理是破坏性操作（新候选不再被发现）：确认+后果说明。
              const ok = await NS.confirmUser(T('cognition.capture_disable_confirm', '关闭后新会话不再自动提炼候选，已有的资产与记录不受影响。确认关闭自动整理？'));
              if (!ok) break;
            }
            const previousSettings = S.captureSettings;
            S.captureSettings = Object.assign({}, previousSettings, { enabled });
            NS.notify();
            try {
              await A.updateCaptureSettings({ enabled });
            } catch (error) {
              S.captureSettings = previousSettings;
              NS.notify();
              throw error;
            }
            break;
          }
          case 'capture-review-toggle': {
            // 单选组按所点项设置；点已选中项不重复提交；同样乐观更新。
            const auto = String((S.captureSettings || {}).reviewPolicy || 'auto') === 'auto';
            const next = id === 'auto' ? 'auto' : 'manual';
            if ((next === 'auto') !== auto) {
              const previous = S.captureSettings;
              S.captureSettings = Object.assign({}, previous, { reviewPolicy: next });
              NS.notify();
              try {
                await A.updateCaptureSettings({ reviewPolicy: next });
              } catch (error) {
                S.captureSettings = previous;
                NS.notify();
                throw error;
              }
            }
            break;
          }
          case 'toggle-organize-list': {
            S.organizeListExpanded = !S.organizeListExpanded;
            NS.notify();
            break;
          }
          case 'proof-toggle':
            // 使用记录已并入资产详情（2026-09-15）：事件展开/收起保持在
            // 当前资产详情页内切换。
            router.go({
              name: 'overview',
              assetId: String(S.route.assetId || ''),
              // 带全上下文（2026-09-17 审查补）：使用记录与版本区同页，丢了
              // assetVersionId/kstarEpisodeId 会把就地展开的版本/复盘收起。
              assetVersionId: String(S.route.assetVersionId || ''),
              assetVersionDiff: String(S.route.assetVersionDiff || ''),
              kstarEpisodeId: String(S.route.kstarEpisodeId || ''),
              proofEventId: String(S.route.proofEventId) === id ? '' : id,
            });
            break;
          case 'proof-rate': {
            // 说明是可选的：先写再点评，说明随评价一起附上。
            const zone = el.closest('.ca-rating');
            const noteEl = zone ? zone.querySelector('textarea[data-f="note"]') : null;
            const note = noteEl ? String(noteEl.value || '').trim() : '';
            await A.rateProof(id, el.dataset.feedback, note ? { note } : undefined);
            break;
          }
          default: break;
        }
      } catch (error) {
        // 带错误码的走候选/晋升码表翻译；手动沉淀类错误走 capture 文案；
        // 都不是则透出原始消息（不吞失败）。
        const message = error && error.code && NS.recallErrorText
          ? NS.recallErrorText(error)
          : (NS.captureErrorText ? NS.captureErrorText(error) : String((error && error.message) || error));
        await NS.alertUser(message);
      } finally {
        // reload 重画后原元素已脱离文档，清理无害；未重画时恢复可点。
        if (isWrite) { el.classList.remove('is-pending'); el.removeAttribute('disabled'); }
      }
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && (S.route.assetId || S.route.experienceId)) router.back();
    });
    // 树光斑悬停提示（原型 #tip 行为）：.spot 自带 data-title/data-sub，
    // 鼠标进出示一条跟随光标的黑底提示——树上节点密度高，常显标签会糊。
    const treeTip = () => document.getElementById('ca-tree-tip');
    root.addEventListener('mouseover', (event) => {
      const spot = event.target.closest && event.target.closest('.spot[data-title]');
      const tip = treeTip();
      if (!tip) return;
      if (!spot) { tip.classList.remove('show'); return; }
      const sub = spot.dataset.sub || '';
      tip.textContent = spot.dataset.title + (sub ? ` — ${sub}` : '');
      tip.classList.add('show');
      /* 坐标相对树画布（.tip 是 absolute，且 .ca-scroll 有 contain:paint，
         fixed 的视口坐标在这里整体漂移——2026-09-21 真机抓出）。 */
      const stage = tip.closest('.tree-stage');
      if (!stage) return;
      const stageRect = stage.getBoundingClientRect();
      const rect = tip.getBoundingClientRect();
      tip.style.left = `${Math.min(event.clientX - stageRect.left + 14, stageRect.width - rect.width - 12)}px`;
      tip.style.top = `${Math.max(8, event.clientY - stageRect.top - 40)}px`;
    });
    root.addEventListener('mouseout', (event) => {
      const spot = event.target.closest && event.target.closest('.spot[data-title]');
      if (!spot) return;
      const tip = treeTip();
      if (tip) tip.classList.remove('show');
    });
    // div[role=button] 控件（行、chip 单选、tab、折叠头）不含原生 button 的
    // 键盘激活，Enter/Space 在委托层统一转成 click，保持键盘可达。
    root.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const el = event.target.closest && event.target.closest('[data-act][role="button"], [data-go-asset][role="button"]');
      if (!el || el.getAttribute('aria-disabled') === 'true') return;
      event.preventDefault();
      el.click();
    });
    // tab 行方向键漫游（2026-09-21 原型 v7 a11y 契约）：←/→ 移动焦点，
    // Home/End 跳首尾；tab 是 div[role=button]，无原生方向键语义。
    // 挂 root 委托——bindEvents 先于持久壳首次构建执行，挂 .ca-tabs 会落空。
    root.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      const tabsNav = event.target.closest && event.target.closest('.ca-tabs');
      if (!tabsNav || !(event.target.closest && event.target.closest('.ca-tab'))) return;
      const items = Array.from(tabsNav.querySelectorAll('.ca-tab'));
      const idx = items.indexOf(document.activeElement);
      if (idx < 0) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0
        : event.key === 'End' ? items.length - 1
          : (idx + (event.key === 'ArrowRight' ? 1 : -1) + items.length) % items.length;
      if (items[next] && typeof items[next].focus === 'function') items[next].focus();
    });
    // 标签输入的回车提交（specs/012 T010，Constitution IV 快捷键纪律）：
    // IME 组合中（isComposing / keyCode 229）不触发——中文输入法选字回车
    // 是「确认候选」不是「提交表单」。输入法兜底同款判断。
    root.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || event.isComposing || event.keyCode === 229) return;
      const input = event.target.closest && event.target.closest('[data-tag-input]');
      if (!input) return;
      event.preventDefault();
      const assetId = String(input.dataset.assetId || '');
      if (!assetId) return;
      void (async () => {
        try {
          await A.addAssetTag(assetId, String(input.value || ''));
          input.value = '';
        } catch (error) {
          const message = error && error.code && NS.recallErrorText
            ? NS.recallErrorText(error)
            : String((error && error.message) || error);
          await NS.alertUser(message);
        }
      })();
    });
    // 表单类控件的 change 委托（time input 等）：与 click 同一套 data-act 语义。
    root.addEventListener('change', async (event) => {
      const el = event.target.closest && event.target.closest('[data-act="nightly-time"]');
      if (!el) return;
      const value = String(el.value || '').trim();
      if (!/^\d{2}:\d{2}$/.test(value)) return;
      const previous = S.captureSettings;
      S.captureSettings = Object.assign({}, previous, { nightlyStart: value });
      NS.notify();
      try {
        await A.updateCaptureSettings({ nightlyStart: value });
      } catch (error) {
        S.captureSettings = previous;
        NS.notify();
        const message = error && error.code && NS.recallErrorText
          ? NS.recallErrorText(error)
          : String((error && error.message) || error);
        await NS.alertUser(message);
      }
    });
  }

  /* ────────────────────────── 生命周期 ────────────────────────── */

  let capturePollTimer = null;
  /** 整理进行中的轻量轮询（4s）：「从历史会话整理」与整理详情页需要看到
   *  extracting → 完成/失败的状态推进（页面无推送通道）。存在 active 任务
   *  且用户停在这两个页面时才拉快照；状态离开 active 自动停。 */
  async function capturePollTick() {
    capturePollTimer = null;
    if (!booted || !panelVisible()) return;
    const onLivePage = S.route.name === 'organize';
    const hasActive = (S.captures || []).some((capture) => capture && capture.bucket === 'active');
    if (!onLivePage || !hasActive) return;
    await NS.reload();
    // reload 被 loading 守卫吞掉时不会触发 notify，这里兜底续上（有守卫不会重复）。
    scheduleCapturePoll();
  }
  function scheduleCapturePoll() {
    if (capturePollTimer) return;
    capturePollTimer = setTimeout(capturePollTick, 4000);
  }

  function panelVisible() {
    const panel = document.getElementById('panel-recall');
    if (!panel) return false;
    return panel.classList.contains('active') || !panel.hidden;
  }

  async function boot() {
    if (booted) return;
    const root = document.getElementById('ca-root');
    if (!root) return;
    booted = true;
    bindEvents(root);
    // 焦点保持（2026-09-21 原型 v7 a11y 契约）：内容区整体重绘后键盘焦点会
    // 静默落到 body，键盘用户得重新 Tab 整页。渲染前记录焦点控件的定位特征
    // （data-act/data-id/data-go-asset），渲染后按特征找回同一控件；找不到时
    // 回落到当前页第一个可聚焦控件——焦点永不落 body。
    NS.onChange(() => {
      const active = document.activeElement;
      const inScroll = active && active.closest && active.closest('#ca-scroll');
      const signature = inScroll ? {
        act: active.dataset ? active.dataset.act || '' : '',
        id: active.dataset ? active.dataset.id || '' : '',
        goAsset: active.dataset ? active.dataset.goAsset || '' : '',
      } : null;
      NS.render();
      const scroll = document.getElementById('ca-scroll');
      if (!scroll || !signature) return;
      let next = null;
      if (signature.goAsset) next = scroll.querySelector(`[data-go-asset="${CSS.escape(signature.goAsset)}"]`);
      else if (signature.act) {
        const candidates = Array.from(scroll.querySelectorAll(`[data-act="${CSS.escape(signature.act)}"]`));
        next = candidates.find((el) => !signature.id || (el.dataset && el.dataset.id === signature.id)) || candidates[0];
      }
      if (!next) next = scroll.querySelector('button, [role="button"]');
      if (next && typeof next.focus === 'function') next.focus({ preventScroll: true });
    });
    // tab 自适应：3 个中文 tab 在窄窗口仍可能折行。检测用 Range 取
    // 主标题的**文本行**数（flex 子元素被 blockify，元素级 getClientRects
    // 恒为 1，测不出折行；Range 量的是文本自身），>1 即切紧凑模式
    // （CSS 隐藏副标题腾出宽度）。
    const fitTabs = () => {
      const tabs = document.querySelector('#ca-root .ca-tabs');
      if (!tabs) return;
      const lineCount = (el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        return range.getClientRects().length;
      };
      const folded = Array.from(tabs.querySelectorAll('.ca-tab strong')).some((el) => lineCount(el) > 1);
      tabs.classList.toggle('is-compact', folded);
    };
    NS.onChange(() => requestAnimationFrame(fitTabs));
    // 认知树按容器实测像素作画（原型 drawTree 同款）：宽度变了必须重画，
    // 否则 viewBox 与容器对不上，树会被拉伸。rAF 合帧 + 抖动守卫避免拖拽
    // 窗口时每像素一次全量重绘。
    let treeResizeFrame = 0;
    let lastTreeWidth = 0;
    window.addEventListener('resize', () => {
      if (S.route.name !== 'tree') return;
      const svg = document.getElementById('ca-tree-svg');
      const width = svg ? svg.clientWidth : 0;
      if (!width || width === lastTreeWidth) return;
      lastTreeWidth = width;
      if (treeResizeFrame) cancelAnimationFrame(treeResizeFrame);
      treeResizeFrame = requestAnimationFrame(() => { treeResizeFrame = 0; NS.render(); });
    });
    window.addEventListener('resize', () => requestAnimationFrame(fitTabs));
    NS.render();
    await NS.reload();
    // 认知树是默认落地页:快照落地后按需补一次树(overview 页也保留补树)。
    if (!treeRequested && (S.route.name === 'tree' || S.route.name === 'overview')) { treeRequested = true; await NS.reload({ tree: true }); }
    NS.notify();
  }

  function scheduleBoot() {
    const panel = document.getElementById('panel-recall');
    if (!panel) return;
    const observer = new MutationObserver(() => {
      if (panelVisible()) { boot(); }
    });
    observer.observe(panel, { attributes: true, attributeFilter: ['class', 'hidden'], childList: true, subtree: false });
    // 面板可能已经处于激活态（深链进来）。
    if (panelVisible()) boot();
  }

  // 数据变化时：树页/概览页没树就补树。
  NS.onChange(() => {
    if ((S.route.name === 'tree' || S.route.name === 'overview') && !treeRequested && S.loaded) {
      treeRequested = true;
      void NS.reload({ tree: true });
    }
  });

  // 每次重画后排一次轮询检查（条件不满足时 tick 自行退出）。
  NS.onChange(() => { scheduleCapturePoll(); });

  // 标签系统（specs/012）：列表页按需拉标签库；管理弹层再带 retired + 同义
  // 建议。弹层接线（uiModalController）在 views.render 尾部调用
  // core.wireTagOverlay——onChange 监听器先于 boot 的渲染监听器注册，放这里
  // 会接到上一帧的 DOM。
  NS.onChange(() => {
    if (String(S.route.name || '') !== 'overview') return;
    void NS.loadTags();
    if (String(S.route.tagOverlay || '') === 'manage') {
      void NS.loadTags({ includeRetired: true });
      void NS.loadTagSuggestions();
    }
  });

  // 详情页兜底加载上下文：返回栈回退/深链进入时没有经过 open-capture-detail
  // 分流，这里按当前路由补拉（loadCaptureContext 内部有缓存判重）。
  NS.onChange(() => {
    const captureId = String(S.route.captureId || '');
    const experienceRouteId = String(S.route.experienceId || '');
    if (captureId && (!S.captureContext || S.captureContext.captureId !== captureId)) {
      void NS.loadCaptureContext(captureId);
    }
    // 资产详情版本链同理按需补拉（版本组 2026-09-16）；KSTAR 摘要随详情
    // 一起（2026-09-17 资产侧溯源）。
    const assetId = String(S.route.assetId || '');
    if (assetId && (!S.assetVersions || S.assetVersions.assetId !== assetId)) {
      void NS.loadAssetVersions(assetId);
    }
    if (assetId) void NS.loadKstarEpisodeSummaries(assetId);
    // 整理报告：进整理相关页签就补拉一次（内部有缓存判重）。
    // 「已删除」页签：保留期剩余天数由服务端现算，进这个页签时补拉一次。
    if (String(S.route.category || '') === 'deleted') void NS.loadDeletedAssets();
    if (String(S.route.name || '') === 'cleanup') {
      void NS.loadCleanupReports();
      void NS.loadInspection();
    }
    // 采用回执（2026-09-25 US-602）：详情「实际采用记录」区的唯一数据源。
    if (assetId) void NS.loadAdoptionReceipts(assetId);
    // 排序依据（specs/012 T020 / US-202 AC4）：详情「为什么这一轮排在前面」
    // 小节的数据源（recall.catalog.ranking 只读；app 层装载，见文件底部的
    // 排序依据/权重装载器——core 不动）。
    if (assetId) void loadRankingWhy(assetId);
    // 权重配置（US-202 AC6）：进沉淀设置页才拉一次（契约：既有设置位）。
    if (String(S.route.name || '') === 'organize-settings') void loadRankingWeights();
    // 会话标题同理（2026-09-25 US-603）：证据来源与使用记录里的 cid 要翻成
    // 会话名，五处展示同名；来源目录 100 条窗口外的会话靠这个批量口补齐。
    if (assetId) void NS.loadConversationTitles(assetId);
    // 候选详情的 kse 证据 chip 也要真实目标摘要（此前只覆盖资产详情，
    // 候选页 chip 一直显示兜底"一次任务"，2026-09-17 子安实测抓出）。
    const candidateId = String(S.route.candidateId || '');
    if (candidateId) {
      const cand = S.candidates.find((c) => String(c.id) === candidateId);
      if (cand) {
        const candRefs = [...(cand.sourceRefs || []), ...(cand.evidenceRefs || [])];
        const ids = candRefs.map((r) => String(r.id || ''));
        void NS.loadKstarEpisodeSummariesByIds(ids);
        void NS.loadConversationTitlesByIds(candRefs);
      }
    }
    // KSTAR 复盘折叠区（2026-09-17 二次定调）：复盘历史随「我的认知」页
    // 懒加载一次（折叠区默认收起，数据先备好，展开即渲染）。
    if (String(S.route.name || '') === 'overview') void NS.loadKstarEpisodes();
    // 模型自选标记随「我的认知」一起刷新（2026-09-18）：目录视图据此标"模型挂着"。
    if (String(S.route.name || '') === 'overview') void NS.loadModelSelectedAssets();
    // 经验目录（specs/016）：进「经验」页签才拉（与资产快照隔离）；详情深链
    // 补拉 E2；详情证据里的 kse 摘要与会话标题同时候补——chip 要显示任务目标
    // 与会话名，与资产详情同一套批量口（loaders 自带缓存/在途守卫）。
    if (String(S.route.name || '') === 'experiences') {
      void NS.loadExperiences();
      if (experienceRouteId) {
        void NS.loadExperienceDetail(experienceRouteId);
        const loaded = S.experienceDetail;
        if (loaded && !loaded.loading && loaded.experience) {
          const refs = loaded.experience.evidenceRefs || [];
          void NS.loadKstarEpisodeSummariesByIds(refs.map((ref) => String((ref && ref.id) || '')));
          void NS.loadConversationTitlesByIds(refs);
        }
      }
    }
  });

  /** 静默刷新指示：同页 reload（操作后/轮询）期间顶部走一条细进度条。
   *  首载不走这里（那时是骨架）；放在 render 之后执行，避免给旧 DOM 挂类。 */
  function syncRefreshIndicator() {
    const app = document.querySelector('#ca-root .ca-app');
    if (!app) return;
    app.classList.toggle('is-refreshing', Boolean(S.loading && S.loaded));
  }
  NS.onChange(() => { requestAnimationFrame(syncRefreshIndicator); });

  /* ────────────────── 排序依据 / 权重装载器（specs/012 T020） ──────────────────
   * 状态挂在模块闭包 + NS 命名空间（NS.rankingWhy / NS.rankingWeights）：
   * core.js 的 store 不动（本轮白名单只开 views/app），视图按 NS 读——与
   * NS.api / NS.reportBlocked 的既有跨层发布同一模式。 */

  /** 该资产最近一次真实使用的回合 id：使用记录时间线（refs.taskRunId）优先，
   *  采用回执兜底；都没有 = ''（视图按「这一轮没有进入目录」如实呈现）。 */
  function latestTurnForAsset(assetId) {
    const id = String(assetId || '');
    const fromProofs = (Array.isArray(S.proofs) ? S.proofs : [])
      .filter((p) => String(((p && p.refs) || {}).assetId || '') === id && String(((p && p.refs) || {}).taskRunId || ''))
      .sort((a, b) => String(b.occurredAt || '').localeCompare(String(a.occurredAt || '')));
    if (fromProofs.length) return String(fromProofs[0].refs.taskRunId || '');
    const adoptions = (S.adoptionReceipts && String(S.adoptionReceipts.assetId || '') === id
      && Array.isArray(S.adoptionReceipts.items)) ? S.adoptionReceipts.items : [];
    const newest = [...adoptions].sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))[0];
    return newest ? String(newest.taskRunId || '') : '';
  }

  let rankingWhyLast = { assetId: '', turnId: null };
  /** 详情「为什么这一轮排在前面」：先定位回合，再查该回合该资产的回执拆解。
   *  同资产同回合只拉一次；换回合（新一轮使用记录落进时间线）会自动重拉。 */
  async function loadRankingWhy(assetId) {
    const id = String(assetId || '');
    if (!id) return;
    const turnId = latestTurnForAsset(id);
    if (rankingWhyLast.assetId === id && rankingWhyLast.turnId === turnId) return;
    rankingWhyLast = { assetId: id, turnId };
    NS.rankingWhy = { assetId: id, loading: true };
    NS.render();
    let next;
    try {
      let item = null;
      if (turnId) {
        const result = await NS.api.call('recall.catalog.ranking', { taskRunId: turnId, assetId: id, limit: 1 });
        item = (Array.isArray(result.items) ? result.items : [])[0] || null;
      }
      next = { assetId: id, ...(turnId ? { turnId } : {}), ...(item ? { item } : {}) };
    } catch (error) {
      next = { assetId: id, ...(turnId ? { turnId } : {}), failed: true, error: String((error && error.message) || error) };
    }
    // 回执到达前用户已切走/换资产：这帧作废（不把 A 资产的拆解画给 B 资产）。
    if (rankingWhyLast.assetId !== id) return;
    NS.rankingWhy = next;
    NS.render();
  }

  let rankingWeightsLoaded = false;
  /** 沉淀设置页的权重卡数据（recall.catalog.weights.get，只读）。失败如实
   *  呈现（卡片禁编辑），不摆假数字。 */
  async function loadRankingWeights(force) {
    if (!force && rankingWeightsLoaded) return;
    rankingWeightsLoaded = true;
    NS.rankingWeights = { loading: true };
    NS.render();
    let next;
    try {
      const result = await NS.api.call('recall.catalog.weights.get');
      next = {
        weights: (result && result.weights) || {},
        defaults: (result && result.defaults) || {},
        source: String((result && result.source) || 'default'),
      };
    } catch (error) {
      rankingWeightsLoaded = false; // 读失败允许下次进页重试。
      next = { failed: true, error: String((error && error.message) || error) };
    }
    NS.rankingWeights = next;
    NS.render();
  }

  /** 权重卡的就地报错：只写错误行，不整卡重画（重画会吃掉刚输入的数值）。 */
  function showWeightsError(card, message) {
    const errEl = card && card.querySelector('[data-ranking-weights-error]');
    if (!errEl) return;
    errEl.textContent = message || '';
    if (message) errEl.removeAttribute('hidden');
    else errEl.setAttribute('hidden', 'hidden');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scheduleBoot, { once: true });
  } else {
    scheduleBoot();
  }

  // 语言切换：视图全部在渲染时取文案。持久壳的页签标题也是渲染产物，
  // 传 rebuild 让壳整体重建跟上新语言（旧实现曾在 skills-bindings.js 里
  // 重画，随瘦身丢失）。
  window.addEventListener('i18n-change', () => { if (booted) NS.render({ rebuild: true }); });
})();
