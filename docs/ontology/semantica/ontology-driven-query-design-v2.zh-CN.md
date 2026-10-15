# 本体驱动查询落地设计 v2.0（方向修订版）

> **设计理念转变**：从"向量检索 + 本体增强"转向"本体驱动查询 + 多源组装"  
> **参考来源**：Semantica（https://github.com/chen-yuxuan/Semantica）  
> **设计约束**：借鉴思路，不复制代码，在实现代码中标注参考项目。  
> **技术栈**：纯 TypeScript，在 CogSeed 内置参考 Semantica 思路实现的本体能力插件；不要求用户额外安装 Semantica，且不触碰现有向量库 schema。

> **重要方向约束（2026-09-02 修订）**：本方案建设的是一套随 CogSeed 发布的通用本体查询与能力复用引擎，不是把某些业务领域的实体、规则或示例数据写死进产品。`985/211`、`在职员工`、`API 网关`等内容只用于说明机制或自动化测试；真实运行时的实体、关系、同义词、条件和能力资产，必须来自用户在 CogSeed 中持续沉淀或接入的数据源。开启功能后，系统使用这套通用逻辑查询用户已有的动态数据。

**一句话目标**：固定的是查询和复用逻辑，变化的是用户沉淀的本体数据。

```text
CogSeed 内置本体引擎（固定逻辑）
                 +
用户沉淀的能力资产、实体和关系（动态数据）
                 ↓
开启后按本体查询，并为当前任务选择可复用能力
```

---

## 一、核心理念转变：从"检索增强"到"本体驱动"

### 1.1 之前的理解（偏了）

**旧思路**：CogSeed 是纯向量检索，我们在召回结果上叠加本体信号做重排，让结果更准。

```
用户查询
  ↓
向量检索（bge-small-zh）召回 100 条
  ↓
本体重排（软加权：实体 ×1.15、关系 ×1.25）
  ↓
返回前 10 条
```

**问题**：
- 还是依赖向量相似度打底（"像不像"）
- 本体只是个加权因子，不是主引擎
- 无法解决语义鸿沟（用户说"在职员工"，向量召回包含所有员工）

---

### 1.2 会议 + ECS 文档揭示的真相

#### Richard 的关键句（9.1 分享会）

> "Skill 需要跨越不同信息烟囱，通过 Connector 获取信息，再将这些信息放入统一的语义环境中进行推理和处理。"

> "Input Schema 和 Output Schema 里边的这些实体，对我们来说，相对来说是比较严格定义的，所谓严格定义，它有相应的 ontology 的 match。"

> "我们可以把 Semantica 作为我们的一个工具...直接可以把它作为咱们的 Skill 后面带的工具...它后面就变成一个可控的我们的小的组件。"

#### ECS 文档的核心原则

> "O_runtime = Retrieve(O, Task, Anchor, Context) — 根据当前 Task + Anchor Entity + Context 动态取得需要的 Ontology Slice。"

> "不要追求 First-Time Perfect Ontology...初始本体不可能完美，而且'能够学习和进化'比'第一次结构完美'更重要。"

---

### 1.3 新思路：本体是主索引，不是加权因子

**以下场景是机制示例，不是产品内置业务规则**：

#### 场景 1：依赖查询
- 用户问："依赖 API 网关的模块有哪些？"
- **向量检索**：召回 100 条提到"API 网关"的文档，混入无关结果（只是描述文字提到）
- **本体查询**（前提是用户已经沉淀了这些实体和关系）：
  1. 识别查询意图：`Module -[depends_on]-> api-gateway`
  2. 从 `asset-relations.ts` 直接查：`WHERE kind='depends_on' AND assetId='api-gateway'`
  3. 精确返回：`[auth-service, user-service, payment-service]`
  4. 用这 3 个实体 ID 去向量库/文档库取详细内容
  5. 组装结构化答案

#### 场景 2：条件映射（老师举例的"辞职=0"案例）
- 用户问："公司有多少员工？"
- **向量检索**：召回所有提到"员工"的文档，无法区分在职/离职
- **本体查询**（只有接入相应用户数据源和本体映射后才执行）：
  1. 识别实体：`Employee`
  2. 本体规则补充：业务上的 `Employee` = 数仓里的 `employee WHERE resignation_status=0`
  3. 改写查询：`SELECT COUNT(*) FROM employee WHERE resignation_status=0`
  4. 返回精确数字

#### 场景 3：实体对齐（老师举例的"985/211"案例）
- 用户问："公司有多少 985 毕业的员工？"
- **向量检索**：召回提到"985"的文档，但数据库里没有 `is_985` 字段
- **本体查询**（只有接入相应用户数据源和本体映射后才执行）：
  1. 识别：`Employee.university` 需要对齐到 `universities_reference.is_985`
  2. 本体提供对齐表：`university_name` → `universities_reference`
  3. 改写查询：`SELECT COUNT(*) FROM employee e JOIN universities_reference u ON e.university_name = u.name WHERE u.is_985 = true`
  4. 返回精确数字

---

### 1.4 新架构：本体驱动 + 多源组装

```
用户查询
  ↓
[1] 查询意图解析
    - 识别 Anchor Entity（Person / Task / Artifact）
    - 识别 Target（想要什么实体）
    - 识别 Path（通过什么关系找）
  ↓
[2] 实体对齐
    - 用户词汇 → 用户本体中的实体/属性/关系
    - 同义词从用户本体、能力资产和已接入数据源中动态取得
  ↓
[3] 本体查询
    - 从用户动态关系图导航（能力资产关系、本体实例和已接入 Connector）
    - 简单查询：本体插件内置 BFS（首阶段 1-2 跳）
    - 复杂查询：本体插件内置规则/图查询能力（3+ 跳）；必要时再接外部 Semantica 兼容扩展
  ↓
[4] 多源取回
    - 用实体 ID 去用户已接入的数据源取详细内容
      • 向量库（kb_vector）→ 文档片段
      • 数据库（connector）→ 结构化数据
      • 文件系统 → 原始文件
  ↓
[5] 结构化组装
    - 按 Output Schema 组装答案
    - 附加证据链（来源 + 本体路径）
  ↓
返回结构化结果 + 可解释路径
```

