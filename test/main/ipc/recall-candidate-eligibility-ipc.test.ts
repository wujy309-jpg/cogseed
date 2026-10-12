/**
 * 候选「可确认」契约在**真实 IPC 读口**上的回归护栏。
 *
 * `test/main/features/recall/candidate-eligibility-contract.test.ts` 已经在
 * service 层守住了同一批不变量，但那一层看不到
 * 渲染层真正拿到的东西：能力判据是 `recall.candidates.list` 的 handler 现算
 * 现拼的 DTO 投影，「待我处理」是 `cognition.inbox.list` 的服务端读模型。
 * 两个 handler body 此前没有任何 IPC 级用例穿过——`test/main/ipc/recall.test.ts`
 * 与 `test/main/ipc/cognition-ipc.test.ts` 都把 feature 层整份 mock 掉了，
 * 断言的是 mock 的返回值，验不了「真实落库 → 真实读口」这一段。
 *
 * 所以这份文件刻意**不 mock feature 层**：只保留 electron / logger /
 * kb_embed（伪 embedding，避免真实向量模型）/ local_agents（置空）这四个
 * 载入期必需的替身，候选服务、能力判据、inbox 适配器全部走真实实现，
 * 存储落在临时目录里。
 *
 * 守的产品不变量（回归历史见 docs/recall-candidate-promotion-audit.md）：
 *   **列表说"能确认"的候选，promote 必须真的成功；列表说"不能确认"的候选，
 *   「待我处理」不得把它出成普通待办，绕过 UI 直接 promote 也必须被拒。**
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { trustedIpcSender } from '../../helpers/trusted-ipc-sender';
import { drainMainRuntimeForTest } from '../../helpers/drain-main-runtime';

type InvokeResult = { ok: boolean; error?: string } & Record<string, unknown>;
type InvokeFn = (event: unknown, req: { channel: string; payload?: unknown }) => Promise<InvokeResult>;

type CandidateCapabilities = {
  canPromote: boolean;
  canConfirm: boolean;
  canBatchSelect: boolean;
  eligibility: string;
  ineligibleReasons: string[];
};
type CandidateDto = { id: string; status: string; capabilities: CandidateCapabilities };
type InboxItem = { id: string; kind: string; candidateId?: string; detail?: string };

let invokeHandler: InvokeFn | null = null;
let tmpDir = '';
let previousRoot: string | undefined;
const UID = 'uRecallEligibilityIpc';

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: InvokeFn) => {
      if (channel === 'cogseed.invoke') invokeHandler = fn;
    },
    on: vi.fn(),
  },
  shell: { openExternal: vi.fn(async () => undefined), showItemInFolder: vi.fn() },
  BrowserWindow: { getFocusedWindow: vi.fn(() => null), getAllWindows: vi.fn(() => []) },
  dialog: { showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] })) },
  app: { getPath: vi.fn(() => os.tmpdir()), isPackaged: false },
}));

vi.mock('../../../src/main/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  logFromRenderer: vi.fn(),
}));

// 语义查重要跑 embedding：用确定性哈希向量顶替，既避免加载真实模型，
// 也让同一段文本在同一次运行里恒等（查重路径本身仍走真实实现）。
vi.mock('../../../src/main/features/kb_embed', () => ({
  embedQuery: async (text: string) => {
    const digest = createHash('sha256').update(text).digest();
    return Array.from({ length: 512 }, (_, i) => (digest[i % 32] / 255 - 0.5) * 0.2);
  },
  closeEmbedder: () => {},
}));

/** 项目事实伪装成 personal —— PRD 3.4 明确排除，classification 阻断。 */
const PROJECT_FACT = {
  judgment: '我今天在修 KSTAR 的候选池',
  summary: '当前任务',
  value: '记录当前进度',
  suggestedType: 'personal',
  suggestedScope: 'project',
  suggestedAction: 'create',
};

/** 真正的长期偏好 —— 过闸。 */
const DURABLE_PREFERENCE = {
  judgment: '我长期更喜欢先看整体结构再看细节',
  summary: '结构优先',
  value: '后续任务先给结构再展开，可以少一轮返工',
  suggestedType: 'personal',
  suggestedScope: 'global',
  suggestedAction: 'create',
};

