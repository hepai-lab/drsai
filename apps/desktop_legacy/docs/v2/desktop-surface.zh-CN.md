# Desktop V2 · TS 端功能清单与通信协议

- 分支：`feature/desktop-v2`
- 日期：2026-08-25
- 对应后端：`cores/python/packages/drsai/src/drsai/backend/desktop_gateway/`（17 条路由）
- 验证：`npm run verify:desktop-surface` — **59 项全绿**（对真实 Runtime 跑，不是 mock）

---

## 0. 三层协议

```
渲染进程  ──19 个 IPC 方法 + 1 条事件通道──▶  主进程  ──17 条 HTTP 路由──▶  Runtime
          shared/api/desktopBridge.ts              shared/api/desktopGateway.ts
```

**渲染进程不发任何网络请求。** 这条定死了 `v2-minimal-surface.zh-CN.md` §4 的第 1 个未决问题：
不下发短时令牌给渲染进程，而是渲染进程完全不直连 Runtime。

理由不是风格：`x-opendrsai-gateway-token` 证明调用方是配对的本机进程，HepAI bearer 是用户的真实凭据。
渲染进程同时还在渲染模型输出、远程 markdown 和（预览面板里的）工作区文件内容——把凭据放进这个上下文，
就是把凭据放进了这些内容能够到的地方。下发短时令牌则要多造一套令牌生命周期（签发、刷新、吊销，各自的失败态），
换来的能力是零：渲染进程仍然到不了主进程会拒绝的路由，因为 Runtime 认证的本来就是主进程。

`shared/renderer/workbench.html` 的 CSP 把这条写死了——`connect-src` 里除了 Vite 的 dev server 没有任何远端。

---

## 0.5 命名：代码里没有 "v2"

新增代码**一律不以 `v2` 命名**。`v2` 是这次迁移的时刻标签，不是这些东西本身；等 legacy 下线之后，
一个叫 `desktopV2` 的目录只会让人问"那 v1 在哪"。这与 Python 侧的做法一致——那边也是
`gateway_v2` → `desktop_gateway`。

| 层 | 名字 | 为什么是这个名字 |
|---|---|---|
| `shared/api/desktopGateway.ts` | HTTP 契约 | 与 `drsai.backend.desktop_gateway` 一比一对应，一个名字能跨两种语言 grep |
| `shared/api/desktopBridge.ts` | IPC 契约 | 它是主进程↔渲染进程的桥，不是网关契约；两者是不同的东西，所以是两个文件 |
| `shared/main/desktopGateway/` | 主进程 | 网关的客户端 |
| `shared/renderer/src/workbench/` | 渲染进程 | 渲染进程**根本不碰网关**（见 §0），它是三栏工作台 UI |

标识符随之改名：`DesktopV2Result` → `BridgeResult`，`DESKTOP_V2_METHODS` → `BRIDGE_METHODS`，
`DesktopV2Service` → `BridgeService`，`createDesktopV2` → `createDesktopSurface`，
IPC 通道 `drsai2:*` → `drsai:bridge:*`，CSS 前缀 `v2-` → `wb-`，
错误码 `desktop_v2_*` → `bridge_*` / `desktop_gateway_*`。

**唯一保留的 `v2` 是一个协议值**：`DESKTOP_SURFACE = "desktop-v2"`。
因为 Python 路由返回的就是 `"surface": "desktop-v2"`，它命名的是**契约代次**
（设计文档 `v2-minimal-surface.zh-CN.md`，线上契约 `cores/protocol/desktop-v2/`），
改掉它会让这个客户端拒绝它本来要对接的 Runtime。除此之外没有任何模块、类、通道或样式类以迁移命名。

---

## 1. TS 端功能清单

11 项功能，19 个 IPC 方法。**每一项都对应一条或零条后端路由**，没有中间层自己发明的能力。

