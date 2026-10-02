// 认知沉淀（capture）弹窗控制器。
// P-r3-9（2026-10-01 拍板「死页族删链保留 capture」）：此前的「认知成长页」
// （cognition-page DOM 宿主 + /api/cognition REST 读面 + 分页/详情/动作链）
// 是零宿主死页族——锚点 DOM 已不存在、REST 路由明文禁恢复、每次气泡保存
// 还要白跑两条 404（P-r1-49）。死链已随本拍板整族删除，本文件只剩仍在
// 服务的 capture 弹窗：window.openCognitionCapture（conversation.js 气泡
// 入口消费）。
(function () {
  function translate(key, fallback, vars) {
    if (typeof t === 'function') {
      const translated = t(key, vars);
      if (translated && translated !== key) return translated;
    }
    return fallback;
  }
  function apiError(error) {
    return error && error.message ? error.message : String(error || translate('cognition.error.generic', '操作失败'));
  }
  // capture.draft 失败时主进程回执带 code（capture-draft.ts::CognitionCaptureErrorCode
  // 共 7 类），error 是内部英文契约语言，不能直出给四语用户——按 code 翻译；
  // 未知码退回原始 error，不吞失败。同构先例：cognition-assets/core.js
  // RECALL_CANDIDATE_ERROR_TEXTS。拍板：待议 P-r1-6/P-r3-26（预审决策卡组 9）。
  const CAPTURE_DRAFT_ERROR_TEXTS = {
    invalid_request: ['cognition.capture.error_invalid_request', '这次请求无效，请重新打开沉淀入口再试。'],
    conversation_not_found: ['cognition.capture.error_conversation_not_found', '找不到这条对话，可能已被清理或删除。'],
    anchor_not_found: ['cognition.capture.error_anchor_not_found', '选中的回复不可用：可能已被删除，或超出了可沉淀的上下文范围。'],
    model_failed: ['cognition.capture.error_model_failed', '模型暂时没能生成草稿，请稍后重试。'],
    invalid_model_output: ['cognition.capture.error_invalid_model_output', '模型返回的内容不符合格式要求，请重试一次。'],
    unsafe_model_output: ['cognition.capture.error_unsafe_model_output', '生成的内容没有通过安全检查，已拦截，请重试。'],
    copied_model_output: ['cognition.capture.error_copied_model_output', '生成的草稿只是复读了这条回复本身，没有可沉淀的新内容。'],
  };
  function captureDraftErrorText(result) {
    const entry = result && result.code ? CAPTURE_DRAFT_ERROR_TEXTS[result.code] : null;
    if (entry) return translate(entry[0], entry[1]);
    return String((result && result.error) || '') || translate('cognition.capture.generation_failed', '认知草稿生成失败，请稍后重试。');
  }

  function openCognitionCapture(input = {}) {
    if (!window.CognitionPages || typeof window.CognitionPages.renderCognitionCapture !== 'function') return false;
    if (typeof window.uiModalController !== 'function') return false;
    if (document.querySelector('[data-cognition-capture-overlay]')) return false;
    const payload = input && typeof input === 'object' ? input : {};
    const conversationId = String(payload.conversationId || '').trim();
    const messageId = String(payload.messageId || '').trim();
    if (!conversationId || !messageId) return false;
    const trigger = document.activeElement;
    const rendered = document.createElement('div');
    rendered.className = 'ui-modal-overlay cognition-capture-overlay';
    rendered.dataset.cognitionCaptureOverlay = 'true';
    let modalController = null;
    let closed = false;
    let activeDraft = null;
    const removeOverlay = () => {
      rendered.remove();
    };
    const closeOverlay = (reason = 'close') => {
      if (closed) return;
      closed = true;
      if (modalController?.isOpen()) modalController.close(reason);
      else {
        removeOverlay();
        if (trigger?.isConnected && typeof trigger.focus === 'function') trigger.focus();
      }
    };
    const renderMarkup = (state, values = {}) => {
      if (modalController?.isOpen()) modalController.close('rerender', { restoreFocus: false });
      rendered.innerHTML = window.CognitionPages.renderCognitionCapture({
        state,
        title: values.summary || '',
        summary: values.judgment || '',
        value: values.value || '',
        sourceLabel: values.sourceLabel || '',
        suggestedType: values.suggestedType || '',
        suggestedScope: values.suggestedScope || '',
        applicableWhen: values.applicableWhen || [],
        forbiddenWhen: values.forbiddenWhen || [],
        risk: values.risk || 'low',
        uncertainty: values.uncertainty || '',
        error: values.error || '',
      });
      const dialog = rendered.querySelector('[data-cognition-capture-form]');
      if (!dialog) throw new Error('cognition capture dialog is unavailable');
      if (typeof window.hydrateUiFormSelects === 'function') window.hydrateUiFormSelects(dialog);
      modalController = window.uiModalController({
        overlay: rendered,
        dialog,
        initialFocus: state === 'ready' ? '[data-cognition-capture-title]' : '[data-cognition-capture-cancel]',
        fallbackFocus: trigger,
        onClose: (reason) => {
          if (reason === 'rerender') return;
          closed = true;
          removeOverlay();
        },
      });
      modalController.open(trigger);
    };
    document.body.appendChild(rendered);
    renderMarkup('loading');
    const onBackdropClick = (event) => {
      if (event.target === rendered) {
        closeOverlay('backdrop');
      }
    };
    const bindControls = () => {
      rendered.querySelectorAll('[data-cognition-capture-cancel]').forEach((button) => {
        button.addEventListener('click', () => closeOverlay('action'));
      });
      const form = rendered.querySelector('[data-cognition-capture-form]');
      const submitControl = form?.querySelector('[data-cognition-capture-submit]');
      if (!form || !submitControl) return;
      submitControl.addEventListener('click', () => form.requestSubmit());
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const title = String(form.querySelector('[data-cognition-capture-title]')?.value || '').trim();
        const captureSummary = String(form.querySelector('[data-cognition-capture-summary]')?.value || '').trim();
        const value = String(form.querySelector('[data-cognition-capture-value]')?.value || '').trim();
        const sourceLabel = String(form.querySelector('[data-cognition-capture-source]')?.value || '').trim();
        const suggestedType = String(form.querySelector('[data-cognition-capture-type]')?.value || '').trim();
        const scopeHost = form.querySelector('#cognition-capture-scope');
        const suggestedScope = String(scopeHost?._uiSelectApi?.getValue?.() || '').trim();
        const applicableWhen = String(form.querySelector('[data-cognition-capture-applicable]')?.value || '')
          .split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
        const forbiddenWhen = String(form.querySelector('[data-cognition-capture-forbidden]')?.value || '')
          .split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
        const uncertainty = String(form.querySelector('[data-cognition-capture-uncertainty]')?.value || '').trim();
        const risk = String(activeDraft?.risk || '').trim();
        if (!title || !captureSummary || !value || !sourceLabel || !suggestedType || !activeDraft) return;
        const submit = form.querySelector('[data-cognition-capture-submit]');
        if (submit?.disabled) return;
        if (submit) submit.disabled = true;
        try {
          if (!suggestedScope) {
            throw new Error(translate('cognition.candidate_scope_required', '先填写作用范围：没有范围的资产不会被带入任何任务。'));
          }
          if (suggestedType === 'rule' && (!applicableWhen.length || !forbiddenWhen.length)) {
            throw new Error(translate('cognition.candidate_block_rule_boundary_required', '规则要先确认适用与禁止范围。'));
          }
          // 气泡沉淀走**主链**：产出一条 recall 候选，与其它五个候选生产者
          // （capture-service / kstar / session_import / teaching / IPC 直入）
          // 同一个入口、同一套晋升闸门。
          //
          // 此前这里 POST 到 `/api/cognition/assets/capture`，落点是
          // `cloud/cognition/assets.json` —— 一个没有任何下游消费者的遗留
          // store：不进候选池、不晋升、认知树看不到、runtime 不注入、无回执，
          // 而且它唯一的确认界面在当前包里没有宿主 DOM。用户看到「已保存」，
          // 数据确实落了盘，但永远不会再出现。那条路由已一并删除。
          //
          // evidenceRefs 是**主进程按模型引用的 mN 标签解析出的真实来源 ID**：
          // 来源会话 + 上下文消息。sourceLabel 仅用于显示，不冒充来源引用——
          // 无效引用正是晋升时
          // `unavailableCandidateSources` 要挡下来的形态。
          const sourceRefs = Array.isArray(activeDraft.sourceRefs) ? activeDraft.sourceRefs : [];
          const evidenceRefs = Array.isArray(activeDraft.evidenceRefs) ? activeDraft.evidenceRefs : [];
          if (!sourceRefs.length || !evidenceRefs.length) {
            throw new Error(translate('cognition.capture.no_evidence', '这条沉淀缺少可追溯的来源，无法保存。'));
          }
          const result = await window.cogseed.invoke('recall.candidates.save', {
            judgment: captureSummary,
            value,
            summary: title,
            suggestedType,
            suggestedScope,
            suggestedAction: 'create',
            risk,
            uncertainty,
            applicableWhen,
            forbiddenWhen,
            sourceRefs,
            evidenceRefs,
          });
          if (!result?.ok) {
            // 保存失败同样按 code 翻译（recallErrorText 已有码表，但它在
            // cognition-assets 懒加载包里，本模块（cognition 包）单独加载时
            // 不在场——可选消费，不在场就维持原样透出，不引入跨包硬依赖。
            const mapped = window.CogAssets && typeof window.CogAssets.recallErrorText === 'function'
              ? window.CogAssets.recallErrorText(result)
              : '';
            throw new Error(mapped || result?.error || translate('cognition.error.action_failed', '认知操作失败'));
          }
          // P-r1-49：保存成功后不再触发旧认知成长页的死刷新链（原先 reload
          // 打到 /api/cognition/assets/page 必 404 白跑两条）。候选落进
          // 「待我处理」由 cognition-assets 面板的 cognition:changed 中枢刷新。
          closeOverlay('action');
          if (typeof uiToast === 'function') uiToast(translate('cognition.capture.saved', '已存为待确认候选，可在「待我处理」里确认'), { variant: 'success' });
        } catch (error) {
          if (submit) submit.disabled = false;
          let errorNode = form.querySelector('[data-cognition-capture-error]');
          if (!errorNode) {
            errorNode = document.createElement('p');
            errorNode.dataset.cognitionCaptureError = '1';
            errorNode.className = 'cognition-capture-error';
            form.querySelector('.cognition-capture-body')?.appendChild(errorNode);
          }
          errorNode.textContent = apiError(error);
        }
      });
    };
    rendered.addEventListener('click', onBackdropClick);
    bindControls();
    const generate = async () => {
      try {
        if (!window.cogseed || typeof window.cogseed.invoke !== 'function') throw new Error(translate('cognition.capture.generation_failed', '认知草稿生成失败，请稍后重试。'));
        const result = await window.cogseed.invoke('cognition.capture.draft', { conversationId, messageId });
        if (closed || !rendered.isConnected) return;
        if (!result || result.ok === false) throw new Error(captureDraftErrorText(result));
        if (result.status === 'not_reusable') {
          renderMarkup('error', { error: result.reason || translate('cognition.capture.no_candidate', '这条回复没有足够的可复用工作方式。') });
          bindControls();
          return;
        }
        const draft = result.draft;
        if (result.status !== 'ready' || !draft || typeof draft.summary !== 'string'
            || typeof draft.judgment !== 'string' || typeof draft.value !== 'string'
            || typeof draft.suggestedScope !== 'string' || typeof draft.sourceLabel !== 'string'
            || !Array.isArray(draft.sourceRefs) || !Array.isArray(draft.evidenceRefs)) {
          throw new Error(translate('cognition.capture.generation_failed', '认知草稿生成失败，请稍后重试。'));
        }
        activeDraft = draft;
        renderMarkup('ready', {
          summary: draft.summary,
          judgment: draft.judgment,
          value: draft.value,
          sourceLabel: draft.sourceLabel,
          suggestedType: draft.suggestedType,
          suggestedScope: draft.suggestedScope,
          applicableWhen: draft.applicableWhen,
          forbiddenWhen: draft.forbiddenWhen,
          risk: draft.risk,
          uncertainty: draft.uncertainty,
        });
        bindControls();
        rendered.querySelector('[data-cognition-capture-title]')?.focus();
      } catch (error) {
        if (closed || !rendered.isConnected) return;
        renderMarkup('error', { error: apiError(error) || translate('cognition.capture.generation_failed', '认知草稿生成失败，请稍后重试。') });
        bindControls();
      }
    };
    void generate();
    return true;
  }

  window.openCognitionCapture = openCognitionCapture;
})();
