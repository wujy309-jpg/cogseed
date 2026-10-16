/** 候选确认等待期间新增条目的并发写入保留。 */
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
const UID = 'probe-r2-lost';

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cogseed-probe-r2b-'));
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

async function loadCands() {
  return import('../../src/main/features/personal_ontology_candidates');
}

async function seedPool(ids: string[]): Promise<void> {
  const cands = await loadCands();
  const list = ids.map((id) => ({
    candidate_id: id,
    kind: 'preference' as const,
    confidence: 'high' as const,
    summary: `候选 ${id}`,
    memory_scope: 'user' as const,
    memory_text: `内容-${id}`,
    source_memory_refs: [],
  }));
  fs.mkdirSync(path.dirname(candidatesMd()), { recursive: true });
  fs.writeFileSync(candidatesMd(), cands.serializeCandidatesMarkdown(list));
}

describe('候选池确认窗口丢写', () => {
  // 在确认的 await 窗口新增候选，观察提交是否保留新增行。
  it.skip('确认的 await 窗口内 addCandidate 写入的新候选被旧快照回写吞掉（静默丢失）', async () => {
    await seedPool(['cand-a', 'cand-b']);
    const cands = await loadCands();

    // 1) 发起确认：同步跑到第一个 await（resolveLlmRoute 调用点）让出主线程
    const confirming = cands.confirmCandidate(UID, 'cand-a');
    // 2) 窗口内：回流/新增候选（addCandidate 全同步，立即落盘）
    const added = await cands.addCandidate(UID, {
      candidate_id: 'asset-backflow-x1',
      kind: 'rule',
      summary: '回流候选',
      memory_text: '回流内容',
    });
    expect(added.ok).toBe(true);
    // 落盘瞬间：3 条都在
    const mid = await cands.listCandidates(UID);
    expect(mid.candidate_updates.map((c) => c.candidate_id).sort())
      .toEqual(['asset-backflow-x1', 'cand-a', 'cand-b']);
    // 3) confirm 恢复：基于 [a,b] 快照 splice → 整文件回写 [b]
    const result = await confirming;
    expect(result.ok).toBe(true);
    // 4) 回流候选凭空消失（被覆盖），确认内容却已写进记忆
    const after = await cands.listCandidates(UID);
    expect(after.candidate_updates.map((c) => c.candidate_id)).toEqual(['cand-b']);
  });

  // 无交错对照：确认旧入口不消费原行，也不覆盖新增行。
  it('对照组：旧确认writer已退役，不消费已有行或覆盖新增行', async () => {
    await seedPool(['cand-c']);
    const cands = await loadCands();
    await cands.addCandidate(UID, {
      candidate_id: 'asset-backflow-x2', kind: 'rule', summary: '回流候选2', memory_text: '回流内容2',
    });
    const before = fs.readFileSync(candidatesMd(), 'utf8');
    expect(cands).not.toHaveProperty('confirmCandidate');
    const after = await cands.listCandidates(UID);
    expect(after.candidate_updates.map(c => c.candidate_id)).toEqual(['cand-c', 'asset-backflow-x2']);
    expect(fs.readFileSync(candidatesMd(), 'utf8')).toBe(before);
    expect(fs.existsSync(path.join(tmpDir, UID, 'cloud', 'memory', 'USER.md'))).toBe(false);
  });

  // 保留 active（对比证据）：reject 全同步原子无交错窗口，修复后应持续绿。
  it('rejectCandidate 全同步原子：同窗口交错不丢（与 confirm 的对比证据）', async () => {
    await seedPool(['cand-d', 'cand-e']);
    const cands = await loadCands();
    // reject 是 async 声明但函数体全同步（read→splice→write 无 await）
    const rejecting = cands.rejectCandidate(UID, 'cand-d');
    await cands.addCandidate(UID, {
      candidate_id: 'asset-backflow-x3',
      kind: 'rule',
      summary: '回流候选3',
      memory_text: '回流内容3',
    });
    await rejecting;
    const after = await cands.listCandidates(UID);
    // reject 同步完成于 addCandidate 之前，无交错窗口 → 不丢
    expect(after.candidate_updates.map((c) => c.candidate_id).sort())
      .toEqual(['asset-backflow-x3', 'cand-e']);
  });
});
