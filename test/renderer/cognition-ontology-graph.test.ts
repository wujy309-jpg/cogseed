import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { resolve } from 'node:path';

function graphApi(): any {
  const window: Record<string, unknown> = {};
  const source = readFileSync(resolve('src/renderer/modules/cognition-ontology-graph.js'), 'utf8');
  runInNewContext(source, { window, Intl, Date, Math, String, Map, Set });
  return window.CogOntologyGraph;
}
const moduleRecord = (id: string) => ({ id, kind: 'module', status: 'active', name: id, source: { kind: 'user', label: 'user' } });
const entity = (id: string, moduleId = 'm') => ({ id, kind: 'entity', moduleId, status: 'active', name: id, source: { kind: 'user', label: 'user' } });

describe('ontology relationship projection', () => {
  it('draws entity facts and explicit references while keeping literal values in details', () => {
    const records: Record<string, any> = {
      m: moduleRecord('m'), other: moduleRecord('other'), a: entity('a'), b: entity('b'),
      relation: { id: 'relation', kind: 'definition', status: 'active', moduleId: 'm', name: '协作' },
      ref: { id: 'ref', kind: 'reference', status: 'active', moduleId: 'm', targetModuleId: 'other' },
      edge: { id: 'edge', kind: 'assertion', status: 'active', moduleId: 'm', subjectId: 'a', definitionId: 'relation', object: { kind: 'entity', id: 'b' }, validity: { from: null, until: null, precision: 'day' } },
      literal: { id: 'literal', kind: 'assertion', status: 'active', moduleId: 'm', subjectId: 'a', definitionId: 'relation', object: { kind: 'literal', value: 'long text' }, validity: { from: null, until: null, precision: 'day' } },
    };
    const api = graphApi();
    const local = api._project({ records }, 'm', '2026-10-10');
    expect(local.nodes.map((node: any) => node.id)).toEqual(['a', 'b']);
    expect(local.edges.map((edge: any) => edge.id)).toEqual(['edge']);
    expect(local.edges[0].unknownDate).toBe(true);
    expect(local.edges[0].certainty).toBe('confirmed');
    expect(local.edges[0].uncertain).toBe(false);
    expect(local.edges[0].labelKey).toBe('');
    expect(local.literalFacts.get('a')[0].object.value).toBe('long text');
    const references = api._project({ records }, '', '2026-10-10').edges;
    expect(references.map((edge: any) => edge.id)).toEqual(['ref']);
    expect(references[0].labelKey).toBe('graphModuleReference');
  });

  it('omits expired facts and bounds a large graph with honest counts', () => {
    const records: Record<string, any> = { m: moduleRecord('m') };
    for (let index = 0; index < 520; index++) records[`e${index}`] = entity(`e${index}`);
    records.expired = { id: 'expired', kind: 'assertion', moduleId: 'm', status: 'active', subjectId: 'e0', definitionId: 'x', object: { kind: 'entity', id: 'e1' }, validity: { from: '2020-01-01', until: '2020-02-01', precision: 'day' } };
    const api = graphApi(), projected = api._project({ records }, 'm', '2026-10-10');
    expect(projected.edges).toHaveLength(0);
    const visible = api._visibleProjection(projected, '', 110);
    expect(visible.nodes).toHaveLength(110);
    expect(visible.hidden).toBe(410);
  });

  it('spreads sixty disconnected nodes and preserves moved positions', () => {
    const api = graphApi();
    const nodes = Array.from({ length: 60 }, (_, index) => ({ id: `n${index}` }));
    const positions = api._positionsFor(nodes, [], new Map());
    let closest = Infinity;
    for (let a = 0; a < nodes.length; a++) for (let b = a + 1; b < nodes.length; b++) {
      const first = positions.get(nodes[a].id), second = positions.get(nodes[b].id);
      closest = Math.min(closest, Math.hypot(first.x - second.x, first.y - second.y));
    }
    expect(closest).toBeGreaterThan(80);
    const moved = new Map([['n0', { x: 777, y: 333 }]]);
    expect(api._positionsFor(nodes, [], moved).get('n0')).toEqual({ x: 777, y: 333 });
  });

  it('keeps product-system nodes and relation labels apart, including reciprocal and parallel edges', () => {
    const api = graphApi();
    const ids = ['app', 'renderer', 'preload', 'main', 'core', 'runtime', 'local', 'mcp', 'storage', 'cloud', 'localdata', 'knowledge', 'continuity', 'cognition'];
    const nodes = [...ids, 'rule-1', 'rule-2', 'rule-3', 'rule-4'].map(id => ({ id }));
    const pairs = [
      ...['renderer', 'preload', 'main', 'core', 'runtime', 'local', 'mcp', 'storage'].map(id => ['app', id, '包含组件']),
      ...['knowledge', 'continuity', 'cognition'].map(id => ['app', id, '提供能力']),
      ['renderer', 'preload', '通过边界调用'], ['preload', 'main', '通过边界调用'],
      ...['core', 'runtime', 'local', 'mcp', 'storage'].map(id => ['main', id, '通过边界调用']),
      ['storage', 'cloud', '管理数据域'], ['storage', 'localdata', '管理数据域'],
      ['main', 'preload', '返回结果'], ['app', 'main', '管理生命周期'],
    ];
    const edges = pairs.map(([from, to, label], index) => ({ id: `edge-${index}`, from, to, label }));
    const positions = api._positionsFor(nodes, edges, new Map());
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
      const a = positions.get(nodes[i].id), b = positions.get(nodes[j].id);
      expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(140);
    }
    const checkLabels = () => {
      const routes = api._edgeRoutes(nodes, edges, positions, (edge: any) => edge.label);
      const boxes: any[] = [...routes.values()];
      expect(boxes).toHaveLength(edges.length);
      for (const box of boxes) for (const node of positions.values()) {
        const dx = Math.max(0, Math.abs(box.x - node.x) - box.width / 2);
        const dy = Math.max(0, Math.abs(box.y - node.y) - box.height / 2);
        expect(Math.hypot(dx, dy)).toBeGreaterThanOrEqual(48);
      }
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j];
        expect(Math.abs(a.x - b.x) >= (a.width + b.width) / 2 || Math.abs(a.y - b.y) >= (a.height + b.height) / 2).toBe(true);
      }
    };
    checkLabels();
    const moved = positions.get('renderer');
    positions.set('renderer', { x: moved.x + 35, y: moved.y + 20 });
    checkLabels();
  });

  it('distinguishes uncertain assertions from unknown start dates', () => {
    const records: Record<string, any> = { m: moduleRecord('m'), a: entity('a'), b: entity('b') };
    records.unknown = { id: 'unknown', kind: 'assertion', status: 'active', moduleId: 'm', subjectId: 'a', definitionId: 'p', object: { kind: 'entity', id: 'b' }, certainty: 'unknown', validity: { from: '2026-01-01', until: null, precision: 'day' } };
    const edge = graphApi()._project({ records }, 'm', '2026-10-10').edges[0];
    expect(edge.unknownDate).toBe(false);
    expect(edge.certainty).toBe('unknown');
    expect(edge.uncertain).toBe(true);
  });

  it('allows edits only for active canonical records in active canonical modules', () => {
    const api = graphApi();
    const records: Record<string, any> = { m: moduleRecord('m'), e: entity('e') };
    expect(api._editableRecord(records, records.e)).toBe(true);
    records.m.source.kind = 'legacy';
    expect(api._editableRecord(records, records.e)).toBe(false);
    records.m.source.kind = 'user'; records.m.status = 'paused';
    expect(api._editableRecord(records, records.e)).toBe(false);
    records.m.status = 'active'; records.e.status = 'paused';
    expect(api._editableRecord(records, records.e)).toBe(false);
    records.e.status = 'active'; records.e.source.kind = 'legacy';
    expect(api._editableRecord(records, records.e)).toBe(false);
    records.m.source.kind = 'legacy';
    expect(api._editableRecord(records, records.m)).toBe(false);
  });

  it('uses the local calendar day for the default query date', () => {
    const date = new Date();
    const expected = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    expect(graphApi()._today()).toBe(expected);
  });
});
