# 本体查询能力验证方案

> **目标**：在实现之前/之后，用可量化的方式证明"本体查询 > 纯向量检索"。  
> **适用场景**：Phase 0 验证假设 / Phase 1-4 回归测试 / 给技术负责人演示效果。

---

## 一、验证的三个层次

### 1.1 准确性验证（核心）
**问题**：本体查询是否比向量检索更准？

**方法**：人工标注 Golden Set + 自动对比

### 1.2 可用性验证（插件化）
**问题**：关闭本体查询后系统是否正常？

**方法**：Feature Toggle 开关 + 降级测试

### 1.3 性能验证（工程）
**问题**：本体查询是否太慢？

**方法**：响应时间对比 + 压测

---

## 二、准确性验证设计

### 2.1 测试用例集（Golden Set）

#### 用例分类

| 类别 | 说明 | 示例查询 | 向量检索预期表现 | 本体查询预期表现 |
|---|---|---|---|---|
| **关系查询** | 沿本体关系图导航 | "依赖 API 网关的模块" | ❌ 召回提到"API网关"的所有文档（噪音多） | ✅ 精确返回有 `depends_on` 关系的 3 个模块 |
| **条件填空** | 本体规则补充隐含条件 | "在职员工总数" | ❌ 召回所有员工（含离职） | ✅ 补充 `resignation_status=0`，精确统计 |
| **实体对齐** | 用户词汇 → 本体实体 | "985 毕业的员工" | ❌ 数据库无 `is_985` 字段，查不到 | ✅ 对齐到 `universities_reference` 表 |
| **同义召回** | 同义词扩展 | "接口文档" | ⚠️ 只召回含"接口"的文档 | ✅ 扩展为"接口/API/interface"，召回更全 |
| **多跳查询** | 2+ 跳关系遍历 | "认证模块依赖的第三方库" | ❌ 无法理解"依赖的依赖" | ✅ 2 跳 BFS：认证 → JWT → 加密库 |
| **反事实查询** | 否定/排除条件 | "不依赖数据库的模块" | ❌ 向量无法理解"不" | ✅ 本体查询：`WHERE NOT EXISTS (depends_on: database)` |

#### 具体测试用例（20 条示例）

```json
[
  {
    "id": "T001",
    "category": "关系查询",
    "query": "依赖 api-gateway 的模块有哪些？",
    "groundTruth": ["auth-service", "user-service", "payment-service"],
    "explanation": "从 asset-relations 中查 depends_on 关系"
  },
  {
    "id": "T002",
    "category": "条件填空",
    "query": "公司有多少在职员工？",
    "groundTruth": 42,
    "ontologyRule": "Employee → resignation_status = 0",
    "explanation": "业务上的员工 ≠ 数据库里的 employee 表全量"
  },
  {
    "id": "T003",
    "category": "实体对齐",
    "query": "985 毕业的员工占比",
    "groundTruth": "15/42 = 35.7%",
    "alignment": "university_name → universities_reference.is_985",
    "explanation": "HR 数据库无 is_985 字段，需通过引用表对齐"
  },
  {
    "id": "T004",
    "category": "同义召回",
    "query": "接口文档在哪里",
    "groundTruth": ["api-spec.md", "interface-design.pdf", "endpoint-list.xlsx"],
    "synonyms": ["接口", "API", "interface", "endpoint"],
    "explanation": "不同文档用不同词汇，需同义扩展"
  },
  {
    "id": "T005",
    "category": "多跳查询",
    "query": "认证模块间接依赖了哪些基础库",
    "groundTruth": ["jwt-library", "crypto-lib", "hash-util"],
    "hops": 2,
    "path": "auth-service -[depends_on]-> jwt-library -[depends_on]-> crypto-lib",
    "explanation": "需 2 跳 BFS 遍历"
  },
  {
    "id": "T006",
    "category": "反事实查询",
    "query": "不依赖数据库的模块",
    "groundTruth": ["logger-service", "config-loader"],
    "explanation": "向量检索无法理解否定逻辑"
  },
  {
    "id": "T007",
    "category": "关系查询",
    "query": "哪些模块被 user-service 依赖",
    "groundTruth": ["auth-service", "profile-service"],
    "direction": "reverse",
    "explanation": "反向关系查询：谁依赖我"
  },
  {
    "id": "T008",
    "category": "条件填空",
    "query": "有效合同数量",
    "groundTruth": 8,
    "ontologyRule": "Contract → status='active' AND end_date > NOW()",
    "explanation": "有效 = 生效中 + 未过期"
  },
  {
    "id": "T009",
    "category": "实体对齐",
    "query": "211 但不是 985 的学校毕业的员工",
    "groundTruth": ["employee_A", "employee_B"],
    "alignment": "university_name → universities_reference WHERE is_211=true AND is_985=false",
    "explanation": "复合条件对齐"
  },
  {
    "id": "T010",
    "category": "同义召回",
    "query": "员工花名册",
    "groundTruth": ["employee-roster.xlsx", "staff-list.pdf", "personnel-directory.csv"],
    "synonyms": ["员工", "雇员", "staff", "personnel"],
    "explanation": "不同部门用不同术语"
  },
  // ... 再加 10 条覆盖边界情况
]
```

