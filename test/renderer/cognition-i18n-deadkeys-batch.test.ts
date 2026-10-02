/** 死键批次门禁（P-r3-36 · 预审决策卡 2026-10-01 纠缠组 8 · wo-b4）。
 *
 * 认知资产域死键批次「四语全删 + 门禁」的防回流闸。批次构成与逐键裁决依据
 * 见 reports/认知资产质检循环-20260930/死键动态拼接核查-b4.md（前置②核查
 * 报告：三层审计 + 动态拼接逐点溯源，含工具模板盲区修正）：
 * - renderer 删 127 键（层1+2 零引用 60 + 层3豁免裁决仍死 67）；
 * - main 删 9 键（4 直删 + 5 迁移后删）；
 * - main→renderer 豁免迁移 5 键（cognition.audit_approval_*，供批 12 P-r3-44
 *   审批审计标签复用——先删后用=空，故先迁移；接线前它们在 renderer 暂无
 *   消费点，属**登记在案的豁免**，不是死键回流）；
 * - 层3动态拼接救活 33 键（变量取值空间实证可达），必须四语在位——尤其
 *   p3394.wake.status.* 曾被审计工具的模板尾点盲区误判死键，这里反向钉住。
 */
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const root = path.join(__dirname, '../..');
const LOCALES = ['zh', 'en', 'ja', 'pt'] as const;

const rendererTables = Object.fromEntries(LOCALES.map((name) => [
  name,
  JSON.parse(fs.readFileSync(path.join(root, `src/renderer/locales/${name}.json`), 'utf8')),
])) as Record<string, Record<string, unknown>>;
const mainTables = Object.fromEntries(LOCALES.map((name) => [
  name,
  JSON.parse(fs.readFileSync(path.join(root, `src/main/locales/${name}.json`), 'utf8')),
])) as Record<string, Record<string, unknown>>;

