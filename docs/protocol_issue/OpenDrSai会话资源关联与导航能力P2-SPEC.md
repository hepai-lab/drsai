# SPEC：OpenDrSai 会话资源关联与导航能力 P2

> 文档编号：OAEP-OWOP-CONVERSATION-RESOURCE-P2  
> 状态：Windows 主阶段已验收  
> 版本：1.1  
> 更新日期：2026-08-16  
> 前置版本：[P1：OpenDrSai 会话资源关联与导航能力开发方案](./OpenDrSai会话资源关联与导航能力P1开发方案.md)  
> 适用范围：OpenDrSai Core、OAEP、OWOP、Windows Desktop、TUI、Android、远程 Runtime、DocMaster 等多租户服务端产品；macOS Desktop 延后到独立兼容阶段，不作为本阶段发布阻断项

## 1. 摘要

P1 已经证明“会话中的文件不是一段路径文字，而是可解析、可授权的结构化资源关联”这一方向正确。P2 不推翻 P1，而是把 P1 的兼容实现收紧为长期产品契约：

1. 把资源身份与会话关联彻底分离，允许同一资源在同一消息中以不同关系、位置和展示方式出现；
2. 统一 file、artifact 及未来资源的解析、读取、预览和下载接口；
3. 去除路径、附件数组下标、正则解析和宽松 capability 默认值等临时事实源；
4. 使 Desktop、TUI、Android 和 Web/DocMaster 在能力不同的前提下仍具有一致语义和可预测交互；
5. 补齐版本一致性、原子下载、批量解析、状态失效、审计、多租户隔离和真实交互测试。

P2 的用户结果是：聊天中的资源像普通产品链接一样明显、稳定、可操作；点击后总能得到明确结果——预览、定位、下载、查看状态或可恢复错误——而不是静默无响应、展示内部 ID，或误把远程路径当成本机路径。

## 2. P1 实现复核

### 2.1 总体结论

P1 的架构分层合理，应继续保留：

```text
Composer / Agent / Backend Adapter
              |
              | OAEP：资源与会话内容之间的关联事实
              v
      Resource Association
              |
              | OWOP：当前身份下解析、授权和读取
              v
       Workspace Resource
              |
              | Host：预览、定位、下载、外部打开
              v
  Desktop / TUI / Android / Web
```

当前问题主要不是方向错误，而是 P1 为快速闭环保留了较多兼容桥：`ResourceRef` 同时承担身份和关系、Composer 仍以路径正则恢复结构、Desktop 对不完整描述符做能力猜测、不同端各自解析 OAEP Map。这些桥在本地 Desktop 上可用，但在远程 Linux、多 Runtime、多租户、长历史和资源版本变化场景下不够稳健。

### 2.2 应保留的实现

| 能力 | P1 现状 | P2 决策 |
|---|---|---|
| OAEP 有序 Message Parts | 能保持文字与资源在原文中的顺序 | 保留并强化为严格判别联合类型 |
| OWOP opaque Resource ID | 会话不以绝对路径作为公共身份 | 保留；补充 authority namespace 和 generation/version |
| 点击时重新解析与授权 | ResourceRef 不是永久访问凭据 | 保留为强制业务规则 |
| `moved/changed/deleted` 状态 | 能表达路径和内容变化 | 保留并扩展状态、错误和历史版本行为 |
| Desktop 统一打开入口 | 输入、Artifact、File Change 可复用相同入口 | 保留；改成统一 Host Action Router |
| 远程 Artifact 分块读取 | 不需要把服务器路径交给客户端 | 保留；改成带版本绑定、进度、取消和严格校验的通用流 |
| TUI 不依赖 Electron | 使用 OAEP/OWOP 语义而非 Desktop API | 保留；改用共享 SDK 和 association ID 命令 |
| 多租户请求时授权 | tenant/principal/workspace 参与每次访问 | 保留；补齐审计、对象存储 SPI 和非泄露错误 |
| 跨端共用 fixture | Desktop、TUI、Android、Python 已消费同一快照 | 保留并扩展为正反例矩阵和交互 fixture |

### 2.3 必须完善的部分

| 编号 | 当前实现与风险 | P2 要求 |
|---|---|---|
| GAP-01 | OAEP `ResourceRef` 同时存放 `resource_id`、`relation`、`locator` 和 `presentation`；Android 等端按资源身份去重后会丢掉多个关联位置或关系 | 引入独立 `ResourceKey` 和 `ResourceAssociation`；关联具有稳定 `association_id` |
| GAP-02 | `messagePart.additionalProperties=true`，移动端以 `Map<String, Any?>` 解析 Part | 使用严格判别联合；未知 Part 进入安全的 unsupported 投影，不得任意对象字符串化 |
| GAP-03 | Composer 用 `@file:`/`@folder:` 正则和大小写折叠路径识别内联资源 | 编辑器内部直接维护结构化 Draft Part；大小写敏感远程文件系统不得执行 `toLowerCase()` 路径等价判断 |
| GAP-04 | Draft Part 使用 `attachmentIndex` 指向附件数组，重排、去重或迁移后容易错绑 | Draft Part 直接引用稳定 `association_id` 或 `draft_resource_id` |
| GAP-05 | Desktop Resolver 在缺少 state/capability 时默认 `available`、`read=true`，并从是否有 path 猜测 preview/reveal | 所有 capability 和 state 必须由已校验 Descriptor 显式给出；缺失一律 fail closed |
| GAP-06 | Desktop 只对无 path 的 Artifact 走流式预览；远程 file 有逻辑 path 时可能被误当成本机 Files 路径 | Host Router 必须同时考虑 authority、workspace location 和 capability，不能用“有没有 path”判断本地性 |
| GAP-07 | 本地 file 只有 `preview=true` 才进入文件栏；Office 等可定位但未声明 inline preview 的文件无法获得合理主动作，`reveal/open_external` 也未充分使用 | 主动作按 Host 能力决策：应用内预览、文件栏定位、系统文件管理器定位、受控外部打开或下载 |
| GAP-08 | 资源状态通常在首次点击后才更新，提示集中在聊天顶部的单一 notice | 对视口内资源批量懒解析；状态显示在卡片/Chip 原位，toast 仅补充结果 |
| GAP-09 | 远程下载无进度、取消、恢复；保存前先让用户选路径，失败后才发现无权；覆盖目标时先删除再重命名 | 先解析能力，再显示动作；下载必须支持取消和进度；使用安全原子替换，不得预删除目标文件 |
| GAP-10 | Preview 未与不可变版本绑定；完整内容的 digest 校验和 chunk 一致性契约不足 | Resolve 返回 version token；read/preview/download 均绑定该版本；Artifact 默认不可变 |
| GAP-11 | 文件丢失时按 inode/device 在前台遍历整个 Workspace 搜索移动位置 | 前台解析不得全盘扫描；以 watch/journal 更新索引，修复扫描必须后台、限时、限量 |
| GAP-12 | 同一路径重新注册会复用原 file ID，即使底层已经是另一个对象；inode 重用也可能被误判为移动 | 明确“逻辑文件、版本、替换”的身份规则，引入 generation/tombstone |
| GAP-13 | 多租户参考 Host 在 resolve 后按 path 再 read，存在二次定位和 TOCTOU 窗口；`session_id` 未用于授权和审计 | 增加 read-by-key/version 原子接口；授权上下文必须包含并校验 session/runtime；每次动作写审计 |
| GAP-14 | 服务端 Host 仍可能声明 `reveal=true`，容易把“客户端定位”与“服务器文件管理器定位”混淆 | 非本地 Host 必须固定 `reveal=false`；Web 只提供 preview/download/copy logical name |
| GAP-15 | Desktop、TUI、Android 各自遍历 OAEP Parts/Changes/Refs，校验和去重语义已出现差异 | 建立共享 conformance SDK 和生成类型；Host 只消费统一投影 |
| GAP-16 | P1 UI 验证包含源码正则断言，Android 资源卡仅展示但不可点击，共享 fixture 缺少负向状态 | P2 必须增加真实组件交互、打包态资源点击、移动端点击下载、多租户攻击和故障恢复测试 |
| GAP-17 | 会话快照仍持久化 `ChatAttachment.path`，Tooltip 也可能显示 host 路径；locator/operation_id 在部分投影中丢失 | 新写入快照不保存物理绝对路径；完整保留 association/locator；Host path 只能存在于受控本地瞬时状态 |
| GAP-18 | `files.resolve` 与 `artifact.metadata/chunk` 是两套资源访问表面，UI 按类型分支 | 新增通用 `resources.*` 操作，旧操作只保留兼容适配 |

