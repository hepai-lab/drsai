# P1：OpenDrSai 会话资源关联与导航能力开发方案

> 方案名称：P1  
> 状态：P1 已完成（第 4 轮，100%）  
> 日期：2026-08-16  
> 范围：OpenDrSai 原生会话、Codex/Hermes 等 Backend 适配、Desktop、TUI、移动端、服务端多租户宿主（例如 DocMaster）  
> 相关文档：[OpenDrSai 工作区文件与成果联动 P1 开发方案](../desktop/opendrsai-workspace-file-artifact-linkage-p1-plan.zh-CN.md)

## 1. 能力定名

这项能力应正式定义为：

**OpenDrSai 会话资源关联与导航能力**（Conversation Resource Association and Navigation）。

它不是“Codex 文件链接适配”，也不只是 Markdown 链接、聊天附件或 Artifact 卡片，而是 OpenDrSai 的一项协议级基础能力：

> 在会话中保存“哪一段输入或输出关联了哪个资源、是什么关系”，并让不同宿主在当前身份和 Workspace 权限内解析、展示、预览、下载或定位该资源。

协议职责可简写为：

- **OAEP 表达关联语义**：哪个 Session/Run/Item/Part 与哪个资源有关，以及关系、顺序、显示名称和定位信息；
- **OWOP 解析和访问资源**：资源属于哪个 Workspace，当前用户是否有权访问，如何读取元数据、内容或变化状态；
- **Host 实现交互**：Desktop 在右侧文件栏定位并预览，TUI 输出相对路径或调用 opener，Web/DocMaster 在租户边界内预览或下载。

“工作区文件与成果联动 P1”是本能力的一个子集，主要覆盖“输出 Artifact 的发布、落盘和打开”；本设计进一步覆盖输入引用、引用来源、文件变更、派生关系以及 OpenDrSai 原生会话。

## 2. 问题定义

当前不一致并不只发生在 Codex 同步链路。只要 OpenDrSai 的会话把资源退化成一段文本路径或普通 Markdown，就会出现同一类问题：

- 输入框里选择的文件在发送后只剩文本，丢失可点击资源身份；
- Codex 或 OpenDrSai 原生 Agent 返回的文件路径不能稳定映射到当前 Workspace；
- 输出 Artifact、文件变更和引用来源使用不同的数据结构与点击逻辑；
- Desktop 能打开某些本地路径，但 TUI、远程 Workspace 和多租户服务端无法复用；
- 历史回放只恢复文字，不能恢复资源卡片及其可用/失效状态；
- 绝对路径进入会话后既不可移植，也可能泄露主机目录和租户存储结构；
- UI 只能猜测 Markdown 中的路径，无法可靠区分文件、网页、知识库文档和普通文字。

因此，事实源必须是结构化资源关联，而不是 Renderer 对文本做路径识别。

## 3. 当前实现审计

仓库已经具备一部分正确基础，但链路尚未闭合。

### 3.1 已有协议基础

- OAEP 已有 `resourceRef`，包含 `protocol=owop/1`、`workspace_id`、`resource_type`、`resource_id`、可选 `label` 和 `digest`；
- OAEP Message 已有有序 `parts`，支持 `text | image | audio | file | resource_ref`；
- OAEP 多数内容类型可携带 `resource_refs`；
- OAEP Artifact 已有 `path`、`mime_type`、`size`、`sha256`、`previewable` 和 `downloadable`；
- OWOP 已有 `files.stat`、`files.read`、`artifact.metadata` 和 `artifact.chunk`；
- Desktop 已有“打开工作区 Artifact -> 切换右侧文件栏 -> 定位/预览”的基本入口。

### 3.2 目前的断点

1. **生产端丢失关联**  
   同步会话中的文件常被编码进 Message `text`，而不是有序 `parts` 和 `resource_ref`。OpenDrSai 原生发消息路径也没有统一要求必须生成资源引用。

