/* 本体主档的关系图投影。所有保存均由本体页面处理。 */
(function initCogOntologyGraph(root) {
  'use strict';

  const escapeHtml = value => String(value == null ? '' : value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
  const hash = value => {
    let result = 2166136261;
    for (const character of String(value)) result = Math.imul(result ^ character.charCodeAt(0), 16777619);
    return result >>> 0;
  };
  const compare = (a, b) => String(a.id).localeCompare(String(b.id));
  const short = value => String(value || '').length > 15 ? `${String(value).slice(0, 14)}…` : String(value || '');
  const today = () => {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  };
  const validAt = (record, at) => {
    const validity = record.validity || {};
    const from = validity.from && validity.precision === 'month' ? `${validity.from}-01` : validity.from;
    const until = validity.until && validity.precision === 'month' ? `${validity.until}-01` : validity.until;
    return (!from || from <= at) && (!until || at < until);
  };
  const editableRecord = (records, record) => {
    const module = record?.kind === 'module' ? record : records?.[record?.moduleId];
    return record?.status === 'active' && record.source?.kind !== 'legacy'
      && module?.status === 'active' && module.source?.kind !== 'legacy';
  };

  function project(doc, moduleId, at) {
    const records = doc?.records || {};
    const active = record => record?.status === 'active' && records[record.moduleId]?.status === 'active';
    const nodes = [], edges = [], literalFacts = new Map();
    if (!moduleId) {
      const modules = Object.values(records).filter(record => record.kind === 'module' && record.status === 'active').sort(compare);
      const ids = new Set(modules.map(record => record.id));
      for (const module of modules) nodes.push({ id: module.id, record: module, label: module.name, kind: 'module' });
      for (const record of Object.values(records)) if (record.kind === 'reference' && active(record)
        && ids.has(record.moduleId) && ids.has(record.targetModuleId)) {
        edges.push({ id: record.id, from: record.moduleId, to: record.targetModuleId, record,
          label: record.targetRecordId ? '引用对象' : '引用本体',
          labelKey: record.targetRecordId ? 'graphRecordReference' : 'graphModuleReference', kind: 'reference' });
      }
    } else {
      const module = records[moduleId];
      if (!module || module.kind !== 'module' || module.status !== 'active') return { nodes, edges, literalFacts };
      const entityIds = new Set();
      for (const record of Object.values(records)) if (record.kind === 'entity' && record.moduleId === moduleId && active(record)) {
        entityIds.add(record.id);
        nodes.push({ id: record.id, record, label: record.name, kind: 'entity' });
      }
      for (const record of Object.values(records)) {
        if (record.kind !== 'assertion' || record.moduleId !== moduleId || !active(record) || !validAt(record, at)) continue;
        if (!entityIds.has(record.subjectId)) continue;
        if (record.object?.kind === 'literal') {
          literalFacts.set(record.subjectId, [...(literalFacts.get(record.subjectId) || []), record]);
          continue;
        }
        const target = records[record.object?.id];
        if (!target || target.kind !== 'entity' || target.status !== 'active' || records[target.moduleId]?.status !== 'active') continue;
        if (!entityIds.has(target.id)) {
          entityIds.add(target.id);
          nodes.push({ id: target.id, record: target, label: target.name, kind: 'entity', referenced: true });
        }
        edges.push({ id: record.id, from: record.subjectId, to: target.id, record,
          label: records[record.definitionId]?.name || '关系',
          labelKey: records[record.definitionId]?.name ? '' : 'relation', kind: 'assertion',
          unknownDate: !record.validity?.from, certainty: record.certainty || 'confirmed',
          uncertain: Boolean(record.certainty && record.certainty !== 'confirmed') });
      }
      for (const record of Object.values(records)) if (record.kind === 'rule' && record.moduleId === moduleId && active(record)) {
        nodes.push({ id: record.id, record, label: record.name, kind: 'rule' });
        if (record.effect?.kind === 'include_recipient' && entityIds.has(record.effect.entityId))
          edges.push({ id: `rule:${record.id}`, from: record.id, to: record.effect.entityId,
            record, label: '接收人', labelKey: 'graphRecipient', kind: 'rule', certainty: record.certainty || 'confirmed',
            uncertain: Boolean(record.certainty && record.certainty !== 'confirmed') });
      }
    }
    nodes.sort(compare); edges.sort(compare);
    return { nodes, edges, literalFacts };
  }

  function visibleProjection(projected, focusId, limit = 110) {
    const { nodes, edges } = projected;
    if (nodes.length <= limit) return { nodes, edges, hidden: 0 };
    const adjacency = new Map(nodes.map(node => [node.id, new Set()]));
    for (const edge of edges) {
      adjacency.get(edge.from)?.add(edge.to);
      adjacency.get(edge.to)?.add(edge.from);
    }
    const selected = new Set(), queue = [];
    const seed = focusId && adjacency.has(focusId) ? focusId
      : [...nodes].sort((a, b) => (adjacency.get(b.id)?.size || 0) - (adjacency.get(a.id)?.size || 0) || compare(a, b))[0]?.id;
    if (seed) queue.push(seed);
    while (selected.size < limit) {
      if (!queue.length) {
        const next = nodes.find(node => !selected.has(node.id));
        if (!next) break;
        queue.push(next.id);
      }
      const id = queue.shift();
      if (selected.has(id)) continue;
      selected.add(id);
      queue.push(...[...(adjacency.get(id) || [])].sort());
    }
    return { nodes: nodes.filter(node => selected.has(node.id)),
      edges: edges.filter(edge => selected.has(edge.from) && selected.has(edge.to)), hidden: nodes.length - selected.size };
  }

  const NODE_RADIUS = 48;
  const labelWidth = label => Math.max(42, [...String(label)].reduce((sum, char) => sum + (/[\u2e80-\uffff]/.test(char) ? 13 : 7), 0) + 18);

  function positionsFor(nodes, edges, saved) {
    const positions = new Map();
    if (!nodes.length) return positions;
    const connected = new Set(edges.flatMap(edge => [edge.from, edge.to]));
    const ordered = nodes.filter(node => connected.has(node.id)).sort(compare);
    const isolated = nodes.filter(node => !connected.has(node.id)).sort(compare);
    const count = ordered.length, radius = Math.max(170, Math.sqrt(count) * 100);
    for (let index = 0; index < count; index++) {
      const node = ordered[index], angle = index * 2.399963229728653 + hash(node.id) / 0xffffffff * .35;
      const distance = Math.sqrt((index + .5) / count) * radius;
      positions.set(node.id, saved.get(node.id) || { x: Math.cos(angle) * distance * 1.65, y: Math.sin(angle) * distance });
    }
    // Spread the connected graph across a landscape canvas. Isolated rules are
    // packed afterward, so they cannot push the useful component into a tiny cluster.
    for (let turn = 0; turn < 180; turn++) {
      const delta = new Map(ordered.map(node => [node.id, { x: 0, y: 0 }]));
      for (let i = 0; i < count; i++) for (let j = i + 1; j < count; j++) {
        const a = positions.get(ordered[i].id), b = positions.get(ordered[j].id);
        const dx = a.x - b.x || .01, dy = a.y - b.y || .01;
        const distance = Math.max(1, Math.hypot(dx / 1.55, dy));
        const force = Math.max(0, 220 - distance) / distance * .22;
        delta.get(ordered[i].id).x += dx * force; delta.get(ordered[i].id).y += dy * force;
        delta.get(ordered[j].id).x -= dx * force; delta.get(ordered[j].id).y -= dy * force;
      }
      for (const edge of edges) {
        const a = positions.get(edge.from), b = positions.get(edge.to);
        if (!a || !b || edge.from === edge.to) continue;
        const dx = b.x - a.x, dy = b.y - a.y, distance = Math.max(1, Math.hypot(dx, dy));
        const force = (distance - 290) / distance * .014;
        delta.get(edge.from).x += dx * force; delta.get(edge.from).y += dy * force;
        delta.get(edge.to).x -= dx * force; delta.get(edge.to).y -= dy * force;
      }
      for (const node of ordered) {
        if (saved.has(node.id)) continue;
        const position = positions.get(node.id), movement = delta.get(node.id);
        position.x += Math.max(-16, Math.min(16, movement.x));
        position.y += Math.max(-16, Math.min(16, movement.y));
      }
    }
    for (const node of ordered) if (!saved.has(node.id)) {
      const position = positions.get(node.id); position.x *= 1.12; position.y *= .52;
    }
    // Compress the initial aspect ratio without allowing circular nodes to collide.
    for (let turn = 0; turn < 40; turn++) for (let i = 0; i < count; i++) for (let j = i + 1; j < count; j++) {
      const a = positions.get(ordered[i].id), b = positions.get(ordered[j].id);
      const dx = b.x - a.x || .01, dy = b.y - a.y || .01, distance = Math.max(.1, Math.hypot(dx, dy));
      if (distance >= 158) continue;
      const force = (158 - distance) / distance * .5;
      if (!saved.has(ordered[i].id)) { a.x -= dx * force; a.y -= dy * force; }
      if (!saved.has(ordered[j].id)) { b.x += dx * force; b.y += dy * force; }
    }
    const values = [...positions.values()];
    const width = values.length ? Math.max(480, Math.max(...values.map(p => p.x)) - Math.min(...values.map(p => p.x))) : Math.max(480, Math.sqrt(isolated.length * 2) * 180);
    const columns = Math.max(1, Math.floor(width / 180));
    const middle = values.length ? (Math.min(...values.map(p => p.x)) + Math.max(...values.map(p => p.x))) / 2 : 0;
    const bottom = values.length ? Math.max(...values.map(p => p.y)) + 180 : 0;
    isolated.forEach((node, index) => {
      const rowCount = Math.min(columns, isolated.length - Math.floor(index / columns) * columns);
      positions.set(node.id, saved.get(node.id) || { x: middle + (index % columns - (rowCount - 1) / 2) * 180, y: bottom + Math.floor(index / columns) * 150 });
    });
    return positions;
  }

  function edgeRoutes(nodes, edges, positions, labelFor) {
    const placed = [], routes = new Map();
    const nodePositions = nodes.map(node => ({ id: node.id, ...positions.get(node.id) }));
    const overlaps = (a, b, gap = 8) => Math.abs(a.x - b.x) < (a.width + b.width) / 2 + gap && Math.abs(a.y - b.y) < (a.height + b.height) / 2 + gap;
    const touchesNode = (box, node, radius = NODE_RADIUS + 12) => Math.hypot(Math.max(0, Math.abs(box.x - node.x) - box.width / 2), Math.max(0, Math.abs(box.y - node.y) - box.height / 2)) < radius;
    for (const edge of [...edges].sort((a, b) => labelWidth(labelFor(b)) - labelWidth(labelFor(a)) || compare(a, b))) {
      const a = positions.get(edge.from), b = positions.get(edge.to);
      if (!a || !b) continue;
      const dx = b.x - a.x, dy = b.y - a.y, length = Math.max(1, Math.hypot(dx, dy));
      const width = labelWidth(labelFor(edge));
      let best;
      const offsets = edge.from === edge.to ? [100, 140, 180] : [0, 36, -36, 72, -72, 112, -112, 160, -160, 220, -220];
      for (const offset of offsets) for (const fraction of [.5, .35, .65, .22, .78]) {
        const x = a.x + dx * fraction - (dy / length || (edge.from === edge.to ? 1 : 0)) * offset;
        const y = a.y + dy * fraction + (dx / length || (edge.from === edge.to ? 1 : 0)) * offset;
        const box = { x, y, width, height: 26 };
        const collision = nodePositions.filter(node => touchesNode(box, node)).length + placed.filter(other => overlaps(box, other)).length;
        const score = collision * 100000 + Math.abs(offset) + Math.abs(fraction - .5) * 120;
        if (!best || score < best.score) best = { ...box, score };
      }
      const toward = (point, target) => {
        const distance = Math.max(1, Math.hypot(target.x - point.x, target.y - point.y));
        return { x: point.x + (target.x - point.x) / distance * (NODE_RADIUS + 3), y: point.y + (target.y - point.y) / distance * (NODE_RADIUS + 3) };
      };
      // The quadratic midpoint is the label position, not its control point.
      const control = { x: 2 * best.x - (a.x + b.x) / 2, y: 2 * best.y - (a.y + b.y) / 2 };
      const start = toward(a, control), end = toward(b, control);
      const cx = 2 * best.x - (start.x + end.x) / 2, cy = 2 * best.y - (start.y + end.y) / 2;
      const path = edge.from === edge.to
        ? `M${a.x - 32},${a.y - 36} C${best.x - 80},${best.y - 75} ${best.x + 80},${best.y - 75} ${a.x + 32},${a.y - 36}`
        : `M${start.x},${start.y} Q${cx},${cy} ${end.x},${end.y}`;
      placed.push(best); routes.set(edge.id, { ...best, path });
    }
    return routes;
  }

  function mount(container, options) {
    if (!container || !options?.doc) throw new Error('Ontology graph requires a container and document');
    let current = { ...options }, destroyed = false, projected, shown;
    let routes = new Map(), routeKey = "";
    let layoutFocus = '';
    let selection = null, collapsed = true, focusId = '', lens = 'all', neighborhood = 1, scale = 1, pan = { x: 0, y: 0 }, drag = null;
    const saved = new Map(), text = (key, fallback, vars) => typeof current.text === 'function' ? current.text(key, fallback, vars) : fallback;
    const read = id => current.doc?.records?.[id];
    const button = (label, className, attrs, role = 'secondary') => root.uiButton({ label, role, className, attrs });
    function projection() {
      if (!current.prototype) return project(current.doc, current.moduleId || '', current.at || today());
      if (!current.moduleId) {
        const records = Object.values(current.doc?.records || {});
        const nodes = records.filter(record => record.kind === 'module').sort(compare).map(record => ({ id: record.id, record, label: record.name, kind: 'module' }));
        const ids = new Set(nodes.map(node => node.id));
        const edges = records.filter(record => record.kind === 'reference' && record.status === 'active' && ids.has(record.moduleId) && ids.has(record.targetModuleId)).map(record => ({ id: record.id, from: record.moduleId, to: record.targetModuleId, record, label: text('reference', '引用'), kind: 'reference' }));
        return { nodes, edges, literalFacts: new Map() };
      }
      const records = current.doc.records, local = Object.values(records).filter(record => record.moduleId === current.moduleId && record.status === 'active');
      const box = record => record.kind === 'definition' ? 'T' : record.kind === 'rule' ? 'R' : record.kind === 'reference' ? 'ref' : 'A';
      const nodes = local.filter(record => record.kind !== 'assertion' || validAt(record, current.at || today())).map(record => ({ id: record.id, record, kind: record.kind, box: box(record), label: record.name || records[record.definitionId]?.name || text('assertion', '事实') }));
      const ids = new Set(nodes.map(node => node.id)), edges = [], literalFacts = new Map();
      const connect = (record, target, label, kind) => { if (ids.has(target)) edges.push({ id: `${record.id}:${target}:${kind}`, from: record.id, to: target, record, label, kind, uncertain: record.kind === 'assertion' && (!record.validity?.from || (record.certainty && record.certainty !== 'confirmed')), unknownDate: record.kind === 'assertion' && !record.validity?.from }); };
      for (const record of local) {
        if (record.kind === 'entity') connect(record, record.typeId, text('type', '类型'), 'type');
        if (record.kind === 'definition') for (const target of [...(record.subjectTypes || []), ...(record.objectTypes || [])]) connect(record, target, text('definition', '定义'), 'definition');
        if (record.kind === 'assertion' && ids.has(record.id)) {
          connect(record, record.subjectId, text('graphSubjectEdge', '主体'), 'assertion');
          connect(record, record.definitionId, text('graphDefinitionEdge', '定义'), 'definition');
          if (record.object.kind === 'entity') connect(record, record.object.id, text('graphObjectEdge', '对象'), 'assertion');
          else literalFacts.set(record.subjectId, [...(literalFacts.get(record.subjectId) || []), record]);
        }
        if (record.kind === 'rule' && record.effect?.entityId) connect(record, record.effect.entityId, text('effect', '影响'), 'rule');
        if (record.kind === 'reference' && record.targetRecordId) connect(record, record.targetRecordId, text('reference', '引用'), 'reference');
      }
      return { nodes: nodes.sort(compare), edges, literalFacts };
    }
    const matchesLens = (node, value) => value === 'all' || node.box === value || (value === 'R' && node.kind === 'definition' && (node.record.cardinality || node.record.subjectTypes?.length || node.record.objectTypes?.length));
    function visibleSemantic(model) {
      if (!current.prototype || !current.moduleId) return visibleProjection(model, focusId);
      const eligible = model.nodes.filter(node => matchesLens(node, lens));
      if (!eligible.some(node => node.id === focusId)) focusId = eligible.find(node => node.id === read(current.moduleId)?.graphRootId)?.id || eligible.filter(node => node.kind === 'entity').sort((a, b) => model.edges.filter(edge => edge.from === b.id || edge.to === b.id).length - model.edges.filter(edge => edge.from === a.id || edge.to === a.id).length)[0]?.id || eligible[0]?.id || '';
      const preferred = read(current.moduleId)?.graphOverviewRecordIds || [];
      const rank = id => { const at = preferred.indexOf(id); return at < 0 ? 999 : at; };
      const neighbors = [...new Set(model.edges.flatMap(edge => edge.from === focusId ? [edge.to] : edge.to === focusId ? [edge.from] : []))]
        .filter(id => eligible.some(node => node.id === id))
        .sort((a, b) => rank(a) - rank(b) || (read(a)?.kind === 'assertion' ? 0 : 1) - (read(b)?.kind === 'assertion' ? 0 : 1) || a.localeCompare(b));
      const ids = new Set([focusId, ...neighbors.slice(0, neighborhood * 5)]);
      const nodes = eligible.filter(node => ids.has(node.id)).slice(0, 40), shownIds = new Set(nodes.map(node => node.id));
      return { nodes, edges: model.edges.filter(edge => shownIds.has(edge.from) && shownIds.has(edge.to)), hidden: eligible.length - nodes.length };
    }
    const nodeLabelMarkup = value => {
      const lines = []; let line = '', units = 0;
      const tokens = String(value || '').match(/[A-Za-z0-9_-]+|\s+|[^\s]/gu) || [];
      for (const token of tokens) {
        const parts = token.length > 12 ? token.match(/.{1,12}/gu) : [token];
        for (const part of parts) {
          const width = [...part].reduce((sum, character) => sum + (/[\u2e80-\uffff]/.test(character) ? 2 : 1), 0);
          if (units + width > 12 && line) { lines.push(line.trim()); line = ''; units = 0; }
          if (!line && !part.trim()) continue;
          line += part; units += width;
        }
      }
      if (line) lines.push(line);
      const shown = lines.slice(0, 3);
      if (lines.length > 3) shown[2] = shown[2].slice(0, -1) + '…';
      return shown.map((part, index) => `<tspan x="0" y="${(index - (shown.length - 1) / 2) * 16}">${escapeHtml(part)}</tspan>`).join('');
    };
    const relationLabel = edge => edge.labelKey ? text(edge.labelKey, edge.label) : edge.label;
    const edgeLabel = edge => `${short(relationLabel(edge))}${edge.unknownDate ? ` ${text('graphTimeUnknownShort', '时?')}` : ''}${edge.certainty === 'inferred' ? ` ${text('graphInferredShort', '推')}` : edge.certainty === 'unknown' ? ` ${text('graphCertaintyUnknownShort', '未?')}` : ''}`;
    function routeGeometry() {
      const key = shown.nodes.map(node => { const p = saved.get(node.id); return `${node.id}:${p.x},${p.y}`; }).join('|')
        + shown.edges.map(edge => `${edge.id}:${edge.from}:${edge.to}:${edgeLabel(edge)}`).join('|');
      if (key !== routeKey) { routes = edgeRoutes(shown.nodes, shown.edges, saved, edgeLabel); routeKey = key; }
    }

    function paint() {
      const world = container.querySelector('.cog-og-world');
      if (!world) return;
      world.setAttribute('transform', `translate(${pan.x} ${pan.y}) scale(${scale})`);
      const nodeElements = new Map([...container.querySelectorAll('[data-og-node]')].map(element => [element.dataset.ogNode, element]));
      const edgeElements = new Map([...container.querySelectorAll('[data-og-edge]')].map(element => [element.dataset.ogEdge, element]));
      for (const node of shown.nodes) {
        const element = nodeElements.get(node.id);
        const position = saved.get(node.id);
        if (element && position) element.setAttribute('transform', `translate(${position.x} ${position.y})`);
        element?.classList.toggle('is-selected', selection?.kind === 'node' && selection.id === node.id);
      }
      routeGeometry();
      for (const edge of shown.edges) {
        const element = edgeElements.get(edge.id);
        const geometry = routes.get(edge.id);
        if (!element || !geometry) continue;
        element.querySelector('path')?.setAttribute('d', geometry.path);
        const rectangle = element.querySelector('.cog-og-edge-label rect');
        rectangle?.setAttribute('x', String(-geometry.width / 2));
        rectangle?.setAttribute('width', String(geometry.width));
        element.querySelector('.cog-og-edge-label')?.setAttribute('transform', `translate(${geometry.x} ${geometry.y})`);
        element.classList.toggle('is-selected', selection?.kind === 'edge' && selection.id === edge.id);
      }
      const zoom = container.querySelector('[data-og-zoom-value]');
      if (zoom) zoom.textContent = `${Math.round(scale * 100)}%`;
    }
    function fit() {
      const svg = container.querySelector('.cog-og-canvas');
      if (!svg || !shown.nodes.length) return;
      const bounds = svg.getBoundingClientRect();
      routeGeometry();
      const values = [...shown.nodes.flatMap(node => { const p = saved.get(node.id); return [{ x: p.x - NODE_RADIUS, y: p.y - NODE_RADIUS }, { x: p.x + NODE_RADIUS, y: p.y + NODE_RADIUS }]; }), ...[...routes.values()].flatMap(box => [{ x: box.x - box.width / 2, y: box.y - box.height / 2 }, { x: box.x + box.width / 2, y: box.y + box.height / 2 }])];
      const left = Math.min(...values.map(p => p.x)) - 24, right = Math.max(...values.map(p => p.x)) + 24;
      const top = Math.min(...values.map(p => p.y)) - 24, bottom = Math.max(...values.map(p => p.y)) + 24;
      scale = Math.min(1, Math.max(.08, Math.min((bounds.width - 60) / (right - left), (bounds.height - 60) / (bottom - top))));
      pan = { x: bounds.width / 2 - (left + right) / 2 * scale, y: bounds.height / 2 - (top + bottom) / 2 * scale };
      svg.setAttribute('viewBox', `0 0 ${Math.max(1, bounds.width)} ${Math.max(1, bounds.height)}`);
      paint();
    }
    function source(record) {
      const details = [record?.source?.label || text('unknown', '来源未注明')];
      if (record?.source?.kind === 'legacy') details.push(text('legacy', '旧来源 · 只读'));
      else if (record?.status !== 'active') details.push(text('readOnly', '历史记录 · 只读'));
      return details.join(' · ');
    }
    function inspector() {
      const panel = container.querySelector('.cog-og-inspector');
      if (!panel) return;
      if (!selection) {
        panel.innerHTML = `<p class="cog-og-muted">${escapeHtml(text('graphSelectHint', '选择对象或关系查看详情。'))}</p>`;
        return;
      }
      const item = selection.kind === 'node' ? shown.nodes.find(node => node.id === selection.id) : shown.edges.find(edge => edge.id === selection.id);
      if (!item) { selection = null; inspector(); return; }
      const record = item.record, name = selection.kind === 'edge' ? relationLabel(item) : item.label;
      const canEdit = editableRecord(current.doc?.records, record);
      const field = (key, value, tag = 'p') => canEdit
        ? `<${tag} contenteditable="true" role="textbox" aria-label="${escapeHtml(text(key, key))}" data-ontology-edit="${key}" data-record-id="${escapeHtml(record.id)}">${escapeHtml(value || '')}</${tag}>`
        : `<${tag}>${escapeHtml(value || '')}</${tag}>`;
      let body = '';
      if (selection.kind === 'node' && record.kind === 'entity') {
        const type = read(record.typeId);
        const facts = shown.edges.filter(edge => edge.kind === 'assertion' && (edge.from === record.id || edge.to === record.id));
        const literals = projected.literalFacts.get(record.id) || [];
        body = `${field('description', record.description)}<p class="cog-og-muted">${escapeHtml(text('type', '类型'))}：${escapeHtml(type?.name || text('unknown', '未知'))}</p>`
          + (literals.length ? `<h4>${escapeHtml(text('attributes', '属性'))}</h4>${literals.map(fact => button(`${read(fact.definitionId)?.name || '属性'}：${fact.object.value}`, 'cog-og-detail-link', { 'data-og-related': fact.id, 'data-og-related-kind': 'assertion' }, 'ghost')).join('')}` : '')
          + (facts.length ? `<h4>${escapeHtml(text('relatedFacts', '相关事实'))}</h4>${facts.map(edge => button(`${read(edge.from)?.name || ''} → ${relationLabel(edge)} → ${read(edge.to)?.name || ''}`, 'cog-og-detail-link', { 'data-og-related': edge.id, 'data-og-related-kind': 'edge' }, 'ghost')).join('')}` : '');
      } else if (record.kind === 'assertion') {
        const validity = record.validity || {};
        body = `<p>${escapeHtml(read(record.subjectId)?.name || '')} → ${escapeHtml(read(record.definitionId)?.name || '')} → ${escapeHtml(record.object.kind === 'entity' ? read(record.object.id)?.name || '' : record.object.value)}</p>`
          + `<p class="cog-og-muted">${escapeHtml(text('validity', '有效时间'))}：${escapeHtml(validity.from || text('unknownDate', '开始时间未确认'))} → ${escapeHtml(validity.until || text('ongoing', '持续有效'))}</p>`
          + (record.certainty && record.certainty !== 'confirmed' ? `<p class="cog-og-muted">${escapeHtml(text('certainty', '确定性'))}：${escapeHtml(text(record.certainty, record.certainty))}</p>` : '');
      } else if (record.kind === 'rule') {
        body = `${field('requirement', record.requirement)}<p class="cog-og-muted">${escapeHtml(text('strength', '强度'))}：${escapeHtml(text(record.strength, record.strength))}</p>`;
      } else if (record.kind === 'reference') {
        body = `<p>${escapeHtml(read(record.moduleId)?.name || '')} → ${escapeHtml(read(record.targetModuleId)?.name || '')}</p>`;
      } else body = record.description == null ? '' : field('description', record.description);
      const title = record.name == null ? `<h3>${escapeHtml(name)}</h3>` : field('name', record.name, 'h3');
      panel.innerHTML = `<div class="cog-og-inspector-kind">${escapeHtml(text(record.kind, record.kind))}</div>${title}${body}<h4>${escapeHtml(text('source', '来源'))}</h4><p class="cog-og-muted">${escapeHtml(source(record))}</p>${current.prototype ? button(text('expandConnections', '展开邻近联系'), 'cog-og-open', { 'data-og-focus': record.id }) : ''}${button(text('openDetails', '查看详情'), 'cog-og-open', { 'data-og-open': record.id, 'data-og-open-kind': record.kind })}`;
    }
    function render(preserveCamera = false) {
      projected = projection();
      shown = visibleSemantic(projected);
      if (current.prototype && layoutFocus !== focusId) { saved.clear(); layoutFocus = focusId; }
      const positions = positionsFor(shown.nodes, shown.edges, saved);
      if (current.prototype && current.moduleId && !saved.has(focusId)) {
        positions.set(focusId, { x: 450, y: 280 });
        const neighbors = shown.nodes.filter(node => node.id !== focusId);
        neighbors.forEach((node, index) => { const angle = -Math.PI / 2 + index * 2 * Math.PI / neighbors.length; positions.set(node.id, { x: 450 + 260 * Math.cos(angle), y: 280 + 185 * Math.sin(angle) }); });
      }
      for (const [id, position] of positions) saved.set(id, position);
      if (selection && !shown.nodes.some(node => selection.kind === 'node' && node.id === selection.id)
        && !shown.edges.some(edge => selection.kind === 'edge' && edge.id === selection.id)) selection = null;
      const count = `${shown.nodes.length}/${projected.nodes.length} ${text('nodes', '个节点')} · ${shown.edges.length}/${projected.edges.length} ${text('edges', '条关系')}`;
      container.innerHTML = `<div class="cog-og"><div class="cog-og-toolbar"><span>${current.prototype ? `<strong>${escapeHtml(text(current.moduleId ? 'internalGraphTitle' : 'modulesGraphTitle', current.moduleId ? '本体内部图' : '本体间引用'))}</strong> <small>${escapeHtml(shown.nodes.find(node => node.id === focusId)?.label || count)} · ${escapeHtml(text('graphOverviewShort', '简图'))}</small>` : escapeHtml(count)}</span><div class="cog-og-toolbar-actions">${current.prototype && current.moduleId ? button(text('graphReturnOverview', '返回概览'), 'cog-og-control', { 'data-og-control': 'overview' }, 'ghost') : ''}${button('−', 'cog-og-control', { 'data-og-control': 'out', 'aria-label': text('zoomOut', '缩小') }, 'ghost')}<span data-og-zoom-value></span>${button('+', 'cog-og-control', { 'data-og-control': 'in', 'aria-label': text('zoomIn', '放大') }, 'ghost')}${button(text(current.prototype ? 'graphResetView' : 'zoomReset', current.prototype ? '重置视图' : '适应画面'), 'cog-og-control', { 'data-og-control': 'fit' }, 'ghost')}${current.prototype ? '' : button(collapsed ? text('showDetails', '展开详情') : text('hideDetails', '收起详情'), 'cog-og-control', { 'data-og-control': 'details', 'aria-expanded': String(!collapsed) }, 'ghost')}</div></div>`
        + (!current.prototype && shown.hidden ? `<div class="cog-og-limit" role="status">${escapeHtml(text('graphLimited', '图谱共 {total} 个节点，当前显示 {shown} 个；其余内容请在本体列表中查找。', { total: projected.nodes.length, shown: shown.nodes.length }))}</div>` : '')
        + (current.prototype && current.moduleId ? `<div class="ont-graph-navigator"><div class="ont-graph-lenses" aria-label="${escapeHtml(text('graphContents', '选择本体内容'))}">${[['all', text('all', '全部')], ['T', 'T · ' + text('concepts', '概念')], ['R', 'R · ' + text('graphRulesLegend', '规则 / 约束')], ['A', 'A · ' + text('graphObjectsLegend', '对象 / 断言')]].map(([value, label]) => `<button data-og-lens="${value}" aria-pressed="${lens === value}">${escapeHtml(label)} ${value === 'all' ? '' : `<small>${projected.nodes.filter(node => matchesLens(node, value)).length}</small>`}</button>`).join('')}</div><label>${escapeHtml(text('focus', '聚焦'))}<select data-og-center aria-label="${escapeHtml(text('chooseGraphFocus', '选择要聚焦的记录'))}">${projected.nodes.filter(node => matchesLens(node, lens)).map(node => `<option value="${escapeHtml(node.id)}" ${node.id === focusId ? 'selected' : ''}>${escapeHtml(node.label)}</option>`).join('')}</select></label></div>` : '')
        + `<div class="cog-og-body${collapsed ? ' is-collapsed' : ''}"><svg class="cog-og-canvas" role="group" aria-label="${escapeHtml(text('moduleGraph', '本体关系图谱'))}" viewBox="0 0 900 560"><defs><marker id="cog-og-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0 0 L8 4 L0 8 Z"/></marker></defs><g class="cog-og-world">${shown.edges.map(edge => `<g class="cog-og-edge cog-og-edge--${escapeHtml(edge.kind)}${edge.uncertain ? ' is-uncertain' : ''}" data-og-edge="${escapeHtml(edge.id)}" tabindex="0" role="button" aria-label="${escapeHtml(edgeLabel(edge))}"><path marker-end="url(#cog-og-arrow)"/><g class="cog-og-edge-label"><rect x="-55" y="-13" width="110" height="26" rx="5"/><text text-anchor="middle" dominant-baseline="middle">${escapeHtml(edgeLabel(edge))}</text></g></g>`).join('')}${shown.nodes.map(node => `<g class="cog-og-node cog-og-node--${escapeHtml(node.kind)}${node.referenced ? ' is-referenced' : ''}${current.prototype && node.id === focusId ? ' is-focus' : ''}" data-og-node="${escapeHtml(node.id)}" tabindex="0" role="button" aria-label="${escapeHtml(node.label)}"><circle r="48"/><text text-anchor="middle" dominant-baseline="middle">${nodeLabelMarkup(node.label)}</text>${current.prototype ? `<text class="ont-graph-node-kind" y="65" text-anchor="middle">${escapeHtml(node.box + ' · ' + text(node.kind === 'assertion' ? 'graphAssertionKind' : node.kind === 'entity' ? 'graphEntityKind' : node.kind, node.kind))}</text>` : ''}</g>`).join('')}</g></svg><aside class="cog-og-inspector" aria-label="${escapeHtml(text('graphDetails', '所选内容'))}"></aside></div>${!shown.nodes.length ? `<p class="cog-og-empty">${escapeHtml(text('graphEmpty', '还没有可展示的关系。'))}</p>` : ''}</div>`;
      inspector();
      if (preserveCamera) requestAnimationFrame(paint);
      else requestAnimationFrame(fit);
    }
    function select(kind, id) {
      selection = { kind, id }; collapsed = false;
      container.querySelector('.cog-og-body')?.classList.remove('is-collapsed');
      const details = container.querySelector('[data-og-control="details"]');
      if (details) { details.textContent = text('hideDetails', '收起详情'); details.setAttribute('aria-expanded', 'true'); }
      inspector(); fit();
      const item = kind === 'node' ? shown.nodes.find(node => node.id === id) : shown.edges.find(edge => edge.id === id);
      if (item?.record) current.onSelect?.({ recordId: item.record.id, kind: item.record.kind });
    }
    function pointer(event) {
      const svg = container.querySelector('.cog-og-canvas'), bounds = svg.getBoundingClientRect();
      return { x: (event.clientX - bounds.left) * svg.viewBox.baseVal.width / Math.max(1, bounds.width),
        y: (event.clientY - bounds.top) * svg.viewBox.baseVal.height / Math.max(1, bounds.height) };
    }
    function onPointerDown(event) {
      if (event.button !== 0 || !event.target.closest('.cog-og-canvas')) return;
      const node = event.target.closest('[data-og-node]');
      if (event.target.closest('[data-og-edge]') && !node) return;
      drag = { id: node?.dataset.ogNode || '', start: pointer(event), origin: node ? { ...saved.get(node.dataset.ogNode) } : { ...pan }, moved: false, pointerId: event.pointerId };
      container.querySelector('.cog-og-canvas').setPointerCapture(event.pointerId);
    }
    function onPointerMove(event) {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const now = pointer(event), dx = now.x - drag.start.x, dy = now.y - drag.start.y;
      if (Math.hypot(dx, dy) > 3) drag.moved = true;
      if (!drag.moved) return;
      if (drag.id) saved.set(drag.id, { x: drag.origin.x + dx / scale, y: drag.origin.y + dy / scale });
      else pan = { x: drag.origin.x + dx, y: drag.origin.y + dy };
      paint();
    }
    function onPointerUp(event) {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const was = drag; drag = null;
      if (was.id && !was.moved) select('node', was.id);
    }
    function onClick(event) {
      const lensButton = event.target.closest('[data-og-lens]');
      if (lensButton) { lens = lensButton.dataset.ogLens; focusId = ''; neighborhood = 1; selection = null; render(); return; }
      const focus = event.target.closest('[data-og-focus]');
      if (focus) { if (focusId === focus.dataset.ogFocus) neighborhood = Math.min(4, neighborhood + 1); else { focusId = focus.dataset.ogFocus; neighborhood = 1; } render(); return; }
      const control = event.target.closest('[data-og-control]');
      if (control) {
        const action = control.dataset.ogControl;
        if (action === 'overview') { focusId = ''; neighborhood = 1; saved.clear(); selection = null; collapsed = true; render(); fit(); return; }
        if (action === 'details') { collapsed = !collapsed; render(); }
        else if (action === 'fit') fit();
        else { scale = Math.max(.16, Math.min(3, scale * (action === 'in' ? 1.2 : 1 / 1.2))); paint(); }
        return;
      }
      const open = event.target.closest('[data-og-open]');
      if (open) { current.onSelect?.({ recordId: open.dataset.ogOpen, kind: open.dataset.ogOpenKind, open: true }); return; }
      const related = event.target.closest('[data-og-related]');
      if (related) {
        if (related.dataset.ogRelatedKind === 'edge') select('edge', related.dataset.ogRelated);
        else current.onSelect?.({ recordId: related.dataset.ogRelated, kind: 'assertion' });
        return;
      }
      const edge = event.target.closest('[data-og-edge]');
      if (edge) select('edge', edge.dataset.ogEdge);
    }
    function onKeyDown(event) {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const item = event.target.closest('[data-og-node],[data-og-edge]');
      if (!item) return;
      event.preventDefault();
      select(item.dataset.ogNode ? 'node' : 'edge', item.dataset.ogNode || item.dataset.ogEdge);
    }
    function onWheel(event) {
      if (!event.target.closest('.cog-og-canvas')) return;
      event.preventDefault();
      const point = pointer(event), next = Math.max(.16, Math.min(3, scale * (event.deltaY < 0 ? 1.1 : 1 / 1.1)));
      pan = { x: point.x - (point.x - pan.x) * next / scale, y: point.y - (point.y - pan.y) * next / scale };
      scale = next; paint();
    }
    function onCenterChange(event) { if (!event.target.matches('[data-og-center]')) return; focusId = event.target.value; neighborhood = 1; selection = null; render(); }
    container.addEventListener('change', onCenterChange);
    container.addEventListener('click', onClick);
    container.addEventListener('keydown', onKeyDown);
    container.addEventListener('pointerdown', onPointerDown);
    container.addEventListener('pointermove', onPointerMove);
    container.addEventListener('pointerup', onPointerUp);
    container.addEventListener('pointercancel', onPointerUp);
    container.addEventListener('wheel', onWheel, { passive: false });
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(fit) : null;
    observer?.observe(container);
    const controller = {
      update(next) {
        if (destroyed) return;
        const nextModule = next.moduleId === undefined ? current.moduleId : next.moduleId;
        const changedModule = nextModule !== current.moduleId;
        if (changedModule) { saved.clear(); selection = null; focusId = ''; }
        const priorNodeIds = shown.nodes.map(node => node.id).join('\u0000');
        const priorEdgeIds = shown.edges.map(edge => edge.id).join('\u0000');
        current = { ...current, ...next };
        const nextProjection = projection();
        const nextShown = visibleSemantic(nextProjection);
        const sameStructure = !changedModule && priorNodeIds === nextShown.nodes.map(node => node.id).join('\u0000')
          && priorEdgeIds === nextShown.edges.map(edge => edge.id).join('\u0000');
        if (!sameStructure) { render(!changedModule); return; }
        projected = nextProjection; shown = nextShown;
        for (const node of shown.nodes) {
          const element = [...container.querySelectorAll('[data-og-node]')].find(item => item.dataset.ogNode === node.id);
          if (!element) continue;
          const label = element.querySelector('text');
          if (label) label.innerHTML = nodeLabelMarkup(node.label);
          element.setAttribute('aria-label', node.label);
        }
        for (const edge of shown.edges) {
          const element = [...container.querySelectorAll('[data-og-edge]')].find(item => item.dataset.ogEdge === edge.id);
          if (!element) continue;
          const label = element.querySelector('text');
          if (label) label.textContent = edgeLabel(edge);
          element.setAttribute('aria-label', edgeLabel(edge));
          element.classList.toggle('is-uncertain', Boolean(edge.uncertain));
        }
        if (!container.querySelector('[data-ontology-edit]:focus')) inspector();
        paint();
      },
      destroy() {
        if (destroyed) return;
        destroyed = true; observer?.disconnect();
        container.removeEventListener('change', onCenterChange);
        container.removeEventListener('click', onClick);
        container.removeEventListener('keydown', onKeyDown);
        container.removeEventListener('pointerdown', onPointerDown);
        container.removeEventListener('pointermove', onPointerMove);
        container.removeEventListener('pointerup', onPointerUp);
        container.removeEventListener('pointercancel', onPointerUp);
        container.removeEventListener('wheel', onWheel);
        container.replaceChildren();
      },
    };
    render();
    return controller;
  }

  let active = null;
  root.CogOntologyGraph = {
    mount(container, options) { active?.destroy(); active = mount(container, options); return active; },
    update(options) { active?.update(options); },
    destroy() { active?.destroy(); active = null; },
    _project: project, _visibleProjection: visibleProjection, _positionsFor: positionsFor, _edgeRoutes: edgeRoutes, _editableRecord: editableRecord, _today: today,
  };
})(window);