const RENDERER_DEAD_KEYS = [
    'cognition.candidate_scope_label', 'cognition.capture.evidence',
    'cognition.capture_metric_review', 'cognition.capture_review_auto',
    'cognition.capture_review_auto_note', 'cognition.capture_review_manual',
    'cognition.capture_review_manual_note', 'cognition.capture_review_title',
    'cognition.cleanup_run', 'cognition.inbox_action_set_boundary', 'cognition.inbox_form_open',
    'cognition.inbox_group_not_written', 'cognition.judgment',
    'cognition.organize_advanced_settings', 'cognition.review_card_open_detail',
    'cognition.review_lead_minutes', 'cognition.settings_back_to_activity',
    'cognition.settings_back_to_activity_hint', 'cognition.summary',
    'cognition.tag_manage_settings_hint', 'kb.glossary.candidates_title',
    'kb.meetingRef.channel_exact', 'kb.meetingRef.receipt_decision_accept',
    'kb.meetingRef.receipt_decision_unreject', 'kb.transcriptCorrect.apply_blocked',
    'kb.transcriptCorrect.compare', 'kb.transcriptCorrect.compare_failed',
    'kb.transcriptCorrect.compare_no_rewrite', 'kb.transcriptCorrect.compare_no_source',
    'kb.transcriptCorrect.compare_prompt', 'kb.transcriptCorrect.compare_result',
    'kb.transcriptCorrect.compare_running', 'kb.transcriptCorrect.issue_at',
    'kb.transcriptCorrect.issue_badge', 'kb.transcriptCorrect.issue_cancel',
    'kb.transcriptCorrect.issue_empty', 'kb.transcriptCorrect.issue_find_suspects',
    'kb.transcriptCorrect.issue_finding', 'kb.transcriptCorrect.issue_hint',
    'kb.transcriptCorrect.issue_list_title', 'kb.transcriptCorrect.issue_mark',
    'kb.transcriptCorrect.issue_reason_ambiguous_name',
    'kb.transcriptCorrect.issue_reason_asr_unrecoverable',
    'kb.transcriptCorrect.issue_reason_mixed_speech',
    'kb.transcriptCorrect.issue_reason_unknown_entity', 'kb.transcriptCorrect.issue_section',
    'kb.transcriptCorrect.issue_section_count', 'kb.transcriptCorrect.issue_summary',
    'kb.transcriptCorrect.issue_suspect_row', 'kb.transcriptCorrect.issue_suspects_failed',
    'kb.transcriptCorrect.issue_suspects_found', 'kb.transcriptCorrect.issue_suspects_none',
    'kb.transcriptCorrect.issue_unmark', 'kb.transcriptCorrect.llm_adopt',
    'kb.transcriptCorrect.llm_adopt_failed', 'kb.transcriptCorrect.llm_adopted',
    'kb.transcriptCorrect.llm_ask', 'kb.transcriptCorrect.llm_failed',
    'kb.transcriptCorrect.llm_found', 'kb.transcriptCorrect.llm_no_allowed',
    'kb.transcriptCorrect.llm_no_model', 'kb.transcriptCorrect.llm_no_suspects',
    'kb.transcriptCorrect.llm_none', 'kb.transcriptCorrect.llm_pending',
    'kb.transcriptCorrect.llm_rejected', 'kb.transcriptCorrect.llm_row',
    'kb.transcriptCorrect.llm_running', 'kb.transcriptCorrect.merge_off',
    'kb.transcriptCorrect.preview', 'kb.transcriptCorrect.preview_title',
    'kb.transcriptCorrect.scenario_add', 'kb.transcriptCorrect.scenario_cleared',
    'kb.transcriptCorrect.scenario_failed', 'kb.transcriptCorrect.scenario_hint',
    'kb.transcriptCorrect.scenario_label', 'kb.transcriptCorrect.scenario_placeholder',
    'kb.transcriptCorrect.scenario_remove', 'kb.transcriptCorrect.scenario_saved',
    'kb.transcriptCorrect.scenario_suggest_hint', 'kb.transcriptCorrect.scenario_suggest_label',
    'kb.transcriptCorrect.scope_applied', 'kb.transcriptCorrect.scope_doc',
    'kb.transcriptCorrect.scope_failed', 'kb.transcriptCorrect.scope_keep',
    'kb.transcriptCorrect.scope_label', 'kb.transcriptCorrect.scope_need_tags',
    'kb.transcriptCorrect.scope_refused', 'kb.transcriptCorrect.scope_task',
    'kb.transcriptCorrect.scope_task_hint', 'memory.breadcrumb_settings',
    'memory.dropzone_desc', 'memory.dropzone_title', 'memory.export_foot',
    'memory.group_relation_field', 'memory.group_template_badge', 'memory.kind_group_memory',
    'memory.legacy_migration_confirm_action', 'memory.legacy_migration_desc',
    'memory.legacy_migration_selection_hint', 'memory.scoped_migration_desc',
    'memory.scoped_migration_duplicates', 'memory.scoped_migration_selection_hint',
    'memory.scoped_migration_source_counts', 'memory.section_memory',
    'memory.section_memory_sub', 'memory.templates_all_filled', 'memory.templates_gap_fields',
    'memory.templates_install_confirm', 'memory.templates_installed',
    'memory.templates_no_groups', 'memory.templates_no_templates', 'memory.templates_sub',
    'memory.templates_title', 'onboarding.asset.no_sessions', 'onboarding.asset.scanning_count',
    'ontologyGraph.unavailable_refs_retained', 'p3394.experience.approve',
    'p3394.experience.kb_failed', 'p3394.experience.kb_promoted',
    'p3394.experience.notion_failed', 'p3394.experience.notion_sync',
    'p3394.experience.notion_synced', 'p3394.experience.notion_title',
    'p3394.experience.reject', 'p3394.experience.title', 'p3394.wake.pending_short',
    'personalOntology.asset_projection_read_only',
];

/** main 侧删除面：4 直删 + 5 迁移后删（迁移目标=renderer 四语，见 MIGRATED_KEYS）。
 *  + P-r3-32（wo-b9）追加 recall.asset_approval.field_sensitivity：审批卡
 *  sensitivity 标签随敏感级机制下线成死键，四语收口（渲染层 FIELD_LABELS 的
 *  title 死行同批删——白名单 SUBSTANTIAL_FIELDS 无 title/sensitivity）。 */