**核心差异**：
- ✅ 本体是主索引（关系图 + 规则）
- ✅ 向量检索是数据源之一（不是唯一入口）
- ✅ CogSeed 自带本体能力插件，参考 Semantica 但不依赖或复制 Semantica
- ✅ 外部 Semantica 仅是未来可选扩展，不是用户安装 CogSeed 的前置条件
- ✅ 产品不内置 `985`、员工、API 网关等领域数据；这些只能是测试或用户数据
- ✅ 用户沉淀的是数据和关系，CogSeed 提供的是解析、导航、复用和证据逻辑

### 1.5 运行时数据生命周期（本方案的真正边界）

本体插件不负责预置一套行业知识，也不要求用户先安装或维护外部本体产品。它随 CogSeed 发布的是一套通用运行逻辑：

```text
用户使用 CogSeed
  ↓
沉淀能力资产、实体、属性和关系
  ↓
用户开启本体查询能力
  ↓
查询时从当前用户可见数据中按需构造本体切片
  ↓
按实体和关系查询可复用能力资产
  ↓
返回候选、证据，并交给复用流程决定是否使用
```

开启开关只开启这套查询能力，不会自动生成事实，也不会把示例数据写入用户的资产池。没有相应的用户数据和关系时，系统必须明确说明本体没有覆盖，并按策略回退到普通检索。

---

## 二、核心概念重新定义

### 2.1 Anchor Entity（锚点实体）

**定义**：每个查询/任务围绕的核心对象。

| Agent 类型 | Primary Anchor | 查询示例 |
|---|---|---|
| Raymond (Companion) | **Person** | "我的项目" / "我负责的任务" |
| Forge (Task Agent) | **Task** | "这个任务的依赖" / "阻塞任务的问题" |
| Artifact Agent | **Artifact** | "这个文档的衍生版本" |
| Process Agent | **Process** | "审批流程的下一步" |

**作用**：
- 查询解析时优先识别 Anchor
- 多跳扩展时从 Anchor 出发
- 加权时 Anchor 匹配优先级最高

**实现**：
```typescript
export interface QueryIntent {
  anchor: {
    type: 'Person' | 'Task' | 'Artifact' | 'Process' | 'Organization';
    id?: string;  // 如果能识别具体实例（如 "我的项目" → Person:user_123）
  };
  // ... 其他字段
}
```

---

### 2.2 查询模式（Query Pattern）

**不再是关键词匹配，而是结构化查询意图**。

| 模式 | 说明 | 示例 | 对应 SPARQL |
|---|---|---|---|
| **retrieve** | 取回实体的属性 | "张三的邮箱是什么" | SELECT |
| **navigate** | 沿关系找相关实体 | "依赖 X 的模块" | CONSTRUCT |
| **check** | 验证条件是否满足 | "这个供应商合规吗" | ASK |
| **aggregate** | 统计/计算 | "在职员工总数" | SELECT COUNT |

**实现**：
```typescript
export type QueryPattern = 'retrieve' | 'navigate' | 'check' | 'aggregate';

export interface QueryIntent {
  pattern: QueryPattern;
  
  // retrieve: 想要什么属性
  targetAttributes?: string[];
  
  // navigate: 沿什么关系
  relationPath?: {
    from: string;      // 'api-gateway'
    via: string[];     // ['depends_on']
    to: string;        // 'Module'
    maxHops?: number;  // 默认 1；由内置引擎按资源预算限制，当前上限 8
  };
  
  // check: 验证什么规则
  rule?: string;
  
  // aggregate: 聚合函数
  aggregation?: 'count' | 'sum' | 'avg';
}
```

---

### 2.3 实体对齐（Entity Alignment）

**定义**：用户词汇 ↔ 用户本体实体 ↔ 用户已接入的物理数据源的三层映射。

这里的映射由用户本体、能力资产元数据或 Connector 提供，不能由 CogSeed 针对某个行业预置一套固定业务规则。下面的内容仅是说明格式的示例。

```
用户层       本体层              物理层
"在职员工" → Employee         → employee WHERE resignation_status=0
"985学校"  → University.is985 → universities_reference.is_985 = true
"接口文档" → API.documentation → files WHERE kind='api-spec'
```

**三种对齐类型**：

#### 1. 同义词对齐（Synonym Alignment）
```typescript
const synonyms = {
  'Employee': ['员工', '雇员', 'staff', 'personnel'],
  'API': ['接口', 'interface', 'endpoint'],
};
```

#### 2. 规则对齐（Rule-based Alignment，来源于用户本体或 Connector）
```typescript
const alignmentRules = {
  'Employee': {
    userTerm: '在职员工',
    ontologyEntity: 'Employee',
    constraint: 'resignation_status = 0',
  },
};
```

#### 3. 引用表对齐（Reference Table Alignment，来源于用户数据源配置）
```typescript
const referenceAlignments = {
  'University.is985': {
    sourceField: 'university_name',
    referenceTable: 'universities_reference',
    joinKey: 'name',
    targetField: 'is_985',
  },
};
```

---

### 2.4 Ontology Slice（本体切片）

**定义**：根据 Task + Anchor + Context 动态召回的本体子集。