2. **输入消息投影不可操作**  
   `threadRuntimeProjection.ts` 中 `userAttachments()` 即使读到 `resource_ref`，仍把文件 `path` 投影为空字符串，只把 `resource_type:resource_id` 放进 note；没有通过 OWOP 解析出可操作目标。

3. **用户消息正文按纯文本渲染**  
   `ChatWorkspace.tsx` 对用户消息使用普通 `<p>`，非图片附件 badge 也只是 `<span>`，没有统一的资源点击行为。

4. **Markdown 链接处理刻意拒绝本地路径**  
   当前处理器只接受 `http:`、`https:`、`mailto:` 和极少数受控 `opendrsai:` URI。这一安全原则是正确的，但意味着结构化 Resource Part 必须承担工作区文件导航，不能依赖 Markdown 兜底。

5. **输出 Artifact 投影有字段损失**  
   Artifact 投影保留名称、路径和 MIME，却没有完整保留 `size`、`sha256`、`previewable`、`downloadable` 与资源引用，导致卡片行为可能与 Runtime 能力声明不一致。

6. **文件变更只是活动文本**  
   `file_change` 当前主要投影为带 path 的 activity，没有与统一资源打开器关联；创建或修改的文件不能自然地从活动记录进入右侧文件栏。

7. **OWOP 文件引用缺少稳定解析约定**  
   `resourceRef.resource_id` 被定义为 ID，而现有文件操作主要接收相对 `path`。如果直接把两者混用，远程、重命名和多租户实现会产生歧义。

8. **历史与实时可能走不同投影**  
   若实时消息由 Composer 内存态保留附件，而历史来自 OAEP 的文本投影，刷新或跨端后会出现“发送时可点、历史不可点”。

## 4. 目标与非目标

### 4.1 目标

1. OpenDrSai 原生会话和所有 Backend Adapter 产生同一种资源关联语义；
2. 输入引用、输出 Artifact、Citation 和 File Change 都能关联到 Workspace 资源；
3. 实时显示、历史回放、断线恢复和跨端同步结果一致；
4. Desktop、TUI、移动端与 DocMaster 共享协议，不共享 Electron 私有 API；
5. 本地与远程、多用户与单用户使用相同逻辑资源身份；
6. 点击前重新解析和授权，不把绝对路径当作公共身份；
7. 资源移动、删除、版本变化或权限撤销后显示真实状态。

### 4.2 非目标

- 不允许 Renderer 扫描任意文本并自动把疑似路径变成可信链接；
- 不把 Codex 私有附件结构写进 OAEP；
- 不要求 TUI 实现图形化文档预览；
- 不以 Host 绝对路径作为跨进程、跨设备或跨租户的资源 ID；
- 不因为资源曾出现在某个会话中就永久授予访问权；
- 不把每次文件修改都自动认定为用户交付成果。

## 5. 统一领域模型

### 5.1 Resource 与 Association 分离

`Resource` 表示可被 Workspace 主体授权访问的对象；`Association` 表示会话内容为何以及如何关联该对象。

```text
Conversation Item / Message Part
        |
        | Association: input_reference / output_artifact / citation / changed / derived_from
        v
OAEP ResourceRef
        |
        | OWOP resolve + authorize
        v
Workspace Resource
        |
        +-- file / directory
        +-- artifact
        +-- checkpoint/version
        +-- process/pty（通常不可预览）
        +-- future: knowledge document / browser capture
```

同一资源可以被多条消息引用；同一消息也可以关联多个资源。关联属于会话事实，资源内容与访问权属于 Workspace 事实。

### 5.2 关系类型

建议定义稳定枚举：

