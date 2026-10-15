import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

let root: string;
let previousRoot: string | undefined;
const excerpt = '每项待办必须明确负责人和可核对的验收条件。';
const claim = { assetId: 'asset-a', assetVersion: 'v1', outputExcerpt: excerpt };

beforeEach(() => {
  vi.resetModules();
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'cogseed-usage-claim-'));
  previousRoot = process.env.COGSEED_WORKSPACE_ROOT;
  process.env.COGSEED_WORKSPACE_ROOT = root;
});
afterEach(() => {
  if (previousRoot === undefined) delete process.env.COGSEED_WORKSPACE_ROOT;
  else process.env.COGSEED_WORKSPACE_ROOT = previousRoot;
  fs.rmSync(root, { recursive: true, force: true });
});
async function supply(assetId = 'asset-a', overrides: Record<string, unknown> = {}) {
  const { recordInjectionReceipt } = await import('../../../../src/main/features/recall/injection-receipt');
  return recordInjectionReceipt('user-a', {
    taskRunId: 'turn-a', projectionId: 'projection-a', assetId, assetVersion: '1',
    messageId: 'message-a', boundary: 'real', status: 'injected', ...overrides,
  });
}
/** 主动读取快照：宿主在正文模式写入的 agent_read 注入回执（无 messageId、无投影）。 */
async function agentRead(assetId = 'aa-read1', overrides: Record<string, unknown> = {}) {
  const { recordInjectionReceipt } = await import('../../../../src/main/features/recall/injection-receipt');
  return recordInjectionReceipt('user-a', {
    taskRunId: 'turn-a', assetId, assetVersion: '1',
    boundary: 'real', status: 'injected', channel: 'agent_read', ...overrides,
  });
}
const readClaim = { assetId: 'aa-read1', assetVersion: 'v1', outputExcerpt: excerpt };

it('登记阶段只核对宿主本轮供应版本，不生成采用回执', async () => {
  const { prepareAssetUsageClaim } = await import('../../../../src/main/features/recall/asset-usage-claim');
  const { listAssetUsageReceipts } = await import('../../../../src/main/features/recall/asset-usage-receipt');
  await expect(prepareAssetUsageClaim('user-a', 'turn-a', claim, [{ assetId: 'asset-a', assetVersion: '1' }])).resolves.toEqual(claim);
  await expect(prepareAssetUsageClaim('user-a', 'turn-a', claim, [])).rejects.toThrow('not supplied');
  await expect(prepareAssetUsageClaim('user-a', 'turn-a', { ...claim, assetVersion: '2' }, [{ assetId: 'asset-a', assetVersion: '1' }])).rejects.toThrow('not supplied');
  expect(await listAssetUsageReceipts('user-a')).toEqual([]);
});

it('把缺席最终回复的采用片段计为未回执，避免引用中间消息冒充已交付', async () => {
  const { countClaimsMissingFromFinalOutput } = await import('../../../../src/main/features/recall/asset-usage-claim');
  const second = { assetId: 'asset-b', assetVersion: '2', outputExcerpt: '第二条资产对应的最终输出片段也足够具体。' };
  expect(countClaimsMissingFromFinalOutput([claim, { ...claim }, second], excerpt)).toBe(1);
  expect(countClaimsMissingFromFinalOutput([claim, second], `${excerpt}\n\n${second.outputExcerpt}`)).toBe(0);
  expect(countClaimsMissingFromFinalOutput([{ ...claim, outputExcerpt: 'bad' }, claim], '')).toBe(1);
});

it('多资产同消息只为明确报告且产出匹配的那一版生成采用回执，重复不计数', async () => {
  await supply();
  await supply('asset-b');
  const { finalizeAssetUsageClaims } = await import('../../../../src/main/features/recall/asset-usage-claim');
  const { listAssetUsageReceipts } = await import('../../../../src/main/features/recall/asset-usage-receipt');
  const input = { taskRunId: 'turn-a', messageId: 'message-a', finalText: excerpt, claims: [claim, claim] };
  expect(await finalizeAssetUsageClaims('user-a', input)).toHaveLength(1);
  await finalizeAssetUsageClaims('user-a', input);
  const receipts = await listAssetUsageReceipts('user-a');
  expect(receipts).toEqual([expect.objectContaining({ assetId: 'asset-a', assetVersion: '1', status: 'applied', evidenceKind: 'final_output' })]);
  expect(receipts[0].evidenceRefs).toEqual([expect.objectContaining({ id: 'message-a' })]);
  expect(JSON.stringify(receipts)).not.toContain(excerpt);
});

