# Superpowers for DrSai

从 [obra/superpowers](https://github.com/obra/superpowers) (v5.1.0) 适配到 DrSai 的核心技能集合。

## 适配说明

- 原始项目: https://github.com/obra/superpowers (MIT License)
- 适配日期: 2025-05-18
- 适配内容:
  - `Task` → `Delegate`（DrSai 子代理工具）
  - `superpowers:xxx` → `xxx`（技能引用前缀）
  - 移除 Claude Code / Copilot CLI / Gemini CLI 平台专属引用
  - 移除 `hooks/`、git-worktrees 等 DrSai 不支持的功能
  - 保留 9 个核心技能

## 技能列表

| 技能 | 描述 |
|------|------|
| `brainstorming` | 编码前先设计，探索需求与方案 |
| `writing-plans` | 将设计拆分为可执行的小任务 |
| `subagent-driven-development` | 用 Delegate 子代理执行计划 + 双重审查 |
| `executing-plans` | 当前会话中顺序执行计划 |
| `test-driven-development` | 红-绿-重构 TDD 纪律 |
| `systematic-debugging` | 四阶段系统化调试方法 |
| `verification-before-completion` | 无验证不声称完成 |
| `dispatching-parallel-agents` | 并发分发独立子任务 |
| `using-superpowers` | 元技能：强制优先检查技能 |
