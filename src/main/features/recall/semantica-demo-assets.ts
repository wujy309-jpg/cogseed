import { genId12 } from '../../storage';
import type { RecallAbilityAssetRecord } from './candidate-service';
import {
  createAbilityAsset,
  deleteAbilityAsset,
  listAbilityAssets,
  updateAbilityAsset,
} from './asset-service';
import type { AbilityAssetRelation } from './asset-relations';
import { RECALL_SCHEMA_VERSION } from './types';

export const SEMANTICA_DEMO_TAG = 'life-demo';
export const SEMANTICA_DEMO_ASSET_PREFIX = 'aa-life-demo-';

const LEGACY_DEMO_TAG = 'semantica-demo';
const LEGACY_DEMO_ASSET_PREFIX = 'aa-semantica-demo-';

type DemoKey =
  | 'meal-plan'
  | 'inventory'
  | 'batch-planning'
  | 'constraint-safety'
  | 'trip-plan'
  | 'transport-budget'
  | 'departure-window'
  | 'traveler-constraints'
  | 'semantica-project-context'
  | 'progress-report'
  | 'report-data-check'
  | 'report-risk-action'
  | 'report-outcome-value'
  | 'report-sensitive-check';
type LegacyDemoKey = 'gateway' | 'auth' | 'client' | 'security';

interface DemoSpec {
  key: DemoKey;
  legacyKey?: LegacyDemoKey;
  title: string;
  statement: string;
  type: RecallAbilityAssetRecord['type'];
  relations: Array<{ kind: AbilityAssetRelation['kind']; target: DemoKey; note: string }>;
}

