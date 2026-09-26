/**
 * 三项声明：来源声明、条款接受、维护责任确认（`C-FR-005`～`C-FR-008`）。
 *
 * ## 三项都齐才允许提交
 *
 * `C-FR-005`：三项缺一即拒绝提交并指出缺项。这里把"齐不齐"做成一个纯函数，
 * 而不是散在 UI 的按钮禁用逻辑里——按钮禁用是提示，判定必须在主进程。
 *
 * ## 条款版本与接受时间不可由贡献者提供
 *
 * `C-FR-004b`：条款版本来自 Hub 当前生效文本，**不可由 Skill 包或手工输入替代**。
 * 所以 `acceptTerms` 只收 Hub 返回的 `ContributionTerms`，时间由本机生成——
 * 让渲染层传 version 进来就等于让它能声称接受了一个别的版本。
 *
 * ## `forked_from` 为什么这里只读不写
 *
 * `C-FR-006` 要求派生副本自动预填「派生自 Hub 内容 {content_id} v{version}」，
 * 类型固定且关联不可删。但迭代一把 `forked_from` 实现为**只写不读**：
 * `src/main` 全仓零读取点，三个测试文件从不同角度锁死（含一条全局不变量测试），
 * 且字段注释逐字「**Client-only — it never travels to Hub**」。
 *
 * 该冲突由 `CC-HUB-OPEN1-US3-US6-FORKED-FROM-READ-001`（`proposed`）裁决，
 * 且裁决范围比 CC 现有两条口径更大——CC 只讨论"能不能读"，没讨论"能不能外发"。
 *
 * 在裁决前，本模块**不读取** `forked_from`，派生来源走贡献者手填路径：
 * `origin.type` 仍可选 `derived_from_hub`，只是不自动预填、也不校验关联。
 * 这样 T034 是一个**单一可替换的接缝**——裁决下来只需在 `prefillOrigin` 里加读取，
 * 其余任何地方不改。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ContributionTerms } from './terms';
import type { ContributionStaging } from './staging';

/** 来源类型。三类是 `C-FR-006` 的最小集合。 */
export type OriginType = 'original' | 'derived_from_hub' | 'third_party';

export interface OriginDeclaration {
  type: OriginType;
  /** 贡献者补充说明。第三方材料须说明来源。 */
  note: string;
  /**
   * 派生关联。**当前恒为 `null`** —— 见模块文档「`forked_from` 为什么这里只读不写」。
   * 裁决通过后由 `prefillOrigin` 填充，届时须同时成为不可修改项。
   */
  forked_from: { content_id: string; version: string } | null;
}

export interface TermsAcceptance {
  version: string;
  /** 勾选时刻，本机生成。 */
  accepted_at: string;
}

export interface MaintenanceConfirmation {
  confirmed_at: string;
}

export interface Declarations {
  origin: OriginDeclaration | null;
  terms: TermsAcceptance | null;
  maintenance: MaintenanceConfirmation | null;
}

export type DeclarationKind = 'origin' | 'terms' | 'maintenance';

export function emptyDeclarations(): Declarations {
  return { origin: null, terms: null, maintenance: null };
}

const ORIGIN_TYPES: ReadonlySet<string> = new Set<OriginType>([
  'original', 'derived_from_hub', 'third_party',
]);

export function isOriginType(value: unknown): value is OriginType {
  return typeof value === 'string' && ORIGIN_TYPES.has(value);
}

/**
 * 预填来源声明。
 *
 * **当前是一个刻意留空的接缝。** `C-FR-006` 要求带 `forked_from` 的派生副本自动
 * 预填并锁死类型，但迭代一的 `forked_from` 只写不读且不外发（见模块文档）。
 * 裁决前一律返回"未预填"，由贡献者自行选择来源类型。
 *
 * 裁决通过后，此处读取副本 `_meta.json` 的 `forked_from` 并返回
 * `{ type: 'derived_from_hub', forked_from, locked: true }`——**改动只在这一个函数内**。
 */
export function prefillOrigin(staging?: ContributionStaging): {
  type: OriginType | null;
  forked_from: { content_id: string; version: string } | null;
  locked: boolean;
} {
  if (!staging) return { type: null, forked_from: null, locked: false };
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(staging.dir, '_meta.json'), 'utf8')) as Record<string, unknown>;
    const raw = meta.forked_from;
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const value = raw as Record<string, unknown>;
      if (typeof value.content_id === 'string' && typeof value.version === 'string' && value.content_id && value.version) {
        return {
          type: 'derived_from_hub',
          forked_from: { content_id: value.content_id, version: value.version },
          locked: true,
        };
      }
    }
  } catch { /* a non-derived custom Skill has no usable sidecar */ }
  return { type: null, forked_from: null, locked: false };
}

/**
 * 记录来源声明。
 *
 * `note` 对第三方材料是必需的——`C-FR-006` 要求第三方来源由贡献者说明来源，
 * 一个空说明等于没声明。
 */
export function declareOrigin(
  type: OriginType,
  note: string,
  forkedFrom: { content_id: string; version: string } | null = null,
): OriginDeclaration {
  const trimmed = String(note || '').trim();
  if (type === 'third_party' && !trimmed) throw new Error('third_party_note_required');
  if (type === 'derived_from_hub' && !forkedFrom) throw new Error('forked_from_required');
  return { type, note: trimmed, forked_from: forkedFrom };
}

/**
 * 记录条款接受。
 *
 * 只接受 Hub 返回的条款对象，版本不从参数单独取——见模块文档。
 */
export function acceptTerms(terms: ContributionTerms): TermsAcceptance {
  if (!terms?.version) throw new Error('terms_version_missing');
  return { version: terms.version, accepted_at: new Date().toISOString() };
}

export function confirmMaintenance(): MaintenanceConfirmation {
  return { confirmed_at: new Date().toISOString() };
}

/**
 * 三项齐备判定。
 *
 * 返回缺项列表而非布尔：`C-FR-005` 要求「拒绝提交并**指出缺项**」，
 * 只回 false 会让 UI 无从说明缺什么。
 */
export function missingDeclarations(d: Declarations): DeclarationKind[] {
  const missing: DeclarationKind[] = [];
  if (!d.origin) missing.push('origin');
  if (!d.terms) missing.push('terms');
  if (!d.maintenance) missing.push('maintenance');
  return missing;
}

/**
 * 条款版本是否仍是当前生效版本。
 *
 * 贡献者可能在条款页停留很久，期间 Hub 改版。提交时服务端会以
 * `TERMS_VERSION_MISMATCH` 拒绝（c01 §3），客户端先判是为了少一次往返，
 * 并让贡献者知道要重新确认的是**条款**而不是内容。
 */
export function termsStale(accepted: TermsAcceptance | null, current: ContributionTerms | null): boolean {
  if (!accepted || !current) return false;
  return accepted.version !== current.version;
}
