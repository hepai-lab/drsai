# OpenDrSai Windows 会话目录与历史加载效率优化方案

## 1. 背景与问题

Windows Desktop 的聊天正文已经采用按会话分片存储，并且正常情况下只水合当前会话；但启动链路仍会读取完整 Desktop 会话目录、订阅所有已打开工作区，并完整分页枚举每个工作区的活跃 Runtime Session。目录事件随后逐条写回 `threads.json` 并推送 Renderer。

这会产生四类问题：

1. 侧栏只显示最近 12 个会话，但 Renderer 先接收并排序数百至数千条目录元数据。
2. 启动时为所有工作区建立 Session Catalog SSE，并完整分页枚举所有活跃会话。
3. Runtime 目录回放通过普通 `updateThread` 写入，可能把历史会话的 `updatedAt` 改为启动时间，使“最近会话”排序失真。
4. 逐 Session 的重复读写和 React 更新使启动成本随历史会话总量线性增长。

## 2. 实现目标

- 启动成本只与当前工作区需要展示的近期会话数量相关，而不与全部历史会话数量相关。
- 默认只返回当前工作区最近 50 个活跃会话元数据；侧栏继续显示最近 12 个。
- 当前选中、置顶或运行中的会话不能因目录窗口上限而消失。
- 只订阅当前工作区的 Runtime Session Catalog；切换工作区时取消旧订阅。
- Runtime Catalog 回放必须保留权威 `created_at` / `updated_at`，数据未变化时不得写盘或通知 Renderer。
- 完整正文只水合当前会话，首屏历史保持 100 项上限，更早历史由 cursor 按需加载。
- “全部会话”、归档和搜索通过显式分页或专用搜索接口获取，不进入启动关键路径。

## 3. 解决方案

### 3.1 有界会话目录

`desktop:list-threads` 增加可选查询参数：工作区路径、返回上限、是否包含归档，以及必须保留的会话 ID。内部管理操作继续使用完整目录，不改变删除、归档、分享等行为。

启动和工作区切换时，Renderer 请求当前工作区最近 50 个活跃会话，并把当前会话作为必须保留项。置顶和运行中会话由目录查询自动保留。

### 3.2 单工作区实时目录

Renderer 仅为当前工作区启动 Runtime Session Catalog 订阅。切换工作区时停止同一窗口原有的工作区目录订阅，再启动新订阅。

Catalog 启动回放只取最近 50 条，不继续请求后续 offset。SSE 在列表请求前建立，用于覆盖回放期间发生的新变化。

### 3.3 权威时间与无变化跳过

增加 Runtime Catalog 专用 upsert：

- 使用 Runtime Session 的 `created_at`、`updated_at`；
- 一次操作同时更新归档状态；
- 除时间戳外的目录字段也完全相同时直接返回，不写文件；
- 不再先 `upsertThreadFromRun` 再执行第二次 `updateThread`。

### 3.4 正文懒加载

保持现有正文分片和当前会话订阅模型：

- 非当前会话不得调用 history sync、snapshot 或 event replay；
- 当前会话首批最多 100 项；
- `history.nextCursor` 存在时才显示并执行“加载更早内容”；
- 切换会话取消过期水合请求。

## 4. 更新模块

- `apps/desktop/shared/api/desktopApi.ts`：目录查询和 Catalog upsert 类型。
- `apps/desktop/shared/main/threads.ts`：有界目录查询、权威时间、无变化写入跳过。
- `apps/desktop/shared/main/runtimeSessionCatalogBootstrap.ts`：有界启动回放。
- `apps/desktop/windows/src/main/index.ts`：当前工作区订阅生命周期及 IPC 校验。
- `apps/desktop/shared/main/preload.ts`：目录查询参数传递。
- `apps/desktop/shared/renderer/src/App.tsx`：工作区就绪后加载近期目录。
- 对应单元、协议和 smoke tests。

## 5. 测试与验收

### 5.1 单元测试

- 1000 个会话中默认只返回最近 50 个。
- 当前、置顶、运行中会话位于窗口外时仍被返回。
- Catalog upsert 保留 Runtime 时间戳。
- 完全相同的 Catalog 事件不写盘。
- Catalog bootstrap 达到上限后不再请求下一页。

### 5.2 集成测试

- 启动只为当前工作区建立一个 Catalog SSE。
- 首次只有一个 `limit=50` 的 Session list 请求；用户未加载更多时没有后续 offset。
- 切换工作区后旧 SSE 被取消，新工作区建立一个 SSE。
- 启动只对当前会话调用 history sync / OAEP snapshot。

### 5.3 性能与正确性验收

- 1 万条历史会话下，启动目录返回数量保持有界。
- 重启前后未变化会话的 `updatedAt` 完全一致。
- 侧栏最新顺序由真实会话更新时间决定，不受启动回放顺序影响。
- 归档、显示全部和正文搜索仍可按需访问历史数据。

## 6. 实施进度

- 第 1 轮：完成代码审计与方案固化，开始有界目录和单工作区订阅实现。
- 第 2 轮：完成当前工作区最近目录、显式分页、归档按需加载、正文单会话懒加载和 Runtime 权威时间戳写入。
- 第 3 轮：完成单工作区 Catalog SSE、50 条启动回放、批量原子写入、保留置顶/运行中会话及跨桌面端类型兼容验证。

## 7. 完成验收记录

- 10,000 条源会话压力用例：目录选择 P95 为 12.4 ms，低于 200 ms 预算。
- 首屏正文分片读取数：0；打开当前会话后的正文分片读取数：1。
- 启动回放：仅 `offset=0&limit=50` 一页；相同回放不改写目录文件。
- 普通、第二页及归档第二页：均保持 50 条上限，页间无重复；当前、置顶、运行中会话得到保护。
- Windows `tsconfig.node.json`、`tsconfig.web.json` 与 macOS 共享代码类型检查通过。
- Windows Electron/Vite 主进程、preload、renderer 生产构建通过。
- 实际开发环境日志确认：当前实现每次只为当前工作区建立一条 Catalog SSE，并请求一次 `limit=50`；切换工作区后转移到新工作区，不再同时订阅全部工作区。