```typescript
export interface OntologySlice {
  // T-Box: 相关的实体类型
  types: {
    [typeName: string]: {
      attributes: string[];
      supertypes: string[];
    };
  };
  
  // R-Box: 相关的关系和规则
  relations: {
    [relationType: string]: {
      domain: string;    // 关系的起点类型
      range: string;     // 关系的终点类型
      constraints?: string[];
    };
  };
  
  rules: {
    [ruleName: string]: {
      condition: string;
      action: string;
    };
  };
  
  // A-Box: 相关的实体实例（按需，不全量）
  instances: {
    [entityId: string]: {
      type: string;
      properties: Record<string, any>;
    };
  };

  // 可选：由用户本体或 Connector 提供的运行时对齐配置
  alignments?: {
    terms?: Array<{ queryTerms: string[]; entityId: string }>;
    conditions?: Array<{ queryTerms: string[]; key: string; conditions: string[] }>;
    references?: Array<{
      queryTerms: string[];
      key: string;
      table: string;
      filters: Record<string, string>;
    }>;
  };
}
```

**加载策略**：
- ❌ 不全量加载：`loadOntologyContext(uid)` 返回整个本体（几 MB）
- ✅ 按需召回：`retrieveOntologySlice(uid, { anchor, entities, relations })` 返回相关子集（几 KB）

**数据来源约束**：切片加载器只负责从用户当前可见的本体和能力资产关系中提取运行时子图，不负责创建行业知识，也不负责把示例规则写入用户数据。

---

## 三、架构设计

### 3.1 文件结构

```
src/main/features/ontology/
├── ontology-query.ts              # 主入口：本体驱动查询
├── intent-parser.ts               # 查询意图解析（Anchor + Pattern + Target）
├── entity-aligner.ts              # 实体对齐（用户词 → 本体实体）
├── relation-navigator.ts          # 关系导航（内置 BFS）
├── ontology-capability-plugin.ts  # CogSeed 内置本体能力插件边界
├── ontology-slice-loader.ts       # 按需加载本体切片
├── result-assembler.ts            # 结构化结果组装
├── connectors/
│   ├── semantica-connector.ts     # 外部 Semantica 兼容扩展（可选，不是运行依赖）
│   ├── vector-connector.ts        # 向量库 Connector
│   └── database-connector.ts      # 数据库 Connector
└── ontology-query.test.ts
```

每个文件顶部标注：
```typescript
// Design inspired by Semantica: https://github.com/chen-yuxuan/Semantica
// Specifically: [具体参考的文件/机制]
```

---

### 3.2 主入口：`ontology-query.ts`

```typescript
// Design inspired by Semantica: https://github.com/chen-yuxuan/Semantica
// Core concept: Ontology-driven query execution vs vector-only retrieval

import type { QueryIntent, OntologySlice, StructuredResult } from './types';

/**
 * 本体驱动查询：从关系图出发理解意图、定位实体、组装答案。
 * 
 * 与纯向量检索的差异：
 * - 向量检索：query → embed → cosine similarity → 返回相似文档
 * - 本体查询：query → parse intent → navigate graph → fetch details → assemble
 * 
 * @param uid 用户 ID
 * @param query 用户查询
 * @param schema Input/Output Schema（可选，如果是 Skill 调用则提供）
 */
export async function queryWithOntology(
  uid: string,
  query: string,
  schema?: {
    inputSchema?: Record<string, any>;
    outputSchema?: Record<string, any>;
  },
): Promise<StructuredResult> {
  
  // ─────────────────────────────────────────────────────────────
  // Phase 1: 查询意图解析
  // ─────────────────────────────────────────────────────────────
  // 识别 Anchor、Pattern、Target、Path
  const intent = await parseQueryIntent(query, schema?.inputSchema);
  
  log.info('Parsed query intent', {
    anchor: intent.anchor,
    pattern: intent.pattern,
    target: intent.target,
  });
  
  // ─────────────────────────────────────────────────────────────
  // Phase 2: 实体对齐
  // ─────────────────────────────────────────────────────────────
  // 用户词汇 → 本体实体（同义词 + 规则 + 引用表）
  const aligned = await alignUserTerms(uid, intent);
  
  log.info('Aligned entities', {
    original: intent.entities,
    aligned: aligned.entities,
    appliedRules: aligned.appliedRules,
  });
  
  // ─────────────────────────────────────────────────────────────
  // Phase 3: 按需加载本体切片
  // ─────────────────────────────────────────────────────────────
  // 不全量加载，只召回相关的 T-Box/R-Box/A-Box
  const ontologySlice = await loadOntologySlice(uid, {
    anchor: intent.anchor,
    entities: aligned.entities,
    relations: intent.relationPath?.via || [],
  });
  
  log.info('Loaded ontology slice', {
    types: Object.keys(ontologySlice.types).length,
    relations: Object.keys(ontologySlice.relations).length,
    instances: Object.keys(ontologySlice.instances).length,
  });
  
  // ─────────────────────────────────────────────────────────────
  // Phase 4: 本体查询（关系导航）
  // ─────────────────────────────────────────────────────────────
  let relatedEntities: Set<string>;
  
  if (intent.pattern === 'navigate' && intent.relationPath) {
    // 判断查询复杂度
    const isComplexQuery = 
      intent.relationPath.maxHops && intent.relationPath.maxHops > 2 ||
      intent.relationPath.via.length > 2 ||
      ontologySlice.instances && Object.keys(ontologySlice.instances).length > 5000;
    
    if (isComplexQuery) {
      // 复杂查询：交给 CogSeed 内置本体插件的高级图查询/规则引擎。
      // 外部 Semantica 只作为未来可选的兼容扩展，不是运行前提。
      relatedEntities = await ontologyPlugin.queryGraph({
        from: intent.relationPath.from,
        via: intent.relationPath.via,
        to: intent.relationPath.to,
        maxHops: intent.relationPath.maxHops || 2,
      });
    } else {
      // 简单查询：内置 BFS 关系导航
      relatedEntities = await navigateRelationships(
        intent.relationPath.from,
        intent.relationPath.via,
        ontologySlice,
        intent.relationPath.maxHops || 2,
      );
    }
  } else {
    // retrieve / check / aggregate 模式：直接用对齐后的实体
    relatedEntities = new Set(aligned.entities);
  }
  
  log.info('Related entities found', {
    count: relatedEntities.size,
    sample: Array.from(relatedEntities).slice(0, 5),
  });
  
  // ─────────────────────────────────────────────────────────────
  // Phase 5: 多源取回详细内容
  // ─────────────────────────────────────────────────────────────
  // 用实体 ID 去各数据源精确取回
  const details = await fetchFromMultipleSources(uid, relatedEntities, {
    includeVectorStore: true,    // 从向量库取文档片段
    includeDatabase: true,        // 从数据库取结构化数据
    includeFileSystem: false,     // 根据需要
  });
  
  // ─────────────────────────────────────────────────────────────
  // Phase 6: 结构化组装
  // ─────────────────────────────────────────────────────────────
  // 按 Output Schema 组装，附加证据链
  const result = assembleStructuredResult(details, {
    outputSchema: schema?.outputSchema,
    intent,
    ontologySlice,
    evidenceChain: {
      queryIntent: intent,
      alignedEntities: aligned,
      ontologyPath: intent.relationPath,
      sources: details.map(d => d.source),
    },
  });
  
  return result;
}
```

