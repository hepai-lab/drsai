# OpenDrSai 工作区文件与成果联动 P1 开发方案

> 状态：P1 开发方案  
> 主要入口：Desktop 工作区、文件侧栏、对话成果卡片  
> 兼容范围：Desktop、TUI、基于 OpenDrSai 的服务端多用户智能体（例如 DocMaster）  
> 核心原则：Agent Core 使用统一成果契约，宿主负责存储、授权和展示

## 1. 背景与问题

用户在 Desktop 默认工作区中要求 Agent 创建 DOCX 等文件时，最终文件可能被写入：

```text
DRSAI_HOME/workspace/runs/<user-id>/tmp/<file>
```

而不是当前注册工作区。结果是：

- 文件不出现在右侧“文件”侧栏；
- Runtime 不会把它登记为当前工作区成果；
- 对话中只有普通绝对路径文本，没有可点击的结构化成果；
- 用户无法通过工作区文件预览、下载或继续编辑；
- Agent 可能把内部路径误报为用户交付位置。

当前目录绑定已经部分正确：Agent factory 将用户工作区作为 `work_dir`，将配置、记忆等放在独立 `storage_dir`。问题主要发生在 CodeExecutor：默认执行器以内部 `UserProfileManager.tmp_dir` 为工作目录；同时内部提示要求在 Temporary Directory 中生成和测试代码，未区分中间文件与最终交付文件。

Runtime 当前只自动扫描 `context.workspace_path / "artifacts"` 并登记成果。内部 `runs/.../tmp` 既不属于工作区，也不能通过 Workspace 约束的 `RuntimeArtifactStore.publish()` 登记。因此，这不是中文路径兼容失败，而是执行目录、交付目录和成果协议没有完整衔接。

## 2. P1 目标

P1 必须完成以下闭环：

1. 用户要求创建的最终文件默认落入当前工作区的 `artifacts/`。
2. 文件生成完成后由 Runtime 登记为结构化 Artifact，并产生 `artifact.created` 事件。
3. Desktop 对话显示成果卡片，点击后可定位右侧文件栏并按能力预览或下载。
4. Desktop 文件栏刷新后能看到同一份物理文件，不创建聊天附件副本。
5. TUI 使用同一 Runtime Artifact 契约，不依赖 Desktop 私有路径或 Electron API。
6. DocMaster 等服务端宿主可将逻辑 Workspace 映射到租户目录、容器卷或对象存储，不泄露宿主绝对路径。
7. 内部配置、记忆、虚拟环境和缓存继续与用户成果隔离。
8. 中文、空格和非 ASCII 工作区路径作为正式支持场景，不允许静默回退到内部目录。

## 3. 非目标

P1 不包括：

- 在 Desktop 内实现完整的 Office 原生编辑器；
- 让模型直接理解 Electron、TUI 或 DocMaster 的展示协议；
- 扫描整个工作区猜测哪些文件是本轮成果；
- 把内部临时目录暴露为用户文件系统的一部分；
- 允许服务端用户通过绝对路径访问其他租户文件；
- 用解析最终回答中的 Windows/POSIX 路径替代 Artifact 事件。

## 4. 统一目录语义

Agent 和宿主必须显式区分以下逻辑目录：

| 逻辑目录 | 用途 | 用户可见 | 生命周期 | 典型实现 |
|---|---|---:|---|---|
| `workspace_root` | 用户项目和工作区文件 | 是 | 工作区持久 | Desktop 文件夹、TUI 当前目录、服务端租户 Workspace |
| `artifact_root` | 用户要求交付的最终成果 | 是 | 工作区持久 | `<workspace>/artifacts` 或宿主 Artifact Namespace |
| `execution_scratch` | 脚本、渲染缓存、中间文件 | 否 | Run 级临时 | 内部 run tmp 或工作区受控 scratch |
| `agent_storage` | 配置、记忆、技能、任务状态 | 否 | 用户/Agent 持久 | `DRSAI_HOME/workspace/runs/<user>` |
| `runtime_environment` | venv、依赖缓存、工具链 | 否 | Runtime 持久 | `agent_storage/venv` 或 Host 管理目录 |

禁止用一个 `work_dir` 同时表达上述全部含义。特别是必须拆开：

```text
Python/Node 运行时环境目录 != 子进程 cwd != 最终成果目录
```

## 5. 目标架构

P1 在 Agent Core 中定义宿主无关的成果发布端口：

