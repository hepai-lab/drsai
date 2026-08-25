# Desktop Workbench · 启动与测试

- 日期：2026-08-25
- 对象：`apps/desktop` 新增的最小面（workbench）+ `drsai.backend.desktop_gateway`
- 依据：[v2-minimal-surface.zh-CN.md](apps/desktop/docs/v2/v2-minimal-surface.zh-CN.md)
- 相关：[desktop-surface.zh-CN.md](apps/desktop/docs/v2/desktop-surface.zh-CN.md)（功能清单与协议）、[legacy-freeze.zh-CN.md](apps/desktop/docs/v2/legacy-freeze.zh-CN.md)

---

## 0. 先读这段：哪些已经验过，哪些没有

**已自动验证**（`npm run verify:desktop-surface`，59 项，对真实 Runtime 跑）：
17 条路由的契约一致性、鉴权、错误信封、OAEP 快照/重放/SSE、断线恢复、背压、IPC 边界、
`chat.send` 的 202 与幂等、渲染端的转录折叠。Python 侧 49 项另算。

**没有验证过的三件事**——这份文档主要就是让你把它们跑出来：

| # | 没验过什么 | 为什么 |
|---|---|---|
| 1 | **4 个 `.tsx` 从未类型检查、从未渲染** | 这个检出的 `apps/desktop/node_modules` 只有 57 个包，没有 `typescript` / `react` / `esbuild`，`npm run typecheck` 跑不了 |
| 2 | **Electron 外壳从未启动** | 同上，没有 electron |
| 3 | **从未出现过一条真实的模型回复** | 自动测试是离线身份（无凭据），run 走到 `failed`。这意味着 `event.item.delta`（打字机效果）这条路径在真机上是第一次跑 |

第 3 条最要紧：链路的每一跳都单独验过，但**文字逐字出现**这个最显眼的行为，只有你登录后手动跑才能确认。

---

## 1. 环境准备

### 1.1 Node 版本

仓库钉的是 **Node 22**（`.nvmrc` = `22`，`engines: ">=22 <23"`）。你当前是 **v24.18.0**。

```bash
nvm use 22
```

- **构建/运行 Electron 必须用 22**：`npm run verify:node` 会硬断言 major==22，`electron-vite` 与 `electron-builder` 也按 22 验过。
- 自动测试脚本 `run-typescript-test.mjs` 在 22.18+ 和 24 上都能跑（用的是 Node 原生类型擦除）。

### 1.2 装依赖

```bash
cd apps/desktop && npm install
```

这一步会装 electron / react / typescript / esbuild 等（几百 MB，首次较慢）。装完之后：

```bash
npm run verify:node
```

### 1.3 Python 环境

用仓库根的 `./venv`（**不是 `.venv`**）：

```bash
./venv/Scripts/python.exe -c "import drsai.backend.desktop_gateway as m; print(m.DEFAULT_HOST, m.DEFAULT_PORT)"
```

期望输出 `127.0.0.1 28643`。

---

## 2. 启动事项

### 2.1 端口与状态目录

| | legacy | workbench |
|---|---|---|
| 模块 | `drsai.backend.gateway` | `drsai.backend.desktop_gateway` |
| 端口 | 28642 | **28643** |
| 状态根 | `DRSAI_HOME` | `DRSAI_DESKTOP_GATEWAY_HOME`（不设则回退 `DRSAI_HOME`） |
| 配对令牌 | `$DRSAI_HOME/runtime/instance-token` | **同一个文件** |

**建议第一次测试时隔离状态目录**，否则两套会话数据写进同一份 SQLite：

```bash
set DRSAI_DESKTOP_GATEWAY_HOME=%USERPROFILE%\.drsai-workbench
```

> ⚠️ 配对令牌**故意**仍从 `DRSAI_HOME` 读——它是桌面端与 Runtime 的交接文件，不是 Runtime 状态，两套共用一个。所以隔离状态目录不会导致 401。

### 2.2 不要用 `scripts/dev.ps1` 启 workbench

`dev.ps1` 会起 **legacy** 网关（28642）并设 `DRSAI_GATEWAY_DEV_MANAGED=1`。workbench 用的是另一个变量，
不会被它误导，但它也不会替你起 28643 上的 Runtime。两者可以同时开着，互不干扰。

### 2.3 两种启动方式

**方式 A（推荐，最省事）**——外壳自己拉起 Runtime：

