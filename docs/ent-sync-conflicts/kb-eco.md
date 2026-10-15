
# src/renderer/modules/kb-eco.js

冲突块 3 个   我方 22 行 / 上游 43 行

## 冲突 1  (第 9 行起)
   我方 3 行 [中性]
   上游 3 行 [中性]

**我方（企业侧）**
```js
    { key: 'kb', icon: 'folder', labelKey: 'kb.eco.knowledge', fallback: '知识库', status: 'ok' },
    { key: 'notes', icon: 'file-text', labelKey: 'kb.eco.notes', fallback: '笔记', status: 'ok' },
    { key: 'discover', icon: 'globe', labelKey: 'kb.eco.discover', fallback: '发现', status: 'soon' },
```

**上游（开源侧）**
```js
    { key: 'kb', icon: 'folder', labelKey: 'kb.eco.nav_kb', label: '知识库', status: 'ok' },
    { key: 'notes', icon: 'file-text', labelKey: 'kb.eco.nav_notes', label: '笔记', status: 'ok' },
    { key: 'discover', icon: 'globe', labelKey: 'kb.eco.nav_discover', label: '发现', status: 'soon' },
```


## 冲突 2  (第 42 行起)
   我方 18 行 [中性]
   上游 39 行 [UI] {UI:共享 UI}

**我方（企业侧）**
```js
  function _label(item) {
    return _t(item.labelKey, item.fallback);
  }

  function _navBtn(item, active) {
    const label = _label(item);
// … 省略 12 行
```

**上游（开源侧）**
```js
  function _mainLabel(label) {
    return String(label).split(' · ')[0];
  }

  function _format(text, vars) {
    return String(text == null ? '' : text).replace(/\{([a-zA-Z0-9_]+)\}/g, (_m, name) => String(vars?.[name] ?? ''));
// … 省略 33 行
```


## 冲突 3  (第 213 行起)
   我方 1 行 [中性]
   上游 1 行 [中性]

**我方（企业侧）**
```js
      uiToast(_t('kb.eco.reserved', '“{name}”模块预留').replace('{name}', item ? _label(item) : key), { variant: 'info' });
```

**上游（开源侧）**
```js
      uiToast(_tr('kb.eco.module_reserved', '「{name}」模块预留', { name: item ? _mainLabel(_navLabel(item)) : key }), { variant: 'info' });
```