const REFS = [{ kind: 'conversation', id: 'conv-1' }];

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cogseed-recall-eligibility-ipc-'));
  previousRoot = process.env.COGSEED_WORKSPACE_ROOT;
  process.env.COGSEED_WORKSPACE_ROOT = tmpDir;
  invokeHandler = null;
  vi.resetModules();
  vi.clearAllMocks();
  // local_agents 的 handler 表与本用例无关，置空避免拉起 agent 运行时。
  vi.doMock('../../../src/main/ipc/local_agents', () => ({ invokeHandlers: {} }));
  const users = await import('../../../src/main/features/users');
  users.activateUser(UID);
  const ipc = await import('../../../src/main/ipc/index');
  ipc.register();
});

afterEach(async () => {
  await drainMainRuntimeForTest(UID);
  if (previousRoot === undefined) delete process.env.COGSEED_WORKSPACE_ROOT;
  else process.env.COGSEED_WORKSPACE_ROOT = previousRoot;
  fs.rmSync(tmpDir, { recursive: true, force: true });
  vi.resetModules();
});

function call(channel: string, payload: unknown = {}): Promise<InvokeResult> {
  if (!invokeHandler) throw new Error('invoke handler not registered');
  return invokeHandler({ sender: trustedIpcSender() }, { channel, payload });
}

/** 真实候选服务（未 mock）——用于把候选真的写进临时工作区，再从 IPC 读回来。 */
const candidateService = () => import('../../../src/main/features/recall/candidate-service');

async function listCandidates(): Promise<CandidateDto[]> {
  const result = await call('recall.candidates.list');
  expect(result.ok).toBe(true);
  return result.candidates as CandidateDto[];
}

async function listInbox(): Promise<InboxItem[]> {
  const result = await call('cognition.inbox.list');
  expect(result.ok).toBe(true);
  expect(result.total).toBe((result.items as InboxItem[]).length);
  return result.items as InboxItem[];
}

const findById = (candidates: CandidateDto[], id: string): CandidateDto => {
  const found = candidates.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`candidate ${id} missing from recall.candidates.list`);
  return found;
};

describe('真实 IPC 自动批准设置持久化', () => {
  it('临时用户可以开启、独立回读、关闭并再次回读，不依赖 renderer 乐观状态', async () => {
    const initial = await call('recall.captures.settings.get');
    expect(initial.ok).toBe(true);
    expect(initial.settings).toMatchObject({ autoApproval: false });
    expect(initial.capabilities).toEqual({ autoApproval: true });
    const enabled = await call('recall.captures.settings.update', { autoApproval: true });
    expect(enabled.ok).toBe(true);
    expect(enabled.settings).toMatchObject({ autoApproval: true });
    const enabledRead = await call('recall.captures.settings.get');
    expect(enabledRead.ok).toBe(true);
    expect(enabledRead.capabilities).toEqual({ autoApproval: true });
    expect(enabledRead.settings).toMatchObject({
      autoApproval: true,
      autoApprovalEpoch: (enabled.settings as Record<string, unknown>).autoApprovalEpoch,
      autoApprovalEnabledAt: expect.any(String),
    });
    const disabled = await call('recall.captures.settings.update', { autoApproval: false });
    expect(disabled.ok).toBe(true);
    const disabledRead = await call('recall.captures.settings.get');
    expect(disabledRead.ok).toBe(true);
    expect(disabledRead.capabilities).toEqual({ autoApproval: true });
    expect(disabledRead.settings).toMatchObject({ autoApproval: false });
    expect((disabledRead.settings as Record<string, unknown>).autoApprovalEnabledAt).toBeUndefined();
  });
});

describe('手动添加对象范围经真实 IPC 保留', () => {
  it('保存候选、确认和正式资产回读保留对象限制，不将语义范围或来源归属混同', async () => {
    const scopePolicy = { agentIds: ['agent-manual-scope'], workspaceIds: ['space-manual-scope'] };
    const saved = await call('recall.candidates.save', {
      judgment: '项目汇报结构包含目标、进展、三个风险和下一步负责人，供后续项目周报复用。',
      summary: '周报组织骨架', value: '后续周报复用同一结构，确保行动和风险可以核对。',
      suggestedType: 'template', suggestedScope: 'report', suggestedAction: 'create', manual: true, sourceRefs: [], scopePolicy,
    });
    expect(saved.ok).toBe(true);
    const candidate = saved.candidate as { id: string; spaceId?: string };
    expect(candidate).toMatchObject({ origin: 'manual', suggestedScope: 'report', scopePolicy, sourceRefs: [] });
    expect(candidate.spaceId).toBeUndefined();
    const promoted = await call('recall.candidates.promote', { candidateId: candidate.id });
    expect(promoted.ok).toBe(true);
    const asset = promoted.asset as { id: string };
    const reread = await call('recall.assets.read', { assetId: asset.id });
    expect(reread.ok).toBe(true);
    expect(reread.asset).toMatchObject({ scope: 'report', scopePolicy, origin: 'manual' });
    expect((reread.asset as { spaceId?: string }).spaceId).toBeUndefined();
  });
});

