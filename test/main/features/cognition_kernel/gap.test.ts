/**
 * 缺口引擎与回填测试（S2 行为断言 + 2026-10-02 回归轮改写为统一库落地）。
 *
 * 行为断言（不变）：答一次永久记住（同任务包再体检该字段不再是缺口）、
 * 重复回答幂等、空白拒绝、delta origin=gap/status=applied。
 * 实现耦合断言（D5 重写）：落地位置从 po 组/字段/值改为统一库断言+版本流。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

vi.mock('../../../../src/main/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

let tmpDir: string;
let prevWs: string | undefined;
const UID = 'u1';

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cogseed-ck-gap-'));
  prevWs = process.env.COGSEED_WORKSPACE_ROOT;
  process.env.COGSEED_WORKSPACE_ROOT = tmpDir;
  vi.resetModules();
});

afterEach(() => {
  process.env.COGSEED_WORKSPACE_ROOT = prevWs;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writePoDoc(): void {
  const dir = path.join(tmpDir, UID, 'cloud', 'cognition');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'personal-ontology.json'),
    JSON.stringify({
      schemaVersion: 2,
      groups: [
        {
          id: 'g1',
          kind: 'user',
          title: '关于我',
          createdAt: '2026-09-01T00:00:00Z',
          updatedAt: '2026-09-01T00:00:00Z',
          fields: [
            { id: 'f1', name: '姓名', origin: 'user', createdAt: '2026-09-01T00:00:00Z' },
            { id: 'f2', name: '银行卡号', origin: 'user', createdAt: '2026-09-01T00:00:00Z' },
          ],
          values: [
            { id: 'v1', fieldId: 'f1', text: '牛保康', source: 'manual', createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z' },
          ],
          entries: [],
        },
      ],
      trash: [],
      updatedAt: '2026-09-01T00:00:00Z',
    }),
    'utf8',
  );
}

function mods() {
  return Promise.all([
    import('../../../../src/main/features/cognition_kernel/gap'),
    import('../../../../src/main/features/cognition_kernel/store'),
  ]).then(([gap, store]) => ({ gap, store }));
}

const PACK = { id: 'expense', title: '报销', fields: [
  { fieldName: '姓名', required: true },
  { fieldName: '银行卡号', required: true },
] } as const;

describe('cognition_kernel/gap — 体检（缺口计算）', () => {
  it('旧账有值→bound；缺的→gap 带提问与动作', async () => {
    writePoDoc();
    const { gap } = await mods();
    const check = await gap.checkTaskFields(UID, PACK);
    expect(check.boundCount).toBe(1);
    expect(check.gaps).toHaveLength(1);
    expect(check.gaps[0]).toMatchObject({ fieldName: '银行卡号', reason: 'no_value', action: 'answer' });
    expect(check.gaps[0].question).toContain('银行卡号');
  });

  it('非必需字段缺失不进缺口（但仍如实记录在 resolution.missing）', async () => {
    const { gap } = await mods();
    const check = await gap.checkTaskFields(UID, { id: 'p', title: 'p', fields: [{ fieldName: '银行卡号', required: false }] });
    expect(check.gaps).toHaveLength(0);
    expect(check.resolution.missing).toHaveLength(1);
  });
});

describe('cognition_kernel/gap — 回填（答一次，永久记住）', () => {
  it('回填 → 统一库断言落地 + 版本流，delta origin=gap/status=applied', async () => {
    writePoDoc();
    const { gap, store } = await mods();
    const r = await gap.backfillFieldValue(UID, {
      fieldName: '银行卡号',
      value: '6217-0000-0000-1234',
      evidenceRefs: [{ kind: 'task_run', id: 't1' }],
    });
    expect(r.ok).toBe(true);
    expect(r.objectId).toBeTruthy();
    expect(r.delta?.origin).toBe('gap');
    expect(r.delta?.status).toBe('applied');
    expect(r.delta?.target).toMatchObject({ home: 'personal_fact', fieldName: '银行卡号' });
    const doc = store.loadCognitionStoreSync(UID);
    const obj = doc.objects[r.objectId as string];
    expect(obj.kind).toBe('assertion');
    expect(obj.statement).toBe('6217-0000-0000-1234');
    expect(store.listCognitionVersions(UID, r.objectId as string)).toHaveLength(1);
    // po 旧账不再被写（写入路径单一切换）
    const poRaw = JSON.parse(fs.readFileSync(path.join(tmpDir, UID, 'cloud', 'cognition', 'personal-ontology.json'), 'utf8'));
    expect(poRaw.groups[0].values).toHaveLength(1);
  });

  it('重复回答同一条内容 → 幂等成功，不报错也不重复写', async () => {
    writePoDoc();
    const { gap, store } = await mods();
    await gap.backfillFieldValue(UID, { fieldName: '姓名', value: '牛保康' });
    const again = await gap.backfillFieldValue(UID, { fieldName: '姓名', value: '牛保康' });
    expect(again.ok).toBe(true);
    expect(again.duplicate).toBe(true);
    const doc = store.loadCognitionStoreSync(UID);
    expect(Object.values(doc.objects).filter((o) => o.statement === '牛保康')).toHaveLength(1);
  });

  it('空白值 / 空字段名 → 拒绝', async () => {
    const { gap } = await mods();
    expect((await gap.backfillFieldValue(UID, { fieldName: '开户行', value: '   ' })).ok).toBe(false);
    expect((await gap.backfillFieldValue(UID, { fieldName: '  ', value: 'x' })).ok).toBe(false);
  });

  it('回答完成后，同一个任务包再体检 → 该字段不再是缺口（库优先遮蔽旧账）', async () => {
    writePoDoc();
    const { gap } = await mods();
    const before = await gap.checkTaskFields(UID, PACK);
    expect(before.gaps.map((g) => g.fieldName)).toEqual(['银行卡号']);
    await gap.backfillFieldValue(UID, { fieldName: '银行卡号', value: '6217-live' });
    const after = await gap.checkTaskFields(UID, PACK);
    expect(after.gaps).toHaveLength(0);
    expect(after.boundCount).toBe(2);
    const bound = after.resolution.bound.find((b) => b.fieldName === '银行卡号');
    expect(bound?.value).toBe('6217-live');
    expect(bound?.sourceId).toMatch(/^co-/);
  });
});