---

### 3.3 查询意图解析：`intent-parser.ts`

```typescript
// Design inspired by Semantica: context/context_retriever.py (entity/relation extraction)
// Key difference: We parse structured intent (Pattern + Anchor + Path), not just keywords

import type { QueryIntent } from './types';

/**
 * 从自然语言查询中解析结构化意图。
 * 
 * 与关键词提取的差异：
 * - 关键词提取：["依赖", "API网关", "模块"] → 平铺列表
 * - 意图解析：{ pattern: 'navigate', from: 'api-gateway', via: ['depends_on'], to: 'Module' }
 */
export async function parseQueryIntent(
  query: string,
  inputSchema?: Record<string, any>,
): Promise<QueryIntent> {
  
  const normalized = query.toLowerCase();
  
  // ─────────────────────────────────────────────────────────────
  // Step 1: 识别 Anchor Entity
  // ─────────────────────────────────────────────────────────────
  const anchor = detectAnchor(normalized, inputSchema);
  
  // ─────────────────────────────────────────────────────────────
  // Step 2: 识别查询模式
  // ─────────────────────────────────────────────────────────────
  const pattern = detectPattern(normalized);
  
  // ─────────────────────────────────────────────────────────────
  // Step 3: 提取实体和关系
  // ─────────────────────────────────────────────────────────────
  const entities = extractEntities(normalized);
  const relations = extractRelations(normalized);
  
  // ─────────────────────────────────────────────────────────────
  // Step 4: 构建关系路径（如果是 navigate 模式）
  // ─────────────────────────────────────────────────────────────
  let relationPath;
  if (pattern === 'navigate' && relations.length > 0) {
    relationPath = buildRelationPath(entities, relations);
  }
  
  return {
    raw: query,
    anchor,
    pattern,
    entities,
    relations,
    relationPath,
  };
}

function detectAnchor(query: string, inputSchema?: Record<string, any>) {
  // 优先从 Input Schema 推断
  if (inputSchema?.anchor) {
    return inputSchema.anchor;
  }
  
  // 从查询中匹配关键词
  const anchorKeywords = {
    Person: ['我的', '我负责', '我创建', '我参与', '张三', '李四'],
    Task: ['任务', '待办', 'task', 'todo'],
    Artifact: ['文档', '文件', '代码', '设计稿'],
    Process: ['流程', '审批', '工作流'],
  };
  
  for (const [type, keywords] of Object.entries(anchorKeywords)) {
    if (keywords.some(kw => query.includes(kw))) {
      return { type, id: undefined };
    }
  }
  
  // 默认 Person（面向 Companion Agent）
  return { type: 'Person', id: undefined };
}

function detectPattern(query: string): QueryPattern {
  // navigate: 关系导航
  if (/依赖|相关|连接|关联|引用/.test(query)) {
    return 'navigate';
  }
  
  // check: 条件验证
  if (/是否|合规|满足|符合/.test(query)) {
    return 'check';
  }
  
  // aggregate: 统计
  if (/多少|总数|平均|总和|count|sum/.test(query)) {
    return 'aggregate';
  }
  
  // retrieve: 默认
  return 'retrieve';
}

function extractEntities(query: string): string[] {
  // 简化实现：匹配已知实体 ID 或类型名
  // 生产环境可接入轻量 NER
  const entities: string[] = [];
  
  // 示例：从本体中加载已知实体列表进行匹配
  // 实际实现需要访问 ontology-taxonomy.ts 和 asset-relations.ts
  
  return entities;
}

function extractRelations(query: string): string[] {
  const relationKeywords: Record<string, string[]> = {
    refines: ['细化', '优化', 'refine'],
    depends_on: ['依赖', 'depend'],
    replaces: ['替换', 'replace'],
    conflicts_with: ['冲突', 'conflict'],
    related_to: ['相关', 'relate'],
  };
  
  const relations: string[] = [];
  for (const [kind, keywords] of Object.entries(relationKeywords)) {
    if (keywords.some(kw => query.includes(kw))) {
      relations.push(kind);
    }
  }
  
  return relations;
}

function buildRelationPath(entities: string[], relations: string[]) {
  // 简化：假设查询格式为 "A [relation] B"
  // 实际需要更复杂的依存句法分析
  if (entities.length >= 1 && relations.length >= 1) {
    return {
      from: entities[0],
      via: relations,
      to: entities[1] || 'any',  // 如果没有明确终点，返回所有相关实体
    };
  }
  return undefined;
}
```