### 2.4 需要移除或停止扩散的部分

以下内容不得继续成为 P2 新数据或新代码的事实源；“移除”采用先停止写入、双读迁移、最后删除兼容代码的方式，不直接破坏 P1 历史：

1. **停止写入会话级物理绝对路径。** `ChatAttachment.path` 仅可作为本地 Composer 提交前的瞬时 Host 数据；OAEP、历史快照、日志和跨设备接口不得持久化它。
2. **停止用 `attachmentIndex` 作为跨层引用。** 改用稳定 Part/Association ID。
3. **停止用正则解析后的 `@file:` 文本作为结构化事实。** 正则只用于导入旧草稿；新 Composer 直接产生结构化节点。
4. **停止把 `relation/locator/presentation` 当成 Resource identity 的字段。** P1 `ResourceRef` 保留只读兼容，P2 新写入使用 `ResourceAssociation`。
5. **停止 capability/state 的宽松回退。** 未声明或未通过 Schema 校验时所有动作均不可用。
6. **停止 `part.path -> 直接打开` 的新写入路径。** 有 Resource Association 时必须经过 Resolver；无关联的旧路径先进行受控注册，失败则只显示文本。
7. **停止前台 inode 全 Workspace 扫描。** 仅允许后台修复任务使用有上限的扫描。
8. **停止下载时 `rm(destination) -> rename(partial)`。** 采用同目录临时文件、完整校验和平台安全替换；替换失败时保留原文件。
9. **停止在每个客户端手写 OAEP Resource Map 解析器。** 统一使用生成类型和共享投影测试。
10. **停止把 `TenantFilesystemResourceHost` 视为服务端生产存储实现。** 它保留为 conformance/reference adapter；DocMaster 使用 ResourceHost SPI 接对象存储和数据库索引。

## 3. P2 目标

### 3.1 功能目标

- G-01：同一资源可在一条消息中出现多次，每次具有独立关系、位置、展示提示和点击焦点。
- G-02：实时消息、历史快照、断线重放、跨设备和 Backend Adapter 生成完全相同的 Association 语义。
- G-03：本地文件、远程文件、Runtime Artifact 和服务端对象存储成果使用同一个 Host Action Router。
- G-04：Desktop 输入资源呈现为明确的可点击 Chip；输出 Artifact 和 File Change 使用可预测的卡片/活动入口。
- G-05：移动、变化、删除、无权、离线和不支持状态具有原位反馈及明确恢复动作。
- G-06：Desktop 支持应用内预览、文件栏定位、系统文件管理器定位、另存为和受控外部打开。
- G-07：TUI 支持 info/open/download/copy-logical-path，且不依赖物理路径或 Electron。
- G-08：Android 支持点击资源、预览或保存到系统文档目录，并显示进度、取消和离线状态。
- G-09：DocMaster 等多租户 Host 支持 Web 预览、流式下载、对象存储和不可泄露的授权错误。
- G-10：资源解析与状态刷新可批量、可缓存、可失效，不因 Workspace 规模线性退化。

### 3.2 可衡量目标

- 新产生的 OAEP 用户消息中，结构化资源覆盖率为 100%，不得仅以路径文本代替。
- 所有资源动作 100% 经过当前 principal/session/workspace/authority 的重新授权。
- P2 新写入的 OAEP、日志、错误和跨设备快照中 Host 绝对路径泄露数为 0。
- 视口内 100 个 Resource Association 的批量解析在本地 P95 不超过 150 ms，远程健康网络 P95 不超过 800 ms。
- 点击已缓存、可用的本地资源到文件栏选中反馈 P95 不超过 150 ms。
- 远程预览首屏在 20 Mbps、RTT 100 ms 条件下 P95 不超过 2 s。
- 10,000 条消息、2,000 个资源关联的历史会话滚动和恢复不产生全量同步解析或明显主线程阻塞。

## 4. 非目标

P2 明确不做以下事项：

- 不在本阶段完成或验收 macOS Desktop 打包应用；macOS 复用公共协议和 Host Router 的适配、打包与平台回归另行实施；
- 不把 OpenDrSai 建设成通用云盘、文件同步或版本控制产品；
- 不自动把聊天文本中看似路径的字符串转成可信链接；
- 不在 OAEP 中存储永久下载 URL、对象存储 key、服务器绝对路径或 bearer token；
- 不保证所有历史资源都永久保留字节内容；保留策略由 Workspace/Artifact Policy 决定；
- 不实现 Office、PDF、CAD 等所有格式的在线编辑器；P2 只定义安全预览/派生预览接口；
- 不允许模型通过拼接 Resource ID 或 path 绕过 Host 授权；
- 不把 citation、knowledge document、Web URL 强行伪装为 Workspace file；不同 resolver namespace 仍可共用 Association 外形；
- 不允许服务端触发服务器 GUI 文件管理器或把 `reveal` 映射为服务器路径操作；
- 不在 P2 删除 P1 历史读取能力；删除旧写入和兼容代码必须满足迁移门禁。