---

### 2.2 评估指标

#### 指标 1：准确率（Precision）

**定义**：返回结果中有多少是正确的。

```
Precision = 正确返回的数量 / 总返回数量
```

**示例**：
- 查询："依赖 api-gateway 的模块"
- Ground Truth：`[auth-service, user-service, payment-service]`
- 向量检索返回：`[auth-service, user-service, gateway-docs, api-usage-guide, payment-service]`（5 条）
  - 正确：3 条
  - Precision = 3/5 = 60%
- 本体查询返回：`[auth-service, user-service, payment-service]`（3 条）
  - 正确：3 条
  - Precision = 3/3 = 100%

---

#### 指标 2：召回率（Recall）

**定义**：正确答案中有多少被召回。

```
Recall = 正确返回的数量 / Ground Truth 总数
```

**示例**：
- Ground Truth：`[auth-service, user-service, payment-service]`（3 条）
- 向量检索返回：`[auth-service, user-service]`（漏了 payment-service）
  - Recall = 2/3 = 66.7%
- 本体查询返回：`[auth-service, user-service, payment-service]`
  - Recall = 3/3 = 100%

---

#### 指标 3：F1 分数（综合评估）

**定义**：准确率和召回率的调和平均。

```
F1 = 2 × (Precision × Recall) / (Precision + Recall)
```

**为什么需要 F1**：
- 只看 Precision：返回 1 条且正确，Precision=100%，但 Recall 很低
- 只看 Recall：返回所有文档，Recall=100%，但 Precision 很低
- F1 平衡两者

---

#### 指标 4：MRR（Mean Reciprocal Rank，排序质量）

**定义**：正确答案的平均排名倒数。

```
MRR = (1 / 第一个正确答案的排名) 的平均值
```

**示例**：
- 查询："依赖 api-gateway 的模块"
- 向量检索排序：`[gateway-docs(错), auth-service(对), api-usage-guide(错), user-service(对), payment-service(对)]`
  - 第一个正确答案在第 2 位 → RR = 1/2 = 0.5
- 本体查询排序：`[auth-service(对), user-service(对), payment-service(对)]`
  - 第一个正确答案在第 1 位 → RR = 1/1 = 1.0

**多个查询的 MRR = 所有 RR 的平均值**

---

#### 指标 5：可解释性（定性）

**评估方式**：人工打分（1-5 分）

| 分数 | 说明 | 示例 |
|---|---|---|
| 5 | 完全可解释，给出清晰路径 | "因为本体关系图显示 auth-service -[depends_on]-> api-gateway" |
| 4 | 部分可解释，给出关键信号 | "匹配了本体类型 Module 和关系 depends_on" |
| 3 | 模糊解释 | "基于本体信号加权" |
| 2 | 只给分数 | "相似度 0.87" |
| 1 | 无解释 | 直接返回结果 |

---

### 2.3 对比基准

#### 三种模式对比

| 模式 | 说明 | 预期表现 |
|---|---|---|
| **纯向量检索** | 现有 `kb_search`，不用本体 | 基准线 |
| **本体查询** | 新的 `ontology_query` | 在关系/条件/对齐类查询上显著优于向量 |
| **混合模式**（可选） | LLM 自动选择向量 or 本体 | 综合最优 |