---

### 3.4 实体对齐：`entity-aligner.ts`

```typescript
// Design inspired by Semantica: triplet_store/query_engine.py (expand_entity_uri + alignment)
// Key insight: User terms ≠ Ontology entities ≠ Physical schema

import type { QueryIntent, AlignedEntities } from './types';

/**
 * 实体对齐：用户词汇 → 本体实体 → 物理数据源。
 * 
 * 三层映射：
 * 1. 同义词对齐："在职员工" → "Employee"
 * 2. 规则对齐："Employee" + "业务约束 resignation_status=0"
 * 3. 引用表对齐："985学校" → universities_reference.is_985=true
 */
export async function alignUserTerms(
  uid: string,
  intent: QueryIntent,
): Promise<AlignedEntities> {
  
  const aligned: string[] = [];
  const appliedRules: string[] = [];
  
  for (const userTerm of intent.entities) {
    
    // ─────────────────────────────────────────────────────────────
    // Layer 1: 同义词对齐
    // ─────────────────────────────────────────────────────────────
    const ontologyEntity = synonymLookup(userTerm);
    
    // ─────────────────────────────────────────────────────────────
    // Layer 2: 规则对齐（条件填空）
    // ─────────────────────────────────────────────────────────────
    const rule = getRuleForEntity(ontologyEntity, intent);
    if (rule) {
      appliedRules.push(rule.name);
      // 规则会在后续查询时作为 WHERE 子句追加
    }
    
    // ─────────────────────────────────────────────────────────────
    // Layer 3: 引用表对齐
    // ─────────────────────────────────────────────────────────────
    const referenceMapping = getReferenceMapping(ontologyEntity);
    if (referenceMapping) {
      // 生成 JOIN 子句
      appliedRules.push(`reference:${referenceMapping.table}`);
    }
    
    aligned.push(ontologyEntity);
  }
  
  return {
    entities: aligned,
    appliedRules,
  };
}

// ─────────────────────────────────────────────────────────────
// 同义词表（可从 ontology-refs.ts 或配置文件加载）
// ─────────────────────────────────────────────────────────────
// 仅为文档示例；生产实现从运行时本体、能力资产或 Connector 读取。
const synonyms: Record<string, string[]> = {
  Employee: ['员工', '雇员', '在职员工', 'staff'],
  API: ['接口', 'interface', 'endpoint'],
  Module: ['模块', 'service', '服务'],
};

function synonymLookup(userTerm: string): string {
  for (const [entity, syns] of Object.entries(synonyms)) {
    if (syns.some(syn => userTerm.includes(syn))) {
      return entity;
    }
  }
  return userTerm;  // 无匹配时原样返回
}

// ─────────────────────────────────────────────────────────────
// 规则表（条件填空）
// ─────────────────────────────────────────────────────────────
// 仅为文档示例；生产实现由用户本体或 Connector 注册。
const alignmentRules = [
  {
    name: 'Employee.activeOnly',
    entity: 'Employee',
    context: ['在职', '当前', '现有'],
    constraint: 'resignation_status = 0',
  },
  {
    name: 'Contract.valid',
    entity: 'Contract',
    context: ['有效', '生效中'],
    constraint: 'status = "active" AND end_date > NOW()',
  },
];

function getRuleForEntity(entity: string, intent: QueryIntent) {
  return alignmentRules.find(
    rule => rule.entity === entity && 
            rule.context.some(ctx => intent.raw.includes(ctx))
  );
}

// ─────────────────────────────────────────────────────────────
// 引用表映射
// ─────────────────────────────────────────────────────────────
// 仅为文档示例；生产实现由用户数据源配置提供。
const referenceMappings = [
  {
    entity: 'University',
    attribute: 'is985',
    table: 'universities_reference',
    joinKey: 'name',
    targetField: 'is_985',
  },
];

function getReferenceMapping(entity: string) {
  return referenceMappings.find(m => m.entity === entity);
}
```

---

### 3.5 关系导航：`relation-navigator.ts`

```typescript
// Design inspired by Semantica: triplet_store/query_engine.py (BFS multi-hop traversal)
// Implementation: TypeScript BFS over asset-relations graph

import type { OntologySlice } from './types';

/**
 * 关系导航：从起点实体出发，沿指定关系类型进行 BFS 多跳扩展。
 * 
 * 对应 Semantica 的 `collections.deque` BFS 遍历。
 */
export async function navigateRelationships(
  fromEntity: string,
  viaRelations: string[],  // ['depends_on', 'refines']
  ontologySlice: OntologySlice,
  maxHops: number = 2,
): Promise<Set<string>> {
  
  const expanded = new Set<string>();
  const queue: Array<{ entityId: string; depth: number }> = [
    { entityId: fromEntity, depth: 0 },
  ];
  const visited = new Set<string>();
  
  while (queue.length > 0) {
    const current = queue.shift()!;
    
    if (visited.has(current.entityId)) continue;
    visited.add(current.entityId);
    expanded.add(current.entityId);
    
    if (current.depth >= maxHops) continue;
    
    // 从 A-Box 实例中查找当前实体的关系
    const instance = ontologySlice.instances[current.entityId];
    if (!instance || !instance.relations) continue;
    
    for (const rel of instance.relations) {
      // 只沿指定类型的关系扩展
      if (viaRelations.includes(rel.kind)) {
        if (!expanded.has(rel.targetId)) {
          queue.push({
            entityId: rel.targetId,
            depth: current.depth + 1,
          });
        }
      }
    }
  }
  
  return expanded;
}
```

---

### 3.6 本体能力插件与 Semantica 兼容扩展

