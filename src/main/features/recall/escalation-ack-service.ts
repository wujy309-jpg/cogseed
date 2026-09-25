/**
 * 扩权确认记忆（specs/010 T007 / US-303）。
 *
 * 为什么需要它：待办「敏感级被升高」的退场判据是"最近一次版本变更是谁的"。
 * 用户**确认**扩权不改任何内容——没有内容变化就不产生新版本（version-diff
 * 对"内容不变"的写入不算变更），靠版本永远退不了场。所以确认必须落一条
 * **设置型记录**（形态照抄 inspection-settings），键 = `assetId@toVersion`。
 *
 * 为什么键里带 toVersion：待办的产出条件是"系统把档位提到了某个版本"。只按
 * assetId 记 ack，下一次系统再提级（新版本）就会被静默吞掉——那违反
 * US-303 的 Edge Case（驳回/确认后又发生新的提级 → 必须作为新待办出现）。
 * 按 `assetId@toVersion` 记，新提级 = 新版本 = 新键 → 必然重报。
 *
 * 隐私口径：ack 只记不可识别内容（id + 版本 + 档位 + 时间），**不含正文**
 * （specs/010 T040 有读盘原文断言钉着）。它也不是资产字段，不进
 * purgeAbilityAsset 的清空清单；彻底清除后残留的 ack 键因没有 toVersion
 * 可比而不可能再命中。
 */

import { safeId } from '../../storage';
import { readRecallJsonRecord, updateRecallJsonRecord } from './store';

const SETTINGS_COLLECTION = 'sensitivity-escalation-settings';
const SETTINGS_ID = 'settings';

/** 有界：保留最近 500 条（同 inspection-settings 的 dismissed/deferred 键同量级）。 */
const ACK_BOUND = 500;

export interface SensitivityEscalationAck {
  key: string;
  assetId: string;
  toVersion: string;
  level?: string;
  at: string;
}

export interface SensitivityEscalationSettings {
  schemaVersion: 1;
  ownerId: string;
  id: typeof SETTINGS_ID;
  acknowledged: SensitivityEscalationAck[];
  updatedAt: string;
}

function defaultSettings(userId: string): SensitivityEscalationSettings {
  return {
    schemaVersion: 1,
    ownerId: userId,
    id: SETTINGS_ID,
    acknowledged: [],
    updatedAt: new Date().toISOString(),
  };
}

function asSettings(userId: string, raw: unknown): SensitivityEscalationSettings {
  if (!raw || typeof raw !== 'object') return defaultSettings(userId);
  const value = raw as Partial<SensitivityEscalationSettings>;
  const acknowledged = Array.isArray(value.acknowledged)
    ? value.acknowledged.filter((ack): ack is SensitivityEscalationAck =>
      Boolean(ack) && typeof ack.key === 'string' && typeof ack.assetId === 'string'
      && typeof ack.toVersion === 'string' && typeof ack.at === 'string')
    : [];
  return {
    schemaVersion: 1,
    ownerId: userId,
    id: SETTINGS_ID,
    acknowledged,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : new Date().toISOString(),
  };
}

/** 读 ack 集合；无记录时给空缺省（首次读取即默认，无迁移脚本）。 */
export async function readEscalationAcks(userId: string): Promise<SensitivityEscalationSettings> {
  const raw = await readRecallJsonRecord(userId, SETTINGS_COLLECTION, SETTINGS_ID);
  return asSettings(userId, raw);
}

/**
 * 确认一次扩权：写键 `assetId@toVersion`。幂等——同键重复确认只保留一条
 * （按 at 刷新）。有界：超出 500 条按写入顺序截断最旧的。
 */
export async function acknowledgeEscalation(
  userId: string,
  assetId: string,
  toVersion: string,
  level?: string,
): Promise<SensitivityEscalationSettings> {
  if (!safeId(assetId)) throw new Error('invalid sensitivity escalation asset id');
  if (!/^\d+$/.test(String(toVersion))) throw new Error('invalid sensitivity escalation version');
  const key = `${assetId}@${toVersion}`;
  const updated = await updateRecallJsonRecord(userId, SETTINGS_COLLECTION, SETTINGS_ID, (raw) => {
    const current = asSettings(userId, raw);
    const rest = current.acknowledged.filter((ack) => ack.key !== key);
    const acknowledged = [
      ...rest,
      { key, assetId, toVersion: String(toVersion), ...(level ? { level } : {}), at: new Date().toISOString() },
    ].slice(-ACK_BOUND);
    return { ...current, acknowledged, updatedAt: new Date().toISOString() };
  });
  return asSettings(userId, updated);
}

/**
 * 撤销一条确认（人工纠正路径）：删除即恢复打扰。键由调用方给出（读侧可见），
 * 不在这里重新拼——拼键的规则已经属于 acknowledge 一侧，两处拼会分叉。
 */
export async function revokeEscalationAck(userId: string, key: string): Promise<SensitivityEscalationSettings> {
  if (typeof key !== 'string' || !key.includes('@')) throw new Error('invalid sensitivity escalation ack key');
  const updated = await updateRecallJsonRecord(userId, SETTINGS_COLLECTION, SETTINGS_ID, (raw) => {
    const current = asSettings(userId, raw);
    return {
      ...current,
      acknowledged: current.acknowledged.filter((ack) => ack.key !== key),
      updatedAt: new Date().toISOString(),
    };
  });
  return asSettings(userId, updated);
}
