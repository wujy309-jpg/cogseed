// 个人本体工作区 — classic script (window.renderPersonalOntology)
// 嵌入“认知资产 -> 记忆内容 -> 关于我”：左栏角色模板，右栏模板字段与原文。
(function () {
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function _t(key, fallback) {
    try { if (typeof t === 'function') { const v = t(key); if (v && v !== key) return v; } } catch (_) {}
    return fallback;
  }

  function _tv(key, vars, fallback) {
    try {
      if (typeof t === 'function') { const v = t(key, vars); if (v && v !== key) return v; }
    } catch (_) {}
    if (vars && fallback != null) {
      return String(fallback).replace(/\{(\w+)\}/g, (m, n) => (vars[n] != null ? String(vars[n]) : m));
    }
    return fallback;
  }

  function _notifyFail(prefix, err) {
    const msg = (err && err.message) ? err.message : String(err || '');
    try {
      if (typeof uiAlert === 'function') uiAlert(msg ? `${prefix}: ${msg}` : prefix);
      else console.warn('[personal-ontology]', prefix, msg);
    } catch (_) {}
  }

  /** SVG 图标（AGENTS.md：图标走 icons.js，不用 emoji/文本符号）。 */
  function _icon(name, className) {
    try {
      if (typeof window !== 'undefined' && typeof window.uiIconHtml === 'function') {
        return window.uiIconHtml(name, className || 'ui-icon');
      }
    } catch (_) {}
    return '';
  }

  /** 非交互元数据标记（US-102 T023；US-105 T040 收敛）：统一走共享 uiTag
   *  （ui-status.js，index.html 全局加载）；中性缺省 solid，语义成功用 success。 */
  function _tag(label, variant) {
    const text = String(label == null ? '' : label);
    if (!text) return '';
    if (typeof window.uiTag !== 'function') throw new Error('personal ontology requires uiTag');
    return window.uiTag({ label: text, variant: variant || undefined });
  }

  /** 状态胶囊（US-105 T040）：琥珀=需要注意（可能过时/受限），红=矛盾。
   *  与中性 _tag 分流——警示语义走共享 uiStatusPill，仍可辨。 */
  function _statusPill(label, tone) {
    const text = String(label == null ? '' : label);
    if (!text) return '';
    if (typeof window.uiStatusPill !== 'function') throw new Error('personal ontology requires uiStatusPill');
    return window.uiStatusPill({ label: text, tone: tone || 'neutral' });
  }

  /** 状态点（US-105 T041）：值行唯一可见的状态指示，共享 uiStatusDot（无文字纯色点）。 */
  function _statusDot(tone) {
    if (!tone) return '';
    if (typeof window.uiStatusDot !== 'function') throw new Error('personal ontology requires uiStatusDot');
    return window.uiStatusDot({ tone });
  }

  function _button(options) {
    if (typeof window.uiButton !== 'function') throw new Error('personal ontology requires uiButton');
    return window.uiButton(options);
  }

  function _iconButton(options) {
    if (typeof window.uiIconButton !== 'function') throw new Error('personal ontology requires uiIconButton');
    return window.uiIconButton(options);
  }

  function _input(options) {
    if (typeof window.uiInput !== 'function') throw new Error('personal ontology requires uiInput');
    return window.uiInput(options);
  }

  function _textarea(options) {
    if (typeof window.uiTextarea !== 'function') throw new Error('personal ontology requires uiTextarea');
    return window.uiTextarea(options);
  }

  function _emptyState(options) {
    if (typeof window.uiEmptyState !== 'function') throw new Error('personal ontology requires uiEmptyState');
    return window.uiEmptyState(options);
  }

  // ── state ────────────────────────────────────────────────────────────────
  let _pocTemplates = [];
  let _pocTemplatesLoaded = false;
  let _pocTemplatesLoadError = '';
  let _pocProfile = { entries: [], loaded: false, loadError: '' };
  let _pocProjectNames = null; // Map(pid → name)，二期 D5 字段值 @项目 显示用（懒加载）
  let _pocSkillNames = null;  // Map(id → {name, desc})，模板库 bundle 展示用（懒加载）
  let _pocAgentNames = null;  // Map(id → {name, desc})
  let _pocLibraryModalBound = false; // 模板库弹窗持久节点只绑一次
  let _pocLibraryReturnFocus = null;
  let _pocLibrarySelectedId = ''; // 模板库弹窗当前选中的模板（左列表右详情布局）
  const _pocActionLocks = new Set();
  // ── 本体分组子页（2026-09-20 自记忆页迁入）：分组列表 + 结构化编辑 ──
  let _pocGroups = { list: [], loaded: false, loadError: '' };
  let _pocCandidatesLoaded = false;
  let _pocPendingCandidates = [];
  /** 三盒数据（盒子化重构）：A/R/T 盒共用一次加载——资产 + 全组字段与
   *  流水 + 全量冲突台账。groups: [{gid,title,fields,entries}]。 */
  let _pocBoxData = { loaded: false, loadError: '', groups: [], assets: [], conflicts: [] };
  /** R 盒分类筛选：'all' | 'operation' | 'preference' | 'constraint' */
  let _pocTriBoxRuleFilter = 'all';
  /** 值行展开状态：`gid\x00field\x00value` 集合（点击行 toggle）。 */
  const _pocExpandedValues = new Set();
  // 导航就是三个盒子（词汇 T / 事实 A / 规则 R）；模板编辑器是 T 盒的下钻。
  let _pocSelected = { kind: 'abox', id: 'abox' };
  // 模板文件编辑器 { groupId, templateId, sections, content, view:'form'|'raw' }
  let _pocGroupEditor = null;
  /** D5b（spec 009 T027）：「已删除分组」折叠块。懒加载——首次展开才拉
   *  deleted.list（IPC 纪律 contracts/ipc.md §5.4：不给每次渲染加调用）。 */
  let _pocDeletedGroups = { open: false, loaded: false, loadError: '', list: [] };

  // PersonalOntology is stored as durable profile statements. Keep the
  // storage contract flat, but present those statements as a small ontology
  // in the UI so users can understand what kind of information was learned.
  // This is deliberately deterministic and display-only: a statement that
  // cannot be classified remains visible under "其他沉淀".
  const _pocOntologySections = [
    {
      id: 'identity',
      titleKey: 'personalOntology.ontology_identity',
      title: '身份与角色',
      descriptionKey: 'personalOntology.ontology_identity_hint',
      description: '你是谁、承担什么角色以及所在的环境',
      keywords: ['身份', '角色', '职业', '职位', '我是', '我是一名', '我叫', '来自', '居住', '公司', '团队', '程序员', '学生', '负责人', 'identity', 'role', 'job', 'profession', 'i am', 'i\'m'],
    },
    {
      id: 'workstyle',
      titleKey: 'personalOntology.ontology_workstyle',
      title: '工作方式',
      descriptionKey: 'personalOntology.ontology_workstyle_hint',
      description: '你习惯如何思考、决策和推进事情',
      keywords: ['工作方式', '做事', '习惯', '流程', '步骤', '先明确', '验收标准', '方法', '工作风格', 'workflow', 'work style', 'habit', 'process', 'method'],
    },
    {
      id: 'communication',
      titleKey: 'personalOntology.ontology_communication',
      title: '沟通与交互偏好',
      descriptionKey: 'personalOntology.ontology_communication_hint',
      description: '你偏好的表达方式、界面和反馈节奏',
      keywords: ['偏好', '喜欢', '沟通', '表达', '回复', '界面', '信息层次', '简洁', '结论', '语言', '交互', '沟通偏好', 'preference', 'prefer', 'communication', 'interface', 'concise', 'conclusion'],
    },
    {
      id: 'goals',
      titleKey: 'personalOntology.ontology_goals',
      title: '目标与边界',
      descriptionKey: 'personalOntology.ontology_goals_hint',
      description: '你正在追求什么，以及明确不希望发生什么',
      keywords: ['目标', '计划', '希望', '需要', '边界', '不要', '避免', '优先', '验收', '目标是', 'goal', 'plan', 'need', 'boundary', 'avoid', 'priority'],
    },
    {
      id: 'environment',
      titleKey: 'personalOntology.ontology_environment',
      title: '我在哪些项目与关系里',
      descriptionKey: 'personalOntology.ontology_environment_hint',
      description: '和你协作的人、项目与使用环境',
      keywords: ['同事', '家人', '客户', '朋友', '项目', '协作', '合作', '环境', '设备', '地点', '时区', '关系', 'team', 'project', 'collaboration', 'environment', 'device', 'location'],
    },
    {
      id: 'other',
      titleKey: 'personalOntology.ontology_other',
      title: '其他沉淀',
      descriptionKey: 'personalOntology.ontology_other_hint',
      description: '暂时无法归入固定类别的个人信息',
      keywords: [],
    },
  ];

  function _pocClassifyProfileEntry(entry) {
    const normalized = String(entry || '').trim().toLocaleLowerCase();
    if (!normalized) return 'other';
    const matched = _pocOntologySections.find((section) => (
      section.id !== 'other' && section.keywords.some((keyword) => normalized.includes(String(keyword).toLocaleLowerCase()))
    ));
    return matched ? matched.id : 'other';
  }

  function _pocProfileSections() {
    const grouped = new Map(_pocOntologySections.map((section) => [section.id, []]));
    _pocProfile.entries.forEach((entry) => {
      grouped.get(_pocClassifyProfileEntry(entry.text)).push(entry);
    });
    return _pocOntologySections
      .map((section) => ({ ...section, entries: grouped.get(section.id) || [] }))
      .filter((section) => section.entries.length > 0);
  }

  async function _pocInvoke(channel, payload) {
    try {
      const res = await window.cogseed.invoke(channel, payload || {});
      return res || { ok: false, error: 'no response' };
    } catch (err) {
      return { ok: false, error: (err && err.message) || String(err) };
    }
  }

  async function _pocLoadTemplates() {
    const res = await _pocInvoke('personalOntology.templates.list', {});
    if (!res || res.ok === false || !Array.isArray(res.templates)) {
      _pocTemplatesLoadError = (res && res.error) || _t('personalOntology.load_error', '加载失败');
      _pocTemplatesLoaded = true;
      return false;
    }
    _pocTemplates = res.templates;
    _pocTemplatesLoadError = '';
    _pocTemplatesLoaded = true;
    return true;
  }

  // 画像源（2026-09-19 记忆退役）：读资产库 personal 正式资产，与对话注入
  // （profile-block.ts）同源同口径——旧 USER.md 档已清空，读它只会得到假空态。
  // 排序对齐 profile-block 三档：72h 内新沉淀 > 用户确认过 > 其余；出身前缀
  // 让「谁说的」在页面上可见。
  async function _pocLoadProfile() {
    const res = await _pocInvoke('recall.assets.list', {});
    if (!res || res.ok === false || !Array.isArray(res.assets)) {
      _pocProfile = {
        entries: [],
        loaded: true,
        loadError: (res && res.error) || _t('personalOntology.load_error', '加载失败'),
      };
      return false;
    }
    const RECENT_MS = 72 * 60 * 60 * 1000;
    const now = Date.now();
    // 两档排序（出身收敛 2026-09-20）：72h 内新沉淀 > 其余；确认/模型记的
    // 不再是维度（与主进程 profile-block 同口径）。
    const tierOf = (asset) => {
      const ts = asset && asset.updatedAt ? Date.parse(asset.updatedAt) : 0;
      return ts && now - ts < RECENT_MS ? 2 : 1;
    };
    // entries 存 { text }：数据层裸文本（桥匹配、分节归组都用原文）。
    _pocProfile = {
      entries: res.assets
        .filter((asset) => asset && asset.type === 'personal' && asset.status === 'active')
        .sort((a, b) => tierOf(b) - tierOf(a)
          || String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
        .map((asset) => ({
          text: String(asset.statement || '').trim(),
        }))
        .filter((e) => e.text),
      loaded: true,
      loadError: '',
    };
    return true;
  }

  function _pocSetControlBusy(el, busy) {
    if (!el) return;
    if (busy) {
      el.__pocWasDisabled = !!el.disabled;
      el.disabled = true;
      el.setAttribute('aria-busy', 'true');
    } else {
      el.disabled = !!el.__pocWasDisabled;
      delete el.__pocWasDisabled;
      el.removeAttribute('aria-busy');
    }
  }

  async function _pocRunOnce(key, el, task) {
    if (_pocActionLocks.has(key)) return false;
    _pocActionLocks.add(key);
    _pocSetControlBusy(el, true);
    try {
      await task();
      return true;
    } finally {
      _pocActionLocks.delete(key);
      _pocSetControlBusy(el, false);
    }
  }

  function _pocToast(key, fallback, variant, vars) {
    try {
      const message = vars ? _tv(key, vars, fallback) : _t(key, fallback);
      if (typeof uiToast === 'function') uiToast(message, { variant: variant || 'success' });
    } catch (_) {}
  }

  // 模板文件分节解析（渲染层简易版，格式与主进程 parseTemplateContent 一致）：
  // 按 `## 分节` 切块，块内取 `### 流水` 小节按 § 切条目。
  function _pocParseTemplateSections(content) {
    const out = {};
    const parts = String(content || '').split(/^##\s+(.+)$/m);
    for (let i = 1; i < parts.length; i += 2) {
      const title = parts[i].trim();
      const body = parts[i + 1] || '';
      const flowIdx = body.indexOf('### 流水');
      const flowText = flowIdx === -1 ? '' : body.slice(flowIdx + '### 流水'.length);
      out[title] = flowText.split('\n§\n').map((s) => s.trim()).filter(Boolean);
    }
    return out;
  }

  // 模板文件表单视图：全部分节平铺，每分节 = 字段表单 + 分节流水。
  // 字段/流水操作走复合 id（`groupId::分节`）。
  function _pocRenderTemplateFormView(ed) {
    if (!ed.sections || !ed.sections.length) {
      return `<div class="memory-empty muted">${escapeHtml(_t('memory.group_form_no_fields', '该模板没有分节'))}</div>`;
    }
    return ed.sections.map((sec, sectionIndex) => {
      const ref = `${ed.groupId}::${sec.title}`;
      const fields = (sec.fields || []).map((f, fieldIndex) => `
        <div class="memory-group-field" data-mem-group-field="${escapeHtml(f.name)}">
          <div class="memory-group-field-name">
            <span class="memory-group-field-name-text">${escapeHtml(f.name)}</span>
            ${f.isCustom ? `<span class="memory-group-field-custom-badge">${escapeHtml(_t('memory.group_field_custom_badge', '自定义'))}</span>` : ''}
          </div>
          <div class="memory-group-field-values">
            ${f.values && f.values.length
              ? f.values.map((v) => `
                <div class="memory-group-field-value">
                  <span class="memory-group-field-value-text">${escapeHtml(v.value)}</span>
                  <span class="memory-group-field-source muted">${escapeHtml(_tv('memory.group_field_value_source', { value: '', source: v.source }))}</span>
                  ${v.project ? `<span class="memory-group-field-project">@${escapeHtml(_pocProjectNames ? (_pocProjectNames.get(v.project) || v.project) : v.project)}</span>` : ''}
                  ${_iconButton({ label: _t('memory.edit', '编辑'), icon: 'edit-pencil', className: 'memory-icon-btn', attrs: { 'data-poc-group-action': 'field-edit-value', 'data-poc-ref': ref, 'data-poc-field': f.name, 'data-poc-value': v.value } })}
                  ${_iconButton({ label: _t('memory.delete', '删除'), icon: 'x', variant: 'danger', className: 'memory-icon-btn is-muted', attrs: { 'data-poc-group-action': 'field-remove-value', 'data-poc-ref': ref, 'data-poc-field': f.name, 'data-poc-value': v.value } })}
                </div>`).join('')
              : `<span class="memory-group-field-empty muted">${escapeHtml(_t('memory.group_field_empty', '暂无值'))}</span>`}
          </div>
          <div class="memory-group-field-add">
            ${_input({ id: `personal-onto-field-${sectionIndex}-${fieldIndex}`, className: 'memory-group-field-input', placeholder: _t('memory.group_field_add_placeholder', '填值…'), attrs: { 'data-poc-ref': ref, 'data-poc-field': f.name } })}
            ${_button({ label: _t('memory.save', '保存'), role: 'primary', size: 'sm', attrs: { 'data-poc-group-action': 'field-add-value', 'data-poc-ref': ref, 'data-poc-field': f.name } })}
          </div>
        </div>`).join('');
      const flows = (ed.entriesBySection && ed.entriesBySection[sec.title]) || [];
      const flowRows = flows.length
        ? flows.map((e) => `
          <div class="memory-group-flow-entry">
            <span class="memory-group-flow-text">${escapeHtml(e)}</span>
            ${_button({ label: _t('memory.group_promote', '升格'), size: 'sm', attrs: { 'data-poc-group-action': 'entry-promote', 'data-poc-ref': ref, 'data-poc-entry': e } })}
            ${_iconButton({ label: _t('memory.delete', '删除'), icon: 'x', variant: 'danger', className: 'memory-icon-btn is-muted', attrs: { 'data-poc-group-action': 'entry-remove', 'data-poc-ref': ref, 'data-poc-entry': e } })}
          </div>`).join('')
        : `<div class="memory-empty muted">${escapeHtml(_t('memory.group_flow_empty', '暂无流水条目'))}</div>`;
      return `<div class="memory-group-template-section">
        <div class="memory-group-template-section-title">${escapeHtml(sec.title)}</div>
        <div class="memory-group-template-section-fields">${fields}</div>
        <div class="memory-group-template-section-flow">
          <div class="memory-group-template-flow-title">${escapeHtml(_t('memory.group_flow_view', '流水'))}</div>
          ${flowRows}
        </div>
      </div>`;
    }).join('');
  }

  function _pocRenderGroupRawView(ed) {
    return _textarea({ id: 'personal-ontology-group-content', className: 'memory-entry-textarea memory-group-editor-textarea', value: ed.content || '', attrs: { rows: 14, 'data-poc-group-content': '' } });
  }

  // A role template is a narrower projection than the general personal
  // profile. Keep un-routed statements visible while routing is unavailable
  // or ambiguous, but never pretend they belong to a template field.
  /** 出身收敛（2026-09-20 拍板）：模型记下来的=已确定——画像条目就是一条
   *  内容，不再带任何出身前缀/章（确认/模型记的区分全链退役）。 */
  function _pocProfileEntryHtml(entry) {
    return escapeHtml(String(entry && entry.text ? entry.text : ''));
  }

  function _pocRenderTemplateProfileBridge(ed) {
    if (!ed || !ed.loaded || ed.loadError || !_pocProfile.entries.length) return '';
    const content = String(ed.content || '');
    // 比对用裸文本：出身前缀是显示层的装饰，不参与「是否已匹配字段」判定。
    const pending = _pocProfile.entries.filter((entry) => !content.includes(entry.text));
    if (!pending.length) return '';
    return `<section class="personal-onto-template-profile-bridge" aria-label="${escapeHtml(_t('personalOntology.template_profile_bridge_title', '会话沉淀'))}">
      <div class="personal-onto-template-profile-bridge-head">
        <div>
          <div class="personal-onto-template-profile-bridge-title">${escapeHtml(_t('personalOntology.template_profile_bridge_title', '会话沉淀'))}</div>
          <div class="personal-onto-template-profile-bridge-hint">${escapeHtml(_t('personalOntology.template_profile_bridge_hint', '这些信息已确认，但暂未匹配到当前角色模板字段；不会自动填入错误字段。'))}</div>
        </div>
        <span class="personal-onto-template-profile-bridge-count">${escapeHtml(String(pending.length))}</span>
      </div>
      <div class="personal-onto-template-profile-bridge-list">
        ${pending.map((entry) => `<div class="personal-onto-template-profile-bridge-entry">
          <span class="personal-onto-profile-entry-icon">${_icon('file-text', 'ui-icon')}</span>
          <span>${_pocProfileEntryHtml(entry)}</span>
        </div>`).join('')}
      </div>
    </section>`;
  }

  function _pocRenderGroupEditorHtml() {
    const ed = _pocGroupEditor;
    if (!ed) return '';
    const view = ed.view || 'form';
    const ready = !!ed.loaded && !ed.loadError;
    const tab = (key, label) => `<button type="button" class="memory-group-editor-tab${view === key ? ' is-active' : ''}" data-poc-group-action="view-${key}"${ready ? '' : ' disabled'}>${escapeHtml(label)}</button>`;
    const body = !ed.loaded
      ? `<div class="personal-onto-editor-loading" aria-live="polite">${escapeHtml(_t('personalOntology.template_content_loading', '正在加载模板内容...'))}</div>`
      : ed.loadError
        ? `<div class="personal-onto-template-read-error" role="alert">
            <span>${escapeHtml(_t('personalOntology.load_error', '加载失败'))}: ${escapeHtml(ed.loadError)}</span>
            ${_button({ label: _t('personalOntology.retry', '重试'), size: 'sm', attrs: { 'data-poc-group-action': 'reload-group' } })}
          </div>`
        : (view === 'form' ? _pocRenderTemplateFormView(ed) : _pocRenderGroupRawView(ed));
    const profileBridge = _pocRenderTemplateProfileBridge(ed);
    return `<div class="personal-onto-group-editor" data-poc-group-editor="${escapeHtml(ed.groupId)}" aria-busy="${ready ? 'false' : 'true'}">
      <div class="personal-onto-group-editor-head">
        <span class="personal-onto-group-editor-title">${escapeHtml(ed.title || ed.groupId)}</span>
        <span class="memory-template-name-suffix">${escapeHtml(_t('memory.templates_suffix', '模板'))}</span>
      </div>
      <div class="memory-group-editor-tabs">
        ${tab('form', _t('memory.group_form_view', '表单'))}
        ${tab('raw', _t('memory.group_raw_view', '原文'))}
      </div>
      ${profileBridge}
      <div class="personal-onto-group-editor-body">
        ${body}
      </div>
      <div class="memory-entry-foot">
        <span class="memory-entry-charcount">${ready && ed.content ? ed.content.length : 0}</span>
        <span class="memory-flex"></span>
        ${view === 'raw' && ready ? _button({ label: _t('memory.save', '保存'), role: 'primary', size: 'sm', attrs: { 'data-poc-group-action': 'save-content' } }) : ''}
      </div>
    </div>`;
  }

  async function _pocEnsureProjectNames() {
    if (_pocProjectNames) return _pocProjectNames;
    try {
      const res = await window.cogseed.invoke('projects.list');
      const projects = (res && Array.isArray(res.projects)) ? res.projects : [];
      _pocProjectNames = new Map(projects.map((p) => [p.project_id, p.name || p.project_id]));
    } catch (_) {
      _pocProjectNames = new Map();
    }
    return _pocProjectNames;
  }

  async function _pocOpenGroup(groupId) {
    const tmpl = _pocTemplates.find((t) => t.installed && t.group_id === groupId);
    if (!tmpl) return;
    _pocSelected = { kind: 'template', id: groupId };
    const editor = {
      groupId,
      title: tmpl.name,
      content: '',
      loaded: false,
      templateId: tmpl.template_id,
      sections: tmpl.sections || [],
      entriesBySection: null,
      view: 'form',
    };
    _pocGroupEditor = editor;
    renderPersonalOntology();
    await _pocEnsureProjectNames(); // 二期 D5：字段值 @项目 显示需要项目名映射
    const res = await _pocInvoke('personalOntology.groups.read', { groupId });
    if (_pocGroupEditor !== editor) return;
    editor.loaded = true;
    if (!res || res.ok === false) {
      editor.loadError = (res && res.error) || _t('personalOntology.load_error', '加载失败');
      renderPersonalOntology();
      return;
    }
    editor.content = res.content || '';
    editor.entriesBySection = _pocParseTemplateSections(editor.content);
    renderPersonalOntology();
  }
  async function _pocRefreshGroupData() {
    const ed = _pocGroupEditor;
    if (!ed) return;
    const [res, tRes] = await Promise.all([
      _pocInvoke('personalOntology.groups.read', { groupId: ed.groupId }),
      _pocInvoke('personalOntology.templates.list', {}),
    ]);
    if (!_pocGroupEditor || _pocGroupEditor.groupId !== ed.groupId) return;
    if (res && res.ok !== false) {
      _pocGroupEditor.content = res.content || '';
      _pocGroupEditor.entriesBySection = _pocParseTemplateSections(_pocGroupEditor.content);
    }
    if (tRes && tRes.ok !== false && Array.isArray(tRes.templates)) {
      _pocTemplates = tRes.templates;
      const tmpl = _pocTemplates.find((t) => t.template_id === ed.templateId);
      _pocGroupEditor.sections = tmpl && tmpl.sections ? tmpl.sections : [];
      _pocGroupEditor.title = (tmpl && tmpl.name) || _pocGroupEditor.title;
    }
    renderPersonalOntology();
  }

  async function _pocGroupAction(action, payload) {
    const res = await _pocInvoke(action, payload);
    if (!res || res.ok === false) {
      _notifyFail(_t('personalOntology.op_failed', '操作失败'), new Error((res && res.error) || ''));
      return false;
    }
    return true;
  }

  // ── 模板管理 ─────────────────────────────────────────────────────────────
  /** 安装模板：有归档 → 让用户选「恢复原数据 / 重建空模板」；无归档 → 直接装。 */
  async function _pocInstallTemplate(templateId) {
    let restoreData = false;
    // 有归档旧数据 → 提供恢复选项
    try {
      const ar = await _pocInvoke('personalOntology.templates.hasArchive', { templateId });
      if (ar && ar.hasArchive) {
        if (typeof uiConfirmDanger === 'function') {
          const restoreOk = await uiConfirmDanger({
            title: _t('personalOntology.template_reinstall_title', '重新安装'),
            message: _t('personalOntology.template_reinstall_prompt', '检测到该模板的归档数据。要恢复原数据，还是重建空模板？'),
            dangerLabel: _t('personalOntology.template_restore_btn', '恢复原数据'),
          });
          // uiConfirmDanger 确认 = 恢复；取消 = 询问是否重建空模板
          if (restoreOk) restoreData = true;
          else {
            const freshOk = (typeof uiConfirm === 'function')
              ? await uiConfirm({ message: _t('personalOntology.template_rebuild_prompt', '重建空模板？（不恢复归档数据）') })
              : true;
            if (!freshOk) return;
          }
        } else {
          restoreData = false;
        }
      }
    } catch (_) {}
    const res = await _pocInvoke('personalOntology.templates.install', { templateId, restoreData });
    if (!res || res.ok === false) {
      if (res && res.error === 'template_limit_reached') {
        try { if (typeof uiAlert === 'function') uiAlert(_t('personalOntology.template_limit', '最多安装 3 个角色模板，请先卸载一个')); } catch (_) {}
        return;
      }
      _notifyFail(_t('personalOntology.templates_install_error', '模板安装失败'), new Error((res && res.error) || ''));
      return;
    }
    try {
      if (typeof uiToast === 'function') {
        if (res.already_installed) uiToast(_t('memory.templates_already_installed', '该模板已安装'), { variant: 'info' });
        else if (res.restored_from_archive) uiToast(_t('personalOntology.template_restored_ok', '模板已安装，归档数据已恢复'), { variant: 'success' });
        else uiToast(_t('memory.templates_installed_ok', '模板安装成功'), { variant: 'success' });
        if (res.conflict_groups && res.conflict_groups.length) {
          uiToast(_t('memory.templates_conflict', { groups: res.conflict_groups.map((g) => g.title).join('、') }), { variant: 'warning' });
        }
      }
    } catch (_) {}
    await _pocLoadTemplates();
    const installed = _pocTemplates.find((t) => t.installed && t.template_id === templateId);
    if (installed) _pocSelected = { kind: 'template', id: installed.group_id };
    _pocGroupEditor = null;
    renderPersonalOntology();
  }

  /** 卸载模板：确认（含全局记忆归档选项）→ 主进程归档 + 台账移除 → 提示归档位置。 */
  async function _pocUninstallTemplate(templateId) {
    const tmpl = _pocTemplates.find((x) => x.template_id === templateId);
    const name = (tmpl && tmpl.name) || templateId;
    // 该角色有没有全局记忆归档可带走
    let memCount = 0;
    try {
      const mc = await _pocInvoke('memory.roleTemplateCount', { templateId });
      if (mc && typeof mc.count === 'number') memCount = mc.count;
    } catch (_) {}
    const archiveMemory = memCount > 0
      ? (typeof uiConfirm === 'function'
          ? await uiConfirm({
              message: _tv('personalOntology.template_uninstall_mem_confirm', { name, n: memCount },
                '「{name}」有 {n} 条全局记忆（该角色来源）。是否一起归档？归档后重装可一并恢复。'),
            })
          : true)
      : false;
    if (!archiveMemory && memCount > 0) {
      // 用户选择不归档全局记忆 → 只卸模板
      const ok2 = (typeof uiConfirmDanger === 'function')
        ? await uiConfirmDanger({
            title: _t('personalOntology.template_uninstall_title', '卸载角色模板'),
            message: _tv('personalOntology.template_uninstall_confirm', { name }, '卸载「{name}」？模板数据将归档保留（可重新安装恢复），不影响全局记忆。'),
            dangerLabel: _t('personalOntology.template_uninstall_btn', '卸载'),
          })
        : true;
      if (!ok2) return;
    }
    if (memCount === 0) {
      const ok = (typeof uiConfirmDanger === 'function')
        ? await uiConfirmDanger({
            title: _t('personalOntology.template_uninstall_title', '卸载角色模板'),
            message: _tv('personalOntology.template_uninstall_confirm', { name }, '卸载「{name}」？模板数据将归档保留（可重新安装恢复），不影响全局记忆。'),
            dangerLabel: _t('personalOntology.template_uninstall_btn', '卸载'),
          })
        : (typeof uiConfirm === 'function'
            ? await uiConfirm({ message: _tv('personalOntology.template_uninstall_confirm', { name }, '卸载「{name}」？模板数据将归档保留（可重新安装恢复），不影响全局记忆。') })
            : true);
      if (!ok) return;
    }
    const res = await _pocInvoke('personalOntology.templates.uninstall', { templateId, archiveMemory: memCount > 0 ? !!archiveMemory : false });
    if (!res || res.ok === false) {
      _notifyFail(_t('personalOntology.template_uninstall_error', '卸载失败'), new Error((res && res.error) || ''));
      return;
    }
    try {
      if (typeof uiToast === 'function') {
        if (res.archived_memory_count > 0) {
          uiToast(_tv('personalOntology.template_uninstalled_mem_ok', { name, n: res.archived_memory_count }, '已卸载「{name}」，模板与 {n} 条全局记忆已一并归档'), { variant: 'success' });
        } else {
          uiToast(_tv('personalOntology.template_uninstalled_ok', { name }, '已卸载「{name}」，数据已归档'), { variant: 'success' });
        }
        if (res.archive_dir) uiToast(_tv('personalOntology.template_archive_path', { path: res.archive_dir }, '归档位置：{path}'), { variant: 'info' });
      }
    } catch (_) {}
    // 当前模板卸载后由渲染器自动切换到下一个已安装模板。
    if (_pocGroupEditor && _pocGroupEditor.templateId === templateId) {
      _pocSelected = { kind: 'template', id: null };
      _pocGroupEditor = null;
    }
    await _pocLoadTemplates();
    renderPersonalOntology();
  }

  /** 懒加载 skill/agent 名称映射（模板库 bundle 展示用）。 */
  async function _pocEnsureResourceNames() {
    if (_pocSkillNames && _pocAgentNames) return;
    try {
      const [skillsRes, agentsRes] = await Promise.all([
        _pocInvoke('skills.list'),
        _pocInvoke('agents.list'),
      ]);
      _pocSkillNames = new Map((skillsRes.skills || []).map((s) => [s.id, { name: s.name || s.id, desc: (s.description_zh || s.description_en || '').trim() }]));
      _pocAgentNames = new Map((agentsRes.agents || []).map((a) => [a.agent_id, { name: a.name || a.agent_id, desc: (a.description_zh || a.description_en || '').trim() }]));
    } catch (_) {
      _pocSkillNames = _pocSkillNames || new Map();
      _pocAgentNames = _pocAgentNames || new Map();
    }
  }

  /** 模板 bundle → skill/agent 行（名称 + 一句能力简介，与工作空间详情同源）。 */
  function _pocRenderBundle(t) {
    const skillIds = (t.bundle && t.bundle.skill_ids) || [];
    const agentIds = (t.bundle && t.bundle.agent_ids) || [];
    if (!skillIds.length && !agentIds.length) return '';
    const rows = [];
    for (const id of skillIds) {
      const info = _pocSkillNames ? _pocSkillNames.get(id) : null;
      rows.push(`<div class="personal-onto-library-res">
        <span class="personal-onto-library-res-tag is-skill">${_t('personalOntology.bundle_skill', '技能')}</span>
        <div class="personal-onto-library-res-main">
          <span class="personal-onto-library-res-name">${escapeHtml((info && info.name) || id)}</span>
          ${info && info.desc ? `<span class="personal-onto-library-res-desc">${escapeHtml(info.desc)}</span>` : ''}
        </div>
      </div>`);
    }
    for (const id of agentIds) {
      const info = _pocAgentNames ? _pocAgentNames.get(id) : null;
      rows.push(`<div class="personal-onto-library-res">
        <span class="personal-onto-library-res-tag is-agent">${_t('personalOntology.bundle_agent', '智能体')}</span>
        <div class="personal-onto-library-res-main">
          <span class="personal-onto-library-res-name">${escapeHtml((info && info.name) || id)}</span>
          ${info && info.desc ? `<span class="personal-onto-library-res-desc">${escapeHtml(info.desc)}</span>` : ''}
        </div>
      </div>`);
    }
    return `<div class="personal-onto-library-res-list">
      <div class="personal-onto-library-res-title">${_t('personalOntology.template_bundle_label', '配套能力')}</div>
      ${rows.join('')}
    </div>`;
  }

  /** 角色模板库弹窗：列出全部模板（已安装带卸载按钮，未安装带安装按钮），超 3 上限置灰。 */
  async function _pocOpenTemplateLibrary() {
    await _pocEnsureResourceNames();
    const installedCount = _pocTemplates.filter((t) => t.installed).length;
    const atLimit = installedCount >= 3;
    const all = _pocTemplates.slice().sort((a, b) => (b.installed ? 1 : 0) - (a.installed ? 1 : 0));
    const listEl = document.getElementById('personal-onto-template-library-list');
    const detailEl = document.getElementById('personal-onto-template-library-detail');
    if (!listEl || !detailEl) return;
    if (!all.length) {
      listEl.innerHTML = `<div class="personal-onto-empty">${_t('personalOntology.template_library_empty', '模板库为空')}</div>`;
      detailEl.innerHTML = '';
    } else {
      if (!_pocLibrarySelectedId || !all.some((t) => t.template_id === _pocLibrarySelectedId)) {
        _pocLibrarySelectedId = all[0].template_id;
      }
      const selected = all.find((t) => t.template_id === _pocLibrarySelectedId) || all[0];
      listEl.innerHTML = all.map((t) => {
        const active = t.template_id === selected.template_id ? ' is-active' : '';
        const installedBadge = t.installed ? `<span class="personal-onto-library-installed muted">${_t('personalOntology.template_installed_badge', '已安装')}</span>` : '';
        return `<button type="button" class="personal-onto-library-row${active}" data-template-id="${escapeHtml(t.template_id)}">
          <span class="personal-onto-library-row-name">${escapeHtml(t.name)}</span>
          ${installedBadge}
        </button>`;
      }).join('');
      detailEl.innerHTML = _pocRenderLibraryDetail(selected, { atLimit, installedCount });
      // 列表点击 → 切换选中详情
      listEl.querySelectorAll('.personal-onto-library-row').forEach((row) => {
        row.addEventListener('click', () => {
          _pocLibrarySelectedId = row.dataset.templateId || '';
          const next = all.find((t) => t.template_id === _pocLibrarySelectedId) || all[0];
          listEl.querySelectorAll('.personal-onto-library-row').forEach((r) => {
            r.classList.toggle('is-active', r.dataset.templateId === next.template_id);
          });
          detailEl.innerHTML = _pocRenderLibraryDetail(next, { atLimit, installedCount });
          _pocBindLibraryDetail(detailEl, { atLimit, installedCount });
        });
      });
    }
    // 详情内安装/卸载按钮绑定
    _pocBindLibraryDetail(detailEl, { atLimit, installedCount });
    const overlay = document.getElementById('personal-onto-template-library-modal');
    if (overlay) {
      if (overlay.style.display === 'none') _pocLibraryReturnFocus = document.activeElement || null;
      overlay.style.display = 'flex';
      overlay.setAttribute('aria-hidden', 'false');
      const closeBtn = document.getElementById('personal-onto-template-library-close');
      if (closeBtn && typeof closeBtn.focus === 'function') closeBtn.focus();
    }
  }

  /** 右栏详情：单个模板的名字、描述、bundle、安装/卸载按钮。 */
  function _pocRenderLibraryDetail(t, { atLimit }) {
    const nSections = (t.sections || []).length;
    const nFields = (t.sections || []).reduce((n, s) => n + (s.fields || []).length, 0);
    const uninstallBtn = t.installed
      ? _iconButton({ label: _t('personalOntology.template_uninstall_tip', '卸载（数据归档保留）'), icon: 'x', variant: 'danger', className: 'personal-onto-library-uninstall', attrs: { 'data-template-id': t.template_id } })
      : '';
    const installBtn = t.installed
      ? `<span class="personal-onto-library-installed muted">${_t('personalOntology.template_installed_badge', '已安装')}</span>`
      : _button({ label: _t('memory.templates_install', '安装'), role: 'primary', size: 'sm', className: 'personal-onto-library-install', disabled: atLimit, attrs: { 'data-template-id': t.template_id } });
    return `<div class="personal-onto-library-detail-card${t.installed ? ' is-installed' : ''}" data-template-id="${escapeHtml(t.template_id)}">
      <div class="personal-onto-library-detail-head">
        <div>
          <div class="personal-onto-library-detail-name">${escapeHtml(t.name)}</div>
          <div class="personal-onto-library-card-meta">${nSections} ${_t('personalOntology.dest_role_sections', '分节')} · ${nFields} ${_t('personalOntology.dest_role_fields', '字段')}</div>
        </div>
        ${uninstallBtn}
      </div>
      ${t.description ? `<div class="personal-onto-library-card-desc">${escapeHtml(t.description)}</div>` : ''}
      ${_pocRenderBundle(t)}
      <div class="personal-onto-library-card-foot">
        ${installBtn}
        ${!t.installed && atLimit ? `<span class="personal-onto-library-limit muted">${_t('personalOntology.template_limit_hint', '已达 3 个上限，需先卸载一个')}</span>` : ''}
      </div>
    </div>`;
  }

  function _pocBindLibraryDetail(root, { atLimit }) {
    if (!root) return;
    root.querySelectorAll('.personal-onto-library-install').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const tid = btn.dataset.templateId;
        if (!tid || btn.disabled) return;
        await _pocRunOnce(`template-install:${tid}`, btn, async () => {
          await _pocInstallTemplate(tid);
          await _pocOpenTemplateLibrary(); // 刷新列表（上限置灰变化）
        });
      });
    });
    root.querySelectorAll('.personal-onto-library-uninstall').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const tid = btn.dataset.templateId;
        if (!tid) return;
        await _pocRunOnce(`template-uninstall:${tid}`, btn, async () => {
          await _pocUninstallTemplate(tid);
          await _pocOpenTemplateLibrary();
        });
      });
    });
  }

  function _pocCloseTemplateLibrary() {
    const overlay = document.getElementById('personal-onto-template-library-modal');
    if (overlay) {
      overlay.style.display = 'none';
      overlay.setAttribute('aria-hidden', 'true');
    }
    const returnFocus = _pocLibraryReturnFocus;
    _pocLibraryReturnFocus = null;
    if (returnFocus && typeof returnFocus.focus === 'function') returnFocus.focus();
  }

  // ── 左栏导航渲染 ─────────────────────────────────────────────────────────
  /** 三个盒子的数量口径（nav 角标与主区页头共用，2026-09-21 抽出）。 */
  function _pocBoxCounts() {
    const installedCount = _pocTemplates.filter((x) => x.installed).length;
    const loaded = _pocBoxData.loaded;
    const nonRel = (g) => (g.fields || []).reduce((m, f) => m + (f.values || []).filter((v) => !/→|->/.test(String(v.value || ''))).length, 0);
    const rel = (g) => (g.fields || []).reduce((m, f) => m + (f.values || []).filter((v) => /→|->/.test(String(v.value || ''))).length, 0);
    return {
      tbox: _pocGroups.list.length + installedCount,
      abox: (loaded ? _pocBoxData.groups.reduce((n, g) => n + nonRel(g), 0) : 0) + _pocProfile.entries.length,
      rbox: (loaded ? _pocBoxData.groups.reduce((n, g) => n + rel(g), 0) : 0) + (loaded ? _pocBoxData.assets.filter((a) => a.type === 'rule').length : 0),
    };
  }

  function _pocRenderNav() {
    const nav = document.getElementById('personal-onto-nav');
    if (!nav) return;
    // 导航就是三个盒子（盒子化重构）：词汇 T / 事实 A / 规则 R——组与模板
    // 不再是导航入口（组在 T 盒管理、模板在 T 盒下钻）。
    const counts = _pocBoxCounts();
    const factCount = counts.abox;
    const ruleCount = counts.rbox;
    // US-103 导航副标题：文字位改为竖排容器（名称 + 副标题），角标仍是
    // 同层 flex 子项（位置不变），点击行为走既有 _pocBindNav 分支（零变化）。
    const row = (kind, icon, labelKey, fallback, count, subKey, subFallback) => {
      const active = _pocSelected.kind === kind;
      return `<button type="button" class="personal-onto-nav-row${active ? ' is-active' : ''}" data-poc-nav="${kind}" data-poc-id="${kind}">
        <span class="personal-onto-nav-file-icon">${_icon(icon, 'ui-icon')}</span>
        <span class="personal-onto-nav-row-text is-stacked"><span class="personal-onto-nav-row-name">${escapeHtml(_t(labelKey, fallback))}</span><span class="personal-onto-nav-row-sub">${escapeHtml(_t(subKey, subFallback))}</span></span>
        ${count !== undefined ? `<span class="muted">${count}</span>` : ''}
      </button>`;
    };
    nav.innerHTML = `<div class="personal-onto-nav-section">
      ${row('tbox', 'type', 'personalOntology.nav_tbox', '统一词表', counts.tbox, 'personalOntology.nav_tbox_sub', '系统描述你时的一致用词')}
      ${row('abox', 'user', 'personalOntology.nav_abox', '我是谁', factCount, 'personalOntology.nav_abox_sub', '身份、角色与项目关系')}
      ${row('rbox', 'terminal', 'personalOntology.nav_rbox', '我偏好什么', ruleCount, 'personalOntology.nav_rbox_sub', 'AI 该怎么配合你做事')}
      ${_pocPendingCandidates.length ? `<div class="personal-onto-backflow-badge" style="padding:2px 10px 8px">${escapeHtml(_tv('personalOntology.backflow_badge', { n: _pocPendingCandidates.length }, '回流 {n}'))}</div>` : ''}
    </div>
    <div class="personal-onto-nav-section">
      <div class="personal-onto-group-io">
        ${_button({ label: _t('personalOntology.memory_export', '导出记忆'), size: 'sm', className: 'personal-onto-group-io-btn o', attrs: { 'data-poc-nav': 'memory-export' } })}
        ${_button({ label: _t('personalOntology.memory_import', '导入记忆'), size: 'sm', className: 'personal-onto-group-io-btn o', attrs: { 'data-poc-nav': 'memory-import' } })}
      </div>
      <div class="personal-onto-io-hint">${escapeHtml(_t('personalOntology.io_hint', '导出：把事实与规则保存为文本文件。导入：从粘贴或文件加入条目，导入前可预览确认。'))}</div>
    </div>`;
  }

  // ── 右栏渲染 ─────────────────────────────────────────────────────────────
  // ── 本体分组子页数据加载 ─────────────────────────────────────────────

  /** asof 超龄（与主进程 isStaleAsOf 同口径：月差 > 12 标「可能过时」）。 */
  function _pocIsStaleAsOf(asOf) {
    if (typeof asOf !== 'string') return false;
    const match = asOf.match(/^((?:19|20)\d{2})-(0[1-9]|1[0-2])$/);
    if (!match) return false;
    const now = new Date();
    return (now.getFullYear() - Number(match[1])) * 12 + (now.getMonth() + 1 - Number(match[2])) > 12;
  }

  /** 普通分组列表（模板组归角色模板区管，这里只显示 template_id 缺席的）。 */
  async function _pocLoadGroups() {
    const res = await _pocInvoke('personalOntology.groups.list', {});
    if (!res || res.ok === false || !Array.isArray(res.groups)) {
      _pocGroups = { list: [], loaded: true, loadError: (res && res.error) || _t('personalOntology.load_error', '加载失败') };
      return false;
    }
    _pocGroups = {
      list: res.groups.filter((g) => g && g.group_id && !g.template_id),
      loaded: true,
      loadError: '',
    };
    return true;
  }

  /** 本体候选池（回流候选在这里确认）。 */
  /** 三盒数据加载：资产库（A: personal / R: rule）+ 全组字段与流水 + 全量
 *  冲突台账（自带自愈）。三个盒视图共用这一份，避免重复拉取。 */
  async function _pocLoadBoxData() {
    const assetsRes = await _pocInvoke('recall.assets.list', {});
    const assets = assetsRes && Array.isArray(assetsRes.assets)
      ? assetsRes.assets.filter((a) => a && a.status === 'active')
      : [];
    const groupsWithFields = [];
    if (_pocGroups.loaded || await _pocLoadGroups()) {
      for (const g of _pocGroups.list) {
        const [fieldsRes, readRes] = await Promise.all([
          _pocInvoke('personalOntology.groups.fields.list', { groupId: g.group_id }),
          _pocInvoke('personalOntology.groups.read', { groupId: g.group_id }),
        ]);
        let entries = [];
        try {
          const raw = String((readRes && readRes.content) || '');
          const flowZone = raw.split('## 流水区')[1] || '';
          entries = flowZone.split('§').map((s) => s.trim()).filter(Boolean);
        } catch { entries = []; }
        groupsWithFields.push({
          gid: g.group_id,
          title: g.title || g.group_id,
          fields: fieldsRes && Array.isArray(fieldsRes.fields) ? fieldsRes.fields : [],
          entries,
        });
      }
    }
    const conflictsRes = await _pocInvoke('personalOntology.conflicts.list', {});
    _pocBoxData = {
      loaded: true,
      loadError: '',
      groups: groupsWithFields,
      assets,
      conflicts: conflictsRes && Array.isArray(conflictsRes.conflicts) ? conflictsRes.conflicts : [],
    };
    return true;
  }

  /** 盒数据变更后的统一重载（保持当前盒选中态）。 */
  async function _pocReloadBoxData() {
    _pocBoxData = { loaded: false, loadError: '', groups: [], assets: [], conflicts: [] };
    await renderPersonalOntology();
  }

  /** 值冲突命中（按 gid+字段+值，冲突数据来自全量台账）。 */
  function _pocConflictFor(gid, field, value) {
    return (_pocBoxData.conflicts || []).some((c) => c && c.group_id === gid
      && c.field === field && (c.value_a === value || c.value_b === value));
  }

  /** 状态点色调（US-105 T041 收敛到共享 uiStatusDot 的 tone）：冲突红 > 受限/超龄琥珀 > 核实绿。 */
  function _pocStatusDotTone(fv, conflicted) {
    if (conflicted) return 'critical';
    if (fv.sensitivity === 'restricted') return 'attention';
    if (fv.asOf && _pocIsStaleAsOf(fv.asOf)) return 'attention';
    if (fv.verified) return 'success';
    return '';
  }

  /** 极简值行 + 点击展开操作区（盒子化重构：标记与操作不糊脸）。 */
  function _pocValueRowHtml(gid, field, fv) {
    const conflicted = _pocConflictFor(gid, field.name, fv.value);
    const dotTone = _pocStatusDotTone(fv, conflicted);
    // encode 而非 NUL 分隔：HTML 属性会吞控制字符，读回的 key 将与 Set 不一致
    const key = encodeURIComponent(`${gid}\u0001${field.name}\u0001${fv.value}`);
    const expanded = _pocExpandedValues.has(key);
    // M5 预留位（specs/014 时间锚）：asOf 时间控件将挂在本详情操作区「编辑这条值」
    // 旁——009 本期只登记挂载位不实现（contracts/renderer-seams.md R1b），不得占用。
    const detail = expanded ? `<div class="personal-onto-value-detail">
        <div class="personal-onto-value-detail-chips">
          ${fv.asOf ? _tag(_tv('personalOntology.asof_chip', { m: fv.asOf }, '截至 {m}')) : ''}
          ${fv.asOf && _pocIsStaleAsOf(fv.asOf) ? _statusPill(_t('personalOntology.stale_chip', '可能过时'), 'attention') : ''}
          ${fv.verified === 'independent' ? _tag(_t('personalOntology.verified_independent_chip', '独立核实过'), 'success') : fv.verified === true ? _tag(_t('personalOntology.verified_chip', '有来源支持'), 'success') : ''}
          ${fv.ruleKind === 'operation' ? _tag(_t('personalOntology.rulekind_operation', '操作规则')) : fv.ruleKind === 'preference' ? _tag(_t('personalOntology.rulekind_preference', '偏好')) : fv.ruleKind === 'constraint' ? _tag(_t('personalOntology.rulekind_constraint', '约束')) : ''}
          ${fv.sensitivity === 'restricted' ? _statusPill(_t('personalOntology.restricted_chip', '受限·不自动注入'), 'attention') : ''}
          ${conflicted ? _statusPill(_t('personalOntology.conflict_chip', '与同字段另一条值矛盾'), 'critical') : ''}
        </div>
        <div class="personal-onto-value-detail-actions">
          ${_button({ label: fv.verified === 'independent' ? _t('personalOntology.unverify_tip', '取消核实') : fv.verified === true ? _t('personalOntology.verify_up_tip', '升级为独立核实') : _t('personalOntology.verify_tip', '标记为已核实'), size: 'sm', className: 'personal-onto-group-action', attrs: { 'data-poc-group-op': 'verify-value', 'data-poc-gid': gid, 'data-poc-field': field.name, 'data-poc-value': String(fv.value || ''), 'data-poc-verified': fv.verified === 'independent' ? '0' : fv.verified === true ? 'independent' : '1' } })}
          ${/→|->/.test(String(fv.value || '')) ? _button({ label: _t('personalOntology.rulekind_cycle_tip', '切换规则分类'), size: 'sm', className: 'personal-onto-group-action', attrs: { 'data-poc-group-op': 'cycle-rulekind', 'data-poc-gid': gid, 'data-poc-field': field.name, 'data-poc-value': String(fv.value || '') } }) : ''}
          ${_button({ label: fv.sensitivity === 'restricted' ? _t('personalOntology.unrestrict_tip', '取消受限') : _t('personalOntology.restrict_tip', '设为受限（不自动注入）'), size: 'sm', className: 'personal-onto-group-action', attrs: { 'data-poc-group-op': 'toggle-restricted', 'data-poc-gid': gid, 'data-poc-field': field.name, 'data-poc-value': String(fv.value || ''), 'data-poc-restricted': fv.sensitivity === 'restricted' ? '0' : '1' } })}
          ${_button({ label: _t('personalOntology.value_edit_tip', '编辑这条值'), size: 'sm', className: 'personal-onto-group-action', attrs: { 'data-poc-group-op': 'edit-value', 'data-poc-gid': gid, 'data-poc-field': field.name, 'data-poc-value': String(fv.value || '') } })}
          ${_button({ label: _t('personalOntology.value_remove_tip', '删除这条值'), size: 'sm', className: 'personal-onto-group-action is-danger', attrs: { 'data-poc-group-op': 'remove-value', 'data-poc-gid': gid, 'data-poc-field': field.name, 'data-poc-value': String(fv.value || '') } })}
        </div>
      </div>` : '';
    return `<div class="personal-onto-value-line${expanded ? ' is-expanded' : ''}${conflicted ? ' is-conflicted' : ''}" data-poc-line-key="${escapeHtml(key)}" role="button" tabindex="0">
        <span class="personal-onto-value-text">${escapeHtml(String(fv.value || ''))}</span>
        <span class="muted personal-onto-value-src">${escapeHtml(String(fv.source || '手动'))}</span>
        ${dotTone ? _statusDot(dotTone) : ''}
      </div>${detail}`;
  }

  /** A 盒（事实）：回流候选 + 会话沉淀伪组（画像资产，六分节） + 各组普通值 + 流水。 */
  function _pocRenderABoxView() {
    if (!_pocBoxData.loaded) return `<div class="personal-onto-empty">${escapeHtml(_t('personalOntology.loading', '加载中...'))}</div>`;
    const isRel = (v) => /→|->/.test(String(v || ''));
    // 会话沉淀伪组：画像资产按六分节（复用既有分节器）
    const sections = _pocProfileSections();
    const profileHtml = sections.length ? sections.map((section) => `
      <div class="personal-onto-abox-subsec" data-poc-ontology-section="${escapeHtml(section.id)}">
        <div class="muted">${escapeHtml(_t(section.titleKey, section.title))}</div>
        ${section.entries.map((e) => `<div class="personal-onto-value-line"><details class="poc-entry"><summary><span class="poc-entry-clamp">${_pocProfileEntryHtml(e)}</span></summary><div class="poc-entry-full">${_pocProfileEntryHtml(e)}</div></details><span class="muted personal-onto-value-src" title="${escapeHtml(_t('personalOntology.abox_asset_src_hint', '这条内容来自正式资产，可在「我的认知」查看全文与来源'))}">${escapeHtml(_t('personalOntology.abox_asset_src', '来自资产'))}</span></div>`).join('')}
      </div>`).join('')
      : `<div class="muted personal-onto-value-empty">${escapeHtml(_t('personalOntology.profile_empty', '完成会话沉淀后，个人信息会显示在这里'))}</div>`;

    const groupHtml = _pocBoxData.groups.map((g) => {
      const fieldHtml = (g.fields || []).map((field) => {
        const rows = (field.values || []).filter((fv) => !isRel(fv.value));
        return `<div class="personal-onto-abox-subsec">
          <div class="personal-onto-abox-subsec-head">
            <span class="muted">${escapeHtml(field.name)}</span>
            ${_button({ label: `＋ ${_t('personalOntology.value_add', '添加值')}`, size: 'sm', className: 'personal-onto-value-add o', attrs: { 'data-poc-group-op': 'append-value', 'data-poc-gid': g.gid, 'data-poc-field': field.name } })}
          </div>
          ${rows.map((fv) => _pocValueRowHtml(g.gid, field, fv)).join('') || `<div class="muted personal-onto-value-empty">${escapeHtml(_t('personalOntology.field_no_values', '尚无值'))}</div>`}
        </div>`;
      }).join('');
      return `<div class="personal-onto-abox-group">
        <div class="personal-onto-abox-group-head">
          <span class="personal-onto-field-name">${escapeHtml(g.title)}</span>
          ${_button({ label: _t('personalOntology.note_append', '记一笔'), size: 'sm', className: 'personal-onto-group-action o', attrs: { 'data-poc-group-op': 'append-entry', 'data-poc-gid': g.gid } })}
        </div>
        ${fieldHtml}
        ${g.entries.length ? `<div class="personal-onto-flow-zone"><div class="muted">${escapeHtml(_t('personalOntology.flow_zone', '流水区'))} <span class="muted">${g.entries.length}</span></div>
          ${g.entries.map((entry) => `<div class="personal-onto-flow-row">${escapeHtml(entry)}</div>`).join('')}</div>` : ''}
      </div>`;
    }).join('');

    return `<section class="personal-onto-box-view">
      ${_pocRenderBackflowCandidates()}
      <div class="personal-onto-zone-head">${escapeHtml(_tv('personalOntology.abox_profile_group_n', { n: _pocProfile.entries.length }, '会话沉淀 · {n} 条'))}</div>
      ${profileHtml}
      ${_pocBoxData.groups.length ? `<div class="personal-onto-zone-head">${escapeHtml(_t('personalOntology.abox_groups', '分组事实'))} <span class="muted">${_pocBoxData.groups.length}</span></div>${groupHtml}` : ''}
    </section>`;
  }

  /** R 盒（规则）：分类筛选 + 各组关系值 + 规则资产。 */
  function _pocRenderRBoxView() {
    if (!_pocBoxData.loaded) return `<div class="personal-onto-empty">${escapeHtml(_t('personalOntology.loading', '加载中...'))}</div>`;
    const isRel = (v) => /→|->/.test(String(v || ''));
    const filter = _pocTriBoxRuleFilter || 'all';
    const KINDS = ['operation', 'preference', 'constraint'];
    const kindLabel = (k) => (k === 'operation' ? _t('personalOntology.rulekind_operation', '操作规则')
      : k === 'preference' ? _t('personalOntology.rulekind_preference', '偏好')
      : _t('personalOntology.rulekind_constraint', '约束'));
    const filterChips = ['all', ...KINDS].map((k) =>
      _button({ label: k === 'all' ? _t('personalOntology.tribox_filter_all', '全部') : kindLabel(k), size: 'sm', className: `personal-onto-filter-chip${filter === k ? ' is-on' : ''}`, attrs: { 'data-poc-tri-filter': k } })).join('');

    let total = 0;
    const groupHtml = _pocBoxData.groups.map((g) => {
      const rows = [];
      for (const field of g.fields) {
        for (const fv of (field.values || [])) {
          if (!isRel(fv.value)) continue;
          if (filter !== 'all' && fv.ruleKind !== filter) continue;
          total += 1;
          rows.push(_pocValueRowHtml(g.gid, field, fv));
        }
      }
      if (!rows.length) return '';
      return `<div class="personal-onto-abox-group">
        <div class="personal-onto-abox-group-head"><span class="personal-onto-field-name">${escapeHtml(g.title)}</span></div>
        ${rows.join('')}
      </div>`;
    }).join('');
    const ruleAssets = (filter === 'all' ? _pocBoxData.assets.filter((a) => a.type === 'rule') : []);
    total += ruleAssets.length;

    return `<section class="personal-onto-box-view">
      <div class="personal-onto-zone-head">${escapeHtml(_t('personalOntology.rbox_rules', '规则'))} <span class="muted">${total}</span></div>
      <div class="personal-onto-filter-row">${filterChips}</div>
      ${groupHtml || ''}
      ${ruleAssets.length ? `<div class="personal-onto-abox-group">
        <div class="personal-onto-abox-group-head"><span class="personal-onto-field-name">${escapeHtml(_t('personalOntology.rbox_from_assets', '资产沉淀的规则'))}</span></div>
        ${ruleAssets.map((a) => `<div class="personal-onto-value-line"><span class="personal-onto-value-text">${escapeHtml(String(a.statement || ''))}</span><span class="muted personal-onto-value-src">${escapeHtml(_t('personalOntology.abox_asset_src', '资产'))}</span></div>`).join('')}
      </div>` : ''}
      ${!total ? `<div class="muted personal-onto-value-empty">${escapeHtml(_t('personalOntology.tribox_empty', '暂无内容'))}</div>` : ''}
    </section>`;
  }

  /** D5b：「已删除分组」折叠块（T 盒组管理区）。收起 = 一个入口按钮；展开 =
   *  每组一行（标题 / 删除时刻 / 快照数 + 恢复按钮）或空态（_emptyState）。 */
  function _pocRenderDeletedGroupsHtml() {
    const dg = _pocDeletedGroups;
    const toggle = _button({
      label: _t('personalOntology.group_deleted_list', '已删除分组'),
      icon: 'archive',
      iconEnd: dg.open ? 'chevron-down' : 'chevron-right',
      size: 'sm',
      className: 'personal-onto-deleted-toggle',
      attrs: { 'data-poc-deleted-op': 'toggle' },
    });
    if (!dg.open) return `<div class="personal-onto-deleted-zone">${toggle}</div>`;
    const rows = (dg.list || []).map((g) => `<div class="personal-onto-deleted-row">
        <span class="personal-onto-deleted-title">${escapeHtml(String((g && g.title) || (g && g.groupId) || ''))}</span>
        <span class="muted personal-onto-deleted-meta">${escapeHtml(String((g && g.deletedAt) || ''))} · ${Number((g && g.snapshotCount) || 0)}</span>
        ${_button({ label: _t('personalOntology.group_deleted_restore', '恢复这个分组'), size: 'sm', className: 'personal-onto-group-action', attrs: { 'data-poc-deleted-op': 'restore', 'data-poc-gid': String((g && g.groupId) || '') } })}
      </div>`).join('');
    const body = dg.loadError
      ? `<div class="muted" role="alert">${escapeHtml(dg.loadError)}</div>`
      : rows || _emptyState({ kind: 'quiet', title: _t('personalOntology.group_deleted_empty', '没有已删除的分组') });
    return `<div class="personal-onto-deleted-zone is-open">${toggle}
      <div class="personal-onto-deleted-body">${body}</div>
    </div>`;
  }

  /** T 盒（词汇）：组词汇卡（字段名+描述+组操作）+ 角色模板 + 模板库。 */
  function _pocRenderTBoxView() {
    const installedTmpls = _pocTemplates.filter((t) => t.installed);
    const cards = _pocBoxData.groups.map((g) => `<div class="personal-onto-field-block">
        <div class="personal-onto-abox-group-head">
          <span class="personal-onto-field-name">${escapeHtml(g.title)}</span>
          <span>
            ${_button({ label: _t('personalOntology.field_add', '＋ 新字段'), size: 'sm', className: 'personal-onto-group-action', attrs: { 'data-poc-group-op': 'add-field', 'data-poc-gid': g.gid } })}
            ${_button({ label: _t('personalOntology.group_rename', '重命名'), size: 'sm', className: 'personal-onto-group-action', attrs: { 'data-poc-group-op': 'rename-group', 'data-poc-gid': g.gid } })}
            ${_button({ label: _t('personalOntology.group_history', '历史'), size: 'sm', className: 'personal-onto-group-action', attrs: { 'data-poc-group-op': 'show-history', 'data-poc-gid': g.gid } })}
            ${_button({ label: _t('personalOntology.group_delete', '删除分组'), size: 'sm', className: 'personal-onto-group-action is-danger', attrs: { 'data-poc-group-op': 'delete-group', 'data-poc-gid': g.gid } })}
          </span>
        </div>
        ${(g.fields || []).map((f) => `<div class="personal-onto-tbox-field">
          <span>${escapeHtml(f.name)}</span>
          ${f.isRelation ? _tag(_t('personalOntology.tbox_relation_flag', '关系字段')) : ''}
          ${f.description ? `<span class="muted personal-onto-field-desc">${escapeHtml(String(f.description))}</span>` : ''}
        </div>`).join('') || `<div class="muted personal-onto-value-empty">${escapeHtml(_t('personalOntology.field_no_values', '尚无值'))}</div>`}
      </div>`).join('');

    return `<section class="personal-onto-box-view">
      <div class="personal-onto-zone-head">${escapeHtml(_t('personalOntology.tbox_groups', '分组词汇'))} <span class="muted">${_pocBoxData.groups.length}</span></div>
      ${_button({ label: _t('personalOntology.group_new', '新建分组'), size: 'sm', className: 'personal-onto-group-new-btn', attrs: { 'data-poc-nav': 'new-group' } })}
      ${cards || `<div class="muted personal-onto-value-empty">${escapeHtml(_t('personalOntology.groups_empty', '还没有分组'))}</div>`}
      ${_pocRenderDeletedGroupsHtml()}
      <div class="personal-onto-zone-head">${escapeHtml(_t('personalOntology.nav_templates', '角色模板'))} <span class="muted">${installedTmpls.length}</span></div>
      ${installedTmpls.map((tmpl) => `<div class="personal-onto-nav-template-row">
          <button type="button" class="personal-onto-nav-row is-file" data-poc-nav="template" data-poc-id="${escapeHtml(tmpl.group_id || '')}">
            <span class="personal-onto-nav-file-icon">${_icon('file-text', 'ui-icon')}</span>
            <span class="personal-onto-nav-row-text">${escapeHtml(tmpl.name)}</span>
            <span class="memory-template-name-suffix">${escapeHtml(_t('memory.templates_suffix', '模板'))}</span>
          </button>
          ${_iconButton({ label: _t('personalOntology.template_uninstall_tip', '卸载（数据归档保留）'), icon: 'x', variant: 'danger', className: 'personal-onto-template-uninstall', attrs: { 'data-poc-nav': 'template-uninstall', 'data-poc-template-id': tmpl.template_id } })}
        </div>`).join('') || `<div class="muted personal-onto-value-empty">${escapeHtml(_t('personalOntology.dest_no_roles', '尚未安装角色模板，可在「角色模板库」中安装'))}</div>`}
      <button type="button" class="personal-onto-template-library-btn" data-poc-nav="template-library">
        ${_icon('package', 'ui-icon personal-onto-template-library-icon')}
        <span>${_t('personalOntology.template_library', '角色模板库')}</span>
      </button>
    </section>`;
  }
  async function _pocLoadPendingCandidates() {    const res = await _pocInvoke('personalOntology.candidates.list', {});
    _pocCandidatesLoaded = true;
    _pocPendingCandidates = res && Array.isArray(res.candidates) ? res.candidates : [];
    return true;
  }  /** 回流候选确认区（组详情顶部）：确认=写入本组（toGlobalMemory=false），
   *  消化=reject 移出池。回流内容源自资产，确认去向不该再进资产库。 */
  function _pocRenderBackflowCandidates() {
    if (!_pocPendingCandidates.length) return '';
    const rows = _pocPendingCandidates.map((c) => {
      const text = String((c && c.memory_text) || (c && c.summary) || '').trim();
      if (!text) return '';
      const id = String(c.candidate_id || '');
      return `<div class="personal-onto-backflow-row" data-poc-candidate-id="${escapeHtml(id)}">
        ${_tag(_t('personalOntology.backflow_chip', '回流候选'))}
        <span class="personal-onto-backflow-text">${escapeHtml(text)}</span>
        <span class="personal-onto-backflow-actions">
          ${_pocBoxData.groups.map((g) => _button({ label: _tv('personalOntology.backflow_to', { g: g.title }, '写入：{g}'), size: 'sm', className: 'personal-onto-group-action', attrs: { 'data-poc-candidate-op': 'confirm', 'data-poc-candidate-id': id, 'data-poc-gid': g.gid } })).join('')}
          ${_button({ label: _t('personalOntology.backflow_reject', '不用了'), size: 'sm', className: 'personal-onto-group-action is-ghost', attrs: { 'data-poc-candidate-op': 'reject', 'data-poc-candidate-id': id } })}
        </span>
      </div>`;
    }).join('');
    return `<section class="personal-onto-backflow-zone" aria-label="${escapeHtml(_t('personalOntology.backflow_zone_title', '待确认回流'))}">
      <div class="personal-onto-field-name">${escapeHtml(_t('personalOntology.backflow_zone_title', '待确认回流'))} <span class="muted">${_pocPendingCandidates.length}</span></div>
      ${rows}
    </section>`;
  }


  // ── 本体分组子页操作（IPC 全部复用既有通道，后端零改动）──────────────
  async function _pocCreateGroupPrompt() {
    const title = (typeof uiPrompt === 'function')
      ? await uiPrompt(_t('personalOntology.group_new_prompt', '分组名称'), '')
      : null;
    if (title === null) return;
    const trimmed = String(title || '').trim();
    if (!trimmed) return;
    const res = await _pocInvoke('personalOntology.groups.create', { title: trimmed });
    if (!res || res.ok === false) {
      _pocToast('personalOntology.op_failed', (res && res.error) || '操作失败', 'error');
      return;
    }
    await _pocReloadBoxData();
    _pocToast('personalOntology.group_created', '分组已创建，可在词汇盒维护字段', 'success');
  }

  async function _pocRenameGroupPrompt(gid) {
    const meta = _pocGroups.list.find((g) => g.group_id === gid);
    if (!meta) return;
    const title = (typeof uiPrompt === 'function')
      ? await uiPrompt(_t('personalOntology.group_new_prompt', '分组名称'), meta.title || gid)
      : null;
    if (title === null) return;
    const trimmed = String(title || '').trim();
    if (!trimmed) return;
    const res = await _pocInvoke('personalOntology.groups.rename', { groupId: gid, title: trimmed });
    if (!res || res.ok === false) {
      _pocToast('personalOntology.op_failed', (res && res.error) || '操作失败', 'error');
      return;
    }
    await _pocReloadBoxData();
    _pocRenderNav();
    _pocBindNav();
    _pocRenderMain();
  }

  async function _pocDeleteGroupConfirm(gid) {
    if (!gid) return;
    // US-102 T022 + T027（D5b）：如实说明后果（分组文件删除）与恢复路径
    //（删前快照留档在本机，T021 保证），并指向「已删除分组」恢复入口。
    const confirmMsg = _t('personalOntology.group_delete_confirm', '删除后分组文件（含全部字段与流水）将被删除；删除前的历史快照保留在本机，可在词汇盒「已删除分组」入口恢复。');
    const ok = (typeof uiConfirmDanger === 'function')
      ? await uiConfirmDanger({
        title: _t('personalOntology.group_delete', '删除分组'),
        message: confirmMsg,
        dangerLabel: _t('personalOntology.group_delete', '删除分组'),
      })
      : (typeof uiConfirm === 'function' ? await uiConfirm({ message: confirmMsg }) : true);
    if (!ok) return;
    const res = await _pocInvoke('personalOntology.groups.delete', { groupId: gid });
    if (!res || res.ok === false) {
      _pocToast('personalOntology.op_failed', (res && res.error) || '操作失败', 'error');
      return;
    }
    // 组已从台账消失：分组列表缓存必须失效重读，否则已删的组卡残留（幽灵卡）。
    _pocGroups = { list: [], loaded: false, loadError: '' };
    await _pocReloadBoxData();
    renderPersonalOntology();
  }

  // ── 已删除分组（D5b / spec 009 T027）：折叠入口 + 恢复 ──────────────────
  // 数据来源是 deleteGroup 刻意保留的 .history/<groupId>/（删前快照 + 台账）；
  // 恢复复用既有 history.restore 通道——主进程在 meta 缺失分支重建组（T025）。

  /** 拉「已删除分组」列表（展开时 / 恢复后刷新）。失败可见：loadError 在
   *  打开态里呈现，不静默吞（禁 .catch(() => {}) 式静默）。 */
  async function _pocLoadDeletedGroups() {
    const res = await _pocInvoke('personalOntology.groups.deleted.list', {});
    if (!res || res.ok === false || !Array.isArray(res.deleted)) {
      _pocDeletedGroups = {
        open: true,
        loaded: true,
        loadError: (res && res.error) || _t('personalOntology.load_error', '加载失败'),
        list: [],
      };
      return false;
    }
    _pocDeletedGroups = { open: true, loaded: true, loadError: '', list: res.deleted };
    return true;
  }

  /** 折叠开关：收起就地；展开用已拉到的列表，首次展开才发请求。 */
  async function _pocToggleDeletedGroups() {
    if (_pocDeletedGroups.open) {
      _pocDeletedGroups = { ..._pocDeletedGroups, open: false };
    } else if (_pocDeletedGroups.loaded) {
      _pocDeletedGroups = { ..._pocDeletedGroups, open: true };
    } else {
      await _pocLoadDeletedGroups();
    }
    _pocRenderMain();
  }

  /** 恢复一个已删除分组：history.list 取最新一版（= 删除前最后一版）的
   *  snapshotId → 复用 history.restore（主进程重建 meta 后写回快照）。
   *  成功的反馈就是分组卡回到列表、该行从已删除列表消失；失败必须可见。 */
  async function _pocRestoreDeletedGroup(el, gid) {
    if (!gid) return;
    await _pocRunOnce(`deleted-restore:${gid}`, el, async () => {
      const histRes = await _pocInvoke('personalOntology.groups.history.list', { groupId: gid });
      const newest = histRes && Array.isArray(histRes.history) && histRes.history.length
        ? histRes.history[0] // 新→旧排序：[0] 即删除前最后一版
        : null;
      if (!newest || !newest.id) {
        _pocToast('personalOntology.op_failed', '操作失败', 'error');
        return;
      }
      const res = await _pocInvoke('personalOntology.groups.history.restore', {
        groupId: gid, snapshotId: String(newest.id),
      });
      if (!res || res.ok === false) {
        // 失败按码可见（同名冲突 = 唯一新增码 group already exists，走同一
        // 条 op_failed 通道；文案四语预算只给 D5b 三键，不另立词条）。
        _pocToast('personalOntology.op_failed', (res && res.error) || '操作失败', 'error');
        return;
      }
      // 组回到台账：分组列表缓存必须失效重读，否则恢复的组不出现（幽灵反向）。
      _pocGroups = { list: [], loaded: false, loadError: '' };
      await _pocReloadBoxData();
      await _pocLoadDeletedGroups(); // 已删除列表刷新（该组已不在其中）
      _pocRenderNav();
      _pocBindNav();
      _pocRenderMain(); // 折叠块已换新列表，主区要跟着重渲染一次
    });
  }

  async function _pocAppendValuePrompt(fieldName, gid) {
    if (!gid) return;
    const value = (typeof uiPrompt === 'function')
      ? await uiPrompt(`${_t('personalOntology.value_add', '添加值')} · ${fieldName}`, '')
      : null;
    if (value === null) return;
    const trimmed = String(value || '').trim();
    if (!trimmed) return;
    const res = await _pocInvoke('personalOntology.groups.fields.append', {
      groupId: gid, fieldName, value: trimmed, source: '手动',
    });
    if (!res || res.ok === false) {
      _pocToast('personalOntology.op_failed', (res && res.error) || '操作失败', 'error');
      return;
    }
    // 关系值形状提示（spec 007 T103）：A → B 形状的值保存即成规则，读取侧
    // ontology-rules 自动解析进世界模型——用户第一次有 R 盒的界面入口。
    if (/→|->/.test(trimmed)) {
      _pocToast('personalOntology.rule_saved', '已按规则保存（A → B）：将作为规则进入世界模型', 'success');
    }
    await _pocReloadBoxData();
  }

  async function _pocAddFieldPrompt(gid) {
    if (!gid) return;
    const fieldName = (typeof uiPrompt === 'function')
      ? await uiPrompt(_t('personalOntology.field_name_prompt', '字段名（如：居住地 / 就读状态）· 值可写 A → B 成为规则'), '')
      : null;
    if (fieldName === null) return;
    const trimmedName = String(fieldName || '').trim();
    if (!trimmedName) return;
    const value = (typeof uiPrompt === 'function')
      ? await uiPrompt(_t('personalOntology.value_add', '添加值'), '')
      : null;
    if (value === null) return;
    const trimmedValue = String(value || '').trim();
    if (!trimmedValue) return;
    const res = await _pocInvoke('personalOntology.groups.fields.append', {
      groupId: gid, fieldName: trimmedName, value: trimmedValue, source: '手动',
    });
    if (!res || res.ok === false) {
      _pocToast('personalOntology.op_failed', (res && res.error) || '操作失败', 'error');
      return;
    }
    await _pocReloadBoxData();
  }

  /** US-101 条目级编辑 + US-901 时间锚录入口（specs/014 T009）：共享弹层
   *  （uiModal + uiField）双字段——值（必填，预填原值）+「信息截至时间」
   *  （可选，预填既有 asOf）。B1① 的分开表达：时间栏没动 = 保留（不发 asOf）；
   *  清空 = 显式删除（clearAsOf:true）；改了 = 设置。非法格式就地提示、不发
   *  请求；空值/与原值相同仍走 009 的既有短路口径。 */
  async function _pocEditValuePrompt(fieldName, value, gid, currentAsOf) {
    if (!gid) return;
    const oldValue = String(value || '');
    const existingAsOf = String(currentAsOf || '');
    if (typeof window.uiModal !== 'function') {
      // 极简上下文（无弹层原语）退回 009 的单字段形态——能力降级，不是死路。
      const next = (typeof uiPrompt === 'function')
        ? await uiPrompt(_t('personalOntology.value_edit_tip', '编辑这条值'), oldValue)
        : null;
      if (next === null) return; // 用户取消不是失败，不报错（与 append/remove 同口径）
      const trimmed = String(next || '').trim();
      if (!trimmed) {
        _pocToast('personalOntology.value_empty_error', '值不能为空，未保存', 'error');
        return;
      }
      if (trimmed === oldValue) {
        _pocToast('personalOntology.value_unchanged_hint', '内容没有变化', 'info');
        return;
      }
      if (await _pocGroupAction('personalOntology.groups.fields.setValue', { groupId: gid, fieldName, value: trimmed, oldValue })) {
        _pocToast('personalOntology.field_value_updated', '已更新');
        await _pocReloadBoxData();
      }
      return;
    }
    const valueId = `poc-edit-value-${gid}`;
    const asOfId = `poc-edit-asof-${gid}`;
    const fieldHtml = (id, label, inputValue, hint) => (typeof window.uiField === 'function'
      ? window.uiField({ id, label, ...(hint ? { hint } : {}), control: { id, value: inputValue, ...(id === asOfId ? { placeholder: 'YYYY-MM' } : {}) } })
      : `<label class="field"><span>${escapeHtml(label)}</span>${_input({ id, value: inputValue, ...(id === asOfId ? { attrs: { placeholder: 'YYYY-MM' } } : {}) })}</label>`);
    const dialog = await window.uiModal({
      title: _t('personalOntology.value_edit_tip', '编辑这条值'),
      closeLabel: _t('personalOntology.dialog_close', '关闭'),
      bodyHtml: `<div class="personal-onto-edit-fields">
        ${fieldHtml(valueId, _t('personalOntology.value_edit_field_label', '值'), oldValue)}
        ${fieldHtml(asOfId, _t('personalOntology.value_edit_asof_label', '信息截至时间（可选）'), existingAsOf, _t('personalOntology.value_edit_asof_hint', '格式 YYYY-MM；清空并保存 = 删除时间标注；不动 = 保留'))}
      </div>`,
      actions: [
        { label: _t('common.cancel', '取消'), id: 'cancel', role: 'secondary' },
        { label: _t('personalOntology.value_edit_save', '保存'), id: 'save', role: 'primary' },
      ],
    });
    if (!dialog || dialog.value !== 'save') return; // 取消不是失败，不报错
    const valueEl = document.getElementById(valueId);
    const asOfEl = document.getElementById(asOfId);
    const trimmed = String((valueEl && valueEl.value) || '').trim();
    const nextAsOf = String((asOfEl && asOfEl.value) || '').trim();
    if (!trimmed) {
      _pocToast('personalOntology.value_empty_error', '值不能为空，未保存', 'error');
      return;
    }
    if (trimmed === oldValue && nextAsOf === existingAsOf) {
      _pocToast('personalOntology.value_unchanged_hint', '内容没有变化', 'info');
      return;
    }
    // 提交前格式预校验（M11 口径）：非法就地提示，不发请求。
    if (nextAsOf && !/^((?:19|20)\d{2})-(0[1-9]|1[0-2])$/.test(nextAsOf)) {
      _pocToast('personalOntology.asof_invalid_error', '时间格式应为 YYYY-MM（如 2026-09），未保存', 'error');
      return;
    }
    // B1① 分开表达：没动时间栏 = 不发 asOf/clearAsOf；清空 = clearAsOf；改了 = asOf。
    const payload = { groupId: gid, fieldName, value: trimmed, oldValue };
    if (nextAsOf !== existingAsOf) {
      if (nextAsOf) payload.asOf = nextAsOf;
      else payload.clearAsOf = true;
    }
    if (await _pocGroupAction('personalOntology.groups.fields.setValue', payload)) {
      _pocToast('personalOntology.field_value_updated', '已更新');
      await _pocReloadBoxData();
    }
  }

  async function _pocRemoveValue(fieldName, value, gid) {
    if (!gid) return;
    const res = await _pocInvoke('personalOntology.groups.fields.removeValue', {
      groupId: gid, fieldName, value,
    });
    if (!res || res.ok === false) {
      _pocToast('personalOntology.op_failed', (res && res.error) || '操作失败', 'error');
      return;
    }
    // 矛盾台账自愈在下次读取发生；值删掉后红标随重载消失。
    await _pocReloadBoxData();
  }

  /** 台账动作可读化（US-102 T023）：已知枚举走四语词条（内联「键+中文兜底」
   *  写法让 i18n 覆盖门禁可扫）；未知 action 原样显示（如实呈现，不臆造标签）。
   *  枚举对齐主进程 appendOntologyAudit 调用集。 */
  const _POC_AUDIT_ACTIONS = {
    value_add: ['personalOntology.history_audit_action_value_add', '添加值'],
    value_edit: ['personalOntology.history_audit_action_value_edit', '编辑值'],
    value_remove: ['personalOntology.history_audit_action_value_remove', '删除值'],
    field_remove: ['personalOntology.history_audit_action_field_remove', '删除字段'],
    entry_promote: ['personalOntology.history_audit_action_entry_promote', '流水升格'],
    group_rename: ['personalOntology.history_audit_action_group_rename', '重命名分组'],
    group_delete: ['personalOntology.history_audit_action_group_delete', '删除分组'],
    snapshot_restore: ['personalOntology.history_audit_action_snapshot_restore', '恢复快照'],
  };

  /** 历史版旁的台账摘要行（US-102 T023）：「谁 · 何时 · 改的哪个字段」。
   *  audit 是 history.list 的可选附加字段（取不到不带键）——没有台账的
   *  版本返回空串，**不渲染空行**；history[] 既有字段零改动。 */
  function _pocHistoryAuditHtml(audit) {
    if (!audit || typeof audit !== 'object') return '';
    const mapped = _POC_AUDIT_ACTIONS[audit.action];
    const actionLabel = mapped ? _t(mapped[0], mapped[1]) : String(audit.action || '');
    if (!actionLabel) return '';
    // 台账 actor 恒为 'user'（本地单用户，主进程写死）——audit 摘要里不重复
    // 携带该字段，展示层固定「用户」标签。
    const field = audit.field ? String(audit.field) : '';
    const at = audit.at ? String(audit.at) : '';
    return `<div class="personal-onto-value-detail-chips personal-onto-history-audit">
      ${_tag(_t('personalOntology.history_audit_actor_user', '用户'))}
      ${_tag(actionLabel)}
      ${field ? _tag(field) : ''}
      ${at ? `<span class="muted personal-onto-history-audit-at">${escapeHtml(at)}</span>` : ''}
    </div>`;
  }

  /** 组变更历史（spec 007 T304）：列表 + 恢复（当前版自动留档可再回滚）。 */
  async function _pocShowGroupHistory(gid) {
    if (!gid) return;
    const res = await _pocInvoke('personalOntology.groups.history.list', { groupId: gid });
    const history = res && Array.isArray(res.history) ? res.history : [];
    const rows = history.length ? history.map((h) => `
      <div class="personal-onto-history-row">
        <span class="personal-onto-history-time">${escapeHtml(String(h.savedAt || h.id))}</span>
        <span class="personal-onto-history-preview muted">${escapeHtml(String(h.preview || ''))}</span>
        ${_button({ label: _t('personalOntology.group_restore', '恢复这版'), size: 'sm', className: 'personal-onto-group-action', attrs: { 'data-poc-group-op': 'restore-snapshot', 'data-poc-snapshot': String(h.id) } })}
      </div>
      ${_pocHistoryAuditHtml(h.audit)}`).join('')
      : `<div class="muted">${escapeHtml(_t('personalOntology.group_history_empty', '还没有历史版本——修改分组内容后自动留档'))}</div>`;
    // 复用模板库弹层骨架：独立简易 modal
    const overlay = document.getElementById('personal-onto-modal');
    const body = document.querySelector('.personal-onto-modal-body');
    if (!overlay || !body) return;
    body.innerHTML = `<div class="personal-onto-history-list">
      <div class="personal-onto-field-name">${escapeHtml(_t('personalOntology.group_history', '历史'))} <span class="muted">${history.length}</span></div>
      ${rows}
    </div>`;
    overlay.style.display = 'flex';
    // 恢复按钮绑定：此处原调用 _pocBindGroupDetail——盒子化重构后该函数已
    // 不存在（死引用），modal 显示了但「恢复这版」从未绑上点击（US-102 T024
    // 修复：按既有组操作口径就地绑定，闭包携带 gid）。
    body.querySelectorAll('[data-poc-group-op="restore-snapshot"]').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        void _pocRestoreSnapshot(el, gid);
      });
    });
  }

  async function _pocRestoreSnapshot(el, gid) {
    if (!gid) return;
    const snapshotId = el.getAttribute('data-poc-snapshot');
    if (!snapshotId) return;
    await _pocRunOnce(`restore:${snapshotId}`, el, async () => {
      const res = await _pocInvoke('personalOntology.groups.history.restore', {
        groupId: gid, snapshotId,
      });
      if (!res || res.ok === false) {
        _pocToast('personalOntology.op_failed', (res && res.error) || '操作失败', 'error');
        return;
      }
      _pocToast('personalOntology.group_restored', '已恢复到该版本（当前版已自动留档）', 'success');
      const overlay = document.getElementById('personal-onto-modal');
      if (overlay) overlay.style.display = 'none';
      await _pocReloadBoxData();
    });
  }

  /** 规则分类循环（spec 007 T301）：无 → 操作规则 → 偏好 → 约束 → 无。 */
  async function _pocCycleRuleKind(el, fieldName, value, gid) {
    if (!gid) return;
    await _pocRunOnce(`rulekind:${fieldName}:${value}`, el, async () => {
      const res = await _pocInvoke('personalOntology.groups.fields.cycleRuleKind', {
        groupId: gid, fieldName, value,
      });
      if (!res || res.ok === false) {
        _pocToast('personalOntology.op_failed', (res && res.error) || '操作失败', 'error');
        return;
      }
      await _pocReloadBoxData();
    });
  }

  /** 敏感性 toggle（spec 007 T302）：受限值不进任务自动注入与世界模型。 */
  async function _pocToggleRestricted(el, fieldName, value, gid) {
    if (!gid) return;
    const next = el.getAttribute('data-poc-restricted') === '1';
    await _pocRunOnce(`restricted:${fieldName}:${value}`, el, async () => {
      const res = await _pocInvoke('personalOntology.groups.fields.sensitivity', {
        groupId: gid, fieldName, value, restricted: next,
      });
      if (!res || res.ok === false) {
        _pocToast('personalOntology.op_failed', (res && res.error) || '操作失败', 'error');
        return;
      }
      _pocToast('personalOntology.restricted_' + (next ? 'on' : 'off'),
        next ? '已设为受限：不再进入任务自动注入与世界模型' : '已取消受限', 'success');
      await _pocReloadBoxData();
    });
  }

  /** 核实档 toggle（2026-09-20 断言核实维度；spec 007 两档三态循环）：
   *  未核实 → 有来源支持 → 独立核实 → 取消。章只由用户这一下产生。 */
  async function _pocToggleValueVerified(el, fieldName, value, gid) {
    if (!gid) return;
    const raw = el.getAttribute('data-poc-verified');
    const nextVerified = raw === 'independent' ? 'independent' : raw === '1';
    await _pocRunOnce(`verify:${fieldName}:${value}`, el, async () => {
      const res = await _pocInvoke('personalOntology.groups.fields.verify', {
        groupId: gid, fieldName, value, verified: nextVerified,
      });
      if (!res || res.ok === false) {
        _pocToast('personalOntology.op_failed', (res && res.error) || '操作失败', 'error');
        return;
      }
      await _pocReloadBoxData();
    });
  }

  async function _pocAppendEntryNote(gid) {
    if (!gid) return;
    const input = document.getElementById('personal-onto-note-input');
    const text = input ? String(input.value || '').trim() : '';
    if (!text) return;
    const readRes = await _pocInvoke('personalOntology.groups.read', { groupId: gid });
    const base = String((readRes && readRes.content) || '');
    const content = `${base.trimEnd()}\n§ ${text}\n`;
    const res = await _pocInvoke('personalOntology.groups.write', { groupId: gid, content });
    if (!res || res.ok === false) {
      _pocToast('personalOntology.op_failed', (res && res.error) || '操作失败', 'error');
      return;
    }
    await _pocReloadBoxData();
  }

  async function _pocConfirmBackflow(candidateId, gid, el) {
    if (!gid) return;
    await _pocRunOnce(`backflow-confirm:${candidateId}`, el, async () => {
      const res = await _pocInvoke('personalOntology.candidates.confirm', {
        candidateId,
        dest: { toGlobalMemory: false, toGroupIds: [gid] },
      });
      if (res && res.ok === false && res.error === 'conflict_detected') {
        // 写入前冲突门（specs/014 US-902 / T016）：可能矛盾 → 对话确认，
        // 不静默写入。「仍然写入」带 acknowledgeConflict:true 重发（主进程
        // 会以写入时刻重新预检）。受限对端没有正文可显示，用替代文案。
        const conflicts = Array.isArray(res.conflicts) ? res.conflicts : [];
        const shown = conflicts.length
          ? conflicts[0].existingValue
            ? _tv('personalOntology.conflict_dialog_body_with_values', { field: String(conflicts[0].field || ''), existing: String(conflicts[0].existingValue || '') }, '字段「{field}」里已有语义相近的值（{existing}）。写入前请确认——这不是判定，只是提醒。')
            : _t('personalOntology.conflict_dialog_body_restricted_pair', '字段里已有语义相近的值（另一条已标记受限，内容不显示）。写入前请确认。')
          : _t('personalOntology.conflict_dialog_body_generic', '这条候选可能与组里已有的值语义相近，写入前请确认。');
        if (typeof window.uiModal !== 'function') {
          // 无弹层原语的极简上下文：退回普通 toast 提示且不写入（宁可多一步，
          // 不静默）。
          _pocToast('personalOntology.conflict_dialog_title', '可能与现有值矛盾', 'error');
          return;
        }
        const dialog = await window.uiModal({
          title: _t('personalOntology.conflict_dialog_title', '可能与现有值矛盾'),
          closeLabel: _t('personalOntology.dialog_close', '关闭'),
          description: shown,
          actions: [
            { label: _t('common.cancel', '取消'), id: 'cancel', role: 'secondary' },
            { label: _t('personalOntology.conflict_dialog_keep', '仍然写入'), id: 'keep', role: 'primary' },
          ],
        });
        if (!dialog || dialog.value !== 'keep') return; // 取消：不发第二次请求
        const retry = await _pocInvoke('personalOntology.candidates.confirm', {
          candidateId,
          dest: { toGlobalMemory: false, toGroupIds: [gid] },
          acknowledgeConflict: true,
        });
        if (!retry || retry.ok === false) {
          _pocToast('personalOntology.op_failed', (retry && retry.error) || '操作失败', 'error');
          return;
        }
        _pocToast('personalOntology.backflow_confirmed', '已写入所选分组（流水区，可升格为字段值）', 'success');
        await _pocLoadPendingCandidates();
        await _pocReloadBoxData();
        _pocRenderNav();
        _pocBindNav();
        return;
      }
      if (!res || res.ok === false) {
        _pocToast('personalOntology.op_failed', (res && res.error) || '操作失败', 'error');
        return;
      }
      _pocToast('personalOntology.backflow_confirmed', '已写入所选分组（流水区，可升格为字段值）', 'success');
      await _pocLoadPendingCandidates();
      await _pocReloadBoxData();
      _pocRenderNav();
      _pocBindNav();
    });
  }

  async function _pocRejectBackflow(candidateId, el) {
    await _pocRunOnce(`backflow-reject:${candidateId}`, el, async () => {
      const res = await _pocInvoke('personalOntology.candidates.reject', { candidateId });
      if (!res || res.ok === false) {
        _pocToast('personalOntology.op_failed', (res && res.error) || '操作失败', 'error');
        return;
      }
      await _pocLoadPendingCandidates();
      _pocRenderNav();
      _pocBindNav();
      _pocRenderMain();
    });
  }

  function _pocRenderMain() {
    const headerEl = document.getElementById('personal-onto-main-header');
    const bodyEl = document.getElementById('personal-onto-main-body');
    if (!headerEl || !bodyEl) return;

    if (_pocSelected.kind === 'tbox' || _pocSelected.kind === 'abox' || _pocSelected.kind === 'rbox') {
      headerEl.classList.remove('is-profile');
      /* 三个盒子的页头此前是空字符串——整页没有一句「这里是干什么」，
         词汇/事实/规则全靠猜（2026-09-21 子安真机反馈「看不懂」）。 */
      const counts = _pocBoxCounts();
      const boxInfo = {
        tbox: { title: _t('personalOntology.nav_tbox', '统一词表'), n: counts.tbox, unit: '项', def: _t('personalOntology.box_tbox_def', '系统描述你时用的一致用词，避免同一个意思多种叫法') },
        abox: { title: _t('personalOntology.nav_abox', '我是谁'), n: counts.abox, unit: '条', def: _t('personalOntology.box_abox_def', '关于你的稳定事实——身份、角色、项目与关系，AI 在任务里会长期使用') },
        rbox: { title: _t('personalOntology.nav_rbox', '我偏好什么'), n: counts.rbox, unit: '条', def: _t('personalOntology.box_rbox_def', '带条件的行为规则——AI 该怎么配合你做事、什么别做') },
      }[_pocSelected.kind];
      headerEl.innerHTML = `<span class="personal-onto-main-title">${escapeHtml(boxInfo.title)}</span>` +
        `<div class="sub">${escapeHtml(boxInfo.def)} · ${boxInfo.n} ${boxInfo.unit}</div>`;
      bodyEl.innerHTML = _pocSelected.kind === 'tbox' ? _pocRenderTBoxView()
        : _pocSelected.kind === 'abox' ? _pocRenderABoxView()
        : _pocRenderRBoxView();
      _pocBindBoxView(bodyEl);
      return;
    }
    headerEl.classList.remove('is-profile');
    if (_pocSelected.kind === 'template' && _pocGroupEditor) {
      headerEl.innerHTML = `<span class="personal-onto-main-title">${escapeHtml(_pocGroupEditor.title || _t('personalOntology.nav_templates', '角色模板'))}</span>`;
      bodyEl.innerHTML = _pocRenderGroupEditorHtml();
      _pocBindGroupEditor(bodyEl);
      return;
    }
    headerEl.innerHTML = `<span class="personal-onto-main-title">${escapeHtml(_t('personalOntology.nav_templates', '角色模板'))}</span>`;
    bodyEl.innerHTML = `<div class="personal-onto-empty personal-onto-template-empty">${_emptyState({
      kind: 'actionable',
      title: _t('personalOntology.dest_no_roles', '尚未安装角色模板，可在「角色模板库」中安装'),
      icon: 'package',
      action: { label: _t('personalOntology.template_library', '角色模板库'), icon: 'package', size: 'sm', attrs: { id: 'personal-onto-empty-open-library' } },
    })}</div>`;
    const emptyOpen = document.getElementById('personal-onto-empty-open-library');
    if (emptyOpen) emptyOpen.addEventListener('click', () => _pocOpenTemplateLibrary());
  }

  function _pocRenderTemplatesLoadError() {
    const nav = document.getElementById('personal-onto-nav');
    const headerEl = document.getElementById('personal-onto-main-header');
    const bodyEl = document.getElementById('personal-onto-main-body');
    if (!nav || !headerEl || !bodyEl) return;
    const error = escapeHtml(_pocTemplatesLoadError || _t('personalOntology.load_error', '加载失败'));
    headerEl.innerHTML = `<span class="personal-onto-main-title">${escapeHtml(_t('personalOntology.nav_templates', '角色模板'))}</span>`;
    nav.innerHTML = `<div class="personal-onto-nav-empty personal-onto-load-error" role="alert">${error}</div>`;
    bodyEl.innerHTML = `<div class="personal-onto-empty personal-onto-load-error" role="alert">${_emptyState({
      kind: 'actionable',
      title: `${_t('personalOntology.load_error', '加载失败')}: ${_pocTemplatesLoadError || _t('personalOntology.load_error', '加载失败')}`,
      icon: 'warning',
      action: { label: _t('personalOntology.retry', '重试'), size: 'sm', attrs: { id: 'personal-onto-load-retry' } },
    })}</div>`;
    const retry = document.getElementById('personal-onto-load-retry');
    if (retry) {
      retry.addEventListener('click', async () => {
        await _pocRunOnce('templates-load', retry, async () => {
          _pocTemplatesLoaded = false;
          _pocTemplatesLoadError = '';
          await renderPersonalOntology();
        });
      });
    }
  }

  // ── 事件绑定 ─────────────────────────────────────────────────────────────
  function _pocBindBoxView(bodyEl) {
    if (!bodyEl) return;
    // 值行点击 → 展开/收起（标记与操作都在展开区）
    bodyEl.querySelectorAll('[data-poc-line-key]').forEach((el) => {
      el.addEventListener('click', () => {
        const key = el.getAttribute('data-poc-line-key');
        if (_pocExpandedValues.has(key)) _pocExpandedValues.delete(key);
        else _pocExpandedValues.add(key);
        _pocRenderMain();
      });
    });
    // 组级操作（gid 从行内 data 属性取）
    bodyEl.querySelectorAll('[data-poc-group-op]').forEach((el) => {
      el.addEventListener('click', async (e) => {
        e.stopPropagation();
        const op = el.getAttribute('data-poc-group-op');
        const gid = el.getAttribute('data-poc-gid');
        const field = el.getAttribute('data-poc-field');
        const value = el.getAttribute('data-poc-value');
        if (op === 'append-value') await _pocAppendValuePrompt(field, gid);
        else if (op === 'edit-value') await _pocEditValuePrompt(field, value, gid, el.getAttribute('data-poc-asof') || '');
        else if (op === 'remove-value') await _pocRemoveValue(field, value, gid);
        else if (op === 'verify-value') await _pocToggleValueVerified(el, field, value, gid);
        else if (op === 'cycle-rulekind') await _pocCycleRuleKind(el, field, value, gid);
        else if (op === 'toggle-restricted') await _pocToggleRestricted(el, field, value, gid);
        else if (op === 'add-field') await _pocAddFieldPrompt(gid);
        else if (op === 'rename-group') await _pocRenameGroupPrompt(gid);
        else if (op === 'delete-group') await _pocDeleteGroupConfirm(gid);
        else if (op === 'show-history') await _pocShowGroupHistory(gid);
        else if (op === 'restore-snapshot') await _pocRestoreSnapshot(el, gid);
        else if (op === 'append-entry') await _pocAppendEntryNote(gid);
      });
    });
    // D5b「已删除分组」折叠与恢复（spec 009 T027）
    bodyEl.querySelectorAll('[data-poc-deleted-op]').forEach((el) => {
      el.addEventListener('click', async (e) => {
        e.stopPropagation();
        const op = el.getAttribute('data-poc-deleted-op');
        const gid = el.getAttribute('data-poc-gid');
        if (op === 'toggle') await _pocToggleDeletedGroups();
        else if (op === 'restore' && gid) await _pocRestoreDeletedGroup(el, gid);
      });
    });
    // 回流候选（confirm 带目标组）
    bodyEl.querySelectorAll('[data-poc-candidate-op]').forEach((el) => {
      el.addEventListener('click', async (e) => {
        e.stopPropagation();
        const op = el.getAttribute('data-poc-candidate-op');
        const cid = el.getAttribute('data-poc-candidate-id');
        const gid = el.getAttribute('data-poc-gid');
        if (op === 'confirm' && cid && gid) await _pocConfirmBackflow(cid, gid, el);
        else if (op === 'reject' && cid) await _pocRejectBackflow(cid, el);
      });
    });
    // R 盒分类筛选
    bodyEl.querySelectorAll('[data-poc-tri-filter]').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        _pocTriBoxRuleFilter = el.getAttribute('data-poc-tri-filter') || 'all';
        _pocRenderMain();
      });
    });
    // T 盒内嵌的导航行（模板行/模板库/卸载/新建分组）——与侧栏同一处理
    bodyEl.querySelectorAll('[data-poc-nav]').forEach((el) => {
      el.addEventListener('click', async (e) => {
        const action = el.getAttribute('data-poc-nav');
        const id = el.getAttribute('data-poc-id');
        if (action === 'template' && id) { _pocOpenGroup(id); }
        else if (action === 'template-library') { e.stopPropagation(); _pocOpenTemplateLibrary(); }
        else if (action === 'template-uninstall') {
          e.stopPropagation();
          const tid = el.getAttribute('data-poc-template-id');
          if (tid) await _pocRunOnce(`template-uninstall:${tid}`, el, () => _pocUninstallTemplate(tid));
        }
        else if (action === 'new-group') { e.stopPropagation(); _pocCreateGroupPrompt(); }
      });
    });
  }

