# Project Instructions: OpenDrSai

<!-- 本文件是 DrSai 的项目级持久化指令，每次会话启动时自动注入系统提示词。 -->
<!-- HTML 注释在注入前会被剥离，不消耗上下文 token。 -->
<!-- ⚠️ 目标：保持在 200 行以内。更长的文件消耗上下文且降低遵循度。 -->
<!-- 添加规则时，问自己："删除这条会导致 DrSai 犯错吗？" 如果不会，就删除。 -->

## Build & Test Commands

<!-- 这些是 DrSai 每次都需要知道的命令，不要让它自己猜 -->

- Build: `pip install -e python/packages/drsai`
- Install dev: `pip install -e "python/packages/drsai[all]"` (安装了 dev 依赖项)
- Test: `cd python/packages/drsai && python -m pytest tests/ --cov=src/drsai`
- Test single: `cd python/packages/drsai && python -m pytest tests/path/to/test_file.py::test_name -xvs`
- Run TUI: `python -m drsai.backend.run_cli chat`
- Run agent: `python run_drsai_agent.py`
- Frontend dev: `cd frontend && yarn dev` 或 `cd frontend && npm run develop`
- TUI build: `cd ui-tui && pnpm install && pnpm build`

## Project Architecture

<!-- 关键架构决策和目录布局 -->

### Key directories
- **Core agent framework:** `python/packages/drsai/src/drsai/`
  - `modules/agents/` — 智能体实现 (skills_agent, baseagent)
  - `modules/components/` — 组件 (model_context, model_client, tools)
  - `modules/managers/` — 数据库、配置管理器
  - `backend/run_cli.py` — CLI/TUI 入口
  - `backend/tui_gateway/` — TUI 网关服务
- **Terminal UI (TUI):** `ui-tui/` — 基于 React/Ink 的终端界面，用 pnpm 管理
- **Web Frontend:** `frontend/` — 基于 Gatsby 的 Web 前端
- **Desktop:** `desktop/` — Electron 桌面应用
- **Docs:** `docs/` — 文档（docs-drsai.ihep.ac.cn）
- **Skills:** `agent_skills/` — 智能体技能定义
- **Examples:** `examples/` — 示例配置和代码
- **Legacy:** `legacy/` — 废弃代码，不要修改

<!-- ### Framework
- 基于 **AutoGen 0.5.7** 构建，兼容 AutoGen 完整生态
- 模型接入：HepAI API (`https://aiapi.ihep.ac.cn/apiv2`) + Anthropic/OpenAI API
- 数据存储：SQLite (via SQLModel) + RAGFlow 矢量知识库
- 环境配置：`.env` 文件 (参考 `.env.example`) -->

<!-- ### Important: Python path
- Python 源码安装在 `python/packages/drsai/src/drsai/`
- 开发模式必须 `pip install -e python/packages/drsai`
- Pyright 配置的 include 是 `["src", "tests", "samples"]`，在 `python/packages/drsai/` 目录下运行 -->

<!-- ## Coding Standards -->

<!-- 具体、可验证的规则，不是泛泛的"保持整洁" -->
<!-- 遵循 Claude Code 最佳实践：如果两个规则矛盾，DrSai 会随机选一个 -->

<!-- - Python 代码使用 ruff 格式化，不要手动调整格式
- 类型注解：所有公开函数必须有完整类型注解（mypy strict mode）
- 命名：使用项目已有命名约定，新模块参照 `modules/agents/` 中的现有模式
- Import 顺序：标准库 → 第三方 → drsai 内部，每组之间空行
- 注释用中文或英文均可，但要一致
- 不要添加未被要求的功能、重构或"改进"
- 用工具行动而非长篇解释；先行动，再解释
- 修改代码前先 `ruff format`，修改后跑相关测试  -->

## Common Workflows

<!-- 重复频率高的操作流程 -->

### 开发新功能
1. 先了解相关模块：`run_read` 读取相关源码
2. 讨论方案，获得确认后再修改
3. 修改代码后运行 `ruff format` + `ruff check`
4. 编写或更新测试用例
5. `python -m pytest tests/ -xvs` 验证
6. 提交：`git commit -m "描述性提交信息"`

### 调试问题
1. 先看 log 输出和 `loguru` 日志
2. 用 `python -m pytest tests/相关测试 -xvs` 运行相关测试
3. 检查 `.env` 配置是否与 `.env.example` 一致

### 修改 CLI/TUI 代码
1. 修改 `python/packages/drsai/src/drsai/backend/run_cli.py` 或 `tui_gateway/`
2. 运行 `python -m drsai.backend.run_cli chat` 手动测试
3. 如涉及 TUI 前端 (`ui-tui/`)，需要 `cd ui-tui && pnpm build`

### 修改前端代码
1. `cd frontend && npm run develop` 启动开发服务器
2. 修改代码，浏览器自动热更新
3. 提交前运行 `npm run build` 确认无编译错误

## Git Workflow

<!-- 来源：docs/gitlab-branch-merge-resolution.md，防止分支分叉 -->

### 分支结构
- **main** — 发行主分支，由 xiongdb 维护
- **merge_latest** — 集成分支，所有 feature 分支合并到这里
- **feature/** — 个人开发分支

### 黄金规则 ⚠️
- 开发前先 `git merge merge_latest` 同步最新代码
- merge_latest 必须**每周**从 main 同步（`git merge main`）
- main ← merge_latest 发布后，必须**反向同步**回 merge_latest
- **不要**在 merge_latest 上直接开发，始终在 feature 分支上工作

### 模块归属
| 模块 | 负责人 | 非负责人变更规则 |
|------|--------|-----------------|
| `python/packages/drsai/` | xiongdb | 必须先沟通 + MR 审核 |
| `ui-tui/` | xiongdb | 必须先沟通 + MR 审核 |
| `frontend/` | frontend 团队 | 必须先沟通 + MR 审核 |
| `docs/` | 所有人 | MR 审核即可 |

### 合并冲突处理
- 以 main 为基准（`-X theirs` 方向：站在 merge_latest 上合并 main）
- 对于非本人负责模块的冲突，联系模块负责人确认
- 合并后必须验证：构建 → 测试 → 功能验证
- 详见 `docs/gitlab-branch-merge-resolution.md`

### MR 自检
- [ ] 已从 merge_latest 同步最新代码
- [ ] 无未解决的冲突
- [ ] 修改非本人模块时已与负责人沟通
- [ ] 本地基本功能测试通过

## Environment & Config

- 主要配置：`.env` 文件（复制 `.env.example` 修改）
- Claude Code 设置：`.claude/settings.local.json`（本地个人设置，已 gitignore）
- DrSai 工作空间：`~/.drsai/workspace/`（会话、数据库、配置等）
- 不要硬编码 API key 或敏感信息，从环境变量读取

## References

<!-- 用 @path 语法导入其他文件，会在启动时展开 -->
<!-- 详见 @README.md 和 @README_en.md -->