## 5. 参与者与典型场景

### 5.1 参与者

- 用户：引用、查看、下载或定位资源；
- Composer：生成有序 Draft Parts 和 Resource Association；
- Agent/Backend Adapter：读取输入资源、产生 File Change、Citation 和 Artifact；
- Runtime Resource Service：注册、解析、版本化和读取资源；
- Host Action Router：把通用动作映射到 Desktop/TUI/Android/Web 能力；
- Workspace/Artifact Store：保存文件事实、对象版本和保留策略；
- Authorization/Audit Service：做请求时授权和安全审计。

### 5.2 核心场景

1. 用户从右侧文件栏把 `docs/方案.md` 插入句中，发送后仍保持“文字—资源—文字”的顺序；
2. 用户刷新或换到 Android，看到同一个资源 Chip，点击后可预览或下载；
3. 文件重命名后，历史 Chip 显示“已移动”，点击打开新位置；
4. 文件内容变化后，显示“已变化”，默认打开当前版本，并在有快照时提供“查看引用时版本”；
5. Agent 输出远程 DOCX Artifact，Desktop/Web 可安全预览派生 PDF 或下载原文件；
6. File Change 活动中的文件可直接定位，但不会自动把所有修改都标成最终成果；
7. 租户 B 持有租户 A 的 Resource Key 时，只得到不可区分的 `resource_not_found`，没有存在性泄露；
8. Runtime 离线时，卡片显示离线和重试/切换 Runtime 操作，不把资源误判为删除。

## 6. 输入与输出

### 6.1 输入

| 输入编号 | 来源 | 必需字段 | 说明 |
|---|---|---|---|
| IN-01 | Desktop/Android/Web Composer | draft part、Host attachment handle、目标 Workspace | Host handle 仅在提交期有效，不进入 OAEP |
| IN-02 | 文件栏/拖放/系统 Picker | 本地或远程选择结果、显示名、类型 | 必须先在当前 Workspace authority 注册 |
| IN-03 | Backend Adapter | Backend attachment identity、原始顺序、可选 locator | Adapter 转成公共 Association，不透传私有绝对路径 |
| IN-04 | Agent 工具 | Workspace 操作结果、resource key、operation id | 用于 File Change 和 derived_from 关系 |
| IN-05 | Artifact Publisher | immutable artifact id、version、size、digest、mime、保留策略 | Artifact 发布成功后才可进入最终结果 |
| IN-06 | P1 历史 | `resource_ref`、attachments、draftParts | 通过兼容迁移器生成 P2 Association，不修改原始事件 |
| IN-07 | 点击动作 | association id、action、当前 Host Context | 不接受 Renderer 直接提交物理 path |

### 6.2 输出

| 输出编号 | 输出 | 消费者 |
|---|---|---|
| OUT-01 | OAEP `ResourceAssociation` 和严格 Message Part | 历史、实时流、Adapter、所有客户端 |
| OUT-02 | OWOP `ResourceDescriptor` | Host Action Router、状态卡片 |
| OUT-03 | Preview/Download/Reveal Action Result | Desktop、TUI、Android、Web |
| OUT-04 | 资源状态变更事件和 cache invalidation | 可见卡片、Files panel、恢复流程 |
| OUT-05 | 脱敏审计事件 | 安全审计、诊断、管理员 |
| OUT-06 | 用户可理解的原位状态和恢复动作 | 最终 UI/TUI |

## 7. 领域模型与数据结构

### 7.1 ResourceKey

`ResourceKey` 只表达身份，不表达会话关系、显示方式或授权能力。

```json
{
  "protocol": "owop/1",
  "authority_id": "runtime-local-01",
  "workspace_id": "workspace-123",
  "resource_type": "file",
  "resource_id": "file-456",
  "generation": 3
}
```

约束：

- `authority_id` 是稳定、非秘密的 resolver namespace，不是 endpoint、tenant id 或访问凭据；
- P1 记录没有 `authority_id` 时，只能从所属 Session 的权威 Runtime binding 推导，不得从当前 UI 随意猜测；
- `generation` 用于区分删除后同路径创建的新对象；内容修改不增加 generation，只增加 version；
- `resource_id` 在 `authority_id + workspace_id + resource_type` 范围内唯一；
- ResourceKey 不包含 path、label、digest、relation、locator、presentation 或 capability。

### 7.2 ResourceAssociation

```json
{
  "association_id": "assoc-message-1-part-2",
  "resource": {
    "protocol": "owop/1",
    "authority_id": "runtime-local-01",
    "workspace_id": "workspace-123",
    "resource_type": "file",
    "resource_id": "file-456",
    "generation": 3
  },
  "relation": "input_reference",
  "label_snapshot": "方案.md",
  "version_snapshot": {
    "version_id": "version-8",
    "digest": "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    "size": 4281,
    "mime_type": "text/markdown",
    "captured_at": "2026-08-16T00:00:00Z"
  },
  "locator": {
    "kind": "text_range",
    "line": 42,
    "column": 1,
    "end_line": 48,
    "end_column": 20
  },
  "presentation": "inline"
}
```

约束：

- `association_id` 在一个 Session 内稳定唯一，并在实时、Snapshot、Replay 和跨设备中保持不变；
- `relation` 对 P2 新写入为必填；
- 同一 ResourceKey 可对应任意多个 Association，不得按 ResourceKey 去重后丢失位置或关系；
- Association 规范存放在 OAEP Item 顶层的 `associations[]`；Message Part、File Change entry、Citation 或 Artifact content 只通过 `association_id` 关联它，不在多个位置复制完整对象；
- `label_snapshot` 是会话发生时的安全显示名，不是当前事实；当前名称来自 Resolve；
- `version_snapshot` 是历史观察值，不是授权凭据；digest 统一使用带 `sha256:` 前缀的规范形式；
- `locator` 使用严格 `oneOf`，每种 kind 只允许自己的必需字段；
- `presentation` 只是布局提示，不得声明 preview/download/reveal 权限。

### 7.3 严格 Message Part

P2 新写入采用判别联合。以下为一个 Item 的关键字段节选：

