# Desktop TS 端 legacy 封存

- 日期：2026-08-25
- 配套：[desktop-surface.zh-CN.md](apps/desktop/docs/v2/desktop-surface.zh-CN.md)（V2 的功能清单与协议）
- 后端对应：`gateway_legacy.py` / `backend/gateway/` 的封存计划

---

## 0. 结论：本次没有移动任何 legacy 文件

V2 的 TS 面是**并列新增**的，legacy 一行未改。这与 Python 侧的做法一致——`desktop_gateway/` 是
`gateway/` 的兄弟目录，而不是它的子包。

理由是可验证的：`shared/main/` 有 145 个 `.ts` 文件、81,887 行，`windows/src/main/index.ts` 一个文件
7,229 行，`shared/renderer/src/App.tsx` 6,937 行。把 `runtimeClient.ts` 改名为 `runtimeClient.legacy.ts`
会一次性改动上百处 import，而收益只是文件名上多四个字。**封存是一个状态，不是一次改名**——真正让 legacy
停止运行的是入口点指向哪里，而入口点现在是新增的第二套。

所以本次交付的封存形态是：

- legacy 可通过 `npm run dev:legacy` 回退；默认入口已切到 V2
- V2 是默认三层入口，`npm run dev` / `windows-desktop-dev.cmd` 走 workbench + `desktop_gateway`
- 下面这张表说明**哪个 legacy 模块被哪个 V2 模块取代**，供第 2 阶段逐个下线时对照

---

## 1. 取代关系

| legacy | 行数 | V2 取代者 | 行数 |
|---|---:|---|---:|
| [runtimeClient.ts](apps/desktop/shared/main/runtimeClient.ts) | 1,934 | [desktopGateway/client.ts](apps/desktop/shared/main/desktopGateway/client.ts) | 498 |
| [oaepSessionStream.ts](apps/desktop/shared/main/oaepSessionStream.ts) | 720 | [desktopGateway/sessionStream.ts](apps/desktop/shared/main/desktopGateway/sessionStream.ts) | 494 |
| [chat.ts](apps/desktop/shared/main/chat.ts) | 3,422 | [desktopGateway/service.ts](apps/desktop/shared/main/desktopGateway/service.ts) | 363 |
| [boundedEventDispatcher.ts](apps/desktop/shared/main/boundedEventDispatcher.ts) | 58 | [desktopGateway/eventDispatcher.ts](apps/desktop/shared/main/desktopGateway/eventDispatcher.ts) | 129 |
| [gateway.ts](apps/desktop/shared/main/gateway.ts) | 1,033 | [desktopGateway/runtimeProcess.ts](apps/desktop/shared/main/desktopGateway/runtimeProcess.ts) | 223 |
| [preload.ts](apps/desktop/shared/main/preload.ts) | 1,504 | [desktopGateway/preload.ts](apps/desktop/shared/main/desktopGateway/preload.ts) | 92 |
| [windows/src/main/index.ts](apps/desktop/windows/src/main/index.ts) | 7,229 | [windows/src/main/workbench.ts](apps/desktop/windows/src/main/workbench.ts) | 111 |
| [windows/src/preload/index.ts](apps/desktop/windows/src/preload/index.ts) | 2 | [windows/src/preload/workbench.ts](apps/desktop/windows/src/preload/workbench.ts) | 9 |
| [shared/renderer/src/App.tsx](apps/desktop/shared/renderer/src/App.tsx) | 6,937 | [src/workbench/App.tsx](apps/desktop/shared/renderer/src/workbench/App.tsx) + 4 个组件 | 1,551 |
| [shared/renderer/index.html](apps/desktop/shared/renderer/index.html) | 17 | [shared/renderer/workbench.html](apps/desktop/shared/renderer/workbench.html) | 26 |
| [auth.ts](apps/desktop/shared/main/auth.ts) | 1,588 | **不取代，复用** | — |

`auth.ts` 是唯一被复用而非取代的：OIDC 流程、OS 凭据库、刷新计时器都已经写好了，而且 V2 收窄的东西
里没有它——42 端点契约里那 4 条鉴权路由是凭空造的，gateway 从来没有 `/v1/auth/*`。
[identity.ts](apps/desktop/shared/main/desktopGateway/identity.ts) 是它的适配器，40 行。

## 2. legacy 独有、V2 没有的能力

这些不是"还没写"，是 11 项功能里没有：

goal 确认与 propose/confirm、run inspection、reproduction manifest、experiments、run relations、
replay boundaries、approvals 决策、side-effects 认领、diagnostics、worktrees、checkpoints、git 操作、
skills 管理 UI、gfs、model provider CRUD（23 条）、config CRUD（19 条）、远程 SSH 工作区、
terminal / PTY、browser-use、scheduled tasks、workflow marketplace、shares、team memory。

对应到主进程的调用面：**legacy 调 103 条不同的 `/v1/...`，V2 调 17 条。**

## 3. 分阶段下线

| 阶段 | 内容 | 状态 |
|---|---|---|
| 0 | `desktop_gateway`（Python，17 条路由 + 49 项测试） | ✅ |
| 1 | V2 TS 面（3 层，19 个 IPC 方法 + 59 项测试） | ✅ 本次 |
| 2 | 装依赖后 `npm run typecheck` + `npm run dev:workbench` 实机验收 | ⬜ |
| 3 | 决定默认入口：把 `dev` 指向 V2 配置，legacy 降级为 `dev:legacy` | ✅ `dev` / `windows-desktop-dev.cmd` → workbench；`build` 仍为 legacy |
| 4 | 删除第 1 节左列文件；`gateway.ts` 的启动入口改指 `drsai.backend.desktop_gateway` | ⬜ 依赖阶段 3 + build 切换 |
| 5 | Python 侧封存：`gateway_legacy.py` + `gateway/` → `backend/_retired/`，保留冻结基线 | ⬜ 依赖阶段 4 |

**阶段 3 已切默认 `dev` 入口；`build`/打包仍走 legacy。** 远程 SSH、微信适配器、`drsai gateway` CLI
仍依赖 legacy 主进程与 28642 gateway，打包切换前不要删左列文件。

## 4. 两套如何并存

| | legacy | V2 |
|---|---|---|
| Runtime 模块 | `drsai.backend.gateway` | `drsai.backend.desktop_gateway` |
| 端口 | 28642 | 28643（`DRSAI_DESKTOP_GATEWAY_PORT`） |
| state root | `DRSAI_HOME` | `DRSAI_DESKTOP_GATEWAY_HOME`（回退到 `DRSAI_HOME`） |
| 配对令牌 | `$DRSAI_HOME/runtime/instance-token` | **同一个文件**（配对是交接，不是状态） |
| IPC 通道 | `desktop:*`（约 200 条） | `drsai:bridge:invoke` + `drsai:bridge:session-event` |
| 渲染入口 | `index.html` → `src/main.tsx` | `workbench.html` → `src/workbench/main.tsx` |
| 构建配置 | `electron.vite.config.ts` | `electron.vite.workbench.config.ts` |
| npm 脚本 | `dev:legacy` / `build` | `dev` / `dev:workbench` / `build:workbench` |

IPC 前缀不相交，所以迁移期两套可以注册在同一个 `ipcMain` 上而不会有某个 V2 调用被 legacy handler 静默接走。

开发期给 V2 单独设 `DRSAI_DESKTOP_GATEWAY_HOME`，否则两边写同一份 SQLite——这是
`v2-minimal-surface.zh-CN.md` §4 第 2 个未决问题，现在有环境变量了。