#### 对比表（示例）

| 查询类别 | 向量 Precision | 向量 Recall | 本体 Precision | 本体 Recall | 提升 |
|---|---|---|---|---|---|
| 关系查询 | 60% | 70% | **95%** | **100%** | +35% / +30% |
| 条件填空 | 40% | 50% | **100%** | **100%** | +60% / +50% |
| 实体对齐 | 0% | 0% | **90%** | **85%** | N/A（向量无法完成） |
| 同义召回 | 65% | 60% | **85%** | **90%** | +20% / +30% |
| 多跳查询 | 30% | 40% | **80%** | **90%** | +50% / +50% |
| **平均** | 39% | 44% | **90%** | **93%** | **+51% / +49%** |

---

### 2.4 实施步骤

#### Step 1：准备 Golden Set（人工标注）

```bash
# 1. 创建测试用例文件
touch test/fixtures/ontology-query/golden-set.json

# 2. 填入 20 条测试用例（参考上面的 JSON 格式）
```

**Golden Set 示例结构**：
```json
{
  "version": "1.0",
  "testCases": [
    {
      "id": "T001",
      "category": "关系查询",
      "query": "依赖 api-gateway 的模块有哪些？",
      "groundTruth": {
        "entities": ["auth-service", "user-service", "payment-service"],
        "count": 3
      },
      "metadata": {
        "ontologyPath": "* -[depends_on]-> api-gateway",
        "difficulty": "easy"
      }
    }
  ]
}
```

---

#### Step 2：实现评估脚本

