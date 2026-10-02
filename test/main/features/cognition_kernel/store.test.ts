/**
 * 统一认知库存储内核测试（S3）。
 *
 * 覆盖：懒创建读路径零副作用、set 槽位建/更、幂等跳过、update/remove 语义
 * （软删墓碑、删后拒改）、全批原子（一败全不动）、experience/task_local 拒收、
 * proposed 拒收（候选池不进库）、坏档写侧拒绝、防御性归一、objectId 路径
 * 穿越拒绝、版本流/台账追加。
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
const UID = 'test-user-001';

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cogseed-ck-store-'));
  prevWs = process.env.COGSEED_WORKSPACE_ROOT;
  process.env.COGSEED_WORKSPACE_ROOT = tmpDir;
  vi.resetModules();
});

afterEach(() => {
  process.env.COGSEED_WORKSPACE_ROOT = prevWs;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function storeFile(): string {
  return path.join(tmpDir, UID, 'cloud', 'cognition', 'cognition-store.json');
}

function versionsDir(): string {
  return path.join(tmpDir, UID, 'cloud', 'cognition', 'cognition-versions');
}

function auditFile(): string {
  return path.join(tmpDir, UID, 'cloud', 'cognition', 'cognition-audit.jsonl');
}

function kernel() {
  return import('../../../../src/main/features/cognition_kernel/store');
}

function deltaMod() {
  return import('../../../../src/main/features/cognition_kernel/delta');
}

function build(delta: {
  op: 'add' | 'update' | 'remove' | 'set';
  home: string;
  after?: string;
  objectId?: string;
  groupId?: string;
  fieldName?: string;
  origin?: string;
  status?: 'applied' | 'proposed';
}) {
  return deltaMod().then(({ buildDelta }) =>
    buildDelta({
      op: delta.op,
      target: {
        home: delta.home as never,
        ...(delta.objectId ? { objectId: delta.objectId } : {}),
        ...(delta.groupId ? { groupId: delta.groupId } : {}),
        ...(delta.fieldName ? { fieldName: delta.fieldName } : {}),
      },
      origin: (delta.origin ?? 'user') as never,
      after: delta.after ?? null,
      ...(delta.status ? { status: delta.status } : {}),
    }),
  );
}

describe('cognition_kernel/store — 统一认知库内核', () => {
  it('ENOENT → 空库，读路径零副作用（不建目录不落盘）', async () => {
    const { loadCognitionStoreSync } = await kernel();
    const doc = loadCognitionStoreSync(UID);
    expect(doc.objects).toEqual({});
    expect(fs.existsSync(storeFile())).toBe(false);
    expect(fs.existsSync(path.dirname(storeFile()))).toBe(false);
  });

  it('set 断言槽位：无则建、有则原对象升版（同槽不建第二条）', async () => {
    const { applyCognitionDeltas, loadCognitionStoreSync } = await kernel();
    const d1 = await build({ op: 'set', home: 'personal_fact', fieldName: '银行卡号', after: '6222…1234', groupId: 'g-fin' });
    const r1 = await applyCognitionDeltas(UID, [d1]);
    expect(r1.ok).toBe(true);
    expect(r1.appliedCount).toBe(1);
    const doc1 = loadCognitionStoreSync(UID);
    const first = Object.values(doc1.objects)[0];
    expect(first.kind).toBe('assertion');
    expect(first.statement).toBe('6222…1234');
    expect(first.version).toBe(1);

    const d2 = await build({ op: 'set', home: 'personal_fact', fieldName: '银行卡号', after: '6222…5678', groupId: 'g-fin' });
    const r2 = await applyCognitionDeltas(UID, [d2]);
    expect(r2.ok).toBe(true);
    const doc2 = loadCognitionStoreSync(UID);
    expect(Object.keys(doc2.objects)).toHaveLength(1);
    expect(Object.values(doc2.objects)[0].statement).toBe('6222…5678');
    expect(Object.values(doc2.objects)[0].version).toBe(2);
    expect(r2.results[0]).toMatchObject({ applied: true, objectId: first.id });
  });

  it('幂等：同一 Delta 实例重放（双提交/崩溃重试）→ duplicate 跳过且不升版；新变更加常落地', async () => {
    const { applyCognitionDeltas, loadCognitionStoreSync } = await kernel();
    const d = await build({ op: 'set', home: 'personal_fact', fieldName: '部门', after: '开源项目组' });
    await applyCognitionDeltas(UID, [d]);
    // 精确重放：同一个 delta 对象再来一次（双提交/重试路径的形状）。
    const r = await applyCognitionDeltas(UID, [d]);
    expect(r.ok).toBe(true);
    expect(r.results[0]).toMatchObject({ applied: false, duplicate: true });
    const doc = loadCognitionStoreSync(UID);
    expect(Object.values(doc.objects)[0].version).toBe(1);
    // 同槽位的新内容变更不是重放：必须落地并升版（槽位键去重属候选池语义，不属存储侧）。
    const d2 = await build({ op: 'set', home: 'personal_fact', fieldName: '部门', after: '开源项目组·平台线' });
    const r2 = await applyCognitionDeltas(UID, [d2]);
    expect(r2.ok).toBe(true);
    expect(r2.results[0].applied).toBe(true);
    expect(loadCognitionStoreSync(UID).objects[Object.keys(doc.objects)[0]].version).toBe(2);
  });

  it('add/update/remove：升版、软删墓碑、删后拒改', async () => {
    const { applyCognitionDeltas, loadCognitionStoreSync } = await kernel();
    const add = await build({ op: 'add', home: 'rule', after: '对外报价不承诺交期' });
    const r1 = await applyCognitionDeltas(UID, [add]);
    expect(r1.ok).toBe(true);
    const objectId = r1.results[0].applied ? r1.results[0].objectId : '';
    expect(objectId).toBeTruthy();

    const upd = await build({ op: 'update', home: 'rule', after: '对外报价不承诺交期（含口头）', objectId });
    const r2 = await applyCognitionDeltas(UID, [upd]);
    expect(r2.ok).toBe(true);
    const doc2 = loadCognitionStoreSync(UID);
    expect(doc2.objects[objectId].version).toBe(2);

    const rm = await build({ op: 'remove', home: 'rule', objectId });
    const r3 = await applyCognitionDeltas(UID, [rm]);
    expect(r3.ok).toBe(true);
    const doc3 = loadCognitionStoreSync(UID);
    expect(doc3.objects[objectId].status).toBe('deleted');
    expect(doc3.objects[objectId].deletedAt).toBeTruthy();

    const upd2 = await build({ op: 'update', home: 'rule', after: '复活尝试', objectId });
    const r4 = await applyCognitionDeltas(UID, [upd2]);
    expect(r4.ok).toBe(false);
  });

  it('全批原子：批内一个失败 → 主档保持原样（全或无）', async () => {
    const { applyCognitionDeltas, loadCognitionStoreSync } = await kernel();
    const good = await build({ op: 'set', home: 'personal_fact', fieldName: '称呼', after: '子安' });
    await applyCognitionDeltas(UID, [good]);
    const before = fs.readFileSync(storeFile(), 'utf8');

    const good2 = await build({ op: 'set', home: 'personal_fact', fieldName: '城市', after: '北京' });
    const bad = await build({ op: 'update', home: 'rule', after: '找不到对象', objectId: 'co-nonexistent' });
    const r = await applyCognitionDeltas(UID, [good2, bad]);
    expect(r.ok).toBe(false);
    expect(fs.readFileSync(storeFile(), 'utf8')).toBe(before);
  });

  it('experience / task_local 拒收（不在统一库）', async () => {
    const { applyCognitionDeltas } = await kernel();
    const exp = await build({ op: 'add', home: 'experience', after: '上次发票被退回' });
    const r1 = await applyCognitionDeltas(UID, [exp]);
    expect(r1.ok).toBe(false);
    const local = await build({ op: 'add', home: 'task_local', after: '本周上线支付网关' });
    const r2 = await applyCognitionDeltas(UID, [local]);
    expect(r2.ok).toBe(false);
  });

  it('proposed 拒收：候选池语义不进库', async () => {
    const { applyCognitionDeltas } = await kernel();
    const proposed = await build({ op: 'add', home: 'rule', after: '系统提议', origin: 'gap', status: 'proposed' });
    const r = await applyCognitionDeltas(UID, [proposed]);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('proposed');
  });

  it('坏档写侧拒绝：主档坏 JSON → 拒写且不覆盖', async () => {
    fs.mkdirSync(path.dirname(storeFile()), { recursive: true });
    fs.writeFileSync(storeFile(), '{not json', 'utf8');
    const { applyCognitionDeltas } = await kernel();
    const d = await build({ op: 'set', home: 'personal_fact', fieldName: 'x', after: 'y' });
    const r = await applyCognitionDeltas(UID, [d]);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('corrupt');
    expect(fs.readFileSync(storeFile(), 'utf8')).toBe('{not json');
    const backups = fs.readdirSync(path.dirname(storeFile())).filter((f) => f.includes('.corrupt-'));
    expect(backups.length).toBeGreaterThanOrEqual(1);
  });

  it('版本流与台账：落地后逐对象 jsonl 追加 + 全局台账', async () => {
    const { applyCognitionDeltas, listCognitionVersions, cognitionAuditPath } = await kernel();
    const add = await build({ op: 'add', home: 'template', after: '周报三段式：进展/风险/下周计划' });
    const r = await applyCognitionDeltas(UID, [add]);
    expect(r.ok).toBe(true);
    const objectId = r.results[0].applied ? r.results[0].objectId : '';
    const versions = listCognitionVersions(UID, objectId);
    expect(versions).toHaveLength(1);
    expect(versions[0].op).toBe('add');
    expect(versions[0].after).toContain('周报');
    expect(fs.existsSync(versionsDir())).toBe(true);
    const auditRaw = fs.readFileSync(cognitionAuditPath(UID), 'utf8');
    expect(auditRaw).toContain('"template"');
  });

  it('objectId 路径穿越拒绝', async () => {
    const { applyCognitionDeltas } = await kernel();
    const evil = await build({ op: 'add', home: 'rule', after: 'x', objectId: '../../evil' });
    const r = await applyCognitionDeltas(UID, [evil]);
    expect(r.ok).toBe(false);
  });

  it('防御性归一：坏对象剔除、非法枚举回默认、appliedDeltas 有界', async () => {
    const { normalizeCognitionStoreDocument, APPLIED_DELTA_INDEX_MAX } = await import(
      '../../../../src/main/features/cognition_kernel/object-model'
    );
    const doc = normalizeCognitionStoreDocument({
      schemaVersion: 1,
      objects: {
        ok: { id: 'ok', kind: 'rule', home: 'rule', title: 't', statement: 's', status: 'weird', version: -3 },
        bad: { kind: 'rule' },
      },
      appliedDeltas: { 'd-1': true },
      appliedOrder: ['d-1'],
    });
    expect(Object.keys(doc.objects)).toEqual(['ok']);
    expect(doc.objects.ok.status).toBe('active');
    expect(doc.objects.ok.version).toBe(1);
    expect(doc.appliedDeltas).toEqual({ 'd-1': true });
    expect(APPLIED_DELTA_INDEX_MAX).toBeGreaterThan(0);
  });
});