```json
{
  "associations": [
    {
      "association_id": "assoc-1",
      "resource": {
        "protocol": "owop/1",
        "authority_id": "runtime-local-01",
        "workspace_id": "workspace-123",
        "resource_type": "file",
        "resource_id": "file-456",
        "generation": 3
      },
      "relation": "input_reference",
      "label_snapshot": "方案.md",
      "presentation": "inline"
    }
  ],
  "content": {
    "parts": [
      {"part_id": "part-1", "type": "text", "text": "参考 "},
      {"part_id": "part-2", "type": "resource", "association_id": "assoc-1"},
      {"part_id": "part-3", "type": "text", "text": " 开始执行"}
    ]
  }
}
```

每个 Part 都有稳定 `part_id`。`type=resource` 直接引用 Association，不引用附件数组下标。P1 的 `type=resource_ref` 和 `attachmentIndex` 只由兼容层读取。

### 7.4 ResourceDescriptor

```json
{
  "resource": {
    "protocol": "owop/1",
    "authority_id": "runtime-local-01",
    "workspace_id": "workspace-123",
    "resource_type": "file",
    "resource_id": "file-456",
    "generation": 3
  },
  "resolution_id": "resolution-789",
  "state": "changed",
  "display_name": "最终方案.md",
  "logical_path": "docs/最终方案.md",
  "kind": "file",
  "current_version": {
    "version_id": "version-9",
    "digest": "sha256:abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd",
    "size": 5021,
    "mime_type": "text/markdown",
    "modified_at": "2026-08-16T01:00:00Z"
  },
  "observed_version": {"version_id": "version-8"},
  "capabilities": {
    "read_current": true,
    "read_snapshot": true,
    "preview": true,
    "download": true,
    "reveal": true,
    "open_external": false,
    "copy_logical_path": true
  },
  "preview": {
    "kinds": ["markdown", "text"],
    "preferred": "markdown",
    "max_inline_bytes": 1048576
  }
}
```

规则：

- Descriptor 必须通过 Schema 才能进入 Renderer；
- capability 字段全部必填，缺失时整个 capability 集合视为 false；
- `logical_path` 只能是 Workspace 相对路径；远程服务可不返回；
- `resolution_id` 绑定 principal/session/authority/resource/version，短期有效，但仍不是永久授权；每个动作仍重新授权；
- `state` 成功值为 `available | moved | changed | deleted | offline | unsupported`；权限和输入错误使用错误响应，不伪装为 available；
- 对无权主体，外部统一返回 `resource_not_found`；只有已经拥有可审计关联且策略允许时，才可区分 `forbidden`。

### 7.5 统一 OWOP Resource 接口

P2 在 OWOP 1.x envelope 内新增 capability profile `resources.v2`：

| Operation | 输入 | 输出 | 说明 |
|---|---|---|---|
| `resources.register` | Host attachment handle/path locator、expected digest、idempotency key | ResourceKey、初始 version | 只允许受信 Host/Runtime 调用 |
| `resources.resolve_batch` | 最多 100 个 ResourceKey/Association observation | 对应 Descriptor 或逐项安全错误 | 视口状态和历史恢复的标准入口 |
| `resources.read` | ResourceKey、version id、offset、length、purpose | bytes、offset、eof、version id、chunk digest | file/artifact 通用，单块上限 8 MiB |
| `resources.preview` | ResourceKey、version、接受的 preview kinds、尺寸限制 | inline preview 或短期 preview handle | Office/PDF 可返回隔离转换后的 rendition |
| `resources.download.prepare` | ResourceKey、version、建议文件名 | download id、总大小、digest、transport、expiry | transport 可为 OWOP chunks 或当前主体绑定的短期 HTTPS |
| `resources.download.chunk` | download id、offset、length | chunk、eof、chunk digest | 支持取消和可选续传 |
| `resources.download.cancel` | download id | cancelled | 释放服务器和客户端资源 |
| `resources.subscribe` | workspace、after sequence、可选 resource ids | 状态/版本变更事件 | 驱动 cache invalidation |

兼容映射：

- `files.register/resolve/read` 和 `artifact.metadata/chunk` 继续可读；
- 新 Runtime 内部统一映射到 Resource Service；
- P2 新客户端优先协商 `resources.v2`，能力缺失时使用 P1 adapter；
- P1 adapter 不得合成未声明的 capability。

### 7.6 Host Action API

Renderer 只能提交：

```ts
type ConversationResourceActionRequest = {
  sessionId: string;
  associationId: string;
  action: "primary" | "preview" | "reveal" | "open_external" | "download" | "copy_logical_path" | "open_snapshot";
  expectedResolutionId?: string;
};
```

Host Action Router 负责：从 `sessionId + associationId` 读取 Association、选择 authority、批量/单项 Resolve、重新授权、执行动作并返回结构化结果。Renderer 不得提交资源物理 path；下载目的地只能由 Host 原生 Picker 或 TUI 用户显式参数产生，并作为动作执行期的 Host 私有参数使用。

## 8. 功能行为与业务规则

### 8.1 通用规则

- BR-001：结构化 Association 是唯一事实源；Markdown/path 文本不自动获得资源权限。
- BR-002：ResourceKey 标识资源，Association 标识“这段会话为何、在哪里引用资源”。
- BR-003：所有资源动作在执行时重新校验 authority、tenant、principal、session、workspace、generation 和 version。
- BR-004：capability 只用于展示动作，不能替代动作时授权。
- BR-005：未知 state、未知 capability、Schema 不完整或未知 resource type 均 fail closed，并展示“不支持/暂不可用”。
- BR-006：消息 Part 顺序在 Composer、OAEP、Backend input、Snapshot 和 UI 中必须完全一致。
- BR-007：同一资源的多个 Association 必须全部保留；只允许按 `association_id` 去重重放事件。
- BR-008：内容修改保留 ResourceKey、增加 version；明确删除后创建的新对象使用新 generation，旧关联保持 deleted/tombstone。
- BR-009：Artifact 发布后默认不可变；如需新版本，创建新 version，并保留 lineage。
- BR-010：文件 moved 时自动解析当前逻辑路径；changed 时默认打开当前版本，并明确提示与引用版本不同。
- BR-011：若 retained snapshot 可读，changed/deleted 卡片提供“查看引用时版本”；没有快照时不得伪造。
- BR-012：Runtime offline 与 resource deleted 必须区分；离线状态允许重试、切换 Runtime 或稍后操作。
- BR-013：远程逻辑 path 不得传给本地文件系统 API；本地性由 authority/Workspace binding 决定。
- BR-014：目录资源可定位和浏览，但不能当普通文件读取或下载；服务端可按策略提供归档导出，P2 默认不提供。
- BR-015：关联标签按当前名称显示，旁边可查看“引用时名称”；不得让恶意文件名注入 Markdown/HTML。
- BR-016：资源注册和 Artifact 发布必须幂等；同一 idempotency key 不产生重复 ResourceKey。
- BR-017：用户取消预览/下载后必须终止后续读取，删除 partial 文件，并保留原目标文件。
- BR-018：下载完整性失败不得暴露损坏文件；错误允许安全重试。
- BR-019：所有错误映射为稳定 code + 本地化用户文案 + 可选 recovery actions；UI 不直接显示内部异常字符串。
- BR-020：资源解析日志不得记录物理 path、对象 key、临时 URL、token 或未经清洗的文件内容。
- BR-021：跨端不认识 locator/presentation 时仍可打开资源本身；不得因展示增强字段阻断基本操作。
- BR-022：P1 兼容路径只读，不允许被再次序列化成新的 P1-only 记录。