describe('正式资产编辑 IPC 基准版本', () => {
  it('透传内容和在用版本 CAS，拒绝并发编辑与切换旧版本后的过期草稿', async () => {
    const candidates = await candidateService();
    const saved = await candidates.saveRecallCandidate(UID, { ...DURABLE_PREFERENCE, sourceRefs: REFS, evidenceRefs: REFS } as never);
    const promoted = await call('recall.candidates.promote', { candidateId: saved.id });
    expect(promoted.ok).toBe(true);
    const assetId = (promoted.asset as { id: string }).id;
    const listed = await call('recall.assets.list');
    expect(listed.ok).toBe(true);
    expect(listed.capabilities).toEqual({ versionedUpdate: true });
    expect((listed.assets as Array<{ id: string }>).some(asset => asset.id === assetId)).toBe(true);
    const edited = await call('recall.assets.update', { assetId, reason: '用户编辑认知', title: '整体结构偏好', expectedVersion: '1', expectedActiveVersion: '1' });
    expect(edited.error).toBeUndefined();
    expect(edited.ok).toBe(true);
    expect(edited.asset).toMatchObject({ version: '2', title: '整体结构偏好' });
    const stale = await call('recall.assets.update', { assetId, reason: '用户编辑认知', title: '过期编辑', expectedVersion: '1', expectedActiveVersion: '1' });
    expect(stale.ok).toBe(false);
    expect(stale.error).toContain('version conflict');
    expect((await call('recall.assets.read', { assetId })).asset).toMatchObject({ version: '2', title: '整体结构偏好' });
    expect((await call('recall.assets.versions.select', { assetId, version: '1' })).ok).toBe(true);
    const switched = await call('recall.assets.update', { assetId, reason: '用户编辑认知', title: '错误覆盖历史版', expectedVersion: '2', expectedActiveVersion: '2' });
    expect(switched.ok).toBe(false);
    expect(switched.error).toContain('active version conflict');
    expect((await call('recall.assets.read', { assetId })).asset).toMatchObject({ version: '2', activeVersion: '1' });
    expect((await call('recall.assets.update', { assetId, reason: '用户编辑认知', title: '错误格式', expectedVersion: 2 })).ok).toBe(false);
  });
});

