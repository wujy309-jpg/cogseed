# Phase 6 人工验收工作单

## 1. 使用目的

本工作单用于准备本体驱动查询与 Jev 三闸门的首轮真实脱敏验收。自动化测试已经验证代码行为；本工作单验证真实问题、真实资产关系和人工预期下，C 路径是否确实优于或不劣于 A/B。

三条对照路径为：

- A：`semantic`，仅使用能力资产语义检索；
- B：`ontology`，使用受治理的本体关系查询与确定性逻辑；
- C：`ontology_jev`，在 B 的基础上启用 Jev 判断闸门。

验收数据不得提交到仓库。建议在仓库外建立工作目录，例如：

```text
~/cogseed-private-evaluation/
  cases.json
  report.json
  review-notes.md
```

## 2. 开始前检查

- [ ] 使用测试账号、测试空间或经过授权的本地副本。
- [ ] 至少准备 30 个真实但已脱敏的问题。
- [ ] 用匿名 `caseId` 和匿名资产 ID，不保留人员、组织或业务标识。
- [ ] 不复制真实资产正文、完整对话、请求头或服务端原始日志。
- [ ] 由熟悉资产关系的人复核预期资产、关系方向和直接/间接含义。
- [ ] Jev API Key 只配置在本机环境中，不写入聊天、文档、JSON 或 Git。

## 3. 30 条最小用例配额

同一个 case 可以带多个 `scenarios`，但下面 30 行都应使用不同的问题。资产名称用脱敏代号表达，例如“组件甲”“规范乙”。

| 编号 | 主场景 | 数量 | 问题设计要求 | 人工必须标注 |
| --- | --- | ---: | --- | --- |
| 01-04 | `direct_relation` | 4 | 分别覆盖常见关系类型中的直接入边和出边 | 目标、关系类型、方向、`direct`、预期资产 |
| 05-08 | `multi_hop` | 4 | 覆盖 2-4 跳，并至少包含一条无可达结果的问题 | 最大跳数、完整证据路径、预期资产 |
| 09-12 | `directionality` | 4 | 同一关系至少设计一组正向/反向问题，并包含 `both` | `incoming`、`outgoing` 或 `both` |
| 13-15 | `ambiguity` | 3 | 同名实体、近似标题或多个候选，不能静默选中 | 应澄清还是可唯一解析 |
| 16-18 | `ontology_miss` | 3 | 本体无覆盖，但语义检索可能有结果；至少一个应返回空 | 路由、预期资产或 `none` |
| 19-21 | `governance_filter` | 3 | 分别放入无权限、暂停/过期、版本不一致候选 | `blockedAssetIds` 及过滤理由 |
| 22-23 | `jev_none` | 2 | 候选存在但不适合当前任务，预期 Jev 拒绝 | 空结果及拒绝依据 |
| 24-25 | `jev_failure` | 2 | 分别模拟超时/不可用和非法响应/限流 | 应降级到 B，且结果与 B 一致 |
| 26-27 | `directness_error` | 2 | 草稿故意把间接关系说成直接关系，或反向表述 | 正确跳数、方向和保守答案 |
| 28-30 | `ordinary_non_jev` | 3 | 普通聊天、普通语义检索、目录查询各一条 | 不应调用 Jev 的原因 |

覆盖检查：

- [ ] 10 个必测场景都至少出现一次。
- [ ] 六种关系类型中，实际业务存在的类型均有覆盖。
- [ ] `incoming`、`outgoing`、`both` 均有覆盖。
- [ ] `direct`、`indirect`、`both` 均有覆盖。
- [ ] 正向命中、正确空结果、澄清、降级和错误注入防护均有覆盖。

## 4. 单条用例标注卡

每个问题先由人工填写 case，再运行系统。不要根据系统输出反向修改预期答案。

```text
caseId：
脱敏问题：
场景标签：
预期路由：ontology / semantic / hybrid / clarify
预期目标实体：
预期关系类型：
预期方向：incoming / outgoing / both
预期范围：direct / indirect / both
预期最大跳数：1-4
预期资产 ID（有序）：
必须被治理过滤的资产 ID：
人工依据：资产定义 / 关系边 / 治理状态 / 无充分证据
复核人：
复核日期：
```

将标注转换为评估 JSON 时，字段格式以 `test/fixtures/ontology-query-evaluation.sample.json` 为准。`expectedAssetIds` 的顺序代表期望排序；正确结果应为空时填写空数组。

## 5. A/B/C 执行记录

每个 case 必须产生三条 run，且记录同一测试环境下的实际结果：

```text
路径：semantic / ontology / ontology_jev
状态：selected / none / clarify / fallback / error
返回资产 ID（有序）：
解析意图：
证据是否完整：
关系方向是否正确：
直接/间接是否正确：
硬治理绕过次数：
是否降级：
总延迟（ms）：
Jev 延迟（ms）：
Jev 调用次数：
Jev 失败次数：
估算成本（USD）：
实际触发闸门：intent / candidate_suitability / result_validation
异常备注：
```

测试 `jev_failure` 时只使用测试端点、短超时或受控错误响应；不要破坏正式服务。C 降级后必须与 B 的资产 ID 和顺序一致。

## 6. 运行评估

完成 30 个 case 和每个 case 的 A/B/C 运行记录后执行：

```bash
cd /Users/yinzhenyu1/Desktop/cogseed/cogseed-semantica-migration
npm run eval:ontology -- \
  ~/cogseed-private-evaluation/cases.json \
  ~/cogseed-private-evaluation/report.json
```

自动评估必须满足：

- [ ] `caseCount >= 30`，且 `completeCaseCount === caseCount`。
- [ ] `coverage.missing` 为空。
- [ ] C 的 F1 不低于 B，且相对 A 的 F1 至少提升 0.05。
- [ ] C 的硬治理绕过为 0，错误注入率不高于 B。
- [ ] 意图、证据、方向、直接/间接、`none`、延迟、成本和降级指标全部过线。
- [ ] `rollout.status` 为 `ready`。

## 7. 人工最终复核

即使自动报告为 `ready`，仍必须抽查全部安全相关 case 和至少 20% 的普通 case：

- [ ] 回答中的每个事实都能指向已准入资产正文或关系证据路径。
- [ ] 没有把语义相似当成本体事实。
- [ ] 没有把间接关系写成直接关系，也没有颠倒方向。
- [ ] `none`、澄清和证据不足没有被模型改写成肯定结论。
- [ ] 无权限、暂停、过期和版本不一致资产未出现在候选、请求或答案中。
- [ ] Jev 失败时基础对话、语义检索和现有本体查询仍可用。
- [ ] 审核人明确签署“允许进入小流量灰度”，而不是只依据自动分数。

最终结论只能填写以下之一：

```text
[ ] 不通过：修复后重新跑完整 30 条
[ ] 通过离线验收：允许只开启 intent 小流量灰度
[ ] 通过阶段灰度：允许按计划增加下一道闸门
```

当前仓库状态仍应视为“工程实现完成，真实数据验收待完成”。没有真实 Jev 调用和人工签署前，不得将默认开关改为开启。
