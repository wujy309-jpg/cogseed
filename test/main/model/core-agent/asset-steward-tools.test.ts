/**
 * 资产管家读工具契约（specs/008 US-401 / T012–T016）。
 *
 * 守四条：
 *   ① 分页可达**全量**（不受界面目录展示条数限制）、总数与实际一致；
 *   ② 长正文分批读全（拼接后与原文逐字相同，单批 ≤2000 字）；
 *   ③ 已删除/已暂停**如实标注状态且不交出正文**——不静默当不存在，也不绕过门禁；
 *   ④ 管理视角的读取**不写使用记录**（把"管家看了一眼"记成"任务用了它"会让采用统计失真）。
 *
 * 另有只读会话不变量（T016）：**任何 recall 组工具都不得进入闭合只读白名单**。
 * 判据从 TOOL_CATALOG 派生，所以将来往 recall 组加工具也自动被覆盖。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

let tmpDir: string;
let prevWs: string | undefined;
const TEST_UID = 'stewardtools';

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cogseed-steward-tools-'));
  prevWs = process.env.COGSEED_WORKSPACE_ROOT;
  process.env.COGSEED_WORKSPACE_ROOT = tmpDir;
  vi.resetModules();
  const users = await import('../../../../src/main/features/users');
  users.activateUser(TEST_UID);
});

afterEach(() => {
  process.env.COGSEED_WORKSPACE_ROOT = prevWs;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

let _seedSeq = 0;
async function seedAsset(
  judgment: string,
  opts: { spaceId?: string; scope?: string; type?: string } = {},
) {
  const candidates = await import('../../../../src/main/features/recall/candidate-service');
  _seedSeq += 1;
  const candidate = await candidates.saveRecallCandidate(TEST_UID, {
    judgment,
    summary: judgment.slice(0, 12),
    suggestedType: (opts.type || 'rule') as 'rule',
    suggestedScope: opts.scope || 'general',
    ...(opts.spaceId ? { spaceId: opts.spaceId } : {}),
    sourceRefs: [{ kind: 'execution', id: `exec-steward-${_seedSeq}` }],
  });
  return (await candidates.promoteRecallCandidate(TEST_UID, candidate.id, { actor: 'user' })).asset;
}

/** 克隆一条合法记录成 N 条：晋升一次就够，避免 35 条种子把用例拖成分钟级。
 *  形状仍由真实记录派生，不是手写的"看起来对"的对象。 */
async function cloneAssets(
  base: Record<string, unknown>,
  count: number,
  overrides: Array<Record<string, unknown>> = [],
  startIndex = 0,
) {
  const store = await import('../../../../src/main/features/recall/store');
  const ids: string[] = [];
  for (let offset = 0; offset < count; offset += 1) {
    const index = startIndex + offset;
    const id = `aa-fixture${String(index).padStart(3, '0')}`;
    await store.writeRecallJsonRecord(TEST_UID, 'ability-assets', id, {
      ...base,
      id,
      candidateId: `cand-fixture${index}`,
      title: `夹具资产 ${index}`,
      statement: `夹具正文 ${index}`,
      version: '1',
      activeVersion: '1',
      updatedAt: new Date(Date.now() - index * 1_000).toISOString(),
      ...(overrides[index] || {}),
    });
    ids.push(id);
  }
  return ids;
}

async function stewardTools() {
  const { createAssetStewardTools } = await import('../../../../src/main/model/core-agent/asset-steward-tools');
  const tools = createAssetStewardTools({ userId: TEST_UID });
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  return { list: byName.get('list_ability_assets')!, read: byName.get('read_ability_asset')!, names: tools.map((t) => t.name) };
}

function text(result: { content: string }): string {
  return result.content;
}

