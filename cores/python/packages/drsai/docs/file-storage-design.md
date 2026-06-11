# 文件存储系统设计文档

> 版本：v3 | 对应实现分支当前 commit  
> 涉及路径：`drsai/modules/managers/file_storage/`、`drsai/backend/routes/file_storage.py`、`drsai/backend/app_worker.py`、`drsai/backend/run.py`、`drsai/modules/agents/drsai_worker_agent.py`

---

## 目录

1. [整体架构](#1-整体架构)
2. [工作目录结构](#2-工作目录结构)
3. [存储层：Provider × Backend 二维模型](#3-存储层provider--backend-二维模型)
4. [Backend 实现](#4-backend-实现)
   - [LocalFileStorage](#41-localfilestorage)
   - [GFSFileStorage](#42-gfsfilestorage)
   - [GFSMountFileStorage](#43-gfsmountfilestorage)
   - [HepAIFilesStorage](#44-hepaifiles-storage)
5. [GFS 挂载方案](#5-gfs-挂载方案)
   - [用户级工作区挂载（私有）](#51-用户级工作区挂载私有)
   - [公共 GFS 挂载（共享）](#52-公共-gfs-挂载共享)
6. [REST API 层](#6-rest-api-层)
7. [Agent Worker 侧（run.py）](#7-agent-worker-侧runpy)
8. [Agent 客户端侧（drsai_worker_agent.py）](#8-agent-客户端侧drsai_worker_agentpy)
9. [WebUI 代理层（files.py）](#9-webui-代理层filespy)
10. [前后端文件传输完整链路](#10-前后端文件传输完整链路)
11. [配置参考](#11-配置参考)
12. [安全机制](#12-安全机制)
13. [代码文件索引](#13-代码文件索引)

---

## 1. 整体架构

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  前端（Browser）                                                              │
└──────────────────────┬───────────────────────────────────────────────────────┘
                       │ HTTP (multipart upload / 目录浏览 / 预签名重定向)
┌──────────────────────▼───────────────────────────────────────────────────────┐
│  WebUI Backend（FastAPI）                                                     │
│  apps/webui/backend/.../routes/files.py                                       │
│                                                                              │
│  /api/files/v3/{workspace|shared|attachments}/*                              │
│       ↓ _proxy_get / httpx 转发                                              │
│  _AGENT_REST_BASE (= DRSAI_AGENT_REST_BASE env, 默认 localhost:8000/apiv2)   │
└──────────────────────┬───────────────────────────────────────────────────────┘
                       │ HTTP 转发
┌──────────────────────▼───────────────────────────────────────────────────────┐
│  Agent Worker REST（DrSaiAPP / FastAPI）                                     │
│  drsai/backend/app_worker.py + drsai/backend/routes/file_storage.py          │
│                                                                              │
│  /apiv2/workspace/*   → PrivateWorkspaceStorage (LocalFileStorage / GFS)    │
│  /apiv2/shared/*      → PublicSharedStorage     (GFSFileStorage, 可选)      │
│  /apiv2/attachments/* → AttachmentsStorage      (HepAIFilesStorage / GFS)   │
└──────────────────────┬───────────────────────────────────────────────────────┘
                       │ 调用
┌──────────────────────▼───────────────────────────────────────────────────────┐
│  File Storage Layer                                                          │
│  drsai/modules/managers/file_storage/                                        │
│                                                                              │
│  BaseFileStorage (协议)                                                      │
│    ├── LocalFileStorage      ← 单机本地文件系统                              │
│    ├── GFSFileStorage        ← GFS S3 API 直连                              │
│    ├── GFSMountFileStorage   ← GFS FUSE 挂载（继承 Local）                  │
│    └── HepAIFilesStorage     ← HepAI Files API                             │
└──────────────────────────────────────────────────────────────────────────────┘
                       │
         ┌─────────────┴──────────────────┐
         ▼                                ▼
┌────────────────┐             ┌──────────────────────┐
│ 本地文件系统    │             │ GFS 对象存储          │
│ ~/.drsai/      │             │ gfs.ihep.ac.cn        │
│ workspace/     │             │ S3 兼容 API + FUSE    │
│ runs/<uid>/    │             │ endpoint:7100 (内网)  │
└────────────────┘             └──────────────────────┘
```

**核心设计原则**：
- **Protocol × Backend 分离**：`BaseFileStorage` 是唯一协议接口，4 种 backend 可互换。
- **Provider 注入命名空间**：workspace（`namespace=user_id`）、shared（`namespace=""`）、attachments（`namespace=user_id`）通过工厂 monkey-patch 实现，避免 4×3=12 个子类。
- **大文件不走 RPC**：二进制传输走 REST 端点直传，Agent Worker 的 `remote_callable` 仅用于元数据查询和事件通知。
- **凭证泄露检测**：工作区整体暴露给用户，写方向强制扫描文件名后缀与内容前 4KB。

---

## 2. 工作目录结构

Agent 运行时的物理工作目录由 `drsai/configs/constant.py` 定义：

```python
FS_DIR             = ~/.drsai/                          # DrSai 根目录
WORKSPACE_DIR      = ~/.drsai/workspace/                # workspace 根
WORKSPACE_RUNS_DIR = ~/.drsai/workspace/runs/           # 每用户工作区根

# 每个用户的实际工作目录：
~/.drsai/workspace/runs/<user_id>/
├── configs/
│   ├── MEMORY.md          ← Agent 记忆
│   ├── USER.md            ← 用户画像
│   ├── AGENTS.md          ← 系统提示词
│   ├── TOOLS_CONFIG.json  ← ⚠️ 可能含 MCP token（高风险，写方向凭证检测）
│   ├── SUBAGENT_CONFIG.json
│   ├── THREAD_CONFIG.json
│   └── skills/            ← 用户 skill 代码
├── tmp/                   ← 工具调用临时文件
└── downloads/             ← Agent 下载的附件
```

**设计决策**：整个 `~/.drsai/workspace/runs/<user_id>/` 作为用户可见工作区暴露，**不做子目录隐藏**。这是单租户场景下的简单心智模型。多租户/Team 模式需回收为分层模型。

`apps/webui/run_drsai_agent.py` 的启动代码：

```python
from drsai.configs.constant import WORKSPACE_RUNS_DIR

WORKDIR = Path(WORKSPACE_RUNS_DIR)   # ~/.drsai/workspace/runs

DrSaiAssistant(work_dir=WORKDIR, ...)
```

---

## 3. 存储层：Provider × Backend 二维模型

### 3.1 三类语义 Provider

| Provider | REST 段 | namespace_of(uid) | presign_share | 典型 backend |
|----------|---------|------------------|---------------|-------------|
| `PrivateWorkspaceStorage` | `/apiv2/workspace/*` | `uid`（每人独立） | 始终 `None`（禁止分享） | `local` / `gfs_mount` / `gfs` |
| `PublicSharedStorage` | `/apiv2/shared/*` | `""`（全员共用） | 委托 `presign_get`（长效） | `gfs` |
| `AttachmentsStorage` | `/apiv2/attachments/*` | `uid` | 返回 preview URL | `hepai_files` / `gfs` |

Provider 不是类继承，而是通过工厂函数 monkey-patch `namespace_of` 和 `presign_share` 实现：

```python
# drsai/modules/managers/file_storage/providers.py

def make_private_workspace(cfg: ProviderConfig) -> BaseFileStorage:
    storage = create_storage(cfg)
    storage.namespace_of = lambda uid: uid        # 每人独立命名空间
    storage.presign_share = lambda *a, **kw: None # 禁止外部分享
    return storage

def make_public_shared(cfg: ProviderConfig) -> BaseFileStorage:
    storage = create_storage(cfg)
    storage.namespace_of = lambda uid: ""         # 全员共用根
    # presign_share 委托 presign_get（local 返回 None，GFS 返回长效 URL）
    async def _share(user_id, file_path, ttl=None):
        effective_ttl = ttl if ttl is not None else cfg.presign_default_ttl
        return await storage.presign_get(user_id, file_path, effective_ttl)
    storage.presign_share = _share
    return storage
```

### 3.2 三类 Provider 容器

```python
# DrSaiAPP 持有
class FileStorageProviders:
    private_workspace: BaseFileStorage  # 始终存在
    public_shared: Optional[BaseFileStorage]  # None = 不启用 /shared 路由
    attachments: BaseFileStorage        # 始终存在

# 从配置创建
providers = FileStorageProviders.from_config(FileStorageConfig())
```

### 3.3 注册表

```python
# drsai/modules/managers/file_storage/registry.py

FILE_STORAGE_BACKENDS: Dict[str, Type[BaseFileStorage]] = {
    "local":       LocalFileStorage,
    "gfs":         GFSFileStorage,
    "gfs_mount":   GFSMountFileStorage,
    "hepai_files": HepAIFilesStorage,
}

# 懒加载：首次调用 create_storage 时才 import 对应模块
def create_storage(config: ProviderConfig) -> BaseFileStorage:
    _ensure_backend_loaded(config.backend)
    return FILE_STORAGE_BACKENDS[config.backend](config)
```

---

## 4. Backend 实现

### 4.1 LocalFileStorage

**文件**：`drsai/modules/managers/file_storage/local.py`

适用于单机部署，工作区文件存在本地磁盘。

```
物理路径 = config.base_dir / namespace_of(user_id) / rel_path
         = ~/.drsai/workspace/runs / user_id / configs/MEMORY.md
```

| 操作 | 实现 |
|------|------|
| `list_dir` | `os.scandir` + cursor 分页（cursor = 上一页末尾文件名） |
| `head_file` | `os.stat` + 惰性 md5（仅 head_file 时计算） |
| `open_read` | `aiofiles.open` 异步生成器，64KB chunk |
| `open_write` | 缓冲前 8KB 做凭证检测，`aiofiles` 写入，计算 md5 etag |
| `presign_get/put` | 返回 `None`（local 走 `/files/raw` 流式端点） |
| `stat_quota` | `os.walk` 遍历（在线程池中执行），`total_bytes=-1`（无限制） |

**etag 规则**：`md5hex(文件内容)`，写入时实时计算，与 GFS 的 S3 ETag 语义不同（注意跨 backend 迁移时不可做 etag 等值比较）。

### 4.2 GFSFileStorage

**文件**：`drsai/modules/managers/file_storage/gfs.py`

通过 S3 SigV4 协议直连 GFS 内部端点（`http://gfs.ihep.ac.cn:7100`）进行文件操作。

```
Object key = namespace / rel_path
           = user_id / configs/MEMORY.md          （workspace）
           = datasets/large_sample.h5              （shared，namespace 为空）
```

```python
# 初始化时创建两个 S3 客户端
self._s3        = GFSS3Client(endpoint=gfs_auth.endpoint_internal, ...)  # 数据读写
self._s3_public = GFSS3Client(endpoint=gfs_auth.endpoint_public,  ...)  # presign URL
```

| 操作 | 实现 |
|------|------|
| `list_dir` | `ListObjectsV2`，`continuation-token` 分页，按 `/` 分割解析子目录 |
| `head_file` | `HEAD` 请求 |
| `open_read` | `GET` 流式下载，逐 chunk yield |
| `open_write` | < `multipart_threshold`(50MB)：`PUT`；> 阈值：S3 multipart upload |
| `presign_get` | `_s3_public.presign_url(key, "GET", ttl)` |
| `presign_put` | `_s3_public.presign_url(key, "PUT", ttl)` |
| `stat_quota` | 遍历命名空间下所有对象累加 `size` |

**SigV4 签名**：`gfs_client.py` 手写实现（不依赖 boto3），支持请求头签名（数据传输）和 query-string 签名（presign URL）。

**GFS 管理 API**（`GFSAdminClient`，`http://gfs.ihep.ac.cn:7800`）：
- 认证：`X-API-Key: gfs-ihep-ccstor-api`
- 用于初始化：为每个 DrSai 实例（或每个用户）创建 GFS user / bucket / AKSK
- `ensure_user_bucket_aksk(email)` — 幂等高层接口，返回可用的 AK/SK/bucket

### 4.3 GFSMountFileStorage

**文件**：`drsai/modules/managers/file_storage/gfs_mount.py`

继承 `LocalFileStorage`，在 GFS FUSE 挂载点（`jcli mount` 挂载的目录）上操作文件。Agent 进程可以像操作本地文件一样直接使用 POSIX API（`open`/`read`/`write`）读写 GFS。

额外保护层：

```python
def _check_mount(self) -> None:
    if not os.path.ismount(str(self._base_dir)):
        raise FileStorageError("backend_unavailable", "GFS 挂载点不可用")

async def list_dir(self, ...):
    self._check_mount()
    return await asyncio.wait_for(super().list_dir(...), timeout=30)  # 超时保护

async def open_write(self, user_id, file_path, data, ...):
    self._check_mount()
    target = self._resolve(user_id, file_path)
    if os.path.islink(str(target)):          # 拒绝符号链接逃逸
        raise FileStorageError("invalid_path", "符号链接不被允许")
    return await super().open_write(...)
```

`presign_get/put` 返回 `None`（挂载模式不生成预签名 URL，下载走 `/files/raw` 流式端点）。

### 4.4 HepAIFiles Storage

**文件**：`drsai/modules/managers/file_storage/hepai_files.py`

将 HepAI Files API 包装成 `BaseFileStorage` 协议，主要用于聊天附件。

```
path 约定：hepai://{file_id}/{filename}
           hepai://file-8572b27d093f4e15/data.h5
```

| 操作 | 实现 |
|------|------|
| `open_write` | `POST {api_base}/files`（multipart/form-data）→ 返回 file_id |
| `open_read` | `GET {api_base}/files/{file_id}/content`（需 API key）→ 流式 |
| `head_file` | `GET {api_base}/files/{file_id}` → 元信息 |
| `presign_share` | 返回 `{api_base}/files/{file_id}/preview`（长效，无需 API key） |
| `list_dir` | 返回空列表（无目录概念，由 DB 元数据查询代替） |
| `stat_quota` | `total_bytes=-1`（HepAI 不提供配额） |

API key 从 `config.extra["api_key"]` 或环境变量 `HEPAI_API_KEY` 获取。

---

## 5. GFS 挂载方案

### 5.1 用户级工作区挂载（私有）

**场景**：Agent 机器上用 GFS FUSE 挂载 `~/.drsai/workspace/runs/`，所有用户的工作区通过单一挂载点访问。

```bash
# 1. 配置 jcli 客户端（一次性）
jcli auth login \
  --access-key <AK> \
  --secret-key <SK> \
  --endpoint http://gfs.ihep.ac.cn:7100

# 2. 挂载（后台 daemon 模式）
jcli mount \
  --bucket drsai-workspaces \
  --mountpoint ~/.drsai/workspace/runs \
  --daemon

# 3. 验证挂载
mount | grep drsai
ls ~/.drsai/workspace/runs/
```

挂载后目录结构：

```
~/.drsai/workspace/runs/        ← FUSE 挂载点 = GFS bucket 根
├── xiongdb/                    ← GFS object prefix: xiongdb/
│   ├── configs/MEMORY.md       ← GFS object key:  xiongdb/configs/MEMORY.md
│   └── downloads/
└── bob/
    └── configs/
```

DrSai 配置（`.env`）：

```bash
PRIVATE_WORKSPACE_BACKEND=gfs_mount
PRIVATE_WORKSPACE_BASE_DIR=~/.drsai/workspace/runs
```

**权限隔离**：bucket 下所有用户共享同一挂载，隔离完全依赖 `GFSMountFileStorage._normalize_path` 在 namespace 级别的路径约束（`base_dir / user_id / ...`），FUSE 层本身不提供用户隔离。

**挂载断开处理**：`_check_mount()` 在每次操作前检测 `os.path.ismount`，断开后立即返回 `backend_unavailable(503)` 而不是文件找不到或奇怪的 I/O 错误。

### 5.2 公共 GFS 挂载（共享）

**场景**：机构内公共数据集、共享 skill、团队共享文件。

```bash
# 公共 bucket 挂载（也可以用 S3 API 直连，不挂载）
jcli mount \
  --bucket drsai-public \
  --mountpoint ~/.drsai/workspace/shared \
  --daemon
```

DrSai 配置（`.env`）：

```bash
PUBLIC_SHARED_BACKEND=gfs
PUBLIC_SHARED_GFS_BUCKET=drsai-public
PUBLIC_SHARED_GFS_AK=<access_key>
PUBLIC_SHARED_GFS_SK=<secret_key>
PUBLIC_SHARED_GFS_ENDPOINT_INTERNAL=http://gfs.ihep.ac.cn:7100
PUBLIC_SHARED_GFS_ENDPOINT_PUBLIC=https://fgws3-gfs.ihep.ac.cn
PUBLIC_SHARED_PRESIGN_SHARE_TTL=0      # 0 = 永久链接
```

公共空间的 `namespace_of` 返回 `""`，所有用户共用同一路径前缀。ACL 由业务层控制（目前无细粒度 ACL，后续可基于 user_id 做白名单检查）。

### 5.3 分布式部署（Agent 机器 + WebUI 机器分离）

```
┌────────────────────────┐         ┌──────────────────────────┐
│  Agent 机器            │         │  WebUI 机器              │
│  GFSMountFileStorage   │         │  GFSFileStorage          │
│  (FUSE 挂载，POSIX 读写)│         │  (S3 API 直连)           │
│                        │         │                          │
│  ~/.drsai/workspace/   │◄───────►│  bucket: drsai-workspaces│
│  runs/<uid>/           │  同一GFS │                          │
└────────────────────────┘  bucket └──────────────────────────┘
```

Agent 机器配置：
```bash
PRIVATE_WORKSPACE_BACKEND=gfs_mount
PRIVATE_WORKSPACE_BASE_DIR=~/.drsai/workspace/runs
```

WebUI 机器配置：
```bash
PRIVATE_WORKSPACE_BACKEND=gfs
PRIVATE_WORKSPACE_GFS_BUCKET=drsai-workspaces
PRIVATE_WORKSPACE_GFS_AK=<ak>
PRIVATE_WORKSPACE_GFS_SK=<sk>
PRIVATE_WORKSPACE_GFS_ENDPOINT_INTERNAL=http://gfs.ihep.ac.cn:7100
PRIVATE_WORKSPACE_GFS_ENDPOINT_PUBLIC=https://fgws3-gfs.ihep.ac.cn
DRSAI_AGENT_REST_BASE=http://<agent-host>:8000/apiv2
```

**注意**：GFS PUT→GET 强一致，PUT→LIST 最终一致。WebUI 上传完成后不要依赖立即 list 刷新，直接用 `open_write` 返回的 `FileInfo` 做乐观 UI 更新。

---

## 6. REST API 层

**文件**：`drsai/backend/routes/file_storage.py`

`register_file_routes(router, prefix, storage, provider_tag)` 工厂函数，为任意 `BaseFileStorage` 实例注册完整端点集合。

### 6.1 端点表

所有端点均以 `/apiv2` 为前缀（由 `DrSaiAPP.router` 的 `prefix` 决定）：

| 方法 | 路径 | 说明 | 返回 |
|------|------|------|------|
| `GET` | `/{seg}/files` | 目录列举（分页） | `DirectoryListing` |
| `HEAD` | `/{seg}/files` | 文件元信息（headers） | 空 body + X-File-* headers |
| `GET` | `/{seg}/files/raw` | 流式下载 | `StreamingResponse` |
| `GET` | `/{seg}/files/url` | presign_get 下载 URL | `{"url": str \| null}` |
| `GET` | `/{seg}/files/share` | presign_share 分享 URL | `{"url": str \| null}` 或 403 |
| `POST` | `/{seg}/files` | 上传文件（multipart/form-data） | `FileInfo` |
| `POST` | `/{seg}/multipart/init` | 大文件分片上传初始化 | `MultipartInit` |
| `POST` | `/{seg}/multipart/{id}/part` | 上传单个分片 | `{"etag": str}` |
| `POST` | `/{seg}/multipart/{id}/complete` | 合并分片完成上传 | `FileInfo` |
| `POST` | `/{seg}/notify` | Agent 写入完成后通知 | `{"ok": true}` |
| `GET` | `/{seg}/quota` | 存储配额 | `QuotaInfo` |
| `GET` | `/{seg}/info` | Provider 基础信息 | `{provider, backend, role, root_display}` |

其中 `{seg}` = `workspace` / `shared` / `attachments`。

### 6.2 错误码 → HTTP 状态码

```python
_ERROR_HTTP_MAP = {
    "not_found":               404,
    "forbidden":               403,
    "invalid_path":            403,
    "conflict":                409,
    "quota_exceeded":          413,
    "too_large":               413,
    "credential_leak_suspect": 409,
    "backend_unavailable":     503,
}
```

`credential_leak_suspect` 返回 409（与 conflict 相同码），body 带 hint：
```json
{"code": "credential_leak_suspect", "hint": "add force_credential_leak=true to override"}
```

### 6.3 DrSaiAPP 注册

**文件**：`drsai/backend/app_worker.py`

```python
class DrSaiAPP(DrSai):
    def __init__(self, file_storage_config=None, **kwargs):
        ...
        # 初始化三个 Provider
        self._file_storage_providers = FileStorageProviders.from_config(file_storage_config)
        self._init_router()

    def _init_router(self):
        ...
        providers = self._file_storage_providers
        # 始终注册 workspace 和 attachments 路由
        register_file_routes(router, "/workspace",   providers.private_workspace, "workspace")
        register_file_routes(router, "/attachments", providers.attachments,       "attachments")
        # 公共共享可选（public_shared=None 时不注册 /shared 路由）
        if providers.public_shared:
            register_file_routes(router, "/shared", providers.public_shared, "shared")
```

---

## 7. Agent Worker 侧（run.py）

**文件**：`drsai/backend/run.py`，类 `DrSaiWorkerModel`

在 Agent Worker（HepAI Worker 格式）上暴露 5 个 `remote_callable`，供客户端通过 HepAI RPC 调用（仅元数据，不传二进制）：

```python
class DrSaiWorkerModel(HRModel):

    @HRModel.remote_callable
    async def list_files(self, segment, user_id, sub_path="", cursor=None, limit=200) -> dict:
        """返回 {"status": True, "data": DirectoryListing.dict}"""

    @HRModel.remote_callable
    async def head_file(self, segment, user_id, file_path) -> dict:
        """返回 {"status": True, "data": FileInfo.dict}"""

    @HRModel.remote_callable
    async def presign_get(self, segment, user_id, file_path, ttl=3600) -> dict:
        """返回 {"status": True, "url": str | None}"""

    @HRModel.remote_callable
    async def presign_share(self, segment, user_id, file_path, ttl=None) -> dict:
        """返回 {"status": True, "url": str | None}（workspace 始终 None）"""

    @HRModel.remote_callable
    async def notify_file_uploaded(self, segment, user_id, file_path,
                                   size=0, etag=None, source="webui") -> dict:
        """触发 FileEvent，广播给活跃 session 的 model_context"""

    def _get_file_storage(self, segment: str) -> BaseFileStorage:
        """根据 segment 名称从 DrSaiAPP._file_storage_providers 取对应 Provider。"""
        mapping = {
            "workspace":   providers.private_workspace,
            "shared":      providers.public_shared,
            "attachments": providers.attachments,
        }
        ...
```

**关键设计**：
- 没有 `chat_id` 参数（文件操作是进程级单例，不绑定 session）
- 所有方法返回 `{"status": bool, ...}`，失败不抛异常，由调用方检查 `status`
- 二进制传输不走 RPC（避免 base64 30% 膨胀），走 REST `/files/raw` 流式端点

---

## 8. Agent 客户端侧（drsai_worker_agent.py）

**文件**：`drsai/modules/agents/drsai_worker_agent.py`，类 `HepAIWorkerAgent`

通过 `_funcs_map`（`get_worker_sync_functions` 加载的同步函数 + `asyncio.to_thread` 异步化）调用 Worker 的 `remote_callable`：

```python
class HepAIWorkerAgent(DrSaiAgent):

    async def list_remote_files(self, segment, user_id, sub_path="",
                                cursor=None, limit=200, timeout=30.0):
        fn = self._funcs_map.get("list_files")
        if fn is None:
            return {"status": False, "message": "Remote worker does not expose list_files"}
        return await asyncio.wait_for(
            asyncio.to_thread(fn, segment=segment, user_id=user_id, ...),
            timeout=timeout
        )

    async def head_remote_file(self, segment, user_id, file_path, timeout=15.0): ...
    async def get_remote_file_url(self, segment, user_id, file_path, ttl=3600, ...): ...
    async def get_remote_share_url(self, segment, user_id, file_path, ttl=None, ...): ...
    async def notify_remote_file_uploaded(self, segment, user_id, file_path,
                                          size=0, etag=None, source="webui", ...): ...
```

**注意事项**：
- **不传 `chat_id`**（文件操作不绑定 session）
- `_funcs_map` 为空（Worker 未连接）时，所有方法返回 `{"status": False, "message": "..."}` 而不抛异常
- `cursor=None` / `etag=None` / `ttl=None` 时**不把这些参数传给 Remote**，避免 remote 端收到 `None` 触发类型错误
- 超时（`asyncio.TimeoutError`）统一返回 `{"status": False, "message": "... timeout"}`

---

## 9. WebUI 代理层（files.py）

**文件**：`apps/webui/backend/.../routes/files.py`

在 WebUI FastAPI 路由中注册 `/api/files/v3/{segment}/*`，将请求代理到 Agent Worker REST 端点（`DRSAI_AGENT_REST_BASE`）：

```python
_VALID_SEGMENTS = frozenset({"workspace", "shared", "attachments"})
_AGENT_REST_BASE = os.environ.get("DRSAI_AGENT_REST_BASE", "http://localhost:8000/apiv2")

async def _proxy_get(path: str, params: dict):
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(f"{_AGENT_REST_BASE}/{path}", params=params)
    if resp.status_code >= 400:
        raise HTTPException(status_code=resp.status_code, detail=resp.json())
    return resp.json()
```

| WebUI 端点 | Agent Worker 端点 | 说明 |
|-----------|-------------------|------|
| `GET /api/files/v3/{seg}/files` | `GET /apiv2/{seg}/files` | 目录列举（直接代理） |
| `GET /api/files/v3/{seg}/files/raw` | `GET /apiv2/{seg}/files/raw` | 先尝试 presign 重定向，否则流式转发 |
| `GET /api/files/v3/{seg}/files/url` | `GET /apiv2/{seg}/files/url` | presign URL |
| `GET /api/files/v3/{seg}/files/share` | `GET /apiv2/{seg}/files/share` | 分享 URL |
| `POST /api/files/v3/{seg}/files` | `POST /apiv2/{seg}/files` | 上传（二进制转发） |
| `GET /api/files/v3/{seg}/quota` | `GET /apiv2/{seg}/quota` | 配额 |
| `GET /api/files/v3/{seg}/info` | `GET /apiv2/{seg}/info` | Provider 信息 |

**上传 409 凭证泄露处理**：
```python
if resp.status_code == 409:
    detail = resp.json()
    # code=credential_leak_suspect → 透传给前端
    # 前端应弹窗："该文件疑似包含凭证，确认上传？"
    # 确认后携带 force_credential_leak=true 重传
    raise HTTPException(status_code=409, detail=detail)
```

---

## 10. 前后端文件传输完整链路

### 10.1 上传（前端 → WebUI → Agent → 存储）

```
Browser
  │  POST /api/files/v3/workspace/files
  │  form: user_id, file, overwrite, ...
  ▼
WebUI Backend (files.py v3_upload_file)
  │  转发 POST → DRSAI_AGENT_REST_BASE/workspace/files
  ▼
Agent Worker REST (file_storage.py upload_file)
  │  调用 storage.open_write(user_id, rel_path, stream, ...)
  │  ├── 凭证检测（_check_credential_leak）
  │  ├── 冲突检测
  │  └── 写入文件
  ▼
BaseFileStorage.open_write
  │  ├── LocalFileStorage → 写本地磁盘
  │  ├── GFSFileStorage   → PUT /bucket/key（S3 SigV4）
  │  └── GFSMountStorage  → 写 FUSE 挂载点
  │
  └── emit FileEvent(event="uploaded", ...)
        ▼
      SessionFileEventBus → 通知活跃 Agent session 的 model_context
```

**大文件（> multipart_threshold = 50MB）**：

```
Browser
  │  POST /api/files/v3/workspace/multipart/init → {upload_id, part_size}
  │
  │  POST /api/files/v3/workspace/multipart/{id}/part?number=1  → {etag}
  │  POST /api/files/v3/workspace/multipart/{id}/part?number=2  → {etag}
  │  ...
  │
  └  POST /api/files/v3/workspace/multipart/{id}/complete → FileInfo
```

### 10.2 下载（存储 → Agent → WebUI → 前端）

**有预签名 URL（GFS backend）**：

```
Browser
  │  GET /api/files/v3/workspace/files/raw?user_id=&path=
  ▼
WebUI Backend (v3_download_raw)
  │  先请求 Agent: GET /apiv2/workspace/files/url → {"url": "https://fgws3-gfs..."}
  │  url 不为 null → 302 Redirect 到 presign URL
  ▼
Browser 直接从 GFS 下载（绕过 WebUI/Agent，零中转）
```

**无预签名 URL（local backend）**：

```
Browser
  │  GET /api/files/v3/workspace/files/raw?user_id=&path=
  ▼
WebUI Backend (v3_download_raw)
  │  presign_get 返回 null → 流式转发
  │  httpx.stream("GET", "/apiv2/workspace/files/raw") → yield chunks
  ▼
Browser 流式接收
```

### 10.3 Agent 写入完成通知（Agent → WebUI）

Agent 工具（如代码执行、文件生成）写入文件后，调用 `notify_remote_file_uploaded` 通知 WebUI 侧刷新目录树：

```
HepAIWorkerAgent
  │  await agent.notify_remote_file_uploaded("workspace", user_id, "output/result.csv",
  │                                          size=2048, etag="abc", source="agent")
  ▼
_funcs_map["notify_file_uploaded"] (asyncio.to_thread)
  ▼
Worker remote_callable notify_file_uploaded (run.py)
  │  storage._emit(FileEvent(event="agent_edited", ...))
  ▼
SessionFileEventBus.dispatch → 注入活跃 session model_context
  （前端通过 WebSocket 收到 Agent 消息中包含的 FileEvent 标记，刷新目录树）
```

---

## 11. 配置参考

### 11.1 .env 完整示例

```bash
# ── Agent Worker REST 地址（WebUI 代理转发目标）──────────────────────────────
DRSAI_AGENT_REST_BASE=http://localhost:8000/apiv2

# ── 个人工作区（必选，三种模式选其一）────────────────────────────────────────

## 模式 1：单机 local（开发/单机部署，默认）
PRIVATE_WORKSPACE_BACKEND=local
PRIVATE_WORKSPACE_BASE_DIR=~/.drsai/workspace/runs

## 模式 2：单机 GFS FUSE 挂载（Agent 机器已 jcli mount）
# PRIVATE_WORKSPACE_BACKEND=gfs_mount
# PRIVATE_WORKSPACE_BASE_DIR=~/.drsai/workspace/runs

## 模式 3：分布式 GFS 直连（WebUI 机器或无 FUSE 挂载的 Agent 机器）
# PRIVATE_WORKSPACE_BACKEND=gfs
# PRIVATE_WORKSPACE_GFS_BUCKET=drsai-workspaces
# PRIVATE_WORKSPACE_GFS_AK=<access_key>
# PRIVATE_WORKSPACE_GFS_SK=<secret_key>
# PRIVATE_WORKSPACE_GFS_ENDPOINT_INTERNAL=http://gfs.ihep.ac.cn:7100
# PRIVATE_WORKSPACE_GFS_ENDPOINT_PUBLIC=https://fgws3-gfs.ihep.ac.cn

# 上传限制
PRIVATE_WORKSPACE_MAX_UPLOAD=524288000         # 500MB
PRIVATE_WORKSPACE_MULTIPART_THRESHOLD=52428800 # 50MB（超过自动分片）
PRIVATE_WORKSPACE_ENABLE_CRED_CHECK=true       # 凭证泄露检测（默认开启）

# ── 公共共享空间（可选，不配则不启用 /shared 路由）────────────────────────────
# PUBLIC_SHARED_BACKEND=gfs
# PUBLIC_SHARED_GFS_BUCKET=drsai-public
# PUBLIC_SHARED_GFS_AK=<access_key>
# PUBLIC_SHARED_GFS_SK=<secret_key>
# PUBLIC_SHARED_GFS_ENDPOINT_INTERNAL=http://gfs.ihep.ac.cn:7100
# PUBLIC_SHARED_GFS_ENDPOINT_PUBLIC=https://fgws3-gfs.ihep.ac.cn
# PUBLIC_SHARED_PRESIGN_SHARE_TTL=0            # 0 = 永久链接

# ── 聊天附件（必选）──────────────────────────────────────────────────────────
ATTACHMENTS_BACKEND=hepai_files
ATTACHMENTS_HEPAI_API_BASE=https://aiapi.ihep.ac.cn/apiv2
# HEPAI_API_KEY 由各用户 personal key 注入（不写到 .env）

# ── GFS 管理 API（初始化用，非日常运行必须）────────────────────────────────────
# GFS_ADMIN_API_BASE=http://gfs.ihep.ac.cn:7800
# GFS_ADMIN_API_KEY=gfs-ihep-ccstor-api
```

### 11.2 FileStorageConfig 代码默认值

```python
FileStorageConfig(
    private_workspace=ProviderConfig(
        backend="local",
        base_dir="~/.drsai/workspace/runs",
        max_upload_bytes=500*1024*1024,
        multipart_threshold=50*1024*1024,
        enable_credential_leak_check=True,
        presign_default_ttl=3600,
        role="agent",
    ),
    public_shared=None,                     # 不启用
    attachments=ProviderConfig(
        backend="hepai_files",
        hepai_api_base="https://aiapi.ihep.ac.cn/apiv2",
    ),
)
```

---

## 12. 安全机制

### 12.1 路径安全（_normalize_path）

所有文件操作路径在入口处经过 `BaseFileStorage._normalize_path` 检查：

```python
def _normalize_path(self, rel_path: str) -> str:
    p = PurePosixPath(rel_path)
    if p.is_absolute():                              # 拒绝 /etc/passwd
        raise FileStorageError("invalid_path", ...)
    if any(part == ".." for part in p.parts):        # 拒绝 ../other/secret
        raise FileStorageError("invalid_path", ...)
    return str(p) if str(p) != "." else ""
```

`LocalFileStorage` 额外做物理路径 `resolve()` 二次检查，防止符号链接逃逸：

```python
resolved = (root / norm).resolve()
resolved.relative_to(root.resolve())  # ValueError → invalid_path
```

### 12.2 凭证泄露检测（_check_credential_leak）

对**写入方向**的每个文件扫描：

| 触发规则 | 命中示例 |
|---------|---------|
| 文件名后缀 `.env` `.pem` `.key` `_rsa` `.kube` | `server.pem` |
| 内容含 `access[_-]?key[:=]<16位以上字符>` | `"access_key": "AKIAIOSFODNN7EXAMPLE"` |
| 内容含 `secret[_-]?key[:=]<20位以上字符>` | `secret_key=wJalrXUtnFEMI...` |
| 内容含 `bearer <20位以上>` | `Authorization: Bearer eyJ...` |
| 内容含 `sk-<20位以上>` | `sk-abcdefghijklmnopqrstuvwxyz` |
| 内容含 `ihep[-_]token[:=]<10位以上>` | `ihep_token=ghp_...` |

命中后返回 `409 credential_leak_suspect`，前端应弹窗确认，用户明确同意后携带 `force_credential_leak=true` 重传。

### 12.3 注意事项

- `TOOLS_CONFIG.json` **可能含 MCP token**，工作区暴露使其可被用户下载。当前是单租户可接受设计，多租户模式下必须隐藏。
- 多机分布式部署时，WebUI 到 Agent Worker 的内部通信（`DRSAI_AGENT_REST_BASE`）建议走内网，不要暴露到公网。
- GFS FUSE 挂载点下所有用户共享，权限隔离完全依赖代码层。若 FUSE 挂载意外断开，`_check_mount` 会快速返回 503 而不是静默丢数据。

---

## 13. 代码文件索引

| 文件 | 职责 |
|------|------|
| `drsai/configs/constant.py` | `WORKSPACE_DIR`、`WORKSPACE_RUNS_DIR` 常量 |
| `drsai/modules/managers/datamodel/file_storage.py` | 所有数据类：`FileInfo`、`DirectoryListing`、`FileStorageError`、`UploadRequest`、`MultipartInit`、`QuotaInfo`、`FileEvent`、`GFSAuth`、`ProviderConfig`、`FileStorageConfig` |
| `drsai/modules/managers/file_storage/base.py` | `BaseFileStorage` 抽象基类，路径保护，凭证检测，事件系统 |
| `drsai/modules/managers/file_storage/registry.py` | 注册表 `FILE_STORAGE_BACKENDS`，`@register_backend`，`create_storage`（懒加载） |
| `drsai/modules/managers/file_storage/local.py` | `LocalFileStorage`（`aiofiles` + md5 etag + cursor 分页） |
| `drsai/modules/managers/file_storage/gfs_client.py` | `GFSAdminClient`（管理 API），`GFSS3Client`（S3 SigV4，手写实现） |
| `drsai/modules/managers/file_storage/gfs.py` | `GFSFileStorage`（GFS S3 直连） |
| `drsai/modules/managers/file_storage/gfs_mount.py` | `GFSMountFileStorage`（FUSE 挂载点，继承 Local） |
| `drsai/modules/managers/file_storage/hepai_files.py` | `HepAIFilesStorage`（HepAI Files API 包装） |
| `drsai/modules/managers/file_storage/providers.py` | `make_private_workspace`、`make_public_shared`、`make_attachments`、`FileStorageProviders` |
| `drsai/backend/routes/file_storage.py` | `register_file_routes` REST 路由工厂，错误码映射，multipart session 暂存 |
| `drsai/backend/app_worker.py` | `DrSaiAPP`：持有 `_file_storage_providers`，注册三段路由 |
| `drsai/backend/run.py` | `DrSaiWorkerModel`：5 个 `@HRModel.remote_callable`（`list_files` / `head_file` / `presign_get` / `presign_share` / `notify_file_uploaded`），`_get_file_storage` 辅助 |
| `drsai/modules/agents/drsai_worker_agent.py` | `HepAIWorkerAgent`：5 个客户端方法（`list_remote_files` 等），`asyncio.to_thread` 异步化 |
| `apps/webui/backend/.../routes/files.py` | WebUI 代理层：`/api/files/v3/{seg}/*` 8 个端点，`_proxy_get`，上传 409 凭证泄露透传 |
| `tests/agent_files_test/test_file_storage.py` | Phase 1 单元测试（85 个） |
| `tests/agent_files_test/test_backend_routes_and_integration.py` | Phase 3&4 集成测试（70 个） |
