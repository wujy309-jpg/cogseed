
# src/renderer/modules/kb-workbench.js

冲突块 103 个   我方 720 行 / 上游 2530 行

## 冲突 1  (第 64 行起)
   我方 53 行 [UI] {UI:共享 UI, UI:类选择器, UI:内联样式}
   上游 35 行 [UI] {UI:共享 UI, UI:类选择器}

**我方（企业侧）**
```js
  function _attrsHtml(attrs) {
    return Object.entries(attrs || {}).map(([key, value]) => {
      if (!/^(id|role|title|aria-[a-z-]+|data-[a-z0-9-]+)$/.test(key) || value == null || value === false) return '';
      return ` ${key}="${_esc(value === true ? '' : value)}"`;
    }).join('');
  }
// … 省略 47 行
```

**上游（开源侧）**
```js
  /**
   * 定点重标签：把 `data-wb-*` 钩子上的文案按当前语言重刷一遍。
   *
   * 为什么必须"定点"而不是重渲染：`renderKbWorkbench()` 有 `_state.rendered` 守卫
   * ——外壳只注入一次；而且右列里住着问答输入框（用户可能已经打了一半问题）。
   * 重建 = 丢掉这些即时状态。
// … 省略 29 行
```


## 冲突 2  (第 221 行起)
   我方 0 行 [中性]
   上游 109 行 [UI] {UI:classList, UI:共享 UI, UI:DOM 写入, UI:类选择器, UI:内联样式}

**我方（企业侧）**
```js
```

**上游（开源侧）**
```js
  /**
   * 共享按钮的"禁用"是**类**：`.ui-button.is-disabled` / `.ui-icon-button.is-disabled`
   * 带 `pointer-events: none`。只改 `.disabled` 属性不够 —— 一个"模板里就 disabled"的按钮
   * （渲染时已带 `is-disabled`）后来被启用时，类还在 ⇒ 按钮**永远点不动**。
   * 真机事故：问答「发送」按钮输入文字后仍点不动（导入弹窗的「导入」同因）。
   * 因此凡是要改按钮可用状态，一律走这个函数，属性与类一起改。
// … 省略 103 行
```


## 冲突 3  (第 500 行起)
   我方 29 行 [UI] {UI:DOM 写入}
   上游 34 行 [中性]

**我方（企业侧）**
```js
      { key: 'personal', label: personalLabel, plus: true, btnId: 'kb-new-lib', btnTitle: _tr('kb.workbench.create_personal', '创建个人知识库'), html: _state.libs.filter((l) => !_state.treeFilter || l.name.toLowerCase().includes(_state.treeFilter)).map((l) =>
        `<div class="kb-tree-item${l.name === _state.currentLib && !_state.spaceId ? ' active' : ''}" data-kb-lib="${_esc(l.name)}">
          ${_icon('folder', 'kb-tree-ico')}<span class="kb-tree-name">${_esc(l.name)}</span></div>`
      ).join('') || '<div class="kb-tree-empty">暂无知识库，点击 ＋ 创建</div>' },
      { key: 'shared', label: sharedLabel, plus: true, btnId: 'kb-new-shared-space', btnTitle: _tr('kb.workbench.create_shared', '创建共享知识库'), html: _state.spaces.filter((sp) => !_state.treeFilter || (sp.name || sp.space_id).toLowerCase().includes(_state.treeFilter)).map((sp) =>
        `<div class="kb-tree-item${sp.space_id === _state.spaceId ? ' active' : ''}" data-kb-space="${_esc(sp.space_id)}">