```typescript
// test/ontology-query-evaluation.ts

import * as fs from 'fs';
import * as kbVector from '../src/main/features/kb_vector';
import * as ontologyQuery from '../src/main/features/ontology/ontology-query';

interface TestCase {
  id: string;
  category: string;
  query: string;
  groundTruth: {
    entities: string[];
    count?: number;
  };
}

interface EvaluationResult {
  testCaseId: string;
  query: string;
  
  // 向量检索结果
  vectorResults: string[];
  vectorPrecision: number;
  vectorRecall: number;
  vectorF1: number;
  vectorRank: number;  // 第一个正确答案的排名
  
  // 本体查询结果
  ontologyResults: string[];
  ontologyPrecision: number;
  ontologyRecall: number;
  ontologyF1: number;
  ontologyRank: number;
  
  // 对比
  improvement: {
    precisionDelta: number;
    recallDelta: number;
    f1Delta: number;
  };
}

async function evaluateTestCase(testCase: TestCase, uid: string): Promise<EvaluationResult> {
  
  // ─────────────────────────────────────────────────────────────
  // 1. 跑向量检索
  // ─────────────────────────────────────────────────────────────
  const vectorQuery = await kbVector.search(uid, testCase.query, { k: 10 });
  const vectorResults = vectorQuery.map(hit => hit.rel_path);
  
  // ─────────────────────────────────────────────────────────────
  // 2. 跑本体查询
  // ─────────────────────────────────────────────────────────────
  const ontologyResult = await ontologyQuery.queryWithOntology(uid, testCase.query);
  const ontologyResults = ontologyResult.entities.map(e => e.id);
  
  // ─────────────────────────────────────────────────────────────
  // 3. 计算指标
  // ─────────────────────────────────────────────────────────────
  const groundTruth = new Set(testCase.groundTruth.entities);
  
  // 向量指标
  const vectorCorrect = vectorResults.filter(r => groundTruth.has(r));
  const vectorPrecision = vectorCorrect.length / vectorResults.length;
  const vectorRecall = vectorCorrect.length / groundTruth.size;
  const vectorF1 = 2 * (vectorPrecision * vectorRecall) / (vectorPrecision + vectorRecall) || 0;
  const vectorRank = vectorResults.findIndex(r => groundTruth.has(r)) + 1 || 999;
  
  // 本体指标
  const ontologyCorrect = ontologyResults.filter(r => groundTruth.has(r));
  const ontologyPrecision = ontologyCorrect.length / ontologyResults.length;
  const ontologyRecall = ontologyCorrect.length / groundTruth.size;
  const ontologyF1 = 2 * (ontologyPrecision * ontologyRecall) / (ontologyPrecision + ontologyRecall) || 0;
  const ontologyRank = ontologyResults.findIndex(r => groundTruth.has(r)) + 1 || 999;
  
  return {
    testCaseId: testCase.id,
    query: testCase.query,
    vectorResults,
    vectorPrecision,
    vectorRecall,
    vectorF1,
    vectorRank,
    ontologyResults,
    ontologyPrecision,
    ontologyRecall,
    ontologyF1,
    ontologyRank,
    improvement: {
      precisionDelta: ontologyPrecision - vectorPrecision,
      recallDelta: ontologyRecall - vectorRecall,
      f1Delta: ontologyF1 - vectorF1,
    },
  };
}

async function runEvaluation() {
  const goldenSet = JSON.parse(fs.readFileSync('test/fixtures/ontology-query/golden-set.json', 'utf-8'));
  const uid = 'test-user';  // 测试用户
  
  const results: EvaluationResult[] = [];
  
  for (const testCase of goldenSet.testCases) {
    console.log(`Evaluating ${testCase.id}: ${testCase.query}`);
    const result = await evaluateTestCase(testCase, uid);
    results.push(result);
  }
  
  // ─────────────────────────────────────────────────────────────
  // 汇总报告
  // ─────────────────────────────────────────────────────────────
  const summary = {
    totalCases: results.length,
    
    // 向量平均
    vectorAvgPrecision: average(results.map(r => r.vectorPrecision)),
    vectorAvgRecall: average(results.map(r => r.vectorRecall)),
    vectorAvgF1: average(results.map(r => r.vectorF1)),
    vectorAvgMRR: average(results.map(r => 1 / r.vectorRank)),
    
    // 本体平均
    ontologyAvgPrecision: average(results.map(r => r.ontologyPrecision)),
    ontologyAvgRecall: average(results.map(r => r.ontologyRecall)),
    ontologyAvgF1: average(results.map(r => r.ontologyF1)),
    ontologyAvgMRR: average(results.map(r => 1 / r.ontologyRank)),
    
    // 提升
    avgImprovementPrecision: average(results.map(r => r.improvement.precisionDelta)),
    avgImprovementRecall: average(results.map(r => r.improvement.recallDelta)),
    avgImprovementF1: average(results.map(r => r.improvement.f1Delta)),
  };
  
  // ─────────────────────────────────────────────────────────────
  // 输出报告
  // ─────────────────────────────────────────────────────────────
  console.log('\n========================================');
  console.log('  本体查询能力评估报告');
  console.log('========================================\n');
  
  console.log('向量检索（基准）：');
  console.log(`  Precision: ${(summary.vectorAvgPrecision * 100).toFixed(1)}%`);
  console.log(`  Recall:    ${(summary.vectorAvgRecall * 100).toFixed(1)}%`);
  console.log(`  F1:        ${(summary.vectorAvgF1 * 100).toFixed(1)}%`);
  console.log(`  MRR:       ${summary.vectorAvgMRR.toFixed(3)}`);
  
  console.log('\n本体查询：');
  console.log(`  Precision: ${(summary.ontologyAvgPrecision * 100).toFixed(1)}%`);
  console.log(`  Recall:    ${(summary.ontologyAvgRecall * 100).toFixed(1)}%`);
  console.log(`  F1:        ${(summary.ontologyAvgF1 * 100).toFixed(1)}%`);
  console.log(`  MRR:       ${summary.ontologyAvgMRR.toFixed(3)}`);
  
  console.log('\n提升：');
  console.log(`  Precision: +${(summary.avgImprovementPrecision * 100).toFixed(1)}%`);
  console.log(`  Recall:    +${(summary.avgImprovementRecall * 100).toFixed(1)}%`);
  console.log(`  F1:        +${(summary.avgImprovementF1 * 100).toFixed(1)}%`);
  
  // 输出详细结果到文件
  fs.writeFileSync('test/results/evaluation-report.json', JSON.stringify({ summary, results }, null, 2));
  console.log('\n详细结果已保存到: test/results/evaluation-report.json');
}

function average(nums: number[]): number {
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

// 运行评估
runEvaluation().catch(console.error);
```

---

#### Step 3：运行评估

