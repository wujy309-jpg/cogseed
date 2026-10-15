/**
 * P-r1-24 类型契约（回归护栏，零运行时行为）。
 *
 * 认知域 index 有两个「资产摘要」形状：本域认知记忆档的旧行（stage/
 * reviewState/evidenceCount，现名 `CognitionMemoryAssetSummary`）与 `./types`
 * 的正式资产摘要（`CognitionAssetSummary`，带 type/maturity 列）。改名前
 * index 里的本地同名声明会静默遮蔽文末 `export * from './types'` 的星导出，
 * 消费方从 index 导入该名拿到旧形状且无任何提示。
 *
 * 本文件把「正式形状必须能从 index 导入」钉进 tsc 门禁：若同名本地声明
 * 回流遮蔽，下面两个索引访问立即产生编译错（Type 'maturity' cannot be
 * used to index...）。
 */
import type { CognitionAssetSummary } from './index';

/** 正式资产摘要的成熟度轴（遮蔽回流时此别名解析失败）。 */
export type FormalCognitionAssetSummaryMaturity = CognitionAssetSummary['maturity'];

/** 正式资产摘要的类型列（同上，双锚防误删单行绕过）。 */
export type FormalCognitionAssetSummaryType = CognitionAssetSummary['type'];
