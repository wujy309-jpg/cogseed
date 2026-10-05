/** Classify once, then write through the established candidate/promotion contract. */
import { routeAndSubmit } from '../cognition_kernel/pipeline';
import type { ContentHome } from '../cognition_kernel/types';
import type { SaveRecallCandidateInput, RecallCandidateRecord } from '../recall/candidate-service';
export async function submitCognitionCandidate(userId: string, input: SaveRecallCandidateInput): Promise<RecallCandidateRecord> {
  const homeByType: Record<string, ContentHome> = { personal: 'personal_fact', fact: 'personal_fact', rule: 'rule', template: 'template', skill_method: 'method' };
  const explicitHome = homeByType[input.suggestedType];
  if (!explicitHome) throw new Error('invalid candidate type');
  const result = await routeAndSubmit(userId, { statement: input.judgment, explicitHome }, { canonicalInput: input });
  if (!result.candidate) throw new Error(result.error || 'candidate submission failed');
  return result.candidate;
}