it.each([
  { assetVersion: '2' }, { messageId: 'another-message' }, { taskRunId: 'another-turn' },
  { boundary: 'degraded' }, { status: 'omitted' }, { status: 'dispatched' },
])('拒绝版本、消息、回合或供应边界不匹配：%j', async (overrides) => {
  await supply('asset-a', overrides);
  const { finalizeAssetUsageClaims } = await import('../../../../src/main/features/recall/asset-usage-claim');
  expect(await finalizeAssetUsageClaims('user-a', { taskRunId: 'turn-a', messageId: 'message-a', finalText: excerpt, claims: [claim] })).toEqual([]);
});

it('报告片段未出现在最终回复、非法报告或别的用户供应均不会生成回执', async () => {
  await supply();
  const { finalizeAssetUsageClaims } = await import('../../../../src/main/features/recall/asset-usage-claim');
  const input = { taskRunId: 'turn-a', messageId: 'message-a', finalText: '只查了目录，没有产出。', claims: [claim] };
  expect(await finalizeAssetUsageClaims('user-a', input)).toEqual([]);
  expect(await finalizeAssetUsageClaims('user-b', { ...input, finalText: excerpt })).toEqual([]);
  expect(await finalizeAssetUsageClaims('user-a', { ...input, finalText: excerpt, claims: [{ ...claim, outputExcerpt: '短' }] })).toEqual([]);
});

it('主动读取快照赋予采用资格：版本须与宿主记录精确匹配，经验条目与跨回合读取不算', async () => {
  const { prepareAssetUsageClaim } = await import('../../../../src/main/features/recall/asset-usage-claim');
  await expect(prepareAssetUsageClaim('user-a', 'turn-a', readClaim, [])).rejects.toThrow('not supplied');
  await agentRead();
  await expect(prepareAssetUsageClaim('user-a', 'turn-a', readClaim, [])).resolves.toEqual(readClaim);
  await expect(prepareAssetUsageClaim('user-a', 'turn-a', { ...readClaim, assetVersion: '2' }, [])).rejects.toThrow('not supplied');
  await expect(prepareAssetUsageClaim('user-a', 'another-turn', readClaim, [])).rejects.toThrow('not supplied');
  await agentRead('exp-entry1');
  await expect(prepareAssetUsageClaim('user-a', 'turn-a', { ...readClaim, assetId: 'exp-entry1' }, [])).rejects.toThrow('not supplied');
});

it('主动读取的采用报告在最终回复持久化后按快照生成回执，重复核验不重复计数', async () => {
  const injection = await agentRead();
  const { finalizeAssetUsageClaims } = await import('../../../../src/main/features/recall/asset-usage-claim');
  const { listAssetUsageReceipts } = await import('../../../../src/main/features/recall/asset-usage-receipt');
  const input = { taskRunId: 'turn-a', messageId: 'message-a', finalText: excerpt, claims: [readClaim] };
  expect(await finalizeAssetUsageClaims('user-a', input)).toEqual([
    expect.objectContaining({
      assetId: 'aa-read1', assetVersion: '1', projectionId: 'agent-read',
      injectionReceiptId: injection.id, status: 'applied', evidenceKind: 'final_output', boundary: 'real',
    }),
  ]);
  await finalizeAssetUsageClaims('user-a', input);
  expect(await listAssetUsageReceipts('user-a')).toHaveLength(1);
  expect((await listAssetUsageReceipts('user-a'))[0].evidenceRefs).toEqual([expect.objectContaining({ id: 'message-a' })]);
});

