# DrSai GitLab 分支与合并请求 (MR) 管理规范

> 适用项目：`code.ihep.ac.cn:hepai/drsai`
> 最后更新：2025-07

---

## 1 分支架构总览

### 1.1 分支层级

```
┌─────────────────────────────────────────────────────────────┐
│                     main (发行主分支)                         │
│              所有发布必须经过此分支合并                          │
├─────────────────────────────────────────────────────────────┤
│       merge_latest (开发集成分支)                              │
│    日常开发的主要目标分支，功能验证与集成测试                      │
├──────────────────────────────┬──────────────────────────────┤
│   docmaster (文档专项分支)    │   dev / dev_v3 (实验分支)      │
│   文档与桌面端特有功能         │   大版本重构、架构实验           │
├──────────────────────────────┴──────────────────────────────┤
│   feature/* · fix/* · 个人开发分支                            │
│   团队成员从 merge_latest 拉出，开发完成后提交 MR 回流          │
└─────────────────────────────────────────────────────────────┘
```

### 1.2 分支定义与职责

| 分支 | 类型 | 职责 | 保护级别 | 说明 |
|------|------|------|----------|------|
| `main` | 长期分支 | **发行主分支**，只接受经过验证的 MR | 🔴 严格保护 | 所有版本发布、tag 打在此分支；禁止直接 push |
| `merge_latest` | 长期分支 | **开发集成分支**，日常功能集成与测试 | 🟡 中度保护 | 团队成员的主要 MR 目标；允许 Maintainer 直接合并已审核 MR |
| `docmaster` | 长期分支 | **文档专项分支**，文档工具与桌面端特有功能 | 🟡 中度保护 | 文档相关功能先合入此分支验证，再合入 merge_latest |
| `dev` / `dev_v3` | 长期分支 | **实验分支**，大版本重构或架构实验 | ⚪ 无保护 | 实验性代码，不保证稳定性；实验成功后合入 merge_latest |
| `feature/<name>` | 临时分支 | 功能开发分支 | ⚪ 无保护 | 从 merge_latest 拉出，完成后通过 MR 合回 |
| `fix/<name>` | 临时分支 | 修复分支 | ⚪ 无保护 | 从 merge_latest 拉出，完成后通过 MR 合回 |
| `<username>/dev` | 个人分支 | 个人日常开发分支 | ⚪ 无保护 | 每位成员可维护自己的长期开发分支 |

### 1.3 分支流转规则

```
feature/fix 分支 ──MR──→ merge_latest ──MR──→ main → 发布 (tag)
                          │
                          ├── docmaster ──MR──→ merge_latest (文档功能回流)
                          ├── dev ──MR──→ merge_latest (实验功能回流)
                          └── <user>/dev ──MR──→ merge_latest (个人开发回流)
```

**核心规则**：
1. **所有分支必须通过 `main` 分支合并后发布** — 没有例外
2. **日常开发 MR 目标是 `merge_latest`** — 不是直接到 `main`
3. **`merge_latest` → `main` 的 MR 由 Maintainer 在发布窗口统一执行**
4. **禁止跨层级直接合并** — 如 `feature/*` 不能直接 MR 到 `main`

---

## 2 合并请求 (MR) 工作流

### 2.1 MR 类型与目标分支

| MR 类型 | 源分支 | 目标分支 | 审核要求 | 示例 |
|---------|--------|----------|----------|------|
| **功能开发** | `feature/<name>` | `merge_latest` | 1 位 Reviewer | `feature/tui-image-input → merge_latest` |
| **问题修复** | `fix/<name>` | `merge_latest` | 1 位 Reviewer | `fix/streaming-interrupt → merge_latest` |
| **文档功能** | `feature/doc-*` 或 `docmaster` | `docmaster` | 1 位 Reviewer | `feature/doc-pptx-gen → docmaster` |
| **文档回流** | `docmaster` | `merge_latest` | Maintainer 确认 | `docmaster → merge_latest` |
| **实验回流** | `dev` / `dev_v3` | `merge_latest` | 2 位 Reviewer + Maintainer | `dev_v3 → merge_latest` |
| **发布合并** | `merge_latest` | `main` | Maintainer 确认 + CI 通过 | `merge_latest → main` |

### 2.2 创建 MR 的步骤

#### Step 1：从 merge_latest 拉出开发分支