| # | 功能 | IPC 方法 | 后端路由 | TS 实现位置 |
|---|---|---|---|---|
| 1 | OIDC 登录 | `auth.login` / `auth.logout` / `auth.session` | *(无)* | [identity.ts](apps/desktop/shared/main/desktopGateway/identity.ts) → 复用 `shared/main/auth.ts` |
| | 运行时握手 | `runtime.identity` | `GET /v1/runtime` | [runtimeProcess.ts](apps/desktop/shared/main/desktopGateway/runtimeProcess.ts) |
| 2.1 | 新建会话 | `sessions.create` | `POST /v1/sessions` | [service.ts](apps/desktop/shared/main/desktopGateway/service.ts) |
| 2.2 | 历史列表 | `sessions.list` | `GET /v1/sessions` | 同上 |
| | 打开历史 | `sessions.get` + `sessions.subscribe` | `GET /v1/sessions/{id}` + oaep-snapshot | [sessionStream.ts](apps/desktop/shared/main/desktopGateway/sessionStream.ts) |
| | 重命名 | `sessions.rename` | `PATCH /v1/sessions/{id}` | service.ts |
| | 归档 / 恢复 | `sessions.archive` | `PATCH /v1/sessions/{id}` | service.ts |
| 2.3 | 工作区文件树 | `workspaces.files` | `GET /v1/workspaces/{id}/files` | [FilePane.tsx](apps/desktop/shared/renderer/src/workbench/components/FilePane.tsx) |
| 2.4 | 个人信息 | `auth.session` | *(无)* | identity.ts（OIDC claims，主进程已持有） |
| 2.5 | 工作区列表 | `workspaces.list` | `GET /v1/workspaces` | service.ts |
| | 打开工作区 | `workspaces.open` | `POST /v1/workspaces` | service.ts |
| 3.1 | 发送消息 | `chat.send` | `POST .../runs` + `POST .../execute` | service.ts（两条路由**合并**为一次调用） |
| | 实时流 | `sessions.subscribe` → `drsai:bridge:session-event` | `GET .../oaep-events/stream` | sessionStream.ts |
| | 断线重放 | *(自动)* | `GET .../oaep-events?after_sequence=` | sessionStream.ts |
| | markdown 渲染 | *(无)* | *(无)* | [Transcript.tsx](apps/desktop/shared/renderer/src/workbench/components/Transcript.tsx) |
| 3.2 | 模型选择 | `models.catalog` | `GET /v1/config/model-catalog` | service.ts |
| | 应用选择 | *(随 `chat.send` 传 `modelAlias`)* | — | Composer.tsx |
| 3.3 | 会话状态 | *(事件流上的 `run` 事件)* | *(无)* | [transcript.ts](apps/desktop/shared/renderer/src/workbench/transcript.ts) |
| | 停止 | `chat.cancel` | `POST /v1/runs/{id}/cancel` | Composer.tsx |
| 3.4 | 语音输入 | `voice.transcribe` | `POST /v1/audio/transcriptions` | Composer.tsx（MediaRecorder） |
| 4.1 | 文件预览 | `workspaces.readFile` | `GET /v1/workspaces/{id}/file` | FilePane.tsx |
| — | 取消订阅 | `sessions.unsubscribe` | *(关闭 SSE)* | sessionStream.ts |

### 两处刻意的"不是 1:1"

**`chat.send` 合并了 `createRun` + `executeRun`。**
能分开调用的渲染进程，就能留下一个"创建了但从未执行"的 run——它在历史里永远渲染成一个空气泡，
而且界面上没有任何地方能清掉它。合并后这个状态不可达。

**`sessions.subscribe` 与 `sessions.get` 分开。**
一个窗口可能开着好几个会话的标签页，但只流式渲染当前可见的那个；而且需要在重连中活下来的是**订阅**，不是那次 fetch。

---

## 2. 代码规模

| | V2 | 被取代的 legacy | |
|---|---|---|---|
| 契约类型 | 898 | *(散落在 `desktopApi.ts` 等)* | |
| 主进程 | 2,246 | `runtimeClient.ts` 1,934 + `oaepSessionStream.ts` 720 + `chat.ts` 3,422 + `preload.ts` 1,504 | |
| 平台外壳 | 120 | `windows/src/main/index.ts` 7,229 | |
| 渲染进程 | 1,551 | `App.tsx` 6,937（不含 100+ 个组件） | |
| **合计（不含测试/CSS）** | **4,815** | **21,746**（仅这 6 个文件） | |
| 测试 | 1,249（59 项，对真实 Runtime） | | |

差距几乎全部是**被删掉的路径**：主进程原来调用 103 条不同的 `/v1/...`，V2 调 17 条。

---

## 3. 通信协议

### 3.1 HTTP 层（主进程 ↔ Runtime）

每个请求带四个头，由 [client.ts](apps/desktop/shared/main/desktopGateway/client.ts) 组装：

```
x-opendrsai-gateway-token: <$DRSAI_HOME/runtime/instance-token>   配对证明
x-opendrsai-auth-mode:     oidc | offline
authorization:             Bearer <hepai access token>            仅 oidc
x-opendrsai-principal:     <OIDC subject>                         仅 oidc
x-correlation-id:          <32 hex>                               贯穿日志
```

`authorization` 和 `x-opendrsai-principal` **要么都发要么都不发**：中间件会用后者交叉校验前者，
只发 bearer 虽然能通过，但那次交叉校验就没做。

**offline 是受支持的状态，不是降级。** 没登录的桌面照样能开工作区、看历史、读文件——只有模型调用需要身份。
所以 `identity()` 在读不到凭据时返回 `{bearer: null, principal: null}` 而不是抛错。

错误统一成一个信封（`_errors.http_errors` 产出，client 侧把 FastAPI 的三种 `detail` 形态压平）：