### 8.2 主动作决策

用户单击资源时，Host 按以下顺序选择主动作：

1. 当前 Host 支持安全应用内 preview：打开预览，并在文件栏/资源面板中选中；
2. 无 inline preview，但本地 Desktop 支持 reveal：在应用文件栏选中，提供“在系统文件管理器中显示”；
3. 远程/Web/Mobile 支持 download：打开资源详情并提供下载，不自动开始大文件下载；
4. 仅支持 `open_external`：显示确认后受控打开；
5. 无可用动作：显示原位状态、原因和恢复操作。

主动作不应直接猜测。用户可通过右键、长按或 TUI 子命令显式选择其他 capability。

### 8.3 Desktop 行为

- 输入资源 Chip 使用主题链接色、文件类型图标和可见 focus ring；不是普通 Markdown 文本；
- 单击后立即进入 loading 状态，避免重复触发；成功后在右侧 Files/Resource panel 选中并预览或显示元数据；
- 右键菜单至少包含：在文件栏显示、在系统文件管理器中显示、预览、打开引用时版本、下载/另存为、复制逻辑路径、查看资源详情；仅显示已授权动作；
- moved/changed/deleted/offline 状态在 Chip/Card 原位显示，toast 只报告动作结果；
- 本地 Office 文件即使不能 inline preview，也必须可在文件栏选中和 reveal，不能只显示“宿主不支持预览”；
- 远程 file 与 artifact 均可走通用 preview/download，不以 `path` 是否存在分支；
- 下载先 Resolve，再打开 Save Dialog；显示进度、速度、取消和完成后的“在文件夹中显示”；
- 多个同名资源显示 Workspace/来源提示，但默认不展示完整路径；
- 键盘：Tab 可聚焦，Enter 执行主动作，Shift+F10 打开动作菜单，Esc 取消 loading/menu；
- 屏幕阅读器读出资源名、类型、状态和主动作。

### 8.4 TUI 行为

- Transcript 显示可读 label、relation 和状态，不把 opaque ID 当主文案；
- 标准命令为：`/resource info <association_id>`、`/resource open <association_id>`、`/resource download <association_id> <destination>`、`/resource copy-path <association_id>`；
- 旧 `/resource <resource_id>` 和 `/artifact <artifact_id>` 保留一个迁移周期，执行时必须绑定当前 Session/Workspace，不得全局猜测；
- 终端支持 OSC 8 且 opener 安全时可渲染链接，否则显示命令提示；
- 远程 preview 可分页输出安全文本；二进制只显示元数据和下载命令；
- 错误输出不包含服务器 path，并提供重试或切换 Workspace 提示。

### 8.5 Android 行为

- Resource Chip 必须可点击，而不是仅显示 label；
- 点击打开 bottom sheet：名称、类型、大小、状态、来源、preview/download/open snapshot 动作；
- 下载使用系统 Storage Access Framework，显示通知/页面进度并可取消；
- 小型安全预览可在应用内显示；Office/PDF 优先使用 Runtime rendition；
- 离线时显示缓存元数据，只有用户明确保存过且策略允许时才使用本地缓存内容；
- Android 不接收或持久化 Desktop 绝对路径。

### 8.6 Web/DocMaster 行为

- 资源由 tenant-scoped ResourceHost SPI 解析到对象存储或文件存储；
- Web preview 使用隔离 origin、严格 CSP、MIME sniffing 和 Content-Disposition；
- 下载 URL 只能在动作响应中短期产生，绑定 principal/resource/version，默认有效期不超过 5 分钟；不得进入 OAEP、日志或剪贴板自动复制；
- 服务端 capability 中 `reveal/open_external` 固定为 false；
- 无权和不存在默认返回相同外部错误；管理员审计可区分内部原因；
- ResourceHost SPI 必须支持对象存储、数据库索引、版本 token、审计回调和配额，不依赖本机 inode。

## 9. 状态、边界条件与异常处理

### 9.1 状态与用户行为

| 状态/错误 | 业务含义 | 用户行为 |
|---|---|---|
| `available` | 当前版本与观察版本一致 | 正常主动作 |
| `moved` | 同一 generation 的逻辑位置变化 | 打开新位置，显示“已移动” |
| `changed` | 当前 version 与 Association snapshot 不同 | 打开当前版并警告；有权限时可打开引用版 |
| `deleted` | 资源 tombstone 仍可确认 | 禁用当前版；如有 retained snapshot 则允许查看 |
| `offline` | authority 暂不可达 | 原位显示离线、重试、切换 Runtime |
| `unsupported` | Host 或 Resource Service 不支持该类型/动作 | 保留 label 和详情，隐藏不支持动作 |
| `resource_not_found` | 不存在、跨租户或不允许泄露存在性 | 统一“不存在或无权访问” |
| `workspace_mismatch` | 当前 Session/Workspace 不匹配 | 提示切换到关联 Workspace，不自动越权切换 |
| `resource_version_conflict` | 动作开始前版本变化 | 刷新状态，询问当前版/引用版 |
| `preview_unsupported` | 可读但无安全预览 | 提供下载、reveal 或元数据 |
| `resource_too_large` | 超过 Host 策略或用户配额 | 显示大小和限制，不启动读取 |
| `integrity_mismatch` | chunk/完整 digest 不符 | 删除 partial，记录安全诊断，允许重试 |
| `rate_limited` | 超过读取/解析配额 | 显示退避时间，自动或手动重试 |
| `action_cancelled` | 用户取消 | 安静结束，清理临时资源 |

### 9.2 必须处理的边界条件

