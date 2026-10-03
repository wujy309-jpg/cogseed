/** User-authored candidates carry their provenance in origin. This exemption
 * must survive edits; an AI candidate cannot gain it by changing its content. */
export function hasReviewableCandidateEvidence(candidate: {
  origin?: string;
  sourceRefs?: readonly unknown[];
  evidenceRefs?: readonly unknown[];
}): boolean {
  if (candidate.origin === 'manual') return true;
  const evidence = candidate.evidenceRefs ?? candidate.sourceRefs;
  // Partial legacy DTOs omit references; supplied empty arrays are real absence.
  return (candidate.sourceRefs === undefined || candidate.sourceRefs.length > 0)
    && (evidence === undefined || evidence.length > 0);
}