| `relation` | 含义 | 典型位置 |
|---|---|---|
| `input_reference` | 用户要求 Agent 阅读、编辑或参考 | User Message Part |
| `input_attachment` | 用户上传或附加给本轮处理 | User Message Part |
| `output_artifact` | Agent 明确交付的成果 | Artifact Item / Assistant Part |
| `citation_source` | 回答事实或内容来源 | Message Citation |
| `file_change_target` | 本轮创建、修改、删除或重命名的目标 | File Change Item |
| `derived_from` | 资源由另一个资源转换、导出或生成 | Artifact lineage |
| `related` | 无法归入以上类别的一般关联 | 任意 Item；应少用 |

关系不能只靠 Item 类型推断。例如 Assistant Message 既可引用输入文件，也可链接输出 Artifact；显式 relation 能避免 UI 猜测。

### 5.3 资源定位信息

资源关联可以携带可选 locator，用于打开到具体位置：

```json
{
  "kind": "text_range",
  "line": 42,
  "column": 7
}
```

后续可扩展 `page`、`slide`、`sheet_cell`、`time_range`。Locator 是导航提示，不是授权凭据；客户端不认识时仍应能打开资源本身。

## 6. OAEP 目标契约

### 6.1 职责

OAEP 必须保存以下事实：

- 资源逻辑身份；
- 资源所属 Workspace；
- 资源在消息中的顺序和显示文本；
- 会话内容与资源之间的关系；
- 可选的内容摘要或 digest，用于判断版本是否变化；
- 可选 locator 和展示提示。

OAEP 不负责返回磁盘绝对路径、对象存储 key、临时下载 URL 或最终权限结论。

### 6.2 建议的向后兼容扩展

在现有 `resourceRef` 上新增可选字段：

```json
{
  "protocol": "owop/1",
  "workspace_id": "workspace-123",
  "resource_type": "file",
  "resource_id": "file-opaque-id",
  "label": "OpenDrSai会话资源关联与导航能力设计.md",
  "digest": "<sha256>",
  "relation": "input_reference",
  "locator": {
    "kind": "text_range",
    "line": 1
  },
  "presentation": "inline"
}
```

建议约束：

- `relation` 为上节稳定枚举；
- `presentation` 仅是 `inline | card | activity` 的建议，不强制 Host 布局；
- `locator` 使用带 `kind` 的开放联合类型；
- Producer 不得写入可信 `previewable/downloadable/revealable` 权限，这些能力必须由 OWOP 在请求时计算；
- 现有消费者忽略新增可选字段，保持 OAEP v1 向后兼容。

### 6.3 Message Parts 是正文事实源

输入消息必须保留资源在原文中的次序，例如：

```json
{
  "role": "user",
  "text": "参考 方案.md 开始执行",
  "parts": [
    {"type": "text", "text": "参考 "},
    {
      "type": "resource_ref",
      "name": "方案.md",
      "mime_type": "text/markdown",
      "resource_ref": {
        "protocol": "owop/1",
        "workspace_id": "workspace-123",
        "resource_type": "file",
        "resource_id": "file-456",
        "label": "方案.md",
        "relation": "input_reference",
        "presentation": "inline"
      }
    },
    {"type": "text", "text": " 开始执行"}
  ],
  "resource_refs": []
}
```

`text` 是旧客户端和检索系统使用的兼容投影；`parts` 才是富内容顺序的权威来源。禁止把 Backend 私有对象 stringify 后塞进 `text`。

`content.resource_refs` 可继续用于不属于某个具体 Part 的 Item 级关联；同一个关联不应在 Part 与 Item 级重复写入。

### 6.4 Artifact 与 File Change

- Artifact Item 必须携带指向同一 `artifact_id` 的 `resource_ref`，并保留 `size`、`sha256`、`previewable`、`downloadable` 等兼容字段；
- Host 在点击时仍以 OWOP 最新元数据为准，OAEP 字段只是事件发生时快照；
- File Change 的每个 change 应允许携带自己的 `resource_ref`；删除操作仍保留关联，以便显示“已删除”及历史差异，而不是尝试打开不存在的文件；
- Rename 应表达旧路径与新资源身份，不能拆成两个互不相关的字符串。

### 6.5 Citation