it('同一资产既投影供应又主动读取时，只按消息绑定的投影回执记一次', async () => {
  await supply('aa-read1');
  await agentRead();
  const { finalizeAssetUsageClaims } = await import('../../../../src/main/features/recall/asset-usage-claim');
  const { listAssetUsageReceipts } = await import('../../../../src/main/features/recall/asset-usage-receipt');
  await finalizeAssetUsageClaims('user-a', { taskRunId: 'turn-a', messageId: 'message-a', finalText: excerpt, claims: [readClaim] });
  const receipts = await listAssetUsageReceipts('user-a');
  expect(receipts).toHaveLength(1);
  expect(receipts[0].projectionId).toBe('projection-a');
});

it('主动读取但片段未进最终回复时仍不生成采用回执', async () => {
  await agentRead();
  const { finalizeAssetUsageClaims } = await import('../../../../src/main/features/recall/asset-usage-claim');
  const { listAssetUsageReceipts } = await import('../../../../src/main/features/recall/asset-usage-receipt');
  await finalizeAssetUsageClaims('user-a', { taskRunId: 'turn-a', messageId: 'message-a', finalText: '只读正文，没有产出。', claims: [readClaim] });
  expect(await listAssetUsageReceipts('user-a')).toEqual([]);
});

it('agent-read 占位投影只对 agent_read 回执放行，投影回执仍要求逐字相等', async () => {
  const read = await agentRead();
  const projection = await supply('aa-read2');
  const { recordAssetUsageReceipt } = await import('../../../../src/main/features/recall/asset-usage-receipt');
  await recordAssetUsageReceipt('user-a', {
    taskRunId: 'turn-a', projectionId: 'agent-read', assetId: 'aa-read1', assetVersion: '1',
    injectionReceiptId: read.id, status: 'applied', evidenceKind: 'final_output', boundary: 'real',
    evidenceRefs: [{ kind: 'message', id: 'message-a' }],
  });
  await expect(recordAssetUsageReceipt('user-a', {
    taskRunId: 'turn-a', projectionId: 'agent-read', assetId: 'aa-read2', assetVersion: '1',
    injectionReceiptId: projection.id, status: 'applied', evidenceKind: 'final_output', boundary: 'real',
    evidenceRefs: [{ kind: 'message', id: 'message-a' }],
  })).rejects.toThrow('does not match');
});

it('真实最终输出可补齐未知回执，但不能覆盖用户否定', async () => {
  const injection = await supply();
  const { recordAssetUsageReceipt, listAssetUsageReceipts } = await import('../../../../src/main/features/recall/asset-usage-receipt');
  const { finalizeAssetUsageClaims } = await import('../../../../src/main/features/recall/asset-usage-claim');
  const base = { taskRunId: 'turn-a', projectionId: 'projection-a', assetId: 'asset-a', assetVersion: '1', injectionReceiptId: injection.id, boundary: 'real' as const };
  await recordAssetUsageReceipt('user-a', { ...base, status: 'usage_unknown', evidenceKind: 'none' });
  const final = { taskRunId: 'turn-a', messageId: 'message-a', finalText: excerpt, claims: [claim] };
  await finalizeAssetUsageClaims('user-a', final);
  expect((await listAssetUsageReceipts('user-a'))[0].status).toBe('applied');
  await recordAssetUsageReceipt('user-a', { ...base, status: 'contradicted', evidenceKind: 'final_output', evidenceRefs: [{ kind: 'message', id: 'user-feedback' }] });
  await finalizeAssetUsageClaims('user-a', final);
  expect((await listAssetUsageReceipts('user-a'))[0].status).toBe('contradicted');
});

it('单条写入失败不丢掉同回复里其他可核验报告，也不把失败算成功', async () => {
  await supply();
  await supply('asset-b');
  const usage = await import('../../../../src/main/features/recall/asset-usage-receipt');
  const write = vi.spyOn(usage, 'recordAssetUsageReceipt').mockRejectedValueOnce(new Error('simulated single write failure'));
  const { finalizeAssetUsageClaims } = await import('../../../../src/main/features/recall/asset-usage-claim');
  const result = await finalizeAssetUsageClaims('user-a', { taskRunId: 'turn-a', messageId: 'message-a', finalText: excerpt,
    claims: [claim, { ...claim, assetId: 'asset-b' }],
  });
  expect(result).toEqual([expect.objectContaining({ assetId: 'asset-b', status: 'applied' })]);
  expect(await usage.listAssetUsageReceipts('user-a')).toEqual(result);
  write.mockRestore();
});
