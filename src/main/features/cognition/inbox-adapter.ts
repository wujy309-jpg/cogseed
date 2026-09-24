/**
 * 「待我处理」的读适配器。
 *
 * 只做一件事：把 canonical 层的资产、统一候选池、来源目录读出来，喂给
 * `buildCognitionInbox`。判断"什么算待办"的规则一条都不在这里——那些在
 * formal-assets/inbox.ts，与晋升 gate、Runtime gate 复用同一批函数。
 * 这里如果自己加一句 if，待办就会和 gate 分叉，用户看到的和系统执行的
 * 就不是同一套标准了。
 */

import { createLogger } from '../../logger';
import { safeId } from '../../storage';
import { listAbilityAssetVersions } from '../recall/asset-service';
import {
  deferRecallCandidate,
  ignoreRecallCandidate,
  listRecallCandidates,
  promoteRecallCandidate,
  recallCandidateConflictingTypes,
  rejectRecallCandidate,
} from '../recall/candidate-service';
import { listAssetChangeProposals } from '../recall/asset-approval-service';
import { decideAssetChangeProposal } from '../recall/asset-approval-service';
import {
  decideCleanupUncertainItem,
  listCleanupReports,
  pendingCleanupUncertainItems,
} from '../recall/cleanup-report-service';
import { listFormalAssets } from '../recall/formal-assets';
import { buildCognitionInbox, type CognitionInboxItem } from '../recall/formal-assets/inbox';
import { latestAssetVersionDiff, type AssetVersionDiff } from '../recall/formal-assets/version-diff';
import { readInstalledSkillForAsset } from '../recall/skill-draft-service';
import { bindingHasDecision, bindingIsStale, readSkillBinding } from '../recall/skill-binding-service';
import { listCognitionSources } from '../recall/source-catalog';

const log = createLogger('cognition.inbox');

/** 来源目录里"已经用不了"的两档。pending/processing 只是还没好，不是坏了。 */
const UNAVAILABLE_SOURCE_STATUSES = new Set(['failed', 'paused']);

/** 待办条目的 id 前缀 → 它背后真正的对象。前缀由 formal-assets/inbox.ts 的
 *  `item()` 调用点决定，是**稳定契约**（同样的事实必须算出同样的 id，否则前端
 *  列表会闪）——所以这里按前缀分发，而不是重新算一遍"这条待办是什么"。 */
const CANDIDATE_ITEM_PREFIXES = ['candidate:', 'conflict:', 'ineligible:', 'evidence:'] as const;
/** 资产类待办：它们指向一条资产，但**没有**一键处置动作（缺边界要补条件、
 *  来源失效要换证据、敏感级要重新定级——都是编辑，不是开关）。 */
const ASSET_ITEM_PREFIXES = [
  'skill:', 'skill-upgrade:', 'sensitivity-up:', 'rule-scope:',
  'template:', 'rule-boundary:', 'sensitivity:', 'source:',
] as const;

export type CognitionInboxResolveAction = 'accept' | 'reject' | 'defer' | 'ignore';

export type CognitionInboxResolveErrorCode =
  /** id 形状就不对。 */
  | 'invalid_item_id'
  /** 这类待办今天没有一键处置动作（回执里写明该去哪里处理）。 */
  | 'unsupported_item_kind'
  /** 对象对，但这个动作不适用。 */
  | 'unsupported_action';

export interface CognitionInboxResolveResult {
  ok: true;
  /** 实际被动到的对象类型与状态，供前端原地更新。 */
  target: 'recall_candidate' | 'asset_change_proposal' | 'cleanup_uncertain';
  status: string;
}

/** 与 `recallCandidateError` 同约定：错误码挂在 Error 上，由 IPC 包装层透出成
 *  `{ ok:false, error, code }`——全仓统一一种错误形状，渲染层不必按通道分支。 */