```typescript
// Design inspired by Semantica: reasoning/sparql_reasoner.py (SPARQL query execution)
// CogSeed 内置本体插件参考 Semantica 的查询边界；外部适配器不是必选依赖。

/**
 * 本体能力插件：复杂图查询和规则推理的统一接口。
 * 
 * 使用场景：
 * - 关系遍历和多条件组合查询
 * - 大规模本体和规则推理
 * 
 * 不使用场景：
 * - 首阶段简单 1-2 跳查询（用内置 BFS）
 * - 本体规模 < 1000 实体
 */
export interface OntologyCapabilityPlugin {
  queryGraph(params: {
  from: string;
  via: string[];
  to: string;
  maxHops: number;
  }): Promise<Set<string>>;
}

// 如果部署方已有真正的 Semantica，可另写适配器实现同一接口；
// 这属于可选扩展，不影响 CogSeed 自带本体插件独立运行。
```

---

### 3.7 结构化结果组装：`result-assembler.ts`

```typescript
// Design inspired by ECS document: Input/Output Schema + Evidence Graph

import type { StructuredResult, EntityDetail, EvidenceChain } from './types';

/**
 * 结构化结果组装：按 Output Schema 组装答案 + 附加证据链。
 * 
 * 与纯检索返回的差异：
 * - 纯检索：返回 VecSearchHit[]（文档片段 + 相似度得分）
 * - 结构化组装：返回 { entities, relations, evidence, explanation }
 */
export function assembleStructuredResult(
  details: EntityDetail[],
  options: {
    outputSchema?: Record<string, any>;
    intent: QueryIntent;
    ontologySlice: OntologySlice;
    evidenceChain: EvidenceChain;
  },
): StructuredResult {
  
  // ─────────────────────────────────────────────────────────────
  // 按 Output Schema 过滤和格式化
  // ─────────────────────────────────────────────────────────────
  const entities = details.map(d => ({
    id: d.entityId,
    type: d.type,
    properties: filterBySchema(d.properties, options.outputSchema),
    source: d.source,
  }));
  
  // ─────────────────────────────────────────────────────────────
  // 提取关系（如果查询模式是 navigate）
  // ─────────────────────────────────────────────────────────────
  const relations = options.intent.pattern === 'navigate' 
    ? extractRelations(details, options.ontologySlice)
    : [];
  
  // ─────────────────────────────────────────────────────────────
  // 构建证据链（可解释性）
  // ─────────────────────────────────────────────────────────────
  const evidence = {
    queryIntent: options.evidenceChain.queryIntent,
    ontologyPath: options.evidenceChain.ontologyPath,
    alignedEntities: options.evidenceChain.alignedEntities,
    sources: options.evidenceChain.sources,
  };
  
  // ─────────────────────────────────────────────────────────────
  // 生成自然语言解释
  // ─────────────────────────────────────────────────────────────
  const explanation = generateExplanation(options.intent, evidence, entities);
  
  return {
    entities,
    relations,
    evidence,
    explanation,
  };
}

function filterBySchema(properties: Record<string, any>, schema?: Record<string, any>) {
  if (!schema) return properties;
  
  // 只返回 schema 中声明的字段
  const filtered: Record<string, any> = {};
  for (const key of Object.keys(schema)) {
    if (key in properties) {
      filtered[key] = properties[key];
    }
  }
  return filtered;
}

function extractRelations(details: EntityDetail[], ontologySlice: OntologySlice) {
  const relations: Array<{ from: string; type: string; to: string }> = [];
  
  for (const detail of details) {
    const instance = ontologySlice.instances[detail.entityId];
    if (instance?.relations) {
      for (const rel of instance.relations) {
        relations.push({
          from: detail.entityId,
          type: rel.kind,
          to: rel.targetId,
        });
      }
    }
  }
  
  return relations;
}

function generateExplanation(
  intent: QueryIntent,
  evidence: any,
  entities: any[],
): string {
  if (intent.pattern === 'navigate' && intent.relationPath) {
    return `根据本体关系图，从 ${intent.relationPath.from} 沿 ${intent.relationPath.via.join(' → ')} 关系找到 ${entities.length} 个相关实体。`;
  }
  
  if (intent.pattern === 'aggregate') {
    return `统计结果：共 ${entities.length} 条记录符合条件。`;
  }
  
  return `查询返回 ${entities.length} 个匹配实体。`;
}
```

---

## 四、与现有代码的集成

### 4.1 现有本体资源复用

| 现有模块 | 复用内容 | 在新设计中的用途 |
|---|---|---|
| `ontology-taxonomy.ts` | T-Box 类型定义 | 查询意图解析的类型匹配 |
| `asset-relations.ts` | R-Box 关系图 | 关系导航的边遍历 |
| `ontology-refs.ts` | URI 对齐映射 | 实体对齐的引用表查询 |
| `personal_ontology_router.ts` | 用户本体实例加载 | 按需加载本体切片的入口 |
| `vec_store.ts` | 向量检索 | 作为 Connector 之一，精确取回文档内容 |

### 4.2 暴露为 LLM 工具

```typescript
// tools/ontology_query_tool.ts
export const ontologyQueryTool = {
  name: 'ontology_query',
  description: `本体驱动查询：从关系图出发理解意图、定位实体、组装答案。

使用场景：
- 关系查询："依赖 X 的模块" / "A 和 B 的关联"
- 条件查询："在职员工" / "有效合同"
- 统计查询："项目总数" / "平均完成时间"

