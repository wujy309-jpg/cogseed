/**
 * 批量敏感级分级（specs/010 T008 / US-305）。
 *
 * 唯一写通道纪律：**逐条**调既有 `updateAbilityAsset`（逐条乐观版本 + 逐条
 * 台账），不新建第二套写通道、不做"批量"语义的审计动作——每条资产的台账
 * 仍然是它自己的 `updated`。部分失败**不阻断**其余，且必须如实出现在
 * `failed[]`（界面逐条上屏，不谎报全绿）。
 *
 * 幂等：已是指定档位的资产进 `skipped[]`，**不写版本、不记账**——重复提交
 * 不产生重复版本。被拦（终态/版本冲突）的条目不得计为成功。
 */

import { safeId } from '../../storage';
import { readAbilityAsset, updateAbilityAsset } from './asset-service';

export type SensitivityLevel = 'L0' | 'L1' | 'L2';

export interface BatchClassificationResult {
  ok: true;
  applied: Array<{ assetId: string; level: SensitivityLevel; version: string }>;
  failed: Array<{ assetId: string; error: string; code?: string }>;
  skipped: string[];
}

export const SENSITIVITY_LEVELS: readonly SensitivityLevel[] = ['L0', 'L1', 'L2'];

export function isSensitivityLevel(value: unknown): value is SensitivityLevel {
  return value === 'L0' || value === 'L1' || value === 'L2';
}

/**
 * 逐条分级。`expectedVersion` 不由调用方批量给——每条写之前**现读**当前
 * 版本号（读-写窗口内被并发改写会以 version_conflict 落进 failed，逐条
 * 如实，不静默覆盖）。
 */
export async function classifyAbilityAssets(
  userId: string,
  assetIds: readonly string[],
  level: SensitivityLevel,
  note?: string,
): Promise<BatchClassificationResult> {
  if (!isSensitivityLevel(level)) throw new Error(`invalid sensitivity level: ${String(level)}`);
  const applied: BatchClassificationResult['applied'] = [];
  const failed: BatchClassificationResult['failed'] = [];
  const skipped: string[] = [];
  const reason = note?.trim() || '治理待办：批量补充敏感级分级';

  for (const assetId of assetIds) {
    if (!safeId(assetId)) {
      failed.push({ assetId, error: `非法的资产编号：${assetId}`, code: 'invalid_asset_id' });
      continue;
    }
    try {
      const asset = await readAbilityAsset(userId, assetId);
      if (asset.sensitivity === level) {
        skipped.push(assetId);
        continue;
      }
      const updated = await updateAbilityAsset(userId, assetId, {
        sensitivity: level,
        expectedVersion: asset.version,
        reason,
        actor: 'user',
      });
      applied.push({ assetId, level, version: updated.version });
    } catch (error) {
      failed.push({
        assetId,
        error: (error as Error).message,
        ...(typeof (error as { code?: unknown }).code === 'string'
          ? { code: (error as { code: string }).code }
          : {}),
      });
    }
  }

  return { ok: true, applied, failed, skipped };
}