const DEMO_SPECS: readonly DemoSpec[] = [
  {
    key: 'meal-plan',
    legacyKey: 'gateway',
    title: '生活演示：工作日双人用餐方案',
    statement: '为下周两个人的工作日晚餐安排每日菜式，并给出人数、总预算和每次制作时长。先确定每日安排，再分别核对现有物资、时间窗口和每个人的限制，最后形成可执行清单。',
    type: 'skill_method',
    relations: [],
  },
  {
    key: 'inventory',
    legacyKey: 'auth',
    title: '生活演示：库存与采购批次控制',
    statement: '先盘点现有物资，记录可用量、保质窗口和缺口；再将缺口分为一次集中补给和一次机动补给，优先消耗临期项，避免重复占用预算。',
    type: 'rule',
    relations: [{ kind: 'depends_on', target: 'meal-plan', note: '资源批次按已确定的双人用餐方案计算。' }],
  },
  {
    key: 'batch-planning',
    legacyKey: 'client',
    title: '生活演示：低峰时段批次编排',
    statement: '把可并行的前置步骤集中到低峰窗口完成，按日期与份数建立批次标识；执行日仅保留最终组合，超出预设时限时拆分任务或改用替代项。',
    type: 'skill_method',
    relations: [{ kind: 'depends_on', target: 'inventory', note: '批处理只使用资源批次中已确认可用的项目。' }],
  },
  {
    key: 'constraint-safety',
    legacyKey: 'security',
    title: '生活演示：个体约束隔离',
    statement: '对参与者逐一记录过敏原、禁用成分和交叉接触风险；无法确认成分的项目不进入共同方案，必要时使用独立器具和替代项。',
    type: 'rule',
    relations: [{ kind: 'refines', target: 'meal-plan', note: '个体约束细化双人用餐方案的安全边界。' }],
  },
  {
    key: 'trip-plan',
    title: '生活演示：周末短途出行方案',
    statement: '为两个人安排一次周末短途出行，先确认目的地、可用日期、总预算和返程时间，再形成可执行的行程清单。遇到天气或交通变化时，保留一个不改变核心目标的替代方案。',
    type: 'skill_method',
    relations: [],
  },
  {
    key: 'transport-budget',
    title: '生活演示：交通与费用边界',
    statement: '按地点之间的移动距离核对可选方式，分别记录固定费用、浮动费用和取消成本；只有往返时间及总费用都在边界内的选项才能进入后续安排。',
    type: 'rule',
    relations: [{ kind: 'depends_on', target: 'trip-plan', note: '交通方式与费用上限由已确认的短途出行方案决定。' }],
  },
  {
    key: 'departure-window',
    title: '生活演示：低峰窗口选择',
    statement: '比较候选时间窗口的拥堵程度、候车时长和变更余量，优先选择低峰窗口；若预计延误会压缩返程缓冲，则切换到次优窗口。',
    type: 'skill_method',
    relations: [{ kind: 'depends_on', target: 'transport-budget', note: '时间窗口只从已满足费用与往返边界的交通选项中选择。' }],
  },
  {
    key: 'traveler-constraints',
    title: '生活演示：同行约束隔离',
    statement: '逐一记录同行人的行动能力、证件、饮食禁忌和必须避开的时间段；共同安排不能覆盖个体限制，无法兼容时应拆分局部活动或提供替代项。',
    type: 'rule',
    relations: [{ kind: 'refines', target: 'trip-plan', note: '同行人的个体限制细化短途出行方案的可执行边界。' }],
  },
  {
    key: 'semantica-project-context',
    title: '工作演示：Semantica现状',
    statement: 'CogSeed Semantica 是内置的能力资产增强通道：用户只需描述当前任务，系统先在通过权限、作用域、版本和生命周期治理的能力资产中进行语义检索，再从高相关入口资产沿 depends_on、refines、related_to、same_family 等安全关系做最多两跳扩展，把相关经验组合进回答。关闭 Semantica 时保持原有语义检索，不做自动关系扩展。当前已完成总开关、受治理关系查询、语义入口关系扩展、本地确定性排序、引用与关系方向检查，并已移除产品运行路径中的 Jev 外部依赖。类型检查、静态检查及相关自动化测试已经通过；仍未完成的是至少 30 条真实脱敏自然任务的开关对照验收，以及用户本体实体与能力资产的自动对齐和关系持续沉淀，因此当前不应宣称已达到默认开启或完整产品化。',
    type: 'skill_method',
    relations: [
      { kind: 'related_to', target: 'progress-report', note: 'Semantica 项目现状可按项目阶段汇报结构组织为课堂汇报。' },
      { kind: 'related_to', target: 'report-data-check', note: '汇报 Semantica 的完成状态和测试结论前需要核对证据口径。' },
    ],
  },
  {
    key: 'progress-report',
    title: '工作演示：项目阶段汇报结构',
    statement: '准备五分钟项目阶段汇报时，按“目标与价值、已完成事项、验证证据、当前不足、下一步计划”组织内容。先给结论，再用少量事实支撑；明确区分设计完成、代码完成、测试通过和人工验收，不能把计划中的能力描述成已经上线。',
    type: 'skill_method',
    relations: [],
  },
  {
    key: 'report-data-check',
    title: '工作演示：汇报数据核对清单',
    statement: '汇报前逐项核对版本、日期、测试数量、通过状态和功能边界。无法从代码、测试记录或实际操作确认的数字必须标记为待确认，不使用估算值冒充验收结果；同一指标在标题、正文和附件中应保持一致。',
    type: 'rule',
    relations: [{ kind: 'depends_on', target: 'progress-report', note: '阶段汇报中的完成情况和验证结果必须先经过数据核对。' }],
  },
  {
    key: 'report-risk-action',
    title: '工作演示：风险与行动表达方法',
    statement: '描述当前不足时使用“问题、影响、原因、处理措施、责任人或所需协作、预期完成时间”的结构。风险不能只写一句“后续优化”，也不能为了显得顺利而省略尚未完成的验收条件。',
    type: 'skill_method',
    relations: [{ kind: 'refines', target: 'progress-report', note: '风险与行动结构细化阶段汇报中的不足和下一步部分。' }],
  },
  {
    key: 'report-outcome-value',
    title: '工作演示：技术成果价值表达',
    statement: '汇报技术成果时先说明解决了什么用户问题，再说明系统行为发生了什么变化，最后给出可核验的证据和业务价值。避免堆砌文件名、类名和实现细节；只有听众追问时，再补充关键技术边界和实现方式。',
    type: 'skill_method',
    relations: [{ kind: 'refines', target: 'progress-report', note: '价值表达方法细化阶段汇报中的目标、成果和价值部分。' }],
  },
  {
    key: 'report-sensitive-check',
    title: '工作演示：汇报敏感信息检查',
    statement: '对外展示或课堂汇报前，检查并移除 API Key、访问令牌、个人身份信息、内部服务地址和真实用户数据。确需说明配置时使用脱敏占位符；测试素材优先使用合成数据，并确保截图、日志和附件也经过同样检查。',
    type: 'rule',
    relations: [{ kind: 'depends_on', target: 'report-data-check', note: '核对汇报证据时必须同时检查其中是否包含敏感信息。' }],
  },
];