describe('候选可确认性在真实 IPC 读口上闭环', () => {
  it('Case A 合格候选：list 说能确认 → inbox 不再镜像候选（唯一确认入口=候选详情）→ promote 真的落出正式资产', async () => {
    const candidates = await candidateService();
    const saved = await candidates.saveRecallCandidate(UID, {
      ...DURABLE_PREFERENCE, sourceRefs: REFS, evidenceRefs: REFS,
    } as never);
    expect(saved.status).toBe('pending_review');

    const dto = findById(await listCandidates(), saved.id);
    expect(dto.capabilities.canPromote).toBe(true);
    expect(dto.capabilities.canConfirm).toBe(true);
    expect(dto.capabilities.eligibility).toBe('eligible');

    // 2026-09-29 第 2 批·一物一链：普通待确认候选不再进治理清单
    // （candidate_pending_review 停产）——此前治理行 accept 直调 promote 不带
    // 冲突三选一，是与候选卡并行的第二条确认链。inbox 只收系统自查类。
    const inboxItem = (await listInbox()).find((item) => item.candidateId === saved.id);
    expect(inboxItem).toBeUndefined();

    const promoted = await call('recall.candidates.promote', { candidateId: saved.id });
    expect(promoted.ok).toBe(true);
    const candidate = promoted.candidate as { status: string; promotedAssetId?: string };
    const asset = promoted.asset as { id: string; type: string };
    expect(candidate.status).toBe('confirmed');
    // 真的落出了一条正式资产，不是只把候选标成 confirmed。
    expect(candidate.promotedAssetId).toBeTruthy();
    expect(asset.id).toBe(candidate.promotedAssetId);
    expect(asset.type).toBe('personal');
  });

  it('Case B 不合格候选：list 标 ineligible → inbox 出 candidate_ineligible → 绕过 UI 的 promote 仍被拒', async () => {
    const candidates = await candidateService();
    const saved = await candidates.saveRecallCandidate(UID, {
      ...PROJECT_FACT, sourceRefs: REFS, evidenceRefs: REFS, forceWeakObservation: true,
    } as never);
    expect(saved.status).toBe('weak_observation');

    const dto = findById(await listCandidates(), saved.id);
    expect(dto.capabilities.eligibility).toBe('ineligible');
    expect(dto.capabilities.ineligibleReasons).toContain('personal_is_project_fact');
    expect(dto.capabilities.canPromote).toBe(false);
    expect(dto.capabilities.canConfirm).toBe(false);
    expect(dto.capabilities.canBatchSelect).toBe(false);

    // 「待我处理」必须把它出成 candidate_ineligible 并保留阻断原因，
    // 而不是伪装成普通待确认候选骗用户认真审批一次。
    const inbox = await listInbox();
    const item = inbox.find((entry) => entry.candidateId === saved.id);
    expect(item?.kind).toBe('candidate_ineligible');
    expect(item?.detail).toBe('personal_is_project_fact');
    expect(inbox.map((entry) => entry.kind)).not.toContain('candidate_pending_review');

    // 最后一道防线：即使渲染层不看 capabilities 直接调 promote，后端也要拒。
    const promoted = await call('recall.candidates.promote', { candidateId: saved.id });
    expect(promoted.ok).toBe(false);
    expect(promoted.code).toBe('promotion_blocked');
    expect(promoted.promotionReasons).toContain('personal_is_project_fact');
  });

  it('review-queue 视图：view 参数透传到服务端投影（2026-09-29 第 3 批）', async () => {
    const candidates = await candidateService();
    const pending = await candidates.saveRecallCandidate(UID, {
      ...DURABLE_PREFERENCE, sourceRefs: REFS, evidenceRefs: REFS,
    } as never);
    const toConfirm = await candidates.saveRecallCandidate(UID, {
      ...DURABLE_PREFERENCE,
      judgment: '我长期偏好先写测试再写实现',
      summary: '测试先行',
      sourceRefs: REFS, evidenceRefs: REFS,
    } as never);
    await call('recall.candidates.promote', { candidateId: toConfirm.id });

    const view = await call('recall.candidates.list', { view: 'review-queue' });
    expect(view.ok).toBe(true);
    const viewList = view.candidates as Array<Record<string, unknown>>;
    // 待确认与已确认都在队列视图里（confirmed 进处理记录限量 5）。
    expect(viewList.some((c) => c.id === pending.id)).toBe(true);
    expect(viewList.some((c) => c.id === toConfirm.id)).toBe(true);
    // 零消费记录级字段被视图裁掉；capabilities 保留。
    const viewPending = viewList.find((c) => c.id === pending.id)!;
    expect('contentFormatVersion' in viewPending).toBe(false);
    expect('taxonomyVersion' in viewPending).toBe(false);
    expect(viewPending.capabilities).toBeTruthy();

    // 默认（不传 view）仍是全量全形状——会话抽屉等调用方不受影响。
    const full = await listCandidates();
    const fullPending = full.find((c) => c.id === pending.id)! as Record<string, unknown>;
    expect('contentFormatVersion' in fullPending).toBe(true);
  });

  it('编辑保存的 IPC 返回真实全池冲突校验，不能短暂伪装成可确认', async () => {
    const candidates = await candidateService();
    const personal = await candidates.saveRecallCandidate(UID, { ...DURABLE_PREFERENCE, sourceRefs: REFS, evidenceRefs: REFS } as never);
    await candidates.saveRecallCandidate(UID, {
      ...DURABLE_PREFERENCE, suggestedType: 'rule', suggestedScope: 'product',
      sourceRefs: [{ kind: 'conversation', id: 'conv-conflict-edit' }], evidenceRefs: [{ kind: 'conversation', id: 'conv-conflict-edit' }],
    } as never);
    const result = await call('recall.candidates.update', { ...DURABLE_PREFERENCE, candidateId: personal.id, sourceRefs: REFS, evidenceRefs: REFS });
    expect(result.ok).toBe(true);
    const candidate = result.candidate as CandidateDto;
    expect(candidate.capabilities.canPromote).toBe(false);
    expect(candidate.capabilities.ineligibleReasons).toContain('type_conflicts_with_existing');
    expect((await call('recall.candidates.promote', { candidateId: personal.id })).ok).toBe(false);
  });

  it('Case C 跨候选冲突：list 真的跑了 recallCandidateConflictingTypes，不是只做单条投影', async () => {
    // 冲突是**跨候选**判断，单条候选算不出来——只有持有全量列表的读口能算。
    // handler 里少传 conflicts 的话，列表会说"能确认"，而晋升闸门按同一批
    // 数据判冲突并拒绝，又是一次假审批。同一句话被分成两类即构成冲突。
    const candidates = await candidateService();
    const asPersonal = await candidates.saveRecallCandidate(UID, {
      ...DURABLE_PREFERENCE, sourceRefs: REFS, evidenceRefs: REFS,
    } as never);
    const asRule = await candidates.saveRecallCandidate(UID, {
      ...DURABLE_PREFERENCE,
      suggestedType: 'rule',
      suggestedScope: 'product',
      sourceRefs: [{ kind: 'conversation', id: 'conv-2' }],
      evidenceRefs: [{ kind: 'conversation', id: 'conv-2' }],
    } as never);

    const listed = await listCandidates();
    for (const id of [asPersonal.id, asRule.id]) {
      const dto = findById(listed, id);
      expect(dto.capabilities.eligibility).toBe('ineligible');
      expect(dto.capabilities.ineligibleReasons).toContain('type_conflicts_with_existing');
      expect(dto.capabilities.canPromote).toBe(false);
    }

    // 列表与晋升闸门用的是同一套判据：列表说不能确认，promote 也必须拒。
    const promoted = await call('recall.candidates.promote', { candidateId: asPersonal.id });
    expect(promoted.ok).toBe(false);
    expect(promoted.code).toBe('promotion_blocked');
  });
});

