/** Historical feedback never silently evaluates today's asset body. Read the
 * exact assessed version and current version under today's source/scope grant. */
import { readAbilityAsset, readAbilityAssetVersionSnapshot } from './asset-service';
import { getConversation } from '../chats';
import type { NightlyFeedbackObservation } from './nightly-feedback';
export async function readFeedbackVersionContext(userId: string, cid: string, observations: NightlyFeedbackObservation[]) {
  if (!observations.length) return [];
  const conversation = await getConversation(userId, cid);
  const context = { projectId: conversation?.project_id || undefined, workspaceId: conversation?.space_id || undefined,
    conversationKind: conversation?.kind || undefined };
  const { filterRecallAssetsForAgentRead } = await import('./prompt-injection');
  return Promise.all(observations.map(async observation => {
    try {
      const head = await readAbilityAsset(userId, observation.assetId);
      const evaluated = await readAbilityAssetVersionSnapshot(userId, head.id, observation.assetVersion);
      const currentVersion = String(head.activeVersion || head.version);
      const current = await readAbilityAssetVersionSnapshot(userId, head.id, currentVersion);
      if (!evaluated || !current || !(await filterRecallAssetsForAgentRead(userId, [head], context)).length
        || !(await filterRecallAssetsForAgentRead(userId, [{ ...head, ...evaluated, scope: head.scope,
          scopePolicy: head.scopePolicy, status: head.status, evidenceRefs: evaluated.evidenceRefs || head.evidenceRefs }], context)).length) throw new Error('feedback source unavailable');
      if (!(await filterRecallAssetsForAgentRead(userId, [{ ...head, ...current, scope: head.scope,
        scopePolicy: head.scopePolicy, status: head.status, evidenceRefs: current.evidenceRefs || head.evidenceRefs }], context)).length) throw new Error('current feedback source unavailable');
      const after = await readAbilityAsset(userId, head.id);
      if (JSON.stringify(after) !== JSON.stringify(head)) throw new Error('feedback baseline changed');
      return { ...observation, versionContext: { status: currentVersion === observation.assetVersion ? 'current' : 'historical',
        evaluated: { version: observation.assetVersion, statement: evaluated.statement, applicableWhen: evaluated.applicableWhen, forbiddenWhen: evaluated.forbiddenWhen },
        current: { version: currentVersion, statement: current.statement, applicableWhen: current.applicableWhen, forbiddenWhen: current.forbiddenWhen } } };
    } catch { return { ...observation, versionContext: { status: 'unavailable' } }; }
  }));
}
