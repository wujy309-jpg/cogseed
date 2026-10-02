import { describe, it, expect, vi, beforeEach } from 'vitest';

interface FakeGroup {
  id: string;
  title: string;
  kind: 'user' | 'template';
  fields: Array<{ id: string; name: string; origin: 'user'; createdAt: string }>;
  values: Array<{ id: string; fieldId: string; text: string; source: string; createdAt: string; updatedAt: string; restricted?: boolean }>;
  entries: unknown[];
  createdAt: string;
  updatedAt: string;
}

const h = vi.hoisted(() => {
  const doc: { schemaVersion: number; groups: FakeGroup[]; trash: unknown[] } = { schemaVersion: 2, groups: [], trash: [] };
  const calls: Array<{ fn: string; args: unknown[] }> = [];
  return { doc, calls };
});

vi.mock('../../../../src/main/features/po/store', () => ({
  loadPoDocSync: () => h.doc,
}));

vi.mock('../../../../src/main/features/po/api', () => ({
  poCreateGroup: async (uid: string, title: string) => {
    h.calls.push({ fn: 'poCreateGroup', args: [uid, title] });
    h.doc.groups.push({
      id: 'g-' + (h.doc.groups.length + 1),
      title,
      kind: 'user',
      fields: [],
      values: [],
      entries: [],
      createdAt: 'x',
      updatedAt: 'x',
    });
    return { ok: true };
  },
  poCreateField: async (uid: string, groupId: string, name: string) => {
    h.calls.push({ fn: 'poCreateField', args: [uid, groupId, name] });
    const group = h.doc.groups.find((g) => g.id === groupId);
    if (!group) return { ok: false, error: 'group not found' };
    const field = { id: 'f-' + (group.fields.length + 1), name, origin: 'user' as const, createdAt: 'x' };
    group.fields.push(field);
    return { ok: true, field };
  },
  poAddValue: async (uid: string, groupId: string, fieldId: string, draft: { text: string }) => {
    h.calls.push({ fn: 'poAddValue', args: [uid, groupId, fieldId, draft] });
    const group = h.doc.groups.find((g) => g.id === groupId);
    const field = group?.fields.find((f) => f.id === fieldId);
    if (!group || !field) return { ok: false, error: 'field not found' };
    if (group.values.some((v) => v.fieldId === fieldId && v.text === draft.text)) {
      return { ok: false, error: 'duplicate value' };
    }
    const value = {
      id: 'v-' + (group.values.length + 1),
      fieldId,
      text: draft.text,
      source: '手动',
      createdAt: 'x',
      updatedAt: 'x',
    };
    group.values.push(value);
    return { ok: true, value };
  },
}));

vi.mock('../../../../src/main/features/recall/asset-service', () => ({ listAbilityAssets: async () => [] }));
vi.mock('../../../../src/main/features/recall/prompt-injection', () => ({
  filterRecallAssetsForAgentRead: async (_uid: string, assets: unknown[]) => assets,
}));

import { backfillFieldValue, checkTaskFields } from '../../../../src/main/features/cognition_kernel/gap';
import type { TaskFieldPack } from '../../../../src/main/features/cognition_kernel/task_field_packs';

const PACK: TaskFieldPack = {
  id: 'test',
  title: '测试任务',
  fields: [{ fieldName: '姓名' }, { fieldName: '银行卡号' }, { fieldName: '身份证号' }],
};

beforeEach(() => {
  h.calls.length = 0;
  h.doc.groups = [
    {
      id: 'g1',
      title: '关于我',
      kind: 'user',
      fields: [
        { id: 'f1', name: '姓名', origin: 'user', createdAt: 'x' },
        { id: 'f2', name: '银行卡号', origin: 'user', createdAt: 'x' },
        { id: 'f3', name: '身份证号', origin: 'user', createdAt: 'x' },
      ],
      values: [
        { id: 'v1', fieldId: 'f1', text: '牛保康', source: '手动', createdAt: 'x', updatedAt: '2026-09-01T00:00:00Z' },
        {
          id: 'v3',
          fieldId: 'f3',
          text: '110101',
          source: '手动',
          createdAt: 'x',
          updatedAt: '2026-09-01T00:00:00Z',
          restricted: true,
        },
      ],
      entries: [],
      createdAt: 'x',
      updatedAt: 'x',
    },
  ];
});

