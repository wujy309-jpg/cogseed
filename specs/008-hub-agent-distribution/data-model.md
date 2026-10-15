# 数据模型（客户端草案，2026-10-11 按产品与 Hub 答复更新）

> 草案，据 2026-10-10 评审会与同日代码核实更新（基线 `origin/develop` `5491969e`，详见 `spec.md`「代码核实」）。**Agent schema（协议：含哪些文件）是下一步第一件要定的事（D-08），早于 API。**标 **[现有]** 的来自当前代码，**[新增]** 为本迭代提议，**[待定]** 取决于 spec「待决策」。

## 1. Agent 定义 **[现有]**（`src/main/features/agents.ts` 的 `Agent`）

### 1.1 按「能否随贡献分发」分类

| 类别 | 字段 | 说明 |
|---|---|---|
| **创作字段（可进协议，待 D-08 定稿）** | `name, description_zh, description_en, workflow, icon, color, skill_list, inputs, interactive, knowhow, standards, category, output_format, runtime(in_process)`（`agent_id` 为本机 ID，Hub 另分配内容 ID；**`version / created_at / updated_at` 不是作者字段**：现有 `agent.json` 都带着它们，提交时客户端先剥掉，版本与发布时间由 Hub 写入包内 `_meta.json`；`crown` 图标不可分发） | 持久化在 `agent.json`。`skill_list` 是 Agent 声明的依赖，运行时当**白名单上限**（`undefined` 无上限；`[]` 明确为零）；条目为 ID 或名字，保存时按 ID/名字解析，**无法解析的会被丢弃** |
| **运行时形态（需判断能否分发）** | `runtime`、`interface_contract` | `runtime.kind` 为 `in_process`（默认，走 core-agent）、`cli`、`p3394-gateway`。后两者是**本地外接 CLI Agent**，依赖本机环境，**不应作为可分发 Agent**（待 D-08 确认） |
| **本机/用户相关（贡献时必须处理，不分发）** | `enabled_connectors`（连接器实例 ID）、`default_model`、`default_thinking`、`create_uid` | 与用户的连接器实例、模型偏好有关。**这也是「处理在客户端做」要覆盖的内容**，不止凭据与路径 |
| **宿主专有（不可分发）** | `management_surface`、`reimbursement_entry_role`、`interaction_mode` | 内置报销 Agent 等使用；不属于可分发协议 |
| **运行时派生（不写回 `agent.json`）** | `enabled`、`version`、`marketplace_published_at/updated_at`、`default_install`、`is_open_source`、`status`、`seed_source`、`runtime_stats` | 来自 `_install.json` 或使用统计；`seed_source=builtin` 表示随包预置 |
| **来源** | `source`：`custom` / `marketplace` | `custom` 在 `<uid>/cloud/agents/<id>/`，`marketplace` 在 `<uid>/local/marketplace/agents/<id>/` |

- **冲突仲裁**：`builtin`（随包预置）> `platform`（市场安装）> `custom`（`agentPrioritySource`）。市场项去重按 `(name, create_uid)`。
- **目录布局**：市场 Agent 目录含 `agent.json`、可选 `README.md`、可选 `skills/`（私有 Skill，见 §3）。示例：`resources/builtin/marketplace/agents/e064dca9e1bd/`。
- **`inputs`**：三态——缺省（无需事前确认）、`[]`（明确为零）、非空数组（指挥官须先发出 `agent-input-form`）。写入时每次重新校验。

**[待定 D-01]** 是否新增：`applicable_scenarios`、`deliverable_standard` 等字段（现有 `inputs`、`workflow`、`description_*` 已覆盖一部分「输入」「流程」「说明」）。
**[待定 D-08]** 协议包含哪些文件；排除协议外内容用排除法还是白名单（会上说由实施方案定）。

## 2. 引用 Skill Reference **[新增]**

Agent 引用 Skill，客户端按**三种情形**区分（**不是**会上口头说的「客户端内置 / Hub 分发 / 用户贡献」，见 `spec.md`「代码核实」）：

```text
SkillReference
  kind:        "hub" | "preset" | "bundled"
  skill_id:    string       # hub / preset：Hub 内容 ID，12 位十六进制；bundled：本机自建 Skill 的名字
  version_req: string?
```