export interface SemanticaDemoStatus {
  ready: boolean;
  assetCount: number;
  expectedAssetCount: number;
  assets: Array<{ id: string; title: string; status: RecallAbilityAssetRecord['status'] }>;
}

export interface SeedSemanticaDemoResult {
  createdCount: number;
  updatedCount: number;
  status: SemanticaDemoStatus;
}

function isManagedDemoAsset(asset: RecallAbilityAssetRecord): boolean {
  return asset.id.startsWith(SEMANTICA_DEMO_ASSET_PREFIX)
    || asset.id.startsWith(LEGACY_DEMO_ASSET_PREFIX)
    || (asset.tags || []).some((tag) => tag === SEMANTICA_DEMO_TAG || tag === LEGACY_DEMO_TAG);
}

function currentManagedAssetForKey(
  assets: readonly RecallAbilityAssetRecord[],
  spec: DemoSpec,
): RecallAbilityAssetRecord | undefined {
  const idPrefix = `${SEMANTICA_DEMO_ASSET_PREFIX}${spec.key}-`;
  return assets.find((asset) => asset.id.startsWith(idPrefix));
}

function legacyManagedAssetForKey(
  assets: readonly RecallAbilityAssetRecord[],
  spec: DemoSpec,
): RecallAbilityAssetRecord | undefined {
  if (!spec.legacyKey) return undefined;
  const idPrefix = `${LEGACY_DEMO_ASSET_PREFIX}${spec.legacyKey}-`;
  return assets.find((asset) => asset.id.startsWith(idPrefix));
}

function sameRelations(left: readonly AbilityAssetRelation[] = [], right: readonly AbilityAssetRelation[] = []): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function statusFromAssets(assets: readonly RecallAbilityAssetRecord[]): SemanticaDemoStatus {
  const active = assets.filter((asset) => isManagedDemoAsset(asset) && asset.status === 'active');
  const current = DEMO_SPECS.flatMap((spec) => {
    const asset = currentManagedAssetForKey(active, spec) || legacyManagedAssetForKey(active, spec);
    return asset ? [asset] : [];
  });
  return {
    ready: current.length === DEMO_SPECS.length,
    assetCount: current.length,
    expectedAssetCount: DEMO_SPECS.length,
    assets: current.map((asset) => ({ id: asset.id, title: asset.title, status: asset.status })),
  };
}

export async function getSemanticaDemoStatus(userId: string): Promise<SemanticaDemoStatus> {
  return statusFromAssets(await listAbilityAssets(userId));
}

function newDemoAsset(
  userId: string,
  spec: DemoSpec,
  id: string,
  relations: AbilityAssetRelation[],
): RecallAbilityAssetRecord {
  const at = new Date().toISOString();
  return {
    schemaVersion: RECALL_SCHEMA_VERSION,
    ownerId: userId,
    id,
    candidateId: `candidate-life-demo-${genId12()}`,
    reviewDecisionId: `rd_life_demo_${genId12()}`,
    type: spec.type,
    title: spec.title,
    statement: spec.statement,
    evidenceRefs: [],
    origin: 'manual',
    relations,
    scope: 'general',
    status: 'active',
    lifecycleStatus: 'user_confirmed_unverified',
    maturity: 'bud',
    version: '1',
    activeVersion: '1',
    validationCount: 0,
    consecutiveFailures: 0,
    createdAt: at,
    updatedAt: at,
  };
}

