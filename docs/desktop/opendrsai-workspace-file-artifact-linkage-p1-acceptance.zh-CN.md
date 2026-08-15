# OpenDrSai 工作区文件与成果联动 P1 验收记录

> 状态：通过  
> 验收日期：2026-08-15  
> 对应方案：`opendrsai-workspace-file-artifact-linkage-p1-plan.zh-CN.md`

## 验收结论

P1 闭环已实现：Agent 的最终交付物进入逻辑 Workspace 的 `artifacts/` 命名空间，由 Runtime 注册并投影为结构化 Artifact；Desktop、TUI 和服务端多租户宿主消费同一份公开描述符，不把 run tmp 或宿主绝对路径当成交付链接。

## 能力矩阵

| 范围 | 验收结果 |
|---|---|
| 执行上下文 | 子进程 `cwd` 指向用户 Workspace；venv、配置、缓存与 scratch 保持内部隔离 |
| Artifact 发布 | 支持 copy/move、幂等、并发去重、原子无覆盖发布、哈希与 MIME、配额、staging 清理和失败回滚 |
| Runtime 事件 | 发布后产生结构化 `artifact.created`；结束扫描仅补登记本轮新增或变更成果 |
| Desktop | 对话成果卡支持预览、在文件中显示、下载/另存；文件移动或删除后显示不可用状态 |
| Desktop 文件栏 | 使用 Workspace 相对路径定位同一物理文件，不创建聊天附件副本 |
| TUI | 投影同一 Artifact 事件，并提供受限的 metadata/chunk 与 `/artifact <id>` 访问方式 |
| 服务端/DocMaster | Tenant Host Adapter 执行租户隔离、授权、限流、容量、MIME 一致性和恶意内容扫描；公开契约不含宿主绝对路径 |
| 路径兼容 | 中文、空格、长 Unicode 名称和 Windows 保留设备名均有覆盖 |

## 自动化证据

- Python 核心与跨宿主定向套件：45 passed，1 skipped（符号链接能力不可用时跳过）。
- Desktop Web 与 Node TypeScript 编译：通过。
- Desktop 静态 P1 联动校验：22/22 通过。
- 打包态 `workspace-artifact-p1`：通过。实际覆盖中文且含空格的工作区、`artifacts/短诗_静夜.docx`、Office 预览、另存、扩展名保留及源/目标 SHA-256 一致。
- 打包态证据位于 `release/product-evidence/p1-workspace-artifact/`。

## 安全与资源边界

- 仅允许 Workspace 根内来源；拒绝穿越、符号链接逃逸与 TOCTOU 变化。
- 公开描述符仅暴露 `artifact_id`、Workspace 相对路径或 Runtime opaque ID，不暴露 `DRSAI_HOME/workspace/runs/.../tmp`。
- 单文件、单 run、Workspace/租户总容量和租户速率均受限。
- Workspace 兼容扫描限制为 10,000 个候选、最多记录 2,000 个成果；TUI legacy ID 查询限制候选数量和单文件大小。

## 非 P1 范围

不包含 Office 原生编辑器、对象存储产品化运维界面或解析最终自然语言回答中的裸路径。后续宿主只需实现 Artifact Host Port，无需复制 Desktop 的 Electron 私有接口。