```text
Agent / Skill / CodeExecutor
        |
        | write intermediate files
        v
execution_scratch
        |
        | deliver_artifact(source, name, media_type)
        v
Artifact Host Port
        |
        +-- Desktop Local Workspace Adapter -> workspace/artifacts
        +-- TUI Runtime Adapter            -> workspace/artifacts
        +-- Server Tenant Adapter          -> tenant workspace/object storage
        |
        v
artifact.created -> Conversation Projection -> Host UI
```

Agent 只调用 `deliver_artifact` 或等价 Tool，不需要知道实际文件位于 NTFS、POSIX 文件系统、容器卷还是对象存储。

## 6. 统一 Artifact 契约

### 6.1 发布请求

建议引入内部 Host Port：

```python
deliver_artifact(
    source_path: str,
    display_name: str | None = None,
    destination_name: str | None = None,
    mime_type: str | None = None,
    disposition: Literal["copy", "move"] = "copy",
) -> ArtifactDescriptor
```

模型可见工具应保持字段精简；`workspace_id`、`run_id`、`tenant_id`、目标根目录和授权上下文必须由 Runtime 注入，禁止由模型传入或覆盖。

### 6.2 返回描述符

P1 最低字段：

```json
{
  "artifact_id": "artifact-...",
  "workspace_id": "workspace-...",
  "session_id": "session-...",
  "run_id": "run-...",
  "name": "短诗_静夜.docx",
  "display_name": "短诗《静夜》",
  "relative_path": "artifacts/短诗_静夜.docx",
  "mime_type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "size": 12345,
  "sha256": "...",
  "downloadable": true,
  "previewable": false,
  "storage_kind": "workspace"
}
```

公共事件、API 和模型回答不得包含宿主绝对路径、内部 storage 路径或租户物理存储键。

### 6.3 名称与冲突

- `destination_name` 仅允许文件名或受控相对路径；拒绝绝对路径和 `..`。
- 默认清理 Windows/POSIX 非法字符，但保留合法中文和 Unicode。
- 已存在同名文件时不得静默覆盖。
- P1 默认生成确定性的安全后缀，例如 `短诗_静夜 (2).docx`，并在描述符中返回真实名称。
- 若任务语义是编辑已有文件，必须使用单独的受控更新协议，不复用“创建新成果”的同名策略。

### 6.4 原子性

发布流程应为：

1. 在目标存储的 staging 区写入；
2. 校验普通文件、大小上限、MIME、摘要和 Workspace/Tenant 边界；
3. 原子提交到最终名称；
4. 写入 Artifact 元数据；
5. 发出 `artifact.created`；
6. 失败时清理 staging，不产生半成品和成功事件。

## 7. CodeExecutor 调整

### 7.1 必须修改的行为

当前以 `self._user_profile_manager.tmp_dir` 创建 CodeExecutor 的逻辑不能继续把该目录同时视为用户成果目录。

P1 应向执行器传入显式上下文：

```python
CodeExecutionContext(
    cwd=workspace_root,
    scratch_dir=execution_scratch,
    artifact_dir=artifact_root,
    environment_dir=runtime_environment,
)
```

若现有执行器暂时只能接收一个 `work_dir`，P1 过渡实现可以：

- 保持 venv/依赖安装在内部 `runtime_environment`；
- 将实际代码子进程的 `cwd` 设置为 `workspace_root`；
- 在提示中要求脚本使用 `scratch_dir`，最终输出写入 `artifact_dir`；
- 由 `deliver_artifact` 完成最终登记。

不得简单把 venv 也移动到工作区根目录，否则会污染用户文件栏、放大同步成本，并给服务端多租户部署带来依赖隔离问题。

### 7.2 提示修正

Agent 系统提示必须明确：

```text
Internal temporary storage is only for scripts, caches and intermediate files.
Any document, spreadsheet, presentation, image, archive, report or other file
requested as a user deliverable must be published through deliver_artifact.
Never present an internal storage path as a delivered result.
```

同时注入逻辑目录名称或工具能力，不要求模型拼接真实绝对路径。

### 7.3 自动兜底

运行结束时保留对 `workspace/artifacts/**` 的安全扫描，兼容旧 Skill 和旧工具；但它只是兜底，不是主要发布机制。

若本轮工具输出引用了内部 scratch 中的新文件，却没有发布：