function _pocBindNav() {
    const nav = document.getElementById('personal-onto-nav');
    if (!nav) return;
    nav.querySelectorAll('[data-poc-nav]').forEach((el) => {
      el.addEventListener('click', async (e) => {
        const action = el.getAttribute('data-poc-nav');
        const id = el.getAttribute('data-poc-id');
        if (action === 'tbox' || action === 'abox' || action === 'rbox') {
          _pocSelected = { kind: action, id: action };
          _pocGroupEditor = null;
          renderPersonalOntology();
        }
        else if (action === 'new-group') {
          e.stopPropagation();
          _pocCreateGroupPrompt();
        }
        else if (action === 'memory-export' || action === 'memory-import') {
          e.stopPropagation();
          // 记忆页退役（2026-09-20）：导出/导入功能保留，工具实现在 memory.js
          // （_memOpenExport/_memOpenImport），经 window.MemoryTools 暴露复用。
          const tools = window.MemoryTools || {};
          const fn = action === 'memory-export' ? tools.openExport : tools.openImport;
          if (typeof fn === 'function') fn();
          else _pocToast('personalOntology.op_failed', _t('personalOntology.io_unavailable', '导出/导入工具未就绪'), 'error');
        }
        else if (action === 'template') { _pocOpenGroup(id); }
        else if (action === 'template-library') {
          e.stopPropagation();
          _pocOpenTemplateLibrary();
        }
        else if (action === 'template-uninstall') {
          e.stopPropagation();
          const tid = el.getAttribute('data-poc-template-id');
          if (tid) await _pocRunOnce(`template-uninstall:${tid}`, el, () => _pocUninstallTemplate(tid));
        }
      });
    });
    // 角色模板库弹窗：关闭/遮罩点击 —— 持久节点，只绑一次（防监听器累积）
    const libOverlay = document.getElementById('personal-onto-template-library-modal');
    if (libOverlay && !_pocLibraryModalBound) {
      _pocLibraryModalBound = true;
      libOverlay.addEventListener('click', (e) => {
        if (e.target === libOverlay) _pocCloseTemplateLibrary();
      });
      const closeBtn = document.getElementById('personal-onto-template-library-close');
      if (closeBtn) closeBtn.addEventListener('click', () => _pocCloseTemplateLibrary());
      const cancelBtn = document.getElementById('personal-onto-template-library-cancel');
      if (cancelBtn) cancelBtn.addEventListener('click', () => _pocCloseTemplateLibrary());
      if (typeof document.addEventListener === 'function') {
        document.addEventListener('keydown', (e) => {
          if (e.key === 'Escape' && libOverlay.style.display !== 'none') _pocCloseTemplateLibrary();
        });
      }
    }
    // 安装/卸载按钮绑定在 _pocOpenTemplateLibrary 内部完成（每次 innerHTML 重写后重新绑定）
  }

  function _pocBindGroupEditor(root) {
    root.querySelectorAll('[data-poc-group-action]').forEach((el) => {
      el.addEventListener('click', async () => {
        const action = el.getAttribute('data-poc-group-action');
        const ed = _pocGroupEditor;
        if (!ed) return;
        // 模板分节操作使用复合 id（data-poc-ref），原文操作使用模板 group id。
        const groupId = el.getAttribute('data-poc-ref') || ed.groupId;
        const run = async () => {
          if (action === 'view-form' || action === 'view-raw') {
            ed.view = action.slice('view-'.length);
            renderPersonalOntology();
            return;
          }
          if (action === 'reload-group') {
            await _pocOpenGroup(ed.groupId);
            return;
          }
          if (action === 'save-content') {
            const ta = root.querySelector('[data-poc-group-content]');
            if (!ta) return;
            if (await _pocGroupAction('personalOntology.groups.write', { groupId, content: ta.value })) {
              _pocToast('memory.groups_saved', '已保存');
              await _pocRefreshGroupData();
            }
            return;
          }
          if (action === 'field-add-value') {
            const fieldName = el.getAttribute('data-poc-field');
            const input = root.querySelector(`.memory-group-field-input[data-poc-field="${CSS.escape(fieldName)}"][data-poc-ref="${CSS.escape(groupId)}"]`);
            const value = (input && input.value || '').trim();
            if (!value) return;
            if (await _pocGroupAction('personalOntology.groups.fields.append', { groupId, fieldName, value, source: '手动' })) {
              _pocToast('personalOntology.field_value_added', '已添加');
              await _pocRefreshGroupData();
            }
            return;
          }
          if (action === 'field-edit-value') {
            const fieldName = el.getAttribute('data-poc-field');
            const oldValue = el.getAttribute('data-poc-value');
            const newValue = (typeof uiPrompt === 'function') ? await uiPrompt(_t('memory.group_field_edit_prompt', '编辑字段值：'), oldValue) : null;
            if (newValue === null) return;
            const trimmed = String(newValue || '').trim();
            if (!trimmed || trimmed === oldValue) return;
            if (await _pocGroupAction('personalOntology.groups.fields.setValue', { groupId, fieldName, value: trimmed, oldValue })) {
              _pocToast('personalOntology.field_value_updated', '已更新');
              await _pocRefreshGroupData();
            }
            return;
          }
          if (action === 'field-remove-value') {
            const fieldName = el.getAttribute('data-poc-field');
            const value = el.getAttribute('data-poc-value');
            const ok = (typeof uiConfirm === 'function')
              ? await uiConfirm({ message: _tv('personalOntology.field_value_delete_confirm', { value }, '删除字段值「{value}」？') })
              : true;
            if (!ok) return;
            if (await _pocGroupAction('personalOntology.groups.fields.removeValue', { groupId, fieldName, value })) {
              _pocToast('personalOntology.field_value_removed', '已删除');
              await _pocRefreshGroupData();
            }
            return;
          }
          if (action === 'entry-promote') {
            const entryText = el.getAttribute('data-poc-entry');
            const fieldName = (typeof uiPrompt === 'function') ? await uiPrompt(_t('memory.group_promote_prompt', '升格为新字段，字段名：'), '') : null;
            if (fieldName === null) return;
            const trimmed = String(fieldName || '').trim();
            if (!trimmed) return;
            const res = await _pocInvoke('personalOntology.groups.entries.promote', { groupId, entryText, fieldName: trimmed });
            if (res && res.ok !== false) {
              if (res.isCustom) {
                _pocToast('memory.group_promote_custom_done', `已创建自定义字段「${trimmed}」（不在模板字段清单内）`, 'info', { name: trimmed });
              } else {
                _pocToast('personalOntology.field_value_added', '已添加');
              }
              await _pocRefreshGroupData();
            } else {
              _notifyFail(_t('personalOntology.op_failed', '操作失败'), new Error((res && res.error) || ''));
            }
            return;
          }
          if (action === 'entry-remove') {
            const entryText = el.getAttribute('data-poc-entry');
            const ok = (typeof uiConfirm === 'function') ? await uiConfirm({ message: _t('memory.group_entry_delete_confirm', '删除这条流水？') }) : true;
            if (!ok) return;
            if (await _pocGroupAction('personalOntology.groups.entries.remove', { groupId, entryText })) {
              _pocToast('personalOntology.field_value_removed', '已删除');
              await _pocRefreshGroupData();
            }
          }
        };
        if (action === 'view-form' || action === 'view-raw') {
          await run();
          return;
        }
        const item = el.getAttribute('data-poc-field') || el.getAttribute('data-poc-entry') || el.getAttribute('data-poc-value') || '';
        await _pocRunOnce(`group-action:${action}:${groupId}:${item}`, el, run);
      });
    });
    root.querySelectorAll('.memory-group-field-input').forEach((input) => {
      input.addEventListener('keydown', (e) => {
        if (e.isComposing || e.keyCode === 229 || e.key !== 'Enter') return;
        e.preventDefault();
        const fieldName = input.getAttribute('data-poc-field');
        const ref = input.getAttribute('data-poc-ref');
        const saveBtn = root.querySelector(`button[data-poc-group-action="field-add-value"][data-poc-field="${CSS.escape(fieldName)}"][data-poc-ref="${CSS.escape(ref)}"]`);
        if (saveBtn && !saveBtn.disabled) saveBtn.click();
      });
    });
  }

  // ── 主渲染 ───────────────────────────────────────────────────────────────
  async function renderPersonalOntology() {
    const nav = document.getElementById('personal-onto-nav');
    const bodyEl = document.getElementById('personal-onto-main-body');
    if (!nav || !bodyEl) {
      console.error('[personal-ontology] missing DOM elements');
      return;
    }

    if (!_pocTemplatesLoaded || !_pocProfile.loaded || !_pocGroups.loaded || !_pocCandidatesLoaded) {
      nav.innerHTML = '<div class="personal-onto-nav-empty muted">' + _t('personalOntology.loading', '加载中...') + '</div>';
      bodyEl.innerHTML = '<div class="personal-onto-empty">' + _t('personalOntology.loading', '加载中...') + '</div>';
      await Promise.all([
        _pocLoadTemplates(),
        _pocLoadProfile(),
        _pocGroups.loaded ? Promise.resolve() : _pocLoadGroups(),
        _pocCandidatesLoaded ? Promise.resolve() : _pocLoadPendingCandidates(),
      ]);
    }

    if (_pocTemplatesLoadError) {
      _pocRenderTemplatesLoadError();
      return;
    }

    try {
      const installed = _pocTemplates.filter((t) => t.installed && t.group_id);
      // 三盒视图：数据自取（资产+全组+冲突一次拉齐）。
      if (_pocSelected.kind === 'tbox' || _pocSelected.kind === 'abox' || _pocSelected.kind === 'rbox') {
        if (!_pocBoxData.loaded) {
          nav.innerHTML = '<div class="personal-onto-nav-empty muted">' + _t('personalOntology.loading', '加载中...') + '</div>';
          bodyEl.innerHTML = '<div class="personal-onto-empty">' + _t('personalOntology.loading', '加载中...') + '</div>';
          await _pocLoadBoxData();
        }
        _pocRenderNav();
        _pocBindNav();
        _pocRenderMain();
        return;
      }

      // 盒子化重构：profile/group 已退役——非法选中态回 A 盒（事实）。
      if (_pocSelected.kind !== 'template') {
        _pocSelected = { kind: 'abox', id: 'abox' };
        if (!_pocBoxData.loaded) {
          nav.innerHTML = '<div class="personal-onto-nav-empty muted">' + _t('personalOntology.loading', '加载中...') + '</div>';
          bodyEl.innerHTML = '<div class="personal-onto-empty">' + _t('personalOntology.loading', '加载中...') + '</div>';
          await _pocLoadBoxData();
        }
        _pocRenderNav();
        _pocBindNav();
        _pocRenderMain();
        return;
      }
      let selected = installed.find((t) => t.group_id === _pocSelected.id);
      if (!selected && installed.length) {
        selected = installed[0];
        _pocSelected = { kind: 'template', id: selected.group_id };
        _pocGroupEditor = null;
      }
      if (!selected) {
        _pocSelected = { kind: 'template', id: null };
        _pocGroupEditor = null;
      } else if (!_pocGroupEditor || _pocGroupEditor.groupId !== selected.group_id) {
        _pocOpenGroup(selected.group_id);
        return;
      }

      _pocRenderNav();
      _pocBindNav();
      _pocRenderMain();
    } catch (err) {
      console.error('[personal-ontology] render failed', err);
      bodyEl.innerHTML = '<div class="personal-onto-empty">' + _t('personalOntology.load_error', '加载失败') + ': ' + escapeHtml((err && err.message) || String(err)) + '</div>';
    }
  }

  function refreshPersonalOntology(options = {}) {
    if (options && options.selectProfile) {
      _pocSelected = { kind: 'profile', id: 'user-profile' };
    }
    _pocTemplatesLoaded = false;
    _pocTemplatesLoadError = '';
    _pocProfile = { entries: [], loaded: false, loadError: '' };
    _pocGroupEditor = null;
    // 分组与候选池一并重读（2026-09-20 分组迁入）：否则外部造组（如脚本/
    // 其他入口）后刷新不重读列表，nav 永远显示旧集合。
    _pocGroups = { list: [], loaded: false, loadError: '' };
    _pocCandidatesLoaded = false;
    _pocBoxData = { loaded: false, loadError: '', groups: [], assets: [], conflicts: [] };
    _pocExpandedValues.clear();
    return renderPersonalOntology();
  }

  async function _pocRefreshForLanguage() {
    const nav = document.getElementById('personal-onto-nav');
    const body = document.getElementById('personal-onto-main-body');
    if (!nav || !body) return;
    const activeBefore = document.activeElement;
    const activeField = activeBefore?.getAttribute?.('data-poc-field') || '';
    const activeRef = activeBefore?.getAttribute?.('data-poc-ref') || '';
    const activeRaw = activeBefore?.hasAttribute?.('data-poc-group-content');
    const selectionStart = activeBefore?.selectionStart ?? 0;
    const selectionEnd = activeBefore?.selectionEnd ?? 0;
    const fieldValues = Array.from(body.querySelectorAll('.memory-group-field-input')).map((input) => ({
      field: input.getAttribute('data-poc-field') || '',
      ref: input.getAttribute('data-poc-ref') || '',
      value: input.value,
    }));
    const rawValue = body.querySelector('[data-poc-group-content]')?.value;
    const navScrollTop = nav.scrollTop;
    const bodyScrollTop = body.scrollTop;
    const libraryModal = document.getElementById('personal-onto-template-library-modal');
    const libraryWasOpen = !!libraryModal && libraryModal.style.display !== 'none';

    await renderPersonalOntology();
    for (const item of fieldValues) {
      const input = body.querySelector(`.memory-group-field-input[data-poc-field="${CSS.escape(item.field)}"][data-poc-ref="${CSS.escape(item.ref)}"]`);
      if (input) input.value = item.value;
    }
    const raw = body.querySelector('[data-poc-group-content]');
    if (raw && rawValue != null) raw.value = rawValue;
    nav.scrollTop = navScrollTop;
    body.scrollTop = bodyScrollTop;
    if (libraryWasOpen) await _pocOpenTemplateLibrary();

    let nextActive = null;
    if (activeRaw) nextActive = body.querySelector('[data-poc-group-content]');
    else if (activeField || activeRef) {
      nextActive = body.querySelector(`.memory-group-field-input[data-poc-field="${CSS.escape(activeField)}"][data-poc-ref="${CSS.escape(activeRef)}"]`);
    }
    if (nextActive) {
      nextActive.focus();
      nextActive.setSelectionRange?.(selectionStart, selectionEnd);
    }
  }

  window.renderPersonalOntology = renderPersonalOntology;
  window.refreshPersonalOntology = refreshPersonalOntology;
  if (typeof window.addEventListener === 'function') {
    window.addEventListener('i18n-change', () => { void _pocRefreshForLanguage(); });
  }
})();