```bash
# 1. 准备测试数据（如果需要本体和向量库）
npm run test:prepare-ontology-data

# 2. 运行评估脚本
npx ts-node test/ontology-query-evaluation.ts

# 3. 查看报告
cat test/results/evaluation-report.json
```

**预期输出**：
```
========================================
  本体查询能力评估报告
========================================

向量检索（基准）：
  Precision: 42.3%
  Recall:    48.7%
  F1:        45.2%
  MRR:       0.615

本体查询：
  Precision: 91.8%
  Recall:    94.2%
  F1:        93.0%
  MRR:       0.952

提升：
  Precision: +49.5%
  Recall:    +45.5%
  F1:        +47.8%

详细结果已保存到: test/results/evaluation-report.json
```

---

## 三、可用性验证（插件化）

### 3.1 Feature Toggle 开关

```typescript
// src/main/config.ts
export const FEATURES = {
  ONTOLOGY_QUERY_ENABLED: process.env.ENABLE_ONTOLOGY_QUERY !== 'false',  // 默认开启
};

// tools/ontology_query_tool.ts
export const ontologyQueryTool = FEATURES.ONTOLOGY_QUERY_ENABLED ? {
  name: 'ontology_query',
  // ... 工具定义
} : null;  // 关闭时不暴露工具
```

### 3.2 降级测试

**测试场景**：
1. 关闭本体查询 → LLM 只能用 `kb_search` → 系统正常运行
2. Semantica 不可用 → 本体查询降级到内置 BFS → 系统正常运行
3. 本体数据缺失 → 本体查询回退到 `kb_search` → 系统正常运行

**测试脚本**：
```typescript
// test/ontology-query-fallback.test.ts

describe('本体查询降级测试', () => {
  
  it('关闭 Feature Toggle 后，LLM 工具列表中无 ontology_query', () => {
    process.env.ENABLE_ONTOLOGY_QUERY = 'false';
    const tools = loadLLMTools();
    expect(tools.find(t => t.name === 'ontology_query')).toBeUndefined();
    expect(tools.find(t => t.name === 'kb_search')).toBeDefined();
  });
  
  it('Semantica 不可用时，降级到内置 BFS', async () => {
    // Mock Semantica 返回错误
    jest.spyOn(semanticaConnector, 'querySemanticaGraph').mockRejectedValue(new Error('Semantica unavailable'));
    
    const result = await ontologyQuery.queryWithOntology('test-user', '复杂多跳查询');
    
    // 应该降级成功，不抛错
    expect(result).toBeDefined();
    expect(result.entities.length).toBeGreaterThan(0);
  });
  
  it('本体数据缺失时，回退到 kb_search', async () => {
    // Mock 本体加载失败
    jest.spyOn(ontologySliceLoader, 'loadOntologySlice').mockResolvedValue(null);
    
    const result = await ontologyQuery.queryWithOntology('test-user', '依赖 api-gateway 的模块');
    
    // 应该回退到向量检索
    expect(result.fallbackMode).toBe('vector');
    expect(result.entities.length).toBeGreaterThan(0);
  });
  
});
```

---

## 四、性能验证

### 4.1 响应时间对比

**测试目标**：本体查询不应比向量检索慢太多（< 2x）。

```typescript
// test/ontology-query-performance.test.ts

describe('本体查询性能测试', () => {
  
  it('简单查询（1-2 跳）响应时间 < 500ms', async () => {
    const start = Date.now();
    await ontologyQuery.queryWithOntology('test-user', '依赖 api-gateway 的模块');
    const elapsed = Date.now() - start;
    
    expect(elapsed).toBeLessThan(500);
  });
  
  it('复杂查询（3+ 跳）响应时间 < 2s', async () => {
    const start = Date.now();
    await ontologyQuery.queryWithOntology('test-user', '认证模块间接依赖的所有第三方库');
    const elapsed = Date.now() - start;
    
    expect(elapsed).toBeLessThan(2000);
  });
  
  it('对比向量检索，慢不超过 2x', async () => {
    const query = '依赖 api-gateway 的模块';
    
    const vectorStart = Date.now();
    await kbVector.search('test-user', query);
    const vectorTime = Date.now() - vectorStart;
    
    const ontologyStart = Date.now();
    await ontologyQuery.queryWithOntology('test-user', query);
    const ontologyTime = Date.now() - ontologyStart;
    
    expect(ontologyTime).toBeLessThan(vectorTime * 2);
  });
  
});
```