- P1 首选在 Agent 工具循环中返回 `artifact_not_delivered`，要求调用 `deliver_artifact`；
- 达到循环上限仍未发布时，Run 可以完成文本回答，但必须明确标记“成果未交付”，不能把内部路径展示为成功结果；
- 不建议 Runtime 在无语义信息时静默搬运所有内部文件。

## 8. Desktop 联动

### 8.1 文件侧栏

- `artifact.created` 成功后触发对应 Workspace 的增量刷新或目录失效通知；
- 文件侧栏展示真实的 `artifacts/<name>`；
- Artifact 与文件树节点使用 `workspace_id + normalized relative_path` 关联；
- 禁止用字符串比较宿主绝对路径建立关联；
- 若文件随后被删除或改名，成果卡片显示“文件已移动或不可用”，不继续展示陈旧成功状态。

### 8.2 对话成果卡片

结构化 Conversation Artifact Part 至少支持：

- 文件名、类型、大小；
- “在文件中显示”；
- “预览”（宿主声明支持时）；
- “下载/另存为”；
- Artifact 不可用时的明确恢复提示。

DOCX 在 P1 中至少必须支持下载和在文件侧栏定位。若 Desktop 已有 DOCX 预览能力，可以通过 Host Capability 将 `previewable` 投影为 true；Runtime Core 不应硬编码 Office 预览结论。

### 8.3 刷新一致性

成果卡片出现和文件侧栏刷新必须以同一个 `artifact.created` 为依据。不得由 Renderer 轮询回答文本中的路径，也不得复制文件到单独附件目录后造成两个版本。

## 9. TUI 兼容方案

TUI 分两种模式处理。

### 9.1 Runtime 模式

当 TUI 作为 Runtime Client 时：

- 当前目录解析为 Runtime Workspace；
- prompt 创建 Runtime Run；
- 直接消费统一 `artifact.created` 事件；
- 终端展示工作区相对路径，例如 `artifacts/短诗_静夜.docx`；
- 支持按键打开、调用系统 opener 或复制路径，但是否可用由 TUI Host Capability 决定；
- TUI 和 Desktop attach 到同一 Workspace/Session 时看到相同 Artifact ID 和相对路径。

### 9.2 Legacy direct mode

迁移期间保留 legacy TUI direct Agent execution，但必须复用同一 `deliver_artifact` 接口的 Local Filesystem Adapter。不得继续把 `UserProfileManager.tmp_dir` 当最终交付目录。

Legacy mode 产生的最小事件需要经过现有 TUI event translator 投影为与 Runtime 模式等价的 artifact frame。文档和诊断中必须明确标记该模式为 compatibility/debug mode，避免形成长期双写协议。

### 9.3 无图形预览环境

TUI 没有预览器不代表 Artifact 不可交付。能力应分别表达：

```text
artifact.read
artifact.download
artifact.open_external
artifact.preview_inline
artifact.reveal_in_workspace
```

TUI 至少实现 `read/download` 和工作区相对路径输出。

## 10. 服务端多用户与 DocMaster

### 10.1 租户隔离

服务端不能信任客户端或模型提供的路径。每个 Run 必须绑定不可变上下文：

```text
tenant_id
principal_id
workspace_id
session_id
run_id
artifact_namespace
```

Artifact Host Adapter 根据该上下文解析逻辑路径。任何请求都不得通过文件名、相对路径或 Artifact ID 跨越租户和 Workspace。

### 10.2 存储映射

DocMaster 可以选择：

- 租户隔离的本地/网络文件系统；
- 容器或 Pod 的持久卷；
- S3/OSS 等对象存储；
- 数据库元数据加对象存储内容。

无论后端如何实现，对 Agent Core 都呈现同一个 Artifact Host Port。服务端 `relative_path` 是逻辑 Workspace 路径，不保证对应宿主可访问的物理路径。

对象存储实现建议使用：

```text
tenant/<tenant-id>/workspace/<workspace-id>/artifacts/<artifact-id>/<safe-name>
```

对象键不得直接返回给模型或其他租户。

### 10.3 下载与预览授权

- 下载/预览 API 必须按当前 principal 重新授权，不能只验证一个可猜测 Artifact ID；
- 临时下载 URL 必须短时有效、限定对象与用途；
- 元数据查询、分块读取和预览转换都必须携带 Tenant/Workspace scope；
- 服务端 Office 预览应通过隔离转换任务生成派生 Artifact，不在 Web 进程中直接执行不受信任文档；
- 原文件和预览派生文件保留 lineage，但授权不能因派生关系扩大。

