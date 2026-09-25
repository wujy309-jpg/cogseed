/**
 * Meeting references panel — 会议引用面板（specs/013 会议引用层 · T014 骨架）
 *
 * 是什么：一场会议「引用了哪些资产 / 纪要条目 / 待办草稿 / 跨会议关联 / 回执」
 * 的汇总面板。本文件先落**骨架**：mount/destroy + 各分区空态；数据接线
 * （双引用展开与冻结版对比 T038、草稿待办视图 T043、关联建议 T051）在后续
 * 任务挂进来，本骨架不提前造数据。
 *
 * 设计边界（与 specs/013 契约对齐）：
 *   - 引用链只有 id/版本/标题/摘要/锚点——**不读资产正文、不读转写正文**
 *     （隐私边界 D20；渲染层也不做任何"什么算需要确认"的判据重算）。
 *   - `meeting.*` 通道不可用 / `ok:false` 时分区不渲染 + 一条带原因的空态，
 *     不静默空白、不弹错误框（renderer-seams §5 降级路径）。
 *   - 控件全走共享原语（uiEmptyState 等）；本模块不出现裸控件
 *     （shared-ui-adoption-guard：不在基线表内 = 允许 0）。
 *
 * Renderer 约束：classic script（IIFE + window.*，无 JSX/bundler）、文案走
 * i18n 且**内联键名**（kb.meetingRef.*，四语齐全由 kb-i18n-keys 门禁看守）、
 * 订阅 i18n-change（切语言重渲染）。
 */

(function initKbMeetingRefs(root) {
  'use strict';

  const log = typeof createLogger === 'function' ? createLogger('kb-meeting-refs') : null;

  // ── i18n（缺键回退到中文默认文案，与 kb-transcript-correct 同款）────────
  function formatFallback(text, vars) {
    return String(text || '').replace(/\{([a-zA-Z0-9_]+)\}/g, (_m, key) => String(vars?.[key] ?? ''));
  }

  function t(key, fallback, vars) {
    try {
      const value = typeof root.t === 'function' ? root.t(key, vars || {}) : '';
      return value && value !== key ? value : formatFallback(fallback, vars);
    } catch (_) {
      return formatFallback(fallback, vars);
    }
  }

  // 骨架分区（顺序即面板呈现顺序；标题/空态文案全部内联键名，走 kb.meetingRef.*）
  const SECTION_KEYS = ['refs', 'conclusions', 'actions', 'related', 'receipts'];

  /** 分区文案（键名内联：kb-i18n-keys 门禁按 t('…') 字面扫描）。 */
  function sectionText(key) {
    if (key === 'refs') {
      return {
        title: t('kb.meetingRef.ref_section', '资产引用'),
        empty: t('kb.meetingRef.ref_empty', '暂无资产引用'),
      };
    }
    if (key === 'conclusions') {
      return {
        title: t('kb.meetingRef.conclusion_section', '纪要条目'),
        empty: t('kb.meetingRef.conclusion_empty', '暂无纪要条目'),
      };
    }
    if (key === 'actions') {
      return {
        title: t('kb.meetingRef.action_section', '待办草稿'),
        empty: t('kb.meetingRef.action_empty', '暂无待办草稿'),
      };
    }
    if (key === 'related') {
      return {
        title: t('kb.meetingRef.related_section', '关联建议'),
        empty: t('kb.meetingRef.related_empty', '暂无关联建议'),
      };
    }
    return {
      title: t('kb.meetingRef.receipt_section', '回执'),
      empty: t('kb.meetingRef.receipt_empty', '暂无回执（拒绝词条或应用清理后在这里留痕）'),
    };
  }

  function panelHtml() {
    return [
      '<div class="kb-mrf">',
      '  <div class="kb-mrf__head">',
      '    <div class="kb-mrf__title" data-mrf-title></div>',
      '    <div class="kb-mrf__meta" data-mrf-meta title=""></div>',
      '    <div class="kb-mrf__hint" data-mrf-hint></div>',
      '  </div>',
      '  <div class="kb-mrf__sections" data-mrf-sections></div>',
      '</div>',
    ].join('');
  }

  // ── 面板 ─────────────────────────────────────────────────────────────
  function createPanel(container, ctx) {
    container.classList.add('kb-mrf-host');
    container.innerHTML = panelHtml();
    const q = (selector) => container.querySelector(selector);

    function renderHead() {
      const title = q('[data-mrf-title]');
      if (title) title.textContent = t('kb.meetingRef.panel_title', '会议引用');
      const meta = q('[data-mrf-meta]');
      if (meta) {
        // 规范 §四-3：文件名过长只显示尾段，hover 给完整路径（title 属性）。
        const full = ctx.displayPath || ctx.docId || '';
        const shortName = full.split(/[\\/]/).filter(Boolean).pop() || full;
        meta.textContent = shortName;
        meta.setAttribute('title', full);
      }
      const hint = q('[data-mrf-hint]');
      if (hint) {
        hint.textContent = t(
          'kb.meetingRef.panel_hint',
          '这里汇总这场会议的资产引用、纪要条目、待办草稿与回执；引用版本以挂载时的冻结版为准。',
        );
      }
    }

    /** 骨架期：每个分区一条空态（共享 uiEmptyState），不静默空白。 */
    function renderSections() {
      const host = q('[data-mrf-sections]');
      if (!host) return;
      host.textContent = '';
      for (const key of SECTION_KEYS) {
        const text = sectionText(key);
        const section = document.createElement('section');
        section.className = 'kb-mrf__section';
        section.dataset.mrfSection = key;
        const head = document.createElement('div');
        head.className = 'kb-mrf__section-title';
        head.textContent = text.title;
        const body = document.createElement('div');
        body.className = 'kb-mrf__section-body';
        body.dataset.mrfEmpty = key;
        body.innerHTML = typeof root.uiEmptyState === 'function'
          ? root.uiEmptyState({ kind: 'quiet', title: text.empty })
          : '';
        if (!body.innerHTML) body.textContent = text.empty;
        section.append(head, body);
        host.appendChild(section);
      }
    }

    function render() {
      // 逐段渲染：单个共享原语抛错不得拖垮整块面板（与 kb-transcript-correct 同款纪律）。
      for (const step of [renderHead, renderSections]) {
        try {
          step();
        } catch (error) {
          log?.warn('meeting refs render step failed', { step: step.name, error: error?.message || String(error) });
        }
      }
    }

    // 语言切换：面板自己持有 DOM，必须自响应 i18n-change（kb-i18n-keys 门禁要求）。
    const onI18nChange = () => { render(); };
    root.addEventListener('i18n-change', onI18nChange);

    render();

    return {
      destroy() {
        root.removeEventListener('i18n-change', onI18nChange);
        container.textContent = '';
      },
    };
  }

  const api = {
    mount(container, ctx) {
      if (!container) throw new Error('kb meeting refs: container required');
      if (!root.cogseed || typeof root.cogseed.invoke !== 'function') {
        throw new Error('kb meeting refs: ipc unavailable');
      }
      if (typeof root.uiEmptyState !== 'function') {
        throw new Error('kb meeting refs: shared ui primitives unavailable');
      }
      const docId = String(ctx?.docId || '').trim();
      if (!docId) throw new Error('kb meeting refs: docId required');
      return createPanel(container, {
        docId,
        displayPath: String(ctx?.displayPath || ''),
      });
    },
  };

  root.KbMeetingRefs = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { SECTION_KEYS };
  }
})(typeof window !== 'undefined' ? window : globalThis);
