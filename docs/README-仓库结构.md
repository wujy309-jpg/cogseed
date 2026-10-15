# CogSeed 双仓库结构说明

- 更新：2026-09-28（**两仓已完全独立**）
- 目的：开源版与企业版各自独立仓库、独立远端、**独立依赖**，互不影响，可同时运行

---

## 1. 目录结构

```
/Users/sudai/Documents/
├── CogSeed-OpenSource/     ← 开源版（GitHub）
├── CogSeed-Enterprise/     ← 企业版（GitLab）
└── CogSeed-split-archive/  ← 归档（合并成果 patch + 结构说明）
```

| | CogSeed-OpenSource | CogSeed-Enterprise |
|---|---|---|
| 远端 | `origin` → `ssh://git@ssh.github.com:443/bonc-ai/cogseed.git` | `gitlab` → `http://10.1.12.6:54170/lhcx/project-group/opensource/team-02/cogseed-enterprise-edition.git` |
| 当前分支 | `work/20260924-fixes` | `develop-ent` @ `2990b932` |
| 依赖 | **自带** node_modules（1.6G，501 包） | **自带** node_modules（1.6G，501 包） |
| 资源 | **自带** runtime / embedding-model / sherpa-onnx / officecli | **自带**（527M+91M+78M+32M） |
| 磁盘 | ~4.6G | ~2.6G |
| 软链依赖 | 无 | **无**（2026-09-28 已解除） |

> 两仓现在**没有任何符号链接互相依赖**，任何一个都可独立删除/移动而不影响另一个。

---

## 2. 开源版：新公仓快照

公仓已重建为**单提交清洁快照**，与本地旧历史**无共同祖先**：

| 项 | 值 |
|---|---|
| 快照 | `b0718215` `chore: sync public source df7db378490b89d6` |
| 规模 | 1 提交 / 3932 文件 |
| 身份 | `com.cogseed.desktop` / `CogSeed` / v1.2.0（正规开源身份，`src/` 中零企业痕迹） |
| 基线分支 | **`base/public-main`** → 跟踪 `origin/main` |

**旧历史完整保留**（按"保留旧历史 + 新快照建基线分支"的决定）：

- 本地分支 8 个（含 `base/public-main`）
- stash **9 条**（KSTAR / Creator / A2A / ontology 未落地工作）
- 未跟踪文件 45 个（含本次同步的分析报告）

> 注意：`origin/main` 与该快照之外的任何本地分支都**不能 merge/rebase**（无共同祖先）。
> 旧分支仅作历史查阅；要基于新快照开发，从 `base/public-main` 起新分支。

---

## 3. 企业版：同步成果

| 项 | 值 |
|---|---|
| 上游同步冲突 | 51 → **0** |
| `npm run typecheck` | **0 错误** |
| 测试 | 失败文件 125（基线）→ **68**；基线失败已修复 **79** 个 |
| 企业身份 | appId / dataRoot / protocol / envPrefix / brand / channel **6/6 保持** |
| 内部域名残留 | `src/` 中 **0** 处 |
| UI | **企业 Raymond 视觉**；上游功能元素已补回 13 个 |
| GitLab 同步状态 | 与 `gitlab/develop-ent` **0 领先 0 落后** |
| 工作区状态 | **664 项已暂存**（未提交，按决定保留） |

### 待办

1. **真机验证**：认知资产四页签、首页外部 Agent 入口、连接器搜索/详情、设置页、KB、多智能体
2. **22 个实现细节断言**更新到上游实际标记（约 1 人日，纯测试侧）
3. `auth-flow.test.ts` 7 个 `AUTH_SESSION_EXPIRED` 对齐会话桩
4. 复核后提交并开 **GitLab MR**（勿直推 `develop-ent`）

---

## 4. 日常操作

```bash
# 开源版
cd ~/Documents/CogSeed-OpenSource
git fetch origin --prune
npm run typecheck && npm test

# 企业版
cd ~/Documents/CogSeed-Enterprise
git fetch gitlab --prune
npm run typecheck && npm test
```

**跑测试前先停 app 实例**，否则 vitest worker（Electron 进程）会与前台实例在单实例锁上互等挂起：

```bash
cd ~/Documents/CogSeed-Enterprise && bash scripts/restart-cogseed.sh stop
```

---

## 5. 环境要点与坑

| 项 | 说明 |
|---|---|
| GitHub 22 端口 | **被封**，必须用 SSH-over-443：`ssh://git@ssh.github.com:443/...` |
| GitLab | 内网 `10.1.12.6:54170`，**时通时断**；不可达时 `git fetch gitlab` 会超时 |
| embedding 模型 | 必须处于**解压**状态（`resources/embedding-model/fast-bge-small-zh-v1.5/`），否则 `embed worker fatal` 导致相关测试失败 |
| 运行时资源 | `resources/runtime/{python,uv,node,ffmpeg,whisper}` 缺失时启动会尝试下载；网络不通会失败 |
| 会话工作目录 | `/Users/sudai/Documents/CogSeed` 是指向 **CogSeed-OpenSource** 的兼容软链 |

---

## 6. 归档与回滚

```
CogSeed-split-archive/
├── README-仓库结构.md                              ← 本文件
├── patches/ent-sync-20260927.patch                 ← 企业版同步成果完整 patch（23M）
└── untracked/                                      ← patch 未覆盖的脚本与 UI 备份
    ├── resolve-locale-conflicts.py
    ├── restore-referenced-locale-keys.py
    └── ent-ui-backup/                              ← 企业原 UI（7 文件）
```

企业版成果可从 patch 完整重建：

```bash
cd ~/Documents/CogSeed-Enterprise
git checkout -B restore/ent-sync gitlab/develop-ent
git apply --index --binary ~/Documents/CogSeed-split-archive/patches/ent-sync-20260927.patch
git write-tree   # 应为 08f0eb2c66e60c768e2a91cd32f465a87087ecbc
```