```ts
{ status, code, message, retryable, details, correlationId }
```

三种形态：`HTTPException(detail="字符串")`、`_errors.py` 的结构化对象、Pydantic 422 的数组。压平在
`client.toError()` 一处完成，所以每个调用方都能直接判 `error.code`。

### 3.2 会话流（OAEP）

**三段式，缺一不可**——[sessionStream.ts](apps/desktop/shared/main/desktopGateway/sessionStream.ts)：

```
snapshot          "截至 N 的全部状态"     GET .../oaep-snapshot（分页）
events?after=N    "你错过的"              GET .../oaep-events
events/stream     "接下来发生的"           GET .../oaep-events/stream (SSE)
```

跳过中间那步是经典 bug：先订阅再快照，两者之间的事件会先于它要修改的状态抵达。
先快照、从快照的 sequence 重放、在重放的末尾接上实时流——每次交接都是精确的，因为 sequence 空间稠密、
`after_sequence` 是排他的。

| 场景 | 行为 |
|---|---|
| 409 `cursor_expired` | 丢弃本地状态，重新快照。**不消耗重试预算**，也不上报错误——这是可恢复状态 |
| 404 / 401 / 403 | `degraded` + `fatal: true`，停止重试（会话没了 / 这个 Runtime 永远不会接受我们） |
| 传输故障 / 5xx | 指数退避重试，500ms → 10s，最多 8 次 |
| 两个窗口看同一会话 | 共用一个 SSE 连接；后加入者从控制器的 item map 拿合成快照，不发第二次 HTTP |
| 最后一个监听者离开 | 立刻断开。空转的 SSE 会占住 Runtime 一个线程停在 `wait_oaep_events` |

自己解析 SSE 而不用 `EventSource`，有两个桌面端必须的理由：`EventSource` 发不了配对头和 bearer；
它的重连策略是固定的，会绕开上面这套 snapshot/replay 恢复，正好造出这个模块存在的意义所要防的那个空洞。

### 3.3 IPC 层（主进程 ↔ 渲染进程）

**一条 invoke 通道 + 一条推送通道**，不是 20 条命名通道：

```ts
BRIDGE_INVOKE_CHANNEL = "drsai:bridge:invoke"          // (method, request) → Result
BRIDGE_EVENT_CHANNEL  = "drsai:bridge:session-event"   // 所有流式更新
```

一个 `ipcMain.handle` 是一处可审计的 sender 校验点，而且测试能断言"已处理的方法集合 == `BRIDGE_METHODS`"。
换成按名分通道，未注册的方法只会在运行时静默变成 "no handler"。

`drsai:bridge:` 前缀与 legacy 的约 200 条 `desktop:*` 不相交——迁移期两套可以挂在同一个 `ipcMain` 上而不会串。

**所有 invoke 都 resolve，没有 reject：**

```ts
type BridgeResult<T> = { ok: true; value: T } | { ok: false; error: BridgeFailure };
```

IPC 的 reject 跨进程后会变成一个普通 `Error`，`name` / `code` / `details` 全被压成一句话——渲染进程就得靠解析
散文来区分"会话没了"和"网络抖了一下"。

**sender 校验**（[ipc.ts](apps/desktop/shared/main/desktopGateway/ipc.ts)）：

- 窗口必须由创建它的代码显式 `register`，未注册的 sender 一律拒绝
- `senderFrame.parent !== null` 一律拒绝——**这条针对的是文件预览面板**：预览的 HTML 文件不能通过 bridge 去读工作区里的其他文件
- `senderFrame` 不可用时按不可信处理，不按安全处理

### 3.4 背压

[eventDispatcher.ts](apps/desktop/shared/main/desktopGateway/eventDispatcher.ts)，容量 256：

| 规则 | 为什么 |
|---|---|
| 同一 item 同一 channel 的**连续** delta 合并 | 十个一字符的 delta 与一个十字符的 delta 渲染结果相同；限定"连续"是因为中间夹的 `run`/`items` 会改变后一个 delta 的含义 |
| 超容量时**只丢 delta**，永不丢 `snapshot`/`items`/`run`/`phase`/`error` | delta 只是动画，权威文本在下一个 `items` 上；丢掉 `run` 会让界面永远转圈 |
| 结构性事件超容量时，驱逐队列里最老的 delta | 队列有界，同时不丢任何带状态的事件 |

### 3.5 渲染端的折叠

[transcript.ts](apps/desktop/shared/renderer/src/workbench/transcript.ts) 是纯函数，无 React——因为这是整个渲染端最微妙的一段，
而且最容易错得没人发现（一个"几乎正确"的对话）。测试直接喂真实事件序列，不用挂载组件树。

**Item 是真相，delta 是动画。** 每个 item 一条规则：