NOT 使用场景：
- 模糊语义搜索："类似的文档" → 用 kb_search
- 全文检索："包含关键词的文件" → 用 kb_search`,
  
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: '用户查询' },
      anchor: {
        type: 'object',
        description: '锚点实体（可选，帮助提升准确度）',
        properties: {
          type: { type: 'string', enum: ['Person', 'Task', 'Artifact', 'Process'] },
          id: { type: 'string' },
        },
      },
      outputSchema: {
        type: 'object',
        description: '期望的输出结构（可选）',
      },
    },
    required: ['query'],
  },
  
  async execute(params: { query: string; anchor?: any; outputSchema?: any }) {
    return queryWithOntology(getCurrentUserId(), params.query, {
      inputSchema: { anchor: params.anchor },
      outputSchema: params.outputSchema,
    });
  },
};
```

### 4.3 与现有 `kb_search` 的分工

| 工具 | 适用场景 | 返回格式 |
|---|---|---|
| `kb_search` | 模糊语义搜索、全文检索、"找相关文档" | VecSearchHit[]（文档片段 + 得分） |
| `ontology_query` | 关系查询、条件查询、统计查询、"问是什么/连着谁" | StructuredResult（实体 + 关系 + 证据） |

**LLM 自动选择**：
- 用户问"依赖 API 网关的模块" → LLM 选择 `ontology_query`
- 用户问"API 网关相关的文档" → LLM 选择 `kb_search`

---

## 五、实施路径

### Phase 0：验证适用性（1 周）

**目标**：验证在已经存在明确实体和关系的场景中，本体查询是否比单纯相似度检索更适合；不预先假设本体查询在所有场景都优于向量检索。

**验证案例**：
1. **依赖查询**：
   - 问题："依赖 `api-gateway` 的模块"
   - 向量检索：召回提到"API 网关"的所有文档（包含无关的描述性文字）
   - 本体查询：从 `asset-relations` 直接查 `depends_on: api-gateway`，精确返回 3 个模块
   - **度量**：准确率、召回率

2. **条件填空**：
   - 问题："公司有多少在职员工"
   - 向量检索：无法区分在职/离职
   - 本体查询：补充 `resignation_status=0`，精确统计
   - **度量**：结果正确性

**产出**：
- 使用测试夹具或用户真实数据的验证报告
- 明确哪些问题适合本体查询，哪些问题继续使用 `kb_search`
- 决策：是否继续 Phase 1

---

### Phase 1：通用查询原型（2-3 周）

**范围**：
1. 实现查询意图解析（识别 Anchor + Pattern + 简单关系）
2. 实现实体对齐（从运行时本体、能力资产和 Connector 读取，不写死业务词表）
3. 实现内置关系导航（BFS，1-2 跳）
4. 暴露为 LLM 工具 `ontology_query`
5. 编写单元测试

**不做**：
- 外部 Semantica 适配器（不是产品运行依赖）
- 复杂查询解析（后续阶段）
- 引用表对齐（Phase 3）

**验证方式**：
- 使用测试夹具验证实体、关系和多跳查询
- 使用用户实际沉淀的能力资产验证 `ontology_query`

---

### Phase 2：内置本体插件完善（2 周）

**范围**：
1. 将本体查询、规则执行和证据链整理为 CogSeed 内置插件接口
2. 在插件内部区分简单关系导航、复杂图查询和规则推理
3. 实现本体数据缺失或规则无法执行时的可解释降级
4. 性能测试，保证插件不会拖慢普通资产复用流程

**验证方式**：
- 3+ 跳查询：内置本体插件能正确返回或明确说明缺少能力
- 插件能力关闭时：系统降级到原有资产检索，不崩溃

---

### Phase 3：动态本体对齐与切片（1-2 周）

**范围**：
1. 支持从用户本体和 Connector 读取引用表、属性和条件映射
2. 提供通用规则注册和执行边界，不预置某个行业的 20 条业务规则
3. 同义词从运行时本体、能力资产和数据源元数据自动提取
4. 按需加载用户当前任务相关的本体切片，不全量加载

---

### Phase 4：能力复用闭环与评估（1 周）

**范围**：
1. 在结果中返回完整证据链（查询意图 → 动态实体对齐 → 本体路径 → 数据源）
2. 生成自然语言解释（"因为 X 依赖 Y，所以召回了 Z"）
3. 将关系查询结果交给能力资产复用排序/注入流程
4. 建立基于用户真实沉淀数据的评估集，量化准确率、召回率和复用效果
5. 在同一批真实数据上比较 `kb_search`、`ontology_query` 和混合模式

**阶段边界**：Phase 4 的验收对象不是示例知识是否存在，而是用户沉淀知识后，系统能否正确理解、查询并复用这些知识。

### 当前实现状态校正

截至本方案修订时，CogSeed 已完成的是“内置本体关系查询 MVP”：能够读取已持久化的能力资产关系，执行有限多跳查询，并返回证据路径。它还不能被表述为完整的通用本体能力或完整的能力复用闭环。

当前实现与最终目标的差距如下：

| 项目 | 当前状态 | 最终要求 |
| --- | --- | --- |
| 查询引擎 | 已有内置关系查询和多跳导航 | 保持为 CogSeed 内置通用逻辑 |
| 运行时数据 | 主要读取能力资产已有关系 | 所有实体、关系、同义词和条件来自用户动态沉淀或 Connector |
| 示例规则 | 部分测试代码含演示规则 | 移出生产默认逻辑，只保留测试夹具 |
| 能力复用 | 能返回关系候选 | 接入适用性判断、排序、注入/调用和效果反馈 |
| 评估 | 已有指标计算和比较接口 | 用同一批用户真实数据产生 A/B 结论 |

因此，当前验收结论应写为“关系查询基础能力完成”，而不是“老师要求的本体驱动能力复用最终目标完成”。

---

## 六、风险与限制

### 6.1 技术风险