describe('cognition_kernel/gap — 缺口引擎', () => {
  it('分成"已有/缺"，缺的按原因给出不同问法与动作', async () => {
    const check = await checkTaskFields('u1', PACK);
    expect(check.boundCount).toBe(1);
    expect(check.totalCount).toBe(3);
    expect(check.gaps.map((g) => [g.fieldName, g.reason, g.action])).toEqual([
      ['银行卡号', 'no_value', 'answer'],
      ['身份证号', 'restricted', 'open_settings'],
    ]);
    expect(check.gaps[0].question).toBe('请补充：银行卡号');
    expect(check.gaps[1].question).toContain('仅自己可见');
  });

  it('非必需字段缺失不进缺口（但仍如实记录在 resolution.missing）', async () => {
    const pack: TaskFieldPack = { id: 'p', title: 'p', fields: [{ fieldName: '银行卡号', required: false }] };
    const check = await checkTaskFields('u1', pack);
    expect(check.gaps).toHaveLength(0);
    expect(check.resolution.missing).toHaveLength(1);
  });
});

describe('cognition_kernel/gap — 回填（答一次，永久记住）', () => {
  it('组和字段都已存在 → 直接写值，并给出 origin=gap/status=applied 的改动记录', async () => {
    const r = await backfillFieldValue('u1', {
      fieldName: '银行卡号',
      value: '6217-0000-0000-1234',
      evidenceRefs: [{ kind: 'task_run', id: 't1' }],
    });
    expect(r.ok).toBe(true);
    expect(r.groupId).toBe('g1');
    expect(r.delta?.origin).toBe('gap');
    expect(r.delta?.status).toBe('applied');
    expect(r.delta?.target).toMatchObject({ home: 'personal_fact', fieldName: '银行卡号' });
    expect(h.calls.filter((c) => c.fn === 'poCreateGroup')).toHaveLength(0);
    expect(h.calls.filter((c) => c.fn === 'poCreateField')).toHaveLength(0);
    expect(h.calls.filter((c) => c.fn === 'poAddValue')).toHaveLength(1);
  });

  it('组/字段不存在时自动建，再写值', async () => {
    h.doc.groups = [];
    const r = await backfillFieldValue('u1', { fieldName: '开户行', value: '工商银行' });
    expect(r.ok).toBe(true);
    expect(h.calls.map((c) => c.fn)).toEqual(['poCreateGroup', 'poCreateField', 'poAddValue']);
    expect(h.doc.groups[0].title).toBe('关于我');
    expect(h.doc.groups[0].fields[0].name).toBe('开户行');
    expect(h.doc.groups[0].values[0].text).toBe('工商银行');
  });

  it('重复回答同一条内容 → 幂等成功，不报错也不重复写', async () => {
    await backfillFieldValue('u1', { fieldName: '姓名', value: '牛保康' });
    const again = await backfillFieldValue('u1', { fieldName: '姓名', value: '牛保康' });
    expect(again.ok).toBe(true);
    expect(again.duplicate).toBe(true);
    expect(h.doc.groups[0].values.filter((v) => v.text === '牛保康')).toHaveLength(1);
  });

  it('空白值 / 空字段名 → 拒绝', async () => {
    expect((await backfillFieldValue('u1', { fieldName: '开户行', value: '   ' })).ok).toBe(false);
    expect((await backfillFieldValue('u1', { fieldName: '  ', value: 'x' })).ok).toBe(false);
  });

  it('回答完成后，同一个任务包再体检 → 该字段不再是缺口', async () => {
    await backfillFieldValue('u1', { fieldName: '银行卡号', value: '6217-live' });
    const check = await checkTaskFields('u1', PACK);
    expect(check.gaps.map((g) => g.fieldName)).toEqual(['身份证号']);
    expect(check.boundCount).toBe(2);
  });
});
