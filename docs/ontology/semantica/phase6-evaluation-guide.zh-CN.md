# Phase 6 脱敏对照评估与灰度指南

## 1. 用途与当前结论

本指南用于比较三条能力资产查询路径：

- A：`semantic`，即 `search_ability_assets` 语义检索；
- B：`ontology`，即本体关系证据与现有确定性排序；
- C：`ontology_jev`，即本体链路加 Jev 三个判断闸门。

评估器和灰度控制代码已经完成，但仓库内没有真实用户数据、Jev API Key 或真实脱敏评估集。因此当前只能确认“评估与放量机制可用”，不能确认“C 已经优于 A/B”，也不能据此默认开启 Jev。

## 2. 数据边界

输入文件只能包含脱敏问题、匿名 case ID、匿名资产 ID、人工标注预期和 A/B/C 运行指标。禁止放入：

- 用户姓名、组织、联系方式或其他可识别信息；
- 真实资产正文、来源正文或完整对话；
- Jev API Key、请求头或服务端原始日志；
- 未经授权的跨空间资产 ID 映射表。

评估输出不回写正式资产、本体、关系、权限或目录准入状态。

## 3. 输入格式

顶层格式：

```json
{
  "schemaVersion": 1,
  "cases": [],
  "runs": []
}
```

每个 case 至少包含：

```json
{
  "caseId": "case-001",
  "query": "脱敏后的关系问题",
  "scenarios": ["direct_relation", "directionality"],
  "expectedAssetIds": ["aa-expected"],
  "blockedAssetIds": ["aa-blocked"],
  "expectedIntent": {
    "route": "ontology",
    "relationKind": "depends_on",
    "direction": "incoming",
    "relationScope": "direct",
    "maxHops": 1
  }
}
```

每个 case 必须分别产生 `semantic`、`ontology`、`ontology_jev` 三条 run。缺失路线会被报告为不完整，不会按 0 分悄悄参与比较。run 可记录：

- `selectedAssetIds`、结构化意图与 `status`；
- 证据路径是否完整、方向和直接/间接表述是否正确；
- 硬治理绕过、是否降级；
- 总延迟、Jev 延迟、调用次数、失败次数和估算成本；
- 实际参与的 Jev 闸门。

完整 schema 由 `ontologyEvaluationDatasetSchema` 严格校验。重复 case、重复路线、未知 case、重复资产 ID 或 `jevFallbacks > jevCalls` 会被拒绝。

## 4. 必测场景

数据集必须覆盖：

1. `direct_relation`：直接关系；
2. `multi_hop`：有限多跳；
3. `directionality`：正向、反向和双向；
4. `ambiguity`：实体或标题歧义；
5. `ontology_miss`：本体无覆盖并回退语义；
6. `governance_filter`：无权限、暂停、过期或版本不一致；
7. `jev_none`：Jev 返回 `none`；
8. `jev_failure`：超时、限流、非法响应或服务不可用；
9. `directness_error`：直接/间接表述错误；
10. `ordinary_non_jev`：普通对话和普通检索不依赖 Jev。

首轮验收至少使用 30 条不同问题。具体场景配额、单条标注卡、A/B/C 记录项和人工签署标准见 `phase6-human-acceptance-template.zh-CN.md`。

## 5. 执行与结果

已有 A/B/C 运行记录时执行：

```bash
npm run eval:ontology -- /absolute/path/desensitized-dataset.json /absolute/path/report.json
```

代码内执行真实三路采集时，使用 `collectOntologyEvaluationDataset(cases, executor)`。采集器逐 case 强制执行 A/B/C；执行器异常会生成显式 `error` run。之后调用：

```ts
const report = evaluateOntologyQueryDataset(dataset);
const rollout = assessOntologyJevRollout(report);
```

报告包含 precision、recall、F1、MRR、精确命中率、`none` 准确率、意图准确率、证据完整率、方向/跳数准确率、错误注入率、治理绕过、降级率、Jev 成功率、P50/P95、调用次数和成本。

默认放量判据包括：至少 30 个脱敏 case、场景覆盖完整、C 的 F1 不低于 B 且相对 A 至少提升 0.05、治理绕过为 0、C 错误注入率不高于 B、`none` 准确率至少 0.8、意图准确率至少 0.9、证据/方向/跳数准确率至少 0.95、Jev 成功率至少 0.9 且存在真实调用样本、降级与 B 完全一致、降级率不超过 0.2、错误率不超过 0.05、P95 不超过 3 秒、平均单任务估算成本不超过 0.01 美元。

任一条件失败都返回 `not_ready` 和具体原因。评估器不会自动修改线上开关。

## 6. 灰度配置

Jev 仍由全局开关控制，默认关闭：

```text
COGSEED_JEV_ENABLED=true
COGSEED_JEV_ENDPOINT=https://...
COGSEED_JEV_API_KEY=...
```

可选闸门白名单使用协议 ID，逗号分隔：

```text
COGSEED_JEV_GATES=intent,candidate_suitability,result_validation
```

稳定百分比放量范围为 `0-100`：

```text
COGSEED_JEV_ROLLOUT_PERCENT=5
```

部分放量必须提供稳定用户键；缺少稳定键时保守关闭。相同用户始终进入同一分桶。全局关闭、闸门未允许、分桶未命中或配置不完整时都使用现有本地降级，不发送 Jev HTTP 请求。

建议顺序：先离线评估，再只开 `intent`，之后增加 `candidate_suitability`，最后增加 `result_validation`。每次扩大范围前重新检查报告，且保留立即把 `COGSEED_JEV_ENABLED` 设为 `false` 的总熔断路径。

## 7. 人工参与边界

代码和自动化测试不能替代以下人工输入：

- 真实但脱敏的问题与预期资产 ID；
- 关系方向、直接/间接含义和治理过滤结果的业务复核；
- 测试 Jev 端点与本机环境变量配置；
- 自动报告为 `ready` 后的最终抽查和灰度签署。

这些材料应保存在仓库外。不要在聊天或仓库中提供 API Key、真实资产正文、个人信息或未授权数据。