### 10.4 配额与滥用防护

服务端 Adapter 必须支持：

- 单文件大小限制；
- 单 Run 成果数量限制；
- 租户总容量和速率限制；
- MIME/扩展名一致性检查；
- 压缩包炸弹和恶意 Office 文档扫描扩展点；
- 发布幂等键，避免 Run 重试生成重复成果；
- staging 超时清理和孤儿对象回收。

Desktop/TUI 本地模式可以使用不同限额，但协议字段和错误码保持一致。

## 11. 安全边界

P1 必须遵守：

1. Artifact publish 只接受当前 Run 允许根目录中的源文件。
2. 发布目标只能由 Host Adapter 在当前 Workspace/Tenant namespace 中解析。
3. Symlink、junction 和重新解析点必须在最终打开文件时重新检查。
4. 校验与复制应防止 TOCTOU；高风险宿主采用句柄或受控 staging。
5. 事件、对话、日志和错误不泄露内部绝对路径。
6. Artifact ID 必须不可预测，并始终配合 Workspace/Tenant 授权。
7. 不执行或自动打开未知成果；外部打开属于独立 Host 能力和用户动作。
8. 文件生成成功不等于发布成功，只有 durable metadata 提交并发出事件后才算交付。

## 12. 兼容与迁移

### 12.1 旧内部 tmp 成果

P1 不自动全盘扫描历史 `runs/**/tmp`，以免把缓存、秘密或中间文件误公开。

可以提供显式的一次性恢复入口：用户选择某个历史 Run 的候选文件后，Runtime 校验所有权、大小和类型，再发布到当前工作区。恢复操作应留下审计记录。

### 12.2 旧 Skill

- 继续支持 Skill 直接写入 `workspace/artifacts`，由运行结束扫描登记；
- 对写入工作区其他位置的文件不自动认定为成果，除非 Skill 调用发布工具；
- 对写入内部 tmp 并在最终回答引用路径的行为产生诊断告警；
- 在后续阶段逐步要求产物型 Skill 声明 `artifact.write` 能力。

### 12.3 API 兼容

保留现有 `artifact.publish` 和 `RuntimeArtifactStore`，P1 优先扩展而不是另建平行存储。`deliver_artifact` 可以作为更高层 Host Port，在完成安全复制后调用现有 store。

## 13. 错误模型

建议统一错误码：

| 错误码 | 含义 |
|---|---|
| `artifact_source_invalid` | 源文件不存在、不是普通文件或已变化 |
| `artifact_source_outside_scope` | 源文件不属于允许目录 |
| `artifact_destination_invalid` | 目标名称或相对路径非法 |
| `artifact_name_conflict` | 冲突策略不允许覆盖 |
| `artifact_quota_exceeded` | 文件、Run 或租户配额超限 |
| `artifact_publish_failed` | 存储提交失败 |
| `artifact_metadata_failed` | 内容已暂存但元数据提交失败，必须回滚 |
| `artifact_not_delivered` | Agent 生成了候选成果但没有发布 |
| `artifact_unavailable` | 已登记成果被删除、移动或存储暂不可用 |
| `artifact_access_denied` | 当前 principal 无权读取 |

用户界面显示可行动信息，详细物理路径只允许进入受控诊断日志。

## 14. 分阶段实施

### P1-A：目录语义与 Core 契约

- 引入 `WorkspaceExecutionContext`/`CodeExecutionContext`；
- 拆分 cwd、scratch、artifact、storage、environment；
- 定义 `deliver_artifact` Host Port 和描述符；
- 修正 Agent 提示；
- 保留现有 Workspace Artifact Store 作为本地持久层。

### P1-B：Desktop 闭环

- CodeExecutor 在默认工作区生成并发布 DOCX；
- `artifact.created` 投影到对话成果卡片；
- 文件侧栏按 Workspace 相对路径增量刷新；
- 实现定位、预览能力判断和下载；
- 中文/空格路径 E2E。

### P1-C：TUI 兼容

- Runtime 模式消费相同 Artifact 事件；
- legacy direct mode 接入 Local Filesystem Artifact Adapter；
- 终端展示相对路径和可用动作；
- Desktop/TUI 同 Workspace/Session 一致性测试。

### P1-D：服务端多租户适配