/**
 * Creates a small, explicit demo domain through the same formal asset boundary
 * as user-confirmed assets. The user's click is the confirmation event; these
 * records never claim to have been extracted from prior conversation history.
 */
export async function seedSemanticaDemoAssets(userId: string): Promise<SeedSemanticaDemoResult> {
  const before = await listAbilityAssets(userId);
  const active = before.filter((asset) => asset.status === 'active');
  const byKey = new Map(DEMO_SPECS.map((spec) => [spec.key, currentManagedAssetForKey(active, spec)]));
  const legacyByKey = new Map(DEMO_SPECS.map((spec) => [spec.key, legacyManagedAssetForKey(active, spec)]));
  const ids = new Map<DemoKey, string>();

  for (const spec of DEMO_SPECS) {
    ids.set(spec.key, byKey.get(spec.key)?.id || `${SEMANTICA_DEMO_ASSET_PREFIX}${spec.key}-${genId12()}`);
  }

  let createdCount = 0;
  let updatedCount = 0;
  for (const spec of DEMO_SPECS) {
    const relations = spec.relations.map((relation) => ({
      kind: relation.kind,
      assetId: ids.get(relation.target)!,
      note: relation.note,
    }));
    const existing = byKey.get(spec.key);
    if (!existing) {
      const created = await createAbilityAsset(
        userId,
        newDemoAsset(userId, spec, ids.get(spec.key)!, relations),
        { actor: 'user', reason: '用户初始化生活场景演示资产。' },
      );
      await updateAbilityAsset(userId, created.id, {
        tags: [SEMANTICA_DEMO_TAG],
        actor: 'user',
        reason: '标记生活场景演示资产，便于识别和清理。',
      });
      createdCount += 1;
      continue;
    }

    const contentChanged = existing.title !== spec.title
      || existing.statement !== spec.statement
      || existing.type !== spec.type
      || existing.scope !== 'general'
      || !sameRelations(existing.relations, relations);
    const expectedTags = [...new Set([
      ...(existing.tags || []).filter((tag) => tag !== LEGACY_DEMO_TAG),
      SEMANTICA_DEMO_TAG,
    ])];
    const tagsChanged = JSON.stringify(existing.tags || []) !== JSON.stringify(expectedTags);
    if (!contentChanged && !tagsChanged) continue;
    await updateAbilityAsset(userId, existing.id, {
      ...(contentChanged ? {
        title: spec.title,
        statement: spec.statement,
        type: spec.type,
        scope: 'general',
        relations,
      } : {}),
      ...(tagsChanged ? { tags: expectedTags } : {}),
      actor: 'user',
      reason: '同步生活场景演示资产定义。',
    });
    updatedCount += 1;
  }

  for (const legacy of legacyByKey.values()) {
    if (!legacy) continue;
    await deleteAbilityAsset(userId, legacy.id, {
      actor: 'user',
      reason: '演示资产已迁移到生活场景命名，保留旧记录用于历史回执。',
    });
  }

  return {
    createdCount,
    updatedCount,
    status: await getSemanticaDemoStatus(userId),
  };
}

export async function clearSemanticaDemoAssets(userId: string): Promise<{ clearedCount: number; status: SemanticaDemoStatus }> {
  const managed = (await listAbilityAssets(userId)).filter((asset) => (
    isManagedDemoAsset(asset)
    && (asset.status === 'active' || asset.status === 'paused' || asset.status === 'archived')
  ));
  for (const asset of managed) {
    await deleteAbilityAsset(userId, asset.id, {
      actor: 'user',
      reason: '用户清理生活场景演示资产。',
    });
  }
  return {
    clearedCount: managed.length,
    status: await getSemanticaDemoStatus(userId),
  };
}
