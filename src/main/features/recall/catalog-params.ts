/** Tunable catalog parameters. Values are provisional until labelled replay. */
export const CATALOG_RETRIEVAL = Object.freeze({
  rrfK: 20,
  semanticRankFloor: 0.25,
  strongLexicalCoverage: 0.35,
  strongSemanticCosine: 0.5,
  strongExactMatch: 0.7,
});

export const CATALOG_PRESENTATION = Object.freeze({
  maxStars: 5,
  maxPromptEntries: 12,
  promptTokenBudget: 900,
});

export const CATALOG_FEEDBACK = Object.freeze({
  appliedCountCap: 8,
  recentApplicationBonus: 0.05,
  halfLifeDays: 14,
});
