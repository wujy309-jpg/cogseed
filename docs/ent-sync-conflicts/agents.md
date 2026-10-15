
# src/renderer/modules/agents.js

冲突块 1 个   我方 1 行 / 上游 20 行

## 冲突 1  (第 3943 行起)
   我方 1 行 [UI] {UI:内联样式}
   上游 20 行 [UI] {UI:内联样式, UI:类选择器}

**我方（企业侧）**
```js
  if (picker) picker.style.display = 'none';
```

**上游（开源侧）**
```js
  const anchorId = picker?.dataset.anchorId || '';
  const composerMode = picker?.dataset.composerMode || '';
  if (picker) {
    picker.style.display = 'none';
    picker.dataset.composerMode = '';
    const foot = picker.querySelector('.composer-members-foot');
// … 省略 14 行
```


