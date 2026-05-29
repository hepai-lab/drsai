# DrSai 分支合并分歧处理方案

> 适用项目：`code.ihep.ac.cn:hepai/drsai`
> 创建日期：2025-07
> 问题性质：`main` 与 `merge_latest` 严重分叉，需一次性修复

---

## 1 现状分析

### 1.1 问题本质

`main` 和 `merge_latest` 从 2026-05-07 起各自独立演进，形成了**双向分叉**：

```
共同祖先 (022560c, 2026-05-07)
     │
     ├──→ main (53 commits ahead)        ← xiongdb 开发的核心代码
     │    核心: drsai agent、TUI、gateway、cli
     │
     └──→ merge_latest (69 commits ahead) ← 其他人开发的 drsai_ui、frontend
          核心: drsai_ui 后端、frontend 前端、docmaster 功能
```

**根本原因**：`merge_latest` 的开发者只在自己的模块目录内开发，没有定期从 `main` 合入上游变更，导致两个分支的**公共代码**出现严重冲突。

### 1.2 冲突全景

经模拟合并测试（`main → merge_latest`），共 **18 个文件冲突**：

| 冲突区域 | 文件数 | 冲突文件 | 说明 |
|----------|--------|----------|------|
| **drsai 核心** | 12 | `commands.py`, `gateway.py`, `run_cli.py`, `run_drsai_agent_factory.py`, `agent_runner.py`, `prompt.py`, `slash.py`, `operater_funs.py`, `drsaiagent.py`, `version.py`, `pyproject.toml`, `tui-migration-guide.md` | main 的代码大幅重构后，merge_latest 仍停留在旧版本 |
| **drsai_ui** | 2 | `task_team.py`, `teammanager.py` | 两边都有修改 |
| **ui-tui** | 3 | `turnController.ts`, `composerPane.tsx`, `streamingAssistant.tsx` | 两边独立新增/改写同一文件（add/add 冲突） |
| **根目录** | 1 | `run_drsai_agent.py` | 两边都有修改 |

### 1.3 关键判断

| 判断项 | 结论 |
|--------|------|
| 冲突是否可以自动解决？ | ❌ 不可以，18 个文件需手动解决 |
| 冲突是否集中？ | ✅ 比较集中，大部分在 `python/packages/drsai/` 的后端代码 |
| 两个分支的修改是否有逻辑关联？ | ❌ 几乎没有，各自在不同模块开发 |
| drsai_ui/frontend 的代码在 main 中有吗？ | 有一部分旧版本，但 merge_latest 的更新 main 没有 |
| main 的核心代码在 merge_latest 中有吗？ | 旧版本有，但 main 的重构 merge_latest 没有 |

---

## 2 推荐处理方案

### 方案：以 `main` 为基准，将 `merge_latest` 的独有内容合入

**核心思路**：main 是发行主分支，以 main 为基准接收 merge_latest 的独有增量，**冲突处以 main 为准（ours），仅保留 merge_latest 新增的 drsai_ui/frontend 代码**。

```
            main (基准)
             │
    ┌────────┤ merge main → merge_latest (冲突以 main 为准)
    │        │
    │   merge_latest (统一后的)
    │        │
    └────────┤ merge merge_latest → main (发布)
             │
           main (发布版本)
```

### 2.1 操作步骤

#### Phase 1：备份

```bash
# 确保远程分支已保存（GitLab 上已有，无需额外操作）
# 如需额外保险，可打 backup tag
git push gitlab gitlab/main:refs/tags/backup/main-before-merge-$(date +%Y%m%d)
git push gitlab gitlab/merge_latest:refs/tags/backup/merge-latest-before-merge-$(date +%Y%m%d)
```

#### Phase 2：将 main 合并到 merge_latest（解决分歧的核心步骤）

```bash
# 1. 切到 merge_latest
git checkout merge_latest
git pull gitlab merge_latest

# 2. 合并 main，冲突时以 main 为准（ours 策略）
git merge gitlab/main -X ours --no-edit

# 3. 检查合并结果
git status

# 4. 如果有 18 个冲突文件，-X ours 已经自动选择了 main 的版本
#    但需要确认 merge_latest 独有的代码没有被错误覆盖
#    重点检查以下文件：
```

> ⚠️ **`-X ours` 的局限**：对于 `add/add` 冲突（两边独立新增了同名文件），`-X ours` 会完全丢弃对方的内容。如果 merge_latest 中某些文件有 main 没有的重要代码，需要手动补回。

#### Phase 3：手动审查和修复关键冲突文件

`-X ours` 自动解决后，以下文件可能需要手动补回 merge_latest 的独有改动：

| 文件 | 审查要点 |
|------|----------|
| `python/packages/drsai_ui/.../task_team.py` | main 可能没有此文件最新版，需确认是否保留 merge_latest 版本 |
| `python/packages/drsai_ui/.../teammanager.py` | 同上 |
| `ui-tui/src/components/streamingAssistant.tsx` | 如果 merge_latest 有自己的 UI 改动，需手动合并 |
| `ui-tui/src/components/composerPane.tsx` | main 版本更新更全面，大概率以 main 为准即可 |
| `ui-tui/src/app/turnController.ts` | 同上 |
| `run_drsai_agent.py` | 检查 merge_latest 是否有独有的启动参数 |