- 0 字节文件、未知大小流、超过 2 GiB 文件；
- Unicode、组合字符、emoji、双向文本和超长文件名；
- Windows 大小写不敏感与 Linux 大小写敏感 Workspace；
- 同名不同 ResourceKey、同 ResourceKey 多 Association；
- 文件在 resolve 与 read 之间发生替换、移动、权限撤销或版本切换；
- 原子保存导致 inode 改变但逻辑文件仍连续，以及 delete+create 确实是新对象；
- Runtime 重启、authority id 迁移、Session 恢复和 relay 重连；
- locator 超界、页码/行号不存在、客户端不支持 locator；
- 部分 chunk、重复 chunk、乱序 chunk、错误 eof、非法 Base64、压缩炸弹；
- 恶意 SVG/HTML/PDF/Office、错误 MIME、外链资源、宏和嵌入对象；
- 目录、symlink、junction、hardlink、挂载点和 Workspace root 被替换；
- 下载目标已存在、只读、磁盘已满、跨卷移动失败、杀进程后 partial 恢复；
- 一个消息超过 100 Parts、一个视口超过 100 Association、历史超过 2,000 Association；
- 旧 P1 ResourceRef 缺少 authority、relation、digest 或 locator；
- 当前 Host 不支持某 action，但另一个 Host 支持；
- 租户、组织、principal、session 或 workspace 任一绑定变化。

## 10. 非功能要求

### 10.1 性能与可扩展性

- NFR-PERF-01：`resolve_batch` 最大 100 项；本地 P95 ≤ 150 ms，远程健康网络 P95 ≤ 800 ms；
- NFR-PERF-02：资源状态按视口懒加载，禁止打开会话时解析全部历史；
- NFR-PERF-03：Descriptor cache 默认 TTL 30 s；收到 watch event、切换 principal/Workspace/authority 或动作失败时立即失效；
- NFR-PERF-04：前台 Resolve 的复杂度应为 O(log N) 或摊销 O(1)，不得使用 Workspace 全盘扫描；
- NFR-PERF-05：Preview inline 上限默认 1 MiB；更大内容使用分页、range 或 rendition；
- NFR-PERF-06：Download chunk 建议 1 MiB，可在 64 KiB–8 MiB 协商；并发下载默认每用户 3 个、每 Workspace 10 个；
- NFR-PERF-07：长会话使用虚拟化和 Association-level memoization，滚动不触发重复解析风暴；
- NFR-PERF-08：Resource index 支持至少 1,000,000 条记录，按 authority/workspace/resource key 建复合索引；
- NFR-PERF-09：后台重定位修复任务单次最长 2 s、最多扫描 10,000 项，可续跑，不阻塞点击。

### 10.2 安全与隐私

- NFR-SEC-01：ResourceKey/Association 不是访问凭据；所有动作重新授权；
- NFR-SEC-02：授权至少绑定 tenant、principal、session、authority、workspace、resource、action；
- NFR-SEC-03：跨租户错误不泄露存在性、名称、大小、版本或 timing 差异；
- NFR-SEC-04：OAEP、历史、遥测、崩溃报告和用户错误中不得出现 Host 绝对路径、对象 key、临时 URL 或 token；
- NFR-SEC-05：路径注册拒绝 traversal、UNC 越界、symlink/junction/reparse point 和 root identity 变化；
- NFR-SEC-06：read-by-key/version 在服务端完成原子版本检查，避免 resolve-path-read TOCTOU；
- NFR-SEC-07：Preview 必须 sandbox；HTML/SVG 禁止脚本和外链，Office/PDF 转换在隔离进程中执行；
- NFR-SEC-08：下载严格校验 Base64、offset、length、eof、chunk digest 和最终 digest；
- NFR-SEC-09：临时文件权限最小化，取消/失败/崩溃后可清理；替换失败不损坏原目标；
- NFR-SEC-10：每次 resolve/read/preview/download/reveal 记录脱敏审计，包含 correlation id 和结果 code，不记录内容；
- NFR-SEC-11：短期 URL 只经 TLS，绑定版本和主体，单次或短期有效，可撤销；
- NFR-SEC-12：文件名、label、locator 和 MIME 均视为不可信输入，进入 UI 前转义和限长。

### 10.3 可靠性与兼容性

- NFR-REL-01：注册、发布和状态事件具备 idempotency/dedupe key；
- NFR-REL-02：实时、Replay、Snapshot、重启恢复的 Association digest 一致；
- NFR-REL-03：下载支持取消；超过 100 MiB 时应支持续传，续传必须绑定同一 version；
- NFR-REL-04：Runtime/relay 断线不把资源标记 deleted；
- NFR-REL-05：P1 历史在至少两个正式发布周期内可读；P2 新写入不得降级成 P1-only；
- NFR-REL-06：未知可选字段向后兼容，未知必需语义 fail closed；
- NFR-REL-07：所有客户端共用同一 Schema fixture 和 conformance vector。

### 10.4 可访问性与国际化

- 所有可操作资源满足键盘操作、可见 focus、屏幕阅读器名称和状态描述；
- 颜色不能成为状态唯一表达；
- 用户文案本地化，内部 error code 不直接作为主提示；
- 文件名按 Unicode 安全显示，双向文本必须隔离；
- TUI 在无颜色、窄终端和屏幕阅读器模式下仍可理解。

## 11. 验收标准

### 11.1 协议与模型

- AC-PROTO-01：P2 OAEP Schema 明确分离 ResourceKey 与 ResourceAssociation，relation 对新 Association 必填；
- AC-PROTO-02：Message Part 为严格判别联合，非法字段组合被拒绝；
- AC-PROTO-03：同一 ResourceKey 的两个 Association 在所有投影中都保留；
- AC-PROTO-04：locator、operation id、version snapshot 在实时和历史中无损；
- AC-PROTO-05：P1 fixture 可由迁移器稳定投影到 P2，重复执行结果相同；
- AC-PROTO-06：`resources.v2` codegen 在 TypeScript、Python、Kotlin 全部无漂移。

### 11.2 Runtime 与安全

- AC-RUNTIME-01：注册、批量解析、版本读取、preview、download 和 subscribe 全链闭合；
- AC-RUNTIME-02：前台 resolve 不执行全盘扫描；
- AC-RUNTIME-03：替换、移动、删除和 inode 重用符合 generation/version 规则；
- AC-RUNTIME-04：跨租户、跨 Workspace、跨 authority 访问被拒绝且不泄露存在性；
- AC-RUNTIME-05：resolve 与 read 间内容变化返回 version conflict，不读取错误版本；
- AC-RUNTIME-06：失败下载不覆盖旧目标、不保留可见损坏文件；
- AC-RUNTIME-07：审计记录完整且不含物理 path、对象 key 或 token。

### 11.3 Desktop 易用性