| 风险 | 缓解措施 |
|---|---|
| **查询意图解析准确率低**（简单规则容易误判） | Phase 1 先用规则验证可行性；Phase 3+ 可接入轻量 NER |
| **本体覆盖率不足**（用户本体未建立） | 优雅降级：本体缺失时回退到 `kb_search` |
| **本体插件复杂度**（查询、规则和证据需要统一） | 先实现内置关系导航，再逐步加入规则和复杂图查询 |
| **性能**（本体查询比向量慢） | 加缓存（查询意图 → 结果）；异步预加载本体切片 |

### 6.2 工程约束

- **不触碰 embedding schema**：本期不改 `bge-small-zh-v1.5` 模型、512 维度、切块逻辑
- **不引入重依赖**：不使用图数据库（Neo4j/ArangoDB），不打包 Python 运行时
- **代码注释标注来源**：所有复刻代码顶部标注 `// Design inspired by Semantica: <url>`
- **可插拔**：本体能力作为 CogSeed 内置插件，可开关；外部 Semantica 适配器不是运行依赖

---

## 七、核心差异总结

### 旧设计（v1.0：检索增强）vs 新设计（v2.0：本体驱动）

| 维度 | v1.0 检索增强 | v2.0 本体驱动 |
|---|---|---|
| **主索引** | 向量相似度（cosine） | 本体关系图（T-Box/R-Box/A-Box） |
| **本体角色** | 召回后重排的加权因子（×1.15/×1.25） | 查询理解 + 实体定位的主引擎 |
| **Semantica 定位** | 借鉴三个机制，纯 TS 复刻到核心链路 | 作为内置本体插件的参考来源；外部适配器仅为可选扩展 |
| **输入** | 用户查询字符串 | 用户查询 + Anchor + Input Schema |
| **输出** | 重排后的 VecSearchHit[]（文档片段） | StructuredResult（实体 + 关系 + 证据链） |
| **典型场景** | "找相关文档" / "语义搜索" | "找依赖 X 的能力" / "查询用户已沉淀的关系" |
| **可解释性** | "向量距离近 + 本体加权" | "本体关系图显示 A depends_on B" |
| **降级策略** | 关闭本体 → 纯向量检索 | 本体缺失 → 回退到 `kb_search` |

---

## 八、参考资料索引

### Semantica 侧（参考源）

| 文件 | 参考机制 | 在新设计中的对应 |
|---|---|---|
| `context/context_retriever.py` | 混合检索主入口 | `ontology-query.ts` 的整体流程 |
| `triplet_store/query_engine.py` | BFS 多跳 + `expand_entity_uri` 对齐 | `relation-navigator.ts` + `entity-aligner.ts` |
| `reasoning/sparql_reasoner.py` | SPARQL 查询与规则推理 | 内置本体插件的复杂查询设计；外部适配器可复用同一接口 |

### CogSeed 侧（复用资源）

| 文件 | 作用 | 在新设计中的用途 |
|---|---|---|
| `ontology-taxonomy.ts` | T-Box 类型定义 | 查询意图解析的类型匹配 |
| `asset-relations.ts` | R-Box 关系图 | 关系导航的边遍历 |
| `ontology-refs.ts` | URI 对齐映射 | 实体对齐的引用表查询 |
| `vec_store.ts` | 向量检索 | 作为 Connector 之一取回文档内容 |

### 会议 + 文档（设计依据）

| 来源 | 关键思想 | 在新设计中的体现 |
|---|---|---|
| 9.1 分享会 | "本体服务 Skill" / "可插拔工具" | CogSeed 内置本体插件，并保留 Connector 扩展边界 |
| ECS 文档 | Anchor Entity / 按需切片加载 | 查询意图解析 + 本体切片加载 |
| "辞职=0" 案例 | 条件填空 | 实体对齐的规则层 |
| "985/211" 案例 | 引用表对齐 | 实体对齐的引用表层 |

---

## 九、总结

### 核心转变

**从**：
> "向量检索是主引擎，本体是增强信号"

**到**：
> "本体是主引擎，向量检索是数据源之一"

### 关键洞察

1. **本体不是用来"重排"的，是用来"理解查询意图"的**
   - 不是"召回 100 条 → 加权 → 重排"
   - 而是"理解意图 → 精确定位 → 取回 → 组装"

2. **参考 Semantica 的思路，不要求用户安装 Semantica**
   - 本体查询和推理能力随 CogSeed 内置发布
   - 外部 Semantica 只作为未来可选的兼容扩展

3. **查询不是关键词匹配，是结构化意图解析**
   - 不是 `["依赖", "API网关", "模块"]`
   - 而是 `{ pattern: 'navigate', from: 'api-gateway', via: ['depends_on'], to: 'Module' }`

4. **引擎和数据必须分离**
   - CogSeed 内置的是本体解析、切片、导航、证据和复用接口
   - 用户在使用过程中沉淀的资产、实体和关系才是运行时知识
   - 任何具体行业例子都不能被当作产品默认规则

### 预期收益

1. **关系查询更可靠**：对已经沉淀关系的查询，按关系事实返回，而不是只依据文本相似度
2. **能力组合更完整**：可以发现目标能力的依赖、替代、冲突和配套资产
3. **可解释性**：返回本体路径和证据链，而不是只有黑盒相关度
4. **持续沉淀**：用户新增或修正资产关系后，后续查询可以直接使用最新数据
5. **可插拔**：本体能力可开关；本体没有覆盖时保留原有检索路径

### 下一步

当前关系查询 MVP 只验证了“读取已持久化能力资产关系并进行导航”。下一步应围绕完整闭环推进：

1. 移除运行时中的行业示例规则，统一改为用户本体或 Connector 提供的动态配置；
2. 打通用户沉淀能力资产、实体和关系到本体切片的读取路径；
3. 将本体查询结果接入能力资产的适用性判断、排序和任务复用流程；
4. 使用用户真实沉淀数据建立评估集，再比较 `kb_search`、`ontology_query` 和混合模式。
