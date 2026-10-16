/** 不同 targetRef 的决定账本文件身份隔离与抑制状态独立性。 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

let tmpDir: string;
let prevWs: string | undefined;
const UID = 'probe-r2-rd';

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cogseed-probe-r2-rd-'));
  prevWs = process.env.COGSEED_WORKSPACE_ROOT;
  process.env.COGSEED_WORKSPACE_ROOT = tmpDir;
  vi.resetModules();
});

afterEach(() => {
  process.env.COGSEED_WORKSPACE_ROOT = prevWs;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function loadRd() {
  return import('../../src/main/features/cognition/review-decision');
}

describe('决定账本折叠串档', () => {
  it.skip('targetRef 折叠同名 → B 的决定改写 A 的抑制状态', async () => {
    const rd = await loadRd();
    const targetA = 'recall_candidate:abc';
    const targetB = 'recall_candidate/abc'; // 折叠后与 A 同名（: 与 / 都 → _）

    // A 拒绝（应被抑制，不再提示）
    await rd.writeReviewDecision(UID, {
      targetRef: targetA,
      decisionType: 'reject',
      decision: '不要',
      antecedentRef: 'cand-abc',
    });
    expect(await rd.isCandidateSuppressed(UID, targetA)).toBe(true);

    // B 接受（B 是另一个候选，与 A 无关）
    await rd.writeReviewDecision(UID, {
      targetRef: targetB,
      decisionType: 'accept',
      decision: '采用',
      antecedentRef: 'cand-abc2',
    });

    // 串档实锤：A 的抑制被 B 的 accept 解除
    expect(await rd.isCandidateSuppressed(UID, targetA)).toBe(false);
    // 反向同样成立：A 的历史决定混进 B 的清单
    const listOfB = await rd.listReviewDecisions(UID, targetB);
    expect(listOfB.some((d) => d.target_ref === targetA)).toBe(true);

    // 磁盘上两个 target 共用一个账本文件（折叠同名的直接证据）
    const { cogseedAgentReviewDecisionsDir } = await import('../../src/main/paths');
    const files = fs.readdirSync(cogseedAgentReviewDecisionsDir(UID));
    expect(files.filter((n) => n.endsWith('.jsonl')).length).toBe(1);
  });
});
