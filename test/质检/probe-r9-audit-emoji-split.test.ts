/** 审计摘要的 60 码元前缀和 240 码元整行截断处的代理对完整性。 */
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
const UID = 'probe-r9-audit-emoji';

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cogseed-probe-r9-'));
  prevWs = process.env.COGSEED_WORKSPACE_ROOT;
  process.env.COGSEED_WORKSPACE_ROOT = tmpDir;
  vi.resetModules();
});

afterEach(() => {
  process.env.COGSEED_WORKSPACE_ROOT = prevWs;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** 检测字符串是否含未配对代理（孤立高/低代理码元）。 */
function hasUnpairedSurrogate(text: string): boolean {
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code >= 0xD800 && code <= 0xDBFF) {
      const next = text.charCodeAt(i + 1);
      if (!(next >= 0xDC00 && next <= 0xDFFF)) return true;
    } else if (code >= 0xDC00 && code <= 0xDFFF) {
      const prev = text.charCodeAt(i - 1);
      if (!(prev >= 0xD800 && prev <= 0xDBFF)) return true;
    }
  }
  return false;
}

async function loadAssets() {
  return import('../../src/main/features/recall/asset-service');
}

const ASSET_ID = 'aa-p9emoji01';

async function seed(statement: string) {
  const assets = await loadAssets();
  const now = new Date().toISOString();
  await assets.createAbilityAsset(UID, {
    schemaVersion: 2, ownerId: UID, id: ASSET_ID, candidateId: `cand-${ASSET_ID}`,
    sourceCandidateIds: [`cand-${ASSET_ID}`], reviewDecisionId: 'rd_prober9seed01',
    type: 'personal', title: '资产 r9', statement,
    evidenceRefs: [{ kind: 'conversation', id: `conv-${ASSET_ID}` }], scope: 'general', status: 'active',
    lifecycleStatus: 'user_confirmed_unverified', maturity: 'bud', version: '1',
    createdAt: now, updatedAt: now,
  }, { actor: 'user', reason: 'probe seed' });
  return assets;
}

describe('审计摘要裸 UTF-16 截断劈开 emoji：孤立代理落盘 ability-asset-audit 流', () => {
  it.skip('60 码元前缀截断点位于代理对中间时，前后摘要含孤立代理', async () => {
    const assets = await seed('a'.repeat(59) + '🙂' + '正文尾巴。');
    // 正文本体 round-trip 干净（对照组：孤立代理不是种子自带）
    const seeded = await assets.readAbilityAsset(UID, ASSET_ID);
    expect(hasUnpairedSurrogate(seeded.statement)).toBe(false);

    // 改正文触发 diff 审计：before=旧正文（59a+🙂+尾），摘要取 60 码元前缀
    // → 恰好取到 🙂 的高代理、落下低代理 → 孤立高代理 + '…'。
    await assets.updateAbilityAsset(UID, ASSET_ID, {
      statement: 'b'.repeat(59) + '🙃' + '新正文尾巴。',
      reason: 'probe emoji split', actor: 'user',
    });

    const audit = await assets.listAbilityAssetAudit(UID, ASSET_ID);
    const updated = audit.find((row) => String(row.action || '') === 'updated');
    expect(updated).toBeTruthy();
    // 直接检测原始字符串——ES2019 起对孤立代理会被转义成 ASCII，
    // 经 JSON.stringify 就检不到了；上屏读的是原始码元，检测须对齐。
    const summaryText = String(updated!.before ?? '') + String(updated!.after ?? '');
    // 机制坐实：审计摘要（落盘的 before/after）含未配对代理。
    expect(hasUnpairedSurrogate(summaryText)).toBe(true);
    // 对照：资产正文本体（不截断路径）仍干净。
    const after = await assets.readAbilityAsset(UID, ASSET_ID);
    expect(hasUnpairedSurrogate(after.statement)).toBe(false);
  });

  it.skip('240 码元整行与 60 码元前缀截断的代理对完整性', async () => {
    const { summarizeAuditChange, summarizeAuditValue } = await import('../../src/main/features/recall/asset-service');
    // 60 前缀单点：emoji 高代理恰在索引 59（与主用例同款边界构造）。
    const value = summarizeAuditValue('statement', 'c'.repeat(59) + '🙂' + '尾');
    expect(hasUnpairedSurrogate(String(value))).toBe(true);
    // 240 整行单点：片段=`scope=`(6)+payload，join('；')。前 5 段 payload=36
    // （'vN-'3+'m'33）→ 5 段+4 分隔=214，第 5 分隔符在 214；第 6 段从 215 起：
    // `scope=` 占 215-220，'m'*18 占 221-238，🙂 高代理恰在索引 239 →
    // slice(0,240) 取走高代理落下低代理。payload 均 ≤79 不过段内 clip(80)。
    const changes = Array.from({ length: 6 }, (_, i) => {
      const payload = i < 5 ? `v${i}-` + 'm'.repeat(33) : 'm'.repeat(18) + '🙂';
      return { field: 'scope', before: payload, after: payload };
    });
    const summary = summarizeAuditChange(changes as never);
    expect(summary).toBeTruthy();
    const joined = String(summary!.before);
    // 整行确实被 240 截断（带 …尾）且截断点劈开了代理对（原始串检测）。
    expect(joined.endsWith('…')).toBe(true);
    expect(hasUnpairedSurrogate(joined)).toBe(true);
  });
});