Citation 应区分：

- Workspace Resource：使用 `resource_ref`，由 OWOP 打开；
- Knowledge Base Resource：使用知识库资源引用，由对应 Host Resolver 打开；
- Web URL：保留受控 `https` URL；
- 纯文本来源：不可点击，但保留 label 和 locator。

Citation 不应伪装成 Artifact，也不应把知识库内部路径交给 Workspace 文件栏解析。

## 7. OWOP 目标契约

### 7.1 职责

OWOP 是资源引用的安全解析面，负责：

- 用当前 principal、tenant 和 workspace 上下文解析资源；
- 返回资源当前名称、逻辑相对路径、类型、大小、digest 和状态；
- 声明本次请求可用的动作能力；
- 提供受限元数据和分块读取；
- 对移动、删除、版本变化和权限撤销返回明确错误；
- 记录跨边界访问审计。

### 7.2 补齐文件 ID 与路径的歧义

当前 `files.stat/read` 以相对路径为参数，而 OAEP `resourceRef` 使用 `resource_id`。长期方案应新增只读解析操作，例如：

```json
{
  "operation": "files.resolve",
  "params": {"file_id": "file-456"}
}
```

响应示例：

```json
{
  "file_id": "file-456",
  "path": "docs/protocol_issue/方案.md",
  "name": "方案.md",
  "kind": "file",
  "mime_type": "text/markdown",
  "size": 12345,
  "digest": "<sha256>",
  "state": "available",
  "capabilities": {
    "read": true,
    "preview": true,
    "download": true,
    "reveal": true,
    "open_external": false
  }
}
```

P1 过渡期可以使用“规范化 Workspace 相对路径作为 file resource_id”的 profile，但必须显式声明，不能由客户端猜测；协议稳定后应使用 opaque file ID，并通过 `files.resolve` 获得当前路径。

### 7.3 统一资源状态

建议统一以下状态或错误语义：

| 状态/错误 | UI 行为 |
|---|---|
| `available` | 正常打开、预览或下载 |
| `moved` | 使用最新路径打开，并可提示已移动 |
| `changed` | 允许打开当前版本，提示与会话记录的 digest 不同 |
| `deleted` / `resource_not_found` | 灰显，显示已删除或不可用 |
| `forbidden` | 不泄露存在性，只显示无权访问 |
| `workspace_mismatch` | 禁止打开，提示切换到对应 Workspace 或请求授权 |
| `unsupported` | 保留资源名称，隐藏不支持的动作 |

### 7.4 能力由 Host 决定

`preview`、`download`、`reveal`、`open_external` 必须由 OWOP/Host 针对当前请求计算：

- Desktop 本地 Workspace 可以支持 `reveal` 和系统打开；
- TUI 可以只支持 `read/download` 与复制相对路径；
- DocMaster 可以支持 Web 预览和短时下载，不暴露服务器文件管理器；
- 移动端可以支持预览和下载，但不具备 Desktop 文件栏；
- 未受信任 Office 文件可先经过隔离转换，再提供派生预览 Artifact。

## 8. OpenDrSai 原生会话必须成为一等 Producer

本能力不能只在 `CodexAdapter` 中实现。OpenDrSai 自己的 Composer、Agent Core、Runtime 和历史存储必须首先满足同一契约。

### 8.1 Composer 发送链路

当用户从右侧文件栏、拖放、文件选择器、知识库或浏览器面板添加资源时：

1. Host 先把本地选择注册/解析为当前 Workspace 下的 Resource；
2. Composer 内部保存 `DraftPart[]`，文本与资源都是有序 Part；
3. 提交时生成 OAEP User Message Item，写入 `parts` 和 `resource_ref`；
4. Agent 输入适配层按 Backend 能力转成 Backend 私有附件格式；
5. OAEP 历史始终保存公共 ResourceRef，不保存 Backend 私有句柄；
6. 刷新、恢复、跨端读取时从 OAEP 重建相同卡片。

