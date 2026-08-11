# macOS v1.5.7 补齐实施进度

> 更新时间：2026-08-11

## 总览

| 指标 | 起点 | 当前 |
|---|---:|---:|
| preload / Windows IPC | 374 / 374 | 374 / 374 |
| macOS IPC | 304 | 374 |
| macOS IPC 覆盖率 | 81.28% | 100% |
| 缺失 IPC | 70 | 0 |
| feature suites | 旧证据 67 | 67/67 通过 |
| shared business line coverage | 旧证据 92.68% | 90.44% 通过 |
| core state-machine branch coverage | 旧证据 92.34% | 92.25% 通过 |
| integration adapter line coverage | 旧证据 59.37% | 59.37% 通过现行 55% 门槛 |

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

## 尚未签发的发布级证据

代码和可自动执行的功能门禁已通过，但 L4/L5/L6 release attestation 尚不能重新签发：当前仓库含任务开始前即存在的用户未提交修改，source snapshot 为 `clean=false`；既有 L4/L5/L6 receipt 绑定旧提交 `5d400030`。按照仓库防伪规则，不得把旧签名、公证、安装、在线升级证据改写为当前提交通过。

发布前还需在 clean release commit 上重新执行 packaged smoke、Runtime reproducibility、codesign/notarization/staple、Gatekeeper、clean install、签名在线升级/回滚和 TCC 真机验收，再运行 `record:l4-evidence`、`record:l5-evidence`、`record:l6-evidence` 与 `decide:release`。
