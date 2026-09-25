/**
 * meeting_refs — 会议引用包 MeetingAssetPack（specs/013 T011）
 *
 * 钉住三条验收：①冻结版写入后再次 attach 不改版本；②非 active 资产被拒且码化；
 * ③assetRefs 有界 100。另钉：准入用既有判据（evaluateAssetRuntimeEligibility 真实现）、
 * detach 幂等、记录不含资产正文。
 *
 * `readAbilityAsset` 走 mock（读真实 recall 落盘与本模块无关）；
 * `evaluateAssetRuntimeEligibility` 用**真实现**——准入判据不允许第二套。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { readAbilityAsset } from '../../../src/main/features/recall/asset-service';
import type { RecallAbilityAssetRecord } from '../../../src/main/features/recall/candidate-service';
import {
  MAX_MEETING_ASSET_REFS,
  MeetingRefError,
  attachMeetingAsset,
  detachMeetingAsset,
  listMeetingAssetRefs,
  readMeetingAssetPack,
} from '../../../src/main/features/meeting_refs';
import { docKeyForDocId } from '../../../src/main/features/meeting_doc';
import { userMeetingRefsDir } from '../../../src/main/paths';

vi.mock('../../../src/main/features/recall/asset-service', () => ({
  readAbilityAsset: vi.fn(),
}));

const uid = 'u_meeting_refs_test';

/** 最小可用资产记录（结构照 RecallAbilityAssetRecord 的关键字段）：
 *  默认 active + effectiveness_validated（准入全过）。 */
function assetRecord(over: Partial<RecallAbilityAssetRecord> & { id: string }): RecallAbilityAssetRecord {
  return {
    maturity: 'effectiveness_validated',
    lifecycleStatus: 'user_confirmed_unverified',
    status: 'active',
    scope: 'personal',
    type: 'personal',
    title: over.title ?? '默认资产',
    version: '3',
    activeVersion: undefined,
    ...over,
  } as unknown as RecallAbilityAssetRecord;
}

const assets = new Map<string, RecallAbilityAssetRecord>();

beforeEach(() => {
  fs.rmSync(userMeetingRefsDir(uid), { recursive: true, force: true });
  assets.clear();
  assets.set('ast_cogseed', assetRecord({ id: 'ast_cogseed', title: 'Cogseed 术语表', version: '3', activeVersion: undefined }));
  vi.mocked(readAbilityAsset).mockImplementation(async (targetUid: string, assetId: string) => {
    const record = assets.get(assetId);
    if (!record) throw new Error('recall ability asset not found');
    return record;
  });
});

describe('T011 ①：冻结版不变味（SC-004）', () => {
  it('冻结版写入后再次 attach 不改版本，只刷 at/via', async () => {
    const first = await attachMeetingAsset(uid, 'kb/m.md', 'ast_cogseed');
    expect(first.ref).toMatchObject({ assetId: 'ast_cogseed', version: '3', title: 'Cogseed 术语表', type: 'personal', via: 'attach' });
    // 资产在会议后被升版 + 改名
    assets.set('ast_cogseed', assetRecord({ id: 'ast_cogseed', title: 'Cogseed 术语表（新版）', version: '3', activeVersion: '7' }));
    await new Promise((resolve) => setTimeout(resolve, 15));
    const second = await attachMeetingAsset(uid, 'kb/m.md', 'ast_cogseed', 'conclusion');
    expect(second.ref.version).toBe('3');                       // 冻结版逐字未变
    expect(second.ref.title).toBe('Cogseed 术语表');             // 标题快照不变味
    expect(second.ref.via).toBe('conclusion');                   // 只刷 via
    expect(second.ref.at > first.ref.at).toBe(true);             // 只刷 at
    expect(second.pack.assetRefs).toHaveLength(1);               // 不叠条目
  });

  it('版本取值表达式与投影逐字一致：activeVersion ‖ version ‖ \'1\'', async () => {
    assets.set('ast_a', assetRecord({ id: 'ast_a', version: '5', activeVersion: '9' }));
    assets.set('ast_b', assetRecord({ id: 'ast_b', version: '4', activeVersion: undefined }));
    const r1 = await attachMeetingAsset(uid, 'kb/v.md', 'ast_a');
    expect(r1.ref.version).toBe('9');                            // activeVersion 优先
    const r2 = await attachMeetingAsset(uid, 'kb/v.md', 'ast_b');
    expect(r2.ref.version).toBe('4');                            // 回退 version
  });

  it('读盘记录不含资产正文（只有 id/版本/标题/类型/来源/时间）', async () => {
    const record = assetRecord({ id: 'ast_secret', title: 'T', version: '1' });
    (record as unknown as { statement: string }).statement = '这是资产正文 statement，绝不允许进引用包';
    assets.set('ast_secret', record);
    await attachMeetingAsset(uid, 'kb/p.md', 'ast_secret');
    const pack = fs.readFileSync(path.join(userMeetingRefsDir(uid), `${docKeyForDocId('kb/p.md')}.json`), 'utf8');
    expect(pack).toContain('ast_secret');
    expect(pack).not.toContain('statement');
    expect(pack).not.toContain('资产正文');
  });
});

