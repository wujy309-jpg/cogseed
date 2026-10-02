/**
 * cognition_kernel/judge — 归属判定引擎（2026-10-02 改版，取代写死的规则表）。
 *
 * 分工（这是本次改版的核心）：
 *   · **判断**：大模型读数——内容语义 + 用户本体（T-Box 字段 / R-Box 规则）
 *     + 用户自己的归属规则与历次纠正样例 → 输出 { home, confidence, reason, ruleIds }
 *   · **闸门**：代码硬约束——三档门控、两池互斥、判定结果永不直接写用户档案
 *     （高置信也只进候选池，等用户点头）。安全与权威不交给模型。
 *
 * 三档门控（照 Jev 参考实现已验证的 auto/floor 形状）：
 *   ≥ AUTO  → 'auto'        进候选池（**不写档案**）
 *   ≥ FLOOR → 'ask'         问你一句
 *   < FLOOR → 'unclassified' 不猜、不进任何家
 *
 * 降级：模型不可用／回复不可解析 → 'unclassified'（宁可未分类，不制造错误归属）。
 * 留痕：每次判定记一条 routing-decisions.jsonl，可审计、可回放、可做评测集。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import type { buildRunner } from '../../model/core-agent/runner';
import { createLogger } from '../../logger';
import { userCognitionDir } from '../../paths';
import { nowIso, safeId } from '../../storage';
import { HOME_DEFINITIONS, UNCLASSIFIED } from './routing';
import { readRoutingRules, type RoutingCorrection, type RoutingRule, type RoutingRulesDoc } from './routing_rules';
import type { ContentHome } from './types';

const log = createLogger('cognition-routing-judge');

/** ≥ 此值：自动归入候选池（仍然不写档案，等用户点头）。 */
export const AUTO_CONFIDENCE = 0.75;
/** ≥ 此值：转成一次提问；低于此值：未分类。 */
export const FLOOR_CONFIDENCE = 0.45;

const MAX_STATEMENT_FOR_PROMPT = 800;
const MAX_ONTOLOGY_CHARS = 1800;
const MAX_RULES_IN_PROMPT = 20;
const MAX_CORRECTIONS_IN_PROMPT = 12;
const MAX_REASON_CHARS = 120;
const MAX_AUDIT_STATEMENT_CHARS = 300;

const HOMES: ReadonlySet<string> = new Set<ContentHome>(HOME_DEFINITIONS.map((entry) => entry.home));

export interface ContentToRoute {
  statement: string;
  /** 生产者给的弱信号（模型建议/来源通道）：只作参考，不作判定依据。 */
  suggestedType?: string;
  sourceKind?: string;
}

export type RoutingOutcome = 'auto' | 'ask' | 'unclassified';

export interface RoutingJudgement {
  outcome: RoutingOutcome;
  /** outcome='unclassified' 时为 null。 */
  home: ContentHome | null;
  confidence: number;
  reason: string;
  matchedRuleIds: string[];
  /** 'llm' = 模型判定；'degraded' = 模型不可用/不可解析（未分类）。 */
  model: 'llm' | 'degraded';
}

export interface JudgeOptions {
  /** 测试缝：与 semantic-review / personal_ontology_router 同一手法。 */
  buildRunnerFn?: typeof buildRunner;
  readRulesFn?: (uid: string) => RoutingRulesDoc;
  ontologyContextFn?: (uid: string) => Promise<string>;
}

function clip(value: unknown, max: number): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** T-Box + R-Box 摘要：让判定"按本体规则"发生，而不是凭空猜。 */
export async function buildOntologyContext(uid: string): Promise<string> {
  try {
    const [{ loadOntologyTaxonomy }, { loadOntologyRules }] = await Promise.all([
      import('../recall/ontology-taxonomy'),
      import('../recall/ontology-rules'),
    ]);
    const [taxonomy, rules] = await Promise.all([loadOntologyTaxonomy(uid), loadOntologyRules(uid)]);
    const lines: string[] = [];

    const groups = Array.isArray(taxonomy?.groups) ? taxonomy.groups : [];
    if (groups.length) {
      lines.push('分类与字段（T-Box）：');
      for (const group of groups.slice(0, 12)) {
        const fields = (group.fields || []).map((field) => field.name).filter(Boolean).slice(0, 20);
        if (!fields.length) continue;
        lines.push('- ' + clip(group.title, 60) + '：' + fields.join('、'));
      }
    }

    const relationRules = Array.isArray(rules?.rules) ? rules.rules : [];
    if (relationRules.length) {
      lines.push('用户已有的关系规则（R-Box）：');
      for (const rule of relationRules.slice(0, 20)) {
        lines.push('- ' + clip(rule.subject, 40) + ' → ' + clip(rule.relation, 40) + ' → ' + clip(rule.object, 60));
      }
    }

    if (!lines.length) return '（用户尚未建立本体：没有分类字段，也没有关系规则。）';
    return lines.join('\n').slice(0, MAX_ONTOLOGY_CHARS);
  } catch (error) {
    log.warn('ontology context unavailable; judging without it', {
      uid,
      error: String((error as Error)?.message || error),
    });
    return '（本体上下文读取失败：本次判定缺少本体依据，请对不确定的内容给低置信度。）';
  }
}