### 8.2 Agent 输出链路

OpenDrSai Agent 创建最终文件时：

1. 中间文件只进入 `execution_scratch`；
2. 最终交付物通过 `deliver_artifact` 发布到逻辑 Workspace/Artifact Namespace；
3. Runtime 持久化 Artifact 元数据与 ResourceRef；
4. 发出结构化 OAEP Artifact Item；
5. Assistant 文本如需在句内提及成果，可以引用同一 ResourceRef，但不得重新制造一个裸路径身份；
6. Desktop 文件栏、聊天卡片、TUI 和 DocMaster 消费同一个 Artifact 身份。

### 8.3 Agent 读取与修改链路

- Agent 收到资源引用后，通过 Runtime 注入的授权上下文读取，不能信任模型拼接的绝对路径；
- 工具创建或修改 Workspace 文件时产生结构化 File Change Item；
- 若文件是明确交付物，再发布 Artifact；File Change 与 Artifact 是不同语义，可指向同一底层文件；
- 操作结果、资源关系和最终消息必须使用同一 `workspace_id + resource_id` 关联。

## 9. Backend Adapter 要求

Codex、Hermes 或其他 Adapter 的职责是语义转换，不是向 Desktop 复制私有 UI 数据。

### 9.1 入站（OpenDrSai -> Backend）

- 将 OAEP Message Parts 转换成 Backend 支持的文本、图片、文件或资源输入；
- Backend 不支持某类资源时，明确降级并产生 Notice，不能静默只发送一个无法访问的路径；
- 临时上传句柄只存在于 Adapter/Runtime，不回写成公共资源身份。

### 9.2 出站（Backend -> OpenDrSai）

- Backend 返回结构化附件或文件引用时，先归一化为 Workspace ResourceRef；
- 只有能被当前 OpenDrSai Runtime 读取并授权的资源才可标为可用；
- Backend 本地绝对路径不可直接进入 OAEP；必要时先发布/导入为 Workspace Artifact；
- Markdown 中的路径文本只能作为显示文本，不能替代结构化关联；
- Adapter 必须保证实时事件与 snapshot/history 的 ResourceRef 相同。

## 10. 客户端体验规范

### 10.1 统一交互优先级

点击资源时按以下顺序处理：

1. 使用 ResourceRef 调用 Resolver；
2. 验证 Workspace 与当前身份；
3. 根据最新 capabilities 选择默认动作；
4. Desktop 优先在右侧对应面板定位并预览；
5. 若无内置预览，提供下载、复制相对路径或显式外部打开；
6. 不可用时原位展示可理解、可恢复的状态。

### 10.2 跨端矩阵

| 场景 | Desktop | TUI | Web/DocMaster | 移动端 |
|---|---|---|---|---|
| 输入文件引用 | 蓝色内联资源/卡片；点击定位文件栏 | 显示名称与相对路径；快捷键查看 | Web 预览或下载 | 内置预览或下载 |
| 输出 Artifact | 成果卡片；预览/在文件中显示/另存 | Artifact 行；查看元数据/下载 | 租户内预览/下载 | 预览/分享受控副本 |
| File Change | 活动项可打开目标文件或 diff | 打开相对路径/diff | Web diff/文件页 | 简化 diff/文件页 |
| Citation | 按资源种类打开 | 输出编号与目标 | 对应来源面板 | 对应来源页 |
| 本地系统文件管理器 | 用户显式操作时可用 | Host 支持时可用 | 不可用 | 不可用 |

### 10.3 Desktop 具体行为

- 输入与输出中的 Workspace 文件均采用一致的蓝色资源视觉语言；
- 点击默认打开右侧“文件”栏、展开父目录、选中节点并尝试预览；
- “在系统文件管理器中显示”是二级动作，并仅在本地 Host capability 允许时出现；
- 输入 badge、Assistant Artifact、Citation 与 File Change 共享 `openConversationResource(ref, intent)`；
- 不再让 User Message 永久走纯文本专用渲染路径；应渲染有序 Message Parts；
- 不创建聊天附件副本，文件栏与会话指向同一逻辑资源；
- 文件被移动或修改后，以 OWOP 最新结果展示并提示会话记录的历史状态。

