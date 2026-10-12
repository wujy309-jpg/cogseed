import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { resolve } from 'node:path';

function render(records: Record<string, any>, drafts: Record<string, any> = {}) {
  const window: Record<string, any> = {};
  for (const moduleName of ['ui-button.js', 'ui-form.js']) {
    runInNewContext(readFileSync(resolve('src/renderer/modules', moduleName), 'utf8'), { window });
  }
  runInNewContext(readFileSync(resolve('src/renderer/modules/cognition-ontology-document.js'), 'utf8'), { window });
  return window.CogOntologyDocument.render({
    doc: { records }, moduleId: 'module', drafts,
    text: (_key: string, fallback: string) => fallback,
    esc: (value: string) => value.replace(/[&<>"']/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[character]!),
  });
}

const source = { kind: 'candidate', label: '会议摘录', recordId: 'candidate-1', refs: [{ kind: 'asset', id: 'asset-1' }] };
const base = { status: 'active', access: 'task', source, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' };
function fixture() {
  return {
    module: { ...base, id: 'module', kind: 'module', name: '项目本体', description: '模块说明', scope: { kind: 'project', id: 'project-1' } },
    type: { ...base, id: 'type', kind: 'definition', moduleId: 'module', name: '人员', description: '身份类型', definitionKind: 'type' },
    relation: { ...base, id: 'relation', kind: 'definition', moduleId: 'module', name: '协作', description: '协作关系', definitionKind: 'relation', subjectTypes: ['type'], objectTypes: ['type'], valueType: 'entity', cardinality: 'many', cardinalityAnchor: 'subject' },
    a: { ...base, id: 'a', kind: 'entity', moduleId: 'module', name: '甲', typeId: 'type', description: '对象说明', aliases: ['甲方'], identityStatus: 'confirmed' },
    b: { ...base, id: 'b', kind: 'entity', moduleId: 'module', name: '乙', typeId: 'type', description: '', aliases: [], identityStatus: 'confirmed' },
    fact: { ...base, id: 'fact', kind: 'assertion', moduleId: 'module', subjectId: 'a', definitionId: 'relation', object: { kind: 'entity', id: 'b' }, validity: { from: '2026-01-01', until: null, precision: 'day', timezone: 'Asia/Shanghai' } },
    rule: { ...base, id: 'rule', kind: 'rule', moduleId: 'module', name: '审批规则', requirement: '需要审批', condition: null, effect: { kind: 'note' }, strength: 'required', exception: '紧急情况' },
  } as Record<string, any>;
}

describe('ontology document projection', () => {
  it('renders TBox, RBox and ABox, escapes prose and groups identical provenance once', () => {
    const records = fixture();
    records.a.description = '<script>alert(1)</script>';
    const html = render(records);
    expect(html).toContain('id="ontology-doc-tbox"');
    expect(html).toContain('id="ontology-doc-rbox"');
    expect(html).toContain('id="ontology-doc-abox"');
    expect(html).toContain('人员');
    expect(html).toContain('审批规则');
    expect(html).toContain('甲');
    expect(html).toContain('乙');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>');
    expect(html.match(/<li id="ontology-doc-source-/g)).toHaveLength(1);
    expect(html.match(/href="#ontology-doc-source-1"/g)).toHaveLength(Object.keys(records).length);
  });

  it('shows numeric, boolean and corrected facts while protecting historical and legacy fields', () => {
    const records = fixture();
    records.number = { ...records.fact, id: 'number', object: { kind: 'literal', valueType: 'number', value: 21 }, status: 'corrected' };
    records.boolean = { ...records.fact, id: 'boolean', object: { kind: 'literal', valueType: 'boolean', value: false } };
    records.legacy = { ...records.a, id: 'legacy', name: '旧对象', source: { kind: 'legacy', label: '旧资料' } };
    const html = render(records);
    expect(html).toContain('data-record-id="number"');
    expect(html).toContain('>21</span>');
    expect(html).toContain('data-edit-type="boolean"');
    expect(html).toContain('>否</span>');
    expect(html).toContain('已纠正');
    expect(html).toContain('旧内容只读');
    expect(html).not.toMatch(/data-ontology-edit="object.value" data-record-id="number"/);
    expect(html).not.toMatch(/data-ontology-edit="name" data-record-id="legacy"/);
    expect(html).not.toMatch(/data-ontology-action="change-fact" data-record-id="number"/);
  });

  it('keeps an unsaved draft visible for the same record without changing other fields', () => {
    const html = render(fixture(), { a: { changes: { name: '新名字', description: '新说明' } } });
    expect(html).toContain('>新名字</span>');
    expect(html).toContain('>新说明</span>');
    expect(html).toContain('>乙</span>');
  });

  it('uses the visible column count for detail rows and keeps an object detail slot ready', () => {
    const html = render(fixture());
    expect(html).toMatch(/data-ontology-panel="type" hidden><td colspan="4">/);
    expect(html).toMatch(/data-ontology-panel="relation" hidden><td colspan="5">/);
    expect(html).toMatch(/data-ontology-panel="rule" hidden><td colspan="4">/);
    expect(html).toMatch(/class="ont-object-record-extra"[^>]*data-ontology-panel="a" hidden/);
  });
});
