/**
 * 回归 r1（收尾改名自 probe-r1-pack-import-validation.test.ts · 2026-10-01 记账员）：
 * F-r1-26 已修，两漏洞用例已由修复员翻转为回归口径，收尾收编。
 *
 * 原探针（本轮红队-数据与注入）：贡献包导入通道（transcript_contribution_pack）校验
 * 缺口——kind 无白名单、wrong/correct 无长度上限，落盘后读侧被静默剥掉（写读不对称）。
 *
 * 读码链路：
 *  - transcript_contribution_pack.ts parseContributionPack :127
 *    `kind: (row?.kind ?? 'term') as GlossaryKind` —— 其它枚举字段
 *    （action/riskLevel/boundary/ownerScope）都收严到合法值，唯独 kind 任意字符串
 *    as 强转透传；:118-120 wrong/correct 仅 trim，无长度上限；
 *  - applyContributionPack :236-261 绕过 upsertEntry 直接 file.entries.push 落盘
 *    （saveGlossary 只 slice MAX_ENTRIES 不做字段校验）——对比 importGlossary
 *    （transcript_glossary.ts:923）走 upsertEntry：bounded wrong≤80/correct≤200
 *    （:731-732）+ normalizeKind 白名单（:743）；
 *  - 读侧 normalizeStoredEntry :387 kind: normalizeKind(e.kind) 白名单收敛——
 *    导入写入的非法 kind 落盘成功、回执 added=1，读回静默变 'term'，与
 *    F-r2-1/F-r2-2（po 域 ruleKind/verified 写读不对称）同款幽灵写；
 *  - IPC 可达：ipc/transcript.ts:186-195 把渲染层 payload 直接喂
 *    parseContributionPack → applyContributionPack，注释自认「包来自别的机器
 *    （可能被手工编辑过）」。
 *
 * 2026-10-01 F-r1-26 已修复（parseContributionPack 收口 kind 白名单 + 长度
 * 上限，见 transcript_contribution_pack.ts）：下列原「漏洞」用例断言已翻转为
 * 修复后行为，本探针转为回归测试；对照组（importGlossary）断言不变。
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  parseContributionPack,
  applyContributionPack,
  CONTRIBUTION_PACK_FORMAT,
  type ContributionPack,
} from '../../src/main/features/transcript_contribution_pack';
import { loadGlossary, importGlossary } from '../../src/main/features/transcript_glossary';
import { userTranscriptGlossaryFile } from '../../src/main/paths';

let tmpDir: string;
let uid = '';
beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cogseed-pack-r1-'));
  process.env.COGSEED_WORKSPACE_ROOT = tmpDir;
  uid = `u_pack_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
});
afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function packWith(entries: Array<Record<string, unknown>>): ContributionPack {
  return {
    format: CONTRIBUTION_PACK_FORMAT,
    exportedAt: Date.now(),
    ownerScope: 'org',
    counts: { total: entries.length, peopleExcluded: 0, byKind: {} },
    entries: entries as never[],
  };
}

describe('回归 r1 › 贡献包导入：kind 白名单 + 长度上限收口（F-r1-26 已修）', () => {
  it('对照组：importGlossary 通道（upsertEntry）对超长词条拒绝/跳过', async () => {
    const long = 'X'.repeat(5000); // > MAX_WRONG_LEN=80
    const res = importGlossary(uid, { entries: [{ wrong: long, correct: 'Y' }] });
    expect(res.imported).toBe(0);
    expect(res.skipped).toBe(1);
    expect(loadGlossary(uid).entries.length).toBe(0);
  });

  it('已修复：parseContributionPack 把非法 kind 归一成 term → 落盘 kind 合法，写读一致', async () => {
    const pack = parseContributionPack(packWith([
      { wrong: 'coxy', correct: 'Cogseed', kind: 'hyperdimensional', riskLevel: 'low' },
    ]));
    expect(pack).not.toBeNull();
    // F-r1-26 修复后：kind 走与读侧 normalizeKind 同款白名单，不再原样透传。
    expect(pack!.entries[0].kind).toBe('term');

    const result = applyContributionPack(uid, pack!);
    expect(result.added).toBe(1);

    // 盘上 JSON 不再带非法 kind——写读对称，读回不再静默变形。
    expect(fs.readFileSync(userTranscriptGlossaryFile(uid), 'utf8')).not.toContain('"kind": "hyperdimensional"');

    const reloaded = loadGlossary(uid);
    expect(reloaded.entries[0].kind).toBe('term');
  });

  it('已修复：wrong>80 在 parse 层整条跳过，不再绕过上限落盘（bounded 只在 upsertEntry）', async () => {
    const long = 'Z'.repeat(5000);
    const pack = parseContributionPack(packWith([
      { wrong: long, correct: 'Y', kind: 'term', riskLevel: 'low' },
    ]));
    expect(pack!.entries.length).toBe(0); // parse 层长度门：超长整条剔除

    const result = applyContributionPack(uid, pack!);
    expect(result.added).toBe(0);
    expect(loadGlossary(uid).entries.length).toBe(0); // 超限词条不落盘
  });
});