export function buildJudgePrompt(input: {
  statement: string;
  suggestedType?: string;
  sourceKind?: string;
  ontology: string;
  rules: readonly RoutingRule[];
  corrections: readonly RoutingCorrection[];
}): string {
  const homes = HOME_DEFINITIONS.map((entry) => (
    '- ' + entry.home + '（' + entry.label + '）：' + entry.definition + '\n  例：' + entry.examples.join('；')
  )).join('\n');

  const userRules = input.rules.length
    ? input.rules.slice(-MAX_RULES_IN_PROMPT).map((rule) => '- [' + rule.id + '] 归 ' + rule.home + '：' + rule.note).join('\n')
    : '（暂无）';

  const corrections = input.corrections.length
    ? input.corrections.slice(-MAX_CORRECTIONS_IN_PROMPT)
        .map((item) => '- "' + clip(item.statement, 120) + '"：用户把它从 ' + (item.fromHome || '未分类') + ' 改成 ' + item.toHome
          + (item.note ? '（原因：' + item.note + '）' : ''))
        .join('\n')
    : '（暂无）';

  const hints = [
    input.suggestedType ? '生产者建议类型=' + input.suggestedType : '',
    input.sourceKind ? '来源通道=' + input.sourceKind : '',
  ].filter(Boolean).join('，') || '（无）';

  return [
    '你是「认知归属判定员」。判断下面这条内容该进用户认知的哪个家。',
    '',
    '【家的定义（只能选一个，或给 ' + UNCLASSIFIED + '）】',
    homes,
    '',
    '【用户的本体】',
    input.ontology,
    '',
    '【用户自己的归属规则】',
    userRules,
    '',
    '【用户过去纠正过的样例】',
    corrections,
    '',
    '【待判内容】',
    clip(input.statement, MAX_STATEMENT_FOR_PROMPT),
    '（参考信号，不构成判据：' + hints + '）',
    '',
    '【输出】只输出一个 JSON 对象，不要解释、不要代码块：',
    '{"home":"personal_fact|rule|template|method|task_local|experience|' + UNCLASSIFIED + '",'
      + '"confidence":0.0到1.0,"reason":"一句话依据（不超过60字）","matchedRuleIds":["命中的用户规则 id，没有就空数组"]}',
    '判不准就给低置信度或直接 ' + UNCLASSIFIED + '——不要猜。',
    '特别注意：' + 'task_local' + ' 是项目/任务的临时事实（不进长期档案）；'
      + 'experience' + ' 只对某一次任务成立；这两类最容易与 personal_fact 混淆。',
  ].join('\n');
}

/** 解析模型回复：宽松取第一个 JSON 对象，字段严格收口。 */
export function parseJudgeReply(text: string): {
  home: ContentHome | null;
  confidence: number;
  reason: string;
  matchedRuleIds: string[];
} | null {
  const match = String(text || '').match(/\{[\s\S]*\}/);
  if (!match) return null;
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(match[0]) as Record<string, unknown>;
  } catch {
    return null;
  }
  const homeText = String(raw.home ?? '').trim();
  const home = HOMES.has(homeText) ? (homeText as ContentHome) : null;
  if (!home && homeText !== UNCLASSIFIED) return null;
  const rawConfidence = Number(raw.confidence);
  const confidence = Number.isFinite(rawConfidence) ? Math.min(1, Math.max(0, rawConfidence)) : 0;
  const reason = clip(raw.reason, MAX_REASON_CHARS);
  const matchedRuleIds = Array.isArray(raw.matchedRuleIds)
    ? raw.matchedRuleIds.filter((id): id is string => typeof id === 'string').slice(0, 8)
    : [];
  return { home, confidence, reason, matchedRuleIds };
}