- 定义 Tenant-scoped Artifact Adapter；
- 完成路径不可见、重新授权、配额和幂等契约测试；
- 提供文件系统与对象存储参考 Adapter 中至少一种；
- 用 DocMaster 风格的两个租户并发场景验证不可串读。

## 15. 测试与验收

### 15.1 Core 单元测试

- 中文、空格、长文件名和 Unicode 正常发布；
- `..`、绝对路径、symlink/junction 越界被拒绝；
- 文件名冲突策略确定且不覆盖；
- copy/move 失败不产生 Artifact 元数据；
- metadata 失败清理 staging；
- 重试使用同一幂等键只产生一个 Artifact；
- 公共描述符和错误不含物理绝对路径。

### 15.2 Desktop E2E

固定场景：在包含中文和空格的默认工作区提交“创建一个宋体短诗 DOCX”。验收：

1. 最终文件位于 `artifacts/短诗_静夜.docx`；
2. 内部 tmp 可有脚本和缓存，但没有被当作最终交付的 DOCX；
3. 恰好产生一个 `artifact.created`；
4. 对话出现成果卡片；
5. 点击卡片可在文件侧栏定位同一文件；
6. 下载内容 SHA-256 与 Workspace 文件一致；
7. 宿主支持 DOCX 预览时可预览，不支持时明确提供下载/外部打开；
8. 最终回答不出现 `.drsai`、`.drsai-dev` 或宿主绝对路径；
9. 不出现“中文路径无法写入”的虚假解释。

### 15.3 TUI E2E

- 在同一中文工作区运行相同任务；
- 输出相对路径和 Artifact ID 对应的可操作结果；
- Desktop attach 后能看到同一成果；
- TUI attach Desktop 发起的 Session 后能读取同一 Artifact；
- legacy mode 与 Runtime mode 的事件字段一致。

### 15.4 DocMaster/服务端契约测试

- 租户 A、B 使用相同文件名同时生成 DOCX，内容和元数据互不覆盖；
- A 无法通过 B 的 Artifact ID、相对路径、对象键或临时 URL 读取 B 的文件；
- Run 重试不会重复计费或生成多个成果；
- 服务重启后 Artifact 元数据与内容仍一致；
- 超配额、恶意路径、异常 MIME 和 staging 中断安全失败；
- API、SSE/WebSocket 事件及日志不泄露服务器物理路径。

## 16. P1 完成定义

只有同时满足以下条件，P1 才能标记完成：

- CodeExecutor 不再把内部 `runs/<user>/tmp` 当作用户成果目录；
- Desktop 默认工作区的最终成果稳定写入并登记到当前 Workspace；
- 对话成果卡片和文件侧栏引用同一 Artifact/文件；
- TUI Runtime 模式使用同一成果事件，legacy mode 有明确兼容 Adapter；
- Core 契约不依赖 Electron、终端或 DocMaster 的具体存储实现；
- 服务端 Adapter 具备 tenant/principal/workspace 三层授权与路径隔离；
- 中文和空格路径、重试、冲突、失败回滚、跨租户拒绝均有自动化测试；
- 用户可见消息和公共协议不暴露内部或宿主绝对路径；
- 现有 `artifact.publish`、Artifact Store 和 Runtime conversation projection 没有被平行实现取代。

## 17. 建议首批代码落点

优先检查和修改：

- `drsai/modules/agents/skills_agent/drsai_assistant.py`：CodeExecutor 默认目录和执行上下文；
- `drsai/modules/agents/skills_agent/managers/user_profile_manager.py`：内部目录提示语义；
- `drsai/modules/agents/skills_agent/managers/get_managers_tools.py`：拆分 environment 与 process cwd；
- `drsai/backend/run_drsai_agent_factory.py`：构建统一 WorkspaceExecutionContext；
- `drsai/backend/runtime/artifacts.py`：扩展安全发布、幂等和 Host Adapter 接口；
- `drsai/backend/gateway.py`：发布端口、结束兜底扫描和 Artifact 事件；
- `drsai/backend/tui_gateway/adapter/event_translator.py`：TUI artifact frame；
- Desktop Renderer：Conversation Artifact Part、文件侧栏定位和预览能力投影。

实施时应先建立 Core 契约和测试，再接 Desktop UI；不要先在 Renderer 中解析路径做临时联动，否则会把当前目录问题固化成 Desktop 专用协议。