- AC-DESKTOP-01：输入资源按原文顺序显示为可点击 Chip，实时、刷新和重启后一致；
- AC-DESKTOP-02：本地可预览文件单击后 150 ms P95 内在 Files panel 选中并开始预览；
- AC-DESKTOP-03：本地不可预览 Office/二进制仍可选中、reveal 或另存，不显示误导性死路；
- AC-DESKTOP-04：远程 file/artifact 都可通过通用 Router 预览或下载，不调用本地 path API；
- AC-DESKTOP-05：moved/changed/deleted/offline 在资源原位显示且有正确恢复动作；
- AC-DESKTOP-06：下载显示进度和取消；完整性失败时用户看不到损坏文件；
- AC-DESKTOP-07：所有资源动作支持键盘和屏幕阅读器；
- AC-DESKTOP-08：Windows 打包态真实 main/preload/IPC 资源点击 E2E 通过；macOS 留待独立兼容阶段。

### 11.4 TUI、Android 与 DocMaster

- AC-TUI-01：TUI 使用 association id 执行 info/open/download，不依赖 Electron 或绝对路径；
- AC-TUI-02：无 opener、远程二进制、离线和无权状态输出明确命令与恢复提示；
- AC-ANDROID-01：Android 资源 Chip 可点击，能够预览或通过系统 Picker 下载，并支持取消；
- AC-ANDROID-02：Android 离线/恢复和 Runtime 重连不丢 Association；
- AC-WEB-01：DocMaster 对象存储 Host 通过同一 conformance suite；
- AC-WEB-02：跨租户引用、临时 URL 过期、撤权和下载并发限制测试通过；
- AC-XHOST-01：Desktop、TUI、Android、Python/Web 对同一 fixture 产生相同 Association 集合和状态语义。

## 12. 测试案例

| ID | 场景与输入 | 预期结果 |
|---|---|---|
| TC-001 | Message Parts 为 text/resource/text | 五条链路均保持原顺序和 part id |
| TC-002 | 同一文件在一句话中引用两次，locator 不同 | 生成两个 association id，不被 identity 去重 |
| TC-003 | 同一文件同时为 citation 和 output artifact 来源 | 两个 relation 均保留，动作指向同一 ResourceKey |
| TC-004 | P2 ResourceKey 携带 path 或 capability | Schema 拒绝 |
| TC-005 | Message Part 含未知必需类型 | 安全 unsupported 投影，不 stringify 对象 |
| TC-006 | P1 ResourceRef 缺少 authority | 从 Session binding 迁移；无法唯一推导时显示 unsupported |
| TC-007 | Windows 本地文件名大小写变化 | 根据 Host 规则解析，不以跨平台 lowercase 逻辑误绑 |
| TC-008 | Linux 同目录存在 `Plan.md` 和 `plan.md` | 注册为不同 ResourceKey |
| TC-009 | 文件 rename | ResourceKey/generation 不变，state=moved，logical path 更新 |
| TC-010 | 文件内容修改 | ResourceKey 不变，version 增加，state=changed |
| TC-011 | 文件 delete 后创建同名新文件 | 旧 key 为 deleted，新文件 generation/key 不同 |
| TC-012 | inode 被系统复用 | 不得把新文件误判为旧文件 moved |
| TC-013 | resolve 后、read 前文件变化 | 返回 resource_version_conflict，不返回混合内容 |
| TC-014 | Artifact 内容在发布后尝试变化 | 服务端拒绝或创建新 version，旧 version 仍可校验 |
| TC-015 | Descriptor 缺少 capabilities | 客户端所有动作禁用并记录协议诊断 |
| TC-016 | Descriptor 未知 state | 显示 unsupported，不默认 available |
| TC-017 | 远程 file 返回 logical path | Desktop 使用远程 preview/read，不调用本地 Files API 读取该 path |
| TC-018 | 本地 DOCX 无 inline preview、可 reveal | 主动作选中文件，菜单提供系统定位/受控打开 |
| TC-019 | changed 且 retained snapshot 可用 | 显示当前版与引用版两个明确动作 |
| TC-020 | deleted 且无 snapshot | Chip 禁用当前打开，保留名称和删除状态 |
| TC-021 | authority offline | 显示离线与重试，不显示 deleted |
| TC-022 | 用户无权但资源存在 | 外部响应与不存在完全相同，不泄露 metadata |
| TC-023 | 租户 B 使用租户 A 的 ResourceKey | resource_not_found，审计记录 cross-tenant denial |
| TC-024 | 100 个视口资源批量解析 | 一次 batch，满足 P95，不发 100 个独立请求 |
| TC-025 | 2,000 个历史关联打开会话 | 仅解析视口项，无全量扫描或明显主线程阻塞 |
| TC-026 | Remote Markdown 小于 1 MiB | 2 s P95 内预览，完整内容校验 digest |
| TC-027 | 恶意 HTML/SVG 含脚本和外链 | sandbox 阻止执行/外联，内容不污染主 Renderer |
| TC-028 | DOCX/PDF 转换炸弹 | 隔离转换按 CPU/内存/页数限制终止，返回 preview_unsupported |
| TC-029 | 下载第 3 块 digest 错误 | 停止、清理 partial、保留原目标、返回 integrity_mismatch |
| TC-030 | 下载中用户取消 | 终止网络与写入，删除 partial，状态回到可重试 |
| TC-031 | 下载目标已存在且最终 rename 失败 | 原文件保持完整，不执行预删除 |
| TC-032 | 150 MiB 下载中断后续传 | 绑定同 version 恢复；version 已变化则拒绝续传 |
| TC-033 | TUI `/resource info <association>` | 输出 label/state/capabilities，不输出服务器 path |
| TC-034 | TUI 无图形 opener 打开二进制 | 显示 download 命令，不静默失败 |
| TC-035 | Android 点击远程 Artifact | 打开 bottom sheet，可预览/下载并显示进度 |
| TC-036 | Android Storage Picker 取消 | 无文件写入，无错误 toast |
| TC-037 | DocMaster 临时下载 URL 被另一主体使用 | 拒绝，且不泄露资源信息 |
| TC-038 | 临时 URL 过期或权限撤销 | 立即失败，重新 Resolve 后才可生成新 URL |
| TC-039 | Snapshot/Replay/实时/重启四路径 | Association canonical digest 完全一致 |
| TC-040 | P1 历史迁移执行两次 | 无重复 Association，输出字节一致 |
| TC-041 | OAEP、日志、错误、遥测注入绝对路径 | 脱敏门禁检测为 0 泄露 |
| TC-042 | 键盘 Tab/Enter/Shift+F10/Esc | Chip 主动作、菜单和取消均可达 |
| TC-043 | 屏幕阅读器读取 changed 资源 | 读出名称、文件类型、已变化和主动作 |
| TC-044 | Resource label 含 bidi/HTML/Markdown | 安全转义、限长、布局不被劫持 |
| TC-045 | Runtime 重启并恢复 watch cursor | 状态事件不丢不重，cache 正确失效 |