### 4.2 压测（可选）

**工具**：`autocannon` / `k6`

```bash
# 安装 autocannon
npm install -g autocannon

# 压测向量检索
autocannon -c 10 -d 30 http://localhost:3000/api/kb/search?q=依赖api-gateway的模块

# 压测本体查询
autocannon -c 10 -d 30 http://localhost:3000/api/ontology/query?q=依赖api-gateway的模块
```

**对比指标**：
- QPS（每秒查询数）
- P50 / P95 / P99 响应时间
- 错误率

---

## 五、演示脚本（给技术负责人看）

### 5.1 准备演示数据

```bash
# 1. 初始化测试本体
npm run demo:init-ontology

# 2. 插入示例数据（模块依赖关系、员工数据）
npm run demo:seed-data
```

### 5.2 演示流程（10 分钟）

#### Demo 1：关系查询（最直观）

**场景**：查询模块依赖关系

```bash
# 向量检索（旧方式）
curl -X POST http://localhost:3000/api/kb/search \
  -d '{"query": "依赖 api-gateway 的模块"}'

# 返回（不准确）：
{
  "results": [
    {"file": "gateway-docs.md", "score": 0.89},        # 错误：只是文档
    {"file": "auth-service.ts", "score": 0.85},        # 正确
    {"file": "api-usage-guide.md", "score": 0.82},     # 错误：使用指南
    {"file": "user-service.ts", "score": 0.78},        # 正确
    {"file": "payment-service.ts", "score": 0.71}      # 正确
  ]
}
```

```bash
# 本体查询（新方式）
curl -X POST http://localhost:3000/api/ontology/query \
  -d '{"query": "依赖 api-gateway 的模块"}'

# 返回（精确）：
{
  "entities": [
    {"id": "auth-service", "type": "Module"},
    {"id": "user-service", "type": "Module"},
    {"id": "payment-service", "type": "Module"}
  ],
  "relations": [
    {"from": "auth-service", "type": "depends_on", "to": "api-gateway"},
    {"from": "user-service", "type": "depends_on", "to": "api-gateway"},
    {"from": "payment-service", "type": "depends_on", "to": "api-gateway"}
  ],
  "evidence": {
    "ontologyPath": "* -[depends_on]-> api-gateway",
    "source": "asset-relations graph"
  },
  "explanation": "根据本体关系图，从 api-gateway 反向查找 depends_on 关系，找到 3 个模块。"
}
```

**对比效果**：
- 准确率：60% → 100%
- 可解释性：相似度得分 → 本体路径

---

#### Demo 2：条件填空（体现本体规则）

**场景**：查询在职员工

```bash
# 向量检索（无法区分在职/离职）
curl -X POST http://localhost:3000/api/kb/search \
  -d '{"query": "在职员工总数"}'

# 返回：所有提到"员工"的文档（包含离职员工数据）
```

```bash
# 本体查询（自动补充条件）
curl -X POST http://localhost:3000/api/ontology/query \
  -d '{"query": "在职员工总数"}'

# 返回：
{
  "entities": [
    {"id": "employee_001", "type": "Employee", "name": "张三", "resignation_status": 0},
    {"id": "employee_002", "type": "Employee", "name": "李四", "resignation_status": 0},
    # ... 共 42 条
  ],
  "aggregation": {
    "count": 42
  },
  "evidence": {
    "appliedRules": ["Employee.activeOnly: resignation_status = 0"],
    "source": "HR database"
  },
  "explanation": "识别实体 Employee，应用业务规则补充条件 resignation_status=0，统计得 42 人。"
}
```

**对比效果**：
- 向量：无法完成（返回混合数据）
- 本体：精确统计（42 人）

---

#### Demo 3：实体对齐（体现引用表）

**场景**：查询 985 毕业员工

```bash
# 向量检索（数据库无 is_985 字段）
curl -X POST http://localhost:3000/api/kb/search \
  -d '{"query": "985 毕业的员工"}'

# 返回：空（数据库查不到）
```

