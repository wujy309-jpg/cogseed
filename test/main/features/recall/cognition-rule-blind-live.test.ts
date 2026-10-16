/** One opt-in batch over the retained fixed corpus. Preflight captures the
 * production payload without dispatch; live uses the original shared ledger.
 * Original candidates, labels and earlier negative reports are read-only. */
import { expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { FORMATION_CASES, QUALITY_BENCHMARK_VERSION, QUALITY_TARGETS } from './cognition-quality-benchmark-fixture';
import { scoreFormationOutputs } from './cognition-quality-benchmark-score';

const relay = vi.hoisted(() => ({ mode: '', directory: '', calls: 0, request: undefined as unknown,
  response: undefined as any }));
const EXTENDED_BUDGET = process.env.COGSEED_RULE_BLIND_AUTHORIZED_EXTENSION === '1';
const CODING_PLAN = process.env.COGSEED_RECALL_LIVE_BILLING_MODE === 'coding-plan';
const OUTPUT_CAP = EXTENDED_BUDGET ? 8192 : 6144;
const HTTP_INPUT_CAP = EXTENDED_BUDGET ? 65_536 : 58_900;
const CASH_CEILING = EXTENDED_BUDGET ? 22 : 20;
vi.mock('../../../../src/main/features/auth', () => ({
  listEntriesForUser: async () => ({ entries: [{ provider: 'live', model: 'configured' }] }),
  hasConfiguredModelForUser: () => ({ configured: true }), hasConfiguredModel: () => ({ configured: true }),
  getConfiguredModelOAuthExpiredMessageForUser: () => null, getConfiguredModelOAuthExpiredMessage: () => null,
}));
vi.mock('../../../../src/main/model/core-agent/runner', () => ({ buildRunner: async (options: { systemPrompt: string }) => ({ runner: {
  run: async (input: { message: string }) => {
    const request = { systemPrompt: options.systemPrompt, message: input.message, maxOutputTokens: OUTPUT_CAP };
    relay.request = request;
    await fs.writeFile(path.join(relay.directory, 'request.json'), JSON.stringify(request, null, 2));
    if (relay.mode === 'preflight') throw new Error('blind audit preflight: transport intentionally disabled');
    if (relay.mode !== 'live' || process.env.COGSEED_RULE_BLIND_LIVE !== '1' || relay.calls !== 0)
      throw new Error('blind audit permits only one explicitly funded relay');
    relay.calls += 1;
    relay.response = await new Promise<any>((resolve, reject) => {
      const child = spawn(process.execPath, [path.resolve('test/helpers/recall-live-model-proxy.cjs')], {
        env: { ...process.env, COGSEED_RECALL_LIVE_MAX_INPUT_BYTES: String(HTTP_INPUT_CAP),
          COGSEED_RECALL_LIVE_RESERVED_CNY_CEILING: String(CASH_CEILING),
          ...(EXTENDED_BUDGET ? { COGSEED_RECALL_LIVE_CUMULATIVE_CNY_CEILING: '22',
            COGSEED_RECALL_LIVE_MAX_REQUESTS: '39' } : {}) }, stdio: ['pipe', 'pipe', 'pipe'],
      });
      let output = '', error = '';
      child.stdout.on('data', chunk => { output += chunk; });
      child.stderr.on('data', chunk => { error += chunk; });
      child.on('error', reject);
      child.on('close', code => {
        const marker = output.lastIndexOf('@@RECALL_LIVE@@');
        if (code || marker < 0) reject(new Error(`blind live relay failed (${code}): ${error.slice(-1200)}`));
        else try { resolve(JSON.parse(output.slice(marker + '@@RECALL_LIVE@@'.length).trim())); }
        catch (failure) { reject(failure); }
      });
      child.stdin.end(JSON.stringify(request));
    });
    await fs.writeFile(path.join(relay.directory, 'response.json'), JSON.stringify(relay.response, null, 2));
    return relay.response;
  },
} }) }));

async function temporaryRoot(value: string | undefined, label: string) {
  if (!value || !(await fs.realpath(value)).startsWith((await fs.realpath(os.tmpdir())) + path.sep))
    throw new Error(`${label} must be an existing OS-temporary fixture root`);
  return value;
}

it.skipIf(!['preflight', 'live'].includes(process.env.COGSEED_RULE_BLIND_AUDIT_MODE || ''))(
  'rebuilds R contracts blindly over the fixed original formation', async () => {
    const sourceRoot = await temporaryRoot(process.env.COGSEED_RULE_BLIND_SOURCE_ROOT, 'original corpus');
    const budgetRoot = await temporaryRoot(process.env.COGSEED_RECALL_LIVE_BUDGET_ROOT, 'original global budget');
    const auditRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cogseed-rule-blind-audit-'));
    relay.mode = process.env.COGSEED_RULE_BLIND_AUDIT_MODE!;
    relay.directory = auditRoot; relay.calls = 0; relay.request = undefined; relay.response = undefined;
    const ledgerFile = path.join(budgetRoot, 'live-cost-reservations.json');
    const ledgerBefore = JSON.parse(await fs.readFile(ledgerFile, 'utf8'));
    if (!CODING_PLAN && ledgerBefore.limitCny !== CASH_CEILING) throw new Error('matching authorized original cumulative budget required');
    if (!CODING_PLAN && EXTENDED_BUDGET && (ledgerBefore.requests.length !== 38
      || !ledgerBefore.authorizations?.some(row => row.fromCny === 20 && row.toCny === 22
        && row.startingRequestCount === 38 && row.maxNewRequests === 1)))
      throw new Error('the single authorized extension is missing or already consumed');
    const original = JSON.parse(await fs.readFile(path.join(sourceRoot, 'quality-formation-result.json'), 'utf8'));
    if (original.version !== QUALITY_BENCHMARK_VERSION || original.stageStatus !== 'review_ready')
      throw new Error('the unchanged original fixed capture is required');
    const uid = 'quality-benchmark-user';
    const directory = path.join(sourceRoot, uid, 'cloud', 'recall', 'records', 'candidates');
    const stored = await Promise.all((await fs.readdir(directory)).filter(name => name.endsWith('.json'))
      .map(async name => JSON.parse(await fs.readFile(path.join(directory, name), 'utf8'))));
    const formed = stored.filter(row => row.ownerId === uid && row.captureProvenance?.captureId === original.captureId && row.status === 'pending_review');
    expect(formed).toHaveLength(12);
    const transcriptDirectory = path.join(sourceRoot, 'benchmark-model-transcripts');
    const groundingName = (await fs.readdir(transcriptDirectory)).find(name => name.includes('memory-formation-recall-'))!;
    const prior = JSON.parse(JSON.parse(await fs.readFile(path.join(transcriptDirectory, groundingName), 'utf8')).request.message);
    expect(prior.completeConversationContext).toHaveLength(24);
    const proof = formed[0].captureProvenance;
    const items = formed.map((row, index) => {
      const selected = new Set(row.evidenceRefs.filter(ref => ref.subtype === 'message').map(ref => ref.id));
      const sources = prior.completeConversationContext.filter(message => message.role === 'user').flatMap(message => {
        const approvedQuotes = proof.valueJudgment.evidence
          .filter(ref => ref.messageId === message.id && selected.has(ref.sourceId)).map(ref => ref.quote);
        return approvedQuotes.length ? [{ label: message.label, text: message.text, approvedQuotes }] : [];
      });
      const plan = row.ontologyFormation;
      return { index, sources, candidate: { judgment: row.judgment, value: row.value, suggestedScope: row.suggestedScope,
        suggestedAction: row.suggestedAction, scopePolicy: row.scopePolicy,
        applicableWhen: row.applicableWhen, forbiddenWhen: row.forbiddenWhen,
        ...(plan ? { ontologyChanges: { actions: plan.actions, refs: plan.refs, reason: plan.reason, evidence: plan.evidence } } : {}) } };
    });
    vi.stubEnv('COGSEED_WORKSPACE_ROOT', auditRoot);
    try {
      const { assessFormationBatch } = await import('../../../../src/main/features/recall/formation-batch-assessment');
      const { reviseFormationRuleSemantics } = await import('../../../../src/main/features/recall/ontology-rule-semantics');
      const { emptyOntologyDocument } = await import('../../../../src/main/features/cognition/ontology/model');
      const { applyOntologyCommand } = await import('../../../../src/main/features/cognition/ontology/commands');
      const { parseOntologyFormationProposal, validateOntologyFormationScope } = await import('../../../../src/main/features/recall/ontology-formation');
      const records = Array.isArray(prior.ontology.records) ? prior.ontology.records : Object.values(prior.ontology.records);
      // Restore the same five canonical records through the existing pure
      // command path so preview has matching history/receipt invariants too.
      const canonical = applyOntologyCommand(emptyOntologyDocument(uid), { commandId: 'blind-audit-original-context', expectedRevision: 0,
        actions: [...records].sort((a, b) => ['module', 'definition', 'entity'].indexOf(a.kind) - ['module', 'definition', 'entity'].indexOf(b.kind))
          .map(value => {
            const { id, version, status, source, createdAt, updatedAt, ...record } = value;
            return { intent: 'create' as const, recordId: id, record, sourceLabel: source.label };
          }) }, '2026-10-14T19:00:00.000Z').document;
      expect(canonical.revision).toBe(prior.ontology.revision);
      expect(Object.keys(canonical.records)).toHaveLength(5);
      let batch: Awaited<ReturnType<typeof assessFormationBatch>> | undefined, failure: unknown;
      try {
        batch = await assessFormationBatch(uid, { sessionId: 'memory-formation-source-rule-blind-v3', items,
          contextMessages: prior.completeConversationContext, summary: prior.summary,
          existing: { assets: prior.existingAssets, coverage: prior.comparisonCoverage },
          ontology: prior.ontology, feedback: prior.feedback, modelCandidates: [{ provider: 'live', model: 'configured' }] });
      } catch (error) { failure = error; }
      const ledgerAfter = JSON.parse(await fs.readFile(ledgerFile, 'utf8'));
      const transport = relay.request as { systemPrompt: string; message: string; maxOutputTokens: number } | undefined;
      const common = { version: QUALITY_BENCHMARK_VERSION, mode: relay.mode,
        billingMode: CODING_PLAN ? 'coding-plan' : 'historical-cash-reservation',
        sourceRoot, auditRoot, originalCaptureId: original.captureId, originalCandidates: 12, originalNegativeUnits: 8,
        negativeEvidence: 'unchanged original capture: 0 false positives among 8 negatives; no re-extraction in this audit',
        bodyResampling: false, originalDomainWrites: 0, originalCompleteContractAccuracy: { numerator: 4, denominator: 12 },
        targets: QUALITY_TARGETS, relayRequests: relay.calls,
        actualHttpRequests: relay.mode === 'preflight' ? 0 : relay.response?.modelHttpRequests
          ?? (CODING_PLAN ? undefined : ledgerAfter.requests.length - ledgerBefore.requests.length),
        additionalReservedCny: ledgerAfter.reservedCny - ledgerBefore.reservedCny,
        cumulativeReservedCny: ledgerAfter.reservedCny,
        limits: { httpInputBytes: CODING_PLAN ? undefined : HTTP_INPUT_CAP, outputTokens: OUTPUT_CAP,
          oneRequestWorstCny: CODING_PLAN ? undefined : (HTTP_INPUT_CAP * 1.4 + OUTPUT_CAP * 4.4) / 1_000_000 * 10 },
        serializedRelayBytes: transport ? Buffer.byteLength(JSON.stringify(transport)) : undefined,
        error: failure instanceof Error ? failure.message : undefined };
      if (relay.mode === 'preflight') {
        expect(batch).toBeUndefined();
        expect(relay.request).toBeDefined();
        expect(common.actualHttpRequests).toBe(0);
        await fs.writeFile(path.join(auditRoot, 'preflight.json'), JSON.stringify(common, null, 2));
        process.stdout.write(`RULE_BLIND_PREFLIGHT ${auditRoot}\n`);
        return;
      }
      if (!batch) {
        await fs.writeFile(path.join(auditRoot, 'result.json'), JSON.stringify({ ...common, passed: false,
          acceptedCandidates: 0, successfulCanonicalPreviews: 0 }, null, 2));
        process.stdout.write(`RULE_BLIND_RESULT ${auditRoot}\n`);
        throw failure || new Error('production blind parser did not accept the response');
      }
      const sourceIds = Object.fromEntries(original.unitChecks.map(row => [row.id, row.sourceId]));
      const reviewed = batch.assessments.map(assessment => {
        const row = formed[assessment.index];
        const owned = items[assessment.index].candidate.ontologyChanges;
        const eligible = Object.entries(assessment.checks).filter(([key]) => key !== 'evidence').every(([, value]) => value === true)
          && assessment.uncertaintyDisposition !== 'content_unresolved';
        const revised = assessment.ruleRevisions?.length
          ? reviseFormationRuleSemantics(owned, assessment.ruleRevisions, Object.values(canonical.records)) : owned;
        const plan = eligible && revised ? validateOntologyFormationScope(uid, canonical,
          parseOntologyFormationProposal(structuredClone(canonical), row.id, revised, row.judgment,
            '2026-10-14T19:00:00.000Z'), row.scopePolicy) : undefined;
        const rules = plan?.previewChanges.filter(change => change.after.kind === 'rule').map(change => change.after) || [];
        const unitIds: string[] = original.proposalChecks.find(item => item.candidateId === row.id)?.citedUnits || [];
        const obligation = unitIds.some(id => ['f02', 'f03', 'f04', 'f05', 'f06', 'f07', 'f08', 'f12'].includes(id));
        const hasR = (row.ontologyFormation?.previewChanges || []).some(change => change.after.kind === 'rule');
        const modalitySupported = !hasR || rules.length > 0 && rules.every(rule =>
          obligation ? rule.strength === 'required' : ['default', 'required'].includes(rule.strength));
        const bindingSupported = rules.every(rule => rule.condition === null && rule.effect.kind === 'note');
        const exceptionSupported = rules.every(rule => unitIds.includes('f12')
          ? /普通例会/.test(rule.exception) && /不|除外/.test(rule.exception)
          : unitIds.includes('f03') ? /闲聊/.test(rule.exception) : !/临时闲聊/.test(rule.exception));
        const bodyUnchanged = rules.every(rule => rule.requirement === row.judgment);
        const passed = eligible && (!owned || !!plan && !plan.blockedReasons.length)
          && modalitySupported && bindingSupported && exceptionSupported && bodyUnchanged;
        return { candidateId: row.id, unitIds, passed, eligible, assessment,
          modalitySupported, bindingSupported, exceptionSupported, bodyUnchanged, preview: plan,
          candidate: { ...row, ...(plan ? { ontologyFormation: plan } : {}) } };
      });
      const accepted = reviewed.filter(row => row.passed);
      const content = scoreFormationOutputs(accepted.map(row => row.candidate), sourceIds, 'benchmark-project');
      const passed = accepted.length === 12 && content.recall.value! >= QUALITY_TARGETS.formationRecall
        && content.precision.value! >= QUALITY_TARGETS.formationPrecision;
      const report = { ...common, passed, acceptedCandidates: accepted.length,
        completeContractRecall: { numerator: accepted.length, denominator: 12, value: accepted.length / 12 },
        completeContractPrecision: { numerator: accepted.length, denominator: formed.length, value: accepted.length / formed.length },
        content, reviewed, originalUnits: FORMATION_CASES.map(unit => ({ id: unit.id, positive: unit.positive })) };
      await fs.writeFile(path.join(auditRoot, 'result.json'), JSON.stringify(report, null, 2));
      process.stdout.write(`RULE_BLIND_RESULT ${auditRoot}\n`);
      expect(common.actualHttpRequests).toBeLessThanOrEqual(1);
      if (!CODING_PLAN) expect(common.cumulativeReservedCny).toBeLessThanOrEqual(CASH_CEILING);
      expect(passed).toBe(true);
    } finally { vi.unstubAllEnvs(); }
  }, 180_000);
