import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/**
 * P-r1-107 回归：loadOntologyFacts 的 factKey 覆盖 (组, 字段, 归一值) 三元组，
 * 同字段下两条空白变体值（"常住北京" vs " 常住 北京 "）归一后生成**相同 id**
 * 的事实——此前收集循环不查重，重复计入 top-24 挤占预算、下游按 id 消费见
 * 假重复。修复：读侧按 id 去重（写侧归一管不了存量盘上的空白变体）。
 */
vi.mock('../../../../src/main/features/kb_indexer', () => ({
  enqueue: () => {},
  kbEvents: { on: () => {}, off: () => {}, emit: () => {} },
}));
vi.mock('../../../../src/main/features/search', () => ({
  upsertContext: () => {},
  dropContext: () => {},
}));

let tmpDir: string;
let prevWs: string | undefined;
const UID = 'u-fact-dedup';

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cogseed-fact-dedup-'));
  prevWs = process.env.COGSEED_WORKSPACE_ROOT;
  process.env.COGSEED_WORKSPACE_ROOT = tmpDir;
  vi.resetModules();
});
afterEach(() => {
  if (prevWs === undefined) delete process.env.COGSEED_WORKSPACE_ROOT;
  else process.env.COGSEED_WORKSPACE_ROOT = prevWs;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('P-r1-107 事实收集读侧按 id 去重', () => {
  it('同字段空白变体值只产出一条事实，不同值互不挤占', async () => {
    const groups = await import('../../../../src/main/features/personal_ontology_groups');
    const pk = await import('../../../../src/main/features/recall/projection-knowledge');
    const created = await groups.createGroup(UID, '去重组');
    const gid = created.group!.group_id;
    // 写侧 sanitizePoText 只 trim 首尾、不折叠连续空格，且查重是 text 精确
    // 比较——中间差一个空格的两条都落盘；读侧 \s+→' ' 折叠后归一值相同，
    // factKey/ id 因此相同。这正是 P-r1-107 的重复机制。
    await groups.appendFieldValue(UID, gid, '居住地', '常住 北京', '手动');
    await groups.appendFieldValue(UID, gid, '居住地', '常住  北京', '手动');
    await groups.appendFieldValue(UID, gid, '居住地', '常住上海', '手动');

    const facts = await pk.loadOntologyFacts(UID, {});
    // 归一后同值的两条 entry 只剩一条事实。
    const beijing = facts.filter((fact) => fact.value === '常住 北京');
    expect(beijing).toHaveLength(1);
    // 事实 id 全局唯一（这是下游按 id 消费的前提）。
    const ids = facts.map((fact) => fact.id);
    expect(new Set(ids).size).toBe(ids.length);
    // 不同值不受影响。
    expect(facts.some((fact) => fact.value === '常住上海')).toBe(true);
  });
});