- `running` / `pending` → 取 item 文本与累积 delta 中**更长的那个**（回合开头 item 是空的，delta 是全部；后来 item 追上并反超）
- 其他状态 → **取 item，丢弃 overlay**

这一条就是"丢了 delta 也不会渲染错"的全部原因：下一个 item 更新是**替换**整段文本，不是追加。

**排序**：`Item.sequence` 是 **run 内**的，两个 run 都从 1 开始。所以按 run 首次出现的顺序排 run，
run 内按 sequence 排。run 还没到的 item 排在最后而不是被丢掉——实时流上 item 可能和它的 run 同批抵达。

---

## 4. 一次对话的完整时序

```
渲染进程                     主进程                          Runtime
   │
   │ chat.send{sessionId,prompt,        ← clientMessageId 在按下回车时生成，
   │   clientMessageId,modelAlias}        它就是幂等键，重试必须复用同一个
   ├──────────────────────────▶│
   │                            │ sessions.subscribe（若未订阅）
   │                            ├── GET oaep-snapshot ─────────▶│
   │                            ├── GET oaep-events?after=N ───▶│
   │                            ├── GET oaep-events/stream ────▶│  ← 先订阅
   │                            │
   │                            ├── POST /v1/sessions/{id}/runs ▶│  201 新建 / 200 幂等命中
   │                            ├── POST /v1/runs/{id}/execute ─▶│  202，立刻返回
   │◀───{runId,status,created}──┤
   │                                                            │  Agent 在后台跑
   │                            │◀── SSE: event.item.created ───┤
   │◀── drsai:bridge:session-event ───┤    {kind:"items"}
   │                            │◀── SSE: event.item.delta ─────┤
   │◀── {kind:"delta"} ─────────┤    （连续的会被合并）
   │                            │◀── SSE: event.run.completed ──┤
   │◀── {kind:"run"} ───────────┤
   │
   │ run 进入终态 → 刷新文件树（一次目录遍历，不是定时轮询）
   │ workspaces.files ─────────▶│── GET .../files ──────────────▶│
```

**订阅必须早于 execute。** 这是 202 契约成立的全部理由：run 的输出不绑定在发起它的那个 HTTP 请求上，
所以刷新页面、开第二个窗口、断网重连都不丢消息。测试里断言了 `chat.send` 的耗时 < 30s——同步 execute 的话这个数字就是模型延迟。

失败也走同一条路：`RuntimeAgentService` 在每条异常路径上都记 `agent.failed` 并把 Run 转成 `failed`，
所以渲染进程在它已经在读的那条流上看到失败。验证套件里真实观察到的转移是 `queued → running → failed`（离线无身份）。

---

## 5. 怎么跑

```bash
npm run verify:desktop-surface --workspace opendrsai-windows-desktop
```

```bash
npm run dev:workbench --workspace opendrsai-windows-desktop
```

验证套件自己拉起 `python -m drsai.backend.desktop_gateway`（临时端口 + 临时 state root），跑完销毁。
不需要提前起服务，也不会碰开发者的 `~/.drsai`。

它用 `run-typescript-test.mjs` 而不是仓库惯用的 `run-bundled-test.mjs`：后者需要 `esbuild`，而
`apps/desktop/node_modules` 在纯后端的检出里并不存在。新 runner 只依赖 Node 22.18+ 的原生类型擦除，
代价是 `shared/main/desktopGateway/` 里不能出现 `enum`、`namespace`、参数属性——这个约束本身也值得保留。

---

## 6. 遗留问题

1. **`npm run typecheck` 跑不了。** 这个检出里 `apps/desktop/node_modules` 只有 57 个包，没有 `typescript`、
   `react`、`esbuild`。渲染进程那 5 个文件（依赖 `react` / `react-markdown`）没有经过类型检查，
   也没有真正在 Electron 里渲染过。主进程与契约层的逻辑由 59 项测试覆盖，渲染端的折叠逻辑
   （`transcript.ts`）也覆盖了；未覆盖的是 JSX 本身。装完依赖后应先跑 `npm run typecheck` 与 `npm run dev:workbench`。

2. **`verify-architecture-boundaries.mjs` 有一条**先前就存在**的失败**：
   `windows/src/main/index.ts: Windows must reuse the shared IPC trust boundary`。
   把本次改动 stash 掉后它照样失败，与 V2 无关，但它意味着这个检查目前是红的，加不了新断言。

3. **`_workspace_files.py` 加了一个 `shape` 字段**（`"tree" | "flat"`）。这是后端改动：客户端无法从数据推断
   自己拿到的是哪种形态（没有子目录的树和扁平列表长得一模一样）。Python 49 项测试仍全绿。

4. **legacy TS 一行未动**，见 [legacy-freeze.zh-CN.md](apps/desktop/docs/v2/legacy-freeze.zh-CN.md)。
