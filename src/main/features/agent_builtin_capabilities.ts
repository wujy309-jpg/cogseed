/**
 * Agent 可引用的客户端内置能力（`skill_list` 里的 `builtin:<name>`）。
 *
 * 产品 2026-10-13 决定做：很多内置 Skill 可以直接给 Agent 用，用户不一定自己去装，Agent 作者很可能用得上。
 * 写法是 `builtin:<name>`，与 12 位十六进制（Hub Skill，需下载）和名字形式（随包私有 Skill）三类互斥。
 *
 * ## 这是客户端对 Hub 清单的本地镜像
 * Hub 的 `GET /marketplace/builtin-capabilities/manifest` 是权威清单（当前返回空清单，成员待定）；这里是**客户端自己
 * 能解析哪些**。两边成员必须一致：Hub 收到清单外的 `builtin:` 引用会拒绝（`builtin_ref.unknown`），客户端本机检查
 * 也会先拦。成员只改本文件的 {@link AGENT_BUILTIN_CAPABILITIES} 一处，并同步给 Hub。
 *
 * ## 为什么只开放这几个
 * 能力型、对用户自己的资料和代码起作用的 Skill 才适合让 Agent 直接引用。**不含**：
 * - `agent-creator` / `skill-creator` / `autotask-creator`：创建与改动 Agent、Skill、自动化的产品协议，不是 Agent 该调用的能力；
 * - `package-installer`：安装外部代码包，风险高；
 * - `personal-ontology-candidate-builder`：从对话里抽取个人信息，涉及隐私，只应由宿主触发。
 * 初始成员是客户端的建议值，产品可以改。
 *
 * 叶模块：纯数据与纯函数，不 import Electron、paths 或其他 feature。
 */

export const BUILTIN_REF_PREFIX = 'builtin:';

export interface BuiltinCapability {
  /** 系统 Skill 的目录名，也是 `builtin:` 后面的名字。 */
  name: string;
  /** 开始支持这个引用的客户端版本，Hub 据此判断目标客户端是否具备。 */
  introducedIn: string;
  /** 给人看的一句话能力说明（Hub 清单的 `capability` 字段）。 */
  capability: string;
  risk: 'low' | 'medium' | 'high';
}

/**
 * ⚠️ `introducedIn` 目前取当前客户端版本作为占位：真正的值是**包含这次改动的发布版本**，发版前要核对更新。
 */
export const AGENT_BUILTIN_CAPABILITIES: readonly BuiltinCapability[] = Object.freeze([
  { name: 'grounded-material-qa', introducedIn: '1.3.0', capability: 'Answer strictly from the user\'s imported materials, with evidence', risk: 'low' },
  { name: 'kb-mindmap', introducedIn: '1.3.0', capability: 'Generate a local multi-level mind map from knowledge-base documents', risk: 'low' },
  { name: 'coding', introducedIn: '1.3.0', capability: 'Implement or change code in an existing project, grounded in repository guidance', risk: 'medium' },
]);

const BY_NAME: ReadonlyMap<string, BuiltinCapability> = new Map(AGENT_BUILTIN_CAPABILITIES.map((c) => [c.name, c]));
/** `builtin:` 之后只允许小写字母、数字、下划线、连字符，首字符为小写字母（与契约 schema 一致）。 */
const BUILTIN_NAME_RE = /^[a-z][a-z0-9_-]*$/;

/** 是不是 `builtin:` 开头的写法（不判断名字是否合法）。 */
export function isBuiltinRef(ref: unknown): ref is string {
  return typeof ref === 'string' && ref.startsWith(BUILTIN_REF_PREFIX);
}

/** 形态合法时返回名字，否则 `null`。 */
export function parseBuiltinRef(ref: unknown): string | null {
  if (!isBuiltinRef(ref)) return null;
  const name = ref.slice(BUILTIN_REF_PREFIX.length);
  return BUILTIN_NAME_RE.test(name) ? name : null;
}

export function getBuiltinCapability(name: string): BuiltinCapability | null {
  return BY_NAME.get(name) ?? null;
}

/** 形态合法且在客户端开放清单内。 */
export function isKnownBuiltinRef(ref: unknown): boolean {
  const name = parseBuiltinRef(ref);
  return name !== null && BY_NAME.has(name);
}

/** 从 `skill_list` 里取出全部形态合法的内置能力名（保持顺序，去重）。 */
export function builtinNamesOf(skillList: readonly unknown[] | undefined): string[] {
  const out: string[] = [];
  for (const ref of skillList ?? []) {
    const name = parseBuiltinRef(ref);
    if (name !== null && !out.includes(name)) out.push(name);
  }
  return out;
}

/** 给 Hub 的清单成员（`GET /marketplace/builtin-capabilities/manifest` 的 list 项形态，id 带前缀）。 */
export function builtinCapabilityManifest(): Array<{ id: string; introduced_in: string; current_version: string; capability: string; risk: string }> {
  return AGENT_BUILTIN_CAPABILITIES.map((c) => ({
    id: `${BUILTIN_REF_PREFIX}${c.name}`,
    introduced_in: c.introducedIn,
    current_version: c.introducedIn,
    capability: c.capability,
    risk: c.risk,
  }));
}

/** 只保留客户端开放清单内的名字：运行时据此决定给 Agent 露出哪些系统 Skill，清单外的（例如手写进 agent.json 的）不露出。 */
export function openBuiltinNamesOf(skillList: readonly unknown[] | undefined): string[] {
  return builtinNamesOf(skillList).filter((name) => BY_NAME.has(name));
}