function inboxResolveError(code: CognitionInboxResolveErrorCode, message: string): Error & { code: CognitionInboxResolveErrorCode } {
  const error = new Error(message) as Error & { code: CognitionInboxResolveErrorCode };
  error.code = code;
  return error;
}

/**
 * 待确认清单的处置通道（specs/008 T007；语义随 T046 扩展）。
 *
 * 分发原则：**只有真正落到了某个对象上的处置才算成功**。没有动作可做的类别
 * 抛 `unsupported_item_kind` 并指出该去哪里处理——被拦截的操作不得计为成功，
 * 假装成功比拒绝更糟（用户会以为事情办完了）。
 *
 * 尚未接线的两类（Phase 6/7 补分支，形态与候选类一致）：
 *   - 审批卡片「稍后处理」项（US-406 提议实体）
 *   - 大扫除拿不准项（US-403 整理报告 uncertain[]）
 */
export async function resolveCognitionInboxItem(
  userId: string,
  input: { id?: unknown; action?: unknown; note?: unknown },
): Promise<CognitionInboxResolveResult> {
  const id = typeof input.id === 'string' ? input.id : '';
  const action = typeof input.action === 'string' ? input.action : '';
  const note = typeof input.note === 'string' && input.note.trim() ? input.note.trim() : undefined;
  if (!id) throw inboxResolveError('invalid_item_id', '待办 id 不能为空');

  const candidatePrefix = CANDIDATE_ITEM_PREFIXES.find((prefix) => id.startsWith(prefix));
  if (candidatePrefix) {
    const candidateId = id.slice(candidatePrefix.length);
    if (!safeId(candidateId)) {
      throw inboxResolveError('invalid_item_id', `待办 id 里的候选编号不合法：${candidateId}`);
    }
    if (action === 'accept') {
      // 晋升闸门（证据/风险/相似）照旧生效：它拒绝的原因就是回执，不在这里复述一遍。
      await promoteRecallCandidate(userId, candidateId, { actor: 'user', ...(note ? { decisionReason: note } : {}) });
      return { ok: true, target: 'recall_candidate', status: 'promoted' };
    }
    if (action === 'reject') {
      await rejectRecallCandidate(userId, candidateId, note);
      return { ok: true, target: 'recall_candidate', status: 'rejected' };
    }
    if (action === 'defer') {
      await deferRecallCandidate(userId, candidateId, note);
      return { ok: true, target: 'recall_candidate', status: 'deferred' };
    }
    if (action === 'ignore') {
      await ignoreRecallCandidate(userId, candidateId, note);
      return { ok: true, target: 'recall_candidate', status: 'ignored' };
    }
    throw inboxResolveError(
      'unsupported_action',
      `候选类待办只支持 accept / reject / defer / ignore，收到 ${action || '(空)'}`,
    );
  }

  // AI 提议的实质变化（specs/008 US-406 / T046）：清单里的「稍后处理」项在这里处置。
  if (id.startsWith('proposal:')) {
    const proposalId = id.slice('proposal:'.length);
    if (!safeId(proposalId)) throw inboxResolveError('invalid_item_id', `待办 id 里的提议编号不合法：${proposalId}`);
    if (action !== 'accept' && action !== 'reject' && action !== 'defer') {
      throw inboxResolveError('unsupported_action', `提议类待办支持 accept / reject / defer，收到 ${action || '(空)'}`);
    }
    const result = await decideAssetChangeProposal(
      userId,
      proposalId,
      action === 'accept' ? 'confirm' : action === 'reject' ? 'reject' : 'defer',
    );
    return { ok: true, target: 'asset_change_proposal', status: result.state };
  }

  // 大扫除拿不准项（specs/008 US-403 / T046）：处置 = 给个意见，不是执行某个动作。
  // 「不管它」= reject（从清单移走、报告留档）；「回头再看」= defer。
  // accept 没有对应动作：当初就是因为我拿不准才没动手，凭空"接受"等于让我瞎猜。
  if (id.startsWith('cleanup:')) {
    const [, reportId, assetId] = id.split(':');
    if (!safeId(reportId) || !safeId(assetId)) throw inboxResolveError('invalid_item_id', `待办 id 不合法：${id}`);
    if (action === 'accept') {
      throw inboxResolveError(
        'unsupported_action',
        '这条待办没有可执行的建议动作——当初就是因为拿不准才没动手。请到资产详情里直接改，或选「拒绝」把它从清单移走。',
      );
    }
    if (action !== 'reject' && action !== 'defer') {
      throw inboxResolveError('unsupported_action', `大扫除拿不准项支持 reject / defer，收到 ${action || '(空)'}`);
    }
    await decideCleanupUncertainItem(userId, reportId, assetId, action === 'reject' ? 'dismissed' : 'deferred');
    return { ok: true, target: 'cleanup_uncertain', status: action === 'reject' ? 'dismissed' : 'deferred' };
  }

  if (ASSET_ITEM_PREFIXES.some((prefix) => id.startsWith(prefix))) {
    throw inboxResolveError(
      'unsupported_item_kind',
      '这类待办要改的是资产内容本身（补条件 / 换证据 / 重新定级），没有一键处置动作——请到资产详情里处理。',
    );
  }

  throw inboxResolveError('unsupported_item_kind', `没有处置动作能对应这个待办 id：${id}`);
}

