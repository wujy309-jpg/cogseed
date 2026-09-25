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
import type { CorrectionCandidate } from '../../../src/main/features/transcript_auto_correct';
import {
  MAX_MEETING_ASSET_REFS,
  MeetingRefError,
  attachAssetRefs,
  attachMeetingAsset,
  detachMeetingAsset,
  listMeetingAssetCanonicalNames,
  listMeetingAssetRefs,
  listMeetingAssetRefViews,
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

// ── T027：资产规范名进纠错依据（specs/013 FR-001）──────────────────────────────
describe('T027：资产规范名清单（冻结版）与依据追加', () => {
  /** 最小候选（CorrectionCandidate 关键字段），供 attachAssetRefs 纯函数用例。 */
  function candidate(over: Partial<CorrectionCandidate>): CorrectionCandidate {
    return {
      entryRef: 'g_1', wrong: 'coxy', correct: 'Cogseed', action: 'replace',
      confidence: 1, riskLevel: 'low', context: '', span: { start: 0, end: 4 },
      ignoredCount: 0, contextAllow: [], ...over,
    };
  }

  it('清单：version/title 用挂载时的冻结版（不是当前版）；name 读时取 statement‖title', async () => {
    // 挂载时 v3、无 statement；挂载后资产升版 + 补了 statement
    assets.set('ast_term', assetRecord({ id: 'ast_term', title: '术语资产', version: '3', statement: '' }));
    await attachMeetingAsset(uid, 'kb/m.md', 'ast_term');
    assets.set('ast_term', assetRecord({
      id: 'ast_term', title: '术语资产（新版）', version: '3', activeVersion: '9',
      statement: 'Cogseed 是产品名',
    }));
    const names = await listMeetingAssetCanonicalNames(uid, 'kb/m.md');
    expect(names).toEqual([{
      name: 'Cogseed 是产品名',   // 规范名读时取（引用包不存正文）
      assetId: 'ast_term',
      version: '3',               // 冻结版：挂载时的版本，不是当前 activeVersion '9'
      title: '术语资产',           // 冻结标题快照，不是新标题
    }]);
    // 记录读盘再钉一次：清单不落盘、引用包不因读取而变
    const pack = fs.readFileSync(path.join(userMeetingRefsDir(uid), `${docKeyForDocId('kb/m.md')}.json`), 'utf8');
    expect(pack).toContain('"version": "3"');
    expect(pack).not.toContain('Cogseed 是产品名');   // 规范名（资产正文）不进引用包
  });

  it('清单：资产已删除 → 如实跳过；非 active → 跳过（停用资产不作依据）；无挂载 → 空数组', async () => {
    expect(await listMeetingAssetCanonicalNames(uid, 'kb/none.md')).toEqual([]);
    assets.set('ast_gone', assetRecord({ id: 'ast_gone', title: 'G', version: '1' }));
    await attachMeetingAsset(uid, 'kb/m2.md', 'ast_gone');
    await attachMeetingAsset(uid, 'kb/m2.md', 'ast_cogseed');
    // ast_gone 彻底删除（读不到）→ 跳过；ast_cogseed 归档（非 active）→ 跳过
    assets.delete('ast_gone');
    assets.set('ast_cogseed', assetRecord({ id: 'ast_cogseed', status: 'archived' }));
    expect(await listMeetingAssetCanonicalNames(uid, 'kb/m2.md')).toEqual([]);
  });

  it('attachAssetRefs：候选 correct 折叠命中规范名 → 追加 {source:"asset",…}（version=冻结版）', () => {
    const names = [{ name: 'Cogseed', assetId: 'ast_term', version: '3', title: '术语资产' }];
    const hit = attachAssetRefs([candidate({})], names);
    expect(hit[0].refs).toEqual([{ source: 'asset', assetId: 'ast_term', version: '3', title: '术语资产' }]);
    // 大小写折叠命中（与 attachOntologyRefs 同一套折叠）
    const folded = attachAssetRefs([candidate({ correct: 'cogseed' })], names);
    expect(folded[0].refs?.[0]).toMatchObject({ source: 'asset', assetId: 'ast_term' });
  });

  it('attachAssetRefs：未命中原样返回（同一引用，refs 不动）；同一 assetId 幂等；并列不覆盖既有依据', () => {
    const names = [{ name: 'Cogseed', assetId: 'ast_term', version: '3', title: '术语资产' }];
    const miss = candidate({ correct: '别的写法', refs: [{ source: 'glossary', entryId: 'g_1', kind: 'term', freq: 2 }] });
    expect(attachAssetRefs([miss], names)[0]).toBe(miss);      // 未命中：同一对象原样返回
    const withGlossary = candidate({
      refs: [{ source: 'glossary', entryId: 'g_1', kind: 'term', freq: 2 }],
    });
    const appended = attachAssetRefs([withGlossary], names)[0];
    expect(appended.refs).toHaveLength(2);                      // 追加为并列依据，不覆盖
    expect(attachAssetRefs([appended], names)[0]).toBe(appended); // 同 assetId 已在 → 幂等原样
  });

  it('attachAssetRefs：空清单/空候选 → 零行为', () => {
    const c = candidate({});
    expect(attachAssetRefs([c], [])).toEqual([c]);
    expect(attachAssetRefs([], [{ name: 'x', assetId: 'a', version: '1', title: 't' }])).toEqual([]);
  });
});

// ── T037：读时派生视图 MeetingAssetRefView（specs/013 FR-004「可与现状对比」）──────
describe('T037：MeetingAssetRefView 读时派生（currentVersion/currentTitle/stale/available）', () => {
  it('改资产后 stale===true 且冻结 version/title 逐字未变；currentVersion 与投影同一表达式', async () => {
    await attachMeetingAsset(uid, 'kb/s.md', 'ast_cogseed');      // 挂载时冻结 v3 + 旧标题
    const file = path.join(userMeetingRefsDir(uid), `${docKeyForDocId('kb/s.md')}.json`);
    const before = fs.readFileSync(file, 'utf8');
    // 会后：资产升版（activeVersion 优先）+ 改名
    assets.set('ast_cogseed', assetRecord({ id: 'ast_cogseed', title: 'Cogseed 术语表（改名）', version: '3', activeVersion: '7' }));
    const views = await listMeetingAssetRefViews(uid, 'kb/s.md');
    expect(views).toHaveLength(1);
    const view = views[0];
    expect(view.version).toBe('3');                       // 冻结版逐字未变
    expect(view.title).toBe('Cogseed 术语表');             // 标题快照不变味
    expect(view.currentVersion).toBe('7');                // activeVersion 优先（context-projection.ts:767 同一表达式）
    expect(view.currentTitle).toBe('Cogseed 术语表（改名）');
    expect(view.stale).toBe(true);                        // currentVersion !== version（projection-card.ts:26 同名同义）
    expect(view.available).toBe(true);
    // 读时派生不落库：引用包在盘上逐字节未变
    expect(fs.readFileSync(file, 'utf8')).toBe(before);
  });

  it('版本一致 ⇒ stale===false；activeVersion 缺失回退 version（同一表达式）', async () => {
    assets.set('ast_v5', assetRecord({ id: 'ast_v5', version: '5', activeVersion: undefined }));
    await attachMeetingAsset(uid, 'kb/s2.md', 'ast_v5');
    const [view] = await listMeetingAssetRefViews(uid, 'kb/s2.md');
    expect(view.version).toBe('5');
    expect(view.currentVersion).toBe('5');
    expect(view.stale).toBe(false);
    expect(view.available).toBe(true);
  });

  it('available===false 出现在归档/暂停/删除三态（冻结版不受影响）', async () => {
    // 三态都是**挂载后才发生**的（挂载准入要求 active，T011 ②）——
    // 挂载时冻结 v3，会后资产各自转入归档/暂停/删除。
    assets.set('ast_arch', assetRecord({ id: 'ast_arch' }));
    assets.set('ast_pause', assetRecord({ id: 'ast_pause' }));
    assets.set('ast_del', assetRecord({ id: 'ast_del' }));
    for (const id of ['ast_arch', 'ast_pause', 'ast_del']) {
      await attachMeetingAsset(uid, 'kb/s3.md', id);
    }
    assets.set('ast_arch', assetRecord({ id: 'ast_arch', status: 'archived' }));
    assets.set('ast_pause', assetRecord({ id: 'ast_pause', status: 'paused' }));
    assets.set('ast_del', assetRecord({ id: 'ast_del', status: 'deleted' }));
    const views = await listMeetingAssetRefViews(uid, 'kb/s3.md');
    const byId = new Map(views.map((v) => [v.assetId, v]));
    expect(byId.get('ast_arch')?.available).toBe(false);
    expect(byId.get('ast_pause')?.available).toBe(false);
    expect(byId.get('ast_del')?.available).toBe(false);
    expect(views.every((v) => v.version === '3')).toBe(true);     // 冻结版不被三态改写
  });

  it('资产彻底删除（读不到）⇒ available:false、currentVersion 空串（不假装读到了那一版）', async () => {
    assets.set('ast_gone2', assetRecord({ id: 'ast_gone2', title: '已删资产', version: '2' }));
    await attachMeetingAsset(uid, 'kb/s4.md', 'ast_gone2');
    assets.delete('ast_gone2');                                    // 彻底删除：readAbilityAsset 抛错
    const [view] = await listMeetingAssetRefViews(uid, 'kb/s4.md');
    expect(view.available).toBe(false);
    expect(view.currentVersion).toBe('');                          // 现状未知，不猜一版
    expect(view.currentTitle).toBe('');
    expect(view.stale).toBe(false);                                 // 无漂移证据（不宣称漂移）
    expect(view.version).toBe('2');                                 // 冻结版仍在
    expect(view.title).toBe('已删资产');
  });
});
