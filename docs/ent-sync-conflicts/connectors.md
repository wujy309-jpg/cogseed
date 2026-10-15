
# src/renderer/modules/connectors.js

冲突块 3 个   我方 54 行 / 上游 151 行

## 冲突 1  (第 392 行起)
   我方 0 行 [中性]
   上游 48 行 [UI] {UI:DOM 写入, UI:内联样式}

**我方（企业侧）**
```js
```

**上游（开源侧）**
```js
}

function _connectorMatchesSearch(item, query, lang) {
  if (!query) return true;
  const entry = item && item.entry ? item.entry : {};
  const instance = item && item.instance ? item.instance : {};
// … 省略 42 行
```


## 冲突 2  (第 519 行起)
   我方 1 行 [中性]
   上游 3 行 [中性]

**我方（企业侧）**
```js
  if (availCountEl) availCountEl.textContent = availableItems.length > 0 ? String(availableItems.length) : '';
```

**上游（开源侧）**
```js
  if (availCountEl) availCountEl.textContent = visibleAvailableItems.length > 0 ? String(visibleAvailableItems.length) : '';

  if (detailOpen) _renderConnectorDetail();
```


## 冲突 3  (第 1488 行起)
   我方 53 行 [UI] {UI:DOM 写入}
   上游 100 行 [UI] {UI:DOM 写入}

**我方（企业侧）**
```js
  const closeButton = typeof uiIconButton === 'function'
    ? uiIconButton({ icon: 'x', label: t('common.close'), variant: 'quiet', attrs: { 'data-act': 'cancel' } })
    : '';
  overlay.className = 'ui-modal-overlay connector-custom-overlay';
  overlay.innerHTML = `
    <div class="ui-modal ui-modal--md connector-custom-dialog" role="dialog" aria-modal="true" aria-labelledby="connector-custom-title">
// … 省略 47 行
```

**上游（开源侧）**
```js
  overlay.className = 'ui-modal-overlay';
  const formHtml = uiForm({
    ariaLabel: t('connectors.custom.title'),
    fields: [
      {
        wide: true,
// … 省略 94 行
```