```bash
npm run dev:workbench --workspace opendrsai-windows-desktop
```

Electron 起来后会自己 spawn `python -m drsai.backend.desktop_gateway`。冷启动导入约 48k 行 Python，
**首次可能要 30–90 秒**；这段时间窗口会显示"Starting OpenDrSai…"或"Runtime is not responding"，
这是**正常的**，不是错误——`runtime.identity` 每 2 秒重探一次，好了会自动消失。

**方式 B**——你自己管 Runtime（想看 Python 日志、想改 Python 热重载时用）：

```bash
./venv/Scripts/python.exe -m drsai.backend.desktop_gateway
```

另开一个终端：

```bash
set OPENDRSAI_WORKBENCH_EXTERNAL_RUNTIME=1&& npm run dev:workbench --workspace opendrsai-windows-desktop
```

`OPENDRSAI_WORKBENCH_EXTERNAL_RUNTIME=1` 让外壳**只接管、不启动**。若 28643 上没人监听，它会直接报错而不是静默起第二个进程。

### 2.4 确认 Runtime 活着

```bash
curl http://127.0.0.1:28643/v1/runtime
```

期望字段：

```json
{"surface": "desktop-v2", "protocol_version": 1, "capabilities": ["model_catalog","runs",...], "runtime_source_digest": "<64 hex>"}
```

- `surface` 必须是 `desktop-v2`。若不是，说明 28643 上跑的是别的东西，外壳会拒绝接管。
- `runtime_source_digest` 是**导入时**算的。改完 Python 重启后这个值必须变化——否则你测的还是旧代码。

---

## 3. 自动测试

按从快到慢的顺序跑。

### 3.1 契约 + 通信全链路（59 项，约 3–5 分钟）

```bash
npm run verify:desktop-surface --workspace opendrsai-windows-desktop
```

它**自己拉起** Runtime（随机端口 + 临时状态目录），跑完销毁，不碰你的 `~/.drsai`。不需要提前起服务。

期望结尾：`59 passed, 0 failed`。

分组含义：

| 组 | 覆盖 |
|---|---|
| A. contract | 服务端 OpenAPI 的 17 条 == 客户端声明的 17 条；没有 FastAPI 自动派生的 operationId |
| B. client | 逐条打真实路由：工作区、文件树、文件读、会话 CRUD、归档、幂等、模型目录、401/404/422 |
| C. session stream | 快照/重放/SSE、游标排他性、cursor_expired 重快照、404 降级、双订阅共用连接 |
| D. backpressure | delta 合并、超容量只丢 delta、窗口销毁不抛异常 |
| E. IPC | sender 拒绝、子 frame 拒绝、错误跨进程保形、`chat.send` 202 与幂等 |
| F. renderer fold | item/delta 调和、跨 run 排序、快照丢弃过期 overlay |

### 3.2 Python 侧（49 项，约 60–90 秒）

```bash
./venv/Scripts/python.exe -m pytest cores/python/packages/drsai/tests/test_desktop_gateway_surface.py cores/python/packages/drsai/tests/test_desktop_gateway_agent_backend.py -q
```

### 3.3 类型检查（装完依赖后**第一次跑**）

```bash
npm run typecheck --workspace opendrsai-windows-desktop
```

新增文件**已经在两个 tsconfig 的 include 范围内**，不需要额外配置：

| tsconfig | 覆盖 |
|---|---|
| `tsconfig.node.json` | `src/main/**`、`src/preload/**`、`../shared/api/**`、`../shared/main/**`、`electron.vite.workbench.config.*` |
| `tsconfig.web.json` | `../shared/renderer/src/**`（含 `workbench/`） |

> 这条从没跑过。`shared/renderer/src/workbench/` 下的 4 个 `.tsx` 依赖 `react` / `react-markdown` / `remark-gfm`，
> 在当前检出里无法解析。**预期这里可能报错**，报错基本会集中在 JSX 与 react 类型上；
> 主进程与契约层的逻辑已被 59 项测试覆盖，`transcript.ts` 的折叠逻辑也被覆盖，未覆盖的是 JSX 本身。

### 3.4 架构边界

```bash
npm run verify:architecture
```

> 这条**当前是红的，且与本次改动无关**：`windows/src/main/index.ts: Windows must reuse the shared IPC trust boundary`。
> 把新增文件全部 stash 掉后同样失败。它指的是 legacy 的 `index.ts`。

---

## 4. 手动验收清单