describe('系统活动逐条处理记录 IPC', () => {
  it('读取当前用户的真实候选审查账本，返回状态而不泄露修改正文', async () => {
    const candidates = await candidateService();
    const saved = await candidates.saveRecallCandidate(UID, { ...DURABLE_PREFERENCE, manual: true, sourceRefs: [], evidenceRefs: [] } as never);
    const { writeReviewDecision } = await import('../../../src/main/features/cognition/review-decision');
    await writeReviewDecision(UID, { targetRef: `recall_candidate:${saved.id}`, decisionType: 'modify', decision: '修改后保存', actor: 'user', reason: '已核对来源', modifiedContent: '不应通过历史接口返回的正文' });
    const result = await call('recall.candidates.history', { candidateId: saved.id });
    expect(result.ok).toBe(true);
    expect(result.items).toEqual([expect.objectContaining({ decision_type: 'modify', actor: 'user', reason: '已核对来源', outcome: 'recorded' })]);
    expect(JSON.stringify(result)).not.toContain('不应通过历史接口返回的正文');
    expect((await call('recall.candidates.history', { candidateId: '../../other' })).ok).toBe(false);
    const other = await candidates.saveRecallCandidate('otherHistoryUser', { ...DURABLE_PREFERENCE, manual: true, sourceRefs: [], evidenceRefs: [] } as never);
    expect((await call('recall.candidates.history', { candidateId: other.id })).ok).toBe(false);
  });
});

describe('HTML 表单与正式资产的持久化一致性', () => {
  it('人工确认的长标题与正文同字开头仍原样保存；自定义任务范围不变成通用', async () => {
    const title = '项目周报交付模板与跨部门风险核对方式';
    const scope = '项目甲每周交付与风险核对';
    const saved = await call('recall.candidates.save', {
      manual: true, summary: title, suggestedType: 'template', suggestedScope: scope,
      judgment: '项目周报按以下结构组织：\n项目：{{项目名称}}\n本周进展：{{进展}}\n风险与阻塞：{{风险}}\n下周计划：{{计划}}',
      sourceRefs: [], evidenceRefs: [],
    });
    expect(saved.ok).toBe(true);
    const id = (saved.candidate as { id: string }).id;
    const promoted = await call('recall.candidates.promote', { candidateId: id });
    expect(promoted.ok).toBe(true);
    const assetId = (promoted.asset as { id: string }).id;
    const read = await call('recall.assets.read', { assetId });
    expect(read.asset).toMatchObject({ title, scope, origin: 'manual' });
    expect((await call('recall.reviewEvidence.read', { assetId })).items).toEqual([]);
    expect((await call('recall.reviewEvidence.read', { candidateId: id, assetId })).ok).toBe(false);
  });
});