**审查方法**：

```bash
# 查看某个冲突文件在两边版本的差异
git diff gitlab/main gitlab/merge_latest -- python/packages/drsai_ui/src/drsai_ui/agent_factory/magentic_one/task_team.py

# 如果确认应以 merge_latest 版本为准，检出该文件
git checkout gitlab/merge_latest -- python/packages/drsai_ui/src/drsai_ui/agent_factory/magentic_one/task_team.py
git add python/packages/drsai_ui/src/drsai_ui/agent_factory/magentic_one/task_team.py
```

#### Phase 4：验证合并结果

```bash
# 1. 确认 drsai_ui 和 frontend 代码完整存在
ls python/packages/drsai_ui/
ls frontend/

# 2. 确认 main 的核心代码完整
ls python/packages/drsai/src/drsai/backend/tui_gateway/
ls ui-tui/src/

# 3. 尝试构建/运行
cd ui-tui && pnpm install && pnpm build
cd ../python/packages/drsai && pip install -e .

# 4. 提交合并
git add -A
git commit -m "merge: sync main into merge_latest, resolve 18 conflicts (main as base)"
git push gitlab merge_latest
```

#### Phase 5：反向同步 — merge_latest 合并回 main

```bash
# 此时 merge_latest 已包含两边的全部代码
git checkout main
git pull gitlab main
git merge merge_latest --no-edit
# 此时应该几乎无冲突（因为 merge_latest 已经包含了 main 的所有内容）
git push gitlab main
```

---

## 3 替代方案（如果 -X ours 风险太大）

### 方案 B：逐模块手动合并

将 merge_latest 的独有内容**按模块**逐个 cherry-pick 或手动复制到 main：

```bash
# 1. 创建工作分支
git checkout -b fix/sync-merge-latest gitlab/main

# 2. 只复制 merge_latest 独有的目录（不涉及冲突）
#    drsai_ui 和 frontend 在 main 中有旧版本，直接覆盖
git checkout gitlab/merge_latest -- python/packages/drsai_ui/
git checkout gitlab/merge_latest -- frontend/
git add -A
git commit -m "chore: sync drsai_ui and frontend from merge_latest"

# 3. 对于冲突的 drsai 核心文件，逐一对比后手动决定
#    使用 VS Code 或 diff 工具对比两个版本
git difftool gitlab/main gitlab/merge_latest -- python/packages/drsai/src/drsai/backend/cli/commands.py
# ... 手动编辑 ...

# 4. 测试 + 合并
```

**优缺点**：

| 方面 | 方案 A（-X ours merge） | 方案 B（逐模块手动） |
|------|------------------------|---------------------|
| 速度 | ⚡ 快，自动解决大部分冲突 | 🐢 慢，逐文件对比 |
| 风险 | 中等，可能误丢 merge_latest 的独有代码 | 低，每一步都在控制中 |
| 代码审查 | 需事后全量 diff 确认 | 过程中就已审查 |
| 推荐场景 | 两边修改交集较少时 | 两边修改交集较多、或对代码不熟悉时 |

---

## 4 后续规范流程（防止再次分叉）

### 4.1 核心规则：上游优先同步

```
┌──────────────────────────────────────────────────────────────┐
│                    黄金规则                                   │
│                                                              │
│   每位开发者在自己的分支开发前，必须先从 merge_latest 同步     │
│   merge_latest 必须定期（每周）从 main 同步                    │
│   main ← merge_latest 的发布合并后，必须反向同步回 merge_latest  │
└──────────────────────────────────────────────────────────────┘
```

### 4.2 同步频率要求

| 角色 | 同步频率 | 操作 |
|------|----------|------|
| **所有开发者** | 每天 / 每次开始开发前 | `git merge merge_latest` 到自己的 feature 分支 |
| **merge_latest Maintainer** | 每周至少一次 | `git merge main` 到 merge_latest |
| **main Maintainer** | 每次 merge_latest→main 发布后 | `git merge main` 回 merge_latest（反向同步） |

### 4.3 模块归属与变更权

为了避免不同开发者在同一文件上产生冲突，明确**模块归属**：

| 模块目录 | 主要负责人 | 其他开发者变更时 |
|----------|-----------|----------------|
| `python/packages/drsai/` | xiongdb | ⚠️ 必须先与 xiongdb 沟通，通过 MR 审核 |
| `python/packages/drsai_ui/` | drsai_ui 开发者 | ⚠️ 必须先与负责人沟通 |
| `frontend/` | frontend 开发者 | ⚠️ 必须先与负责人沟通 |
| `ui-tui/` | xiongdb | ⚠️ 必须先与 xiongdb 沟通 |
| `docs/` | 所有人 | 无限制，但 MR 需审核 |

### 4.4 MR 强制检查项

每位开发者在提交 MR 前必须确认：