对照 [v2-minimal-surface.zh-CN.md](apps/desktop/docs/v2/v2-minimal-surface.zh-CN.md) §1 的 11 项功能。
建议按顺序做，后面几项依赖前面的状态。

| # | 功能 | 操作 | 期望 | 出问题看哪儿 |
|---|---|---|---|---|
| 1 | OIDC 登录 | 左下角「Sign in」 | 浏览器打开 IHEP 登录页；回来后显示姓名与邮箱 | 主进程控制台；复用的是 `shared/main/auth.ts` |
| 2.4 | 个人信息 | 同上 | 姓名 / 邮箱来自 OIDC claims，**不经过任何网关路由** | — |
| 2.5 | 打开工作区 | 左上输入框贴一个目录**绝对路径**，回车 | 出现在下拉里并被选中；同一路径重复打开不产生重复项 | `POST /v1/workspaces` |
| 2.3 | 文件树 | 右栏 | 显示目录树；git 仓库里改动过的文件带颜色与角标；`node_modules` 等被忽略 | `GET /v1/workspaces/{id}/files` |
| 4.1 | 文件预览 | 点右栏一个文本文件 | 下方显示内容、mime、大小 | `GET .../file` |
| 4.1b | 二进制预览 | 点一张图片 | 直接显示图片（`data:` URL） | 同上 |
| 2.1 | 新建会话 | 「Conversations」右侧「New」 | 列表顶部出现「New session」并被选中 | `POST /v1/sessions` |
| **3.1** | **流式聊天** | 输入「用一句话介绍你自己」，回车 | **① 输入框立刻清空 ② 助手气泡出现 ③ 文字逐字增长 ④ 结束后不再闪动** | 见下方 §5 |
| 3.2 | 模型选择 | 底部下拉换一个模型再发一句 | 回复由新模型产生 | `GET /v1/config/model-catalog`；alias 随请求体走 |
| 3.3 | 状态与停止 | 发一句长的，回复中点「Stop」 | 按钮在生成时才出现；点后立即停止，气泡保留已生成部分 | `POST /v1/runs/{id}/cancel` |
| 3.4 | 语音输入 | 点「Dictate」→ 说话 → 再点一次 | 识别结果**追加**到输入框（不覆盖已输入内容） | `POST /v1/audio/transcriptions`；未登录时按钮**不显示** |
| 2.2 | 历史 | 新建第二个会话，再点回第一个 | 完整对话被还原 | `GET .../oaep-snapshot` |
| 2.2b | 重命名 | **双击**会话标题 | 变输入框，回车生效，Esc 取消 | `PATCH /v1/sessions/{id}` |
| 2.2c | 归档 | 悬停会话→「Archive」→切到「Archived」页签 | 从 Active 消失、在 Archived 出现；「Restore」可还原 | 同上 |

### 4.1 三个必须单独确认的行为

这三条是整个设计的核心，普通点点点看不出来：

**① 刷新不丢消息。** 发一句话，**在回复还在生成时**按 `Ctrl+R` 重载窗口。
期望：窗口重载后回复**继续**出现直到完成。
这是 `202 + 事件流` 契约的全部理由——run 的输出不绑定在发起它的那个 HTTP 请求上。
如果这条不成立，说明订阅恢复有问题。

**② 两个窗口看同一会话。** （需要临时改 `workbench.ts` 开第二个窗口，或用 `Ctrl+Shift+I` 的 devtools 观察）
期望：两个窗口内容一致，且 Runtime 侧只有**一条** SSE 连接。

**③ 断开 Runtime 再恢复。** 用方式 B 启动时，把 Python 进程 `Ctrl+C` 掉。
期望：顶部出现「Reconnecting…」黄条；重新启动 Python 后，黄条消失、对话继续，**不需要刷新**。
若变成红条「The live connection stopped」，说明重试预算耗尽（8 次，最长约 10 秒间隔），属正常降级。

---

## 5. 出问题怎么定位

链路一共 13 跳，按下面的顺序**从后往前**排除，通常两三步就能定位。

### 5.1 窗口一直显示「Runtime is not responding」

```bash
curl http://127.0.0.1:28643/v1/runtime
```

- **没响应** → Runtime 没起来。看 Electron 主进程控制台，`onRuntimeLog` 会把 Python 的 stdout/stderr 原样打出来。
- **响应了但 `surface` 不是 `desktop-v2`** → 28643 被别的进程占了。
- **响应正常但窗口仍报错** → 是 401。检查 `$DRSAI_HOME/runtime/instance-token` 是否存在且外壳/Runtime 读的是同一个（方式 B 下两个终端的 `DRSAI_HOME` 必须一致）。