### 10.4 TUI 具体行为

- 使用同一 OAEP Item/Part，不读取 Desktop 投影模型；
- 默认显示 `label` 和安全相对路径，不显示 Host 绝对路径；
- 提供资源编号与命令，例如 `/resource <id>`、`/artifact <id>`；
- 能力允许时使用系统 opener，远程会话则通过 OWOP 下载或输出受控访问方式；
- 无图形预览不等于资源不可交付。

## 11. 安全与多租户边界

1. 每次 resolve/read/preview/download 都按当前 principal 重新授权；
2. `tenant_id` 不由模型或客户端自由传入，而由认证会话和 Runtime 上下文绑定；
3. `workspace_id + resource_id` 不是访问令牌，资源 ID 应不可预测；
4. OAEP 事件、日志、错误和通知不得包含 Host 绝对路径或对象存储 key；
5. 远程下载 URL 必须短时有效、绑定对象与用途，且不能替代 ResourceRef 持久化；
6. 防止 `..`、符号链接、junction、重解析点和 TOCTOU 越界；
7. Preview 转换运行在隔离环境，并保留原始 Artifact 与派生预览的 lineage；
8. 跨 Workspace 引用默认拒绝；需要切换或导入时必须由用户显式确认；
9. 会话分享不自动扩大资源 ACL，接收者可能看到名称但无权读取内容；
10. 审计记录至少包含 principal、tenant、workspace、resource、operation、result 和 correlation ID。

## 12. 兼容与迁移

### 12.1 兼容原则

- 先新增可选字段和新 OWOP operation，不修改现有字段含义；
- 旧客户端继续读取 Message `text` 和 Artifact 基础字段；
- 新客户端优先读取 `parts/resource_ref`，缺失时显示文本但不伪造链接；
- 仅对能够证明位于当前 Workspace 且通过授权检查的 legacy 路径做一次性升级；
- 不扫描历史 `runs/**/tmp` 并自动公开其中的文件。

### 12.2 历史消息修复

历史迁移分三级：

1. **可证明关联**：已有 Artifact ID、Workspace 相对路径或 Backend 稳定附件 ID，可补写更高 revision 的 OAEP Item；
2. **需用户确认**：文本路径可以映射到多个资源，显示“关联文件”操作，由用户选择；
3. **不可证明**：保留为普通文本，不自动变成可点击资源。

事件日志保持 append-only；修复通过 `event.item.updated` 和更高 Item revision 完成。

## 13. 分阶段实施建议

### M0：协议定稿与契约测试

- 明确能力名称、Resource/Association 模型和 relation 枚举；
- 扩展 OAEP `resourceRef`、Message Part、File Change 与 Citation schema；
- 新增 OWOP `files.resolve` 或等价稳定解析操作；
- 建立 JSON Schema、Python、TypeScript 生成代码和跨语言 fixture；
- 定义资源状态、错误码和 capability 语义。

### M1：OpenDrSai 原生会话闭环

- Composer 使用有序 Draft Parts；
- 原生 User Message 持久化 ResourceRef；
- Runtime 历史/实时使用同一投影；
- Desktop 建立统一 Resource Resolver/Open Handler；
- 输入资源、Artifact、Citation、File Change 接入同一打开入口；
- 完整保留 Artifact 能力字段。

### M2：Backend Adapter 一致性

- 修复 Codex Adapter 的入站/出站附件与 Workspace Link 映射；
- 对 Hermes 和其他 Backend 建立相同契约测试；
- 无法访问 Backend 私有路径时产生明确降级 Notice；
- 验证 snapshot、增量、断线恢复和历史回放一致。

