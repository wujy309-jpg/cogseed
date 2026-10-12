import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const output = path.join(os.homedir(), 'cogseed-private-evaluation', 'synthetic-cases.json');
const asset = (n) => `asset-${String(n).padStart(3, '0')}`;

const specs = [
  ['direct_relation', '哪些资产直接依赖组件甲？', [1], { route: 'ontology', relationKind: 'depends_on', direction: 'incoming', relationScope: 'direct', maxHops: 1 }],
  ['direct_relation', '组件乙依赖哪些基础能力？', [2], { route: 'ontology', relationKind: 'depends_on', direction: 'outgoing', relationScope: 'direct', maxHops: 1 }],
  ['direct_relation', '哪些规范细化了组件丙？', [3], { route: 'ontology', relationKind: 'refines', direction: 'incoming', relationScope: 'direct', maxHops: 1 }],
  ['direct_relation', '组件丁替代了哪些旧组件？', [4], { route: 'ontology', relationKind: 'replaces', direction: 'outgoing', relationScope: 'direct', maxHops: 1 }],
  ['multi_hop', '哪些资产通过两跳关系依赖组件甲？', [5], { route: 'ontology', relationKind: 'depends_on', direction: 'incoming', relationScope: 'indirect', maxHops: 2 }],
  ['multi_hop', '哪些能力通过三跳关系关联组件乙？', [6], { route: 'ontology', relationKind: 'related_to', direction: 'incoming', relationScope: 'indirect', maxHops: 3 }],
  ['multi_hop', '组件丙的间接依赖有哪些？', [7], { route: 'ontology', relationKind: 'depends_on', direction: 'outgoing', relationScope: 'indirect', maxHops: 2 }],
  ['multi_hop', '哪些资产在四跳内可达组件丁？', [], { route: 'ontology', relationKind: 'related_to', direction: 'incoming', relationScope: 'indirect', maxHops: 4 }],
  ['directionality', '谁依赖组件甲？', [8], { route: 'ontology', relationKind: 'depends_on', direction: 'incoming', relationScope: 'direct', maxHops: 1 }],
  ['directionality', '组件甲依赖谁？', [9], { route: 'ontology', relationKind: 'depends_on', direction: 'outgoing', relationScope: 'direct', maxHops: 1 }],
  ['directionality', '组件乙与哪些资产存在双向关联？', [10], { route: 'ontology', relationKind: 'related_to', direction: 'both', relationScope: 'both', maxHops: 2 }],
  ['directionality', '组件丙被谁细化，同时细化了谁？', [11, 12], { route: 'ontology', relationKind: 'refines', direction: 'both', relationScope: 'both', maxHops: 2 }],
  ['ambiguity', '标题为组件甲的资产有哪些？', [], { route: 'clarify' }],
  ['ambiguity', '规范乙对应哪个版本的能力？', [], { route: 'clarify' }],
  ['ambiguity', '查找与组件丙相关的资产', [], { route: 'clarify' }],
  ['ontology_miss', '本体中没有覆盖的组件戊有什么经验？', [13], { route: 'semantic' }],
  ['ontology_miss', '帮我找一条关于组件己的可复用经验', [14], { route: 'semantic' }],
  ['ontology_miss', '组件庚是否存在关系记录？', [], { route: 'ontology' }],
  ['governance_filter', '谁依赖受限组件甲？', [15], { route: 'ontology', relationKind: 'depends_on', direction: 'incoming', relationScope: 'direct', maxHops: 1 }],
  ['governance_filter', '查找已暂停组件乙的依赖者', [], { route: 'ontology', relationKind: 'depends_on', direction: 'incoming', relationScope: 'direct', maxHops: 1 }],
  ['governance_filter', '查找过期版本组件丙的替代资产', [16], { route: 'ontology', relationKind: 'replaces', direction: 'incoming', relationScope: 'direct', maxHops: 1 }],
  ['jev_none', '为当前不相关任务选择最适用的资产', [], { route: 'hybrid' }],
  ['jev_none', '从候选中选择与本次任务真正适用的资产', [], { route: 'hybrid' }],
  ['jev_failure', 'Jev 超时时仍应返回本地关系结果', [17], { route: 'ontology', relationKind: 'depends_on', direction: 'incoming', relationScope: 'direct', maxHops: 1 }],
  ['jev_failure', 'Jev 返回非法响应时保留确定性候选', [18], { route: 'ontology', relationKind: 'related_to', direction: 'both', relationScope: 'direct', maxHops: 1 }],
  ['directness_error', '把两跳依赖说成直接依赖时应被发现', [19], { route: 'ontology', relationKind: 'depends_on', direction: 'incoming', relationScope: 'indirect', maxHops: 2 }],
  ['directness_error', '把关系方向说反时应被发现', [20], { route: 'ontology', relationKind: 'depends_on', direction: 'incoming', relationScope: 'direct', maxHops: 1 }],
  ['ordinary_non_jev', '帮我整理今天的工作清单。', [], { route: 'semantic' }],
  ['ordinary_non_jev', '解释一下什么是缓存。', [], { route: 'semantic' }],
  ['ordinary_non_jev', '列出当前可用的能力资产目录。', [], { route: 'semantic' }],
];