| kind | 含义 | 本机状态 | 备注 |
|---|---|---|---|
| `hub` | Hub 分发的 Skill，需要从 Hub 下载 | 缺失则进入安装清单；停用/不兼容则阻断 | 由 Hub 的 `status` 判停用（`SkillMetadata.status`） |
| `preset` | Hub 分发中**随客户端预置**的内容（运行时标为 `builtin`，`seed_source=builtin`） | 本机已具备，直接复用，联网后市场对账接管 | ID 同样是 12 位十六进制；清单见 `resources/builtin/_manifest.json` 的 `inventory`。**预置内容可能先于 Hub 发布，「Hub 已知全部预置 ID」未核实** |
| `bundled` | 随本 Agent 一起提交的**本机自建 Skill** | 随 Agent 安装，装在该 Agent 名下，不进用户 Skill 列表，不覆盖同名 Skill | **产品已定本期随包提交**（D-07）：实质为 Agent 私有包加安全检查与隔离，不是独立公开；安全检查口径待 D-14。`skill_list` 中名字形式的条目即此类，目录名不得是 12 位十六进制 |

**系统内置 Skill**（`resources/builtin/system/skills/`，8 个，名字形式 ID）**不在此表**：能否被 `skill_list` 引用**未核实**（D-10），不作为依赖来源。

## 3. Agent 私有 Skill 包 **[现有机制，不等同于独立公开贡献]**

```text
agent_skills_bundle_url   # AgentDetail 字段，zip；为空表示没有私有 Skill
ownerAgent                # 私有 Skill 的 frontmatter；别的 Agent 解析为未知
```

安装顺序（`marketplace.ts` 文件头）：先下载私有包 → 再并行安装 `skill_list` 里缺失的独立 Skill（`getSkillMetadata` + 审核状态校验）→ 全部成功才写入 Agent；**任一失败整个 Agent 不记录**，重试成本低。

## 4. 提交副本与处理报告 **[新增，沿用 Skill 贡献的包结构]**

现有 Skill 提交（`contribution/hub-client.ts`、`package.ts`）：multipart，`manifest.json` + 包 zip（≤ 8 MiB，逐文件 `sha256`，整包 `package_digest`）。Agent 提交需要 Hub 扩展内容类型（现为 `content_type: 'skill'`）。

```text
ContributionDraft (Agent)
  local_agent_id, target_content_id?, version
  files:        File[]            # 处理后的最终文件集合
  references:   SkillReference[]
  bundled:      string[]          # 随 Agent 提交的自建 Skill（提交方式待 D-07）
  handled:      HandledItem[]     # 本机已处理的项，仅本机预览，不上传
  blocked:      BlockedItem[]     # 最明显的敏感格式，非空则不得提交
  package_digest, file_list[{path,size,sha256}]

HandledItem { kind: "connector"|"credential"|"local_path"|"model_pref", location }
BlockedItem { kind: "private_key"|"pem"|…, location(file:line), reason }
```

不变量：`files` 与预览逐项一致；`handled` **不上传**，Hub 不需要知道；本地原 Agent 不变；只检查最明显的格式，不承诺识别所有隐私，规则不做成长期维护的规则库。

## 5. 提交与状态 **[现有 Skill 口径，Agent 沿用]**

```text
Submission
  submission_id (Hub 分配), content_id? , version (固定)
  type: "agent" | "skill"                 # [新增] 「我的贡献」同页按 type 切换
  status: pending_review | returned | approved_unpublished | published | withdrawn
  return_reason?, submitted_at
  Idempotency-Key                         # 请求头，重试共用
```

审核绑定 `submission_id + version`；`returned` 后重提产生新的 `submission_id`；**approved_unpublished ≠ published**。

## 6. 已安装 Agent 状态 **[新增]**

```text
InstalledAgent
  agent_id, version, source: "official" | "community" | "mine"
  state: ready | deps_pending | deps_blocked | disabled | update_available | update_failed
  pinned_version_in_flight?
  deps: [{ref, state: present|missing|disabled|incompatible}]
```

`state=ready` 当且仅当所有依赖 `present`。状态展示在智能体页的卡片与详情，**不新增「已安装管理」页**。最低客户端版本用市场项现有的 `min_app_version`（缺席=无下限），客户端已有「需 CogSeed x.y+」提示。

## 7. 发布物摘要 **[Skill 已有，Agent 需新增，D-09；Hub 目前无 Agent 能力，D-11]**

Skill：Hub A-01 的 `artifact{ sha256, size_bytes, format }`（客户端 `SkillMetadata.artifact`），`format` 固定 `skill-tree-v1`，**不可变发布物标识，完整性校验的唯一依据**，下载后按它校验。Agent：`MarketplaceAgent` / `AgentDetail` **目前没有**该字段；`agent.json` 以 `agent_json`/`agent_json_url` 取得，私有包以 `agent_skills_bundle_url` 取得，均无摘要。AG-FR-020 需 Hub 为 Agent 与其私有包补同形态字段。
