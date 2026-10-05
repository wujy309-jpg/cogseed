/* 本体页面：认知主档的列表、三盒内容与两层图谱投影。 */
(function initCognitionOntologyPage(root) {
  'use strict';
  const text = (key, fallback, vars) => {
    const value = typeof root.t === 'function' ? root.t(`ontologyWorkspace.${key}`, vars) : '';
    const output = value && value !== `ontologyWorkspace.${key}` ? value : fallback;
    return vars ? output.replace(/\{(\w+)\}/g, (match, name) => vars[name] == null ? match : String(vars[name])) : output;
  };
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
  const invoke = async (channel, payload = {}) => {
    const result = await root.cogseed.invoke(channel, payload);
    if (!result || result.ok !== true) {
      const error = new Error(result?.error || text('error', '操作未完成，请稍后重试。'));
      error.code = result?.code || '';
      throw error;
    }
    return result;
  };
  let state = null;

  function button(label, action, role = 'secondary', attrs = {}, icon = '') {
    return root.uiButton({ label, role, className: 'ontology-ws-button', ...(icon ? { icon } : {}), attrs: { 'data-ontology-action': action, ...attrs } });
  }
  function tabs(items, selected, label, attrs = {}) {
    return root.uiTabs({ items: items.map(([value, itemLabel]) => ({ value, label: itemLabel })), value: selected, ariaLabel: label, attrs });
  }
  function field(label, id, value = '', type = 'text', hint = '') {
    return root.uiField({ id, label, hint, showRequirement: false, control: { kind: 'input', type, value, attrs: { 'data-ontology-field': id } } });
  }
  function textarea(label, id, value = '', hint = '') {
    return root.uiField({ id, label, hint, showRequirement: false, control: { kind: 'textarea', value, attrs: { 'data-ontology-field': id, rows: 4 } } });
  }
  function select(label, id, options, value = '', hint = '') {
    return root.uiField({ id, label, hint, showRequirement: false, control: { kind: 'select', value, options, searchable: options.length > 8 } });
  }

  async function refresh() {
    const result = await invoke('cognition.ontology.snapshot');
    state.doc = result.ontology;
    render();
  }
  function modules() {
    return Object.values(state.doc.records).filter(r => r.kind === 'module' && r.status === 'active')
      .sort((a, b) => (String(b.updatedAt || '') > String(a.updatedAt || '') ? 1 : String(b.updatedAt || '') < String(a.updatedAt || '') ? -1 : 0)
        || a.name.localeCompare(b.name));
  }
  function moduleDescription(module) {
    if (module.description) return module.description;
    return module.source.kind === 'legacy'
      ? text('legacyModuleCardHint', '旧内容只读保留。打开单条记录可送入待我处理，核对后再整理。')
      : text('noDescription', '还没有填写简介。');
  }
  function moduleVisual(module) {
    if (module.source.kind === 'legacy') return { kind: 'legacy', icon: 'archive', label: text('legacy', '旧来源') };
    if (module.scope.kind === 'project') return { kind: 'project', icon: 'folder', label: text('project', '项目') };
    if (module.scope.kind === 'workspace') return { kind: 'workspace', icon: 'users', label: text('workspace', '工作区') };
    return { kind: 'personal', icon: 'user', label: text('personal', '个人') };
  }
  function moduleAccess() { return state.doc.records[state.moduleId]?.access || 'task'; }
  function recordsIn(moduleId, kind) {
    return Object.values(state.doc.records).filter(r => r.kind === kind && r.moduleId === moduleId && r.status === 'active');
  }
  function moduleName(id) { return state.doc.records[id]?.name || text('unknown', '未命名本体'); }
  function recordName(record) {
    if (!record) return text('unknown', '已删除或不可用');
    if (record.kind === 'assertion') {
      const predicate = state.doc.records[record.definitionId];
      const subject = state.doc.records[record.subjectId];
      const value = record.object.kind === 'entity' ? state.doc.records[record.object.id]?.name : record.object.value;
      return `${subject?.name || text('unknown', '对象')} · ${predicate?.name || text('relation', '关系')} · ${value ?? ''}`;
    }
    if (record.kind === 'reference') {
      const targetModule = state.doc.records[record.targetModuleId];
      const targetRecord = record.targetRecordId ? state.doc.records[record.targetRecordId] : null;
      return `${text('reference', '引用')}：${targetRecord ? recordName(targetRecord) : targetModule?.kind === 'module' ? targetModule.name : text('unknown', '本体')}`;
    }
    return record.name || record.id;
  }
  function searchResultContext(row) {
    const record = state.doc.records[row.id], module = row.moduleId ? state.doc.records[row.moduleId] : null;
    const parts = [];
    if (module?.kind === 'module') parts.push(module.name);
    if (record?.kind === 'entity') {
      const type = state.doc.records[record.typeId];
      if (type?.kind === 'definition') parts.push(type.name);
      const facts = Object.values(state.doc.records).filter(item => item.kind === 'assertion' && item.status === 'active'
        && item.moduleId === record.moduleId && item.subjectId === record.id).slice(0, 2);
      for (const fact of facts) {
        const definition = state.doc.records[fact.definitionId];
        if (definition?.kind === 'definition') parts.push(`${definition.name}：${valueLabel(fact.object)}`);
      }
    }
    const description = String(row.description || (record && 'description' in record ? record.description : '') || '').trim();
    if (description && !parts.includes(description)) parts.push(description);
    return [...new Set(parts)].join(' · ').slice(0, 180);
  }
  function searchResultRows(rows, action) {
    const counts = new Map();
    for (const row of rows) {
      const key = `${row.kind}:${String(row.name).toLocaleLowerCase()}`;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return rows.map(row => {
      const duplicate = (counts.get(`${row.kind}:${String(row.name).toLocaleLowerCase()}`) || 0) > 1;
      const context = searchResultContext(row);
      const disambiguator = duplicate ? context || row.id.slice(-8) : text(row.kind, row.kind);
      return `<div class="ontology-ws-search-result">${button(`${row.name} · ${disambiguator}`, action, 'ghost', { 'data-record-id': row.id, 'data-module-id': row.moduleId || '' })}${context ? `<small>${esc(context)}</small>` : ''}</div>`;
    }).join('');
  }
  function valueLabel(value) {
    if (value?.kind === 'entity') return state.doc.records[value.id]?.name || text('unavailableObject', '当前不可用的对象');
    if (value?.kind === 'literal') return String(value.value);
    return '';
  }
  function conditionLabel(condition) {
    if (!condition) return text('noCondition', '所有任务');
    if (condition.kind === 'task') return `${text(condition.field, condition.field === 'purpose' ? text('taskPurpose', '任务目的') : condition.field === 'taskKind' ? text('taskKind', '任务类型') : text('taskEntity', '涉及对象'))} = ${condition.equals}`;
    if (condition.kind === 'assertion') {
      const subject = state.doc.records[condition.subjectId], definition = state.doc.records[condition.definitionId];
      return `${subject?.kind === 'entity' ? subject.name : text('unknown', '对象')} · ${definition?.kind === 'definition' ? definition.name : text('unknown', '关系')}${condition.object ? ` · ${valueLabel(condition.object)}` : ''}`;
    }
    if (condition.kind === 'not') return `${text('not', '不满足')} ${conditionLabel(condition.condition)}`;
    return condition.conditions.map(conditionLabel).join(condition.kind === 'all' ? ` ${text('and', '并且')} ` : ` ${text('or', '或者')} `);
  }
  function detailRows(record) {
    const row = (key, value) => `<p class="ontology-ws-detail-row"><b>${esc(text(key, key))}</b><span>${esc(value)}</span></p>`;
    if (record.kind === 'entity') return [
      row('type', state.doc.records[record.typeId]?.name || text('unknown', '未知类型')),
      row('description', record.description || text('noDescription', '还没有填写简介。')),
      row('aliases', record.aliases.join('、') || '—'),
      row('access', record.access === 'owner_only' ? text('privateAccess', '仅自己查看，不提供给任务') : text('taskAccess', '认知资产可按引用供任务使用')),
    ].join('');
    if (record.kind === 'definition') return [
      row('definitionKind', text(record.definitionKind, record.definitionKind)),
      row('subjectTypes', record.subjectTypes.map(id => state.doc.records[id]?.name || id).join('、') || text('noTypeLimit', '不限定')),
      row('objectTypes', record.objectTypes.map(id => state.doc.records[id]?.name || id).join('、') || text('noTypeLimit', '不限定')),
      row('valueType', text(record.valueType, record.valueType)),
      row('cardinality', text(record.cardinality, record.cardinality)),
      row('description', record.description || '—'),
    ].join('');
    if (record.kind === 'rule') {
      const effect = record.effect.kind === 'include_recipient' ? `${text('includeRecipient', '加入接收人')}：${state.doc.records[record.effect.entityId]?.name || text('unknown', '对象')}`
        : record.effect.kind === 'required_section' ? `${text('requiredSection', '必需章节')}：${record.effect.name}`
          : record.effect.kind === 'choice' ? `${record.effect.key}：${record.effect.value}` : text('noteOnly', '显示说明');
      return [row('requirement', record.requirement), row('strength', text(record.strength, record.strength)),
        row('condition', conditionLabel(record.condition)), row('effect', effect), row('exception', record.exception || '—'),
        row('access', record.access === 'owner_only' ? text('privateAccess', '仅自己查看，不提供给任务') : text('taskAccess', '认知资产可按引用供任务使用'))].join('');
    }
    if (record.kind === 'reference') return [
      row('targetModule', state.doc.records[record.targetModuleId]?.name || record.targetModuleId),
      ...(record.targetRecordId ? [row('targetRecord', recordName(state.doc.records[record.targetRecordId]))] : []),
      row('versionPolicy', record.versionPolicy === 'current' ? text('currentVersion', '使用当前版本') : `${text('pinnedVersion', '固定版本')} ${record.targetVersion || ''}`),
    ].join('');
    return '';
  }
  function legacyCandidateText(record) {
    const lines = [`${text('name', '名称')}：${recordName(record)}`];
    if (record.kind === 'entity') {
      const type = state.doc.records[record.typeId];
      if (type?.kind === 'definition') lines.push(`${text('type', '类型')}：${type.name}`);
      if (record.description) lines.push(`${text('description', '说明')}：${record.description}`);
      if (record.aliases.length) lines.push(`${text('aliases', '别名')}：${record.aliases.join('、')}`);
      const related = Object.values(state.doc.records).filter(item => {
        if (item.kind !== 'assertion' || item.status !== 'active' || item.access === 'owner_only' || item.moduleId !== record.moduleId) return false;
        const target = item.object.kind === 'entity' ? state.doc.records[item.object.id] : null;
        if (target?.access === 'owner_only') return false;
        return item.subjectId === record.id || item.object.kind === 'entity' && item.object.id === record.id;
      }).slice(0, 40);
      if (related.length) lines.push(`${text('relatedFacts', '相关公开事实')}：\n${related.map(item => `${recordName(item)}（${item.validity.from || text('unknownDate', '开始时间未确认')} → ${item.validity.until || text('ongoing', '持续有效')}）`).join('\n')}`);
    } else if (record.kind === 'assertion') {
      const definition = state.doc.records[record.definitionId], subject = state.doc.records[record.subjectId];
      lines.push(`${text('subject', '对象')}：${subject?.kind === 'entity' ? subject.name : record.subjectId}`);
      lines.push(`${text('predicate', '关系或属性')}：${definition?.kind === 'definition' ? definition.name : record.definitionId}`);
      lines.push(`${text('value', '事实值')}：${valueLabel(record.object)}`);
      lines.push(`${text('validity', '有效时间')}：${record.validity.from || text('unknownDate', '开始时间未确认')} → ${record.validity.until || text('ongoing', '持续有效')}`);
    } else if (record.kind === 'definition') {
      if (record.description) lines.push(`${text('description', '说明')}：${record.description}`);
      lines.push(`${text('definitionKind', '定义类型')}：${text(record.definitionKind, record.definitionKind)}`);
      lines.push(`${text('subjectTypes', '起点类型')}：${record.subjectTypes.map(id => state.doc.records[id]?.name || id).join('、') || text('noTypeLimit', '不限定')}`);
      lines.push(`${text('objectType', '终点类型')}：${record.objectTypes.map(id => state.doc.records[id]?.name || id).join('、') || text('noTypeLimit', '不限定')}`);
      lines.push(`${text('valueType', '值类型')}：${text(record.valueType, record.valueType)}`);
      lines.push(`${text('cardinality', '数量')}：${text(record.cardinality, record.cardinality)}`);
    } else if (record.kind === 'rule') {
      lines.push(`${text('requirement', '要求')}：${record.requirement}`);
      lines.push(`${text('strength', '强度')}：${text(record.strength, record.strength)}`);
      lines.push(`${text('condition', '条件')}：${conditionLabel(record.condition)}`);
      const effect = record.effect.kind === 'include_recipient'
        ? `${text('includeRecipient', '加入接收人')}：${state.doc.records[record.effect.entityId]?.name || record.effect.entityId}`
        : record.effect.kind === 'required_section' ? `${text('requiredSection', '必需章节')}：${record.effect.name}`
          : record.effect.kind === 'choice' ? `${record.effect.key}：${record.effect.value}` : text('noteOnly', '显示说明');
      lines.push(`${text('effect', '效果')}：${effect}`);
      if (record.exception) lines.push(`${text('exception', '例外')}：${record.exception}`);
    } else if (record.kind === 'reference') {
      lines.push(`${text('targetModule', '引用本体')}：${state.doc.records[record.targetModuleId]?.name || record.targetModuleId}`);
      if (record.targetRecordId) lines.push(`${text('targetRecord', '引用内容')}：${recordName(state.doc.records[record.targetRecordId])}`);
    }
    const refs = record.source.refs || [];
    if (refs.length) lines.push(`${text('source', '原来源关联')}：${refs.map(ref => `${ref.kind}:${ref.id}`).join('、')}`);
    return lines.join('\n').slice(0, 4000);
  }
  function legacyCandidateScope(record) {
    const module = record.moduleId ? state.doc.records[record.moduleId] : null;
    if (module?.kind !== 'module') return {};
    if (module.scope.kind === 'project' && module.scope.id) return { scopePolicy: { projectIds: [module.scope.id] } };
    if (module.scope.kind === 'workspace' && module.scope.id) return { scopePolicy: { workspaceIds: [module.scope.id] } };
    return {};
  }
  function provenance(record) {
    const refs = record.source.refs || [];
    return `<div class="ontology-ws-provenance"><b>${esc(text('source', '来源'))}</b><span>${esc(record.source.label)}</span>${refs.length ? `<ul>${refs.map(ref => `<li>${esc(text(ref.kind, ref.kind))} · ${esc(ref.id)}</li>`).join('')}</ul>` : ''}</div>`;
  }
  function stat(label, value) { return `<div class="ontology-ws-stat"><strong>${esc(value)}</strong><span>${esc(label)}</span></div>`; }
  function pageHeader({ kicker, title, description = '', actions = '', back = '' }) {
    return `<header class="ontology-ws-header">${back}<div class="ontology-ws-heading"><div class="ontology-ws-kicker">${esc(kicker)}</div><h1>${esc(title)}</h1>${description ? `<p>${esc(description)}</p>` : ''}</div><div class="ontology-ws-actions">${actions}</div></header>`;
  }
  function pageControls(kind, page, count, pageSize) {
    const pages = Math.ceil(count / pageSize);
    if (pages <= 1) return '';
    const current = Math.max(0, Math.min(page, pages - 1));
    const start = current * pageSize + 1, end = Math.min(count, start + pageSize - 1);
    const previous = current > 0 ? button(text('previousPage', '上一页'), 'change-page', 'secondary', { 'data-page-kind': kind, 'data-page': current - 1 }) : '';
    const next = current < pages - 1 ? button(text('nextPage', '下一页'), 'change-page', 'secondary', { 'data-page-kind': kind, 'data-page': current + 1 }) : '';
    return `<nav class="ontology-ws-pagination" aria-label="${esc(text('pagination', '分页'))}">${previous}<span role="status" aria-live="polite">${esc(text('pageSummary', '{start}–{end} / {total}', { start, end, total: count }))}</span>${next}</nav>`;
  }
  function listPage() {
    const allModules = modules(), modulePageSize = 50, modulePageCount = Math.max(1, Math.ceil(allModules.length / modulePageSize));
    state.modulePage = Math.min(state.modulePage || 0, modulePageCount - 1);
    const visibleModules = allModules.slice(state.modulePage * modulePageSize, (state.modulePage + 1) * modulePageSize);
    const entities = Object.values(state.doc.records).filter(r => r.kind === 'entity' && r.status === 'active');
    const rules = Object.values(state.doc.records).filter(r => r.kind === 'rule' && r.status === 'active');
    return `${pageHeader({ kicker: 'ONTOLOGY WORKSPACE', title: text('title', '本体'), description: text('subtitle', '组织你理解世界的方式，连接人物、项目、事实与规则。'), actions: `${button(text('import', '导入资料'), 'import', 'secondary', {}, 'upload')}${button(text('supplement', '补充认知'), 'supplement', 'secondary', {}, 'sparkles')}${button(text('createModule', '创建本体'), 'create-module', 'primary', {}, 'plus')}` })}
      <div class="ontology-ws-stats">${stat(text('modules', '本体'), allModules.length)}${stat(text('objects', '具体对象'), entities.length)}${stat(text('rules', '有效规则'), rules.length)}${stat(text('revision', '版本'), state.doc.revision)}</div>
      <div class="ontology-ws-search">${root.uiField({ id: 'ontology-search-input', label: text('search', '搜索本体、人物、项目或关系'), showRequirement: false, control: { kind: 'input', type: 'search', placeholder: text('searchPlaceholder', '输入名称、别名或内容'), value: state.searchQuery || '', attrs: { 'data-ontology-field': 'search' } } })}${state.searchResults?.length ? `<div class="ontology-ws-search-results">${searchResultRows(state.searchResults, 'search-result')}</div>` : state.searchQuery ? `<div class="ontology-ws-search-empty">${esc(text('noSearchResults', '没有找到匹配内容。'))}</div>` : ''}</div>
      <div class="ontology-ws-list-heading"><h2>${esc(text('myModules', '我的本体'))}</h2>${tabs([['list', text('list', '列表')], ['graph', text('globalGraph', '关系图谱')]], state.mode, text('viewMode', '查看方式'), { 'data-ontology-tabs': 'workspace' })}</div>
      <div class="ontology-ws-module-grid">${allModules.length ? visibleModules.map(m => {
        const count = Object.values(state.doc.records).filter(r => r.kind !== 'module' && r.moduleId === m.id && r.status === 'active').length;
        const visual = moduleVisual(m);
        const icon = typeof root.uiIconHtml === 'function' ? root.uiIconHtml(visual.icon, 'ontology-ws-module-glyph') : '';
        return `<article class="ontology-ws-module-card"><div class="ontology-ws-module-icon ontology-ws-module-icon--${visual.kind}" aria-hidden="true">${icon}</div><span class="ontology-ws-scope ontology-ws-scope--${visual.kind}">${esc(visual.label)}</span><h3>${esc(m.name)}</h3><p>${esc(moduleDescription(m))}</p><div class="ontology-ws-card-meta"><span>${count} ${esc(text('records', '条内容'))}</span><span>v${m.version}</span></div><div class="ontology-ws-card-actions">${button(text('open', '打开本体'), 'open-module', 'secondary', { 'data-record-id': m.id }, 'arrow-right')}</div></article>`;
      }).join('') : `<div class="ontology-ws-empty"><h2>${esc(text('emptyTitle', '还没有本体'))}</h2><p>${esc(text('emptyBody', '创建一个本体，开始整理人物、项目和事实。'))}</p>${button(text('createModule', '创建本体'), 'create-module', 'primary')}</div>`}</div>
      ${pageControls('modules', state.modulePage, allModules.length, modulePageSize)}`;
  }
  function modulePage() {
    const m = state.doc.records[state.moduleId];
    if (!m || m.kind !== 'module') { state.page = 'list'; return listPage(); }
    const all = Object.values(state.doc.records).filter(r => r.kind !== 'module' && r.moduleId === m.id && r.status === 'active');
    const boxItems = state.box === 'T' ? all.filter(r => r.kind === 'definition' && r.definitionKind !== 'relation')
      : state.box === 'A' ? all.filter(r => r.kind === 'entity' || r.kind === 'assertion')
        : all.filter(r => r.kind === 'reference' || r.kind === 'rule' || (r.kind === 'definition' && r.definitionKind === 'relation'));
    const boxName = state.box === 'T' ? text('tbox', 'TBox · 概念定义') : state.box === 'A' ? text('abox', 'ABox · 对象与事实') : text('rbox', 'RBox · 关系与规则');
    const legacy = m.source.kind === 'legacy';
    const actions = legacy ? ''
      : `${button(text('addContent', '添加内容'), 'add-content', 'primary')}${button(text('createReference', '引用其他本体'), 'create-reference')}`;
    const body = state.tab === 'graph' ? graphCanvas(state.graph, true) : state.tab === 'overview'
      ? `<div class="ontology-ws-overview"><section class="ontology-ws-overview-card"><span>${esc(text('scope', '范围'))}</span><strong>${esc(m.scope.kind === 'personal' ? text('personal', '个人') : m.scope.kind === 'project' ? text('project', '项目') : text('workspace', '工作区'))}</strong><p>${esc(m.scope.id || '')}</p></section><section class="ontology-ws-overview-card"><span>${esc(text('description', '说明'))}</span><p>${esc(moduleDescription(m))}</p></section><section class="ontology-ws-overview-card"><span>${esc(text('threeBoxes', '三个基础盒子'))}</span><div class="ontology-ws-box-summary">${button(`TBox · ${all.filter(r => r.kind === 'definition' && r.definitionKind !== 'relation').length}`, 'select-box', 'secondary', { 'data-box': 'T' })}${button(`ABox · ${all.filter(r => r.kind === 'entity' || r.kind === 'assertion').length}`, 'select-box', 'secondary', { 'data-box': 'A' })}${button(`RBox · ${all.filter(r => r.kind === 'reference' || r.kind === 'rule' || (r.kind === 'definition' && r.definitionKind === 'relation')).length}`, 'select-box', 'secondary', { 'data-box': 'R' })}</div></section></div><section class="ontology-ws-recent"><h2>${esc(text('recentRecords', '最近整理的内容'))}</h2>${renderRecordList(all.slice(0, 8))}</section>`
      : `<div class="ontology-ws-box-title"><div><span>${esc(boxName)}</span><p>${esc(state.box === 'T' ? text('tboxHint', '定义这个本体认识哪些类型和属性。') : state.box === 'A' ? text('aboxHint', '保存具体人物、项目以及它们当前或过去的事实。') : text('rboxHint', '查看关系、规则和本体之间的引用。'))}</p></div>${legacy ? '' : state.box === 'A'
        ? `${button(text('addEntity', '添加对象'), 'create-entity', 'primary')}${button(text('addFact', '记录关系或事实'), 'create-assertion')}`
        : state.box === 'T' ? button(text('addDefinition', '添加定义'), 'create-definition', 'primary')
          : `${button(text('addRelation', '添加关系定义'), 'create-relation-definition', 'primary')}${button(text('addRule', '添加规则'), 'create-rule')}`}</div>${renderRecordList(boxItems)}`;
    return `${pageHeader({ kicker: esc(m.scope.kind === 'personal' ? text('personal', '个人') : m.scope.kind === 'project' ? text('project', '项目') : text('workspace', '工作区')), title: m.name, description: m.description, back: button(text('backModules', '← 本体列表'), 'back-list'), actions })}
      ${tabs([['overview', text('overview', '概览')], ['T', text('tbox', 'TBox')], ['A', text('abox', 'ABox')], ['R', text('rbox', 'RBox')], ['graph', text('moduleGraph', '本体图谱')]], state.tab, text('moduleViews', '本体内容视图'), { 'data-ontology-tabs': 'module' })}
      ${legacy ? `<div class="ontology-ws-legacy-note"><p>${esc(text('legacyModuleHint', '旧本体以只读方式保留。请打开单条内容后逐项送入待我处理，核对后再决定是否保存；不会整批改写旧数据。'))}</p></div>` : ''}
      ${body}`;
  }
  function candidateScopeAllowsModule(candidate, module) {
    if (!module || module.kind !== 'module' || module.source.kind === 'legacy') return false;
    const policy = candidate.scopePolicy;
    if (!policy) return true;
    if (policy.agentIds !== undefined || policy.roleIds !== undefined || policy.purposeTags !== undefined
      || policy.conversationKinds !== undefined || policy.fileKinds !== undefined) return false;
    if (policy.projectIds !== undefined && (policy.workspaceIds !== undefined || module.scope.kind !== 'project'
      || !module.scope.id || !policy.projectIds.includes(module.scope.id))) return false;
    if (policy.workspaceIds !== undefined && (module.scope.kind !== 'workspace'
      || !module.scope.id || !policy.workspaceIds.includes(module.scope.id))) return false;
    return true;
  }
  function candidateLinkedRecords(candidate) {
    return Object.values(state.doc.records).filter(record => record.source.kind === 'candidate' && record.source.recordId === candidate.id);
  }
  function candidateOrganizePage() {
    const candidate = state.candidateDraft;
    if (!candidate) { state.page = 'list'; return listPage(); }
    const linked = candidateLinkedRecords(candidate);
    const completed = candidate.status === 'integrated';
    const linkedModuleIds = [...new Set(linked.filter(record => record.kind !== 'module').map(record => record.moduleId))];
    const targetModuleId = state.candidateModuleId || linkedModuleIds[0] || '';
    const module = targetModuleId ? state.doc.records[targetModuleId] : null;
    const sourceText = String(candidate.value || candidate.judgment || '').slice(0, 4000);
    const sourceRefs = Array.isArray(candidate.sourceRefs) ? candidate.sourceRefs : [];
    const sourceHtml = `<section class="ontology-ws-candidate-source"><div class="ontology-ws-candidate-source-meta"><span>${esc(text('candidateSource', '待我处理候选'))}</span>${esc(candidate.suggestedType || '')} · ${esc(candidate.suggestedScope || '')}</div><h2>${esc(candidate.summary || candidate.judgment || text('unknown', '未命名候选'))}</h2><pre>${esc(sourceText)}</pre>${sourceRefs.length ? `<small>${esc(text('source', '来源'))}：${sourceRefs.slice(0, 5).map(ref => esc(ref.title || `${ref.kind}:${ref.id}`)).join(' · ')}</small>` : ''}<p>${esc(text('candidateOrganizeHint', '原文仍保留在待我处理。只有你在下面明确添加并确认的记录才会进入本体；尚未结构化的内容不会被视为已保存。'))}</p></section>`;
    const back = button(text('backToReview', '← 返回待我处理'), 'candidate-back');
    if (completed) {
      return `${pageHeader({ kicker: text('candidateSource', '待我处理候选'), title: text('candidateIntegratedTitle', '已整理到本体'), description: text('candidateIntegratedHint', '候选已转成结构化本体记录；来源与记录链接已保留。'), back, actions: '' })}${sourceHtml}<section class="ontology-ws-candidate-linked"><h2>${esc(text('candidateLinkedRecords', '整理到本体的记录'))}</h2>${renderRecordList(linked)}</section>`;
    }
    if (!candidate.capabilities?.canEdit && !candidate.capabilities?.canContinueOntology) {
      const finish = linked.length ? button(text('candidateFinish', '完成整理'), 'candidate-finish', 'primary') : '';
      return `${pageHeader({ kicker: text('candidateSource', '待我处理候选'), title: text('candidateUnavailableTitle', '这条候选目前不能继续整理'), description: text('candidateUnavailableHint', '请先回到待我处理查看它的状态。'), back, actions: finish })}${sourceHtml}${linked.length ? `<section class="ontology-ws-candidate-linked"><h2>${esc(text('candidateLinkedRecords', '整理到本体的记录'))}</h2>${renderRecordList(linked)}</section>` : ''}`;
    }
    if (!module || module.kind !== 'module' || !candidateScopeAllowsModule(candidate, module)) {
      const availableModules = modules().filter(item => candidateScopeAllowsModule(candidate, item)
        && (!linkedModuleIds.length || linkedModuleIds.includes(item.id)));
      const pageSize = 50, pageCount = Math.max(1, Math.ceil(availableModules.length / pageSize));
      state.candidateModulePage = Math.min(state.candidateModulePage || 0, pageCount - 1);
      const visible = availableModules.slice(state.candidateModulePage * pageSize, (state.candidateModulePage + 1) * pageSize);
      const choices = visible.length ? `<div class="ontology-ws-module-grid">${visible.map(item => `<article class="ontology-ws-module-card"><span class="ontology-ws-scope">${esc(moduleScope(item.id))}</span><h3>${esc(item.name)}</h3><p>${esc(item.description || text('noDescription', '还没有填写简介。'))}</p><div class="ontology-ws-card-actions">${button(text('useTargetModule', '整理到此本体'), 'candidate-select-module', 'primary', { 'data-record-id': item.id })}</div></article>`).join('')}</div>${pageControls('candidateModules', state.candidateModulePage, availableModules.length, pageSize)}`
        : `<div class="ontology-ws-empty"><h2>${esc(text('noCandidateTargetModules', '还没有可用的本体'))}</h2><p>${esc(text('candidateNoTargetHint', '请先创建目标本体，再回到此候选继续整理。'))}</p>${button(text('createModule', '创建本体'), 'create-module', 'primary')}</div>`;
      const finish = linked.length ? button(text('candidateFinish', '完成整理'), 'candidate-finish', 'primary') : '';
      return `${pageHeader({ kicker: text('candidateSource', '待我处理候选'), title: text('chooseTargetModule', '选择目标本体'), description: text('candidateTargetModuleHint', '先选一个有权限维护的本体，再逐条整理定义、对象、事实或规则。'), back, actions: finish })}${sourceHtml}${linked.length ? `<section class="ontology-ws-candidate-linked"><h2>${esc(text('candidateLinkedRecords', '已整理的记录'))}</h2>${renderRecordList(linked)}</section>` : ''}${choices}`;
    }
    const writableModule = module.status === 'active' && module.source.kind !== 'legacy';
    const rows = linked.filter(record => record.kind !== 'module' && record.moduleId === module.id);
    const box = state.candidateBox || 'A';
    const addActions = box === 'T'
      ? button(text('addDefinition', '添加定义'), 'create-definition', 'primary')
      : box === 'A'
        ? `${button(text('addEntity', '添加对象'), 'create-entity', 'primary')}${button(text('addFact', '记录关系或事实'), 'create-assertion')}`
        : `${button(text('addRelation', '添加关系定义'), 'create-relation-definition', 'primary')}${button(text('addRule', '添加规则'), 'create-rule')}${button(text('createReference', '引用其他本体'), 'create-reference')}`;
    const done = linked.length ? button(text('candidateFinish', '完成整理'), 'candidate-finish', 'primary') : '';
    return `${pageHeader({ kicker: text('candidateSource', '待我处理候选'), title: `${text('candidateOrganizeTitle', '整理到本体')} · ${candidate.summary || ''}`, description: `${text('targetModule', '目标本体')}：${module.name}`, back, actions: `${linkedModuleIds.length ? '' : button(text('changeTargetModule', '更换目标'), 'candidate-change-module')}${done}` })}${sourceHtml}
      <div class="ontology-ws-candidate-progress"><span>${esc(text('candidateProgress', '已整理 {count} 条本体记录', { count: linked.length }))}</span></div>
      ${!writableModule ? `<div class="ontology-ws-legacy-note" role="status"><p>${esc(text('candidateModuleReadOnly', '目标本体目前不可继续写入。你仍可查看已整理记录并完成这个候选。'))}</p></div>` : ''}
      <div class="ontology-ws-candidate-boxes">${tabs([['T', text('tbox', 'TBox · 概念定义')], ['A', text('abox', 'ABox · 对象与事实')], ['R', text('rbox', 'RBox · 关系与规则')]], box, text('moduleViews', '本体内容视图'), { 'data-ontology-tabs': 'candidateBoxes' })}</div>
      <div class="ontology-ws-box-title"><div><p>${esc(text('candidateManualMappingHint', '每次保存一条或一组明确记录；可以继续补充，全部完成后再点“完成整理”。'))}</p></div>${writableModule ? addActions : ''}</div>
      <section class="ontology-ws-candidate-linked"><h2>${esc(text('candidateLinkedRecords', '已整理的记录'))}</h2>${renderRecordList(rows)}</section>`;
  }
  function renderRecordList(rows) {
    if (!rows.length) return `<div class="ontology-ws-empty-inline">${esc(text('boxEmpty', '这里还没有内容。'))}</div>`;
    const pageSize = 100, pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
    state.recordPage = Math.min(state.recordPage || 0, pageCount - 1);
    const start = state.recordPage * pageSize;
    const visible = rows.slice(start, start + pageSize);
    return `<div class="ontology-ws-record-list">${visible.map(r => `<article class="ontology-ws-record-row"><span class="ontology-ws-record-kind">${esc(text(r.kind, r.kind === 'entity' ? '对象' : r.kind === 'assertion' ? '事实' : r.kind === 'rule' ? '规则' : r.kind === 'reference' ? '引用' : r.definitionKind === 'type' ? '类型' : r.definitionKind === 'relation' ? '关系定义' : '属性定义'))}</span>${button(recordName(r), 'open-record', 'ghost', { 'data-record-id': r.id })}<span class="ontology-ws-record-detail">${esc('description' in r ? r.description : r.kind === 'rule' ? r.requirement : r.kind === 'assertion' ? `${r.validity.from || text('unknownDate', '开始时间未确认')} → ${r.validity.until || text('ongoing', '持续有效')}` : '')}</span><span class="ontology-ws-row-arrow" aria-hidden="true">›</span></article>`).join('')}</div>${pageControls('records', state.recordPage, rows.length, pageSize)}`;
  }
  function graphPage() {
    const graph = state.graph;
    return `${pageHeader({ kicker: 'ONTOLOGY WORKSPACE', title: text('globalGraphTitle', '本体关系图谱'), description: text('globalGraphHint', '只展示本体之间明确建立的引用关系。'), back: button(text('backModules', '← 本体列表'), 'back-list'), actions: '' })}
      ${graphCanvas(graph, false)}`;
  }
  function graphPositions(nodes, width, height, focusNodeId) {
    const positions = new Map(), cx = width / 2, cy = height / 2;
    if (state.graphLayout === 'layers' && !focusNodeId) {
      const rank = { module: 0, definition: 1, entity: 2, rule: 3, value: 4, assertion: 5, reference: 6 };
      const groups = new Map();
      for (const node of nodes) {
        const column = rank[node.kind] ?? 3;
        groups.set(column, [...(groups.get(column) || []), node]);
      }
      const columns = [...groups.keys()].sort((a, b) => a - b), left = 90, right = width - 90;
      columns.forEach((column, index) => {
        const items = groups.get(column);
        const x = columns.length === 1 ? cx : left + (right - left) * index / (columns.length - 1);
        items.forEach((node, row) => positions.set(node.id, { x, y: height * (row + 1) / (items.length + 1) }));
      });
      return positions;
    }
    const radialNodes = nodes.filter(node => node.id !== focusNodeId);
    if (focusNodeId && nodes.some(node => node.id === focusNodeId)) positions.set(focusNodeId, { x: cx, y: cy });
    radialNodes.forEach((node, i) => {
      const angle = -Math.PI / 2 + i * Math.PI * 2 / Math.max(1, radialNodes.length);
      const radius = nodes.length === 1 ? 0 : Math.min(210, 85 + Math.sqrt(radialNodes.length) * 9);
      positions.set(node.id, { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius });
    });
    return positions;
  }
  function graphCanvas(graph, local) {
    if (!graph?.nodes?.length) return `<div class="ontology-ws-empty">${esc(text('graphEmpty', '还没有可展示的关系。'))}</div>`;
    const nodes = graph.nodes, width = 900, height = 560, cx = width / 2, cy = height / 2;
    const totalNodes = Number.isInteger(graph.totalNodes) ? graph.totalNodes : nodes.length;
    const totalEdges = Number.isInteger(graph.totalEdges) ? graph.totalEdges : graph.edges.length;
    const nodeCount = graph.truncated ? `${nodes.length}/${totalNodes}` : String(nodes.length);
    const edgeCount = graph.truncated ? `${graph.edges.length}/${totalEdges}` : String(graph.edges.length);
    const focusNodeId = graph.focusNodeId || '';
    const positions = graphPositions(nodes, width, height, focusNodeId);
    const edges = graph.edges.map(edge => {
      const a = positions.get(edge.from), b = positions.get(edge.to); if (!a || !b) return '';
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      return `<g class="ontology-ws-edge ontology-ws-edge--${esc(edge.kind)}${edge.truth === 'unknown' ? ' ontology-ws-edge--uncertain' : ''}${state.selectedEdgeId === edge.id ? ' is-selected' : ''}" role="button" tabindex="0" aria-label="${esc(`${edge.label}${edge.truth === 'unknown' ? '，生效时间待确认' : ''}`)}" data-ontology-edge="${esc(edge.id)}"><path d="M ${a.x} ${a.y} Q ${mx + (cy - my) * .14} ${my + (a.x - b.x) * .14} ${b.x} ${b.y}" marker-end="url(#ontology-arrow)"/><text x="${mx}" y="${my - 7}">${esc(edge.label)}${edge.truth === 'unknown' ? ' ?' : ''}</text></g>`;
    }).join('');
    const nodeHtml = nodes.map(node => {
      const p = positions.get(node.id), active = state.selectedId === node.id || focusNodeId === node.id;
      return `<g class="ontology-ws-node ontology-ws-node--${esc(node.kind)}${active ? ' is-selected' : ''}" transform="translate(${p.x} ${p.y})" role="button" tabindex="0" aria-label="${esc(node.label)}" data-ontology-node="${esc(node.id)}"><rect x="-74" y="-31" width="148" height="62" rx="14"/><text y="-1">${esc(node.label.slice(0, 22))}</text><text class="ontology-ws-node-sub" y="16">${esc(node.kind === 'module' ? moduleScope(node.id) : text(node.kind, node.kind === 'entity' ? '具体对象' : node.kind === 'rule' ? '规则' : node.kind === 'definition' ? '定义' : node.kind === 'value' ? '内容' : '关系'))}</text></g>`;
    }).join('');
    const selected = nodes.find(n => n.id === state.selectedId);
    const selectedEdge = graph.edges.find(edge => edge.id === state.selectedEdgeId);
    const graphSearchResults = local && state.graphSearchQuery ? `<div class="ontology-ws-graph-search-results">${state.graphSearchResults.length
      ? searchResultRows(state.graphSearchResults, 'focus-record')
      : `<span>${esc(text('noGraphSearchResults', '没有找到匹配内容。'))}</span>`}</div>` : '';
    const graphSearch = local ? `<div class="ontology-ws-graph-search">${root.uiField({ id: 'ontology-graph-search', label: text('graphSearch', '在本体中查找对象或关系'), showRequirement: false,
      control: { kind: 'input', type: 'search', placeholder: text('graphSearchPlaceholder', '输入人物、项目或关系'), value: state.graphSearchQuery || '', attrs: { 'data-ontology-field': 'graphSearch' } } })}${graphSearchResults}</div>` : '';
    const layoutControl = local && typeof root.uiSegmentedControl === 'function' ? root.uiSegmentedControl({
      ariaLabel: text('graphLayout', '图谱布局'), value: state.graphLayout,
      items: [
        { label: text('radialLayout', '圆形'), value: 'radial', attrs: { 'data-ontology-action': 'graph-layout', 'data-layout': 'radial' } },
        { label: text('layeredLayout', '分层'), value: 'layers', attrs: { 'data-ontology-action': 'graph-layout', 'data-layout': 'layers' } },
      ],
    }) : '';
    const zoom = Math.round(state.graphZoom * 100);
    const zoomControls = `<div class="ontology-ws-graph-zoom">${button(text('zoomOut', '缩小'), 'graph-zoom', 'secondary', { 'data-zoom-step': '-1' })}<span aria-live="polite">${zoom}%</span>${button(text('zoomIn', '放大'), 'graph-zoom', 'secondary', { 'data-zoom-step': '1' })}${button(text('zoomReset', '重置缩放'), 'graph-zoom-reset')}</div>`;
    const viewWidth = width / state.graphZoom, viewHeight = height / state.graphZoom;
    const viewX = (width - viewWidth) / 2, viewY = (height - viewHeight) / 2;
    const selectedPanel = selectedEdge
      ? `<aside class="ontology-ws-node-panel"><div class="ontology-ws-node-panel-top"><span>${esc(text(selectedEdge.kind, selectedEdge.kind))}</span>${button(text('closeDetails', '关闭'), 'clear-selection')}</div><h2>${esc(selectedEdge.label)}</h2><p>${esc(selectedEdge.truth === 'unknown' ? text('unknownDate', '开始时间未确认') : text('edgeCurrent', '当前有效'))}</p>${selectedEdge.recordId ? button(text('openDetails', '查看详情'), 'open-graph-record', 'primary', { 'data-record-id': selectedEdge.recordId }) : ''}${local ? button(text('focusConnections', '展开关联内容'), 'focus-record', 'secondary', { 'data-record-id': selectedEdge.recordId || selectedEdge.id }) : ''}</aside>`
      : selected ? `<aside class="ontology-ws-node-panel"><div class="ontology-ws-node-panel-top"><span>${esc(text(selected.kind, selected.kind === 'module' ? '本体' : '本体内容'))}</span>${button(text('closeDetails', '关闭'), 'clear-selection')}</div><h2>${esc(selected.label)}</h2><p>${esc(selected.description || '')}</p>${local && selected.kind !== 'module' ? `${state.doc.records[selected.id] ? button(text('openDetails', '查看详情'), 'open-graph-record', 'primary', { 'data-record-id': selected.id }) : ''}${button(text('focusConnections', '展开关联内容'), 'focus-record', 'secondary', { 'data-record-id': selected.id })}` : selected.kind === 'module' ? button(text('openModule', '进入本体'), 'open-module', 'primary', { 'data-record-id': selected.id }) : ''}</aside>` : '';
    return `<div class="ontology-ws-graph-shell${selected || selectedEdge ? ' has-selection' : ''}"><div class="ontology-ws-graph-tools"><span>${nodeCount} ${esc(text('nodes', '个节点'))} · ${edgeCount} ${esc(text('edges', '条关系'))}${graph.edges.some(edge => edge.truth === 'unknown') ? ` · ${esc(text('unknownEdgeLegend', '? = 生效时间待确认'))}` : ''}</span><div class="ontology-ws-graph-controls">${layoutControl}${local ? `<label>${esc(text('queryDate', '查询日期'))} ${root.uiInput({ id: 'ontology-graph-date', type: 'date', value: state.at, attrs: { 'data-ontology-field': 'graphAt' } })}</label>${graph.focusId ? button(text('showFullGraph', '返回本体图谱全景'), 'graph-full') : ''}` : ''}${zoomControls}</div></div>${graphSearch}${graph.truncated ? `<p class="ontology-ws-graph-limit-hint" role="status">${esc(text('graphTruncated', '图谱较大，当前显示 {shownNodes}/{totalNodes} 个节点、{shownEdges}/{totalEdges} 条关系。请用列表和搜索查找具体内容。', { shownNodes: nodes.length, totalNodes, shownEdges: graph.edges.length, totalEdges }))}</p>` : ''}<div class="ontology-ws-graph-content"><div class="ontology-ws-graph-canvas"><svg viewBox="${viewX} ${viewY} ${viewWidth} ${viewHeight}" role="img" aria-label="${esc(local ? text('moduleGraph', '本体图谱') : text('globalGraphTitle', '本体关系图谱'))}"><defs><marker id="ontology-arrow" markerWidth="9" markerHeight="7" refX="8" refY="3.5" orient="auto"><polygon points="0 0, 9 3.5, 0 7"/></marker></defs>${edges}${nodeHtml}</svg></div>${selectedPanel}</div></div>`;
  }
  function moduleScope(id) { const m = state.doc.records[id]; return m ? text(m.scope.kind, m.scope.kind === 'personal' ? '个人本体' : m.scope.kind === 'project' ? '项目本体' : '工作区本体') : ''; }
  function recordPage() {
    const record = state.doc.records[state.recordId];
    if (!record) { state.page = 'module'; return modulePage(); }
    const history = state.history || [];
    const isLegacy = record.source.kind === 'legacy';
    const legacyPrivate = record.access === 'owner_only';
    const legacyAction = isLegacy ? `<section class="ontology-ws-legacy-note"><p>${esc(record.kind === 'module'
      ? text('legacyModuleHint', '旧本体以只读方式保留。请打开单条内容后逐项送入待我处理，核对后再决定是否保存；不会整批改写旧数据。')
      : legacyPrivate ? text('legacyPrivateBlocked', '这条内容仅本人可见，不能送入任务候选。请先在个人本体中重新整理它。')
        : text('legacyReadOnly', '这条内容来自旧本体，只读展示。你可以先送入“待我处理”核对，再决定是否保存为新的认知资产。'))}</p>${record.kind === 'module' || legacyPrivate ? '' : button(text('submitLegacy', '送入待我处理'), 'legacy-candidate', 'primary', { 'data-record-id': record.id })}</section>` : '';
    const summary = record.kind === 'assertion'
      ? `<section class="ontology-ws-detail-section"><h2>${esc(text('currentFact', '当前事实'))}</h2><p>${esc(recordName(record))}</p><p>${esc(record.validity.from || text('unknownDate', '开始时间未确认'))} → ${esc(record.validity.until || text('ongoing', '持续有效'))}</p>${provenance(record)}${isLegacy ? '' : `<div class="ontology-ws-detail-actions">${button(text('changeFact', '从某天起变更'), 'change-fact', 'primary')}${button(text('correctFact', '纠正记错的事实'), 'correct-fact')}</div>`}</section>`
      : `<section class="ontology-ws-detail-section"><h2>${esc(text('details', '详情'))}</h2>${detailRows(record)}${provenance(record)}</section><div class="ontology-ws-detail-actions">${!isLegacy && record.kind === 'entity' ? button(text('edit', '编辑'), 'edit-record', 'primary') : ''}${!isLegacy ? button(text('archive', '停用'), 'archive-record', 'danger') : ''}</div>`;
    return `${pageHeader({ kicker: text(record.kind, record.kind === 'entity' ? '具体对象' : record.kind === 'assertion' ? '关系或事实' : '本体定义'), title: recordName(record), back: button(text('backModule', '← 返回本体'), 'back-module'), actions: '' })}
      ${summary}${legacyAction}<section class="ontology-ws-history"><h2>${esc(text('history', '变更记录'))}</h2>${history.length ? history.map(entry => `<article><time>${esc(entry.recordedAt)}</time><strong>${esc(entry.intent)}</strong><p>${esc(entry.before ? recordName(entry.before) : text('created', '创建记录'))}</p></article>`).join('') : `<p>${esc(isLegacy ? text('legacyHistory', '旧资料没有提供可验证的版本历史。') : text('noHistory', '暂无变更记录'))}</p>`}</section>`;
  }

  async function loadGraph(moduleId) {
    const result = await invoke('cognition.ontology.graph.query', { ...(moduleId ? { moduleId } : {}), ...(moduleId ? { at: state.at } : {}), ...(state.graphFocusId ? { focusId: state.graphFocusId } : {}) });
    state.graph = result.graph;
    state.selectedEdgeId = result.graph.focusEdgeId || '';
  }
  async function enterGraph(global) {
    state.page = global ? 'global-graph' : 'module';
    if (!global) state.tab = 'graph';
    state.selectedId = ''; state.selectedEdgeId = ''; state.graphFocusId = '';
    await loadGraph(global ? '' : state.moduleId);
    render();
  }
  async function commit(actions) {
    const candidate = state.page === 'candidate-organize' ? state.candidateDraft : null;
    const candidateCreate = candidate && state.candidateModuleId && actions.length > 0
      && actions.every(action => action.intent === 'create' && action.record?.kind !== 'module'
        && action.record?.moduleId === state.candidateModuleId);
    let result;
    if (candidateCreate) {
      if (candidate.risk === 'high' && !state.candidateRiskAcknowledged) {
        const confirmed = typeof root.uiConfirm === 'function'
          ? await root.uiConfirm(text('candidateHighRiskConfirm', '这条候选被标记为高风险。请确认你已核对原始来源，再继续写入本体。'))
          : false;
        if (!confirmed) return false;
        state.candidateRiskAcknowledged = true;
      }
      state.candidateBatchId = state.candidateBatchId || `batch-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      result = await invoke('cognition.ontology.candidate.commit', {
        candidateId: candidate.id, moduleId: state.candidateModuleId, batchId: state.candidateBatchId,
        ...(candidate.risk === 'high' ? { riskAcknowledged: state.candidateRiskAcknowledged === true } : {}),
        command: { commandId: `ont-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`, expectedRevision: state.doc.revision, actions },
      });
      state.candidateDraft = result.candidate;
      state.candidateBatchId = '';
    } else {
      result = await invoke('cognition.ontology.command.commit', {
        command: { commandId: `ont-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`, expectedRevision: state.doc.revision, actions },
      });
    }
    state.modulePage = 0;
    state.recordPage = 0;
    await refresh();
    return result;
  }
  function sourceLabel() { return text('userConfirmed', '用户确认'); }
  function openDialog({ title, body, trigger, onSubmit }) {
    const modal = root.uiModal({ title, closeLabel: text('close', '关闭'), size: 'md', initialFocus: '.ontology-ws-form input,.ontology-ws-form textarea,.ai-select-trigger',
      bodyHtml: `<form class="ontology-ws-form">${body}<p class="ontology-ws-form-error" role="alert" hidden></p><div class="ontology-ws-form-actions">${button(text('cancel', '取消'), 'dialog-cancel')}${button(text('save', '保存'), 'dialog-save', 'primary')}</div></form>` });
    void modal.catch(() => {});
    const overlay = modal.overlay, form = overlay.querySelector('form'), selectionValues = {};
    if (typeof root.hydrateUiFormSelects === 'function') {
      const callbacks = {};
      for (const host of form.querySelectorAll('[data-ui-select]')) {
        try { selectionValues[host.id] = JSON.parse(host.dataset.uiSelectConfig || '{}').value || ''; } catch (_) { selectionValues[host.id] = ''; }
        callbacks[host.id] = value => { selectionValues[host.id] = value; };
      }
      root.hydrateUiFormSelects(form, callbacks);
    }
    overlay.addEventListener('click', async event => {
      const control = event.target.closest('[data-ontology-action]'); if (!control) return;
      const action = control.dataset.ontologyAction;
      if (action === 'dialog-cancel') { state.candidateBatchId = ''; modal.close('cancel', 'close'); return; }
      if (action === 'choose-import-file') {
        const error = form.querySelector('.ontology-ws-form-error');
        try {
          const imported = await invoke('cognition.ontology.import.file');
          if (imported.cancelled) return;
          const title = form.querySelector('[data-ontology-field="title"]'), content = form.querySelector('[data-ontology-field="content"]');
          if (title) title.value = imported.name;
          if (content) content.value = imported.text;
        } catch (err) { error.hidden = false; error.textContent = err.message || text('error', '操作未完成，请稍后重试。'); }
        return;
      }
      if (action !== 'dialog-save') return;
      event.preventDefault();
      const data = {};
      for (const input of form.querySelectorAll('[data-ontology-field]')) data[input.dataset.ontologyField] = input.value;
      Object.assign(data, selectionValues);
      const error = form.querySelector('.ontology-ws-form-error');
      try {
        control.disabled = true;
        const submitted = await onSubmit(data);
        if (submitted === false) { control.disabled = false; return; }
        modal.close('saved', 'action');
      }
      catch (err) { error.hidden = false; error.textContent = err.message || text('error', '操作未完成，请稍后重试。'); control.disabled = false; }
    });
    return modal;
  }
  function openModuleDialog(trigger) {
    const body = `${field(text('name', '名称'), 'name')}${textarea(text('description', '简介'), 'description')}${select(text('scope', '范围'), 'scope', [
      { value: 'personal', label: text('personal', '个人') }, { value: 'project', label: text('project', '项目') }, { value: 'workspace', label: text('workspace', '工作区') },
    ], 'personal')}${field(text('scopeId', '项目或工作区标识'), 'scopeId', '', 'text', text('scopeIdHint', '个人本体无需填写。'))}${select(text('access', '谁可以在任务中使用'), 'access', [
      { value: 'task', label: text('taskAccess', '认知资产可按引用供任务使用') }, { value: 'owner_only', label: text('privateAccess', '仅自己查看，不提供给任务') },
    ], 'task')}`;
    return openDialog({ title: text('createModuleTitle', '创建本体'), body, trigger, onSubmit: data => {
      if (!data.name.trim()) throw new Error(text('requiredName', '请填写名称。'));
      const scope = { kind: data.scope, ...(data.scope === 'personal' ? {} : { id: data.scopeId.trim() }) };
      if (data.scope !== 'personal' && !scope.id) throw new Error(text('requiredScope', '该范围需要填写标识。'));
      return commit([{ intent: 'create', record: { kind: 'module', name: data.name.trim(), description: data.description.trim(), scope, access: data.access }, sourceLabel: sourceLabel() }]);
    } });
  }
  function openDefinitionDialog(trigger, initialKind = 'type') {
    const typeOptions = recordsIn(state.moduleId, 'definition').filter(r => r.definitionKind === 'type').map(r => ({ value: r.id, label: r.name }));
    const body = `${field(text('name', '名称'), 'name')}${textarea(text('description', '说明'), 'description')}${select(text('definitionKind', '定义类型'), 'definitionKind', [
      { value: 'type', label: text('type', '概念类型') }, { value: 'relation', label: text('relation', '对象之间的关系') }, { value: 'attribute', label: text('attribute', '对象的属性') },
    ], initialKind)}${select(text('valueType', '关系值类型'), 'valueType', [
      { value: 'entity', label: text('otherEntity', '另一个对象') }, { value: 'text', label: text('text', '文字') }, { value: 'number', label: text('number', '数字') }, { value: 'date', label: text('date', '日期') }, { value: 'boolean', label: text('boolean', '是或否') },
    ], 'entity')}${select(text('subjectType', '起点对象类型'), 'subjectType', [{ value: '', label: text('noTypeLimit', '不限定') }, ...typeOptions])}${select(text('objectType', '终点对象类型'), 'objectType', [{ value: '', label: text('noTypeLimit', '不限定') }, ...typeOptions])}${select(text('cardinality', '对象数量'), 'cardinality', [{ value: 'one', label: text('one', '一个') }, { value: 'many', label: text('many', '多个') }], 'many')}`;
    return openDialog({ title: text('addDefinition', '添加定义'), body, trigger, onSubmit: data => {
      const valueType = data.definitionKind === 'type' ? 'entity' : data.valueType;
      return commit([{ intent: 'create', record: { kind: 'definition', moduleId: state.moduleId, name: data.name.trim(), description: data.description.trim(), definitionKind: data.definitionKind, access: moduleAccess(),
        subjectTypes: data.subjectType ? [data.subjectType] : [], objectTypes: data.objectType ? [data.objectType] : [], valueType,
        cardinality: data.cardinality, cardinalityAnchor: 'subject' }, sourceLabel: sourceLabel() }]);
    } });
  }
  function openEntityDialog(trigger, record) {
    const typeOptions = recordsIn(state.moduleId, 'definition').filter(r => r.definitionKind === 'type').map(r => ({ value: r.id, label: r.name }));
    if (!typeOptions.length && !record) { root.uiToast?.(text('createTypeFirst', '请先在 TBox 中创建一个概念类型。'), { variant: 'warning' }); state.tab = 'T'; render(); return null; }
    const typeId = record?.typeId || typeOptions[0]?.value || '';
    const body = `${field(text('name', '名称'), 'name', record?.name || '')}${textarea(text('description', '说明'), 'description', record?.description || '')}${select(text('type', '所属类型'), 'typeId', typeOptions, typeId)}${field(text('aliases', '别名，用逗号分隔'), 'aliases', record?.aliases?.join(', ') || '')}${select(text('access', '谁可以在任务中使用'), 'access', [
      { value: 'task', label: text('taskAccess', '认知资产可按引用供任务使用') }, { value: 'owner_only', label: text('privateAccess', '仅自己查看，不提供给任务') },
    ], record?.access || moduleAccess())}`;
    return openDialog({ title: record ? text('editEntity', '编辑对象') : text('addEntity', '添加对象'), body, trigger, onSubmit: data => {
      if (!data.name.trim() || !data.typeId) throw new Error(text('requiredEntityFields', '名称和所属类型为必填项。'));
      const patch = { ...(record ? {} : { moduleId: state.moduleId }), typeId: data.typeId, name: data.name.trim(), description: data.description.trim(), aliases: data.aliases.split(',').map(x => x.trim()).filter(Boolean), identityStatus: record?.identityStatus || 'confirmed', access: data.access };
      return record ? commit([{ intent: 'update', recordId: record.id, expectedVersion: record.version, patch: { typeId: patch.typeId, name: patch.name, description: patch.description, aliases: patch.aliases, access: patch.access }, sourceLabel: sourceLabel() }])
        : commit([{ intent: 'create', record: { kind: 'entity', ...patch }, sourceLabel: sourceLabel() }]);
    } });
  }
  function openAssertionDialog(trigger) {
    const entities = recordsIn(state.moduleId, 'entity').map(r => ({ value: r.id, label: r.name }));
    const predicates = recordsIn(state.moduleId, 'definition').filter(r => r.definitionKind !== 'type').map(r => ({ value: r.id, label: `${r.name} · ${r.valueType}` }));
    if (!entities.length || !predicates.length) { state.box = 'T'; state.tab = 'T'; render(); root.uiToast?.(text('createDefinitionFirst', '请先创建关系定义和具体对象。'), { variant: 'warning' }); return null; }
    const body = `${select(text('subject', '对象'), 'subjectId', entities)}${select(text('predicate', '关系或属性'), 'definitionId', predicates)}${select(text('valueType', '关联对象'), 'objectId', [{ value: '', label: text('chooseValueTypeFirst', '选择定义后再填写值') }, ...entities])}${field(text('value', '事实值（实体关系请使用上方关联对象）'), 'value')}${field(text('validFrom', '从哪天开始生效'), 'validFrom', '', 'date', text('validFromHint', '不知道开始日期时留空，系统会标为待确认。'))}${select(text('access', '谁可以在任务中使用'), 'access', [
      { value: 'task', label: text('taskAccess', '认知资产可按引用供任务使用') }, { value: 'owner_only', label: text('privateAccess', '仅自己查看，不提供给任务') },
    ], moduleAccess())}`;
    return openDialog({ title: text('addFact', '记录关系或事实'), body, trigger, onSubmit: data => {
      const predicate = state.doc.records[data.definitionId]; if (!data.subjectId || !predicate || predicate.kind !== 'definition') throw new Error(text('requiredEntityFields', '请选择对象和关系定义。'));
      let value;
      if (predicate.valueType === 'entity') { if (!data.objectId) throw new Error(text('chooseEntity', '请选择关联对象。')); value = { kind: 'entity', id: data.objectId }; }
      else if (predicate.valueType === 'number') { value = { kind: 'literal', valueType: 'number', value: Number(data.value) }; if (!Number.isFinite(value.value)) throw new Error(text('invalidNumber', '请输入有效数字。')); }
      else if (predicate.valueType === 'boolean') value = { kind: 'literal', valueType: 'boolean', value: data.value.toLowerCase() === 'true' || data.value === text('yes', '是') };
      else value = { kind: 'literal', valueType: predicate.valueType, value: data.value };
      return commit([{ intent: 'create', record: { kind: 'assertion', moduleId: state.moduleId, subjectId: data.subjectId, definitionId: data.definitionId, object: value, access: data.access,
        validity: { from: data.validFrom || null, until: null, precision: 'day', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' } }, sourceLabel: sourceLabel() }]);
    } });
  }
  function openRuleDialog(trigger) {
    const entities = recordsIn(state.moduleId, 'entity').map(r => ({ value: r.id, label: r.name }));
    const body = `${field(text('name', '规则名称'), 'name')}${textarea(text('requirement', '规则内容'), 'requirement')}${select(text('conditionKind', '适用条件'), 'conditionKind', [
      { value: '', label: text('noCondition', '所有任务') }, { value: 'purpose', label: text('taskPurpose', '任务目的') }, { value: 'taskKind', label: text('taskKind', '任务类型') }, { value: 'entityId', label: text('taskEntity', '涉及对象') },
    ], '')}${field(text('conditionValue', '条件值'), 'conditionValue')}${select(text('strength', '使用方式'), 'strength', [
      { value: 'required', label: text('required', '必须遵守') }, { value: 'default', label: text('default', '默认采用') }, { value: 'suggestion', label: text('suggestion', '建议') }, { value: 'logic', label: text('logic', '逻辑关系') },
    ], 'default')}${select(text('effect', '执行时帮助'), 'effect', [{ value: 'note', label: text('noteOnly', '显示说明') }, ...entities.map(e => ({ value: `recipient:${e.value}`, label: `${text('includeRecipient', '加入接收人')}：${e.label}` }))])}${textarea(text('exception', '例外情况'), 'exception')}${select(text('access', '谁可以在任务中使用'), 'access', [
      { value: 'task', label: text('taskAccess', '认知资产可按引用供任务使用') }, { value: 'owner_only', label: text('privateAccess', '仅自己查看，不提供给任务') },
    ], moduleAccess())}`;
    return openDialog({ title: text('addRule', '添加关系或规则'), body, trigger, onSubmit: data => {
      const recipient = data.effect.startsWith('recipient:');
      const condition = data.conditionKind && data.conditionValue.trim() ? { kind: 'task', field: data.conditionKind, equals: data.conditionValue.trim() } : null;
      return commit([{ intent: 'create', record: { kind: 'rule', moduleId: state.moduleId, name: data.name.trim(), requirement: data.requirement.trim(), strength: data.strength, condition, access: data.access,
        effect: recipient ? { kind: 'include_recipient', entityId: data.effect.slice('recipient:'.length) } : { kind: 'note' }, exception: data.exception.trim() }, sourceLabel: sourceLabel() }]);
    } });
  }
  function openReferenceDialog(trigger) {
    const options = modules().filter(m => m.id !== state.moduleId && m.source.kind !== 'legacy' && m.access === 'task').map(m => ({ value: m.id, label: `${m.name} · ${moduleScope(m.id)}` }));
    if (!options.length) { root.uiToast?.(text('noOtherModules', '创建另一个本体后，就可以在这里建立引用。'), { variant: 'info' }); return null; }
    return openDialog({ title: text('createReference', '引用其他本体'), body: `${select(text('targetModule', '要引用的本体'), 'targetModuleId', options)}<p class="ontology-ws-form-note">${esc(text('referenceHint', '引用建立后，这个本体可以按权限使用对方明确公开的内容。'))}</p>`, trigger, onSubmit: data => commit([{ intent: 'create', record: { kind: 'reference', moduleId: state.moduleId, targetModuleId: data.targetModuleId, versionPolicy: 'current', access: moduleAccess() }, sourceLabel: sourceLabel() }]) });
  }
  function openImportDialog(trigger, supplement) {
    const body = `${field(text('title', '标题'), 'title')}${select(text('suggestedType', '整理为'), 'suggestedType', [
      { value: 'fact', label: text('factAsset', '事实') }, { value: 'personal', label: text('personalAsset', '个人认知') },
      { value: 'rule', label: text('ruleAsset', '规则') }, { value: 'template', label: text('templateAsset', '模板') }, { value: 'skill_method', label: text('methodAsset', '方法') },
    ], 'fact')}${supplement ? '' : button(text('chooseImportFile', '选择本机文件'), 'choose-import-file')}<p class="ontology-ws-form-note">${esc(text('fileImportHint', '支持 Markdown、TXT、PDF 和 DOCX；文件只在本机解析，整理结果会进入“待我处理”。'))}</p>${textarea(supplement ? text('supplementText', '补充内容') : text('pasteContent', '粘贴资料内容'), 'content', '', text('candidateHint', '提交后会进入“待我处理”，确认前不会变成本体事实。'))}<p class="ontology-ws-form-note">${esc(text('candidateHint', '提交后会进入“待我处理”，确认前不会变成本体事实。'))}</p>`;
    return openDialog({ title: supplement ? text('supplement', '补充认知') : text('import', '导入资料'), body, trigger, onSubmit: async data => {
      if (!data.title.trim() || !data.content.trim()) throw new Error(text('requiredImport', '请填写标题和内容。'));
      const result = await invoke('cognition.ontology.import.submit', { name: data.title.trim(), text: data.content, suggestedType: data.suggestedType });
      root.uiToast?.(text('candidateBatchSaved', '已送入“待我处理”，共 {count} 段。', { count: result.submitted }), { variant: 'success' });
    } });
  }
  async function openRecord(recordId) {
    state.recordId = recordId;
    const result = await invoke('cognition.ontology.history.get', { recordId, limit: 100 });
    if (result.record) {
      state.doc.records[result.record.id] = result.record;
      if (result.record.kind !== 'module' && result.record.moduleId) state.moduleId = result.record.moduleId;
    }
    state.history = result.history;
    state.page = 'record';
    render();
  }
  async function handleAction(action, target) {
    const id = target.dataset.recordId || target.closest('[data-record-id]')?.dataset.recordId || '';
    if (action === 'create-module') return openModuleDialog(target);
    if (action === 'import' || action === 'supplement') return openImportDialog(target, action === 'supplement');
    if (action === 'candidate-back') {
      const candidateId = state.candidateDraft?.id;
      if (candidateId) root.CogAssets?.router?.go({ name: 'review', candidateId });
      return;
    }
    if (action === 'candidate-select-module') {
      const module = state.doc.records[id];
      if (!candidateScopeAllowsModule(state.candidateDraft, module))
        throw new Error(text('candidateTargetModuleHint', '请选择范围允许且可维护的本体。'));
      state.candidateModuleId = module.id; state.moduleId = module.id; state.recordPage = 0; render(); return;
    }
    if (action === 'candidate-change-module') { state.candidateModuleId = ''; state.moduleId = ''; render(); return; }
    if (action === 'candidate-finish') {
      if (!candidateLinkedRecords(state.candidateDraft).length) return;
      const confirmed = typeof root.uiConfirm === 'function'
        ? await root.uiConfirm(text('candidateFinishConfirm', '完成后，这条候选会从待处理中关闭。已整理的本体记录仍可在本体页继续编辑。'))
        : false;
      if (!confirmed) return;
      const result = await invoke('cognition.ontology.candidate.complete', { candidateId: state.candidateDraft.id });
      state.candidateDraft = result.candidate;
      state.candidateBatchId = '';
      root.uiToast?.(text('candidateFinished', '已完成整理，候选和本体记录的来源链接已保留。'), { variant: 'success' });
      render(); return;
    }
    if (action === 'back-list') { state.page = 'list'; state.mode = 'list'; state.selectedId = ''; render(); return; }
    if (action === 'back-module') {
      if (state.candidateDraft) { state.page = 'candidate-organize'; render(); return; }
      if (state.graphReturn) {
        const previous = state.graphReturn;
        state.graphReturn = null;
        state.moduleId = previous.moduleId;
        state.page = 'module'; state.tab = 'graph'; state.graphFocusId = previous.focusId || '';
        state.graphLayout = previous.layout; state.graphZoom = previous.zoom; state.at = previous.at;
        await loadGraph(state.moduleId);
        state.selectedId = previous.selectedId && state.graph.nodes.some(node => node.id === previous.selectedId) ? previous.selectedId : '';
        state.selectedEdgeId = previous.edgeId && state.graph.edges.some(edge => edge.id === previous.edgeId) ? previous.edgeId : '';
        render(); return;
      }
      state.page = 'module'; state.tab = 'overview'; state.recordPage = 0; render(); return;
    }
    if (action === 'open-module') { state.moduleId = id; state.page = 'module'; state.tab = 'overview'; state.box = 'T'; state.recordPage = 0; state.graphFocusId = ''; state.graphSearchQuery = ''; state.graphSearchResults = []; state.graphZoom = 1; state.graphLayout = 'radial'; render(); return; }
    if (action === 'change-page') {
      const page = Number(target.dataset.page);
      if (!Number.isInteger(page) || page < 0) return;
      if (target.dataset.pageKind === 'modules') state.modulePage = page;
      else if (target.dataset.pageKind === 'candidateModules') state.candidateModulePage = page;
      else if (target.dataset.pageKind === 'records') state.recordPage = page;
      else return;
      render(); return;
    }
    if (action === 'open-record') return openRecord(id);
    if (action === 'legacy-candidate') {
      const record = state.doc.records[id]; if (!record || record.source.kind !== 'legacy') return;
      if (record.kind === 'module') {
        root.uiToast?.(text('legacyModuleHint', '旧本体以只读方式保留。请打开单条内容后逐项送入待我处理，核对后再决定是否保存；不会整批改写旧数据。'), { variant: 'info' });
        return;
      }
      const module = record.moduleId ? state.doc.records[record.moduleId] : null;
      if (record.access === 'owner_only' || module?.kind === 'module' && module.access === 'owner_only') {
        root.uiToast?.(text('legacyPrivateBlocked', '这条内容仅本人可见，不能送入任务候选。请先在个人本体中重新整理它。'), { variant: 'warning' });
        return;
      }
      const rawSourceId = record.source.recordId;
      const sourceId = typeof rawSourceId === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(rawSourceId) ? rawSourceId : record.id;
      const sourceRef = { kind: 'ontology', id: sourceId, title: recordName(record), ...(module?.kind === 'module' ? { scope: module.scope.kind } : {}) };
      const suggestedType = record.kind === 'rule' ? 'rule' : 'fact';
      await invoke('recall.candidates.save', { judgment: recordName(record).slice(0, 1000), value: legacyCandidateText(record), summary: text('legacyCandidateSummary', '来自旧本体的资料，等待用户核对。'),
        suggestedType, suggestedScope: 'general', sourceRefs: [sourceRef], evidenceRefs: [sourceRef], ...legacyCandidateScope(record), manual: true });
      root.uiToast?.(text('candidateSaved', '已送入“待我处理”，等待你确认。'), { variant: 'success' });
      return;
    }
    if (action === 'search-result') {
      const moduleId = target.dataset.moduleId;
      if (moduleId) state.moduleId = moduleId;
      const record = state.doc.records[id];
      if (record?.kind === 'module') { state.moduleId = record.id; state.page = 'module'; state.tab = 'overview'; render(); return; }
      return openRecord(id);
    }
    if (action === 'clear-selection') { state.selectedId = ''; state.selectedEdgeId = ''; render(); return; }
    if (action === 'graph-full') {
      const previousFocus = state.graphFocusId;
      state.graphFocusId = ''; state.selectedId = ''; state.selectedEdgeId = '';
      try { await loadGraph(state.moduleId); }
      catch (error) { state.graphFocusId = previousFocus; throw error; }
      render(); return;
    }
    if (action === 'focus-record') {
      state.graphFocusId = id; state.selectedId = ''; state.selectedEdgeId = '';
      try { await loadGraph(state.moduleId); }
      catch (error) { state.graphFocusId = ''; throw error; }
      render(); return;
    }
    if (action === 'graph-layout') { if (['radial', 'layers'].includes(target.dataset.layout)) state.graphLayout = target.dataset.layout; render(); return; }
    if (action === 'graph-zoom') {
      const step = Number(target.dataset.zoomStep);
      if (![-1, 1].includes(step)) return;
      state.graphZoom = Math.max(0.65, Math.min(1.8, state.graphZoom + step * 0.2)); render(); return;
    }
    if (action === 'graph-zoom-reset') { state.graphZoom = 1; render(); return; }
    if (action === 'open-graph-record') {
      const record = state.doc.records[id]; if (!record) return;
      if (record.kind !== 'module' && record.moduleId) state.moduleId = record.moduleId;
      state.graphReturn = { moduleId: state.moduleId, focusId: state.graphFocusId, edgeId: state.selectedEdgeId,
        selectedId: state.selectedId, layout: state.graphLayout, zoom: state.graphZoom, at: state.at };
      try { return await openRecord(id); }
      catch (error) { state.graphReturn = null; throw error; }
    }
    if (action === 'create-reference') return openReferenceDialog(target);
    if (action === 'add-content') { state.box = 'A'; state.tab = 'A'; render(); return; }
    if (action === 'create-definition') return openDefinitionDialog(target);
    if (action === 'create-relation-definition') return openDefinitionDialog(target, 'relation');
    if (action === 'create-entity') return openEntityDialog(target);
    if (action === 'create-assertion') return openAssertionDialog(target);
    if (action === 'create-rule') return openRuleDialog(target);
    if (action === 'select-box') { state.box = target.dataset.box; state.tab = target.dataset.box; state.recordPage = 0; render(); return; }
    if (action === 'change-fact' || action === 'correct-fact') return openFactChange(target, action === 'change-fact');
    if (action === 'edit-record') return openEntityDialog(target, state.doc.records[state.recordId]);
    if (action === 'archive-record') {
      const record = state.doc.records[state.recordId]; if (!record) return;
      const confirmed = typeof root.uiConfirm === 'function' ? await root.uiConfirm(text('archiveConfirm', '停用后，任务将不再采用这条内容。是否继续？')) : false;
      if (!confirmed) return;
      await commit([{ intent: 'archive', recordId: record.id, expectedVersion: record.version, sourceLabel: sourceLabel() }]);
      state.page = 'module'; state.tab = 'overview'; render(); return;
    }
  }
  function openFactChange(trigger, change) {
    const fact = state.doc.records[state.recordId]; if (!fact || fact.kind !== 'assertion') return;
    const definition = state.doc.records[fact.definitionId];
    if (!definition || definition.kind !== 'definition') return;
    const objects = recordsIn(state.moduleId, 'entity').map(r => ({ value: r.id, label: r.name }));
    const valueField = definition.valueType === 'entity'
      ? select(text('newValue', '新的关联对象'), 'newObject', objects, fact.object.kind === 'entity' ? fact.object.id : '')
      : definition.valueType === 'boolean'
        ? select(text('newValue', '新的事实值'), 'newValue', [{ value: 'true', label: text('yes', '是') }, { value: 'false', label: text('no', '否') }], fact.object.kind === 'literal' ? String(fact.object.value) : 'false')
        : field(text('newValue', '新的事实值'), 'newValue', fact.object.kind === 'literal' ? String(fact.object.value) : '', definition.valueType === 'date' ? 'date' : definition.valueType === 'number' ? 'number' : 'text');
    const body = `${valueField}${change ? field(text('effectiveFrom', '从哪天开始生效'), 'effectiveFrom', '', 'date') : textarea(text('correctionReason', '纠正说明'), 'reason')}`;
    openDialog({ title: change ? text('changeFactTitle', '记录负责人或关系变更') : text('correctFactTitle', '纠正记错的事实'), body, trigger, onSubmit: data => {
      let value;
      if (definition.valueType === 'entity') {
        if (!data.newObject) throw new Error(text('chooseEntity', '请选择关联对象。'));
        value = { kind: 'entity', id: data.newObject };
      } else {
        const raw = data.newValue;
        if (definition.valueType === 'number') { value = { kind: 'literal', valueType: 'number', value: Number(raw) }; if (!Number.isFinite(value.value)) throw new Error(text('invalidNumber', '请输入有效数字。')); }
        else if (definition.valueType === 'boolean') value = { kind: 'literal', valueType: 'boolean', value: raw === 'true' };
        else value = { kind: 'literal', valueType: definition.valueType, value: raw };
      }
      return commit([{ intent: change ? 'change' : 'correct', recordId: fact.id, expectedVersion: fact.version, ...(change ? { effectiveFrom: data.effectiveFrom } : {}), object: value, sourceLabel: data.reason?.trim() || sourceLabel() }]);
    } });
  }
  function render() {
    if (!state?.root || !state.root.isConnected) return;
    let content;
    if (state.page === 'global-graph') content = graphPage();
    else if (state.page === 'module') content = modulePage();
    else if (state.page === 'record') content = recordPage();
    else if (state.page === 'candidate-organize') content = candidateOrganizePage();
    else content = listPage();
    state.root.innerHTML = `<main class="ontology-workspace">${content}</main>`;
    if (typeof root.hydrateUiTabs === 'function') root.hydrateUiTabs(state.root);
    state.root.querySelectorAll('[data-ui-tabs]').forEach(group => group.addEventListener('ui-tabs-change', event => {
      if (group.dataset.ontologyTabs === 'workspace') {
        state.mode = event.detail.value;
        if (state.mode === 'graph') void enterGraph(true); else render();
      } else if (group.dataset.ontologyTabs === 'module') {
        state.tab = event.detail.value;
        if (['T', 'A', 'R'].includes(state.tab)) { state.box = state.tab; state.recordPage = 0; }
        if (state.tab === 'graph') void enterGraph(false); else render();
      } else if (group.dataset.ontologyTabs === 'candidateBoxes') {
        if (['T', 'A', 'R'].includes(event.detail.value)) state.candidateBox = event.detail.value;
        state.recordPage = 0; render();
      }
    }));
  }
  async function loadInitial(options = {}) {
    state.mountOptions = options;
    state.page = 'list'; state.mode = 'list'; state.candidateDraft = null; state.candidateModuleId = '';
    const result = await invoke('cognition.ontology.snapshot');
    state.doc = result.ontology;
    if (!options.resetToOverview && options.candidateId) {
      const loaded = await invoke('recall.candidates.read', { candidateId: String(options.candidateId) });
      state.candidateDraft = loaded.candidate;
      state.candidateModuleId = loaded.candidate.ontologyHandoff?.moduleIds?.[0] || '';
      state.moduleId = state.candidateModuleId;
      state.candidateBox = 'A'; state.candidateRiskAcknowledged = false; state.page = 'candidate-organize';
      render(); return;
    }
    const moduleId = String(options.moduleId || '');
    if (!options.resetToOverview && moduleId && state.doc.records[moduleId]?.kind === 'module') {
      state.moduleId = moduleId; state.page = 'module'; state.tab = 'overview';
      if (options.recordId) { await openRecord(String(options.recordId)); return; }
    } else if (!options.resetToOverview && options.recordId) {
      await openRecord(String(options.recordId)); return;
    }
    render();
  }
  async function mountCognitionOntology(container, options = {}) {
    state = { root: container, page: 'list', mode: 'list', moduleId: '', tab: 'overview', box: 'T', modulePage: 0, recordPage: 0,
      selectedId: '', selectedEdgeId: '', graphFocusId: '', graphSearchQuery: '', graphSearchResults: [], graphZoom: 1, graphLayout: 'radial', at: new Date().toISOString().slice(0, 10), graph: null, history: [] };
    state.root.addEventListener('click', onClick);
    state.root.addEventListener('input', onInput);
    state.root.addEventListener('keydown', onKeydown);
    state.root.addEventListener('change', onChange);
    window.addEventListener('i18n-change', onI18nChange);
    state.root.innerHTML = `<main class="ontology-workspace"><div class="ontology-ws-loading" role="status">${esc(text('loading', '正在加载本体…'))}</div></main>`;
    try { await loadInitial(options); }
    catch (error) { state.root.innerHTML = `<main class="ontology-workspace"><div class="ontology-ws-error" role="alert"><h1>${esc(text('loadFailed', '本体暂时无法加载'))}</h1><p>${esc(error.message)}</p>${button(text('retry', '重试'), 'retry', 'primary')}</div></main>`; }
  }
  function onClick(event) {
    const edge = event.target.closest('[data-ontology-edge]');
    if (edge) {
      state.selectedEdgeId = edge.dataset.ontologyEdge;
      state.selectedId = '';
      render();
      return;
    }
    const node = event.target.closest('[data-ontology-node]');
    if (node) {
      state.selectedId = node.dataset.ontologyNode;
      state.selectedEdgeId = '';
      const selected = state.graph.nodes.find(n => n.id === state.selectedId);
      if (selected?.kind === 'module') void invoke('cognition.ontology.record.get', { recordId: selected.id }).then(({ record }) => { state.doc.records[record.id] = record; render(); });
      else render();
      return;
    }
    const action = event.target.closest('[data-ontology-action]');
    if (!action) return;
    event.preventDefault();
    if (action.dataset.ontologyAction === 'retry') {
      void loadInitial(state.mountOptions || {}).catch(error => {
        state.root.innerHTML = `<main class="ontology-workspace"><div class="ontology-ws-error" role="alert"><h1>${esc(text('loadFailed', '本体暂时无法加载'))}</h1><p>${esc(error.message)}</p>${button(text('retry', '重试'), 'retry', 'primary')}</div></main>`;
      });
      return;
    }
    void handleAction(action.dataset.ontologyAction, action).catch(error => root.uiToast?.(error.message || text('error', '操作未完成，请稍后重试。'), { variant: 'error' }));
  }
  let searchTimer = null;
  function onInput(event) {
    const graphInput = event.target.closest('[data-ontology-field="graphSearch"]');
    if (graphInput && state && state.page === 'module' && state.tab === 'graph') {
      state.graphSearchQuery = graphInput.value.trim();
      state.selectedId = ''; state.selectedEdgeId = '';
      clearTimeout(searchTimer);
      searchTimer = setTimeout(async () => {
        if (!state || state.page !== 'module' || state.tab !== 'graph') return;
        try {
          const result = state.graphSearchQuery
            ? await invoke('cognition.ontology.search', { query: state.graphSearchQuery, moduleId: state.moduleId })
            : { results: [] };
          state.graphSearchResults = result.results.filter(row => row.kind !== 'module');
          render();
        } catch (error) { root.uiToast?.(error.message, { variant: 'error' }); }
      }, 180);
      return;
    }
    const input = event.target.closest('[data-ontology-field="search"]');
    if (!input || !state || state.page !== 'list') return;
    state.searchQuery = input.value.trim();
    clearTimeout(searchTimer);
    searchTimer = setTimeout(async () => {
      if (!state || state.page !== 'list') return;
      try {
        const result = state.searchQuery ? await invoke('cognition.ontology.search', { query: state.searchQuery }) : { results: [] };
        state.searchResults = result.results;
        const slot = state.root.querySelector('.ontology-ws-search-results,.ontology-ws-search-empty');
        if (!state.searchQuery) { slot?.remove(); return; }
        const replacement = document.createElement('div');
        replacement.className = result.results.length ? 'ontology-ws-search-results' : 'ontology-ws-search-empty';
        replacement.innerHTML = result.results.length ? searchResultRows(result.results, 'search-result') : esc(text('noSearchResults', '没有找到匹配内容。'));
        if (slot) slot.replaceWith(replacement); else if (state.searchQuery) state.root.querySelector('.ontology-ws-search')?.appendChild(replacement);
        else replacement.remove();
      } catch (error) { root.uiToast?.(error.message, { variant: 'error' }); }
    }, 180);
  }
  function onKeydown(event) {
    const edge = event.target.closest?.('[data-ontology-edge]');
    if (edge && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onClick({ target: edge }); return; }
    const node = event.target.closest?.('[data-ontology-node]');
    if (!node || (event.key !== 'Enter' && event.key !== ' ')) return;
    event.preventDefault();
    onClick({ target: node });
  }
  function onI18nChange() { if (state) render(); }
  function onChange(event) {
    const input = event.target.closest('[data-ontology-field="graphAt"]'); if (!input) return;
    state.at = input.value;
    void loadGraph(state.moduleId).then(render).catch(error => root.uiToast?.(error.message, { variant: 'error' }));
  }
  function unmountCognitionOntology() {
    if (!state?.root) return;
    state.root.removeEventListener('click', onClick);
    state.root.removeEventListener('input', onInput);
    state.root.removeEventListener('keydown', onKeydown);
    state.root.removeEventListener('change', onChange);
    window.removeEventListener('i18n-change', onI18nChange);
    state.root.innerHTML = '';
    state = null;
  }
  window.mountCognitionOntology = mountCognitionOntology;
  window.unmountCognitionOntology = unmountCognitionOntology;
})(typeof window !== 'undefined' ? window : globalThis);