export async function listCognitionInbox(userId: string): Promise<CognitionInboxItem[]> {
  // AI 提议的实质变化：待处理与"稍后处理"都进清单（"稍后不丢"就靠这条）。
  const pendingAssetChanges = await listAssetChangeProposals(userId)
    .then((proposals) => proposals
      .filter((proposal) => proposal.state === 'pending' || proposal.state === 'deferred')
      .map((proposal) => ({
        proposalId: proposal.id,
        assetId: proposal.assetId,
        ...(proposal.reason ? { reason: proposal.reason } : {}),
      })))
    .catch((error) => {
      log.warn('inbox asset change read degraded', { userId, error: (error as Error).message });
      return [];
    });

  const pendingCleanupItems = await listCleanupReports(userId)
    .then((reports) => pendingCleanupUncertainItems(reports))
    .catch((error) => {
      log.warn('inbox cleanup read degraded', { userId, error: (error as Error).message });
      return [];
    });

  const [assets, candidates, sourceGroups] = await Promise.all([
    listFormalAssets(userId),
    listRecallCandidates(userId).catch((error) => {
      log.warn('inbox candidate read degraded', { userId, error: (error as Error).message });
      return [];
    }),
    listCognitionSources(userId).catch((error) => {
      log.warn('inbox source read degraded', { userId, error: (error as Error).message });
      return [];
    }),
  ]);

  // skill_method 的 generatedSkillId 不在资产记录上，得问一次已安装 Skill。
  // 读失败时不能当成"还没生成"，否则会给用户一个可能重复创建 Skill 的假建议。
  // 资产本身仍保留给来源失效、敏感级等其他治理检查。
  const skillStateUnknownAssetIds = new Set<string>();
  const skillUpgradeCurrentAssetIds = new Set<string>();
  const skillUpgradeRejectedAssetIds = new Set<string>();
  const withSkillState = await Promise.all(assets.map(async (asset) => {
    if (asset.assetType !== 'skill_method' || asset.payload.kind !== 'skill_method') return asset;
    let generatedSkillId: string | undefined;
    try { generatedSkillId = await readInstalledSkillForAsset(userId, asset.assetId); }
    catch (error) {
      log.warn('inbox installed skill read degraded', {
        userId, assetId: asset.assetId, error: (error as Error).message,
      });
      skillStateUnknownAssetIds.add(asset.assetId);
      return asset;
    }
    try {
      const binding = await readSkillBinding(userId, asset.assetId);
      if (binding && !bindingIsStale(binding, asset.version)) {
        skillUpgradeCurrentAssetIds.add(asset.assetId);
      }
      if (binding && bindingHasDecision(binding, asset.version, ['rejected'])) {
        skillUpgradeRejectedAssetIds.add(asset.assetId);
      }
    } catch (error) {
      log.warn('inbox skill binding read degraded', {
        userId, assetId: asset.assetId, error: (error as Error).message,
      });
    }
    return generatedSkillId
      ? { ...asset, payload: { ...asset.payload, generatedSkillId } }
      : asset;
  }));

  // 变更类待办要知道"最近一次改了什么"。版本快照本来就存着全量内容，这里
  // 只是把相邻两版比一遍；读失败按"没有版本历史"处理——宁可少报一条变更，
  // 也不要凭空断言资产没变过。
  const latestDiffs = new Map<string, AssetVersionDiff>();
  await Promise.all(withSkillState.map(async (asset) => {
    try {
      const diff = latestAssetVersionDiff(asset.assetId, await listAbilityAssetVersions(userId, asset.assetId));
      if (diff) latestDiffs.set(asset.assetId, diff);
    } catch (error) {
      log.warn('inbox version history read degraded', {
        userId, assetId: asset.assetId, error: (error as Error).message,
      });
    }
  }));

  const unavailableSourceIds = new Set(sourceGroups
    .flatMap((group) => group.items)
    .filter((item) => UNAVAILABLE_SOURCE_STATUSES.has(item.status))
    .map((item) => item.id));

  // 同文本被分成两类的冲突表。跨候选判断，单条算不出来，能力判据要靠它才能
  // 得出与晋升闸门一致的 eligibility——`promoteRecallCandidate` 也是这么算的。
  const conflictingTypes = recallCandidateConflictingTypes(candidates);
  return buildCognitionInbox({
    assets: withSkillState,
    candidates: candidates.map((candidate) => ({
      id: candidate.id,
      status: candidate.status,
      ...(candidate.judgment ? { judgment: candidate.judgment } : {}),
      ...(candidate.suggestedType ? { suggestedType: candidate.suggestedType } : {}),
      // 下面这批内容字段不是给展示用的，是给能力判据跑正式资产准入门槛用的。
      // 少给一个，这条候选就会被当成"无法评估、不收紧"，不合格候选又会混回
      // `candidate_pending_review`——那正是假审批的入口。
      ...(candidate.value !== undefined ? { value: candidate.value } : {}),
      ...(candidate.summary !== undefined ? { summary: candidate.summary } : {}),
      ...(candidate.suggestedScope ? { suggestedScope: candidate.suggestedScope } : {}),
      ...(candidate.suggestedAction ? { suggestedAction: candidate.suggestedAction } : {}),
      ...(candidate.applicableWhen ? { applicableWhen: candidate.applicableWhen } : {}),
      ...(candidate.forbiddenWhen ? { forbiddenWhen: candidate.forbiddenWhen } : {}),
      ...(conflictingTypes.get(candidate.id)?.length
        ? { conflictingTypes: conflictingTypes.get(candidate.id)! }
        : {}),
      // 两个 refs 都要给：能力判据对"证据是否齐全"看的是 sourceRefs 与
      // evidenceRefs 两者（asCandidate 的不变量也是两者）。只给一个，待办算出
      // 来的可操作性就和 `recall.candidates.list` 分叉——同一条候选在两个页面
      // 上一个说能确认、一个说不能。
      ...(candidate.sourceRefs ? { sourceRefs: candidate.sourceRefs } : {}),
      ...(candidate.evidenceRefs ? { evidenceRefs: candidate.evidenceRefs } : {}),
    })),
    unavailableSourceIds,
    latestDiffs,
    pendingAssetChanges,
    pendingCleanupItems,
    skillStateUnknownAssetIds,
    skillUpgradeCurrentAssetIds,
    skillUpgradeRejectedAssetIds,
  });
}