```markdown
## 合并前自检（新增）
- [ ] 已从 merge_latest 拉取最新代码（`git merge merge_latest`）
- [ ] 无冲突或冲突已解决
- [ ] 如修改了非本人负责的模块，已与模块负责人沟通
- [ ] 本地基本功能测试通过
```

### 4.5 CI 自动化（建议后续添加）

建议在 GitLab 上添加 `.gitlab-ci.yml`，自动执行：

1. **merge_latest 合入检测**：每次 push 到 `merge_latest` 时，自动检测是否可以从 `main` 快进合并（如果不能，说明 merge_latest 又落后了）
2. **冲突预警**：定期（如每日）运行 `git merge-tree` 检测 main 与 merge_latest 的冲突数，超过阈值自动通知

```yaml
# .gitlab-ci.yml 示例
stages:
  - check

sync-check:
  stage: check
  script:
    - git fetch origin main merge_latest
    - CHANGES=$(git log --oneline origin/main..origin/merge_latest | wc -l)
    - echo "merge_latest is ${CHANGES} commits ahead of main"
    - if [ "$CHANGES" -gt 30 ]; then echo "⚠️ merge_latest is too far ahead, please sync!"; exit 1; fi
  only:
    - merge_latest
```

---

## 5 操作时间线

| 阶段 | 时间 | 负责人 | 事项 |
|------|------|--------|------|
| **Phase 1** 备份 | Day 1 上午 | xiongdb | 打 backup tag |
| **Phase 2** 合并 main→merge_latest | Day 1 | xiongdb | `-X ours` 合并 + 自动解决 |
| **Phase 3** 手动审查 | Day 1-2 | xiongdb + drsai_ui 负责人 | 逐一审查 18 个冲突文件 |
| **Phase 4** 验证 | Day 2 | 全员 | 构建、运行、功能验证 |
| **Phase 5** 反向同步 | Day 2 | xiongdb | merge_latest→main，打发布 tag |
| **Phase 6** 规范落地 | Day 3 起 | 全员 | 遵守 §4 的同步规则 |

---

## 附录：18 个冲突文件详细清单

### A. drsai 核心代码（12 个文件，建议以 main 为准）

| # | 文件路径 | 冲突类型 | 处理建议 |
|---|---------|----------|----------|
| 1 | `python/packages/drsai/docs/tui-migration-guide.md` | add/add | 保留 main 版本（main 新增） |
| 2 | `python/packages/drsai/pyproject.toml` | content | 保留 main 版本（版本号等） |
| 3 | `python/packages/drsai/src/drsai/backend/cli/commands.py` | content | 保留 main 版本（大幅重构） |
| 4 | `python/packages/drsai/src/drsai/backend/gateway.py` | add/add | 保留 main 版本（新增） |
| 5 | `python/packages/drsai/src/drsai/backend/run_cli.py` | content | 保留 main 版本（重构） |
| 6 | `python/packages/drsai/src/drsai/backend/run_drsai_agent_factory.py` | content | 保留 main 版本 |
| 7 | `python/packages/drsai/src/drsai/backend/tui_gateway/adapter/agent_runner.py` | add/add | 保留 main 版本（新增） |
| 8 | `python/packages/drsai/src/drsai/backend/tui_gateway/handlers/prompt.py` | add/add | 保留 main 版本（新增） |
| 9 | `python/packages/drsai/src/drsai/backend/tui_gateway/handlers/slash.py` | add/add | 保留 main 版本（新增） |
| 10 | `python/packages/drsai/src/drsai/modules/agents/skills_agent/managers/operater_funs.py` | content | 保留 main 版本 |
| 11 | `python/packages/drsai/src/drsai/modules/baseagent/drsaiagent.py` | content | 保留 main 版本（核心重构） |
| 12 | `python/packages/drsai/src/drsai/version.py` | content | 保留 main 版本（版本号） |

### B. drsai_ui 代码（2 个文件，需手动合并）

| # | 文件路径 | 冲突类型 | 处理建议 |
|---|---------|----------|----------|
| 13 | `python/packages/drsai_ui/.../task_team.py` | content | ⚠️ 两边都有修改，手动对比 |
| 14 | `python/packages/drsai_ui/.../teammanager.py` | content | ⚠️ 两边都有修改，手动对比 |

### C. ui-tui 代码（3 个文件，建议以 main 为准）

| # | 文件路径 | 冲突类型 | 处理建议 |
|---|---------|----------|----------|
| 15 | `ui-tui/src/app/turnController.ts` | add/add | 保留 main 版本（新版 TUI） |
| 16 | `ui-tui/src/components/composerPane.tsx` | add/add | 保留 main 版本（新版 TUI） |
| 17 | `ui-tui/src/components/streamingAssistant.tsx` | add/add | 保留 main 版本（新版 TUI） |

### D. 根目录（1 个文件，需手动合并）

| # | 文件路径 | 冲突类型 | 处理建议 |
|---|---------|----------|----------|
| 18 | `run_drsai_agent.py` | content | ⚠️ 两边都有修改，手动对比 |