```bash
# 确保本地 merge_latest 是最新的
git checkout merge_latest
git pull gitlab merge_latest

# 创建功能分支（命名规范见 §3）
git checkout -b feature/tui-image-input

# 或创建修复分支
git checkout -b fix/streaming-interrupt
```

#### Step 2：开发并提交

```bash
# 正常开发、提交
git add <files>
git commit -m "feat(tui): add image multimodal input support"

# 推送到 GitLab
git push gitlab feature/tui-image-input
```

#### Step 3：在 GitLab 上创建 Merge Request

1. 打开 `https://code.ihep.ac.cn/hepai/drsai/-/merge_requests/new`
2. **Source branch**: 选择你的开发分支（如 `feature/tui-image-input`）
3. **Target branch**: 选择 `merge_latest`（日常开发）或 `docmaster`（文档功能）
4. 填写 MR 标题和描述（模板见 §4）
5. 指定 Reviewer
6. 提交 MR

#### Step 4：审核与合并

- Reviewer 审核代码，提出修改意见或批准
- 作者根据意见修改（直接 push 到源分支即可，MR 自动更新）
- Reviewer 批准后，Maintainer 点击 **Merge** 按钮
- 合并完成后，删除源分支（GitLab MR 页面勾选 "Delete source branch"）

### 2.3 MR 生命周期

```
创建 MR → 代码审核 → 修改完善 → Reviewer 批准 → Maintainer 合并 → 删除源分支
   │          │          │           │             │
   │          │          │           │             └─ 回流到 merge_latest
   │          │          │           └─ 点击 Approve
   │          │          └─ push 追加 commit 到源分支
   │          └─ Reviewer 提交评论 / 建议
   └─ 选择正确的目标分支（merge_latest / docmaster）
```

---

## 3 分支命名规范

### 3.1 前缀分类

| 前缀 | 用途 | 示例 |
|------|------|------|
| `feature/` 或 `feat/` | 新功能开发 | `feat/tui-image-input` |
| `fix/` | 问题修复 | `fix/streaming-interrupt` |
| `docs/` | 文档更新 | `docs/cli-manual-update` |
| `refactor/` | 代码重构 | `refactor/session-state` |
| `test/` | 测试相关 | `test/e2e-tui-smoke` |
| `chore/` | 构建/工具/杂项 | `chore/update-deps` |
| `<username>/` | 个人长期开发分支 | `christina/dev`、`xdb/dev` |

### 3.2 命名规则

- 使用 **小写字母 + 连字符**，不含空格和特殊字符
- 名称应 **简明扼要**，能一眼看出功能点
- 个人分支以 GitLab 用户名前缀：`<username>/dev` 或 `<username>/<feature-name>`
- 避免使用 `my-branch`、`test`、`wip` 等模糊名称

### 3.3 好与不好的命名对比

| ✅ 好的命名 | ❌ 不好的命名 | 原因 |
|------------|-------------|------|
| `feat/tui-image-input` | `my-new-feature` | 缺少前缀分类，名称模糊 |
| `fix/streaming-interrupt` | `bugfix` | 过于笼统 |
| `christina/dev` | `christina` | 缺少 `/` 分隔 |
| `docs/cli-manual-update` | `update-docs` | 缺少前缀 |

---

## 4 MR 描述模板

创建 MR 时，请使用以下模板填写描述：

```markdown
## 变更类型
<!-- 选择一项 -->
- [ ] ✨ 新功能 (feature)
- [ ] 🐛 问题修复 (fix)
- [ ] 📝 文档更新 (docs)
- [ ] ♻️ 代码重构 (refactor)
- [ ] 🧪 测试 (test)
- [ ] 🔧 构建/工具 (chore)

## 变更描述
<!-- 简要描述此 MR 做了什么 -->
...

## 关联 Issue
<!-- 如有关联 Issue，填写编号 -->
Closes #<issue-number>

## 测试方式
<!-- 如何验证此变更 -->
1. ...
2. ...

## 影响范围
<!-- 此变更影响哪些模块/功能 -->
- ...

## 自检清单
- [ ] 代码已通过本地基本测试
- [ ] 无明显的副作用或回归风险
- [ ] 提交信息符合规范（见 §5）
- [ ] 已同步 merge_latest 的最新代码（无冲突）

## 目标分支确认
<!-- 确认目标分支是否正确 -->
- [ ] 目标分支为 `merge_latest`（日常开发）
- [ ] 目标分支为 `docmaster`（文档专项功能）
- [ ] 目标分支为其他（说明原因）
```

---

