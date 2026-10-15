
# src/renderer/modules/kb-discover.js

冲突块 1 个   我方 0 行 / 上游 1024 行

## 冲突 1  (第 15 行起)
   我方 0 行 [中性]
   上游 1024 行 [UI] {UI:共享 UI, 功能:IPC, 功能:状态流, UI:classList, UI:DOM 写入, UI:类选择器}

**我方（企业侧）**
```js
```

**上游（开源侧）**
```js
  function _icon(name, className) {
    return typeof window.uiIconHtml === 'function'
      ? window.uiIconHtml(name, className || '')
      : '';
  }

// … 省略 1018 行
```


