
# src/renderer/modules/kb-notes.js

冲突块 7 个   我方 47 行 / 上游 234 行

## 冲突 1  (第 12 行起)
   我方 30 行 [UI] {UI:共享 UI}
   上游 217 行 [UI] {UI:共享 UI, UI:类选择器, UI:内联样式}

**我方（企业侧）**
```js
  function _t(key, fallback) {
    const value = typeof window.t === 'function' ? window.t(key) : '';
    return value && value !== key ? value : fallback;
  }

  function _icon(name, className) {
// … 省略 24 行
```

**上游（开源侧）**
```js
  // ── i18n ──────────────────────────────────────────────────────────────
  // **外壳只渲染一次**（`_state.rendered` 守卫），而且编辑器是 contenteditable
  // ——草稿只活在 DOM 里。所以语言切换一律走**定点重标签**：只改文本节点与属性，
  // 绝不重建 innerHTML（重建 = 用户没保存的笔记直接没了）。
  // 文案的**唯一来源**是下面这张表：首渲染与重标签都读它，不存在两处漂移。
  const NOTES_TEXT = {
// … 省略 211 行
```


## 冲突 2  (第 336 行起)
   我方 4 行 [中性]
   上游 4 行 [中性]

**我方（企业侧）**
```js
            <div class="kb-notes-list-head"><h2>${_esc(_t('kb.notes.title', '笔记'))}</h2>${_iconButtonHtml({ label: _t('kb.notes.new', '新建笔记'), icon: 'plus', className: 'kb-wb-icon-btn', attrs: { id: 'kb-notes-new' } })}</div>
            <div class="kb-notes-filter">
              <span class="kb-notes-filter-tag${_state.filter === 'all' ? ' is-active' : ''}" data-nf="all">${_esc(_t('kb.notes.filter_all', '全部'))}</span>
              <span class="kb-notes-filter-tag${_state.filter === '30d' ? ' is-active' : ''}" data-nf="30d">${_esc(_t('kb.notes.filter_recent', '过去 30 天'))}</span>
```

**上游（开源侧）**
```js
            <div class="kb-notes-list-head"><h2 data-notes-text="kb.notes.title"></h2>${_uiIconButton({ label: _t('kb.notes.create'), icon: 'plus', className: 'kb-wb-icon-btn', attrs: { id: 'kb-notes-new', 'data-notes-label': 'kb.notes.create' } })}</div>
            <div class="kb-notes-filter">
              <span class="kb-notes-filter-tag${_state.filter === 'all' ? ' is-active' : ''}" data-nf="all" data-notes-text="kb.notes.filter_all"></span>
              <span class="kb-notes-filter-tag${_state.filter === '30d' ? ' is-active' : ''}" data-nf="30d" data-notes-text="kb.notes.filter_30d"></span>
```


## 冲突 3  (第 414 行起)
   我方 5 行 [中性]
   上游 5 行 [中性]

**我方（企业侧）**
```js
                ${_buttonHtml({ label: _t('kb.notes.to_library', '添加到知识库'), role: 'secondary', size: 'sm', icon: 'book-open', className: 'kb-wb-a-btn', attrs: { id: 'kb-notes-to-lib', title: _t('kb.notes.to_library_hint', '把当前笔记添加到个人或共享知识库') } })}
                ${_buttonHtml({ label: _t('kb.notes.ai_write', 'AI 帮写'), role: 'secondary', size: 'sm', icon: 'sparkles', className: 'kb-wb-a-btn', attrs: { id: 'kb-notes-ai', title: _t('kb.notes.ai_write_hint', '基于知识库生成或续写') } })}
                ${_buttonHtml({ label: _t('kb.notes.save', '保存'), role: 'primary', size: 'sm', className: 'kb-wb-a-btn is-primary', attrs: { id: 'kb-notes-save', title: _t('kb.notes.save_hint', '保存（Cmd/Ctrl+S）') } })}
                <div class="kb-ed-dropdown">
                  ${_iconButtonHtml({ label: _t('common.more', '更多'), icon: 'more-horizontal', className: 'kb-wb-a-btn kb-notes-more-button', attrs: { id: 'kb-notes-more-btn' } })}
```

**上游（开源侧）**
```js
                <button type="button" class="kb-wb-a-btn" id="kb-notes-to-lib" data-notes-title="kb.notes.to_lib">${_iconHtml('book-open')} <span data-notes-text="kb.notes.to_lib_label"></span></button>
                <button type="button" class="kb-wb-a-btn" id="kb-notes-ai" data-notes-title="kb.notes.ai">${_iconHtml('sparkles')} <span data-notes-text="kb.notes.ai_label"></span></button>
                ${_uiButton({ label: _t('kb.notes.save'), className: 'kb-wb-a-btn', attrs: { id: 'kb-notes-save', title: _t('kb.notes.save_title'), 'data-notes-label': 'kb.notes.save' } })}
                <div class="kb-ed-dropdown">
                  ${_uiIconButton({ label: _t('kb.notes.more'), icon: 'more-horizontal', className: 'kb-wb-a-btn', attrs: { id: 'kb-notes-more-btn', 'data-notes-label': 'kb.notes.more' } })}
```


## 冲突 4  (第 434 行起)
   我方 1 行 [中性]
   上游 1 行 [中性]

**我方（企业侧）**
```js
            <div class="kb-notes-body"><div class="kb-notes-edit" id="kb-notes-edit" contenteditable="true">${_selectionHintHtml()}</div></div>
```

**上游（开源侧）**
```js
            <div class="kb-notes-body"><div class="kb-notes-edit" id="kb-notes-edit" contenteditable="true"><p data-notes-text="kb.notes.placeholder"></p></div></div>
```


## 冲突 5  (第 673 行起)
   我方 4 行 [UI] {UI:DOM 写入}
   上游 4 行 [UI] {UI:DOM 写入}

**我方（企业侧）**
```js
      const title = _t(_state.filter === '30d' ? 'kb.notes.empty_recent' : 'kb.notes.empty', _state.filter === '30d' ? '过去 30 天没有笔记' : '暂无笔记');
      box.innerHTML = typeof window.uiEmptyState === 'function'
        ? `<div class="kb-notes-empty">${window.uiEmptyState({ kind: 'quiet', title })}</div>`
        : `<div class="kb-notes-empty">${_esc(title)}</div>`;
```

**上游（开源侧）**
```js
      box.innerHTML = _uiEmptyState({
        kind: 'quiet',
        title: _state.filter === '30d' ? _t('kb.notes.empty_30d') : _t('kb.notes.empty'),
      });
```


## 冲突 6  (第 770 行起)
   我方 2 行 [UI] {UI:DOM 写入}
   上游 2 行 [UI] {UI:DOM 写入}

**我方（企业侧）**
```js
      if (ed) { ed.innerHTML = _selectionHintHtml(); delete ed.dataset.note; }
      _toast('已删除', 'success');
```

**上游（开源侧）**
```js
      if (ed) { ed.innerHTML = `<p>${_esc(_t('kb.notes.placeholder'))}</p>`; delete ed.dataset.note; }
      _toast(_t('kb.notes.deleted'), 'success');
```


## 冲突 7  (第 904 行起)
   我方 1 行 [UI] {UI:DOM 写入}
   上游 1 行 [UI] {UI:DOM 写入}

**我方（企业侧）**
```js
      if (edEl) { edEl.innerHTML = _selectionHintHtml(); delete edEl.dataset.note; }
```

**上游（开源侧）**
```js
      if (edEl) { edEl.innerHTML = `<p>${_esc(_t('kb.notes.placeholder'))}</p>`; delete edEl.dataset.note; }
```