const cases = specs.map(([scenario, query, expectedNumbers, expectedIntent], index) => ({
  caseId: `synthetic-${String(index + 1).padStart(3, '0')}`,
  query,
  scenarios: [scenario],
  expectedAssetIds: expectedNumbers.map(asset),
  ...(scenario === 'governance_filter' ? { blockedAssetIds: [asset(index + 101)] } : {}),
  expectedIntent,
}));

const runs = cases.flatMap((item, index) => {
  const expected = item.expectedAssetIds;
  const base = {
    caseId: item.caseId,
    status: expected.length ? 'selected' : item.expectedIntent?.route === 'clarify' ? 'clarify' : 'none',
    selectedAssetIds: expected,
    ...(item.expectedIntent ? { intent: item.expectedIntent } : {}),
    evidenceComplete: item.scenarios.includes('ordinary_non_jev') ? undefined : true,
    relationDirectionCorrect: item.scenarios.includes('ordinary_non_jev') ? undefined : true,
    directnessCorrect: item.scenarios.includes('ordinary_non_jev') ? undefined : true,
    hardGateViolations: 0,
    fallback: false,
    latencyMs: 20 + index,
    jevLatencyMs: 0,
    jevCalls: 0,
    jevFallbacks: 0,
    estimatedCostUsd: 0,
    jevStages: [],
  };
  return [
    { ...base, route: 'semantic', selectedAssetIds: item.expectedIntent?.route === 'semantic' ? expected : [] },
    { ...base, route: 'ontology', selectedAssetIds: item.expectedIntent?.route === 'ontology' ? expected : [] },
    {
      ...base,
      route: 'ontology_jev',
      status: item.scenarios.includes('jev_failure') ? 'fallback' : base.status,
      fallback: item.scenarios.includes('jev_failure'),
      jevLatencyMs: item.scenarios.includes('ordinary_non_jev') ? 0 : 4,
      jevCalls: item.scenarios.includes('ordinary_non_jev') ? 0 : 1,
      jevFallbacks: item.scenarios.includes('jev_failure') ? 1 : 0,
      estimatedCostUsd: item.scenarios.includes('ordinary_non_jev') ? 0 : 0.001,
      jevStages: item.scenarios.includes('ordinary_non_jev') ? [] : ['candidate_suitability'],
      selectedAssetIds: item.expectedIntent?.route === 'ontology' ? expected : [],
    },
  ];
});

await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, `${JSON.stringify({ schemaVersion: 1, cases, runs }, null, 2)}\n`, 'utf8');
console.log(output);