## 5 Commit 信息规范

### 5.1 格式

```
<type>(<scope>): <subject>

<body>

<footer>
```

### 5.2 type（必填）

| type | 说明 |
|------|------|
| `feat` | 新功能 |
| `fix` | 修复 bug |
| `docs` | 文档变更 |
| `style` | 格式调整（不影响逻辑） |
| `refactor` | 重构（非新功能、非修复） |
| `test` | 测试相关 |
| `chore` | 构建/工具/依赖 |
| `perf` | 性能优化 |

### 5.3 scope（推荐填）

主要模块/目录缩写：

| scope | 对应模块 |
|-------|---------|
| `tui` | `ui-tui/` |
| `gateway` | `backend/tui_gateway/` |
| `cli` | `backend/cli/` |
| `agent` | 智能体核心 |
| `desktop` | `desktop/` 桌面端 |
| `docs` | `docs/` 文档 |
| `core` | 核心框架 |

### 5.4 示例

```
feat(tui): add image multimodal input support

- /image command for sending images
- @/path inline image references
- base64 encoding in TUI, JSON-RPC to gateway

Closes #42
```

```
fix(gateway): ignore SIGINT in gateway subprocess

Gateway now uses signal.SIG_IGN for SIGINT so Ctrl+C
only cancels via prompt.cancel RPC, not kills the process.
```

---

## 6 发布流程

### 6.1 发布窗口

Maintainer 在以下时机执行 `merge_latest → main` 的 MR：

- **版本发布**：完成一批功能后统一发布
- **紧急修复**：关键 bug 修复后立即发布
- **定期同步**：建议每 1-2 周至少同步一次

### 6.2 发布步骤

```bash
# 1. Maintainer 确保 merge_latest 已通过集成测试
git checkout merge_latest
git pull gitlab merge_latest

# 2. 在 GitLab 上创建 merge_latest → main 的 MR
#    标题格式: "release: v<version> — merge_latest → main"

# 3. 确认无冲突，CI 通过（如有 CI）
# 4. 合并 MR

# 5. 在 main 上打版本 tag
git checkout main
git pull gitlab main
git tag -a v1.3.4 -m "release v1.3.4: image multimodal input, streaming interrupt fix"
git push gitlab v1.3.4
```

### 6.3 合并后同步

`merge_latest → main` 合并完成后，需要将 `main` 的最新状态同步回 `merge_latest`：

```bash
# 防止 merge_latest 和 main 逐步分叉
git checkout merge_latest
git pull gitlab merge_latest
git merge gitlab/main          # 或在 GitLab 上创建 main → merge_latest 的 MR
git push gitlab merge_latest
```

> ⚠️ **重要**：每次 `merge_latest → main` 发布后，必须执行反向同步，否则两个分支会逐渐分叉，后续合并冲突会越来越多。

---

## 7 冲突处理

### 7.1 预防冲突

```bash
# 开发期间定期从 merge_latest 同步（建议每天）
git checkout feature/tui-image-input
git fetch gitlab
git merge gitlab/merge_latest     # 或 git rebase gitlab/merge_latest

# 如有冲突，手动解决后继续
git add <resolved-files>
git commit                        # merge 方式
# 或 git rebase --continue        # rebase 方式
git push gitlab feature/tui-image-input
```

### 7.2 MR 页面显示冲突

如果 GitLab MR 页面显示 "Merge conflicts exist"：

1. 在本地拉取目标分支最新代码
2. 将目标分支合并（或 rebase）到源分支
3. 解决冲突后 push
4. MR 页面冲突标记自动消失

### 7.3 Rebase vs Merge

| 方式 | 优点 | 缺点 | 适用场景 |
|------|------|------|----------|
| `git merge merge_latest` | 保留完整历史，安全 | 产生合并 commit，历史略乱 | 日常同步（推荐） |
| `git rebase merge_latest` | 历史线性干净 | 改写已 push 的 commit（需 force push） | MR 合并前的最终整理 |

> 建议：日常同步用 `merge`，MR 最终审核通过后可用 `rebase` 线性化（GitLab MR 合并时可选 "Rebase before merge"）。

---

## 8 角色与权限

| 角色 | 人员 | 权限 |
|------|------|------|
| **Maintainer** | 项目负责人 | 合并 MR 到 `main` 和 `merge_latest`；执行发布；保护分支设置 |
| **Reviewer** | 团队成员 | 审核 MR；提交评论与建议；Approve MR |
| **Developer** | 所有开发成员 | 创建分支、push 代码、提交 MR |

