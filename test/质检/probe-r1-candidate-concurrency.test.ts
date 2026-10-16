/** 候选确认、驳回与并发回写的状态隔离；串行对照保留旧确认入口退役后的只读行为。 */
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

let tmpDir: string;
let prevWs: string | undefined;
const UID = 'probe-r1-cand';

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cogseed-probe-r1c-'));
  prevWs = process.env.COGSEED_WORKSPACE_ROOT;
  process.env.COGSEED_WORKSPACE_ROOT = tmpDir;
  vi.resetModules();
});

afterEach(() => {
  process.env.COGSEED_WORKSPACE_ROOT = prevWs;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function candidatesMd(): string {
  return path.join(tmpDir, UID, 'local', 'ontology_candidates', 'candidates.md');
}
function userMd(): string {
  // memory.ts: user 画像 → <uid>/cloud/memory/USER.md（paths.userProfileFile）
  return path.join(tmpDir, UID, 'cloud', 'memory', 'USER.md');
}

async function loadCands() {
  return import('../../src/main/features/personal_ontology_candidates');
}

/** 用产品自己的序列化器种入 N 条待确认候选。 */
async function seedPool(ids: string[]): Promise<void> {
  const cands = await loadCands();
  const list = ids.map((id) => ({
    candidate_id: id,
    kind: 'preference' as const,
    confidence: 'high' as const,
    summary: `候选 ${id} 的摘要`,
    memory_scope: 'user' as const,
    memory_text: `确认内容-${id}`,
    source_memory_refs: [],
  }));
  fs.mkdirSync(path.dirname(candidatesMd()), { recursive: true });
  fs.writeFileSync(candidatesMd(), cands.serializeCandidatesMarkdown(list));
}

describe('候选池并发双写', () => {
  // 观察并发读改写是否把已处理候选重新写回池。
  it.skip('并发确认两条候选：池中复活一条（已写记忆的候选回到待确认）', async () => {
    await seedPool(['cand-a', 'cand-b']);
    const cands = await loadCands();

    // 模拟渲染层连点两张卡的确认按钮（两个 IPC 在主进程并发执行）
    const [ra, rb] = await Promise.all([
      cands.confirmCandidate(UID, 'cand-a'),
      cands.confirmCandidate(UID, 'cand-b'),
    ]);
    expect(ra.ok).toBe(true);
    expect(rb.ok).toBe(true);

    const after = await cands.listCandidates(UID);
    // 串行世界的正确结果：0 条。并发世界：后写者把先写者删的那条带回来了。
    const poolIds = after.candidate_updates.map((c) => c.candidate_id);
    expect(poolIds.length).toBe(1); // 复活了一条

    // 复活的候选可被再次确认（状态机倒退成「待确认」）
    const dup = await cands.confirmCandidate(UID, poolIds[0]);
    expect(dup.ok).toBe(true);
    // 记忆层：addEntry 对 user 轨按文本去重（memory.ts records.some(text===trimmed)），
    // 所以重复数据侥幸被挡住——但审查决定账本会再记一次 accept，池状态也失真
    const memory = fs.readFileSync(userMd(), 'utf8');
    const needle = `确认内容-${poolIds[0]}`;
    expect(memory.split(needle).length - 1).toBe(1); // 去重兜底生效
    expect((await cands.listCandidates(UID)).candidate_updates.length).toBe(0);
  });

  // 观察确认回写是否覆盖同时完成的驳回。
  it.skip('并发确认 + 驳回：驳回可被并发确认的回写复活（用户以为已丢弃又出现）', async () => {
    await seedPool(['cand-c', 'cand-d']);
    const cands = await loadCands();

    const [confirmRes, rejectRes] = await Promise.all([
      cands.confirmCandidate(UID, 'cand-c'),
      cands.rejectCandidate(UID, 'cand-d', '不要'),
    ]);
    expect(confirmRes.ok).toBe(true);
    expect(rejectRes.ok).toBe(true);

    const after = await cands.listCandidates(UID);
    // 串行世界应为 0 条；被驳回的 cand-d 有概率出现在池里
    expect(after.candidate_updates.length).toBe(1);
    expect(after.candidate_updates[0].candidate_id).toBe('cand-d');
  });

  // 串行对照保留旧入口退役后的读取与持久化边界。
  it('对照组：旧确认writer已退役，读取保留原池且不写记忆', async () => {
    await seedPool(['cand-e', 'cand-f']);
    const cands = await loadCands();
    const before = fs.readFileSync(candidatesMd(), 'utf8');
    expect(cands).not.toHaveProperty('confirmCandidate');
    expect((await cands.listCandidates(UID)).candidate_updates.map(c => c.candidate_id)).toEqual(['cand-e', 'cand-f']);
    expect(fs.readFileSync(candidatesMd(), 'utf8')).toBe(before);
    expect(fs.existsSync(userMd())).toBe(false);
  });
});