```bash
# 本体查询（通过引用表对齐）
curl -X POST http://localhost:3000/api/ontology/query \
  -d '{"query": "985 毕业的员工"}'

# 返回：
{
  "entities": [
    {"id": "employee_003", "type": "Employee", "name": "王五", "university": "清华大学"},
    {"id": "employee_007", "type": "Employee", "name": "赵六", "university": "北京大学"},
    # ... 共 15 条
  ],
  "aggregation": {
    "count": 15,
    "percentage": "15/42 = 35.7%"
  },
  "evidence": {
    "alignment": "university_name → universities_reference.is_985",
    "source": "HR database + universities_reference"
  },
  "explanation": "HR 数据库无 is_985 字段，通过引用表对齐：JOIN universities_reference ON name WHERE is_985=true。"
}
```

**对比效果**：
- 向量：无法完成（0 条）
- 本体：精确查询（15 条）

---

### 5.3 演示总结（PPT 最后一页）

| 能力 | 向量检索 | 本体查询 | 提升 |
|---|---|---|---|
| 关系查询准确率 | 60% | 100% | +40% |
| 条件填空 | 无法完成 | 100% | N/A |
| 实体对齐 | 无法完成 | 90% | N/A |
| 可解释性 | 仅相似度得分 | 本体路径 + 证据链 | 质的飞跃 |
| 性能 | ~200ms | ~350ms | 可接受 |
| 插件化 | N/A | 可独立开关 | 零风险 |

**结论**：
- ✅ 准确性提升显著（平均 +47.8% F1）
- ✅ 可解释性质的飞跃
- ✅ 插件化设计零风险
- ✅ 性能可接受（< 2x 向量检索）
- ✅ 降级策略完善

**建议**：进入 Phase 1 实现最小原型。

---

## 六、持续回归测试

### 6.1 集成到 CI/CD

```yaml
# .github/workflows/ontology-query-test.yml

name: Ontology Query Evaluation

on:
  push:
    branches: [main, develop]
  pull_request:
    paths:
      - 'src/main/features/ontology/**'
      - 'test/fixtures/ontology-query/**'

jobs:
  evaluate:
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Prepare test data
        run: npm run test:prepare-ontology-data
      
      - name: Run evaluation
        run: npx ts-node test/ontology-query-evaluation.ts
      
      - name: Check thresholds
        run: |
          # 检查 F1 分数是否 > 85%
          node -e "
            const report = require('./test/results/evaluation-report.json');
            if (report.summary.ontologyAvgF1 < 0.85) {
              console.error('F1 score below threshold:', report.summary.ontologyAvgF1);
              process.exit(1);
            }
          "
      
      - name: Upload report
        uses: actions/upload-artifact@v3
        with:
          name: evaluation-report
          path: test/results/evaluation-report.json
```

### 6.2 性能基准监控

```typescript
// 每次评估记录性能基准
const benchmark = {
  timestamp: new Date().toISOString(),
  avgResponseTime: 350,
  p95ResponseTime: 480,
  p99ResponseTime: 620,
};

// 与历史基准对比
if (benchmark.avgResponseTime > historicalBaseline * 1.2) {
  console.warn('Performance regression detected!');
}
```

---

## 七、总结

### 验证方案的三个核心

1. **准确性验证**：Golden Set + Precision/Recall/F1/MRR → 量化证明"本体查询 > 向量检索"
2. **可用性验证**：Feature Toggle + 降级测试 → 证明插件化设计零风险
3. **性能验证**：响应时间对比 + 压测 → 证明性能可接受

### 交付物

- `test/fixtures/ontology-query/golden-set.json`：20 条标注测试用例
- `test/ontology-query-evaluation.ts`：自动评估脚本
- `test/results/evaluation-report.json`：评估报告（给技术负责人看）
- `test/ontology-query-fallback.test.ts`：降级测试
- `test/ontology-query-performance.test.ts`：性能测试

### 使用方式

```bash
# Phase 0：验证假设（实现之前）
npm run eval:ontology-query

# Phase 1-4：回归测试（每次改代码后）
npm test -- ontology-query

# 演示给技术负责人看
npm run demo:ontology-query
```

### 预期效果

- 技术负责人看到：**准确率 +47.8%、可解释性质的飞跃、零风险插件化**
- 团队信心：有量化数据支撑，不是拍脑袋
- 持续优化：Golden Set 可以不断扩充，长期跟踪指标变化