## 13. 测试与发布门禁

P2 必须建立以下自动门禁：

1. OAEP/OWOP JSON Schema 正反例和三语言 codegen `--check`；
2. Resource Association canonicalization/property-based 测试；
3. Resource identity/generation/version 状态机测试；
4. path traversal、symlink/junction、TOCTOU、跨租户和错误等价测试；
5. Desktop React 组件真实点击、键盘和 accessibility 测试；
6. Windows 打包应用通过真实 main/preload/IPC 完成 local/remote/moved/changed/deleted 场景；macOS 打包态测试属于后续独立兼容门禁；
7. TUI 真实命令解析与下载临时目录测试；
8. Android Compose 点击、SAF 下载、取消、离线恢复测试；
9. DocMaster ResourceHost SPI 使用对象存储模拟器跑 conformance suite；
10. 100/2,000/1,000,000 规模的批量解析、长会话和索引性能测试；
11. 恶意文件 preview sandbox 和内容嗅探测试；
12. P1 历史迁移、双读和停止旧写入门禁。

发布不得只依赖源码正则断言。源码架构扫描可以保留，但必须与真实交互、打包态和故障注入测试同时通过。

## 14. 兼容与迁移

### 14.1 双读单写

- P2 客户端可读 P1 `resource_ref` 和 P2 Association；
- Runtime/Composer 从 P2 开始只写 Association；
- P1 数据读取时在内存中迁移，不原地重写 append-only OAEP 事件；
- Snapshot 可保存迁移后的 canonical projection，并记录 mapping version；
- Adapter 若只能提供 P1 结构，由 Runtime 在公共边界升级，不能让 Host 各自猜测。

### 14.2 P1 字段映射

| P1 | P2 |
|---|---|
| `workspace_id/resource_type/resource_id` | `ResourceKey` |
| 缺失 `authority_id` | Session authoritative Runtime binding |
| `relation/locator/presentation` | `ResourceAssociation` 字段 |
| `label` | `label_snapshot` |
| `digest` | `version_snapshot.digest` |
| Message Part 数组位置 | 确定性 `part_id/association_id` |
| `attachmentIndex` | 迁移时解析为 association id，随后丢弃下标 |
| 仅 path 的 legacy attachment | 当前 Workspace 内受控注册；失败则成为不可点击 legacy label |

### 14.3 删除旧兼容代码的条件

以下条件全部满足后，才可删除 P1 写入和正则/下标兼容代码：

- 连续两个正式发布版本的新会话 P2 Association 写入率为 100%；
- Desktop、TUI、Android、DocMaster 的 P1 fixture 回放仍通过；
- 兼容遥测显示至少 90 天没有活跃客户端要求 P1-only 写入；
- 已提供回滚开关，可恢复 P1 reader，但不会恢复不安全旧写入；
- 删除项单独经过数据迁移和发布评审。

## 15. 实施里程碑

### M0：协议与共享 SDK

- 新增 ResourceKey、ResourceAssociation、严格 Message Part 和 Descriptor Schema；
- 建立 TypeScript/Python/Kotlin codegen；
- 建立 P1→P2 canonical migration 和跨端 fixture matrix。

### M1：Runtime Resource Service

- 实现 Resource index、generation/version/tombstone；
- 实现 `resources.resolve_batch/read/preview/download/subscribe`；
- 移除前台全盘扫描，增加后台 repair；
- 实现原子 read-by-key/version、审计和多租户 ResourceHost SPI。

### M2：Desktop 产品体验

- Composer 使用结构化 token 和 association id；
- 实现 Host Action Router、批量状态、原位状态和动作菜单；
- 统一 local/remote file/artifact preview/download；
- 下载进度、取消、安全替换和 packaged E2E。

### M3：TUI、Android 与 DocMaster

- TUI association 命令和共享 projector；
- Android 可点击资源、preview/SAF download；
- DocMaster 对象存储 Host、Web sandbox preview 和短期下载。

### M4：迁移收口

- 停止 P1-only 新写入；
- 收集兼容遥测、完成长历史回放；
- 删除 capability 猜测、直接 path 打开、attachmentIndex 新写入和前台 inode 扫描；
- 完成性能、安全、可访问性和发布门禁。

## 16. 观测与审计

必须提供以下脱敏指标：

- Association 产生率、P1/P2 读取比例、迁移失败率；
- batch 大小、resolve 延迟、cache hit、watch invalidation 延迟；
- preview/download 成功率、首屏时间、取消率、integrity failure；
- moved/changed/deleted/offline/unsupported 分布；
- Host capability 分布，不记录文件名和 path；
- cross-workspace/cross-tenant denial 计数；
- Renderer action 到 Host action 的 correlation id；
- 兼容 fallback 使用次数，用于决定旧代码删除时间。

审计事件至少包括主体、tenant、session、authority、workspace、resource hash、action、version、结果 code、时间和 correlation id。Resource ID 可进行带服务端盐的审计哈希；不得记录内容、绝对路径、对象 key 或临时 URL。

## 17. 风险与缓解

| 风险 | 缓解 |
|---|---|
| P2 模型增加 Association 层，客户端复杂度上升 | 通过 codegen 和共享 projector 隐藏协议细节 |
| authority id 迁移不唯一 | 只允许从 Session binding 推导；无法推导时安全降级，不猜测 |
| 外部编辑导致 identity 判断困难 | Host journal 优先；generation/tombstone；后台 repair 仅提供建议，不静默重绑 |
| Office/PDF preview 攻击面扩大 | 隔离转换、资源限制、sandbox origin、默认禁宏禁外链 |
| 批量解析引发权限检查压力 | 批量授权接口、短 TTL cache、事件失效、配额和速率限制 |
| 短期 URL 被复制 | 主体/版本绑定、短过期、可撤销、只在动作响应出现 |
| P1 历史量大 | 内存迁移、按视口解析、Snapshot canonical cache，不原地重写事件 |

## 18. 最终产品判定

P2 完成后，“文件联动”不再是 Desktop 中若干可点击路径，而是 OpenDrSai 的统一会话资源能力：

- 协议知道资源身份和每一次会话关联；
- Runtime 知道当前版本、状态和访问边界；
- Host 知道怎样在本机或远程环境中给用户最自然的动作；
- 用户始终看到可理解的资源名称、状态、动作和恢复方式；
- 任何客户端都不需要猜路径、猜权限或理解另一个 Host 的私有 API。

只有当本 SPEC 的协议、Runtime、Desktop、TUI、Android、DocMaster、安全、性能和迁移门禁全部通过，P2 才能标记为完成。