### M3：TUI、远程与 DocMaster

- TUI 资源命令与受控 opener/download；
- Tenant Host Adapter 的 resolve/read/preview/download 授权；
- 对象存储和隔离预览实现；
- 跨设备、跨进程、跨租户负向测试。

## 14. 模块落点建议

| 层 | 当前落点/建议修改 |
|---|---|
| OAEP Schema | `cores/protocol/oaep/oaep.schema.json`：扩展 ResourceRef、Parts、File Change、Citation |
| OWOP Schema | `cores/protocol/owop/owop.schema.json`：增加文件资源解析与结果能力 |
| OpenDrSai Agent Core | 统一输入 Resource Context、`deliver_artifact`、File Change/Artifact 事件产生 |
| Codex Adapter | `native_decoder.py` 等：私有附件/链接 -> OAEP ResourceRef，禁止裸绝对路径 |
| Runtime Gateway | 资源注册、历史持久化、OWOP 解析、授权与审计 |
| Desktop Main | `threadRuntimeProjection.ts`：保留 Message Parts/ResourceRef 和完整 Artifact 字段 |
| Desktop Resource Bridge | `oaepOwopResources.ts`：从 Artifact 专用解析扩展为通用 Resource Resolver |
| Desktop Renderer | `ChatWorkspace.tsx`：用户有序 Part、可点击 badge、统一打开入口 |
| Desktop Files | `FilesContextPanel.tsx` / `App.tsx`：定位、选中、预览和失效状态 |
| TUI | OAEP Resource Part 投影、资源详情/下载/打开命令 |
| DocMaster Host | Tenant Resource Resolver、对象存储映射、Web 预览与下载授权 |

## 15. 验收标准

### 15.1 原生 OpenDrSai 会话

- 从文件栏引用 `docs/方案.md` 发送后，当前消息和重启后的历史消息均显示同一个可点击资源；
- 点击后 Desktop 打开右侧文件栏、选中真实文件并预览；
- Agent 可通过授权上下文读取该文件，OAEP 中不出现绝对路径；
- 资源移动、修改、删除后卡片显示正确状态；
- 同一文件在输入引用和输出 Artifact 中不产生物理副本。

### 15.2 Codex/Hermes 适配

- Backend 原生附件映射为同一 OAEP Message Parts 与 ResourceRef；
- 实时、snapshot、刷新后历史以及跨设备显示一致；
- Backend 私有路径不可访问时显示明确降级，不生成伪链接；
- Assistant 输出 Artifact 与 File Change 都能通过统一 Resolver 打开。

### 15.3 跨宿主

- Desktop、TUI 和 DocMaster 消费同一份 OAEP fixture；
- TUI 不依赖 Electron API，DocMaster 不暴露服务器绝对路径；
- 租户 A 的 ResourceRef 在租户 B 下无法解析，且错误不泄露对象存在性；
- 远程 Workspace 能预览或下载，不要求本地文件管理器存在。

### 15.4 协议与安全

- Schema 对未知可选字段向后兼容，对非法 relation/locator 拒绝或安全降级；
- 所有打开动作都经过 OWOP 重新授权；
- Path traversal、symlink/junction、TOCTOU、短链复用和跨 Workspace 测试通过；
- 会话导出、日志与错误中没有 Host 绝对路径、租户物理目录或对象存储 key。

## 16. 关键决策

1. **能力归属 OpenDrSai Core，而非 Codex Adapter。** Codex 只是资源关联的一个生产者和消费者。
2. **结构化关联是事实源。** Markdown 仅负责文字与 Web 链接，不负责可信文件导航。
3. **OAEP 与 OWOP 分工。** OAEP 保存关系，OWOP 解析资源并授权，Host 决定交互。
4. **资源身份与路径分离。** 路径可移动、可隐藏，Resource ID 才是会话中的稳定引用。
5. **历史与实时同构。** 任何只在 Composer 内存态或实时 Adapter 中存在的附件信息都不算完成。
6. **交付成果与文件变化分离。** Artifact 表示用户可消费成果，File Change 表示 Workspace 变化；两者可关联同一资源。
7. **跨端能力渐进增强。** Desktop 的右侧预览是 Host 能力，不进入 Core 协议硬编码。

