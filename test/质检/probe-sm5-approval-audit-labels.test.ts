import { seedStoredAbilityAsset } from '../helpers/stored-ability-asset';
/**
 * 探针（状态机审计员 · 本轮，sm5）：审批治理动作（approval_proposed /
 * approval_confirmed / approval_rejected / approval_deferred / approval_edited）
 * 写进资产审计流，但渲染层台账区 AUDIT_ACTION_LABELS 零词条、四语 locale
 * 零键——zh 用户在资产详情「使用与版本」台账区看到裸英文键
 * 'approval_confirmed' 等（views.js:1703 `|| String(row.action)` 兜底直出）。
 *
 * 读码链：
 *  - asset-approval-service.ts:226 appendApprovalAudit 用 appendRecallJsonlRecord
 *    写 'ability-asset-audit' 流——与 asset-service.appendAudit（:465-488）同一条
 *    流，渲染层 loadAssetVersions 的 audit（core.js:876 result.audit）读的就是它；
 *  - views.js:1657-1685 AUDIT_ACTION_LABELS 共 26 键，**不含** approval_* 五键
 *    （:1703 未知 action 落 String(row.action) 裸键直出）；
 *  - src/renderer/locales/{zh,en,ja,pt}.json cognition.audit_approval_* 零键
 *    （对照 cognition.audit_created 等 26 键全在）；
 *  - 次级：timeline-service.ts:108-133 auditTimelineKind 对 approval_* 返回
 *    undefined → 资产时间线整行跳过审批事件（US-406 动作在时间线不可见）。
 *
 * 手法：真实链路建提议→确认→读审计流断言 approval_* 行在场（证明数据面
 * 真会到达渲染层），再源码级断言标签表与四语词条缺失（沿仓库源码断言惯例）。
 *
 * 收尾状态（2026-10-01 记账员）：对应待议 **P-r3-44（主修标签五键+四语词条复用主进程现成译文可先行；时间线两案并入 asset_updated vs 新增审批 kind 待拍板）**——
 * 断言漏洞/分裂现状的用例 it.skip 注明编号，拍板修复后反转/改写断言启用；
 * 对照组（合法路径/既有契约在）不依赖漏洞，保留 active。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
const UID = 'probe-sm5-ap';

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cogseed-probe-sm5-'));
  prevWs = process.env.COGSEED_WORKSPACE_ROOT;
  process.env.COGSEED_WORKSPACE_ROOT = tmpDir;
  vi.resetModules();
});

afterEach(() => {
  process.env.COGSEED_WORKSPACE_ROOT = prevWs;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function mkAsset(id: string) {
  const assets = await import('../../src/main/features/recall/asset-service');
  const now = new Date().toISOString();
  return seedStoredAbilityAsset(UID, {
    schemaVersion: 2, ownerId: UID, id, candidateId: `cand-${id}`,
    sourceCandidateIds: [`cand-${id}`], reviewDecisionId: `rd_probe${id.slice(-6)}`.padEnd(16, 'x'),
    type: 'personal', title: `资产 ${id}`, statement: `陈述 ${id}。`,
    evidenceRefs: [{ kind: 'conversation', id: `conv-${id}` }], scope: 'general', status: 'active',
    lifecycleStatus: 'user_confirmed_unverified', maturity: 'bud', version: '1',
    createdAt: now, updatedAt: now,
  }, { actor: 'user', reason: 'probe seed' });
}

const APPROVAL_ACTIONS = ['approval_proposed', 'approval_confirmed', 'approval_rejected', 'approval_deferred', 'approval_edited'];

describe('probe sm5 › 审批审计动作的渲染契约缺口', () => {
  it.skip('【待议 P-r3-44】主用例：提议+确认后审计流含 approval_proposed/approval_confirmed 行，而标签表与四语词条均缺失（裸键直出）', async () => {
    await mkAsset('aa-ap5audit1');
    const approval = await import('../../src/main/features/recall/asset-approval-service');
    const { proposal } = await approval.createAssetChangeProposal(UID, {
      assetId: 'aa-ap5audit1', baselineVersion: '1', fields: ['statement'],
      payload: { statement: '改后的陈述。' }, before: '陈述 aa-ap5audit1。', after: '改后的陈述。',
      reason: 'AI 提议补充说明',
    });
    const decision = await approval.decideAssetChangeProposal(UID, proposal.id, 'confirm');
    expect(decision.ok).toBe(true);

    // 数据面：审计流（渲染层 versions.list 的 audit 读的同一来源）含审批行。
    const { listRecallJsonlRecords } = await import('../../src/main/features/recall/store');
    const auditRows = await listRecallJsonlRecords(UID, 'ability-asset-audit', 'aa-ap5audit1', 0);
    const actions = auditRows.map((row) => String(row.action));
    expect(actions).toContain('approval_proposed');
    expect(actions).toContain('approval_confirmed');

    // 渲染面 1：views.js 台账区标签表不含这五个 action → 裸英文键直出。
    const viewsSrc = fs.readFileSync(path.resolve(__dirname, '../../src/renderer/modules/cognition-assets/views.js'), 'utf8');
    const labelBlock = viewsSrc.slice(viewsSrc.indexOf('AUDIT_ACTION_LABELS'), viewsSrc.indexOf('AUDIT_ACTOR_LABELS'));
    const missing = APPROVAL_ACTIONS.filter((action) => !labelBlock.includes(`${action}:`));
    expect(missing).toEqual(APPROVAL_ACTIONS); // 五键全缺

    // 渲染面 2：四语 locale 无 cognition.audit_approval_* 键。
    for (const locale of ['zh', 'en', 'ja', 'pt']) {
      const localeJson = JSON.parse(fs.readFileSync(
        path.resolve(__dirname, `../../src/renderer/locales/${locale}.json`), 'utf8'));
      const keys = Object.keys(localeJson);
      expect(keys.filter((key) => key.startsWith('cognition.audit_approval')).length).toBe(0);
    }
  });

  it('对照组：既有 26 键标签表对 updated 行照常命中（缺口仅审批族）', async () => {
    const assets = await import('../../src/main/features/recall/asset-service');
    await mkAsset('aa-ap5audit2');
    await assets.updateAbilityAsset(UID, 'aa-ap5audit2', { statement: '新正文。', reason: 'probe', actor: 'user' });
    const { listRecallJsonlRecords } = await import('../../src/main/features/recall/store');
    const actions = (await listRecallJsonlRecords(UID, 'ability-asset-audit', 'aa-ap5audit2', 0))
      .map((row) => String(row.action));
    expect(actions).toContain('created');
    expect(actions).toContain('updated');
    const viewsSrc = fs.readFileSync(path.resolve(__dirname, '../../src/renderer/modules/cognition-assets/views.js'), 'utf8');
    const labelBlock = viewsSrc.slice(viewsSrc.indexOf('AUDIT_ACTION_LABELS'), viewsSrc.indexOf('AUDIT_ACTOR_LABELS'));
    expect(labelBlock.includes('updated:')).toBe(true);
  });
});