const MAIN_DEAD_KEYS = [
    'cognition.audit_approval_confirmed', 'cognition.audit_approval_deferred',
    'cognition.audit_approval_edited', 'cognition.audit_approval_proposed',
    'cognition.audit_approval_rejected', 'cognition.inbox_asset_change_pending',
    'cognition.inbox_asset_change_pending_hint', 'p3394.wake.pending_short',
    'recall.asset_approval.version_conflict',
    'recall.asset_approval.field_sensitivity',
];

/** main→renderer 豁免迁移键（批 12 P-r3-44 消费；接线后本断言可交由
 * cognition-i18n-coverage 的 referencedKeys 扫描接管）。 */
const MIGRATED_KEYS = [
    'cognition.audit_approval_confirmed', 'cognition.audit_approval_deferred',
    'cognition.audit_approval_edited', 'cognition.audit_approval_proposed',
    'cognition.audit_approval_rejected',
];

/** 层3动态拼接救活键（取值空间实证见核查报告第二节）；四语在位防误删。 */
const DYN_ALIVE_KEYS = [
    'cognition.capture.risk_high', 'cognition.capture.risk_low',
    'cognition.capture.risk_medium', 'kb.transcriptCorrect.denied_reason_context_allowed',
    'kb.transcriptCorrect.denied_reason_context_denied',
    'kb.transcriptCorrect.denied_reason_out_of_scope',
    'kb.transcriptCorrect.denied_reason_overlapping_span',
    'kb.transcriptCorrect.denied_reason_protected_region',
    'kb.transcriptCorrect.denied_reason_word_boundary', 'kb.transcriptCorrect.risk_high',
    'kb.transcriptCorrect.risk_low', 'kb.transcriptCorrect.risk_medium',
    'memory.kind_comm_style', 'memory.kind_convention', 'memory.kind_decision',
    'memory.kind_identity', 'memory.kind_milestone', 'memory.kind_preference',
    'memory.kind_tech_stack', 'memory.scoped_migration_kind_agent',
    'memory.scoped_migration_kind_project', 'memory.scoped_migration_kind_space',
    'memory.scoped_migration_status_blocked', 'memory.scoped_migration_status_empty',
    'memory.scoped_migration_status_ready', 'memory.scoped_migration_status_unavailable',
    'memory.threat_exfiltration', 'memory.threat_invisible_unicode',
    'memory.threat_prompt_injection', 'p3394.wake.status.approved',
    'p3394.wake.status.executed', 'p3394.wake.status.expired', 'p3394.wake.status.rejected',
];

describe('死键批次门禁（P-r3-36）', () => {
  it('renderer 已删死键不得回潮（四语）', () => {
    const revived = RENDERER_DEAD_KEYS.flatMap((key) => LOCALES
      .filter((locale) => key in rendererTables[locale])
      .map((locale) => `${locale}:${key}`));
    expect(revived).toEqual([]);
  });

  it('main 已删死键不得回潮（四语，含迁移走的 audit_approval 5 键）', () => {
    const revived = MAIN_DEAD_KEYS.flatMap((key) => LOCALES
      .filter((locale) => key in mainTables[locale])
      .map((locale) => `${locale}:${key}`));
    expect(revived).toEqual([]);
  });

  it('豁免迁移的 audit_approval 5 键必须已在 renderer 四语（供 P-r3-44 复用）', () => {
    const missing = MIGRATED_KEYS.flatMap((key) => LOCALES
      .filter((locale) => !(key in rendererTables[locale]))
      .map((locale) => `${locale}:${key}`));
    expect(missing).toEqual([]);
  });

  it('动态拼接救活的 33 键必须四语在位（曾被工具盲区误判，防反向误删）', () => {
    const missing = DYN_ALIVE_KEYS.flatMap((key) => LOCALES
      .filter((locale) => !(key in rendererTables[locale]))
      .map((locale) => `${locale}:${key}`));
    expect(missing).toEqual([]);
  });
});
