# 远程 FilesEvent（url / base64）桌面端渲染与下载 — 变更说明（方案 A）

- 日期：2026-09-18
- 范围：`apps/desktop`（Electron 前端）↔ `cores/python/packages/drsai/src/drsai/backend/{events,desktop_gateway}`
- 目标：让**远程 `DrSaiAssistant.on_messages_stream` 发出的 `FilesEvent`**（携带 `url` 或 `base64_content`）能在桌面端**渲染卡片并下载/预览**

---

## 1. 背景：为什么之前渲染不出来

远程 agent 产出的 `FileInfo` 形如：

```python
FileInfo(
    name="短诗.docx",
    url=<HepAI 文件 URL>,        # 或 base64_content=<base64>（上传失败回退）
    download_method="url"|"base64",
    size=..., mime_type=..., path=<远程机器路径>,
)
```

它要在桌面上显示，必须依次穿过四层，而旧实现有两个**丢字段**点：

| 环节 | 文件 | 旧行为 | 后果 |
|---|---|---|---|
| 1. 事件翻译 | `backend/events/agent_event_translator.py` | 只映射 `url`；**丢弃 `base64_content` 和 `download_method`** | base64 文件彻底丢失 |
| 2. 网关 → OAEP item | `backend/runtime/oaep.py: project_item` | artifact 分支**只拷贝 `artifact_id/name/path/mime/size/sha256/previewable/downloadable`**；`path` 被削成文件名；`url`/`base64` 不拷贝 | url 文件也丢失 |
| 3. 冻结 Schema | `cores/protocol/oaep/oaep.schema.json` `artifactContent`（`unevaluatedProperties: false`） | **协议根本不含 `url`/`base64_content` 字段** | 无法直接透传 |
| 4. 桌面渲染 | `StructuredMessageParts.tsx` | 交付文件区被 `turn.status === "completed"` 门控；预览/下载依赖 `part.path` | 卡片不显示或点了无反应 |

**结论**：不是前端缺渲染组件（`ArtifactItem` / `structured-result-files` / 预览 / 下载都齐全），而是 **`url`/`base64` 在链路中被丢弃，且 OAEP 冻结 schema 不容许这两个字段**。

---

## 2. 方案 A 核心思路

**不扩协议，在网关边界做一次转换**：把远程内容抓下来/解码后，落成本地 Workspace Artifact，再发出**标准 `artifact.created`**。

- `download_method="base64"` → 网关解码 base64 → 落盘
- `download_method="url"` → 网关下载 URL → 落盘
- 落盘后复用平台已有的 artifact 能力（预览 / 下载 / 卡片）

优点：不触碰 `x-status: stable` 的冻结 OAEP schema；避免把大 base64 灌进会话流/journal；桌面端 100% 复用现有渲染与下载链路。

---

## 3. 改动清单

### 3.1 翻译层：保留远程内容字段
**文件**：`cores/python/packages/drsai/src/drsai/backend/events/agent_event_translator.py`（`FilesEvent` 分支）

```python
download_method = str(getattr(file_info, "download_method", "url") or "url")
downloadable = getattr(file_info, "downloadable", None)
if downloadable is None:
    # url/base64 本身可交付；仅显式 False（内部 tool 输出旁路）才禁用
    downloadable = download_method in {"url", "base64"}
...
out.append(("artifact.created", {
    ...
    "url": getattr(file_info, "url", None),
    "base64_content": getattr(file_info, "base64_content", None),   # 新增
    "download_method": download_method,                             # 新增
    "downloadable": downloadable,                                   # 语义修正
    ...
}))
```

> `path`（远程机器路径）**故意不转发**：对客户端无意义且不安全。

### 3.2 新增网关落盘模块
**文件**：`cores/python/packages/drsai/src/drsai/backend/desktop_gateway/_remote_files.py`（新文件）

| 函数 | 作用 |
|---|---|
| `materialize_remote_file(context, payload)` | base64 解码 / url 下载 → `RuntimeArtifactStore.publish_content(...)` → 返回标准 artifact 描述符（带本地 `path`、`sha256`、`downloadable`）；非远程 payload 返回 `None` |
| `try_materialize(context, payload)` | best-effort 包装：**任何失败都返回 `None`，绝不让文件抓取失败导致整轮 Run 失败** |

安全与限额：
- URL 仅允许 `http://` / `https://`（其余 scheme 拒绝）
- 下载上限 `MAX_REMOTE_BYTES = 64 MB`，超时 60s，`Content-Length` 预检 + 多读 1 字节越界检测
- 文件名做路径穿越清洗（`../../etc/passwd` → `passwd`）
- base64 长度预检、非法 base64 拒绝