describe('T011 ②：准入拒绝且码化（既有判据，不新写）', () => {
  it('资产不存在 → asset_missing（data）', async () => {
    await expect(attachMeetingAsset(uid, 'kb/m.md', 'ast_none')).rejects.toMatchObject({ code: 'asset_missing' });
    expect(await listMeetingAssetRefs(uid, 'kb/m.md')).toEqual([]);
  });

  it('非 active（归档/暂停）→ asset_inactive，附规则标识', async () => {
    assets.set('ast_archived', assetRecord({ id: 'ast_archived', status: 'archived' }));
    const rejection = await attachMeetingAsset(uid, 'kb/m.md', 'ast_archived').catch((error: MeetingRefError) => error);
    expect(rejection).toBeInstanceOf(MeetingRefError);
    expect(rejection.code).toBe('asset_inactive');
    expect((rejection as MeetingRefError).blockRule).toBe('archived');
  });

  it('既有准入闸拦下的（如 seed 成熟度 never）→ asset_ineligible', async () => {
    assets.set('ast_seed', assetRecord({ id: 'ast_seed', maturity: 'seed' }));
    const rejection = await attachMeetingAsset(uid, 'kb/m.md', 'ast_seed').catch((error: MeetingRefError) => error);
    expect(rejection.code).toBe('asset_ineligible');
    expect((rejection as MeetingRefError).blockRule).toBe('maturity');
  });

  it('形状不合法 → invalid_asset_id / invalid_via / invalid_doc_id（schema）', async () => {
    await expect(attachMeetingAsset(uid, 'kb/m.md', 'bad id!')).rejects.toMatchObject({ code: 'invalid_asset_id' });
    await expect(attachMeetingAsset(uid, 'kb/m.md', 'ast_cogseed', 'wrong' as never)).rejects.toMatchObject({ code: 'invalid_via' });
    await expect(attachMeetingAsset(uid, 'x'.repeat(1001), 'ast_cogseed')).rejects.toMatchObject({ code: 'invalid_doc_id' });
  });
});

describe('T011 ③：assetRefs 有界 100', () => {
  it('第 101 个不同资产被拒（ref_pack_full），既有 100 条不受影响', async () => {
    for (let i = 0; i < MAX_MEETING_ASSET_REFS; i += 1) {
      assets.set(`ast_${i}`, assetRecord({ id: `ast_${i}`, title: `资产${i}`, version: String(i + 1) }));
      await attachMeetingAsset(uid, 'kb/full.md', `ast_${i}`);
    }
    assets.set('ast_overflow', assetRecord({ id: 'ast_overflow' }));
    await expect(attachMeetingAsset(uid, 'kb/full.md', 'ast_overflow')).rejects.toMatchObject({ code: 'ref_pack_full' });
    const pack = await readMeetingAssetPack(uid, 'kb/full.md');
    expect(pack.assetRefs).toHaveLength(MAX_MEETING_ASSET_REFS);
    // 满包后重复 attach 既有资产仍走幂等分支（不触发上限）
    const again = await attachMeetingAsset(uid, 'kb/full.md', 'ast_0');
    expect(again.ref.assetId).toBe('ast_0');
    expect(pack.assetRefs).toHaveLength(MAX_MEETING_ASSET_REFS);
  });
});

describe('detach / list（幂等与只读）', () => {
  it('detach 移除该条；再次 detach 幂等返回，不报错', async () => {
    await attachMeetingAsset(uid, 'kb/m.md', 'ast_cogseed');
    const afterDetach = await detachMeetingAsset(uid, 'kb/m.md', 'ast_cogseed');
    expect(afterDetach.assetRefs).toHaveLength(0);
    const again = await detachMeetingAsset(uid, 'kb/m.md', 'ast_cogseed');
    expect(again.assetRefs).toHaveLength(0);
  });

  it('detach 后可重新 attach（新的冻结版从当下取）', async () => {
    await attachMeetingAsset(uid, 'kb/m.md', 'ast_cogseed');     // 冻结 v3
    await detachMeetingAsset(uid, 'kb/m.md', 'ast_cogseed');
    assets.set('ast_cogseed', assetRecord({ id: 'ast_cogseed', activeVersion: '8' }));
    const re = await attachMeetingAsset(uid, 'kb/m.md', 'ast_cogseed');
    expect(re.ref.version).toBe('8');                            // 重新建立 = 重新冻结
  });

  it('list：包缺失 → 空数组；记录字段只含标识（docId 在包内可逆查询）', async () => {
    expect(await listMeetingAssetRefs(uid, 'kb/none.md')).toEqual([]);
    await attachMeetingAsset(uid, 'kb/m.md', 'ast_cogseed');
    const refs = await listMeetingAssetRefs(uid, 'kb/m.md');
    expect(refs).toHaveLength(1);
    expect(Object.keys(refs[0]).sort()).toEqual(['assetId', 'at', 'title', 'type', 'version', 'via']);
    const pack = await readMeetingAssetPack(uid, 'kb/m.md');
    expect(pack.docId).toBe('kb/m.md');
    expect(pack.schemaVersion).toBe(1);
  });

  it('引用包与词表同域（cloud 的 transcript/meeting-refs/，T009）', async () => {
    await attachMeetingAsset(uid, 'kb/m.md', 'ast_cogseed');
    const dir = userMeetingRefsDir(uid);
    expect(dir).toContain(path.join('cloud', 'cogseed', 'transcript'));
    expect(dir.endsWith('meeting-refs')).toBe(true);
    expect(fs.readdirSync(dir)).toHaveLength(1);
  });
});