## 17. 结论

OpenDrSai 需要建设的不是一组“让链接变蓝”的 UI 补丁，而是一条完整的会话资源链：

```text
资源选择/产生
  -> OAEP 结构化关联
  -> 会话持久化与回放
  -> OWOP 安全解析和授权
  -> Host 能力协商
  -> 点击定位、预览、下载或受控打开
```

只有这条链同时覆盖 OpenDrSai 原生会话和 Backend Adapter，才能让 Codex 式易用性成为 OpenDrSai 的通用能力，并安全地延伸到 TUI、移动端和 DocMaster 等服务端多用户产品。

## 18. 实施与验收进度

| 轮次 | 进度 | 已完成的可验证能力 |
|---|---:|---|
| 第 1 轮 | 48% | OAEP/OWOP ResourceRef 与 `files.register/resolve`；OpenDrSai 原生输入资源持久化；Workspace 内成果自动交付；Desktop 首版统一解析与打开入口 |
| 第 2 轮 | 48% | 方案正式命名为 P1，内部里程碑改用 M0–M3，消除编号歧义 |
| 第 3 轮 | 80% | TUI `/resource` 与 Artifact ResourceRef；DocMaster 风格多租户 Resource Host；Desktop moved/changed/deleted 可见反馈与按引用下载；Codex 2.1 历史附件及实时/历史 File Change 归一化 |
| 第 4 轮 | 100% | Composer 有序 Draft Parts 贯通原生 Runtime/Codex/历史回放；File Change 直接导航；远程 Artifact 分块预览与校验下载；Desktop/TUI/Android/Python 共用 OAEP fixture；Windows/macOS Host 对齐；生产 Renderer 与 Windows 解包应用 smoke 通过 |

第 3 轮验证证据：P1 Python 相关回归 `183 passed, 1 skipped, 55 subtests passed`；Desktop Windows/macOS 的 main、preload、renderer TypeScript 检查通过；TUI TypeScript 检查及 Artifact 投影测试通过；Desktop P1 资源导航、Codex Desktop 集成和 Codex V6 80 项审计脚本通过。`git diff --check` 无空白错误。

第 4 轮验证证据：P1 Python 全量相关回归在排除一项既有、与资源能力无关的 Loguru/`caplog` 日志捕获用例后为 `230 passed, 1 skipped, 1 deselected, 60 subtests passed`，运行期间受并发源码写入影响的一项架构扫描随后单独复跑为 `1 passed`；最终核心资源快照为 `58 passed, 1 skipped, 48 subtests passed`。OAEP、OWOP 与 Relay 三套生成绑定均通过 `--check`；Windows main/web、macOS main/web、TUI TypeScript 检查通过；TUI 共用 fixture 2 项通过；Android `OaepJsonCodecTest` 与绑定校验 `BUILD SUCCESSFUL`；Desktop 两项 P1 专项验证、Structured Renderer、Codex Desktop 集成和 Codex V6 `80/80` 审计通过；Windows 生产 Renderer `electron-vite build` 通过，并在关闭本机签名元数据编辑后完成 `win-unpacked`，现有 packaged smoke 以真实 main/preload/IPC 通过；`git diff --check` 无空白错误。

P1 验收结论：15.1–15.4 的资源关联主链已闭合。协议事实源是 OAEP 的有序 Message Parts/ResourceRef，访问事实源是 OWOP 的请求时解析与重新授权；Desktop、TUI、Android 和服务端多租户 Host 只实现各自可用的预览、定位或下载能力，不依赖本机绝对路径。后续增强（例如更多文档格式的服务端派生预览）按新里程碑演进，不再阻塞 P1。