### 5.2 发消息后什么都不发生

按顺序确认：

1. **run 有没有创建** — `curl -H "x-opendrsai-gateway-token: <token>" "http://127.0.0.1:28643/v1/sessions/<sid>/oaep-events?after_sequence=0"`，找 `event.run.created`。
2. **run 有没有跑起来** — 同一份输出里找 `event.run.started` / `status: "running"`。
3. **有没有失败** — 找 `event.run.failed`。**未登录时这是预期结果**（自动测试观察到的转移就是 `queued → running → failed`）。先登录再试。
4. **事件到了但界面没动** — 打开渲染进程 devtools（View → Toggle Developer Tools），在 Console 里跑：

   ```js
   window.drsai.onSessionEvent((e) => console.log(e.kind, e));
   ```

   这会把桥上收到的每个事件打出来。看得到 `snapshot` / `items` / `run` 说明主进程到渲染进程这一跳是通的，
   问题在 React；一个都看不到说明卡在主进程或更靠后端的位置。

   > `window.drsai` 是 workbench 的桥；legacy 用的是 `window.openDrSai`，两者不冲突。

### 5.3 文字整段蹦出来，没有逐字效果

说明 `event.item.delta` 没到，或到了但被折叠规则丢弃。区分方法：在 devtools 里数 `kind: "delta"` 的事件。

- **一条 delta 都没有** → 模型客户端没走流式，或 `event_translator` 没产出 `message.delta`。这在后端。
- **有 delta 但界面不动** → 折叠规则问题，看 [transcript.ts](apps/desktop/shared/renderer/src/workbench/transcript.ts)。
  规则是：item 处于 `running`/`pending` 时取 item 文本与累积 delta 中**更长的那个**；一旦 settled 就取 item 并丢弃 overlay。

### 5.4 高负载下文字"跳字"

**这是设计行为，不是 bug。** 背压队列满（256）时会丢 delta，权威文本在下一个 `items` 事件上补齐——
所以最终文字一定是完整的，只是中间的动画不连续。真正的 bug 是**最终文字缺字**，那要查折叠规则。

### 5.5 改了 Python 但行为没变

```bash
curl -s http://127.0.0.1:28643/v1/runtime | findstr runtime_source_digest
```

digest 是**导入时**算的。重启 Runtime 后这个值必须变；没变就是你改的文件不在这个进程加载的那份代码里。

---

## 6. 回退

新增内容全部是**并列新增**，legacy 一行未改：

```bash
npm run dev --workspace opendrsai-windows-desktop
```

照旧走 legacy（28642 + `index.html` + 约 200 条 `desktop:*` IPC）。两套可以同时开。

工作树里除了 `package.json` 加了三个脚本，其余全是新文件——想整体撤掉，删掉这些路径即可：

```
apps/desktop/shared/api/desktopGateway.ts
apps/desktop/shared/api/desktopBridge.ts
apps/desktop/shared/main/desktopGateway/
apps/desktop/shared/renderer/src/workbench/
apps/desktop/shared/renderer/workbench.html
apps/desktop/shared/test-kit/verify-desktop-surface.mts
apps/desktop/shared/test-kit/run-typescript-test.mjs
apps/desktop/windows/src/main/workbench.ts
apps/desktop/windows/src/preload/workbench.ts
apps/desktop/windows/electron.vite.workbench.config.ts
cores/python/packages/drsai/src/drsai/backend/desktop_gateway/
```

（`_workspace_files.py` 里新增的 `shape` 字段是后端改动，见 [desktop-surface.zh-CN.md](apps/desktop/docs/v2/desktop-surface.zh-CN.md) §6。）

---

## 7. 命令速查

```bash
nvm use 22
```

```bash
cd apps/desktop && npm install
```

```bash
npm run verify:desktop-surface --workspace opendrsai-windows-desktop
```

```bash
npm run typecheck --workspace opendrsai-windows-desktop
```

```bash
npm run dev:workbench --workspace opendrsai-windows-desktop
```

```bash
./venv/Scripts/python.exe -m pytest cores/python/packages/drsai/tests/test_desktop_gateway_surface.py cores/python/packages/drsai/tests/test_desktop_gateway_agent_backend.py -q
```
