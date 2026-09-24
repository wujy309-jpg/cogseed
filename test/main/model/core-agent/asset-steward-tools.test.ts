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
async function cloneAssets(base: Record<string, unknown>, count: number, overrides: Array<Record<string, unknown>> = []) {
  const store = await import('../../../../src/main/features/recall/store');
  const ids: string[] = [];
  for (let index = 0; index < count; index += 1) {
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

  it('资产管家的工具面就是两个读工具（写工具由 US-402 追加）', async () => {
    const { names } = await stewardTools();
    expect(names).toEqual(['list_ability_assets', 'read_ability_asset']);
  });
});
