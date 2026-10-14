/* A readable projection of one canonical ontology module. No record IDs are printed as prose. */
(function initOntologyDocument(root) {
  'use strict';

  function today() { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`; }

  function render({ doc, moduleId, text, esc, drafts = {}, editable = true, at = today(), expandedId = '', inspector = () => '' }) {
    const records = doc?.records || {};
    const module = records[moduleId];
    if (!module || module.kind !== 'module') return '';
    const t = (key, fallback, vars) => text(key, fallback, vars);
    const e = value => esc(value == null ? '' : String(value));
    const control = (label, action, className, attrs = {}, icon = '', iconOnly = false) => root[iconOnly ? 'uiIconButton' : 'uiButton']({ label, role: 'ghost', size: 'sm', className, ...(icon ? { icon } : {}), attrs: { 'data-ontology-action': action, ...attrs } });
    const actionButton = (label, action, attrs = {}) => root.uiButton({ label, role: 'ghost', className: 'ontology-doc-inline-action', attrs: { 'data-ontology-action': action, ...attrs } });
    const local = Object.values(records).filter(record => record && record.moduleId === moduleId);
    const byKind = kind => local.filter(record => record.kind === kind && record.status === 'active');
    const definitions = byKind('definition');
    const entities = byKind('entity');
    const assertions = local.filter(record => record.kind === 'assertion');
    const rules = byKind('rule');
    const references = byKind('reference');

    const currentFacts = assertions.filter(record => record.status === 'active'
      && (!record.validity?.from || record.validity.from <= at.slice(0, record.validity.precision === 'month' ? 7 : 10))
      && (!record.validity?.until || record.validity.until > at.slice(0, record.validity.precision === 'month' ? 7 : 10)));
    const historicalFacts = assertions.filter(record => !currentFacts.includes(record));
    const sourceGroups = [];
    const sourceNumber = new Map();
    for (const record of [module, ...local]) {
      if (!record.source) continue;
      const key = JSON.stringify(record.source);
      let index = sourceGroups.findIndex(group => group.key === key);
      if (index < 0) { index = sourceGroups.length; sourceGroups.push({ key, source: record.source, records: [] }); }
      sourceGroups[index].records.push(record);
      sourceNumber.set(record.id, index + 1);
    }
    const writable = record => editable && module.status === 'active' && module.source?.kind !== 'legacy'
      && record.status === 'active' && record.source?.kind !== 'legacy';
    const recordActions = record => {
      const attrs = { 'data-record-id': record.id };
      const detail = writable(record) && ['definition', 'entity', 'rule', 'reference'].includes(record.kind)
        ? actionButton(t('editDetails', '详细编辑'), 'edit-record', attrs) : '';
      const history = record.source?.kind !== 'legacy' && record.kind !== 'module'
        ? actionButton(t('history', '变更记录'), 'record-details', attrs) : '';
      const factActions = writable(record) && record.kind === 'assertion'
        ? actionButton(t('changeFact', '从某天起变更'), 'change-fact', attrs) + actionButton(t('correctFact', '纠正记错的事实'), 'correct-fact', attrs) : '';
      const actions = detail + factActions + history;
      return actions ? `<details class="ontology-doc-record-menu"><summary aria-label="${e(t('recordActions', '记录操作'))}">⋯</summary><div>${actions}</div></details>` : '';
    };
    const draftValue = (record, path) => {
      const changes = drafts instanceof Map ? drafts.get(record.id)?.changes : drafts?.[record.id]?.changes;
      if (changes && Object.prototype.hasOwnProperty.call(changes, path)) return changes[path];
      return path.split('.').reduce((value, part) => value?.[part], record);
    };
    const label = (id, fallbackKey = 'unavailableObject') => {
      const record = records[id];
      return record && typeof record.name === 'string' ? record.name : t(fallbackKey, '不可用对象');
    };
    const edit = (record, path, tag = 'span', type = '', choices = []) => {
      const raw = draftValue(record, path);
      const selectedChoice = choices.find(option => String(option.value) === String(raw));
      const value = selectedChoice ? selectedChoice.label : Array.isArray(raw) ? raw.join('、') : raw == null ? '' : String(raw);
      if (!writable(record)) return `<${tag}>${e(value)}</${tag}>`;
      const field = t(path.split('.').at(-1), path);
      const content = `<span class="ont-ai-field"><span class="ontology-doc-edit ont-ai-text" tabindex="0" data-ontology-edit="${e(path)}" data-record-id="${e(record.id)}"${choices.length ? ` data-edit-options="${e(JSON.stringify(choices))}"` : ''}${type ? ` data-edit-type="${type}"` : ''} aria-label="${e(t('selectFieldEdit', '{field}，选中文字或按 Enter 请求修改', { field }))}">${e(value)}</span>${control(t('requestFieldEdit', '请求修改{field}', { field }), 'selection-edit', 'ont-ai-trigger', { 'data-record-id': record.id, 'data-field': path }, 'sparkles', true)}</span>`;
      return tag === 'span' ? content : `<${tag}>${content}</${tag}>`;
    };
    const enumLabel = key => t(key === 'one' ? 'cardinalityOneLabel' : key === 'many' ? 'cardinalityManyLabel' : key, ({ entity: '对象', text: '文字', number: '数字', boolean: '是或否', date: '日期', one: '单值', many: '多值', subject: '以起点为准', object: '以终点为准', required: '必须遵守', default: '默认采用', suggestion: '建议', logic: '逻辑关系' })[key] || key);
    const empty = () => `<p class="ontology-doc-empty ont-section-empty">${e(t('boxEmpty', '这里还没有内容。'))}</p>`;
    const recordState = record => {
      const parts = [];
      if (record.status !== 'active') parts.push(t(record.status, ({ paused: '已暂停', archived: '已归档', corrected: '已纠正' })[record.status] || record.status));
      if (record.source?.kind === 'legacy') parts.push(t('legacyReadOnlyShort', '旧内容只读'));
      if (record.certainty && record.certainty !== 'confirmed') parts.push(t(record.certainty === 'unknown' ? 'unknownCertainty' : record.certainty, record.certainty === 'inferred' ? '推断' : '未知'));
      return parts.length ? `<span class="ontology-doc-state">${e(parts.join(' · '))}</span>` : '';
    };
    const provenance = record => {
      const number = sourceNumber.get(record.id);
      const parts = [];
      if (record.access === 'owner_only' && module.access !== 'owner_only') parts.push(t('privateAccess', '仅自己查看，不提供给任务'));
      return `<div class="ontology-doc-provenance">${Number.isInteger(number) ? `<a href="#ontology-doc-source-${number}" data-ontology-action="document-source" data-record-id="${e(record.id)}" title="${e(record.source?.label)}">S${number}</a>` : ''}${parts.length ? ` · ${e(parts.join(' · '))}` : ''}${recordState(record)}</div>`;
    };
    const typeNames = ids => ids?.length ? ids.map(id => label(id, 'unavailableType')).join('、') : t('noTypeLimit', '不限定');
    const valueName = value => value?.kind === 'entity' ? label(value.id) : value?.kind === 'literal'
      ? typeof value.value === 'boolean' ? t(value.value ? 'yes' : 'no', value.value ? '是' : '否') : String(value.value ?? '') : t('unknown', '未知');
    const conditionName = condition => {
      if (!condition) return t('noCondition', '所有任务');
      if (condition.kind === 'task') return `${t(condition.field, condition.field)} = ${condition.equals}`;
      if (condition.kind === 'assertion') return `${label(condition.subjectId)} · ${label(condition.definitionId, 'unavailableDefinition')}${condition.object ? ` · ${valueName(condition.object)}` : ''}`;
      if (condition.kind === 'not') return `${t('not', '不满足')} ${conditionName(condition.condition)}`;
      return (condition.conditions || []).map(conditionName).join(` ${t(condition.kind === 'all' ? 'and' : 'or', condition.kind === 'all' ? '并且' : '或者')} `);
    };
    const effectName = effect => {
      if (!effect) return '';
      if (effect.kind === 'include_recipient') return `${t('includeRecipient', '加入接收人')}：${label(effect.entityId)}`;
      if (effect.kind === 'required_section') return `${t('requiredSection', '必需章节')}：${effect.name}`;
      if (effect.kind === 'choice') return `${t('choice', '选择')}：${effect.key} = ${effect.value}`;
      return t('noteOnly', '显示说明');
    };
    const disclosure = record => control(t('toggleRecordDetails', '展开或收起记录详情：{name}', { name: record.name || `${label(record.subjectId)} · ${label(record.definitionId)}` }), 'document-disclosure', 'ont-record-disclosure', { 'data-record-id': record.id, 'aria-expanded': String(expandedId === record.id), 'aria-controls': `ontology-record-panel-${record.id}` }, 'chevron-right', true);
    const extra = (record, columns = 0) => {
      const body = expandedId === record.id ? inspector(record) : '';
      return columns ? `<tr class="ont-scan-expanded" id="ontology-record-panel-${e(record.id)}" data-ontology-panel="${e(record.id)}" ${body ? '' : 'hidden'}><td colspan="${columns}">${body}</td></tr>`
        : `<div class="ont-fact-expanded-panel" id="ontology-record-panel-${e(record.id)}" data-ontology-panel="${e(record.id)}" ${body ? '' : 'hidden'}>${body}</div>`;
    };
    const title = record => `<span class="ont-record-name">${edit(record, 'name')}${control(t('viewRecordDetails', '查看{name}详情', { name: record.name }), 'document-disclosure', 'ont-record-title ont-record-open', { 'data-record-id': record.id }, 'external-link', true)}</span>`;
    const add = (label, action) => editable ? control(label, action, 'ont-section-add', {}, 'plus') : '';
    const table = (heads, rows, className) => `<div class="ont-scan-table-wrap"><table class="ontology-doc-table ont-scan-table ${className}"><thead><tr>${heads.map(head => `<th scope="col">${e(head)}</th>`).join('')}<th scope="col" class="ont-scan-menu"><span class="sr-only">${e(t('recordActions', '操作'))}</span></th></tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
    const definitionRows = list => list.map(record => {
      const types = record.definitionKind === 'type';
      const connection = `${e(typeNames(record.subjectTypes))} <span>→</span> ${e(record.definitionKind === 'relation' ? typeNames(record.objectTypes) : enumLabel(record.valueType))}`;
      return `<tr data-record-id="${e(record.id)}"><td>${title(record)}</td><td>${types ? edit(record, 'description', 'div') : `<span class="ont-scan-signature">${connection}</span>`}</td><td>${types ? provenance(record) : edit(record, 'cardinality', 'span', '', ['one', 'many'].map(value => ({ value, label: enumLabel(value) })))}</td><td>${types ? '' : `<details class="ont-scan-row-detail"><summary>${e(t('description', '说明'))} ${provenance(record)}</summary><p>${edit(record, 'description')}</p></details>`}</td><td class="ont-scan-menu">${disclosure(record)}</td></tr>${extra(record, types ? 4 : 5)}`;
    });
    const ruleRows = rules.map(record => `<tr data-record-id="${e(record.id)}"><td>${title(record)} <small class="ont-scan-rule-strength">${edit(record, 'strength', 'span', '', ['required', 'default', 'suggestion', 'logic'].map(value => ({ value, label: enumLabel(value) })))}</small></td><td>${edit(record, 'requirement', 'p')}</td><td><details class="ont-scan-row-detail"><summary>${e(t('conditionShort', '条件'))} ${provenance(record)}</summary><p>${e(t('condition', '条件'))}：${e(conditionName(record.condition))}</p><p>${e(t('effect', '影响'))}：${e(effectName(record.effect))}</p><p>${e(t('exception', '例外'))}：${edit(record, 'exception')}</p></details></td><td class="ont-scan-menu">${disclosure(record)}</td></tr>${extra(record, 4)}`);
    const group = (list, key) => {
      const groups = new Map();
      for (const record of list) { const name = key(record); if (!groups.has(name)) groups.set(name, []); groups.get(name).push(record); }
      return [...groups];
    };
    const objectGroups = group(entities, record => record.typeId || '').map(([typeId, list]) => `<div class="ont-scan-object-group"><h4>${e(label(typeId, 'unavailableType'))}</h4><div class="ont-scan-object-list">${list.map(record => `<div class="ont-scan-object" data-record-id="${e(record.id)}"><div class="ont-scan-object-title">${title(record)}${record.identityStatus !== 'confirmed' ? `<small class="ont-unknown">${e(t('identityUnknown', '身份待核对'))}</small>` : ''}${control(t('description', '说明'), 'object-description', 'ont-object-disclosure', { 'data-record-id': record.id, id: `ontology-object-trigger-${record.id}`, 'aria-expanded': 'false', 'aria-controls': `ontology-object-detail-${record.id}` }, 'chevron-right')}</div><details class="ont-scan-object-detail" id="ontology-object-detail-${e(record.id)}" data-object-id="${e(record.id)}"><summary hidden>${e(t('objectDescription', '对象说明'))}</summary><div role="region" aria-label="${e(record.name)}"><div class="ont-object-detail-heading">${e(record.name)}${control(t('closeObjectDescription', '收起说明 ↑'), 'object-description-close', 'ont-object-close', { 'data-record-id': record.id })}</div><p>${e(t('type', '类型'))}：${e(label(typeId, 'unavailableType'))}</p><div>${edit(record, 'description')}</div>${record.aliases?.length ? `<p>${e(t('aliases', '别名'))}：${edit(record, 'aliases', 'span', 'array')}</p>` : ''}${provenance(record)}</div></details><div class="ont-object-record-extra" id="ontology-record-panel-${e(record.id)}" data-ontology-panel="${e(record.id)}" ${expandedId === record.id ? '' : 'hidden'}>${expandedId === record.id ? inspector(record) : ''}</div></div>`).join('')}</div></div>`).join('');
    const fact = record => {
      const value = draftValue(record, 'object.value');
      const object = record.object?.kind === 'entity' ? edit(record, 'object.id', 'span', '', entities.map(entity => ({ value: entity.id, label: entity.name })))
        : record.object?.valueType === 'boolean' ? edit(record, 'object.value', 'span', 'boolean', [{ value: true, label: t('yes', '是') }, { value: false, label: t('no', '否') }])
          : edit(record, 'object.value', 'span', ['number', 'date'].includes(record.object?.valueType) ? record.object.valueType : '');
      return `<div class="ont-scan-fact" data-record-id="${e(record.id)}"><div class="ont-scan-fact-line"><span class="ont-scan-fact-copy">${control(label(record.definitionId, 'unavailableDefinition'), 'document-disclosure', 'ont-scan-predicate', { 'data-record-id': record.id })}<span class="ont-scan-value">${object}</span></span><span class="ont-scan-fact-citations">${provenance(record)}</span><span class="ont-scan-fact-menu">${disclosure(record)}</span></div><small class="ont-scan-time">${e(record.validity?.from ? record.validity.from + (record.validity.until ? ' 至 ' + record.validity.until : ' 起') : t('unknownDate', '起点未知'))}${record.certainty && record.certainty !== 'confirmed' ? ` · ${e(t('unconfirmed', '待核对'))}` : ''}${recordState(record)}</small></div>`;
    };
    const facts = list => group(list, record => record.subjectId).map(([subject, rows]) => `<div class="ont-scan-fact-group"><h4>${e(label(subject))}</h4><div class="ont-scan-fact-content"><div class="ont-scan-fact-list">${rows.map(fact).join('')}</div>${rows.map(record => extra(record)).join('')}</div></div>`).join('') || empty();
    const reference = record => `<li data-record-id="${e(record.id)}"><strong>${e(label(record.targetModuleId, 'unavailableModule'))}</strong>${record.targetRecordId ? ` → ${e(label(record.targetRecordId))}` : ''}<span class="ontology-doc-cell-note"> · ${e(t('versionPolicy', '引用版本方式'))}：${e(t(record.versionPolicy === 'pinned' ? 'pinnedVersion' : 'currentVersion', record.versionPolicy))}${record.targetVersion ? ` v${e(record.targetVersion)}` : ''}</span>${provenance(record)}${recordActions(record)}</li>`;
    const sourceRows = sourceGroups.map((group, index) => {
      const source = group.source;
      const refs = Array.isArray(source.refs) ? source.refs : [];
      const details = refs.map(ref => {
        const refLabel = `${t(ref.kind, ref.kind)} · ${ref.id}`;
        const original = /^ontimport-[a-f0-9]{64}$/.test(ref.id)
          ? ` ${actionButton(t('viewOriginalSource', '查看完整原文'), 'view-import-source', { 'data-source-id': ref.id })}` : '';
        return `<li>${e(refLabel)}${original}</li>`;
      }).join('');
      const metadata = group.records.map(record => {
        const name = 'name' in record ? record.name : record.kind === 'assertion'
          ? `${label(record.subjectId)} · ${label(record.definitionId, 'unavailableDefinition')}` : t(record.kind, record.kind);
        const dates = [record.createdAt && `${t('createdAt', '创建时间')}：${record.createdAt}`,
          record.updatedAt && record.updatedAt !== record.createdAt && `${t('updatedAt', '更新时间')}：${record.updatedAt}`].filter(Boolean);
        return `<li>${e(name)}${dates.length ? ` · ${e(dates.join(' · '))}` : ''}</li>`;
      }).join('');
      return `<li id="ontology-doc-source-${index + 1}"><strong>S${index + 1} · ${e(source.label || t(source.kind, '未知来源'))}</strong><span class="ontology-doc-cell-note"> · ${e(t(source.kind, source.kind))}</span>${source.recordId ? `<div class="ontology-doc-cell-note">${e(t('sourceRecord', '来源记录'))}：${e(source.recordId)}</div>` : ''}${refs.length ? `<div class="ontology-doc-cell-note">${e(t('refs', '引用来源'))}</div><ul>${details}</ul>` : ''}<details><summary>${e(t('sourceMetadata', '关联记录与时间'))}</summary><ul>${metadata}</ul></details></li>`;
    });
    const countButton = (label, id, count) => control(label + ' ' + count, 'document-section', '', { 'data-section': id });
    const types = definitions.filter(record => record.definitionKind === 'type'), relations = definitions.filter(record => record.definitionKind !== 'type');
    const scope = t(module.scope?.kind === 'workspace' ? 'workspaceScopeLabel' : module.scope?.kind, ({ personal: '个人', project: '项目', workspace: '工作空间' })[module.scope?.kind] || '');
    return `<article class="ontology-doc ont-document-paper" aria-label="${e(t('documentView', '本体文档'))}"><header class="ont-doc-heading ont-scan-heading"><div class="ont-scan-title-line">${edit(module, 'name', 'h1')}<span class="ont-scan-meta">${e(scope)}${module.scope?.id ? ` · ${e(module.scope.id)}` : ''} · ${e(t('recordVersion', '记录'))} v${module.version || '—'}${editable ? '' : ` · ${e(t('readonly', '只读'))}`}</span>${control(sourceGroups.length + ' ' + t('sourcesCount', '份来源'), 'document-section', 'ont-scan-source-link', { 'data-section': 'ontology-doc-references' }, 'external-link')}</div><details class="ont-scan-about"><summary>${e(t('moduleDescription', '本体说明'))}</summary>${edit(module, 'description', 'p')}${provenance(module)}</details></header>
      <nav class="ont-document-contents" aria-label="${e(t('documentChapters', '文档章节'))}">${countButton(t('concepts', '概念'), 'ontology-doc-tbox', definitions.length)}${countButton(t('rulesShort', '规则'), 'ontology-doc-rbox', rules.length)}${control(t('objectsShort', '对象') + ' ' + entities.length + ' · ' + t('facts', '事实') + ' ' + currentFacts.length, 'document-section', '', { 'data-section': 'ontology-doc-abox' })}<span class="ont-save-caption" data-document-save role="status" aria-live="polite">${e(editable ? t('documentEditHint', '选中文字即可修改') : t('readonly', '只读'))}</span></nav>
      <div class="ont-scan-document"><section id="ontology-doc-tbox" class="ont-scan-section" data-box="T"><div class="ont-scan-section-heading"><h2><span>T</span> ${e(t('conceptsStructure', '概念与结构'))}</h2><span>${definitions.length} ${e(t('definitionsCount', '个定义'))}</span><div class="grow"></div>${add(t('addConcept', '添加概念'), 'create-definition')}</div>${types.length ? table([t('concept', '概念'), t('meaning', '含义'), t('evidence', '依据'), ''], definitionRows(types), 'ont-scan-types') : empty()}<div class="ont-scan-subheading"><h3>${e(t('relationAndAttributeDefinitions', '关系与属性定义'))} <small>${relations.length}</small></h3>${add(t('addRelationAttribute', '添加关系或属性'), 'create-relation-definition')}</div>${relations.length ? table([t('relationAttribute', '关系 / 属性'), t('definitionSignature', '主体 → 目标 / 值'), t('constraints', '约束'), t('descriptionEvidence', '说明与依据')], definitionRows(relations), 'ont-scan-definitions') : empty()}</section>
      <section id="ontology-doc-rbox" class="ont-scan-section" data-box="R"><div class="ont-scan-section-heading"><h2><span>R</span> ${e(t('rulesConstraints', '规则与约束'))}</h2><span>${rules.length} ${e(t('rulesCount', '条规则'))}</span><div class="grow"></div>${add(t('addRule', '添加规则'), 'create-rule')}</div>${rules.length ? table([t('rule', '规则'), t('requirement', '要求'), t('conditionsEvidence', '条件与依据')], ruleRows, 'ont-scan-rules') : empty()}</section>
      <section id="ontology-doc-abox" class="ont-scan-section" data-box="A"><div class="ont-scan-section-heading"><h2><span>A</span> ${e(t('objectsFacts', '对象与事实'))}</h2><span>${entities.length} ${e(t('objectCount', '个对象'))} · ${currentFacts.length} ${e(t('factCount', '条事实'))}</span><div class="grow"></div>${add(t('addEntity', '添加对象'), 'create-entity')}</div><div class="ont-scan-subheading"><h3>${e(t('objects', '具体对象'))}</h3></div><div class="ont-scan-object-table">${objectGroups || empty()}</div><div class="ont-scan-subheading"><h3>${e(t('relationsFacts', '关系与事实'))} <small>${currentFacts.length}</small></h3><div class="row">${control(t('asOf', '截至') + ' ' + at, 'document-date', 'ont-date-link', {}, 'chevron-down')}${add(t('addFact', '添加事实'), 'create-assertion')}</div></div><div class="ont-scan-fact-table">${facts(currentFacts)}</div>${historicalFacts.length ? `<details class="ont-scan-evidence-disclosure"><summary>${e(t('historicalFactsDocument', '历史及非当前事实'))} · ${historicalFacts.length}</summary><div class="ont-scan-fact-table">${facts(historicalFacts)}</div></details>` : ''}</section></div>
      <details class="ont-crosscut"><summary>${e(t('referencesSourcesHistory', '引用、来源与历史'))}</summary><section id="ontology-doc-references"><div class="ont-scan-subheading"><h3>${e(t('references', '跨本体引用'))}</h3>${add(t('createReference', '添加引用'), 'create-reference')}</div>${references.length ? `<ul class="ontology-doc-references">${references.map(reference).join('')}</ul>` : empty()}<h3>${e(t('sourcesDocument', '来源'))}</h3><ul class="ontology-doc-sources">${sourceRows.join('')}</ul>${local.some(record => record.status !== 'active' && record.kind !== 'assertion') ? `<details class="ont-secondary-block"><summary>${e(t('inactiveRecords', '停用与纠正记录'))}</summary>${local.filter(record => record.status !== 'active' && record.kind !== 'assertion').map(record => `<p>${e(record.name)}${recordState(record)}${provenance(record)}${recordActions(record)}</p>`).join('')}</details>` : ''}</section></details></article>`;

  }

  root.CogOntologyDocument = { render, today };
})(window);