### 分支保护建议设置

| 分支 | Allowed to merge | Allowed to push | MR required |
|------|-----------------|----------------|-------------|
| `main` | Maintainer | No one | ✅ 是 |
| `merge_latest` | Maintainer + Developer | Maintainer | ✅ 是（推荐） |
| `docmaster` | Maintainer + Developer | Maintainer | ✅ 是（推荐） |

---

## 9 快速参考卡片

### 常用命令

```bash
# ─── 初始设置 ───
git clone git@code.ihep.ac.cn:hepai/drsai.git
git remote add github git@github.com:hepai-lab/drsai.git  # 可选

# ─── 日常开发 ───
git checkout merge_latest && git pull gitlab merge_latest   # 同步最新
git checkout -b feature/<name>                              # 创建功能分支
# ... 开发、提交 ...
git push gitlab feature/<name>                              # 推送
# → 在 GitLab 创建 MR: feature/<name> → merge_latest

# ─── 同步上游变更 ───
git checkout feature/<name>
git fetch gitlab
git merge gitlab/merge_latest                               # 合入最新，解决冲突
git push gitlab feature/<name>

# ─── MR 合并后清理 ───
git checkout merge_latest && git pull gitlab merge_latest
git branch -d feature/<name>                                # 删除本地分支

# ─── 发布 ─── (仅 Maintainer)
# → GitLab 创建 MR: merge_latest → main
# → 合并后在 main 上打 tag
```

### MR 目标分支决策树

```
我要提交什么变更？
  │
  ├─ 文档/桌面端特有功能 ──→ 目标: docmaster
  │                          └─ docmaster → merge_latest（后续由 Maintainer 合入）
  │
  ├─ 实验/大版本重构 ──→ 目标: dev 或 dev_v3
  │                       └─ 实验稳定后 → merge_latest
  │
  ├─ 新功能 / bug修复 / 重构 ──→ 目标: merge_latest ✅ ← 最常见
  │
  └─ 紧急 hotfix ──→ 目标: merge_latest
                      └─ Maintainer 加速审核后快速合入 main 发布
```

---

## 10 当前分支状态分析

> ⚠️ **当前存在严重分叉**：`merge_latest` 与 `main` 已有 **53 + 69 = 122 commits 的分叉**，合并时将产生 18 个文件冲突。
>
> 详细的分歧处理方案请参见 **[`docs/gitlab-branch-merge-resolution.md`](gitlab-branch-merge-resolution.md)**，包含具体的合并操作步骤和后续规范。

基于当前 GitLab 仓库的分支情况：

| 分支 | 与 main 的差异 | 建议 |
|------|---------------|------|
| `merge_latest` | main 53 commits ahead, merge_latest 69 commits ahead | 🔴 **需按 [分歧处理方案](gitlab-branch-merge-resolution.md) 执行合并** |
| `docmaster` | 33 commits ahead of main | 🟡 功能稳定后应合入 merge_latest |
| `dev` | 较旧，停留在 v1.2.40 | ⚪ 实验性，视情况决定是否继续 |
| `christina/dev` | 包含本地注册等新功能 | 🟡 应从 merge_latest 拉出最新后提交 MR |
| `dev_v3` | 较旧 | ⚪ 评估是否继续或删除 |

---

## 附录: GitLab MR 页面操作指南

### 创建 MR

1. 控制栏 → **Merge Requests** → **New merge request**
2. 选择 Source branch（你的开发分支）和 Target branch（`merge_latest`）
3. 填写标题、描述（使用 §4 模板）
4. **Reviewer**：指定至少一位团队成员
5. **Assignee**：通常为自己
6. 提交

### 审核 MR

1. 打开 MR 页面 → **Changes** tab 查看代码变更
2. 对特定行点击 💬 提出评论
3. 审核完成点击 **Approve** 按钮
4. 如需修改，作者 push 新 commit 到源分支即可

### 合并 MR

1. 确认所有 Reviewer 已 Approve
2. 确认无冲突（"Merge conflicts exist" 为红色时不可合并）
3. 选择合并方式：
   - **Merge commit**（默认，保留分支历史）
   - **Rebase and merge**（线性历史，推荐用于小 MR）
   - **Fast-forward merge**（仅当源分支可快进时可用）
4. 勾选 **Delete source branch**（临时分支合并后应删除）
5. 点击 **Merge**