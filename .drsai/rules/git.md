<!-- Git 开发与合并规则 -->
<!-- 来源：docs/gitlab-branch-merge-resolution.md -->
<!-- 目的：防止 main 与 merge_latest 再次分叉 -->

# Git 分支与合并规则

## 分支结构

```
main（发行分支）
  │
  ├── merge_latest（集成分支）
  │     │
  │     ├── feature/xxx（开发者 A）
  │     ├── feature/yyy（开发者 B）
  │     └── fix/zzz（hotfix）
```

## 黄金规则：上游优先同步

每位开发者在自己的分支开发前，必须先同步上游最新代码：
- feature 分支 → 从 merge_latest 同步
- merge_latest → 从 main 同步（每周）
- main 发布后 → 反向同步回 merge_latest

## 同步频率

| 角色 | 频率 | 操作 |
|------|------|------|
| 所有开发者 | 每天 / 每次开发前 | `git merge merge_latest` 到自己的 feature 分支 |
| merge_latest 维护者 | 每周至少一次 | `git merge main` 到 merge_latest |
| main 维护者 | 每次 merge_latest→main 发布后 | `git merge main` 回 merge_latest（反向同步） |

## 模块归属

| 模块 | 负责人 | 非负责人变更规则 |
|------|--------|-----------------|
| `cores/python/packages/drsai/` | xiongdb | 必须先沟通 + MR 审核 |
| `apps/webui/backend/` | drsai_ui 团队 | 必须先沟通 + MR 审核 |
| `apps/webui/frontend/` | frontend 团队 | 必须先沟通 + MR 审核 |
| `apps/ui-tui/` | xiongdb | 必须先沟通 + MR 审核 |
| `docs/` | 所有人 | MR 审核即可 |

## 合并冲突处理

### main 与 merge_latest 之间发生冲突时：
1. **基准选择**：main 是发行分支，核心代码以 main 为准
2. **合并方向**：站在 merge_latest 上，将 main 合入
3. **处理策略**：drsai 核心和 ui-tui 文件 → 直接用 main 版本（`git checkout gitlab/main -- <文件>`）
4. **手动审查**：两边都有修改的文件（如 `apps/webui/backend/`），手动对比后决定

### ⚠️ `-X ours` / `-X theirs` 方向陷阱：

```bash
# 站在 merge_latest 上时：
git merge main -X ours    # ❌ 错误！ours = merge_latest，保留了旧代码
git merge main -X theirs  # ✅ 正确！theirs = main，保留了 main 的新版本
# 最安全的方式：先让冲突暴露，再用 git checkout main -- <文件> 逐文件解决
```

## 合并请求自检清单

提交 MR 前必须确认：
- [ ] 已从 merge_latest 同步最新代码（`git merge merge_latest`）
- [ ] 无未解决的冲突
- [ ] 如果修改了非本人负责的模块，已与模块负责人沟通，xiongdb@ihep.ac.cn
- [ ] 本地构建和基本功能测试通过

## CI 检查（建议添加）

在 `.gitlab-ci.yml` 中添加：
- **同步检查**：push 到 merge_latest 时，验证是否能从 main 快进合并
- **冲突预警**：每日 `git merge-tree` 检测冲突数，超过阈值自动告警
- **30 提交差距告警**：merge_latest 领先 main 超过 30 个提交时发出警告