# macOS v1.5.7 补齐实施进度

> 更新时间：2026-08-13
> 状态：v1.5.7 已完成、已发布、最终公网验收通过

## 总览

| 指标 | 起点 | 当前 |
|---|---:|---:|
| preload / Windows IPC | 374 / 374 | 385 / 385 |
| macOS IPC | 304 | 385 |
| macOS IPC 覆盖率 | 81.28% | 100% |
| 缺失 IPC | 70 | 0 |
| feature suites | 旧证据 67 | 67/67 通过 |
| product feature acceptance | 未签发 | 72/72 accepted |
| P2 engineering acceptance | 未签发 | 50/50 accepted |
| shared business line coverage | 旧证据 92.68% | 88.93% 通过现行 80% 门槛 |
| core state-machine branch coverage | 旧证据 92.34% | 90.4% 通过现行 90% 门槛 |
| integration adapter line coverage | 旧证据 59.37% | 59.37% 通过现行 55% 门槛 |

以下 R1～R8 保留为早期补齐过程记录；最终发布事实以文末“发布级证据”及完整发布方案为准。

## R1：基线与 Run 主干

- 新增 strict inventory parity gate；
- 补齐 Run list/inspection/manifest、Experiment、Replay、Comparison、Adoption、Runtime approval 和 Worktree adoption；
- 进度：304 → 331，缺口 70 → 43，覆盖率 81.28% → 88.50%；
- 验证：node/web typecheck 通过。

## R2：Agent、知识、模型与 Workspace

- 补齐 Agent tool/skill/knowledge policy、Knowledge Base、provider model probe、default workspace 和 app restart；
- 进度：331 → 350，缺口 43 → 24，覆盖率 88.50% → 93.58%；
- 验证：typecheck 通过。

## R3：Skills、GFS、Codex、移动远程与 Thread Share

- 新增跨平台 Gateway-managed resources 服务；
- 补齐 Skills 7、GFS 9、Codex session/restart 3、移动远程 2、Thread Share 3；
- 进度：350 → 374，缺口 24 → 0，覆盖率 93.58% → 100%；
- 验证：strict parity、main composition、build、完整 contract 通过。

## R4：全量自动验收与基线修复

- 修复 composition 的 304 硬编码，改为动态 preload parity；
- 修复 Node v16/v24 测试入口、临时 bundle workspace dependency 解析；
- 同步 OIDC-only 文案、Thread snapshot shard、Gateway readiness、Runtime model catalog 测试 fixture；
- 真实 Electron L3：通过，axe serious/critical = 0；
- Native Helper XCTest/Keychain/故障恢复/字节可复现：通过；
- coverage：67/67 suites 通过；
- Run Inspection contract：通过；
- build：通过。

## R5：退出竞态修复

- 根因：`before-quit` 的异步清理期间 renderer 仍可发起 IPC，而 Gateway 在依赖资源之前被关闭，导致 `desktop:list-perceptors` 等请求在 Electron `Session` 销毁阶段报错；开发启动器还会让 Electron 与 uvicorn 同时响应 Ctrl+C；
- 修复：退出计划先销毁 renderer 并清空已派发 IPC，将 Gateway 调整为最后关闭；开发启动器对 uvicorn 执行 `SIGTERM → 最多等待 5 秒 → 必要时 SIGKILL → wait`；
- 自动验证：node/web typecheck、process lifecycle、dev setup、main composition（374 IPC）及 `git diff --check` 全部通过；
- 真实验证：完整 API + Electron 启动后单次 Ctrl+C 约 0.3 秒完成退出，仅产生一次正常 API shutdown 日志，无 `desktop:list-perceptors`/`Session` 堆栈，无需第二次中断。

## R6：默认工作区单例化

- 根因：空注册表的 profile-local 冷启动回退与 renderer 的 Documents 默认工作区注册并发执行；旧记录缺少 `managedDefault` 元数据，未被新版去重识别；
- 修复：Windows/macOS 的 `list-workspaces` 首次调用统一传入系统 Documents 路径；精确识别 `~/.drsai-dev/workspaces/default` 的旧自动记录并迁移；
- 数据安全：迁移不跟随符号链接、不覆盖目标同名文件；只有全部内容成功迁移后才移除旧目录和注册记录，冲突数据保持可恢复；
- 验证：Windows/macOS 全量 typecheck、默认工作区迁移/冲突保留测试、374 IPC main composition、architecture contract 与 `git diff --check` 均通过；
- 当前实机已有 Electron 实例持有单实例锁，新逻辑将在该实例完全退出并重新启动后执行真实数据去重。

## R7：Footnotes 与来源卡片去重

- 根因：结构化来源卡片已聚合 URL，但原去重规则只识别显式 `Sources:` / `来源:` 列表；Markdown 的 `[^n]: URL` 会被渲染器自动展开为第二套 `Footnotes`；
- 修复：当尾部脚注全部是 URL 来源且结构化来源卡片存在时，移除对应脚注定义和正文标记；说明性脚注、混合内容或脚注后仍有正文时保持原样；
- 验证：URL-only 去重、说明性脚注保留、非尾部内容保护三类回归通过；macOS typecheck、UX contract、production build 和 `git diff --check` 通过。

## R8：Gateway 身份同步日志去噪

- 根因：Desktop 身份同步每次都重复 PUT 相同 `/v1/config/user-name`，Gateway 端又无条件写入并打印 INFO；健康/恢复循环因此持续刷相同日志；
- 修复：同一 Gateway 实例的同一身份不再重复 PUT；Gateway 探测离线时清空同步缓存，保证新实例恢复后重新同步；后端仅在身份值真实变化时记录 INFO；
- 验证：双平台 typecheck、Auth/Gateway coordination contract、连续两次相同身份仅记录一次的真实 Loguru 行为探针及 `git diff --check` 通过。

## 已签发的发布级证据

发布源 clean commit 为 `2f85374be7bb952ec76277563b6a3a8b81d604bd`。L4/L5/L6、release decision、72 项产品功能、50 项 P2 工程项、缺陷登记、覆盖率和 source binding 已重新签发；release decision 为 `releasable`，blockers 为空。

最终签名、公证、staple、Gatekeeper、clean install、v1.5.3 → v1.5.7 在线升级/回滚、Keychain、TCC、三种 HepAI 模型和 20/20 真机睡眠唤醒均通过。正式制品已发布到阿里云 OSS；`opendrsai-dev.ihep.ac.cn`、stable metadata、ZIP 和 DMG 的公网验收通过，详见 `apps/desktop/macos/build/acceptance/website-release.json`。
