
# src/renderer/modules/settings.js

冲突块 3 个   我方 5 行 / 上游 16 行

## 冲突 1  (第 2182 行起)
   我方 2 行 [中性]
   上游 8 行 [中性]

**我方（企业侧）**
```js
      + `<input type="checkbox" name="settings-model-form-input" value="${item.value}"${checked ? ' checked' : ''}${item.locked ? ' disabled' : ''}>`
      + `<span class="settings-check-chip__box"></span>`
```

**上游（开源侧）**
```js
      + uiCheckbox({
        id: `settings-model-form-input-${item.value}`,
        label: item.label,
        name: 'settings-model-form-input',
        value: item.value,
        checked,
// … 省略 2 行
```


## 冲突 2  (第 2206 行起)
   我方 2 行 [中性]
   上游 7 行 [中性]

**我方（企业侧）**
```js
      + `<input type="checkbox" name="settings-model-form-capability" value="${item.value}"${checked ? ' checked' : ''}>`
      + `<span class="settings-check-chip__box"></span>`
```

**上游（开源侧）**
```js
      + uiCheckbox({
        id: `settings-model-form-capability-${item.value}`,
        label: item.label,
        name: 'settings-model-form-capability',
        value: item.value,
        checked,
// … 省略 1 行
```


## 冲突 3  (第 2227 行起)
   我方 1 行 [中性]
   上游 1 行 [中性]

**我方（企业侧）**
```js
        <label class="toggle-switch"><input type="checkbox" id="settings-model-form-smart"${initial.smart ? ' checked' : ''}></label>
```

**上游（开源侧）**
```js
        ${uiSwitch({ id: 'settings-model-form-smart', label: t('settings.custom_providers.smart_config'), checked: initial.smart })}
```


