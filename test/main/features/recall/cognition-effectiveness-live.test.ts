/** Opt-in comparison of the isolated outputs created by cognition-quality-live.
 * COGSEED_RECALL_LIVE_BUDGET_ROOT must point to that scenario's fixture root,
 * including its persisted executions, transfer proof and original output cache. */
import { expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { drainMainRuntimeForTest } from '../../../helpers/drain-main-runtime';
vi.mock('../../../../src/main/model/core-agent/runner', () => ({ buildRunner: async (options: { systemPrompt: string }) => ({ runner: {
  run: async (input: { message: string }) => {
    const root = process.env.COGSEED_RECALL_LIVE_BUDGET_ROOT!;
    const response = await new Promise<any>((resolve, reject) => {
      const child = spawn(process.execPath, [path.resolve('test/helpers/recall-live-model-proxy.cjs')], {
        env: { ...process.env, COGSEED_RECALL_LIVE_MAX_INPUT_BYTES: '40000' }, stdio: ['pipe', 'pipe', 'pipe'] });
      let output = '', error = '';
      child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { error += chunk; });
      child.on('error', reject); child.on('close', code => {
        const at = output.lastIndexOf('@@RECALL_LIVE@@');
        if (code || at < 0) reject(new Error(`effect live adapter failed (${code}): ${error.slice(-1200)}`));
        else try { resolve(JSON.parse(output.slice(at + '@@RECALL_LIVE@@'.length).trim())); } catch (error) { reject(error); }
      });
      child.stdin.end(JSON.stringify({ systemPrompt: options.systemPrompt, message: input.message, maxOutputTokens: 4096 }));
    });
    await fs.writeFile(path.join(root, 'effectiveness-located-transcript.json'), JSON.stringify({
      request: { systemPrompt: options.systemPrompt, message: input.message }, response }, null, 2));
    return response;
  },
} }) }));

it.skipIf(process.env.COGSEED_RECALL_LIVE !== '1')('grounds a real comparison in host file locations and invalidates changed output', async () => {
  const root = process.env.COGSEED_RECALL_LIVE_BUDGET_ROOT!;
  if (!(await fs.realpath(root)).startsWith((await fs.realpath(os.tmpdir())) + path.sep)) throw new Error('disposable fixture root required');
  vi.stubEnv('COGSEED_WORKSPACE_ROOT', root);
  const uid = 'quality-live-user', cid = 'quality-live-conversation';
  const { chatAttachmentDirForConversation } = await import('../../../../src/main/util/project-layout');
  const proofs = await import('../../../../src/main/features/recall/proof-service');
  const feedback = await import('../../../../src/main/features/recall/effectiveness-feedback');
  const transfers = await proofs.listTransferProofs(uid);
  const transfer = transfers.find(row => row.receiptExecutionId === 'turn-quality-result');
  expect(transfer).toBeDefined();
  const ledger = () => fs.readFile(path.join(root, 'live-cost-reservations.json'), 'utf8').then(JSON.parse);
  const before = await ledger();
  const resultFile = path.join(chatAttachmentDirForConversation(uid, cid), 'quality-result.md');
  // Restore the original real-model artifact from its unchanged fixture cache;
  // do not regenerate, repair or substitute a model's observed output.
  const original = await fs.readFile(path.join(root, 'quality-result.md'), 'utf8');
  await fs.writeFile(resultFile, original);
  try {
    const assessed = await feedback.recordEffectivenessFeedback(uid, { transferProofId: transfer!.id,
      feedback: 'positive', baselineExecutionId: 'turn-quality-baseline',
      note: '按同一标准比较两份原始文件，使用宿主给出的精确证据位置；同样好就记无改善。' });
    expect(assessed.comparison).toBeDefined();
    expect(assessed.comparison!.outcome).not.toBe('insufficient_evidence');
    expect(assessed.comparison!.evidence).toHaveLength(transfer!.assetVersions.length);
    for (const evidence of assessed.comparison!.evidence) {
      expect(evidence.baselineRef?.kind).toBe('file');
      expect(evidence.resultRef?.kind).toBe('file');
      expect(original).toContain(evidence.resultQuote);
    }
    const grounded = await ledger();
    await fs.writeFile(resultFile, '隔离验收：文件已变化，原效果不能继续认定。');
    const changed = await feedback.recordEffectivenessFeedback(uid, { transferProofId: transfer!.id,
      feedback: 'positive', baselineExecutionId: 'turn-quality-baseline', note: '文件版本变化后重新核查原结论。' });
    expect(changed.outcome).toBe('insufficient_evidence');
    expect((await ledger()).requests.length).toBe(grounded.requests.length);
    const report = { passed: true, model: 'glm-5.2', outcome: assessed.comparison!.outcome,
      evidence: assessed.comparison!.evidence, changedArtifactOutcome: changed.outcome,
      actualRequests: grounded.requests.length - before.requests.length,
      additionalReservedCny: grounded.reservedCny - before.reservedCny,
      cumulativeReservedCny: grounded.reservedCny };
    const file = path.join(root, 'effectiveness-located-result.json');
    await fs.writeFile(file, JSON.stringify(report, null, 2));
    process.stdout.write(`EFFECTIVENESS_LIVE_RESULT ${file}\n`);
  } finally { await drainMainRuntimeForTest(uid); vi.unstubAllEnvs(); }
}, 180_000);