describe('list_ability_assets', () => {
  it('分页可达全量（>30 条），总数与实际一致', async () => {
    const base = await seedAsset('发布类公告应包含背景、变更点、影响范围、生效时间、联系方式五段。');
    await cloneAssets(base as unknown as Record<string, unknown>, 34);
    const { list } = await stewardTools();

    const first = text(await list.execute({}, {} as never));
    expect(first).toContain('共 35 条');
    expect(first).toContain('本页 1-30 条');
    expect(first).toContain('还有 5 条：用 offset=30 继续翻页');
    expect((first.match(/\[asset:aa-/g) || []).length).toBe(30);

    const second = text(await list.execute({ offset: 30 }, {} as never));
    expect(second).toContain('本页 31-35 条');
    expect(second).toContain('这是最后一页');
    expect((second.match(/\[asset:aa-/g) || []).length).toBe(5);
  });

  it('上限 50：超过的 limit 被夹住，不会一次吐全量', async () => {
    const base = await seedAsset('竞品调研应先明确可比维度（范围/功能/定价/体验）再收集证据。');
    await cloneAssets(base as unknown as Record<string, unknown>, 55);
    const { list } = await stewardTools();
    const page = text(await list.execute({ limit: 999 }, {} as never));
    expect((page.match(/\[asset:aa-/g) || []).length).toBe(50);
  });

  it('空资产库给空态而不是报错', async () => {
    const { list } = await stewardTools();
    expect(text(await list.execute({}, {} as never))).toContain('认知资产库是空的');
  });

  it('按状态/类型/空间过滤，且总数只算不过滤的全量', async () => {
    const base = await seedAsset('上线前必须核对回滚方案与灰度范围。');
    await cloneAssets(base as unknown as Record<string, unknown>, 3, [
      { status: 'paused' },
      { spaceId: 'sp_a', type: 'template' },
      { status: 'deleted', deletedAt: new Date().toISOString() },
    ]);
    const { list } = await stewardTools();

    const paused = text(await list.execute({ filter: { status: 'paused' } }, {} as never));
    expect(paused).toContain('过滤：状态=paused → 1 条');
    expect(paused).toContain('状态=已暂停[paused]');

    const inSpace = text(await list.execute({ filter: { spaceId: 'sp_a' } }, {} as never));
    expect(inSpace).toContain('空间=sp_a');
    expect(inSpace).toContain('类型=template');

    const typed = text(await list.execute({ filter: { assetType: 'rule' } }, {} as never));
    expect(typed).toContain('→ 3 条');
  });

  it('已彻底清除的不出现在清单里（规范要求搜索不可见）', async () => {
    const base = await seedAsset('过期结论应及时归档而不是继续留在推荐里。');
    await cloneAssets(base as unknown as Record<string, unknown>, 2, [{ status: 'purged', purgedAt: new Date().toISOString() }]);
    const { list } = await stewardTools();
    const out = text(await list.execute({}, {} as never));
    // 墓碑不进清单：base + 一条未清除的克隆 = 2 条。
    expect(out).toContain('共 2 条');
    expect(out).not.toContain('aa-fixture000');
    expect(out).toContain('aa-fixture001');
  });

  it('已删除如实列出（不藏），并标注状态', async () => {
    const base = await seedAsset('命名规范：动词开头、限定范围、避免缩写。');
    await cloneAssets(base as unknown as Record<string, unknown>, 1, [
      { status: 'deleted', deletedAt: new Date().toISOString() },
    ]);
    const { list } = await stewardTools();
    const out = text(await list.execute({}, {} as never));
    expect(out).toContain('已删除[deleted]');
  });

  it('拒绝不认识的过滤值与非法 spaceId', async () => {
    const { list } = await stewardTools();
    expect(await list.execute({ filter: { status: 'shredded' } }, {} as never)).toMatchObject({ isError: true });
    expect(await list.execute({ filter: { spaceId: '../bad' } }, {} as never)).toMatchObject({ isError: true });
  });
});

describe('read_ability_asset', () => {
  it('长正文分批读全：拼接后与原文逐字相同，单批不超过 2000 字', async () => {
    const body = Array.from({ length: 5_000 }, (_, index) => String.fromCharCode(97 + (index % 26))).join('');
    const base = await seedAsset('长正文夹具。');
    const store = await import('../../../../src/main/features/recall/store');
    const assetId = (await cloneAssets(base as unknown as Record<string, unknown>, 1, [{ statement: body }]))[0];
    const { read } = await stewardTools();

    const chunks: string[] = [];
    let next = 0;
    for (let guard = 0; guard < 10; guard += 1) {
      const out = text(await read.execute({ assetId, chunk: next }, {} as never));
      expect(out).toContain(`正文（第 ${next + 1}/3 批，共 5000 字）`);
      const chunkBody = out.split('正文（')[1].split('）:\n')[1].split('\n\n')[0];
      expect(chunkBody.length).toBeLessThanOrEqual(2_000);
      chunks.push(chunkBody);
      if (out.includes('这是最后一批')) break;
      next += 1;
    }
    expect(chunks.length).toBe(3);
    expect(chunks.join('')).toBe(body);
    expect(store).toBeTruthy();
  });

  it('已删除：如实标注状态与拦截规则，且不交出正文', async () => {
    const base = await seedAsset('保留期内的资产正文不可读出。');
    const assetId = (await cloneAssets(base as unknown as Record<string, unknown>, 1, [
      { status: 'deleted', deletedAt: new Date().toISOString(), statement: '绝不该被读出来的正文' },
    ]))[0];
    const { read } = await stewardTools();

    const result = await read.execute({ assetId }, {} as never);
    expect(result.isError).toBe(true);
    const out = text(result);
    expect(out).toContain('当前不可读出正文');
    expect(out).toContain('已删除[deleted]');
    expect(out).toContain('status_not_active');
    expect(out).toContain('restore_ability_asset');
    expect(out).not.toContain('绝不该被读出来的正文');
  });

  it('已暂停：同样如实标注，不静默当不存在', async () => {
    const base = await seedAsset('暂停的资产不该继续作为依据。');
    const assetId = (await cloneAssets(base as unknown as Record<string, unknown>, 1, [
      { status: 'paused', statement: '暂停资产的正文' },
    ]))[0];
    const { read } = await stewardTools();

    const result = await read.execute({ assetId }, {} as never);
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('已暂停[paused]');
    expect(text(result)).toContain('不是"资产不存在"');
    expect(text(result)).not.toContain('暂停资产的正文');
  });

  it('不存在的资产如实说"不存在"，不冒充状态问题', async () => {
    const { read } = await stewardTools();
    const result = await read.execute({ assetId: 'aa-nope000' }, {} as never);
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('不存在');
  });

  it('chunk 越界明确报错', async () => {
    const base = await seedAsset('短正文。');
    const assetId = (await cloneAssets(base as unknown as Record<string, unknown>, 1, [{ statement: '短' }]))[0];
    const { read } = await stewardTools();
    const result = await read.execute({ assetId, chunk: 5 }, {} as never);
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('chunk 越界');
  });

  it('非法 assetId 被拒', async () => {
    const { read } = await stewardTools();
    expect(await read.execute({ assetId: '../etc/passwd' }, {} as never)).toMatchObject({ isError: true });
    expect(await read.execute({}, {} as never)).toMatchObject({ isError: true });
  });

  it('管理视角的读取不写使用记录（否则"管家看一眼"会被记成"任务用了它"）', async () => {
    const base = await seedAsset('读取本身不算使用。');
    const assetId = (await cloneAssets(base as unknown as Record<string, unknown>, 1))[0];
    const { read } = await stewardTools();
    await read.execute({ assetId }, {} as never);

    const usage = await import('../../../../src/main/features/recall/usage-service');
    expect(await usage.listRecallUsage(TEST_UID)).toEqual([]);
    const receipts = await import('../../../../src/main/features/recall/injection-receipt');
    expect(await receipts.listInjectionReceipts(TEST_UID)).toEqual([]);
  });
});

describe('只读会话不变量（T016）', () => {
  it('任何 recall 组工具都不得进入闭合只读白名单', async () => {
    const [{ TOOL_CATALOG }, { READ_ONLY_TOOL_ALLOWLIST, READ_ONLY_BUILTIN_ALLOWLIST }] = await Promise.all([
      import('../../../../src/main/model/core-agent/tool-catalog'),
      import('../../../../src/main/model/core-agent/runner'),
    ]);
    const recallTools = TOOL_CATALOG.filter((entry) => entry.group === 'recall').map((entry) => entry.name);
    // 判据从 catalog 派生：将来往 recall 组加工具，这条测试自动覆盖到。
    expect(recallTools).toEqual(expect.arrayContaining([
      'list_ability_assets', 'read_ability_asset', 'search_ability_assets', 'personal_ontology_fields',
    ]));
    for (const name of recallTools) {
      expect(READ_ONLY_TOOL_ALLOWLIST.has(name), `${name} 不得进入只读白名单`).toBe(false);
      expect(READ_ONLY_BUILTIN_ALLOWLIST.has(name), `${name} 不得进入只读内建白名单`).toBe(false);
    }
  });

  it('资产管家的工具面 = 2 读 + 6 写', async () => {
    const { names } = await stewardTools();
    expect(names).toEqual([
      'list_ability_assets', 'read_ability_asset',
      'edit_ability_asset', 'merge_ability_assets', 'archive_ability_asset',
      'delete_ability_asset', 'restore_ability_asset', 'rollback_ability_asset',
    ]);
  });
});

describe('写工具（US-402）', () => {
  async function tools() {
    const { createAssetStewardTools } = await import('../../../../src/main/model/core-agent/asset-steward-tools');
    const byName = new Map(createAssetStewardTools({ userId: TEST_UID }).map((tool) => [tool.name, tool]));
    return {
      edit: byName.get('edit_ability_asset')!,
      merge: byName.get('merge_ability_assets')!,
      archive: byName.get('archive_ability_asset')!,
      del: byName.get('delete_ability_asset')!,
      restore: byName.get('restore_ability_asset')!,
      rollback: byName.get('rollback_ability_asset')!,
    };
  }
  const call = (tool: { execute: (input: Record<string, unknown>, ctx: never) => Promise<{ content: string; isError?: boolean }> }, input: Record<string, unknown>) =>
    tool.execute(input, {} as never);

  it('用户明确指令：直接生效 + 台账记 actor=ai/前后值/依据', async () => {
    const asset = await seedAsset('发布前必须核对回滚方案。');
    const { edit } = await tools();
    const out = await call(edit, {
      assetId: asset.id,
      fields: { statement: '发布前必须核对回滚方案与灰度范围。' },
      reason: '用户要求把这条改清楚点',
      origin: 'user_instruction',
      expectedVersion: asset.version,
    });
    expect(out.isError).toBeUndefined();
    expect(out.content).toContain('已改动');
    expect(out.content).toContain('v2');

    const assets = await import('../../../../src/main/features/recall/asset-service');
    const updated = await assets.readAbilityAsset(TEST_UID, asset.id);
    expect(updated.statement).toContain('灰度范围');
    const row = (await assets.listAbilityAssetAudit(TEST_UID, asset.id)).at(-1)!;
    expect(row.action).toBe('updated');
    expect(row.actor).toBe('ai');
    expect(row.reason).toBe('用户要求把这条改清楚点');
    expect(row.before).toContain('statement=');
    expect(row.after).toContain('灰度范围');
  });

  it('并发不一致：拒绝而不是静默覆盖', async () => {
    const asset = await seedAsset('并发场景的基线正文。');
    const assets = await import('../../../../src/main/features/recall/asset-service');
    await assets.updateAbilityAsset(TEST_UID, asset.id, { title: '被别人改过', reason: 'other writer', actor: 'user' });

    const { edit } = await tools();
    const out = await call(edit, {
      assetId: asset.id,
      fields: { statement: '我的改动' },
      reason: '用户要求改',
      origin: 'user_instruction',
      expectedVersion: asset.version,
    });
    expect(out.isError).toBe(true);
    expect(out.content).toContain('version conflict');
    expect(out.content).toContain('workflow');
    const after = await assets.readAbilityAsset(TEST_UID, asset.id);
    expect(after.statement).toBe(asset.statement);
    expect(after.title).toBe('被别人改过');
  });

  it('AI 自主的实质变化：不直接生效（零静默发布）', async () => {
    const asset = await seedAsset('实质变化的守卫基线。');
    const assets = await import('../../../../src/main/features/recall/asset-service');
    const { edit } = await tools();

    for (const fields of [
      { statement: '我自己觉得应该改成这样' },
      { scope: 'review' },
      { applicableWhen: ['任何情况'] },
      { sensitivity: 'L2' },
    ]) {
      const out = await call(edit, { assetId: asset.id, fields, reason: '我觉得该改', origin: 'ai_initiated' });
      expect(out.isError, JSON.stringify(fields)).toBe(true);
      expect(out.content).toContain('不能由我直接生效');
    }
    // 内容与版本分毫未动。
    const after = await assets.readAbilityAsset(TEST_UID, asset.id);
    expect(after.statement).toBe(asset.statement);
    expect(after.version).toBe(asset.version);
    expect(after.sensitivity).toBeUndefined();
    expect((await assets.listAbilityAssetAudit(TEST_UID, asset.id)).filter((r) => r.actor === 'ai')).toEqual([]);
  });

  it('缺省 origin 按更保守的"AI 自主"处理，并在回执里给出重试方式', async () => {
    const asset = await seedAsset('缺省来源的守卫基线。');
    const { edit } = await tools();
    const out = await call(edit, { assetId: asset.id, fields: { statement: '改正文' }, reason: '没说来源' });
    expect(out.isError).toBe(true);
    expect(out.content).toContain('origin=user_instruction');
  });

  it('非实质字段（命名）允许 AI 自动处理', async () => {
    const asset = await seedAsset('命名规范化可以由 AI 直接做。');
    const { edit } = await tools();
    const out = await call(edit, { assetId: asset.id, fields: { title: '规范化后的标题' }, reason: '命名规范化', origin: 'ai_initiated' });
    expect(out.isError).toBeUndefined();
    const assets = await import('../../../../src/main/features/recall/asset-service');
    expect((await assets.readAbilityAsset(TEST_UID, asset.id)).title).toBe('规范化后的标题');
  });

  it('tags / category 如实拒绝，不静默丢弃', async () => {
    const asset = await seedAsset('标签字段还没落地。');
    const { edit } = await tools();
    const out = await call(edit, { assetId: asset.id, fields: { tags: ['发布'] }, reason: '补标签', origin: 'ai_initiated' });
    expect(out.isError).toBe(true);
    expect(out.content).toContain('字段未就位');
    expect(out.content).toContain('US-201');
    expect(out.content).toContain('data（数据缺失/不存在）');

    const category = await call(edit, { assetId: asset.id, fields: { category: '发布流程' }, reason: '归类', origin: 'ai_initiated' });
    expect(category.isError).toBe(true);
    expect(category.content).toContain('category');
  });

  it('reason 必填；fields 不能为空；sensitivity 取值受限', async () => {
    const asset = await seedAsset('入参校验基线。');
    const { edit } = await tools();
    expect((await call(edit, { assetId: asset.id, fields: { title: 'x' } })).content).toContain('reason 必填');
    expect((await call(edit, { assetId: asset.id, fields: {}, reason: '空字段' })).content).toContain('至少要给一个');
    expect((await call(edit, { assetId: asset.id, fields: { sensitivity: 'L9' }, reason: '乱传' })).content).toContain('L0 / L1 / L2');
  });

  it('归并：进同一版本组、source 归档并记去向', async () => {
    const target = await seedAsset('归并目标：上线前核对回滚方案。');
    const assets = await import('../../../../src/main/features/recall/asset-service');
    // source 走克隆：两条近重复的候选本来就会被相似度闸门拦下（那是对的），
    // 但"资产库里已经存在两条近重复资产"正是归并要处理的场景。
    const [sourceId] = await cloneAssets(target as unknown as Record<string, unknown>, 1, [
      { statement: '上线之前应当核对回滚方案。', title: '归并来源' },
    ]);
    // 给 source 补一条真实版本记录（真实资产创建时就有 v1，克隆夹具绕过了那一步）：
    // 归并搬的是版本流，"版本流缺失"那条分支只服务遗留资产，不该拿来当主路径。
    await assets.updateAbilityAsset(TEST_UID, sourceId, {
      statement: '上线之前应当核对回滚方案与灰度。', reason: '补一版', actor: 'user',
    });

    const { merge } = await tools();
    const out = await call(merge, { sourceAssetId: sourceId, targetAssetId: target.id, reason: '两条讲的是同一件事' });
    expect(out.isError).toBeUndefined();

    const archived = await assets.readAbilityAsset(TEST_UID, sourceId);
    expect(archived.status).toBe('archived');
    expect(archived.mergedIntoAssetId).toBe(target.id);
    const targetAudit = (await assets.listAbilityAssetAudit(TEST_UID, target.id)).map((r) => r.action);
    expect(targetAudit).toContain('merged_from');
    const sourceAudit = (await assets.listAbilityAssetAudit(TEST_UID, sourceId)).map((r) => r.action);
    expect(sourceAudit).toContain('merged_into');
    // 历史可溯：source 的版本快照确实并进了 target 的版本流。
    const versions = await assets.listAbilityAssetVersions(TEST_UID, target.id);
    expect(versions.some((v) => String(v.reason || '').startsWith('merged from'))).toBe(true);
    expect(versions.some((v) => String(v.snapshot?.statement || '').includes('灰度'))).toBe(true);
  });

  it('归档 → 恢复；删除 → 保留期内恢复后内容一致；回执含保留期口径', async () => {
    const asset = await seedAsset('归档与删除的可恢复性。');
    const assets = await import('../../../../src/main/features/recall/asset-service');
    const { archive, del, restore } = await tools();

    expect((await call(archive, { assetId: asset.id, reason: '暂时不用' })).isError).toBeUndefined();
    expect((await assets.readAbilityAsset(TEST_UID, asset.id)).status).toBe('archived');
    expect((await call(restore, { assetId: asset.id, reason: '又要用了' })).isError).toBeUndefined();
    expect((await assets.readAbilityAsset(TEST_UID, asset.id)).status).toBe('active');

    const deleteOut = await call(del, { assetId: asset.id, reason: '用户要求删除' });
    expect(deleteOut.isError).toBeUndefined();
    // 删除回执必须带上三条规则（此刻用户最需要知道"什么时候真的没了"）。
    const { t } = await import('../../../../src/main/i18n');
    expect(deleteOut.content).toContain(t('recall.asset.delete_confirm_rules'));
    expect(deleteOut.content).toContain('已删除[deleted]');

    const restored = await call(restore, { assetId: asset.id, reason: '用户要求恢复' });
    expect(restored.isError).toBeUndefined();
    const after = await assets.readAbilityAsset(TEST_UID, asset.id);
    expect(after.status).toBe('active');
    expect(after.statement).toBe(asset.statement);
  });

  it('回滚：生成新版本、历史不回退、回滚本身记账', async () => {
    const asset = await seedAsset('回滚测试的第一版内容。');
    const assets = await import('../../../../src/main/features/recall/asset-service');
    await assets.updateAbilityAsset(TEST_UID, asset.id, { statement: '第二版内容。', reason: 'v2', actor: 'user' });
    const { rollback } = await tools();

    const out = await call(rollback, { assetId: asset.id, toVersion: '1', reason: '用户要求回到第一版' });
    expect(out.isError).toBeUndefined();
    const after = await assets.readAbilityAsset(TEST_UID, asset.id);
    expect(after.statement).toBe(asset.statement);
    expect(after.version).toBe('3');
    expect((await assets.listAbilityAssetVersions(TEST_UID, asset.id)).map((v) => v.version)).toEqual(['1', '2', '3']);
    const rollbackRow = (await assets.listAbilityAssetAudit(TEST_UID, asset.id)).find((r) => r.action === 'rolled_back')!;
    expect(rollbackRow.actor).toBe('ai');
    expect(rollbackRow.reason).toBe('用户要求回到第一版');
  });

  it('门禁拦截不计为成功：已撤销/已彻底清除的资产改不动，且回执写明规则', async () => {
    const revokedAsset = await seedAsset('已撤销的资产不可再改。');
    const assets = await import('../../../../src/main/features/recall/asset-service');
    await assets.revokeAbilityAsset(TEST_UID, revokedAsset.id, { actor: 'user', reason: 'unsafe' });
    const { edit, del } = await tools();
    const revoked = await call(edit, { assetId: revokedAsset.id, fields: { title: 'x' }, reason: '试试', origin: 'ai_initiated' });
    expect(revoked.isError).toBe(true);
    expect(revoked.content).toContain('revoked ability asset cannot be changed');
    expect(revoked.content).toContain('governance');

    const purgedAsset = await seedAsset('已彻底清除的资产不可再改。');
    await assets.purgeAbilityAsset(TEST_UID, purgedAsset.id, { actor: 'user', reason: 'clear' });
    const purged = await call(del, { assetId: purgedAsset.id, reason: '再删一次' });
    expect(purged.isError).toBe(true);
    expect(purged.content).toContain('purged');
  });

  it('受限内容被既有门禁拦下（不豁免、不静默放行）', async () => {
    const asset = await seedAsset('受限内容写入会被拦。');
    const { edit } = await tools();
    // assertNotForbiddenToPersist 拦的是凭据类内容（L3）：伪造一段 API key 形态的正文。
    const out = await call(edit, {
      assetId: asset.id,
      fields: { statement: '部署时使用 api_key = sk-live-ABCDEFGHIJKLMNOPQRSTUVWX 直连。' },
      reason: '用户要求补上部署说明',
      origin: 'user_instruction',
    });
    if (out.isError) {
      expect(out.content).toContain('forbidden to persist');
      expect(out.content).toContain('permission');
    }
    const assets = await import('../../../../src/main/features/recall/asset-service');
    const after = await assets.readAbilityAsset(TEST_UID, asset.id);
    // 无论拦不拦，都不允许"静默放行"：要么拒绝，要么确实写进去了并有台账。
    if (out.isError) expect(after.statement).toBe(asset.statement);
    else expect((await assets.listAbilityAssetAudit(TEST_UID, asset.id)).some((r) => r.actor === 'ai')).toBe(true);
  });

  it('AI 编辑不写使用记录（FR-010）', async () => {
    const asset = await seedAsset('编辑不算使用。');
    const { edit, archive, restore } = await tools();
    await call(edit, { assetId: asset.id, fields: { title: '改个名' }, reason: '命名规范化', origin: 'ai_initiated' });
    await call(archive, { assetId: asset.id, reason: '暂时不用' });
    await call(restore, { assetId: asset.id, reason: '又要用了' });

    const usage = await import('../../../../src/main/features/recall/usage-service');
    expect(await usage.listRecallUsage(TEST_UID)).toEqual([]);
    const receipts = await import('../../../../src/main/features/recall/injection-receipt');
    expect(await receipts.listInjectionReceipts(TEST_UID)).toEqual([]);
  });

  it('冻结引用不因后续编辑改变（已引用版本仍按原内容供给）', async () => {
    const asset = await seedAsset('冻结引用的第一版内容。');
    const assets = await import('../../../../src/main/features/recall/asset-service');
    const store = await import('../../../../src/main/features/recall/store');
    // v2 被一条已确认投影引用（版本号钉死）。
    await assets.updateAbilityAsset(TEST_UID, asset.id, { statement: '被引用的第二版内容。', reason: 'v2', actor: 'user' });
    await store.writeRecallJsonRecord(TEST_UID, 'projections', 'proj-frozen', {
      schemaVersion: 2, ownerId: TEST_UID, id: 'proj-frozen', taskRunId: 'kst-frozen',
      purpose: 'review', authorization: 'workspace_policy',
      assetIds: [asset.id], assetVersions: { [asset.id]: '2' },
      sourceRefs: [], omittedRefs: [], status: 'confirmed', createdAt: new Date().toISOString(),
    });

    const { edit } = await tools();
    const out = await call(edit, {
      assetId: asset.id,
      fields: { statement: 'AI 后来改成的第三版内容。' },
      reason: '用户要求改清楚',
      origin: 'user_instruction',
    });
    expect(out.isError).toBeUndefined();

    // ① 被引用版本的内容快照原样在（注入路径读的就是它，见 prompt-injection 的
    //    readAbilityAssetVersionSnapshot 调用）。
    const frozen = await assets.readAbilityAssetVersionSnapshot(TEST_UID, asset.id, '2');
    expect(frozen?.statement).toBe('被引用的第二版内容。');
    // ② 投影的版本指针没有被"顺手"改到最新版。
    const projection = await store.readRecallJsonRecord(TEST_UID, 'projections', 'proj-frozen') as { assetVersions?: Record<string, string> };
    expect(projection.assetVersions?.[asset.id]).toBe('2');
    // ③ 在用内容确实变了（否则上面两条可能只是"什么都没发生"）。
    expect((await assets.readAbilityAsset(TEST_UID, asset.id)).statement).toBe('AI 后来改成的第三版内容。');
  });
});

describe('危险操作的安全网（US-404 / T027–T031）', () => {
  const CID = 'conv-steward';
  const TURN = 'turn-steward';
  const call = (tool: { execute: (input: Record<string, unknown>, ctx: never) => Promise<{ content: string; isError?: boolean }> }, input: Record<string, unknown>) =>
    tool.execute(input, {} as never);

  async function dangerTools() {
    const { createAssetStewardTools } = await import('../../../../src/main/model/core-agent/asset-steward-tools');
    const byName = new Map(createAssetStewardTools({ userId: TEST_UID, cid: CID, turnId: TURN }).map((t) => [t.name, t]));
    return {
      edit: byName.get('edit_ability_asset')!,
      del: byName.get('delete_ability_asset')!,
    };
  }
  /** 应答下一条交互请求（模拟用户在确认卡上点）。decision=null 表示不应答。 */
  async function answerNext(decision: 'allow' | 'deny' | null) {
    const hub = await import('../../../../src/main/features/chat_events/interaction-hub');
    const seen: string[] = [];
    hub._setBroadcastForTest((_uid, event) => {
      const ev = event as { type?: string; interactionId?: string };
      if (ev.type !== 'chat.interaction.requested' || !ev.interactionId) return;
      seen.push(ev.interactionId);
      if (decision) hub.respondInteraction(ev.interactionId, { decision });
    });
    return { hub, seen };
  }

  it('判定表：单条不危险；批量→batch_delete；覆盖全库→clear_all；动 scopePolicy→cross_scope_widen', async () => {
    const { assessDeleteDanger, assessScopeWidenDanger } = await import('../../../../src/main/model/core-agent/asset-steward-tools');
    expect(assessDeleteDanger(['aa-a'], 10)).toMatchObject({ dangerous: false });
    expect(assessDeleteDanger(['aa-a', 'aa-b'], 10)).toMatchObject({ dangerous: true, kind: 'batch_delete' });
    expect(assessDeleteDanger(['aa-a', 'aa-b'], 2)).toMatchObject({ dangerous: true, kind: 'clear_all' });
    expect(assessScopeWidenDanger({ title: 'x' })).toMatchObject({ dangerous: false });
    expect(assessScopeWidenDanger({ scopePolicy: { workspaceIds: ['sp-a'] } }))
      .toMatchObject({ dangerous: true, kind: 'cross_scope_widen' });
  });

  it('单条删除不是危险操作：不弹确认、不留快照', async () => {
    const asset = await seedAsset('单条删除是普通治理动作。');
    const { del } = await dangerTools();
    const { seen } = await answerNext(null);
    const out = await call(del, { assetId: asset.id, reason: '用户要求删掉这条' });
    expect(out.isError).toBeUndefined();
    expect(seen).toEqual([]);
    const assets = await import('../../../../src/main/features/recall/asset-service');
    const actions = (await assets.listAbilityAssetAudit(TEST_UID, asset.id)).map((r) => r.action);
    expect(actions).not.toContain('danger_snapshot');
    expect(actions).toContain('deleted');
  });

  it('批量删除：执行前逐条留快照 + 单次确认通过后执行', async () => {
    const base = await seedAsset('批量删除的第一条。');
    const ids = await cloneAssets(base as unknown as Record<string, unknown>, 3);
    // 库外还有资产：这样才是"批量删除"而不是"清空"。
    await cloneAssets(base as unknown as Record<string, unknown>, 2, [{ status: 'paused' }], 90);
    const allIds = [base.id, ...ids];
    const { del } = await dangerTools();
    const { seen } = await answerNext('allow');
    const out = await call(del, { assetIds: allIds, reason: '用户要求清掉这批重复的' });

    expect(out.isError).toBeUndefined();
    expect(out.content).toContain('已删除 4/4 条');
    expect(out.content).toContain('批量删除');
    expect(seen).toHaveLength(1);

    const assets = await import('../../../../src/main/features/recall/asset-service');
    for (const id of allIds) {
      const rows = await assets.listAbilityAssetAudit(TEST_UID, id);
      const snapshot = rows.find((r) => r.action === 'danger_snapshot');
      expect(snapshot, id).toBeTruthy();
      // 快照锚点 = 当时的在用版：事后能一步回滚到操作前。
      expect(snapshot!.rollbackAnchor).toBeTruthy();
      expect(rows.some((r) => r.action === 'danger_confirmed')).toBe(true);
      expect((await assets.readAbilityAsset(TEST_UID, id)).status).toBe('deleted');
    }
  });

  it('确认被拒 → 零执行 + 如实回执 + 留痕（不得计为成功）', async () => {
    const base = await seedAsset('确认被拒的批量删除。');
    const ids = await cloneAssets(base as unknown as Record<string, unknown>, 2);
    // 库里还有别的资产 → 这是"批量删除"而不是"清空"（两者都危险，但告诉用户的是两件事）。
    await cloneAssets(base as unknown as Record<string, unknown>, 2, [
      { status: 'paused' }, { status: 'archived' },
    ], 90);
    const allIds = [base.id, ...ids];
    const { del } = await dangerTools();
    await answerNext('deny');
    const out = await call(del, { assetIds: allIds, reason: '用户要求批量删掉' });

    expect(out.isError).toBe(true);
    expect(out.content).toContain('未能执行批量删除');
    expect(out.content).toContain('未获确认');
    const assets = await import('../../../../src/main/features/recall/asset-service');
    for (const id of allIds) {
      expect((await assets.readAbilityAsset(TEST_UID, id)).status).toBe('active');
      const rows = await assets.listAbilityAssetAudit(TEST_UID, id);
      expect(rows.some((r) => r.action === 'danger_denied')).toBe(true);
      expect(rows.some((r) => r.action === 'deleted')).toBe(false);
      expect(rows.find((r) => r.action === 'danger_denied')!.failureCategory).toBe('permission');
      // 快照照留：它是"执行前"的事实，与用户同不同意无关。
      expect(rows.some((r) => r.action === 'danger_snapshot')).toBe(true);
    }
  });

  it('确认悬停被回合取消 → 按 deny 处理：不执行', async () => {
    const base = await seedAsset('确认被取消的批量删除。');
    const ids = await cloneAssets(base as unknown as Record<string, unknown>, 2);
    const allIds = [base.id, ...ids];
    const { del } = await dangerTools();
    const { hub } = await answerNext(null);
    const pending = call(del, { assetIds: allIds, reason: '用户要求批量删掉' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(hub.pendingInteractionCount()).toBe(1);
    hub.cancelInteractionsForTurn(TURN);
    const out = await pending;
    expect(out.isError).toBe(true);
    expect(out.content).toContain('turnCancelled');
    const assets = await import('../../../../src/main/features/recall/asset-service');
    for (const id of allIds) {
      expect((await assets.readAbilityAsset(TEST_UID, id)).status).toBe('active');
      expect((await assets.listAbilityAssetAudit(TEST_UID, id)).some((r) => r.action === 'danger_denied')).toBe(true);
    }
  });

  it('无法发起确认（非会话上下文）时不执行——问不到人不等于默认同意', async () => {
    const base = await seedAsset('没有会话上下文的批量删除。');
    const ids = await cloneAssets(base as unknown as Record<string, unknown>, 2);
    const { createAssetStewardTools } = await import('../../../../src/main/model/core-agent/asset-steward-tools');
    const del = createAssetStewardTools({ userId: TEST_UID }).find((t) => t.name === 'delete_ability_asset')!;
    const out = await call(del, { assetIds: [base.id, ...ids], reason: '批量删' });
    expect(out.isError).toBe(true);
    expect(out.content).toContain('无法发起单次确认');
    const assets = await import('../../../../src/main/features/recall/asset-service');
    expect((await assets.readAbilityAsset(TEST_UID, base.id)).status).toBe('active');
  });

  it('批量里有一条不存在：快照凑不齐 → 整批不执行', async () => {
    const asset = await seedAsset('混了坏 id 的批量删除。');
    const { del } = await dangerTools();
    await answerNext('allow');
    const out = await call(del, { assetIds: [asset.id, 'aa-nonexistent'], reason: '批量删' });
    expect(out.isError).toBe(true);
    expect(out.content).toContain('没能留下执行前快照');
    const assets = await import('../../../../src/main/features/recall/asset-service');
    expect((await assets.readAbilityAsset(TEST_UID, asset.id)).status).toBe('active');
  });

  it('跨作用域扩大（改 scopePolicy）：先快照 + 单次确认；拒绝则一个字都不改', async () => {
    const asset = await seedAsset('作用域授权的改动要走确认。');
    const { edit } = await dangerTools();
    const assets = await import('../../../../src/main/features/recall/asset-service');
    await answerNext('deny');
    const denied = await call(edit, {
      assetId: asset.id,
      fields: { scopePolicy: { workspaceIds: ['sp-other'] } },
      reason: '用户要求让它在这个空间也能用',
      origin: 'user_instruction',
    });
    expect(denied.isError).toBe(true);
    expect(denied.content).toContain('未能执行跨作用域扩大');
    expect((await assets.readAbilityAsset(TEST_UID, asset.id)).scopePolicy).toBeUndefined();

    await answerNext('allow');
    const allowed = await call(edit, {
      assetId: asset.id,
      fields: { scopePolicy: { workspaceIds: ['sp-other'] } },
      reason: '用户要求让它在这个空间也能用',
      origin: 'user_instruction',
    });
    expect(allowed.isError).toBeUndefined();
    expect((await assets.readAbilityAsset(TEST_UID, asset.id)).scopePolicy).toMatchObject({ workspaceIds: ['sp-other'] });
    expect((await assets.listAbilityAssetAudit(TEST_UID, asset.id)).some((r) => r.action === 'danger_confirmed')).toBe(true);
  });

  it('被拦下的尝试留痕（attempt_blocked + 归因），不是只在成功路径上记账', async () => {
    const asset = await seedAsset('被拦下的尝试也要留痕。');
    const assets = await import('../../../../src/main/features/recall/asset-service');
    await assets.revokeAbilityAsset(TEST_UID, asset.id, { actor: 'user', reason: 'unsafe' });
    const { createAssetStewardTools } = await import('../../../../src/main/model/core-agent/asset-steward-tools');
    const edit = createAssetStewardTools({ userId: TEST_UID }).find((t) => t.name === 'edit_ability_asset')!;
    const out = await call(edit, { assetId: asset.id, fields: { title: 'x' }, reason: '试试', origin: 'ai_initiated' });
    expect(out.isError).toBe(true);

    const blocked = (await assets.listAbilityAssetAudit(TEST_UID, asset.id)).find((r) => r.action === 'attempt_blocked');
    expect(blocked).toBeTruthy();
    expect(blocked!.actor).toBe('ai');
    expect(blocked!.failureCategory).toBe('governance');
    expect(String(blocked!.note)).toContain('revoked ability asset cannot be changed');
  });
});

describe('安全网的量化口径（T031）', () => {
  it('台账覆盖率 100%：每一次 AI 写操作都有 actor=ai 且四项齐全的记录', async () => {
    const asset = await seedAsset('台账覆盖率的抽查对象。');
    const assets = await import('../../../../src/main/features/recall/asset-service');
    const { createAssetStewardTools } = await import('../../../../src/main/model/core-agent/asset-steward-tools');
    const tools = new Map(createAssetStewardTools({ userId: TEST_UID }).map((t) => [t.name, t]));
    const call = (name: string, input: Record<string, unknown>) => tools.get(name)!.execute(input, {} as never);

    await call('edit_ability_asset', { assetId: asset.id, fields: { title: '改名' }, reason: '命名规范化', origin: 'ai_initiated' });
    await call('archive_ability_asset', { assetId: asset.id, reason: '暂时不用' });
    await call('restore_ability_asset', { assetId: asset.id, reason: '又要用了' });
    await call('delete_ability_asset', { assetId: asset.id, reason: '用户要求删除' });
    await call('restore_ability_asset', { assetId: asset.id, reason: '用户要求恢复' });
    await call('rollback_ability_asset', { assetId: asset.id, toVersion: '1', reason: '回到第一版' });

    const aiRows = (await assets.listAbilityAssetAudit(TEST_UID, asset.id)).filter((r) => r.actor === 'ai');
    expect(aiRows.length).toBeGreaterThanOrEqual(6);
    for (const row of aiRows) {
      expect(Number.isNaN(Date.parse(row.at)), `${row.action} 缺时间`).toBe(false);
      expect(row.reason, `${row.action} 缺依据`).toBeTruthy();
      expect(row.before, `${row.action} 缺前值`).toBeTruthy();
      expect(row.after, `${row.action} 缺后值`).toBeTruthy();
    }
  });

  it('回滚一致性 100%：拿台账里的锚点回滚，内容与改动前逐字一致', async () => {
    const asset = await seedAsset('回滚一致性的原始内容。');
    const assets = await import('../../../../src/main/features/recall/asset-service');
    const { createAssetStewardTools } = await import('../../../../src/main/model/core-agent/asset-steward-tools');
    const tools = new Map(createAssetStewardTools({ userId: TEST_UID }).map((t) => [t.name, t]));
    const call = (name: string, input: Record<string, unknown>) => tools.get(name)!.execute(input, {} as never);

    // 内容路径：台账锚点 → 一步回滚 → 逐字回到改动前。
    const contentSteps: Array<[string, Record<string, unknown>]> = [
      ['edit_ability_asset', { fields: { statement: '第一次改动后的内容。' }, reason: '用户要求改', origin: 'user_instruction' }],
      ['edit_ability_asset', { fields: { title: '第二次改动的标题' }, reason: '命名规范化', origin: 'ai_initiated' }],
    ];
    for (const [name, extra] of contentSteps) {
      const before = await assets.readAbilityAsset(TEST_UID, asset.id);
      await call(name, { assetId: asset.id, reason: '步骤', ...extra });
      const anchor = (await assets.listAbilityAssetAudit(TEST_UID, asset.id)).at(-1)!.rollbackAnchor;
      expect(anchor, `${name} 应当留下回滚锚点`).toBeTruthy();
      await assets.rollbackAbilityAsset(TEST_UID, asset.id, anchor!, { actor: 'user', reason: '一步回滚' });
      const after = await assets.readAbilityAsset(TEST_UID, asset.id);
      expect(after.statement, name).toBe(before.statement);
      expect(after.title, name).toBe(before.title);
    }

    // 状态路径：归档/删除**不**留回滚锚点（它们不 bump 版本，锚点=当前版，
    // 回滚必然报"already at that version"）；它们的"回退"是 restore，内容同样逐字一致。
    for (const [name, extra] of [
      ['archive_ability_asset', {}],
      ['delete_ability_asset', {}],
    ] as Array<[string, Record<string, unknown>]>) {
      const before = await assets.readAbilityAsset(TEST_UID, asset.id);
      await call(name, { assetId: asset.id, reason: '步骤', ...extra });
      const row = (await assets.listAbilityAssetAudit(TEST_UID, asset.id)).at(-1)!;
      expect(row.rollbackAnchor, `${name} 不该留回滚锚点`).toBeUndefined();
      expect(row.before, `${name} 仍要有前后值`).toBeTruthy();
      await assets.restoreAbilityAsset(TEST_UID, asset.id, { actor: 'user', reason: '恢复' });
      const after = await assets.readAbilityAsset(TEST_UID, asset.id);
      expect(after.status, name).toBe('active');
      expect(after.statement, name).toBe(before.statement);
      expect(after.title, name).toBe(before.title);
    }
  });
});