// … 省略 23 行
```

**上游（开源侧）**
```js
      {
        key: 'personal', label: personalLabel, plus: true, btnId: 'kb-new-lib',
        btnTitle: _tr('kb.workbench.create_personal', '创建个人知识库'),
        items: _state.libs.filter((lib) => !_state.treeFilter || lib.name.toLowerCase().includes(_state.treeFilter))
          .map((lib) => node('lib', lib.name, lib.name, {
            icon: 'folder', selected: lib.name === _state.currentLib && !_state.spaceId,
// … 省略 28 行
```


## 冲突 4  (第 767 行起)
   我方 57 行 [中性]
   上游 79 行 [中性]

**我方（企业侧）**
```js
      <div class="kb-share-dlg" aria-describedby="kb-share-dlg-desc">
        ${_iconButtonHtml({ label: _t('kb.workbench.close', '关闭'), icon: 'x', className: 'kb-share-dlg-close', attrs: { id: 'kb-share-dlg-close' } })}
        <h3 class="kb-share-dlg-title" id="kb-share-dlg-title">${_esc(_t('kb.workbench.create_shared_library', '创建共享知识库'))}</h3>
        <p class="kb-share-dlg-desc" id="kb-share-dlg-desc">${_esc(_t('kb.workbench.create_shared_library_hint', '设置知识库信息、加入方式与成员权限。'))}</p>
        <div class="kb-share-form">
          <div class="kb-share-field">
// … 省略 51 行
```

**上游（开源侧）**
```js
      <section class="ui-modal kb-share-dlg" role="dialog" aria-modal="true" aria-labelledby="kb-share-dlg-title">
        <header class="ui-modal__header">
          <div class="ui-modal__heading">
            <h2 class="ui-modal__title" id="kb-share-dlg-title">${_esc(_tr('kb.workbench.create_shared_title', '创建共享知识库'))}</h2>
          </div>
          ${_uiIconButton({ label: _tr('kb.workbench.create_shared_close', '关闭创建共享知识库弹窗'), icon: 'x', className: 'kb-share-dlg-close' })}
// … 省略 73 行
```


## 冲突 5  (第 943 行起)
   我方 2 行 [中性]
   上游 2 行 [中性]

**我方（企业侧）**
```js
      e.currentTarget.setAttribute('aria-expanded', String(!permMenu.hidden));
      permMenu.dataset.open = String(!permMenu.hidden);
```

**上游（开源侧）**
```js
      permMenu.dataset.open = permMenu.hidden ? 'false' : 'true';
      permTrigger.setAttribute('aria-expanded', permMenu.hidden ? 'false' : 'true');
```


## 冲突 6  (第 955 行起)
   我方 1 行 [UI] {UI:类选择器}
   上游 1 行 [UI] {UI:类选择器}

**我方（企业侧）**
```js
        permMenu.querySelectorAll('.kb-share-perm-item').forEach((x) => x.setAttribute('aria-selected', 'false'));
```

**上游（开源侧）**
```js
        permMenu.querySelectorAll('.kb-share-perm-item').forEach((x) => x.setAttribute('aria-selected', x === item ? 'true' : 'false'));
```


## 冲突 7  (第 965 行起)
   我方 1 行 [UI] {UI:类选择器}
   上游 1 行 [中性]

**我方（企业侧）**
```js
        overlay.querySelector('#kb-share-perm-trigger').setAttribute('aria-expanded', 'false');
```

**上游（开源侧）**
```js
        permTrigger.setAttribute('aria-expanded', 'false');
```


## 冲突 8  (第 980 行起)
   我方 1 行 [UI] {UI:类选择器}
   上游 1 行 [中性]

**我方（企业侧）**
```js
        overlay.querySelector('#kb-share-perm-trigger').setAttribute('aria-expanded', 'false');
```

**上游（开源侧）**
```js
        permTrigger.setAttribute('aria-expanded', 'false');
```


## 冲突 9  (第 1008 行起)
   我方 1 行 [中性]
   上游 3 行 [UI] {UI:classList}

**我方（企业侧）**
```js
    _setButtonLabel(okBtn, _t('kb.workbench.creating', '创建中…'));
```

**上游（开源侧）**
```js
    okBtn.classList.add('is-loading');
    okBtn.setAttribute('aria-busy', 'true');
    _setUiButtonPresentation(okBtn, _tr('kb.workbench.creating', '创建中…'));
```


## 冲突 10  (第 1033 行起)
   我方 1 行 [中性]
   上游 3 行 [UI] {UI:classList}

**我方（企业侧）**
```js
      _setButtonLabel(okBtn, _t('kb.workbench.confirm', '确定'));
```

**上游（开源侧）**
```js
      okBtn.classList.remove('is-loading');
      okBtn.removeAttribute('aria-busy');
      _setUiButtonPresentation(okBtn, _tr('kb.workbench.confirm', '确定'));
```


## 冲突 11  (第 1069 行起)
   我方 19 行 [中性]
   上游 11 行 [中性]

**我方（企业侧）**
```js
    const title = _t(isLibrary ? 'kb.workbench.empty_library_title' : 'kb.workbench.empty_content_title', isLibrary ? '还没有知识库' : '知识库中还没有内容');
    const hint = _t(isLibrary ? 'kb.workbench.empty_library_hint' : 'kb.workbench.empty_content_hint', isLibrary ? '创建一个知识库，或导入资料开始使用' : '支持文件、文件夹、网页和笔记等多种导入方式');
    const action = {
      label: _t(isLibrary ? 'kb.workbench.create_library' : 'kb.workbench.add_content', isLibrary ? '创建知识库' : '添加内容'),
      role: 'primary',
      size: 'md',
// … 省略 13 行
```

**上游（开源侧）**
```js
    return _uiEmptyState({
      kind: 'actionable',
      title: isLibrary ? _tr('kb.workbench.empty_no_library', '还没有知识库') : _tr('kb.workbench.empty_library', '知识库什么也没有，去这里添加'),
      hint: isLibrary ? _tr('kb.workbench.empty_no_library_hint', '创建一个知识库，或导入资料开始使用') : _tr('kb.workbench.empty_library_hint', '支持文件、文件夹、网页、笔记等多种方式导入'),
      icon: 'book-open',
      action: {
// … 省略 5 行
```


## 冲突 12  (第 1230 行起)
   我方 8 行 [UI] {UI:类选择器}
   上游 25 行 [UI] {UI:类选择器}

**我方（企业侧）**
```js
    if (countEl) countEl.textContent = _t('kb.workbench.selected_files', `已选中 ${_dlgSelected.size} 个文件`).replace('{count}', String(_dlgSelected.size));
    if (okBtn) okBtn.disabled = _dlgSelected.size === 0;
  }

  function _bindImportDlgEvents(overlay) {
    overlay.querySelector('.kb-import-dlg-close')?.addEventListener('click', () => _closeModalOverlay(overlay, 'close'));
// … 省略 2 行
```

**上游（开源侧）**
```js
    if (countEl) countEl.textContent = _tr('kb.workbench.import_selected_count', '已选中 {count} 个文件', { count: _dlgSelected.size });
    if (okBtn) _setDisabled(okBtn, _dlgSelected.size === 0);
  }

  function _bindImportDlgEvents(overlay) {
    const trigger = document.getElementById('kb-wb-import');
// … 省略 19 行
```


## 冲突 13  (第 1344 行起)
   我方 1 行 [中性]
   上游 5 行 [UI] {UI:classList, UI:类选择器}

**我方（企业侧）**
```js
      _setButtonLabel(okBtn, _t('kb.workbench.importing', '导入中…'));
```

**上游（开源侧）**
```js
      okBtn.classList.add('is-loading');
      okBtn.setAttribute('aria-busy', 'true');
      const okIcon = okBtn.querySelector('.ui-button__icon');
      if (okIcon) okIcon.hidden = true;
      _setUiButtonPresentation(okBtn, _tr('kb.workbench.import_busy', '导入中…'));
```


## 冲突 14  (第 1366 行起)
   我方 3 行 [中性]
   上游 8 行 [UI] {UI:classList}

**我方（企业侧）**
```js
        if (typeof uiToast === 'function') uiToast('导入失败', { variant: 'error' });
        okBtn.disabled = false;
        _setButtonLabel(okBtn, _t('kb.workbench.import', '导入内容'));
```

**上游（开源侧）**
```js
        if (typeof uiToast === 'function') uiToast(_tr('kb.workbench.import_failed_short', '导入失败'), { variant: 'error' });
      } finally {
        if (overlay.isConnected) {
          okBtn.classList.remove('is-loading');
          okBtn.removeAttribute('aria-busy');
          _setUiButtonPresentation(okBtn, _tr('kb.workbench.import_confirm', '导入'), 'upload');
// … 省略 2 行
```


## 冲突 15  (第 1419 行起)
   我方 1 行 [中性]
   上游 1 行 [中性]

**我方（企业侧）**
```js
      </div>`).join('') || `<div class="kb-import-dlg-empty">${_esc(_t('kb.workbench.no_personal_library', '暂无个人知识库'))}</div>`;
```

**上游（开源侧）**
```js
      </div>`).join('') || _uiEmptyState({ kind: 'quiet', title: _tr('kb.workbench.import_no_library_empty', '暂无个人知识库') });
```


## 冲突 16  (第 1427 行起)
   我方 18 行 [中性]
   上游 23 行 [中性]

**我方（企业侧）**
```js
      <div class="kb-import-dlg" aria-describedby="kb-import-dlg-count">
        <div class="kb-import-dlg-head">
          <div class="kb-import-dlg-title" id="kb-import-dlg-title"><span class="kb-import-dlg-title-ico">${_icon('upload')}</span>${_esc(_t('kb.workbench.import', '导入内容'))}</div>
          <div class="kb-import-dlg-search">
            <span class="kb-import-dlg-search-ico">${_icon('search')}</span>
            <input type="text" placeholder="${_esc(_t('kb.workbench.search', '搜索'))}" aria-label="${_esc(_t('kb.workbench.search', '搜索'))}" autocomplete="off" spellcheck="false" />
// … 省略 12 行
```

**上游（开源侧）**
```js
      <section class="ui-modal ui-modal--lg kb-import-dlg" role="dialog" aria-modal="true" aria-labelledby="kb-import-dlg-title">
        <header class="ui-modal__header kb-import-dlg-head">
          <div class="ui-modal__heading">
            <h2 class="ui-modal__title kb-import-dlg-title" id="kb-import-dlg-title"><span class="kb-import-dlg-title-ico">${_icon('upload', 'kb-import-dlg-title-icon')}</span>${_esc(_tr('kb.workbench.import_title', '导入内容'))}</h2>
          </div>
          <div class="kb-import-dlg-search">
// … 省略 17 行
```


## 冲突 17  (第 1473 行起)
   我方 5 行 [中性]
   上游 5 行 [中性]

**我方（企业侧）**
```js
        <div class="kb-import-dlg-foot">
          <span class="kb-import-dlg-count" id="kb-import-dlg-count">${_esc(_t('kb.workbench.selected_files', '已选中 {count} 个文件').replace('{count}', '0'))}</span>
          <div class="kb-import-dlg-actions">
            ${_buttonHtml({ label: _t('kb.workbench.cancel', '取消'), role: 'secondary', size: 'sm', className: 'kb-import-dlg-cancel' })}
            ${_buttonHtml({ label: _t('kb.workbench.import', '导入内容'), role: 'primary', size: 'sm', className: 'kb-import-dlg-ok', disabled: true })}
```

**上游（开源侧）**
```js
        <footer class="ui-modal__footer kb-import-dlg-foot">
          <span class="kb-import-dlg-count" data-kb-import-count>${_esc(_tr('kb.workbench.import_selected_count', '已选中 {count} 个文件', { count: 0 }))}</span>
          <div class="kb-import-dlg-actions">
            ${_uiButton({ label: _tr('kb.workbench.cancel', '取消'), role: 'secondary', size: 'sm', className: 'kb-import-dlg-cancel' })}
            ${_uiButton({ label: _tr('kb.workbench.import_confirm', '导入'), role: 'primary', size: 'sm', icon: 'upload', disabled: true, className: 'kb-import-dlg-ok' })}
```


## 冲突 18  (第 1493 行起)
   我方 4 行 [中性]
   上游 0 行 [中性]

**我方（企业侧）**
```js
    _adoptModal(overlay, '.kb-import-dlg', {
      labelledBy: 'kb-import-dlg-title',
      initialFocus: '.kb-import-dlg-search input',
    });
```

**上游（开源侧）**
```js
```


## 冲突 19  (第 1707 行起)
   我方 2 行 [中性]
   上游 2 行 [中性]

**我方（企业侧）**
```js
          <span class="kb-file-meta">${_countFiles(d)} 项</span>
          <span class="kb-file-actions"><button type="button" class="kb-mini-btn" data-kb-dir-toggle="${_esc(path)}" title="展开">${_icon('chevron-right', 'kb-mini-ico')}</button></span>
```

**上游（开源侧）**
```js
          <span class="kb-file-meta">${_esc(_tr('kb.workbench.node_count', '{count} 项', { count: _countFiles(d) }))}</span>
          <span class="kb-file-actions">${_uiIconButton({ label: _tr('kb.workbench.expand', '展开'), icon: 'chevron-right', className: 'kb-mini-btn', attrs: { 'data-kb-dir-toggle': path } })}</span>
```


## 冲突 20  (第 1724 行起)
   我方 1 行 [中性]
   上游 1 行 [中性]

**我方（企业侧）**
```js
          <span class="kb-file-actions"><button type="button" class="kb-mini-btn" title="生成思维导图（S3）">${_icon('sparkles', 'kb-mini-ico')}</button><button type="button" class="kb-mini-btn" title="更多">${_icon('more-horizontal', 'kb-mini-ico')}</button></span>
```

**上游（开源侧）**
```js
          <span class="kb-file-actions">${_uiIconButton({ label: _tr('kb.workbench.file_gen_mindmap', '生成思维导图（S3）'), icon: 'sparkles', className: 'kb-mini-btn' })}${_uiIconButton({ label: '更多', icon: 'more-horizontal', className: 'kb-mini-btn' })}</span>
```


## 冲突 21  (第 1751 行起)
   我方 2 行 [中性]
   上游 2 行 [中性]

**我方（企业侧）**
```js
        <span class="kb-file-meta">${_countFiles(d)} 项</span>
        <span class="kb-file-actions"><button type="button" class="kb-mini-btn" data-kb-dir-toggle="${_esc(path)}" title="${open ? '折叠' : '展开'}">${_icon(open ? 'chevron-down' : 'chevron-right', 'kb-mini-ico')}</button></span>
```

**上游（开源侧）**
```js
        <span class="kb-file-meta">${_esc(_tr('kb.workbench.node_count', '{count} 项', { count: _countFiles(d) }))}</span>
        <span class="kb-file-actions">${_uiIconButton({ label: open ? _tr('kb.workbench.collapse', '收起') : _tr('kb.workbench.expand', '展开'), icon: open ? 'chevron-down' : 'chevron-right', className: 'kb-mini-btn', attrs: { 'data-kb-dir-toggle': path } })}</span>
```


## 冲突 22  (第 1769 行起)
   我方 1 行 [中性]
   上游 1 行 [中性]

**我方（企业侧）**
```js
        <span class="kb-file-actions"><button type="button" class="kb-mini-btn" title="生成思维导图（S3）">${_icon('sparkles', 'kb-mini-ico')}</button><button type="button" class="kb-mini-btn" title="更多">${_icon('more-horizontal', 'kb-mini-ico')}</button></span>
```

**上游（开源侧）**
```js
        <span class="kb-file-actions">${_uiIconButton({ label: _tr('kb.workbench.file_gen_mindmap', '生成思维导图（S3）'), icon: 'sparkles', className: 'kb-mini-btn' })}${_uiIconButton({ label: '更多', icon: 'more-horizontal', className: 'kb-mini-btn' })}</span>
```


## 冲突 23  (第 1802 行起)
   我方 1 行 [中性]
   上游 1 行 [中性]

**我方（企业侧）**
```js
        <span class="kb-file-actions"><button type="button" class="kb-mini-btn" title="生成思维导图（S3）">${_icon('sparkles', 'kb-mini-ico')}</button><button type="button" class="kb-mini-btn" title="更多">${_icon('more-horizontal', 'kb-mini-ico')}</button></span>
```

**上游（开源侧）**
```js
        <span class="kb-file-actions">${_uiIconButton({ label: _tr('kb.workbench.file_gen_mindmap', '生成思维导图（S3）'), icon: 'sparkles', className: 'kb-mini-btn' })}${_uiIconButton({ label: '更多', icon: 'more-horizontal', className: 'kb-mini-btn' })}</span>
```


## 冲突 24  (第 1903 行起)
   我方 1 行 [中性]
   上游 963 行 [UI] {UI:类选择器, 功能:IPC, UI:DOM 写入, UI:classList, UI:内联样式, 功能:HTTP, UI:CSS}

**我方（企业侧）**
```js
  // ── 文件查看（点击文件行 → 打开原文查看器）──
```

**上游（开源侧）**
```js
  async function _openFileViewer(payload, scopeName, opts) {
    const scope = scopeName || (payload && payload.spaceId ? payload.spaceId : '');
    const hl = (opts && typeof opts === 'object') ? opts : null;
    let overlay = _ensureFileViewerOverlay();
    const dialog = overlay.querySelector('.kb-fv-dialog');
    // 先显示再恢复上次的窗口尺寸/位置：overlay 关着时是 display:none，量出来的
// … 省略 957 行
```


## 冲突 25  (第 2930 行起)
   我方 1 行 [中性]
   上游 1 行 [中性]

**我方（企业侧）**
```js
        <button type="button" class="kb-qa-attach-rm" data-attach-idx="${i}" title="移除附件">✕</button>
```

**上游（开源侧）**
```js
        ${_uiIconButton({ label: _tr('kb.workbench.qa_attach_remove', '移除附件'), icon: 'x', variant: 'danger', className: 'kb-qa-attach-rm', attrs: { 'data-attach-idx': i } })}
```


## 冲突 26  (第 3035 行起)
   我方 3 行 [中性]
   上游 7 行 [中性]

**我方（企业侧）**
```js
  // 切换库/空间时把解析卡重置为「未解析」态：脑图/测验入口保持可见（禁用），
  // 避免用户误以为功能消失；点击「✨ 生成 AI 解析」后启用。
  function _resetAnalysisCard() {
```

**上游（开源侧）**
```js
  /**
   * 切换库/空间时把解析卡重置为「未解析」态。
   *
   * 注意：**脑图/测验入口与解析无关**（真机反馈"为什么只在 AI 解析后才能打开"）——
   * 它们各自独立取库内 ready 文档生成（kb.mindmap / kb.quiz），所以这里直接可用，
   * 只有"库是空的"才禁用。解析只是同一张卡上的另一个入口。
// … 省略 1 行
```


## 冲突 27  (第 3052 行起)
   我方 11 行 [UI] {UI:类选择器}
   上游 49 行 [UI] {UI:类选择器}

**我方（企业侧）**
```js
        <span><span class="kb-wb-ai-chip"></span>${_esc(_t('kb.workbench.analysis_title', 'AI 解析本知识库'))}</span>
        <span class="kb-wb-card-actions">
          ${_buttonHtml({ label: _t('kb.workbench.generate_mindmap', '生成脑图'), role: 'primary', size: 'sm', icon: 'layout-grid', className: 'kb-wb-a-btn is-primary', disabled: true, attrs: { id: 'kb-wb-gen-mm', title: _t('kb.workbench.analysis_required', '请先生成 AI 解析') } })}
          ${_buttonHtml({ label: _t('kb.workbench.generate_quiz', '生成测验'), role: 'secondary', size: 'sm', icon: 'file-text', className: 'kb-wb-a-btn', disabled: true, attrs: { id: 'kb-wb-gen-quiz', title: _t('kb.workbench.analysis_required', '请先生成 AI 解析') } })}
        </span>
      </div>
// … 省略 5 行
```

**上游（开源侧）**
```js
        <span><span class="kb-wb-ai-chip"></span><span data-wb-text="kb.workbench.analysis_title"></span></span>
        <span class="kb-wb-card-actions">
          ${_uiButton({ label: _tr('kb.workbench.gen_mindmap', '生成脑图'), role: 'secondary', size: 'sm', icon: 'brain-circuit', className: 'kb-wb-analysis-action', attrs: { id: 'kb-wb-gen-mm' } })}
          ${_uiButton({ label: _tr('kb.workbench.gen_quiz', '生成测验'), role: 'secondary', size: 'sm', icon: 'file-text', className: 'kb-wb-analysis-action', attrs: { id: 'kb-wb-gen-quiz' } })}        </span>
      </div>
      <div class="kb-wb-right-card-sub" id="kb-wb-analysis-sub">${_esc(_tr('kb.workbench.right_lib_placeholder', '当前库：—'))}</div>
// … 省略 43 行
```


## 冲突 28  (第 3162 行起)
   我方 1 行 [中性]
   上游 1 行 [中性]

**我方（企业侧）**
```js
        if (h) h.textContent = '解析失败，请点击「✨ 生成 AI 解析」重试。';
```

**上游（开源侧）**
```js
        if (h) h.textContent = _tr('kb.workbench.analysis_retry_hint', '解析失败，请点击「生成 AI 解析」重试。');
```


## 冲突 29  (第 3184 行起)
   我方 7 行 [中性]
   上游 6 行 [中性]

**我方（企业侧）**
```js
      ${_buttonHtml({ label: _t('kb.workbench.generate_mindmap', '生成脑图'), role: 'primary', size: 'sm', icon: 'layout-grid', className: 'kb-wb-a-btn is-primary', disabled: !(ok && hasMm), attrs: { id: 'kb-wb-gen-mm' } })}
      ${_buttonHtml({ label: _t('kb.workbench.generate_quiz', '生成测验'), role: 'secondary', size: 'sm', icon: 'file-text', className: 'kb-wb-a-btn', disabled: !ok, attrs: { id: 'kb-wb-gen-quiz' } })}
      ${_buttonHtml({ label: _t('kb.workbench.expand_analysis', '展开'), role: 'ghost', size: 'sm', iconEnd: 'chevron-down', className: 'kb-wb-analysis-toggle', attrs: { id: 'kb-wb-analysis-toggle', 'aria-expanded': 'false' } })}
    </span>`;

    let html = `<div class="kb-wb-right-card-title">
// … 省略 1 行
```

**上游（开源侧）**
```js
      ${_uiButton({ label: _tr('kb.workbench.gen_mindmap', '生成脑图'), role: 'secondary', size: 'sm', icon: 'brain-circuit', className: 'kb-wb-analysis-action', attrs: { id: 'kb-wb-gen-mm' } })}
      ${_uiButton({ label: _tr('kb.workbench.gen_quiz', '生成测验'), role: 'secondary', size: 'sm', icon: 'file-text', className: 'kb-wb-analysis-action', attrs: { id: 'kb-wb-gen-quiz' } })}
      ${_uiButton({ label: _tr('kb.workbench.expand', '展开'), role: 'ghost', size: 'sm', iconEnd: 'chevron-down', className: 'kb-wb-analysis-toggle', attrs: { id: 'kb-wb-analysis-toggle', 'aria-expanded': 'false' } })}    </span>`;

    let html = `<div class="kb-wb-right-card-title">
      <span><span class="kb-wb-ai-chip"></span>${_esc(_tr('kb.workbench.analysis_title', 'AI 解析本知识库'))}${srcTag}<span class="kb-wb-card-src">${_esc(_tr('kb.workbench.analysis_docs', '（{count} 个文档）', { count: docs.length }))}</span></span>
```


## 冲突 30  (第 3205 行起)
   我方 1 行 [中性]
   上游 1 行 [中性]

**我方（企业侧）**
```js
        html += `<div class="kb-wb-one-liner"><span class="kb-wb-one-liner-tag">${_icon('sparkles')}${_esc(_t('kb.workbench.one_line_summary', '一句话总结'))}</span><span class="kb-wb-one-liner-text">${_esc(oneLiner)}</span></div>`;
```

**上游（开源侧）**
```js
        html += `<div class="kb-wb-one-liner"><span class="kb-wb-one-liner-tag">${_icon('info')} ${_esc(_tr('kb.workbench.analysis_one_liner', '一句话总结'))}</span><span class="kb-wb-one-liner-text">${_esc(oneLiner)}</span></div>`;
```


## 冲突 31  (第 3235 行起)
   我方 5 行 [UI] {UI:类选择器}
   上游 1 行 [UI] {UI:类选择器}

**我方（企业侧）**
```js
    const mmBtn = card.querySelector('#kb-wb-gen-mm');
    if (mmBtn && !mmBtn.disabled) mmBtn.addEventListener('click', () => _genMindmap());
    const quizBtn = card.querySelector('#kb-wb-gen-quiz');
    if (quizBtn && !quizBtn.disabled) quizBtn.addEventListener('click', () => _renderQuiz(summary));
    card.querySelector('#kb-wb-analysis-toggle')?.addEventListener('click', () => {
```

**上游（开源侧）**
```js
    _bindAnalysisActions(card);    card.querySelector('#kb-wb-analysis-toggle')?.addEventListener('click', () => {
```


## 冲突 32  (第 3249 行起)
   我方 5 行 [UI] {UI:类选择器}
   上游 2 行 [中性]

**我方（企业侧）**
```js
      btn.setAttribute('aria-expanded', String(open));
      const label = open ? _t('kb.workbench.collapse_analysis', '收起') : _t('kb.workbench.expand_analysis', '展开');
      const labelNode = btn.querySelector('.ui-button__label');
      if (labelNode) labelNode.textContent = label;
      else btn.textContent = label;
```

**上游（开源侧）**
```js
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      _setUiButtonPresentation(btn, open ? _tr('kb.workbench.collapse', '收起') : _tr('kb.workbench.expand', '展开'), open ? 'chevron-up' : 'chevron-down');
```


## 冲突 33  (第 3302 行起)
   我方 1 行 [中性]
   上游 1 行 [中性]

**我方（企业侧）**
```js
      + (withRetry ? '<br><button type="button" class="kb-mm-retry-btn">🔄 重新生成</button>' : '')
```

**上游（开源侧）**
```js
      + (withRetry ? `<br>${_uiButton({ label: _tr('kb.workbench.regenerate', '重新生成'), role: 'secondary', size: 'sm', icon: 'refresh', className: 'kb-mm-retry-btn' })}` : '')
```


## 冲突 34  (第 3530 行起)
   我方 0 行 [中性]
   上游 306 行 [UI] {UI:DOM 写入, UI:类选择器, 功能:IPC}

**我方（企业侧）**
```js
```

**上游（开源侧）**
```js
  /**
   * 主进程回执的文件列表是否就是请求的那一份。
   *
   * 只要求"恰好一份 + 文件名一致"：真正要守住的是"别把整库图冒充本文档图"，
   * 而不是比对字节。macOS 上文件名存在 NFC/NFD 两种等价形式（同一个文件两种字节），
   * 严格字符串相等会把它们判成两份，导致合法请求被当成错配丢弃。
// … 省略 300 行
```


## 冲突 35  (第 3886 行起)
   我方 1 行 [中性]
   上游 2 行 [中性]

**我方（企业侧）**
```js
          btn.textContent = '🧠 重新生成脑图';
```

**上游（开源侧）**
```js
          _setUiButtonPresentation(btn, _tr('kb.workbench.mm_regenerate', '重新生成脑图'), 'brain-circuit');
          btn.title = _tr('kb.workbench.mm_regenerate_answer_tip', '重新生成该回答的脑图');
```


## 冲突 36  (第 4000 行起)
   我方 1 行 [中性]
   上游 3 行 [中性]

**我方（企业侧）**
```js
  let _mmZoom = 1, _mmPanX = 0, _mmPanY = 0, _mmPanning = false, _mmPanStart = null;
```

**上游（开源侧）**
```js
  // 原文查看器（kb-fv）：PDF/Office 走这里以保证排版与缩放（#214 曾把它删掉，
// 主进程 kb.openFile / kb-file:// 一直在，缺的就是这一层）；变量随查看器代码块一起恢复。
let _mmZoom = 1, _mmPanX = 0, _mmPanY = 0, _mmPanning = false, _mmPanStart = null;
```


## 冲突 37  (第 4024 行起)
   我方 0 行 [中性]
   上游 5 行 [中性]

**我方（企业侧）**
```js
```

**上游（开源侧）**
```js
    // 先显示再套用尺寸/位置记忆：display:none 时量不到布局尺寸，居中位会被算成 0
    // （全程同步执行，同一帧内完成，不会看到窗口跳动）
    if (_mmModalController) _mmModalController.open(document.activeElement);
    else overlay.hidden = false;
    _mmApplyWindowRect();
```


## 冲突 38  (第 4150 行起)
   我方 4 行 [功能] {功能:状态流}
   上游 4 行 [混合] {功能:状态流, UI:DOM 写入}

**我方（企业侧）**
```js
      el.textContent = _t('kb.workbench.unsaved', '未保存');
      el.className = 'kb-mm-save-state is-dirty';
    } else {
      el.textContent = _t('kb.workbench.saved', '已保存');
```

**上游（开源侧）**
```js
      el.textContent = '● ' + _tr('kb.workbench.mm_unsaved', '未保存');
      el.className = 'kb-mm-save-state is-dirty';
    } else {
      el.innerHTML = `${_icon('check')} ${_esc(_tr('kb.workbench.mm_saved', '已保存'))}`;
```


## 冲突 39  (第 4171 行起)
   我方 1 行 [中性]
   上游 4 行 [中性]

**我方（企业侧）**
```js
    _setButtonLabel(btn, _mmPreviewMode ? _t('kb.workbench.edit', '编辑') : _t('kb.workbench.preview', '预览'));
```

**上游（开源侧）**
```js
    if (btn) {
      _setUiButtonPresentation(btn, _mmPreviewMode ? _tr('kb.workbench.mm_edit', '编辑') : _tr('kb.workbench.mm_preview', '预览'), _mmPreviewMode ? 'edit-pencil' : 'eye');
      btn.setAttribute('aria-pressed', String(_mmPreviewMode));
    }
```


## 冲突 40  (第 4196 行起)
   我方 3 行 [中性]
   上游 4 行 [中性]

**我方（企业侧）**
```js
      { k: 'fit', label: '适应画布', fn: () => _mmFitToStage() },
      { k: 'center', label: '居中根节点', fn: () => _mmCenterNode(0) },
      { k: 'copy', label: '复制 SVG', fn: () => _mmCopySvg() },
```

**上游（开源侧）**
```js
      { k: 'fit', label: _tr('kb.workbench.mm_fit_tip', '适应画布'), icon: 'maximize', fn: () => _mmFitToStage() },
      { k: 'center', label: _tr('kb.workbench.mm_center_root', '居中根节点'), icon: 'target', fn: () => _mmCenterNode(0) },
      { k: 'center-window', label: _tr('kb.workbench.mm_center_window', '窗口居中'), icon: 'panel-collapse', fn: () => _mmCenterWindow() },
      { k: 'copy', label: _tr('kb.workbench.mm_copy_svg', '复制 SVG'), icon: 'copy', fn: () => _mmCopySvg() },
```


## 冲突 41  (第 4225 行起)
   我方 1 行 [中性]
   上游 3 行 [中性]

**我方（企业侧）**
```js
      const html = `<!doctype html><html><head><meta charset="utf-8"><title>脑图</title><style>body{margin:0;background:#fff;display:flex;align-items:center;justify-content:center;min-height:100vh}</style></head><body>${svg}</body></html>`;
```

**上游（开源侧）**
```js
      // 独立窗口：SVG 撑满窗口内容盒，靠 preserveAspectRatio（默认 xMidYMid meet）居中缩放。
      // 此前 body 用 flex 居中 + min-height:100vh，图比窗口大时会被裁掉左上角且无法滚动（看着就没居中）。
      const html = `<!doctype html><html><head><meta charset="utf-8"><title>${_esc(_tr('kb.workbench.mm_title', '脑图预览'))}</title><style>html,body{height:100%}body{margin:0;box-sizing:border-box;padding:24px;background:#fff}svg{display:block;width:100%;height:100%}</style></head><body>${svg}</body></html>`;
```


## 冲突 42  (第 4402 行起)
   我方 2 行 [中性]
   上游 2 行 [中性]

**我方（企业侧）**
```js
        const pretty = m.key.startsWith('space:') ? `共享空间 ${m.key.slice(6)}` : `个人库 ${m.key.slice(4)}`;
        return `<div class="kb-mm-open-item" data-key="${_esc(m.key)}"><span class="kb-mm-open-item-name">${_esc(pretty)}</span><span class="kb-mm-open-item-time">${time}</span></div>`;
```

**上游（开源侧）**
```js
        const pretty = m.key.startsWith('space:') ? _tr('kb.workbench.mm_scope_space', '共享空间 {name}', { name: m.key.slice(6) }) : _tr('kb.workbench.mm_scope_lib', '个人库 {name}', { name: m.key.slice(4) });
        return `<div class="kb-mm-open-item" data-key="${_esc(m.key)}">${_icon('brain-circuit', 'kb-mm-menu-icon')}<span class="kb-mm-open-item-name">${_esc(pretty)}</span><span class="kb-mm-open-item-time">${time}</span></div>`;
```


## 冲突 43  (第 4438 行起)
   我方 2 行 [中性]
   上游 7 行 [中性]

**我方（企业侧）**
```js
          overlay.hidden = false;
          titleEl.value = `${_t('kb.workbench.mindmap_preview', '脑图预览')} - ${key.startsWith('space:') ? `${_t('kb.workbench.shared_space', '共享空间')} ${key.slice(6)}` : `${_t('kb.workbench.personal_library_short', '个人库')} ${key.slice(4)}`}（${_t('kb.workbench.saved', '已保存')}）`;
```

**上游（开源侧）**
```js
          _openMindPreview();
          const scopeLabel = key.startsWith('space:')
            ? _tr('kb.workbench.mm_scope_space', '共享空间 {name}', { name: key.slice(6) })
            : isDocKey
              ? _tr('kb.workbench.mm_scope_file', '文档 {name}', { name: String(key.slice(4).split('#')[0]).split('/').pop() })
              : _tr('kb.workbench.mm_scope_lib', '个人库 {name}', { name: key.slice(4) });
// … 省略 1 行
```


## 冲突 44  (第 4730 行起)
   我方 1 行 [中性]
   上游 1 行 [中性]

**我方（企业侧）**
```js
      if (hint) hint.textContent = _t('kb.workbench.mindmap_outline_hint', '点击行可跳转到对应节点 · 折叠的一级分支不展开');
```

**上游（开源侧）**
```js
      if (hint) hint.textContent = _tr('kb.workbench.mm_outline_tip', '点击行可跳转到对应节点 · 折叠的分支不展开');
```


## 冲突 45  (第 4779 行起)
   我方 2 行 [中性]
   上游 5 行 [中性]

**我方（企业侧）**
```js
        window.__openAnchorViewer({
          source: 'library',
```

**上游（开源侧）**
```js
        // 与列表点击同一条分派：排版类（pdf/office/html/图片）走富查看器保排版，
        // 文本类才回落原文查看器（原先这里一律走文本查看器，PDF 来源跳转就丢排版）。
        // 来源只给了"文档名"（没有片段依据）⇒ 打开整篇，不带 chunkIdx。
        _openFileViewerForAnchor({
          source: _state.spaceId ? 'space' : 'library',
```


## 冲突 46  (第 4806 行起)
   我方 14 行 [中性]
   上游 11 行 [中性]

**我方（企业侧）**
```js
      focusBtn.title = on ? _t('kb.workbench.focus_active_hint', '点击一级分支切换聚焦分支，点此取消聚焦') : _t('kb.workbench.focus_hint', '点击一级分支只查看该分支');
      _setButtonLabel(focusBtn, on ? _t('kb.workbench.focusing', '聚焦中') : _t('kb.workbench.focus', '聚焦'));
    }
    const layoutBtn = document.getElementById('kb-mm-layout-btn');
    _setButtonLabel(layoutBtn, _state.mmMode === 'org' ? _t('kb.workbench.org_chart', '组织结构') : _t('kb.workbench.mindmap', '思维导图'));
    const bgBtn = document.getElementById('kb-mm-bg-btn');
// … 省略 8 行
```

**上游（开源侧）**
```js
      focusBtn.title = on ? _tr('kb.workbench.mm_focus_on_tip', '点击一级分支切换聚焦分支 · 点此取消聚焦') : _tr('kb.workbench.mm_focus_off_tip', '聚焦分支：点击一级分支只看该分支');
      focusBtn.setAttribute('aria-pressed', String(on));
      _setUiButtonPresentation(focusBtn, on ? _tr('kb.workbench.mm_focused', '聚焦中') : _tr('kb.workbench.mm_focus', '聚焦'), 'target');
    }
    const layoutBtn = document.getElementById('kb-mm-layout-btn');
    if (layoutBtn) _setUiButtonPresentation(layoutBtn, _state.mmMode === 'org' ? _tr('kb.workbench.mm_org', '组织结构') : _tr('kb.workbench.mm_mind', '思维导图'), 'layout-grid');
// … 省略 5 行
```


## 冲突 47  (第 4840 行起)
   我方 2 行 [中性]
   上游 2 行 [中性]

**我方（企业侧）**
```js
        ? _t('kb.workbench.mindmap_outline_hint', '点击行可跳转到对应节点 · 折叠的一级分支不展开')
        : _t('kb.workbench.mindmap_hint', '滚轮缩放 · 拖拽平移 · 一级分支点击聚焦 · −/+ 折叠 · 双击重命名');
```

**上游（开源侧）**
```js
        ? _tr('kb.workbench.mm_outline_tip', '点击行可跳转到对应节点 · 折叠的分支不展开')
        : _tr('kb.workbench.mm_canvas_tip', '滚轮缩放 · 拖拽平移 · 一级分支点击聚焦 · −/+ 折叠 · 双击重命名');
```


## 冲突 48  (第 5037 行起)
   我方 1 行 [中性]
   上游 4 行 [中性]

**我方（企业侧）**
```js
    // 折叠的一级分支：子树隐藏
```

**上游（开源侧）**
```js
    // 折叠节点：其整棵子树不占位（收拢后脑图收紧，不留大片空档）。
    // 2026-09-16：由"只支持一级分支折叠"放开为**任意层级**——渐进展开要求
    // "点一层开一层"，二级/三级节点也必须能被折叠，否则展开一级分支时会把整支
    // 一次炸开（4 层图直接铺满窗口），退回"全展开才看得清"的老问题。
```


## 冲突 49  (第 5098 行起)
   我方 6 行 [中性]
   上游 3 行 [中性]

**我方（企业侧）**
```js
      const folded = n.depth === 1 && collapsed.has(n.idx);
      const badgeX = n.x + n.dir * (w / 2 + 9);
      // 徽章统一加 kb-mm-fold-badge class：折叠态是 +N（点击展开），展开态是 −（点击折叠）
      const foldBadge = folded
        ? `<circle class="kb-mm-fold-badge" cx="${badgeX}" cy="${n.y}" r="8" fill="#fff" stroke="${p.stroke}"/><text class="kb-mm-fold-badge" x="${badgeX}" y="${n.y + 4}" text-anchor="middle" font-size="10" fill="${p.stroke}">+${n.childCount}</text>`
        : (n.childCount > 0 && n.depth >= 1 ? `<circle class="kb-mm-fold-badge" cx="${badgeX}" cy="${n.y}" r="8" fill="#fff" stroke="#C3C7D1"/><text class="kb-mm-fold-badge" x="${badgeX}" y="${n.y + 4}" text-anchor="middle" font-size="10" fill="#3C4150">−</text>` : '');
```

**上游（开源侧）**
```js
      // 有子节点且被折叠（任意层级都算）→ 画 +N 徽章，表示"这里还有一层，点开看"
      const folded = n.childCount > 0 && collapsed.has(n.idx);
      const badgeX = n.x + n.dir * (w / 2 + 10);
```


## 冲突 50  (第 5118 行起)
   我方 0 行 [中性]
   上游 9 行 [中性]

**我方（企业侧）**
```js
```

**上游（开源侧）**
```js
      // 有来源的节点：前缘一个小圆点（原先用 emoji 挤在角上，很花）
      const srcDot = n.source && n.depth >= 2
        ? `<circle cx="${fc(n.dir > 0 ? x + 7 : x + w - 7)}" cy="${fc(n.y)}" r="2.4" fill="${pal.mid}"/>`
        : '';
      const foldBadge = folded
        ? `<circle class="kb-mm-fold-badge" cx="${fc(badgeX)}" cy="${fc(n.y)}" r="8" fill="#FFFFFF" stroke="${pal.deep}" stroke-width="1.2"/><text class="kb-mm-fold-badge" x="${fc(badgeX)}" y="${fc(n.y + 3.6)}" text-anchor="middle" font-size="10" font-weight="600" fill="${pal.ink}">+${n.childCount}</text>`
// … 省略 3 行
```


## 冲突 51  (第 5212 行起)
   我方 1 行 [UI] {UI:DOM 写入}
   上游 4 行 [中性]

**我方（企业侧）**
```js
      if (btn) { btn.innerHTML = '🧠 重新生成脑图'; btn.title = '重新生成该回答的脑图'; }
```

**上游（开源侧）**
```js
      if (btn) {
        _setUiButtonPresentation(btn, _tr('kb.workbench.mm_regenerate', '重新生成脑图'), 'brain-circuit');
        btn.title = _tr('kb.workbench.mm_regenerate_answer_tip', '重新生成该回答的脑图');
      }
```


## 冲突 52  (第 5273 行起)
   我方 9 行 [中性]
   上游 9 行 [中性]

**我方（企业侧）**
```js
        <span>会话历史</span>
        <button type="button" class="kb-qa-history-close" title="关闭">✕</button>
      </div>
      <div class="kb-qa-history-new" id="kb-qa-history-new">＋ 新建对话</div>
      <div class="kb-qa-history-list">${_state.qaSessions.length
        ? _state.qaSessions.map((s) => `<div class="kb-qa-history-item${s.id === _state.qaSessionId ? ' is-active' : ''}" data-hist-id="${_esc(s.id)}">
// … 省略 3 行
```

**上游（开源侧）**
```js
        <span>${_esc(_tr('kb.workbench.qa_history', '会话历史'))}</span>
        ${_uiIconButton({ label: _tr('kb.workbench.qa_history_close', '关闭会话历史'), icon: 'x', className: 'kb-qa-history-close' })}
      </div>
      ${_uiButton({ label: _tr('kb.workbench.qa_new_session', '新建对话'), role: 'secondary', size: 'sm', icon: 'plus', className: 'kb-qa-history-new', attrs: { id: 'kb-qa-history-new' } })}
      <div class="kb-qa-history-list">${_state.qaSessions.length
        ? _state.qaSessions.map((s) => `<div class="kb-qa-history-item${s.id === _state.qaSessionId ? ' is-active' : ''}" data-hist-id="${_esc(s.id)}">
// … 省略 3 行
```


## 冲突 53  (第 5360 行起)
   我方 3 行 [中性]
   上游 8 行 [中性]

**我方（企业侧）**
```js
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'kb-qa-src-toggle';
```

**上游（开源侧）**
```js
    const toggle = _elementFromHtml(_uiButton({
      label: _tr('kb.workbench.qa_sources', '资料来源 · {count}', { count: n }),
      role: 'ghost',
      size: 'sm',
      iconEnd: 'chevron-down',
      className: 'kb-qa-src-toggle',
// … 省略 2 行
```


## 冲突 54  (第 5378 行起)
   我方 1 行 [中性]
   上游 1 行 [中性]

**我方（企业侧）**
```js
      toggle.textContent = `资料来源 · ${n}${open ? ' ▴' : ' ▾'}`;
```

**上游（开源侧）**
```js
      _setUiButtonPresentation(toggle, _tr('kb.workbench.qa_sources', '资料来源 · {count}', { count: n }), open ? 'chevron-up' : 'chevron-down');
```


## 冲突 55  (第 5389 行起)
   我方 12 行 [中性]
   上游 13 行 [中性]

**我方（企业侧）**
```js
      const pathBtn = document.createElement('button');
      pathBtn.type = 'button';
      pathBtn.className = 'kb-qa-src-path';
      pathBtn.textContent = `${r.path}#chunk ${r.chunkIdx}`;
      pathBtn.title = '跳转到原文';
      pathBtn.addEventListener('click', () => _openAnchor(r));
// … 省略 6 行
```

**上游（开源侧）**
```js
      const pathBtn = _elementFromHtml(_uiButton({
        label: `${r.path}#chunk ${r.chunkIdx}`,
        role: 'ghost',
        size: 'sm',
        className: 'kb-qa-src-path',
        attrs: { title: _tr('kb.workbench.qa_jump_source', '跳转到原文') },
// … 省略 7 行
```


## 冲突 56  (第 5441 行起)
   我方 2 行 [UI] {UI:DOM 写入}
   上游 8 行 [中性]

**我方（企业侧）**
```js
    btn.innerHTML = hasMm ? '🧠 重新生成脑图' : '🧠 生成脑图';
    btn.title = hasMm ? '重新生成该回答的脑图' : '基于本条回答内容生成脑图';
```

**上游（开源侧）**
```js
    const btn = _elementFromHtml(_uiButton({
      label: hasMm ? _tr('kb.workbench.mm_regenerate', '重新生成脑图') : _tr('kb.workbench.gen_mindmap', '生成脑图'),
      role: 'primary',
      size: 'sm',
      icon: 'brain-circuit',
      className: 'kb-qa-mm-btn',
// … 省略 2 行
```


## 冲突 57  (第 5640 行起)
   我方 4 行 [中性]
   上游 4 行 [中性]

**我方（企业侧）**
```js
        <button type="button" class="kb-qa-more-btn" title="更多">${_svg('more-h')}</button>
        <div class="kb-qa-msg-menu" hidden>
          <div class="kb-qa-msg-menu-item" data-qa-act="rename">📝 重命名</div>
          <div class="kb-qa-msg-menu-item is-danger" data-qa-act="delete">🗑 删除</div>
```

**上游（开源侧）**
```js
        ${_uiIconButton({ label: _tr('kb.workbench.more', '更多'), icon: 'more-horizontal', className: 'kb-qa-more-btn' })}
        <div class="kb-qa-msg-menu" hidden>
          ${_uiButton({ label: _tr('kb.workbench.menu_rename', '重命名'), icon: 'edit-pencil', role: 'ghost', size: 'sm', className: 'kb-qa-msg-menu-item', attrs: { 'data-qa-act': 'rename' } })}
          ${_uiButton({ label: _tr('kb.workbench.menu_delete', '删除'), icon: 'trash-2', role: 'danger', size: 'sm', className: 'kb-qa-msg-menu-item', attrs: { 'data-qa-act': 'delete' } })}
```


## 冲突 58  (第 5766 行起)
   我方 5 行 [UI] {UI:DOM 写入}
   上游 8 行 [UI] {UI:DOM 写入}

**我方（企业侧）**
```js
            txt.innerHTML = `📁 当前库未找到，可能在「<b>${_esc(sug.dir)}</b>」：<code>${_esc(sug.path)}</code>`;
            const goBtn = document.createElement('button');
            goBtn.type = 'button';
            goBtn.className = 'kb-qa-suggest-btn';
            goBtn.textContent = '前往该库提问';
```

**上游（开源侧）**
```js
            txt.innerHTML = _tr('kb.workbench.qa_lib_missing', '{icon} 当前库未找到，可能在「<b>{dir}</b>」：<code>{path}</code>', { icon: _icon('folder'), dir: _esc(sug.dir), path: _esc(sug.path) });
            const goBtn = _elementFromHtml(_uiButton({
              label: _tr('kb.workbench.qa_go_library', '前往该库提问'),
              role: 'primary',
              size: 'sm',
              iconEnd: 'arrow-right',
// … 省略 2 行
```


## 冲突 59  (第 5841 行起)
   我方 0 行 [中性]
   上游 43 行 [功能] {功能:IPC}

**我方（企业侧）**
```js
```

**上游（开源侧）**
```js
  /**
   * 排版类文件按"保排版"方式打开（PDF 走 PDFium、Office 走排版化 HTML），
   * 并把引用定位（页码）带过去。返回 false = 这次没打开。
   *
   * 单独抽出来是因为它是**对外桥**：`anchored-source-view` 在把文件丢进
   * 纯文本阅读器之前会先调它（见 `window.__openKbRichFile`）。渲染进程的
// … 省略 37 行
```


## 冲突 60  (第 5948 行起)
   我方 12 行 [中性]
   上游 12 行 [中性]

**我方（企业侧）**
```js
        <button type="button" class="kb-wb-side-expand" id="kb-wb-side-expand" title="${_esc(_t('kb.workbench.expand_panel', '展开知识库列表'))}" aria-label="${_esc(_t('kb.workbench.expand_panel', '展开知识库列表'))}" hidden>${_icon('chevron-right')}</button>
        <aside class="kb-wb-side">
          <div class="kb-wb-side-head">
            <h2>${_esc(_t('kb.workbench.list', '知识库列表'))}</h2>
            <div class="kb-wb-side-actions">
              ${_iconButtonHtml({ label: _t('kb.workbench.collapse_panel', '收起或展开知识库面板'), icon: 'panel-list', className: 'kb-wb-icon-btn', attrs: { id: 'kb-wb-side-collapse' } })}
// … 省略 6 行
```

**上游（开源侧）**
```js
        ${_uiIconButton({ label: _tr('kb.workbench.side_expand', '展开知识库列表'), icon: 'chevron-right', className: 'kb-wb-side-expand', attrs: { id: 'kb-wb-side-expand', hidden: true, 'data-wb-label': 'kb.workbench.side_expand' } })}
        <aside class="kb-wb-side">
          <div class="kb-wb-side-head">
            <h2 data-wb-text="kb.workbench.side_title"></h2>
            <div class="kb-wb-side-actions">
              ${_uiIconButton({ label: _tr('kb.workbench.side_collapse', '收起知识库列表'), icon: 'panel-list', className: 'kb-wb-icon-btn', attrs: { id: 'kb-wb-side-collapse', 'data-wb-label': 'kb.workbench.side_collapse' } })}
// … 省略 6 行
```


## 冲突 61  (第 5984 行起)
   我方 12 行 [中性]
   上游 21 行 [中性]

**我方（企业侧）**
```js
                <div class="kb-wb-lib-name" id="kb-wb-lib-name">${_esc(_t('kb.workbench.library', '知识库'))}</div>
                <div class="kb-wb-lib-owner" id="kb-wb-lib-owner"><span class="kb-wb-owner-avatar" id="kb-wb-owner-avatar">${_esc(_t('kb.workbench.me', '我'))}</span><span class="kb-wb-owner-name" id="kb-wb-owner-name">${_esc(_t('kb.workbench.me', '我'))}</span></div>
                <div class="kb-wb-lib-desc" id="kb-wb-lib-desc">${_esc(_t('kb.workbench.description_empty', '添加知识库描述'))}</div>
                <div class="kb-wb-lib-sub">
                  <span class="kb-wb-tag" id="kb-wb-lib-tag">${_esc(_t('kb.workbench.personal_library', '个人知识库'))}</span>
                  <span class="kb-wb-members" id="kb-wb-members">${_esc(_t('kb.workbench.one_member', '1 位成员'))}</span>
// … 省略 6 行
```

**上游（开源侧）**
```js
                <div class="kb-wb-lib-name" id="kb-wb-lib-name">${_esc(_tr('kb.workbench.untitled_lib', '知识库'))}</div>
                <div class="kb-wb-lib-owner" id="kb-wb-lib-owner"><span class="kb-wb-owner-avatar" id="kb-wb-owner-avatar">${_esc(_tr('kb.workbench.me', '我'))}</span><span class="kb-wb-owner-name" id="kb-wb-owner-name">我</span></div>
                <div class="kb-wb-lib-desc" id="kb-wb-lib-desc">${_esc(_tr('kb.workbench.lib_desc_placeholder', '快来填写描述吧~'))}</div>
                <div class="kb-wb-lib-sub">
                  <span class="kb-wb-tag" id="kb-wb-lib-tag">${_esc(_tr('kb.workbench.group_personal', '个人知识库'))}</span>
                  <span class="kb-wb-members" id="kb-wb-members">${_esc(_tr('kb.workbench.members_joined', '1 加入'))}</span>
// … 省略 15 行
```


## 冲突 62  (第 6029 行起)
   我方 5 行 [中性]
   上游 5 行 [中性]

**我方（企业侧）**
```js
              <div class="kb-wb-content-title"><span class="kb-wb-content-label">${_esc(_t('kb.workbench.content', '内容'))}</span> (<span id="kb-wb-count">0</span>)</div>
              <input id="kb-wb-search-input" placeholder="${_esc(_t('kb.workbench.search_documents', '搜索文档…'))}" autocomplete="off">
              <div class="kb-wb-tools">
                <div class="kb-wb-sort">
                  ${_iconButtonHtml({ label: _t('kb.workbench.sort', '排序'), icon: 'filter', className: 'kb-wb-icon-btn', attrs: { id: 'kb-wb-sort' } })}
```

**上游（开源侧）**
```js
              <div class="kb-wb-content-title"><span data-wb-text="kb.workbench.content"></span>(<span id="kb-wb-count">0</span>)</div>
              ${_uiInput({ id: 'kb-wb-search-input', type: 'search', placeholder: _tr('kb.workbench.search_docs_placeholder', '搜索文档…'), attrs: { 'data-wb-placeholder': 'kb.workbench.search_docs_placeholder', autocomplete: 'off' } })}
              <div class="kb-wb-tools">
                <div class="kb-wb-sort">
                  ${_uiIconButton({ label: _tr('kb.workbench.sort', '排序'), icon: 'list', className: 'kb-wb-icon-btn', attrs: { id: 'kb-wb-sort', 'data-wb-label': 'kb.workbench.sort' } })}
```


## 冲突 63  (第 6049 行起)
   我方 17 行 [中性]
   上游 17 行 [中性]

**我方（企业侧）**
```js
                ${_iconButtonHtml({ label: _t('kb.workbench.refresh', '重置排序并刷新'), icon: 'refresh', className: 'kb-wb-icon-btn', attrs: { id: 'kb-wb-refresh' } })}
                <div class="kb-wb-import-wrap">
                  ${_iconButtonHtml({ label: _t('kb.workbench.import', '导入内容'), icon: 'plus', className: 'kb-wb-icon-btn', attrs: { id: 'kb-wb-import' } })}
                  <div class="kb-wb-import-menu" id="kb-wb-import-menu" hidden>
                    <div class="kb-wb-import-item" data-imp="file">📄 本地文件</div>
                    <div class="kb-wb-import-item" data-imp="dir">📁 本地文件夹</div>
// … 省略 11 行
```

**上游（开源侧）**
```js
                ${_uiIconButton({ label: _tr('kb.workbench.reset_sort', '重置排序并刷新'), icon: 'refresh', className: 'kb-wb-icon-btn', attrs: { id: 'kb-wb-refresh', 'data-wb-label': 'kb.workbench.reset_sort' } })}
                <div class="kb-wb-import-wrap">
                  ${_uiIconButton({ label: _tr('kb.workbench.import', '导入内容'), icon: 'upload', className: 'kb-wb-icon-btn', attrs: { id: 'kb-wb-import', 'data-wb-label': 'kb.workbench.import' } })}
                  <div class="kb-wb-import-menu" id="kb-wb-import-menu" hidden>
                    <div class="kb-wb-import-item" data-imp="file">${_icon('file', 'kb-wb-import-icon')}<span data-wb-text="kb.workbench.import_file"></span></div>
                    <div class="kb-wb-import-item" data-imp="dir">${_icon('folder', 'kb-wb-import-icon')}<span data-wb-text="kb.workbench.import_dir"></span></div>
// … 省略 11 行
```


## 冲突 64  (第 6094 行起)
   我方 14 行 [中性]
   上游 18 行 [中性]

**我方（企业侧）**
```js
        <div class="kb-wb-divider" data-wb-divider="2" title="拖动调整宽度"></div>
        <section class="kb-wb-right">
          <div class="kb-wb-right-head"><span class="kb-wb-chip">${_icon('book-open')}<span id="kb-wb-right-lib">—</span></span><span class="kb-wb-local"><span class="kb-wb-dot"></span><span class="kb-wb-local-copy">${_esc(_t('kb.workbench.local_private', '本地推理 · 资料不上云'))}</span></span></div>
          <div class="kb-wb-right-body" id="kb-wb-right">
            <div class="kb-wb-right-card" id="kb-wb-analysis-card">
              <div class="kb-wb-right-card-title">
// … 省略 8 行
```

**上游（开源侧）**
```js
        <div class="kb-wb-divider" data-wb-divider="2" data-wb-title="kb.workbench.divider_drag"></div>
        <section class="kb-wb-right" id="kb-wb-right-panel">
          <div class="kb-wb-right-head"><span class="kb-wb-chip">${_icon('book-open', 'kb-wb-chip-icon')}<span id="kb-wb-right-lib">—</span></span><span class="kb-wb-local"><span class="kb-wb-dot"></span><span data-wb-text="kb.workbench.right_local"></span></span>${_uiIconButton({
            label: _tr('kb.workbench.close_ai_panel', '关闭 AI 解析与问答'),
            icon: 'x',
            className: 'kb-wb-right-collapse',
// … 省略 12 行
```


## 冲突 65  (第 6134 行起)
   我方 3 行 [中性]
   上游 3 行 [中性]

**我方（企业侧）**
```js
                  ${_iconButtonHtml({ label: _t('kb.workbench.new_chat', '新建对话'), icon: 'plus', className: 'kb-qa-session-btn', attrs: { id: 'kb-qa-popout' } })}
                  ${_iconButtonHtml({ label: _t('kb.workbench.chat_history', '会话历史'), icon: 'clock', className: 'kb-qa-session-btn', attrs: { id: 'kb-qa-history' } })}
                  ${_iconButtonHtml({ label: _t('kb.workbench.clear_chat', '清空当前对话'), icon: 'x', className: 'kb-qa-session-btn', attrs: { id: 'kb-qa-clear' } })}
```

**上游（开源侧）**
```js
                  ${_uiIconButton({ label: _tr('kb.workbench.qa_new_session', '新建对话'), icon: 'plus', className: 'kb-qa-session-btn', attrs: { id: 'kb-qa-popout', 'data-wb-label': 'kb.workbench.qa_new_session' } })}
                  ${_uiIconButton({ label: _tr('kb.workbench.qa_history', '会话历史'), icon: 'history', className: 'kb-qa-session-btn', attrs: { id: 'kb-qa-history', 'data-wb-label': 'kb.workbench.qa_history' } })}
                  ${_uiIconButton({ label: _tr('kb.workbench.qa_clear', '清空当前对话'), icon: 'x', className: 'kb-qa-session-btn', attrs: { id: 'kb-qa-clear', 'data-wb-label': 'kb.workbench.qa_clear' } })}
```


## 冲突 66  (第 6152 行起)
   我方 8 行 [中性]
   上游 8 行 [中性]

**我方（企业侧）**
```js
              <button type="button" class="kb-qa-model-chip" id="kb-qa-tools" title="${_esc(_t('kb.workbench.qa_model', '问答模型'))}">
                <span class="kb-qa-model-chip-ico">${_icon('brain-circuit')}</span>
                <span class="kb-qa-model-chip-name" id="kb-qa-model-name">${_esc(_t('kb.workbench.default_model', '默认模型'))}</span>
                <span class="kb-qa-model-chip-caret">${_svg('chevron-down')}</span>
              </button>
              <textarea class="kb-qa-input" id="kb-qa-input" rows="1" placeholder="${_esc(_t('kb.workbench.qa_placeholder', '基于知识库提问'))}"></textarea>
// … 省略 2 行
```

**上游（开源侧）**
```js
              <button type="button" class="kb-qa-model-chip" id="kb-qa-tools" data-wb-title="kb.workbench.qa_pick_model" title="">
                ${_icon('brain-circuit', 'kb-qa-model-chip-ico')}
                <span class="kb-qa-model-chip-name" id="kb-qa-model-name">${_esc(_tr('kb.workbench.qa_default_model', '默认模型'))}</span>
                <span class="kb-qa-model-chip-caret">${_svg('chevron-down')}</span>
              </button>
              ${_uiTextarea({ id: 'kb-qa-input', className: 'kb-qa-input', placeholder: _tr('kb.workbench.qa_placeholder', '基于知识库提问'), attrs: { rows: 1, 'data-wb-placeholder': 'kb.workbench.qa_placeholder' } })}
// … 省略 2 行
```


## 冲突 67  (第 6178 行起)
   我方 3 行 [中性]
   上游 3 行 [中性]

**我方（企业侧）**
```js
              ${_iconButtonHtml({ label: _t('kb.workbench.send', '发送'), icon: 'send', variant: 'accent', className: 'kb-qa-send', disabled: true, attrs: { id: 'kb-qa-send' } })}
            </div>
            <div class="kb-qa-note" id="kb-qa-note">${_esc(_t('kb.workbench.ai_note', '内容由 AI 生成，仅供参考'))}</div>
```

**上游（开源侧）**
```js
              ${_uiIconButton({ label: _tr('kb.workbench.qa_send', '发送'), icon: 'send', className: 'kb-qa-send', disabled: true, attrs: { id: 'kb-qa-send', 'data-wb-label': 'kb.workbench.qa_send' } })}
            </div>
            <div class="kb-qa-note" data-wb-text="kb.workbench.qa_note"></div>
```


## 冲突 68  (第 6191 行起)
   我方 9 行 [功能] {功能:状态流}
   上游 9 行 [功能] {功能:状态流}

**我方（企业侧）**
```js
        <div class="kb-mm-dlg" id="kb-mm-dlg" aria-describedby="kb-mm-overlay-stage-hint">
        <div class="kb-mm-titlebar" id="kb-mm-titlebar">
          <span class="kb-mm-titlebar-ico">${_icon('brain-circuit')}</span>
          <input class="kb-mm-title-input" id="kb-mm-title-input" value="${_esc(_t('kb.workbench.mindmap_preview', '脑图预览'))}" title="${_esc(_t('kb.workbench.rename_mindmap', '双击修改标题'))}" aria-label="${_esc(_t('kb.workbench.mindmap_title', '脑图标题'))}" spellcheck="false" />
          <span class="kb-mm-save-state" id="kb-mm-save-state"></span>
          <div class="kb-mm-titlebar-actions">
// … 省略 3 行
```

**上游（开源侧）**
```js
        <div class="kb-mm-dlg" id="kb-mm-dlg" role="dialog" aria-modal="true" data-wb-aria="kb.workbench.mm_title" aria-label="">
        <div class="kb-mm-titlebar" id="kb-mm-titlebar">
          <span class="kb-mm-titlebar-ico">${_icon('brain-circuit', 'kb-mm-titlebar-icon')}</span>
          ${_uiInput({ id: 'kb-mm-title-input', className: 'kb-mm-title-input', value: _tr('kb.workbench.mm_title', '脑图预览'), attrs: { title: _tr('kb.workbench.mm_title_dblclick', '双击修改标题'), spellcheck: 'false' } })}
          <span class="kb-mm-save-state" id="kb-mm-save-state"></span>
          <div class="kb-mm-titlebar-actions">
// … 省略 3 行
```


## 冲突 69  (第 6216 行起)
   我方 17 行 [中性]
   上游 17 行 [中性]

**我方（企业侧）**
```js
            ${_buttonHtml({ label: _t('kb.workbench.undo', '撤销'), role: 'ghost', size: 'sm', icon: 'undo', attrs: { id: 'kb-mm-undo' } })}
            ${_buttonHtml({ label: _t('kb.workbench.refresh_mindmap', '刷新'), role: 'ghost', size: 'sm', icon: 'refresh', attrs: { id: 'kb-mm-refresh', title: _t('kb.workbench.regenerate_mindmap', '重新生成脑图') } })}
          </div>
          <div class="kb-mm-tb-group">
            ${_buttonHtml({ label: _t('kb.workbench.save', '保存'), role: 'ghost', size: 'sm', icon: 'archive', attrs: { id: 'kb-mm-save', title: _t('kb.workbench.save_to_library', '保存到知识库') } })}
            <div class="kb-mm-open">
// … 省略 11 行
```

**上游（开源侧）**
```js
            ${_uiButton({ label: _tr('kb.workbench.mm_undo', '撤销'), role: 'ghost', size: 'sm', icon: 'undo', className: 'kb-mm-tool-btn', attrs: { id: 'kb-mm-undo', title: _tr('kb.workbench.mm_undo', '撤销'), 'data-wb-label': 'kb.workbench.mm_undo', 'data-wb-title': 'kb.workbench.mm_undo' } })}
            ${_uiButton({ label: _tr('kb.workbench.refresh', '刷新'), role: 'ghost', size: 'sm', icon: 'refresh', className: 'kb-mm-tool-btn', attrs: { id: 'kb-mm-refresh', title: _tr('kb.workbench.mm_refresh_tip', '重新生成脑图'), 'data-wb-label': 'kb.workbench.refresh', 'data-wb-title': 'kb.workbench.mm_refresh_tip' } })}
          </div>
          <div class="kb-mm-tb-group">
            ${_uiButton({ label: _tr('kb.workbench.save_short', '保存'), role: 'ghost', size: 'sm', icon: 'archive', className: 'kb-mm-tool-btn', attrs: { id: 'kb-mm-save', title: _tr('kb.workbench.mm_save_tip', '保存到知识库'), 'data-wb-label': 'kb.workbench.save_short', 'data-wb-title': 'kb.workbench.mm_save_tip' } })}
            <div class="kb-mm-open">
// … 省略 11 行
```


## 冲突 70  (第 6258 行起)
   我方 23 行 [中性]
   上游 23 行 [中性]

**我方（企业侧）**
```js
              ${_buttonHtml({ label: _t('kb.workbench.layout', '布局'), role: 'ghost', size: 'sm', icon: 'layout-grid', attrs: { id: 'kb-mm-layout-btn', title: _t('kb.workbench.toggle_layout', '切换布局') } })}
              <div class="kb-mm-layout-menu" id="kb-mm-layout-menu" hidden>
                <div class="kb-mm-layout-item" data-mode="mind">${_icon('brain-circuit')}<span>${_esc(_t('kb.workbench.layout_mind', '思维导图（双向放射）'))}</span></div>
                <div class="kb-mm-layout-item" data-mode="org">${_icon('git-branch')}<span>${_esc(_t('kb.workbench.layout_org', '组织结构图（单向）'))}</span></div>
              </div>
            </div>
// … 省略 17 行
```

**上游（开源侧）**
```js
              ${_uiButton({ label: _tr('kb.workbench.mm_layout', '布局'), role: 'ghost', size: 'sm', icon: 'layout-grid', iconEnd: 'chevron-down', className: 'kb-mm-tool-btn', attrs: { id: 'kb-mm-layout-btn', title: _tr('kb.workbench.mm_layout_tip', '切换布局') } })}
              <div class="kb-mm-layout-menu" id="kb-mm-layout-menu" hidden>
                <div class="kb-mm-layout-item" data-mode="mind">${_icon('brain-circuit', 'kb-mm-menu-icon')}<span data-wb-text="kb.workbench.mm_layout_mind"></span></div>
                <div class="kb-mm-layout-item" data-mode="org">${_icon('layout-grid', 'kb-mm-menu-icon')}<span data-wb-text="kb.workbench.mm_layout_org"></span></div>
              </div>
            </div>
// … 省略 17 行
```


## 冲突 71  (第 6313 行起)
   我方 1 行 [中性]
   上游 1 行 [中性]

**我方（企业侧）**
```js
          <div class="kb-mm-overlay-stage-hint" id="kb-mm-overlay-stage-hint">${_esc(_t('kb.workbench.mindmap_hint', '滚轮缩放 · 拖拽平移 · 一级分支点击聚焦 · −/+ 折叠 · 双击重命名'))}</div>
```

**上游（开源侧）**
```js
          <div class="kb-mm-overlay-stage-hint" data-wb-text="kb.workbench.mm_stage_hint"></div>
```


## 冲突 72  (第 6377 行起)
   我方 0 行 [中性]
   上游 49 行 [UI] {UI:类选择器, UI:classList}

**我方（企业侧）**
```js
```

**上游（开源侧）**
```js
    // 受限宽度下将右侧 AI 区变为按需抽屉，避免三栏互相挤压成竖排文字。
    const wb = document.querySelector('.kb-wb');
    const rightPanel = document.getElementById('kb-wb-right-panel');
    const rightExpandBtn = document.getElementById('kb-wb-right-expand');
    const rightCollapseBtn = document.getElementById('kb-wb-right-collapse');
    const rightPanelMedia = typeof window.matchMedia === 'function'
// … 省略 43 行
```


## 冲突 73  (第 6696 行起)
   我方 1 行 [中性]
   上游 5 行 [中性]

**我方（企业侧）**
```js
      _closeMindPreview('close-button');
```

**上游（开源侧）**
```js
      if (_mmModalController) _mmModalController.close('action');
      else {
        document.getElementById('kb-mm-overlay').hidden = true;
        _mmRestoreThumbs();
      }
```


## 冲突 74  (第 6753 行起)
   我方 9 行 [UI] {UI:类选择器}
   上游 0 行 [中性]

**我方（企业侧）**
```js
    document.addEventListener('keydown', (e) => {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === 'Escape') {
        const ov = document.getElementById('kb-mm-overlay');
        if (ov && !ov.hidden) _closeMindPreview('escape');
        const d = document.querySelector('.kb-import-dlg-overlay');
// … 省略 3 行
```

**上游（开源侧）**
```js
```


## 冲突 75  (第 6904 行起)
   我方 4 行 [中性]
   上游 9 行 [中性]

**我方（企业侧）**
```js
    head.append(el('span', 'kb-qa-model-pop-title', '选择问答模型'), el('span', 'kb-qa-model-pop-hint', '已配置模型，点击即切换'));
    const closeBtn = el('button', 'kb-qa-model-pop-close', '✕');
    closeBtn.type = 'button';
    closeBtn.title = '关闭（Esc）';
```

**上游（开源侧）**
```js
    const title = el('span', 'kb-qa-model-pop-title', _tr('kb.workbench.qa_pick_model', '选择问答模型'));
    title.id = 'kb-qa-model-pop-title';
    head.append(title, el('span', 'kb-qa-model-pop-hint', _tr('kb.workbench.qa_model_hint', '已配置模型，点击即切换')));
    const closeBtn = _elementFromHtml(_uiIconButton({
      label: _tr('kb.workbench.qa_model_close', '关闭模型选择弹窗'),
      icon: 'x',
// … 省略 3 行
```


## 冲突 76  (第 6960 行起)
   我方 7 行 [中性]
   上游 6 行 [中性]

**我方（企业侧）**
```js
    const manageBtn = el('button', 'kb-qa-model-pop-manage', '去设置管理模型');
    manageBtn.type = 'button';
    manageBtn.addEventListener('click', () => {
      overlay.remove();
      if (typeof window.setView === 'function') window.setView('settings');
      if (typeof window.activateSettingsTab === 'function') window.activateSettingsTab('credentials');
// … 省略 1 行
```

**上游（开源侧）**
```js
    const manageBtn = _elementFromHtml(_uiButton({
      label: _tr('kb.workbench.qa_model_manage', '去设置管理模型'),
      role: 'secondary',
      icon: 'settings',
      className: 'kb-qa-model-pop-manage',
    }));
```


## 冲突 77  (第 6984 行起)
   我方 1 行 [中性]
   上游 33 行 [UI] {UI:类选择器}

**我方（企业侧）**
```js
    overlay.focus();
```

**上游（开源侧）**
```js
    const modal = _mountKbDialog({
      overlay,
      dialogSelector: '.kb-qa-model-pop',
      initialFocus: '[aria-pressed="true"]',
      fallbackFocus: '#kb-qa-tools',
      trigger,
// … 省略 27 行
```


## 冲突 78  (第 7260 行起)
   我方 4 行 [中性]
   上游 7 行 [中性]

**我方（企业侧）**
```js
      { key: 'rename', label: '✏️ 重命名', fn: () => _kbRename(path, isDir) },
      { key: 'delete', label: '🗑 删除到回收站', danger: true, fn: () => _kbDelete(path) },
    ];
    if (!isDir) items.push({ key: 'reveal', label: '📂 在文件夹中显示', fn: () => _kbReveal(path) });
```

**上游（开源侧）**
```js
      { key: 'rename', label: _tr('kb.workbench.menu_rename', '重命名'), icon: 'edit-pencil', fn: () => _kbRename(path, isDir) },
      { key: 'delete', label: _tr('kb.workbench.delete_to_trash', '删除到回收站'), icon: 'trash-2', danger: true, fn: () => _kbDelete(path) },
    ];
    if (!isDir) items.push({ key: 'reveal', label: _tr('kb.workbench.reveal_file', '在文件夹中显示'), icon: 'folder-open', fn: () => _kbReveal(path) });
    // 文档级脑图：以这一份文档为中心主题（整库脑图是按目录聚合的，多文档库里
    // 根主题会变成"这个库是什么"，一级分支按文件分而不是按内容主题分）。
// … 省略 1 行
```


## 冲突 79  (第 7286 行起)
   我方 3 行 [中性]
   上游 3 行 [中性]

**我方（企业侧）**
```js
      { key: 'rename', label: '✏️ 重命名', fn: () => _kbRenameSpace(spaceId) },
      { key: 'members', label: '👥 知识库成员', fn: () => _kbMembersDialog(spaceId) },
      { key: 'delete', label: '🗑 删除共享知识库', danger: true, fn: () => _kbDeleteSpace(spaceId) },
```

**上游（开源侧）**
```js
      { key: 'rename', label: _tr('kb.workbench.menu_rename', '重命名'), icon: 'edit-pencil', fn: () => _kbRenameSpace(spaceId) },
      { key: 'members', label: _tr('kb.workbench.members_title', '知识库成员'), icon: 'users', fn: () => _kbMembersDialog(spaceId) },
      { key: 'delete', label: _tr('kb.workbench.delete_shared_lib', '删除共享知识库'), icon: 'trash-2', danger: true, fn: () => _kbDeleteSpace(spaceId) },
```


## 冲突 80  (第 7304 行起)
   我方 13 行 [中性]
   上游 14 行 [中性]

**我方（企业侧）**
```js
      <div class="kb-ctx-menu-item" data-fm="pin">📌 置顶</div>
      <div class="kb-ctx-menu-item" data-fm="tag">🏷 编辑标签</div>
      <div class="kb-ctx-menu-item" data-fm="rename">✏️ 重命名</div>
      <div class="kb-ctx-menu-item kb-has-sub" data-fm="perm">🔐 成员权限 <span class="kb-import-caret">▸</span>
        <div class="kb-ctx-sub" data-sub="perm">
          <div class="kb-ctx-menu-item is-selected" data-perm="view_export">✓ 内容可查看和导出</div>
// … 省略 7 行
```

**上游（开源侧）**
```js
      ${_uiButton({ label: _tr('kb.workbench.menu_mindmap', '生成脑图（本文档）'), icon: 'brain-circuit', role: 'ghost', size: 'sm', className: 'kb-ctx-menu-item', attrs: { 'data-fm': 'mind' } })}
      ${_uiButton({ label: _tr('kb.workbench.menu_pin', '置顶'), icon: 'pin', role: 'ghost', size: 'sm', className: 'kb-ctx-menu-item', attrs: { 'data-fm': 'pin' } })}
      ${_uiButton({ label: _tr('kb.workbench.menu_tag', '编辑标签'), icon: 'tag', role: 'ghost', size: 'sm', className: 'kb-ctx-menu-item', attrs: { 'data-fm': 'tag' } })}
      ${_uiButton({ label: _tr('kb.workbench.menu_rename', '重命名'), icon: 'edit-pencil', role: 'ghost', size: 'sm', className: 'kb-ctx-menu-item', attrs: { 'data-fm': 'rename' } })}
      <div class="kb-ctx-menu-item kb-has-sub" data-fm="perm" role="button" tabindex="0">${_icon('lock', 'kb-ctx-menu-icon')}<span>${_esc(_tr('kb.workbench.menu_perm', '成员权限'))}</span><span class="kb-import-caret">${_icon('chevron-right', 'kb-ctx-menu-caret-icon')}</span>
        <div class="kb-ctx-sub" data-sub="perm">
// … 省略 8 行
```


## 冲突 81  (第 7430 行起)
   我方 9 行 [中性]
   上游 15 行 [中性]

**我方（企业侧）**
```js
      <div class="kb-members-dlg">
        ${_iconButtonHtml({ label: _t('kb.workbench.close', '关闭'), icon: 'x', className: 'kb-members-close' })}
        <div class="kb-members-title" id="kb-members-title">${_icon('users')}<span>${_esc(_t('kb.workbench.library_members', '知识库成员'))}</span></div>
        <div class="kb-members-search"><input type="text" placeholder="${_esc(_t('kb.workbench.search_members', '搜索知识库成员'))}" aria-label="${_esc(_t('kb.workbench.search_members', '搜索知识库成员'))}" autocomplete="off" /></div>
        <div class="kb-members-list">
          <div class="kb-members-item">
// … 省略 3 行
```

**上游（开源侧）**
```js
      <section class="ui-modal ui-modal--sm kb-members-dlg" role="dialog" aria-modal="true" aria-labelledby="kb-members-title">
        <header class="ui-modal__header">
          <div class="ui-modal__heading">
            <h2 class="ui-modal__title kb-members-title" id="kb-members-title">${_icon('users', 'kb-members-title-icon')}<span>${_esc(_tr('kb.workbench.members_title', '知识库成员'))}</span></h2>
          </div>
          ${_uiIconButton({ label: _tr('kb.workbench.members_close', '关闭知识库成员弹窗'), icon: 'x', className: 'kb-members-close' })}
// … 省略 9 行
```


## 冲突 82  (第 7484 行起)
   我方 0 行 [中性]
   上游 51 行 [UI] {UI:DOM 写入, UI:类选择器}

**我方（企业侧）**
```js
```

**上游（开源侧）**
```js
  /**
   * 共享知识库的「分享」目前是**待开发**：飞书分享 / 复制链接 / 知识码 / 权限设置
   * 这一整套还没有真正落地，弹出来只会让人以为能用。按仓库既有约定
   * （kb-eco 的「发现待开发」）显示为待开发：按钮挂 chip，点击给一句说明。
   *
   * 真要做时把这里翻成 true 即可——下面 `_kbShareDialogOpen` 的实现原样保留。
// … 省略 45 行
```


## 冲突 83  (第 7552 行起)
   我方 33 行 [UI] {UI:类选择器}
   上游 55 行 [UI] {UI:类选择器}

**我方（企业侧）**
```js
      <div class="kb-share-pop">
        ${_iconButtonHtml({ label: _t('kb.workbench.close', '关闭'), icon: 'x', className: 'kb-share-pop-close' })}
        <div class="kb-share-pop-head" id="kb-share-pop-title"><span class="kb-share-pop-head-ico">${_icon('users')}</span>${_esc(_t('kb.workbench.share_title', '分享'))}</div>
        <div class="kb-share-pop-card">
          <span class="kb-share-pop-folder">${_icon('folder')}</span>
          <div class="kb-share-pop-card-meta">
// … 省略 27 行
```

**上游（开源侧）**
```js
      <section class="ui-modal ui-modal--sm kb-share-pop" role="dialog" aria-modal="true" aria-labelledby="kb-share-pop-title">
        <header class="ui-modal__header">
          <div class="ui-modal__heading">
            <h2 class="ui-modal__title kb-share-pop-head" id="kb-share-pop-title"><span class="kb-share-pop-head-ico">${_icon('share-2', 'kb-share-pop-head-icon')}</span>${_esc(_tr('kb.workbench.share_title', '分享'))}</h2>
          </div>
          ${_uiIconButton({ label: _tr('kb.workbench.share_close', '关闭分享弹窗'), icon: 'x', className: 'kb-share-pop-close' })}
// … 省略 49 行
```


## 冲突 84  (第 7673 行起)
   我方 1 行 [中性]
   上游 3 行 [UI] {UI:classList}

**我方（企业侧）**
```js
      _setButtonLabel(btn, _t('kb.workbench.sharing', '分享中…'));
```

**上游（开源侧）**
```js
      btn.classList.add('is-loading');
      btn.setAttribute('aria-busy', 'true');
      _setUiButtonPresentation(btn, _tr('kb.workbench.share_busy', '分享中…'));
```


## 冲突 85  (第 7692 行起)
   我方 1 行 [中性]
   上游 3 行 [UI] {UI:classList}

**我方（企业侧）**
```js
        _setButtonLabel(btn, _t('kb.workbench.copy_link', '复制链接'));
```

**上游（开源侧）**
```js
        btn.classList.remove('is-loading');
        btn.removeAttribute('aria-busy');
        _setUiButtonPresentation(btn, _tr('kb.workbench.share_copy_link', '复制链接'), 'link');
```


## 冲突 86  (第 7761 行起)
   我方 1 行 [UI] {UI:DOM 写入}
   上游 1 行 [UI] {UI:DOM 写入}

**我方（企业侧）**
```js
      hint.innerHTML = '未发布 <span class="kb-share-pop-row-arrow">›</span>';
```

**上游（开源侧）**
```js
      hint.innerHTML = `${_esc(_tr('kb.workbench.share_status_unpublished', '未发布'))} <span class="kb-share-pop-row-arrow">${_icon('chevron-right', 'kb-share-row-arrow-icon')}</span>`;
```


## 冲突 87  (第 7796 行起)
   我方 17 行 [中性]
   上游 23 行 [中性]

**我方（企业侧）**
```js
      <div class="kb-share-pop kb-share-pop--config">
        ${_iconButtonHtml({ label: _t('kb.workbench.close', '关闭'), icon: 'x', className: 'kb-share-pop-close' })}
        <div class="kb-share-pop-head" id="kb-cogseed-config-title"><span class="kb-share-pop-head-ico">${_icon('link')}</span>${_esc(_t('kb.workbench.cogseed_share_config', '配置 CogSeed 共享服务'))}</div>
        <div class="kb-share-config-tip">${_esc(_t('kb.workbench.cogseed_share_config_hint', '发布到 CogSeed 问答需要共享服务地址与 API Key。'))}</div>
        <div class="kb-share-config-field">
          <label class="kb-share-config-label" for="kb-cogseed-baseurl">${_esc(_t('kb.workbench.service_url', '服务地址'))}</label>
// … 省略 11 行
```

**上游（开源侧）**
```js
      <section class="ui-modal ui-modal--sm kb-share-pop kb-share-pop--config" role="dialog" aria-modal="true" aria-labelledby="kb-cogseed-config-title">
        <header class="ui-modal__header">
          <div class="ui-modal__heading">
            <h2 class="ui-modal__title kb-share-pop-head" id="kb-cogseed-config-title"><span class="kb-share-pop-head-ico">${_icon('link', 'kb-share-pop-head-icon')}</span>${_esc(_tr('kb.workbench.cogseed_config_title', '配置 CogSeed 共享服务'))}</h2>
          </div>
          ${_uiIconButton({ label: _tr('kb.workbench.cogseed_config_close', '关闭 CogSeed 共享服务配置弹窗'), icon: 'x', className: 'kb-share-pop-close' })}
// … 省略 17 行
```


## 冲突 88  (第 7854 行起)
   我方 4 行 [功能] {功能:IPC}
   上游 7 行 [混合] {UI:classList, 功能:IPC}

**我方（企业侧）**
```js
      try {
        const res = await window.cogseed.invoke('kb.share.cogseed.config.set', { baseUrl, apiKey });
        if (!res || res.ok !== true) throw new Error((res && res.error) || '保存失败');
        close('complete');
```

**上游（开源侧）**
```js
      btn.classList.add('is-loading');
      btn.setAttribute('aria-busy', 'true');
      _setUiButtonPresentation(btn, _tr('kb.workbench.cogseed_config_save', '保存并发布'));
      try {
        const res = await window.cogseed.invoke('kb.share.cogseed.config.set', { baseUrl, apiKey });
        if (!res || res.ok !== true) throw new Error((res && res.error) || _tr('kb.workbench.save_failed', '保存失败'));
// … 省略 1 行
```


## 冲突 89  (第 7893 行起)
   我方 31 行 [功能] {功能:状态流}
   上游 37 行 [功能] {功能:状态流}

**我方（企业侧）**
```js
      <div class="kb-share-pop kb-share-pop--manage">
        ${_iconButtonHtml({ label: _t('kb.workbench.close', '关闭'), icon: 'x', className: 'kb-share-pop-close' })}
        <div class="kb-share-pop-head" id="kb-cogseed-manage-title"><span class="kb-share-pop-head-ico">${_icon('users')}</span>${_esc(_t('kb.workbench.cogseed_share_manage', 'CogSeed 问答分享管理'))}</div>
        ${state ? `<div class="kb-share-manage-item">
          <div class="kb-share-manage-item-head">
            <span class="kb-share-manage-item-name">${_esc(state.spaceName)}</span>
// … 省略 25 行
```

**上游（开源侧）**
```js
      <section class="ui-modal ui-modal--sm kb-share-pop kb-share-pop--manage" role="dialog" aria-modal="true" aria-labelledby="kb-cogseed-manage-title">
        <header class="ui-modal__header">
          <div class="ui-modal__heading">
            <h2 class="ui-modal__title kb-share-pop-head" id="kb-cogseed-manage-title"><span class="kb-share-pop-head-ico">${_icon('share-2', 'kb-share-pop-head-icon')}</span>${_esc(_tr('kb.workbench.cogseed_manage_title', 'CogSeed 问答分享管理'))}</h2>
          </div>
          ${_uiIconButton({ label: _tr('kb.workbench.cogseed_manage_close', '关闭 CogSeed 问答分享管理弹窗'), icon: 'x', className: 'kb-share-pop-close' })}
// … 省略 31 行
```


## 冲突 90  (第 7979 行起)
   我方 2 行 [中性]
   上游 2 行 [中性]

**我方（企业侧）**
```js
          if (res && res.ok) { uiToast && uiToast('已撤销', { variant: 'success' }); close('revoke'); _kbShareDialogOpen(); }
          else uiToast && uiToast('撤销失败', { variant: 'error' });
```

**上游（开源侧）**
```js
          if (res && res.ok) { uiToast && uiToast(_tr('kb.workbench.cogseed_revoked', '已撤销'), { variant: 'success' }); modal.close('revoke', { restoreFocus: false }); _kbShareDialogOpen(); }
          else uiToast && uiToast(_tr('kb.workbench.share_revoke_failed', '撤销失败'), { variant: 'error' });
```


## 冲突 91  (第 7996 行起)
   我方 2 行 [中性]
   上游 2 行 [中性]

**我方（企业侧）**
```js
        if (res && res.ok) { uiToast && uiToast(verdict === 'approve' ? '已通过' : '已拒绝', { variant: 'success', timeoutMs: 1500 }); close('review'); _kbCogseedManageOpen(); }
        else { uiToast && uiToast('操作失败', { variant: 'error' }); memberBtn.disabled = false; }
```

**上游（开源侧）**
```js
        if (res && res.ok) { uiToast && uiToast(verdict === 'approve' ? _tr('kb.workbench.approved', '已通过') : _tr('kb.workbench.rejected', '已拒绝'), { variant: 'success', timeoutMs: 1500 }); modal.close('review', { restoreFocus: false }); _kbCogseedManageOpen(); }
        else { uiToast && uiToast(_tr('kb.workbench.action_failed', '操作失败'), { variant: 'error' }); memberBtn.disabled = false; }
```


## 冲突 92  (第 8015 行起)
   我方 2 行 [混合] {功能:状态流, UI:DOM 写入}
   上游 2 行 [混合] {功能:状态流, UI:DOM 写入}

**我方（企业侧）**
```js
      const accessText = { anyone: '互联网可读', tenant: '组织内可读', private: '已关闭' }[state.access] || state.access;
      hint.innerHTML = `${_esc(accessText)}<span class="kb-share-pop-status-dot"></span><span class="kb-share-pop-row-arrow">›</span>`;
```

**上游（开源侧）**
```js
      const accessText = { anyone: _tr('kb.workbench.access_anyone', '互联网可读'), tenant: _tr('kb.workbench.access_tenant', '组织内可读'), private: _tr('kb.workbench.access_private', '已关闭') }[state.access] || state.access;
      hint.innerHTML = `${_esc(accessText)}<span class="kb-share-pop-status-dot"></span><span class="kb-share-pop-row-arrow">${_icon('chevron-right', 'kb-share-row-arrow-icon')}</span>`;
```


## 冲突 93  (第 8077 行起)
   我方 18 行 [中性]
   上游 24 行 [中性]

**我方（企业侧）**
```js
      <div class="kb-share-pop kb-share-pop--config">
        ${_iconButtonHtml({ label: _t('kb.workbench.close', '关闭'), icon: 'x', className: 'kb-share-pop-close' })}
        <div class="kb-share-pop-head" id="kb-share-config-title"><span class="kb-share-pop-head-ico">${_icon('link')}</span>${_esc(_t('kb.workbench.feishu_share_config', '配置飞书分享'))}</div>
        <div class="kb-share-config-tip">分享到飞书需要一个飞书开放平台应用。到 <a href="https://open.feishu.cn/app" target="_blank" rel="noopener">open.feishu.cn/app</a> 创建企业自建应用后，在「凭证与基础信息」页复制 App ID 与 App Secret 填入：</div>
        <div class="kb-share-config-field">
          <label class="kb-share-config-label" for="kb-share-config-appid">App ID</label>
// … 省略 12 行
```

**上游（开源侧）**
```js
      <section class="ui-modal ui-modal--sm kb-share-pop kb-share-pop--config" role="dialog" aria-modal="true" aria-labelledby="kb-share-config-title">
        <header class="ui-modal__header">
          <div class="ui-modal__heading">
            <h2 class="ui-modal__title kb-share-pop-head" id="kb-share-config-title"><span class="kb-share-pop-head-ico">${_icon('link', 'kb-share-pop-head-icon')}</span>${_esc(_tr('kb.workbench.feishu_config_title', '配置飞书分享'))}</h2>
          </div>
          ${_uiIconButton({ label: _tr('kb.workbench.feishu_config_close', '关闭飞书分享配置弹窗'), icon: 'x', className: 'kb-share-pop-close' })}
// … 省略 18 行
```


## 冲突 94  (第 8139 行起)
   我方 3 行 [中性]
   上游 3 行 [中性]

**我方（企业侧）**
```js
        if (!res || res.ok !== true) throw new Error((res && res.error) || '保存失败');
        close('complete');
        if (typeof uiToast === 'function') uiToast('应用凭据已保存，正在发起授权…', { variant: 'info', timeoutMs: 2500 });
```

**上游（开源侧）**
```js
        if (!res || res.ok !== true) throw new Error((res && res.error) || _tr('kb.workbench.save_failed', '保存失败'));
        modal.close('submit', { restoreFocus: false });
        if (typeof uiToast === 'function') uiToast(_tr('kb.workbench.feishu_config_saved', '应用凭据已保存，正在发起授权…'), { variant: 'info', timeoutMs: 2500 });
```


## 冲突 95  (第 8169 行起)
   我方 12 行 [中性]
   上游 18 行 [中性]

**我方（企业侧）**
```js
      <div class="kb-share-pop kb-share-pop--qr">
        ${_iconButtonHtml({ label: _t('kb.workbench.close', '关闭'), icon: 'x', className: 'kb-share-pop-close' })}
        <div class="kb-share-pop-head" id="kb-share-qr-title"><span class="kb-share-pop-head-ico">${_icon('qr-code')}</span>${_esc(_t('kb.workbench.knowledge_code', '知识码'))}</div>
        <div class="kb-share-qr-body">
          <div class="kb-share-qr-img" id="kb-share-qr-img"></div>
          <div class="kb-share-qr-name">${_esc(name || _t('kb.workbench.shared_library', '共享知识库'))}</div>
// … 省略 6 行
```

**上游（开源侧）**
```js
      <section class="ui-modal ui-modal--sm kb-share-pop kb-share-pop--qr" role="dialog" aria-modal="true" aria-labelledby="kb-share-qr-title">
        <header class="ui-modal__header">
          <div class="ui-modal__heading">
            <h2 class="ui-modal__title kb-share-pop-head" id="kb-share-qr-title"><span class="kb-share-pop-head-ico">${_icon('qr-code', 'kb-share-pop-head-icon')}</span>${_esc(_tr('kb.workbench.qr_title', '知识码'))}</h2>
          </div>
          ${_uiIconButton({ label: _tr('kb.workbench.qr_close', '关闭知识码弹窗'), icon: 'x', className: 'kb-share-pop-close' })}
// … 省略 12 行
```


## 冲突 96  (第 8249 行起)
   我方 24 行 [中性]
   上游 34 行 [中性]

**我方（企业侧）**
```js
      <div class="kb-share-pop kb-share-pop--manage">
        ${_iconButtonHtml({ label: _t('kb.workbench.close', '关闭'), icon: 'x', className: 'kb-share-pop-close' })}
        <div class="kb-share-pop-head" id="kb-share-manage-title"><span class="kb-share-pop-head-ico">${_icon('users')}</span>${_esc(_t('kb.workbench.share_manage', '分享管理'))}</div>
        <div class="kb-share-manage-list" id="kb-share-manage-list">
          ${items.length === 0 ? '<div class="kb-share-manage-empty">还没有分享到飞书的知识库<br><span>打开知识库 → 分享 → 复制链接</span></div>' : ''}
          ${items.map((item, idx) => `
// … 省略 18 行
```

**上游（开源侧）**
```js
      <section class="ui-modal ui-modal--sm kb-share-pop kb-share-pop--manage" role="dialog" aria-modal="true" aria-labelledby="kb-share-manage-title">
        <header class="ui-modal__header">
          <div class="ui-modal__heading">
            <h2 class="ui-modal__title kb-share-pop-head" id="kb-share-manage-title"><span class="kb-share-pop-head-ico">${_icon('share-2', 'kb-share-pop-head-icon')}</span>${_esc(_tr('kb.workbench.share_manage_title', '分享管理'))}</h2>
          </div>
          ${_uiIconButton({ label: _tr('kb.workbench.share_manage_close', '关闭分享管理弹窗'), icon: 'x', className: 'kb-share-pop-close' })}
// … 省略 28 行
```


## 冲突 97  (第 8333 行起)
   我方 7 行 [功能] {功能:IPC}
   上游 8 行 [混合] {UI:classList, 功能:IPC}

**我方（企业侧）**
```js
        const label = btn.textContent;
        btn.textContent = '更新中…';
        try {
          const res = await window.cogseed.invoke('kb.share.update', { spaceId: item.spaceId });
          if (res && res.ok) {
            if (typeof uiToast === 'function') uiToast('内容已更新', { variant: 'success', timeoutMs: 1500 });
// … 省略 1 行
```

**上游（开源侧）**
```js
        btn.classList.add('is-loading');
        btn.setAttribute('aria-busy', 'true');
        _setUiButtonPresentation(btn, _tr('kb.workbench.share_updating', '更新中…'));
        try {
          const res = await window.cogseed.invoke('kb.share.update', { spaceId: item.spaceId });
          if (res && res.ok) {
// … 省略 2 行
```


## 冲突 98  (第 8355 行起)
   我方 1 行 [中性]
   上游 3 行 [UI] {UI:classList}

**我方（企业侧）**
```js
            btn.textContent = label;
```

**上游（开源侧）**
```js
            btn.classList.remove('is-loading');
            btn.removeAttribute('aria-busy');
            _setUiButtonPresentation(btn, _tr('kb.workbench.share_update', '更新内容'));
```


## 冲突 99  (第 8367 行起)
   我方 1 行 [中性]
   上游 3 行 [UI] {UI:classList}

**我方（企业侧）**
```js
          btn.textContent = label;
```

**上游（开源侧）**
```js
          btn.classList.remove('is-loading');
          btn.removeAttribute('aria-busy');
          _setUiButtonPresentation(btn, _tr('kb.workbench.share_update', '更新内容'));
```


## 冲突 100  (第 8384 行起)
   我方 2 行 [中性]
   上游 2 行 [中性]

**我方（企业侧）**
```js
            if (typeof uiToast === 'function') uiToast('已撤销分享', { variant: 'success', timeoutMs: 1500 });
            close('revoke');
```

**上游（开源侧）**
```js
            if (typeof uiToast === 'function') uiToast(_tr('kb.workbench.share_revoked', '已撤销分享'), { variant: 'success', timeoutMs: 1500 });
            modal.close('revoke', { restoreFocus: false });
```


## 冲突 101  (第 8433 行起)
   我方 41 行 [中性]
   上游 69 行 [中性]

**我方（企业侧）**
```js
      <div class="kb-share-pop kb-share-pop--perm">
        ${_iconButtonHtml({ label: _t('kb.workbench.close', '关闭'), icon: 'x', className: 'kb-share-pop-close' })}
        <div class="kb-share-pop-head" id="kb-perm-title"><span class="kb-share-pop-head-ico">${_icon('lock')}</span>${_esc(_t('kb.workbench.permission_settings', '权限设置'))}</div>
        <div class="kb-share-perm-block">
          <div class="kb-share-perm-row">
            <div class="kb-share-perm-texts">
// … 省略 35 行
```

**上游（开源侧）**
```js
      <section class="ui-modal ui-modal--sm kb-share-pop kb-share-pop--perm" role="dialog" aria-modal="true" aria-labelledby="kb-perm-title">
        <header class="ui-modal__header">
          <div class="ui-modal__heading">
            <h2 class="ui-modal__title kb-share-pop-head" id="kb-perm-title"><span class="kb-share-pop-head-ico">${_icon('lock', 'kb-share-pop-head-icon')}</span>${_esc(_tr('kb.workbench.perm_title', '权限设置'))}</h2>
          </div>
          ${_uiIconButton({ label: _tr('kb.workbench.perm_close', '关闭权限设置弹窗'), icon: 'x', className: 'kb-share-pop-close' })}
// … 省略 63 行
```


## 冲突 102  (第 8642 行起)
   我方 16 行 [中性]
   上游 15 行 [中性]

**我方（企业侧）**
```js
  function _refreshLocalizedChrome() {
    const setText = (selector, key, fallback) => {
      const node = document.querySelector(selector);
      if (node) node.textContent = _t(key, fallback);
    };
    const setAttr = (selector, attribute, key, fallback) => {
// … 省略 10 行
```

**上游（开源侧）**
```js
  window.addEventListener('i18n-change', () => {
    if (!_state.rendered) return;
    // 外壳只渲染一次 ⇒ 静态 chrome（侧栏/工具栏/菜单）靠定点重标签换语言；
    // 树与右列本来就能重渲染，顺手一起刷新。
    _relabelWorkbench();
    // 脑图里那几个「文案随状态变」的按钮（预览/编辑、聚焦/聚焦中、布局模式、背景）：
// … 省略 9 行
```


## 冲突 103  (第 8753 行起)
   我方 0 行 [中性]
   上游 29 行 [中性]

**我方（企业侧）**
```js
```

**上游（开源侧）**
```js
  // 文件查看分派（供渲染层回归测试与自动化验证：返回 'rich'|'anchor'|'unavailable'）
  window.__kbWorkbenchOpenFile = function openFileForTest(relPath) {
    return _openFile(relPath);
  };

  // 测验「原文依据」的来源解析（同上规矩：让回归测试真跑匹配规则，而不是比对源码文本）
// … 省略 23 行
```


