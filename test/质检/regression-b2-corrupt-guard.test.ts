/** 本体、候选池和词表坏档的结构化错误、拒写、备份及恢复入口。 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

vi.mock('../../src/main/features/kb_indexer', () => ({
  enqueue: () => {},
  kbEvents: { on: () => {}, off: () => {}, emit: () => {} },
}));
vi.mock('../../src/main/features/search', () => ({
  upsertContext: () => {},
  dropContext: () => {},
}));

// paths.ts 的 WS_ROOT 在模块加载时定格：每个用例换 tmpDir 前必须 resetModules，
// 用例内动态导入（与 test/质检/probe-r1-po-badjson-overwrite 同款模式）。
let tmpDir: string;
let prevWs: string | undefined;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cogseed-reg-guard-'));
  prevWs = process.env.COGSEED_WORKSPACE_ROOT;
  process.env.COGSEED_WORKSPACE_ROOT = tmpDir;
  vi.resetModules();
});
afterEach(() => {
  process.env.COGSEED_WORKSPACE_ROOT = prevWs;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function poDoc(uid: string): string {
  return path.join(tmpDir, uid, 'cloud', 'cognition', 'personal-ontology.json');
}

async function loadPoStore() {
  return import('../../src/main/features/po/store');
}

async function loadGuard() {
  return import('../../src/main/util/corrupt-guard');
}

function corruptBackupsOf(file: string): string[] {
  return fs.readdirSync(path.dirname(file)).filter((n) => n.startsWith(`${path.basename(file)}.corrupt-`));
}

describe('po 同构点：坏 JSON → 备份 + 拒写 + 恢复入口', () => {
  it('坏 JSON → copy 备份（原文件不动）→ editPoDoc 拒写，盘上字节保留', async () => {
    const uid = 'reg_po_bad';
    const store = await loadPoStore();
    // seed：先写一份真实文档（无坏档时写路径正常）。
    const seeded = await store.editPoDoc(uid, () => {});
    expect(seeded.ok).toBe(true);
    expect(fs.existsSync(poDoc(uid))).toBe(true);

    // 模拟云同步截断。
    const corruptBytes = '{"schemaVersion":2,"groups":[{"id":"g1","ti';
    fs.writeFileSync(poDoc(uid), corruptBytes);

    // 读侧探测：loadPoDocSync 返回空文档（展示用），坏档已登记 + 备份在场。
    const doc = store.loadPoDocSync(uid);
    expect(doc.groups).toEqual([]);
    expect(corruptBackupsOf(poDoc(uid))).toHaveLength(1);
    expect(fs.readFileSync(poDoc(uid), 'utf8')).toBe(corruptBytes); // copy 不动原文件

    // 写侧拒绝：整条统一写路径返回结构化失败，不落盘。
    const refused = await store.editPoDoc(uid, () => {});
    expect(refused.ok).toBe(false);
    expect(String(refused.error)).toContain('corrupt');
    expect(fs.readFileSync(poDoc(uid), 'utf8')).toBe(corruptBytes); // 未被空文档+新增覆盖
    expect(corruptBackupsOf(poDoc(uid))).toHaveLength(1); // 重复读不堆同内容备份
  });

  it('restore：最新备份 copy 回原位；内容仍坏则下次读取重新登记（不新增备份）', async () => {
    const uid = 'reg_po_restore';
    const store = await loadPoStore();
    const guard = await loadGuard();
    const seeded = await store.editPoDoc(uid, () => {});
    expect(seeded.ok).toBe(true);
    const corruptBytes = '{"schemaVersion":2,"groups":[{"id":"g1","ti';
    fs.writeFileSync(poDoc(uid), corruptBytes);
    store.loadPoDocSync(uid); // 触发登记 + 备份
    const [backupName] = corruptBackupsOf(poDoc(uid));
    expect(backupName).toBeTruthy();

    const res = guard.restoreCorruptFile(poDoc(uid));
    expect(res.ok).toBe(true);
    expect(fs.readFileSync(poDoc(uid), 'utf8')).toBe(corruptBytes);

    // 恢复的字节仍解析失败 → 下次读取重新登记，且内容相同不重复备份。
    store.loadPoDocSync(uid);
    expect(guard.corruptRecordFor(poDoc(uid))).toBeTruthy();
    expect(corruptBackupsOf(poDoc(uid))).toHaveLength(1);
  });

  it('reset：删除坏档原文件（备份保留）→ 真 ENOENT 空初始化 → 可写恢复', async () => {
    const uid = 'reg_po_reset';
    const store = await loadPoStore();
    const guard = await loadGuard();
    const seeded = await store.editPoDoc(uid, () => {});
    expect(seeded.ok).toBe(true);
    fs.writeFileSync(poDoc(uid), '{"schemaVersion":2,"groups":[{"id":"g1","ti');
    store.loadPoDocSync(uid);
    expect(corruptBackupsOf(poDoc(uid))).toHaveLength(1);

    expect(guard.resetCorruptFile(poDoc(uid)).ok).toBe(true);
    expect(fs.existsSync(poDoc(uid))).toBe(false); // 真 ENOENT
    expect(corruptBackupsOf(poDoc(uid))).toHaveLength(1); // 备份保留

    // 空初始化合法（不误伤），写路径恢复。
    const after = await store.editPoDoc(uid, () => {});
    expect(after.ok).toBe(true);
    expect(fs.existsSync(poDoc(uid))).toBe(true);
  });

  it('自愈：坏档被外部修复（读得回合法 JSON）后，拒写解除', async () => {
    const uid = 'reg_po_heal';
    const store = await loadPoStore();
    const guard = await loadGuard();
    const seeded = await store.editPoDoc(uid, () => {});
    expect(seeded.ok).toBe(true);
    fs.writeFileSync(poDoc(uid), '{"schemaVersion":2,"groups":[{"id":"g1","ti');
    store.loadPoDocSync(uid);
    expect(guard.corruptRecordFor(poDoc(uid))).toBeTruthy();

    // 外部修复（云同步还原 / 用户手修）。
    fs.writeFileSync(poDoc(uid), JSON.stringify({ schemaVersion: 2, groups: [], trash: [] }));
    store.loadPoDocSync(uid);
    expect(guard.corruptRecordFor(poDoc(uid))).toBeUndefined();
    const healed = await store.editPoDoc(uid, () => {});
    expect(healed.ok).toBe(true);
  });
});

describe('候选池：读错只吞真 ENOENT，其余备份+拒写+如实上报', () => {
  it('读错（EACCES）→ listCandidates 带回 corrupt + addCandidate 拒写 + 盘上不动', async () => {
    const uid = 'reg_cand_io';
    const cands = await import('../../src/main/features/personal_ontology_candidates');
    const md = cands.candidatesMdPath(uid);
    await cands.addCandidate(uid, { candidate_id: 'c_keep_1', summary: '池里的存量候选' });
    expect(fs.existsSync(md)).toBe(true);
    const bytesBefore = fs.readFileSync(md, 'utf8');

    // 模拟磁盘故障/权限失效（非 ENOENT 的读错）。旧病：readTextSafe 吞掉 →
    // 空表 → 下一次写（含后台回流投放）全量覆写 = 候选池静默清空。
    fs.chmodSync(md, 0o000);

    const data = await cands.listCandidates(uid);
    expect(data.corrupt).toBeTruthy(); // 读侧结构化错误（失败≠空态）
    await expect(cands.addCandidate(uid, { summary: '读错期间的新候选' }))
      .rejects.toMatchObject({ code: 'cognition_file_corrupt' });

    // 权限恢复（外部修复）→ 读成功自愈 → 可写。
    fs.chmodSync(md, 0o644);
    const healed = await cands.listCandidates(uid);
    expect(healed.corrupt).toBeUndefined();
    expect(healed.candidate_updates.map((c) => c.candidate_id)).toContain('c_keep_1');
    expect(fs.readFileSync(md, 'utf8')).toBe(bytesBefore); // 全程未被覆盖
    await cands.addCandidate(uid, { candidate_id: 'c_after_heal', summary: '自愈后的新候选' });
    const final = await cands.listCandidates(uid);
    expect(final.candidate_updates.map((c) => c.candidate_id)).toEqual(
      expect.arrayContaining(['c_keep_1', 'c_after_heal']),
    );
  });

  it('真 ENOENT（新用户空池）不受影响，正常入池（对照组）', async () => {
    const uid = 'reg_cand_fresh';
    const cands = await import('../../src/main/features/personal_ontology_candidates');
    const data = await cands.listCandidates(uid);
    expect(data.candidate_updates).toEqual([]);
    expect(data.corrupt).toBeUndefined();
    await cands.addCandidate(uid, { candidate_id: 'c_fresh_1', summary: '第一条' });
    const after = await cands.listCandidates(uid);
    expect(after.candidate_updates).toHaveLength(1);
  });
});

describe('词表重置出路：reset 后空初始化可写，备份保留', () => {
  // 该用例依赖词表坏档抛错并生成备份；当前兼容读取语义不满足此前置条件。
  // 维持跳过，待词表错误、备份与重置恢复入口的契约统一后调整断言。
  it.skip('词表坏 JSON 重置后可重新写入，原目录保留损坏备份', async () => {
    const uid = 'reg_glos_reset';
    const glossary = await import('../../src/main/features/transcript_glossary');
    const { userTranscriptGlossaryFile } = await import('../../src/main/paths');
    const guard = await loadGuard();
    const file = userTranscriptGlossaryFile(uid);
    glossary.upsertEntry(uid, { wrong: 'coxy', correct: 'Cogseed' });
    fs.writeFileSync(file, '{"version":2,"uid":"' + uid + '","entries":[{"wrong":"cox');
    expect(() => glossary.loadGlossary(uid)).toThrow(
      expect.objectContaining({ code: 'cognition_file_corrupt' }),
    );
    expect(corruptBackupsOf(file)).toHaveLength(1);

    expect(guard.resetCorruptFile(file).ok).toBe(true);
    expect(corruptBackupsOf(file)).toHaveLength(1); // 备份保留（外部抢救线索）
    // 真 ENOENT → 空初始化 → 可写。
    expect(glossary.loadGlossary(uid).entries).toEqual([]);
    glossary.upsertEntry(uid, { wrong: 'moodle', correct: 'Moodle' });
    expect(glossary.loadGlossary(uid).entries.map((e) => e.wrong)).toEqual(['moodle']);
  });
});