### 3.3 两个后端接入
**文件**：
- `cores/python/packages/drsai/src/drsai/backend/desktop_gateway/_remote_worker_backend.py`（远程 HepAI/DDF worker）
- `cores/python/packages/drsai/src/drsai/backend/desktop_gateway/_agent_backend.py`（本地 DrSaiAssistant，本地 skill 也可能发同形 FilesEvent）

在 emit 循环拦截 `artifact.created`：

```python
elif kind == "artifact.created":
    materialized = _remote_files.try_materialize(context, data)
    services.emit(context, kind, materialized if materialized is not None else data)
    continue
```

- 成功：发落盘后的描述符（本地可预览/下载）
- 失败 / 非远程：**原样透传**原 payload（元数据卡片仍渲染，不丢信息）

### 3.4 桌面端
**文件**：`apps/desktop/shared/renderer/src/components/StructuredMessageParts.tsx`

```diff
-const deliveryArtifactParts = turn.status === "completed"
+// 一旦 turn 不再 pending 就展示交付文件；远程 agent 可能先交付文件、再失败/暂停/取消
+const deliveryArtifactParts = turn.status !== "pending"
   ? selectDeliveryArtifacts(artifactParts)
   : [];
```

预览/下载**无需改动**：落盘后的 artifact 带 `resourceRef`，桌面既有的
`conversationResourceRequest` → OWOP `artifact.metadata` / `artifact.chunk` 链路已支持
`storage_kind === "runtime"`（见 `shared/main/oaepOwopResources.ts`）。

### 3.5 测试
**文件**：`cores/python/packages/drsai/tests/desktop_gateway/test_remote_files.py`（新文件）

覆盖：translator 保留 url/base64/内部 spill；materialize 的 base64/url/本地 payload/危险文件名/scheme 拒绝/try 不抛异常。

---

## 4. 端到端效果

```
远程 DrSaiAssistant.on_messages_stream
  └─ FilesEvent(url=... 或 base64_content=...)
       └─ translate()  → artifact.created（保留 url/base64/download_method）
            └─ 网关 try_materialize()
                 ├─ 成功：publish_content 落成本地 artifact → 发标准 artifact.created
                 └─ 失败：原样透传（元数据卡片照常显示）
                      └─ OAEP artifact item（resource_refs → artifact_id）
                           └─ 桌面 ArtifactItem 卡片：预览 + 下载 ✅
```

---

## 5. 验证结果（本机）

| 项 | 结果 |
|---|---|
| translator：url / base64 / 内部 spill | ✅ 通过 |
| materialize：base64 解码落盘 | ✅ 通过 |
| materialize：url 下载落盘 | ✅ 通过 |
| materialize：本地 payload 返回 None | ✅ 通过 |
| materialize：危险文件名清洗 | ✅ 通过 |
| materialize：非 http(s) scheme 拒绝 | ✅ 通过 |
| `try_materialize` 不抛异常 | ✅ 通过 |
| 桌面 `npm run typecheck:windows` | ✅ 通过（无 TS 报错） |

---

## 6. 需在你自己的开发环境补跑（本机缺 pytest/ruff）

本机 venv（`D:\software\opendrsai\drsai-agent\venv`）未安装 `pytest`、`ruff`，且 `drsai` 为非编辑态安装，因此用独立脚本完成了等价验证。正式验收请执行：

```bash
pip install -e "cores/python/packages/drsai[all]"

cd cores/python/packages/drsai
python -m pytest tests/desktop_gateway/test_remote_files.py -xvs
ruff format src/drsai/backend/desktop_gateway/_remote_files.py
ruff check src/drsai/backend/desktop_gateway/ src/drsai/backend/events/agent_event_translator.py
```

建议端到端复验：让远程 worker（或 `RemoteWorkerBackend(runner=...)` 注入假流）产出
`FilesEvent(url=...)` 与 `FilesEvent(base64_content=...)` 各一条，断言：
1. `artifact.created` 进入 runtime_events；
2. OAEP item `type="artifact"` 且 `content` 含 `name/path/sha256`（落盘）/ `resource_refs`；
3. 桌面 `ArtifactItem` 可预览 + 下载。

---

## 7. 已知边界

- **图标缩略图**：runtime 存储（`storage_kind="runtime"`）的图片 artifact 没有 `part.path`，
  卡片不显示内联缩略图，但**点击预览与下载正常**（走 OWOP `artifact.chunk`）。
  如需缩略图，可后续在 `ArtifactItem` 增加"按 resourceRef 拉取图片缩略图"的降级分支（本次未做）。
- **URL 语义**：方案 A 会把远程 URL 内容抓成本地副本；若产品希望卡片保留**外链**而非落盘，
  需要另走"扩展 OAEP schema（方案 B）"，本次未采用。