function gate(parsed: { home: ContentHome | null; confidence: number; reason: string; matchedRuleIds: string[] }): RoutingJudgement {
  if (!parsed.home) {
    return {
      outcome: 'unclassified',
      home: null,
      confidence: parsed.confidence,
      reason: parsed.reason || '模型判定为未分类',
      matchedRuleIds: parsed.matchedRuleIds,
      model: 'llm',
    };
  }
  if (parsed.confidence >= AUTO_CONFIDENCE) {
    return { outcome: 'auto', home: parsed.home, confidence: parsed.confidence, reason: parsed.reason, matchedRuleIds: parsed.matchedRuleIds, model: 'llm' };
  }
  if (parsed.confidence >= FLOOR_CONFIDENCE) {
    return { outcome: 'ask', home: parsed.home, confidence: parsed.confidence, reason: parsed.reason, matchedRuleIds: parsed.matchedRuleIds, model: 'llm' };
  }
  return {
    outcome: 'unclassified',
    home: null,
    confidence: parsed.confidence,
    reason: parsed.reason || '置信度低于下限',
    matchedRuleIds: parsed.matchedRuleIds,
    model: 'llm',
  };
}

/** 判定一条内容该进哪个家。永不抛错：失败一律回退为 unclassified。 */
export async function judgeContentHome(
  uid: string,
  content: ContentToRoute,
  options: JudgeOptions = {},
): Promise<RoutingJudgement> {
  const statement = clip(content?.statement, MAX_STATEMENT_FOR_PROMPT);
  if (!safeId(uid) || !statement) {
    return { outcome: 'unclassified', home: null, confidence: 0, reason: '内容为空或用户无效', matchedRuleIds: [], model: 'degraded' };
  }
  try {
    const readRules = options.readRulesFn ?? readRoutingRules;
    const buildContext = options.ontologyContextFn ?? buildOntologyContext;
    const [rulesDoc, ontology] = await Promise.all([Promise.resolve(readRules(uid)), buildContext(uid)]);

    const build = options.buildRunnerFn ?? (await import('../../model/core-agent/runner')).buildRunner;
    const tail = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    const { runner } = await build({
      sessionId: 'memory-extract-recall-routing-judge-' + tail,
      userId: uid,
    });
    const reply = await runner.runReflection(buildJudgePrompt({
      statement,
      ontology,
      rules: rulesDoc.rules,
      corrections: rulesDoc.corrections,
      ...(content.suggestedType ? { suggestedType: String(content.suggestedType) } : {}),
      ...(content.sourceKind ? { sourceKind: String(content.sourceKind) } : {}),
    }));
    const parsed = parseJudgeReply(reply || '');
    if (!parsed) {
      log.warn('routing judge reply unparseable', { uid });
      return { outcome: 'unclassified', home: null, confidence: 0, reason: '模型回复不可解析', matchedRuleIds: [], model: 'degraded' };
    }
    const judgement = gate(parsed);
    void recordRoutingDecision(uid, { content: statement, judgement });
    return judgement;
  } catch (error) {
    log.warn('routing judge unavailable', { uid, error: String((error as Error)?.message || error) });
    return { outcome: 'unclassified', home: null, confidence: 0, reason: '判定不可用', matchedRuleIds: [], model: 'degraded' };
  }
}

/** 判定留痕（best-effort）：可审计、可回放，也是将来评测判定的数据来源。 */
export async function recordRoutingDecision(
  uid: string,
  record: { content: string; judgement: RoutingJudgement },
): Promise<void> {
  if (!safeId(uid)) return;
  try {
    const file = path.join(userCognitionDir(uid), 'routing-decisions.jsonl');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const line = JSON.stringify({
      at: nowIso(),
      content: clip(record.content, MAX_AUDIT_STATEMENT_CHARS),
      outcome: record.judgement.outcome,
      home: record.judgement.home,
      confidence: record.judgement.confidence,
      reason: clip(record.judgement.reason, MAX_REASON_CHARS),
      matchedRuleIds: record.judgement.matchedRuleIds,
      model: record.judgement.model,
    });
    fs.appendFileSync(file, line + '\n', 'utf8');
  } catch (error) {
    log.warn('routing decision not recorded', { uid, error: String((error as Error)?.message || error) });
  }
}
