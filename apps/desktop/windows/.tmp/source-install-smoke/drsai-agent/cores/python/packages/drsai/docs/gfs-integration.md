# GFS 集成（OpenAPI + S3 数据面方案）

> 状态：**Step 1-3 已落地**；本文档同时说明 Step 4（Webui / 前端对接）所需的更改。
> 模块位置：`cores/python/packages/drsai/src/drsai/modules/managers/gfs/`
> 设计来源：[`test/task/task-20260610/task-1-new.md`](../../../../../test/task/task-20260610/task-1-new.md)
> 实测发现：[`test/task/task-20260610/gfs-api-finding.md`](../../../../../test/task/task-20260610/gfs-api-finding.md)

---

## 目录

1. [一句话总览](#1-一句话总览)
2. [为什么不挂载](#2-为什么不挂载)
3. [架构 & 模块布局](#3-架构--模块布局)
4. [环境变量](#4-环境变量)
5. [SDK 使用](#5-sdk-使用)
6. [Agent function-calling 工具](#6-agent-function-calling-工具)
7. [与 `run_drsai_agent.py` 的集成（已完成）](#7-与-run_drsai_agentpy-的集成已完成)
8. [Bucket 内目录约定](#8-bucket-内目录约定)
9. [安全模型](#9-安全模型)
10. [测试](#10-测试)
11. [运维与故障排查](#11-运维与故障排查)
12. [⚠️ 前端 / Webui Backend 需要做的更改](#12-️-前端--webui-backend-需要做的更改)
13. [文件清单](#13-文件清单)

---

## 1. 一句话总览

> Worker 进程持一个**管理员 OpenAPI Key**（`X-API-Key`），就能为任何 ihep 邮箱用户自动拿到他自己的 AKSK，进而用 boto3 走 S3 协议读写他的私有 bucket。**全程不挂载 / 不需 root / 不依赖 jcli 二进制**。

实测可行（见 `gfs-api-finding.md`）：用同一把 admin key 验证了 `xiongdb@ihep.ac.cn` 与 `haiuser01@ihep.ac.cn` 两个用户，跨用户 S3 读写、预签名 URL 均成功。

---

## 2. 为什么不挂载

| 维度 | FUSE 挂载方案 | OpenAPI + S3 方案（本方案） |
|---|---|---|
| 需要 root | ✅ 要 | ❌ 不要 |
| 需要 FUSE / fuse3 | ✅ 要 | ❌ 不要 |
| 需要部署 jcli 二进制 | ✅ 要 | ❌ 不要 |
| 容器里能跑 | 要 enable_fuse | 普通 Pod 即可 |
| Pod 重启恢复 | 复杂 | 进程拉起即可 |
| 文件即时同步 | ✅ 透明 | ✅ 写完即可见 |
| 大文件流式 | ✅ | ✅（boto3 multipart） |
| 用户本机看到 agent 写的文件 | ✅ | ✅（用户自己 `jcli mount`） |
| 本地代码用 `Path.write_text` 直接写 | ✅ | ❌ 必须调 `gfs_*` 工具 |
| 多用户隔离 | 复杂（要 `-mode-uid`） | 简单（一个 AKSK 一个用户） |
| **当前 zzd-3090 可用性** | ❌ 没 sudo | ✅ 立即可用 |

唯一代价：agent 需要显式调用 `gfs_*` 工具，不能直接用 `Path` 操作 GFS。这通过本模块提供的 8 个 function-calling 工具解决，模型基本不需要额外提示。

---

## 3. 架构 & 模块布局

```
┌─────────────────────────────────────────────────────────────────────┐
│  DrSai Worker 进程（任意 Linux 用户身份，无 root）                  │
│                                                                     │
│   ┌────────────────────────┐    httpx + X-API-Key                  │
│   │  GfsAdminClient        │  ─────────────────────►  GFS OpenAPI │
│   │  (admin_client.py)     │  http://gfs.ihep.ac.cn:7800           │
│   └────────────┬───────────┘                                       │
│                │  GfsCredential(ak, sk, bucket)                   │
│                ▼                                                   │
│   ┌────────────────────────┐    缓存 → ~/.drsai/.cache/gfs/        │
│   │  GfsProvisioner        │    (per-email JSON, chmod 600)        │
│   │  (provisioner.py)      │                                       │
│   └────────────┬───────────┘                                       │
│                │  GfsUserClient (per email)                       │
│                ▼                                                   │
│   ┌────────────────────────┐    boto3 (s3v4, path-style)          │
│   │  GfsUserClient         │  ─────────────────────►  GFS S3      │
│   │  (user_client.py)      │  https://fgws3-gfs.ihep.ac.cn        │
│   └────────────┬───────────┘                                       │
│                │  bind(email)                                     │
│                ▼                                                   │
│   ┌────────────────────────┐                                      │
│   │  make_gfs_tools(email) │  → DrSaiAssistant(tools=[...])       │
│   │  (agent_tools.py)      │                                      │
│   └────────────────────────┘                                      │
└─────────────────────────────────────────────────────────────────────┘
```

模块布局：

```
cores/python/packages/drsai/src/drsai/modules/managers/gfs/
├── __init__.py            # 对外公开 API
├── admin_client.py        # 管理面: GfsAdminClient, GfsCredential, GfsBucketInfo
├── user_client.py         # 数据面: GfsUserClient, GfsObjectInfo, 路径规范化
├── provisioner.py         # 进程级缓存: GfsProvisioner, get_user_client()
└── agent_tools.py         # function-calling 工具: make_gfs_tools(email)

cores/python/packages/drsai/tests/gfs/
├── __init__.py
├── test_admin_client.py   # 25 tests
├── test_user_client.py    # 43 tests (含 traversal 安全测试)
├── test_provisioner.py    # 22 tests (含并发首次开通锁测试)
└── test_agent_tools.py    # 19 tests
                           # —— 总计 109 tests, ~2.5s 完成
```

---

## 4. 环境变量

| 变量 | 必需 | 默认 | 说明 |
|---|---|---|---|
| `GFS_OPENAPI_KEY` | ✅ 启用 GFS 时必需 | — | 管理员 X-API-Key，向程耀东 / 李海波申请 |
| `GFS_OPENAPI_BASE` | 否 | `http://gfs.ihep.ac.cn:7800` | OpenAPI base URL |
| `GFS_S3_ENDPOINT` | 否 | `https://fgws3-gfs.ihep.ac.cn` | 数据面 S3 endpoint |
| `DRSAI_GFS_CACHE_DIR` | 否 | `~/.drsai/.cache/gfs` | AKSK 落盘目录（worker 私有，**不要**放进 work_dir） |
| `DRSAI_GFS_ENABLED` | 否 | `false` | `run_drsai_agent.py` 中的总开关，关闭时不挂任何 GFS 工具 |

`.env` 推荐配置：

```bash
# .env
DRSAI_GFS_ENABLED=true
GFS_OPENAPI_KEY=gfs-ihep-ccstor-api
# 下面三个用默认即可
# GFS_OPENAPI_BASE=http://gfs.ihep.ac.cn:7800
# GFS_S3_ENDPOINT=https://fgws3-gfs.ihep.ac.cn
# DRSAI_GFS_CACHE_DIR=/var/lib/drsai/gfs
```

---

## 5. SDK 使用

### 5.1 最简单：一行拿到用户的 GFS client

```python
from drsai.modules.managers.gfs import get_user_client

client = get_user_client("alice@ihep.ac.cn")
client.write_text("workspace/notes.md", "hello")
print(client.read_text("workspace/notes.md"))
```

`get_user_client` 是幂等的：
- 首次调用：去 OpenAPI 拉 AKSK，落盘到 `~/.drsai/.cache/gfs/alice@ihep.ac.cn.json`
- 后续调用：复用内存中的 client
- AKSK 失效（S3 健康检查失败）：自动 evict + 重新拉

### 5.2 直接用管理面

```python
from drsai.modules.managers.gfs import get_admin_client

admin = get_admin_client()
buckets = admin.list_buckets("alice@ihep.ac.cn")
print(buckets[0].bucket_name, buckets[0].quota_mb)

# 拿明文 AKSK
creds = admin.list_credentials("alice@ihep.ac.cn")
print(creds[0]["access_key"])
```

### 5.3 GfsUserClient 完整 API

```python
client = get_user_client("alice@ihep.ac.cn")

# 探测
client.healthcheck()                                       # bool
client.exists("workspace/a.txt")                           # bool
info = client.head("workspace/a.txt")                      # GfsObjectInfo

# 列表
items = client.list_dir("workspace/", recursive=False)     # list[GfsObjectInfo]

# 读
data = client.read_bytes("a.bin")                          # bytes (≤32MB)
text = client.read_text("a.md")                            # str
client.download_file("big.zip", "/tmp/big.zip")            # 任意大小

# 写
etag = client.write_bytes("a.bin", b"...")                 # → etag
etag = client.write_text("a.md", "hello")
client.upload_file("/tmp/big.zip", "uploads/big.zip")      # 自动 multipart
client.upload_stream(open("a.bin", "rb"), "a.bin")         # 流式

# 删
client.delete("a.txt")
ok_keys = client.delete_many(["a.txt", "b.txt"])

# 预签名（生成临时分享 URL）
url = client.presign_get("a.md", ttl_sec=3600)             # GET URL
url = client.presign_put("a.md", ttl_sec=600)              # PUT URL（用于前端直传）
```

### 5.4 路径安全

`_normalize_key` 内置 traversal 防护：

```python
client.write_text("../etc/passwd", "x")  # ValueError: path traversal not allowed
client.write_text("a/../../b", "x")       # ValueError（即使 normpath 后能抹平）
client.write_text("/absolute/path", "x")  # 自动剥前导斜杠 → "absolute/path"
```

---

## 6. Agent function-calling 工具

`make_gfs_tools(email)` 返回 8 个绑定到 email 的工具函数：

| 工具 | 作用 |
|---|---|
| `gfs_ls(prefix, recursive, max_items)` | 列目录 |
| `gfs_stat(path)` | 看文件元信息 |
| `gfs_read(path)` | 读文本（超过 64K 自动截断） |
| `gfs_write(path, content)` | 写文本 |
| `gfs_upload(local_path, remote_path)` | 上传本地文件（大文件自动 multipart） |
| `gfs_download(remote_path, local_path)` | 下载到本地 |
| `gfs_delete(path)` | 删除文件 |
| `gfs_share_url(path, ttl_minutes)` | 生成临时下载 URL（1-1440 分钟） |

**所有工具都有清晰的 ``Annotated`` 类型注解 + docstring**，autogen 会自动转成 LLM 可读的 schema。

模型典型使用模式：

```
User: 请把这份代码整理一下保存到 GFS

LLM (with gfs tools):
1. gfs_write("outputs/refactor-2026-06-11/main.py", "...refactored code...")
2. gfs_share_url("outputs/refactor-2026-06-11/main.py", ttl_minutes=1440)
3. 把分享 URL 贴到回答里
```

---

## 7. 与 `run_drsai_agent.py` 的集成（已完成）

`apps/webui/run_drsai_agent.py` 已经接入：

```python
# 顶部
import logging
logger = logging.getLogger(__name__)

# 新增 helper
def _build_gfs_tools(user_id: str | None) -> list:
    if not _as_bool(os.getenv("DRSAI_GFS_ENABLED"), default=False):
        return []
    if not user_id:
        return []
    try:
        from drsai.modules.managers.gfs import make_gfs_tools
    except ImportError as e:
        logger.warning("DRSAI_GFS_ENABLED=true but gfs module import failed: %s", e)
        return []
    try:
        tools = make_gfs_tools(user_id)
        logger.info("GFS enabled for user %s: %d tools registered", user_id, len(tools))
        return tools
    except Exception as e:
        logger.warning("make_gfs_tools(%s) failed: %s.", user_id, e)
        return []

# create_agent 内部
extra_tools = _build_gfs_tools(user_id)
return DrSaiAssistant(
    ...,
    tools=extra_tools or None,
    ...
)
```

**默认关闭** —— 设置 `DRSAI_GFS_ENABLED=true` 才挂工具，确保对现有部署零影响。

---

## 8. Bucket 内目录约定

为了让 **agent 写出的东西** ≈ **用户在自己 GFS 客户端看到的东西**，约定以下顶层目录：

| 前缀 | 用途 | 谁写 |
|---|---|---|
| `workspace/` | agent 跨 session 持续工作区，相当于本地 `~/.drsai/workspace/runs/<user>/` | agent |
| `uploads/<run_id>/` | webui 把用户上传的附件转存到这里 | **webui backend**（见 §12） |
| `outputs/<run_id>/` | 本次任务的产出（用户可拿走、可分享） | agent |

agent 可以通过 system prompt 知晓这套约定（DrSai 在未来可以注入这一段提示）。**短期内**，让 LLM 自然从工具的 docstring 里推断即可（实测有效）。

---

## 9. 安全模型

### 9.1 admin key 的权限边界

`gfs-ihep-ccstor-api` 等价于"全所所有 GFS 用户数据的最高权"：
- 可以拿任何 ihep 邮箱用户的明文 AKSK
- 可以为任何用户增删 AKSK

**红线**：
1. ✅ admin key **只放环境变量**，绝不入代码、绝不入日志
2. ✅ `GfsCredential.masked()` 提供日志安全视图（SK 永远 `***`）
3. ✅ 用户级 AKSK 缓存目录 `chmod 700`、文件 `chmod 600`
4. ✅ 缓存目录在 worker 私有路径（**不在**用户可见 work_dir）
5. ❌ **不要**把 AKSK 缓存放到 `~/.drsai/workspace/runs/<user>/` —— 那是用户可读写的目录

### 9.2 用户级隔离

```python
# Provisioner 内部按 email 严格隔离
alice_client = provisioner.get_user_client("alice@ihep.ac.cn")
bob_client = provisioner.get_user_client("bob@ihep.ac.cn")

alice_client.bucket  # "20001-alice"
bob_client.bucket    # "20002-bob"
# 两个 client 持有不同的 AKSK，alice 的 S3 调用永远落到 alice 的 bucket
```

`make_gfs_tools(email)` 把 email 用**闭包**绑死到工具函数里，即使 agent 同时为多个用户工作（理论上不会），工具调用也不会串号。

### 9.3 审计

S3 调用用的是**用户自己的 AKSK**，GFS 服务端日志中显示的是"该用户"的行为，admin key 不污染审计日志。审计粒度 = 用户级，这是设计上的优势。

### 9.4 路径安全

`_normalize_key` / `_normalize_prefix` 拦截：
- 空字符串
- `..` 段（**先**在原始字符串里检查，**再**做 normpath，防止 `a/../b` 被悄悄抹平）
- 纯 `.` / `..` 路径

测试覆盖见 `test_user_client.py::TestNormalizeKey`。

---

## 10. 测试

```bash
cd cores/python/packages/drsai
python -m pytest tests/gfs/ -v
# 109 passed in ~2.5s

# 真打 OpenAPI 的烟雾测试（需要网络 + admin key）
GFS_OPENAPI_KEY=gfs-ihep-ccstor-api python test/task/task-20260610/verify_gfs.py --cleanup
GFS_OPENAPI_KEY=gfs-ihep-ccstor-api python test/task/task-20260610/verify_gfs.py --email haiuser01@ihep.ac.cn --cleanup
```

测试覆盖（109 个）：
- `GfsAdminClient`：HTTP 错误、JSON 错误、邮箱当 user_id、`get_user_credential` 三层 fallback
- `GfsCredential` / `_pick_usable_credential`：rw vs ro vs 空 resources 的选择策略
- `_normalize_key` / `_normalize_prefix`：**实际抓出了一个 traversal 安全 bug**（已修）
- `GfsUserClient`：list/head/get/put/delete/multipart upload/presigned URL
- `GfsProvisioner`：缓存命中、stale 重拉、文件权限 0600、用户隔离
- **并发**：5 个线程同时申请同一 email，OpenAPI 只调一次
- `make_gfs_tools`：8 个工具的输入输出、TTL clamp、错误兜底

---

## 11. 运维与故障排查

### 11.1 启动检查

```bash
# 在 worker 容器内
echo "OPENAPI_KEY set? $(if [ -n "$GFS_OPENAPI_KEY" ]; then echo yes; else echo NO; fi)"
python -c "from drsai.modules.managers.gfs import get_admin_client; print(get_admin_client().healthz())"
```

### 11.2 常见错误码

| 错误 | 原因 | 处理 |
|---|---|---|
| `RuntimeError: GFS admin api key 未设置` | 缺 `GFS_OPENAPI_KEY` | 配 .env |
| `GfsAdminError(UNAUTHORIZED)` | API Key 错 | 找程耀东 / 李海波核实 |
| `GfsAdminError(NO_BUCKET)` | 用户没在 GFS 上开通 | 让用户先去 https://gfs.ihep.ac.cn 登录一次 |
| `GfsAdminError(NO_CREDENTIAL)` | 用户有桶但无凭证 | OpenAPI 实测可能存在的边缘情况，让用户去网页端建一对 AKSK |
| `GfsAdminError(CREDENTIAL_UNUSABLE)` | OpenAPI 返回的 AKSK S3 测试失败 | 网络问题 / endpoint 错配 / 凭证被吊销 |
| `ImportError: boto3` | worker 容器没装 boto3 | `pip install boto3` 或把 boto3 加到 `pyproject.toml` 依赖里 |

### 11.3 清理某用户缓存（强制重拉）

```python
from drsai.modules.managers.gfs import GfsProvisioner
GfsProvisioner.get().evict("alice@ihep.ac.cn")
```

或者直接：

```bash
rm ~/.drsai/.cache/gfs/alice@ihep.ac.cn.json
```

### 11.4 把 boto3 加进依赖

本模块不强制 import boto3（懒导入），但生产环境建议加：

```toml
# cores/python/packages/drsai/pyproject.toml 的 dependencies
"boto3>=1.34",
```

---

## 12. ⚠️ 前端 / Webui Backend 需要做的更改

**Step 1-3 完成后，agent 端已经可以通过 8 个 GFS 工具读写文件。** 但**前端上传的文件还是只能落到 webui 本地临时盘**，跨进程的 worker 仍然访问不到。本节列出前端 / webui backend 需要做的更改，让附件上传也走 GFS，实现完整闭环。

### 12.1 现状链路

```
浏览器                   webui backend                     worker
   │  multipart upload       │                                 │
   │ ──────────────────────► │                                 │
   │                          │  存到 /tmp/webui/<uuid>          │
   │                          │  构造 task + files=[{path: ...}] │
   │                          │  ws.start_stream(task, ...)     │
   │                          │ ──────────────────────────────► │
   │                          │  ↑↑↑ webui 进程本地路径         │
   │                          │     worker 看不到！             │
```

### 12.2 目标链路

```
浏览器                   webui backend                     worker (任何节点)
   │  multipart upload       │                                 │
   │ ──────────────────────► │                                 │
   │                          │  GFS upload to                  │
   │                          │  s3://20001-alice/              │
   │                          │     uploads/<run_id>/<name>     │
   │                          │ ──────────────────────────────► GFS
   │                          │                                  │
   │                          │  task.metadata.attached_files = │
   │                          │     [{name, gfs_path, size, ..} │
   │                          │  ws.start_stream(task)          │
   │                          │ ──────────────────────────────► │
   │                          │                                  ▼
   │                          │                      worker 内 agent 通过
   │                          │                      gfs_read("uploads/run-42/...")
   │                          │                      直接拿到内容
```

### 12.3 改造点 1：上传时转存 GFS（webui backend）

**位置**：`apps/webui/backend/src/drsai_ui/ui_backend/backend/web/routes/ws.py`
里的 `message["type"] == "start"` / `"continue"` 分支，**或** `routes/files.py` 里上传端点。

**伪代码**：

```python
# 现状
files = start_metadata.pop("files", [])
# ↑ files 元素：{"name", "path"（本地临时路径）, "size", "type"}

# 新增（在 construct_task 之前）：
from drsai.modules.managers.gfs import get_user_client, UPLOADS_PREFIX

user_email = (
    start_metadata.get("user_id")
    or settings_config.get("user_id")
    or "anonymous"
)

if files and user_email and user_email != "anonymous":
    try:
        gfs = get_user_client(user_email)
        for f in files:
            local_path = f["path"]
            remote_path = f"{UPLOADS_PREFIX}/{run_id}/{f['name']}"
            gfs.upload_file(local_path, remote_path)
            # 喂给 agent 的"GFS 化"信息
            f["gfs_path"] = remote_path
            f["url"] = gfs.presign_get(remote_path, ttl_sec=3600)
            # 释放：base64 已没必要传给 worker（worker 自己用 gfs_read 取）
            f.pop("content", None)
    except Exception as e:
        logger.warning("GFS upload failed, falling back to local-only: %s", e)
        # 不抛，让现有 base64 兜底
```

### 12.4 改造点 2：`construct_task` 适配 `gfs_path`

**位置**：`apps/webui/backend/src/drsai_ui/ui_backend/backend/utils/utils.py:construct_task()`

当 file 字典含 `gfs_path` 时，**跳过** 本地 `open(file["path"], "rb")` + base64 编码逻辑：

```python
for file in files:
    if "gfs_path" in file:
        # GFS 化的附件：不读本地、不 base64，把 gfs_path 透传给 agent
        text_parts.append(
            f"Attached file (in GFS): {file['name']} "
            f"(size={file.get('size', 0)} B, gfs_path={file['gfs_path']!r}). "
            f"You can read it via gfs_read({file['gfs_path']!r})."
        )
        attached_files.append({
            "name": file["name"],
            "type": file.get("type", "text"),
            "size": file.get("size", 0),
            "gfs_path": file["gfs_path"],
            "url": file.get("url", ""),
            "base64": "",
        })
        continue
    # 否则走现有 base64 / 本地读取兜底逻辑（不删除）
    ...
```

`metadata.attached_files` 里多了 `gfs_path` 字段后，agent 在 system prompt 里自然看到提示，会优先用 `gfs_read`。

### 12.5 改造点 3（可选）：前端预览

**位置**：前端文件预览组件。

如果用户上传完想立即预览/重新下载，前端应该用 `attached_files[i].url`（即 presigned GET URL）做预览源，而**不是**从 webui 本地路径取（那个临时路径会被定期清理）。

```typescript
// 改造前
<img src={`/api/files/local/${file.path}`} />

// 改造后
<img src={file.url} />  // presigned GFS URL，1小时有效
```

如果需要永久 URL：调用 webui 后端一个新端点 `POST /api/files/presign`，每次重新发一个 short-lived URL（不要长期缓存 URL，因为它会过期）。

### 12.6 改造点 4（强烈推荐）：浏览器直传 GFS

为了把大文件上传**从 webui 后端剥离**（节省后端带宽 / 内存），可以让浏览器拿 presigned PUT URL 直传 GFS：

**webui backend 新增端点**：

```python
# routes/files.py
@router.post("/api/files/v4/presign-put")
async def presign_put(req: PresignPutReq, current_user):
    """返回一个 presigned PUT URL，前端用这个 URL multipart 直传 GFS。"""
    from drsai.modules.managers.gfs import get_user_client, UPLOADS_PREFIX
    gfs = get_user_client(current_user.email)
    remote_path = f"{UPLOADS_PREFIX}/{req.run_id}/{req.filename}"
    url = gfs.presign_put(remote_path, ttl_sec=600)
    return {
        "upload_url": url,
        "gfs_path": remote_path,
        "expires_in": 600,
    }
```

**前端改造**：

```typescript
async function uploadFile(file: File, runId: string) {
  // 1. 找 webui 拿一个 presigned PUT URL
  const { upload_url, gfs_path } = await fetch("/api/files/v4/presign-put", {
    method: "POST",
    body: JSON.stringify({ filename: file.name, run_id: runId }),
    headers: { "Content-Type": "application/json" },
  }).then(r => r.json());

  // 2. 直接 PUT 到 GFS（注意 Content-Type 要与签 URL 时一致）
  await fetch(upload_url, { method: "PUT", body: file });

  // 3. 把 gfs_path 放到要发给 webui 的消息里
  return { name: file.name, size: file.size, gfs_path };
}
```

这种模式下，webui backend 只参与"签 URL"和"把 gfs_path 透传给 worker"，**不接触文件本体**，最适合大文件 / 高并发场景。

### 12.7 改造点 5：用户身份的透传

`run_drsai_agent.py` 里的 `create_agent(user_id=...)` 参数已经存在；上面所有改造都依赖 `user_id` 是**用户邮箱**。请确认：

- WS 消息 `start_metadata.user_id` 永远是用户邮箱（如 `xiongdb@ihep.ac.cn`），不是数字 ID 或 username
- 如果有多种身份（统一认证 ID / 邮箱 / 昵称），统一在 webui 入口转换成邮箱

### 12.8 改造清单速览（给前端 / webui 工程师）

- [ ] `routes/ws.py`: 在 `start`/`continue` 分支接收 `files` 后，先调 `get_user_client(email).upload_file(...)` 转存到 GFS，给每个 file 加 `gfs_path` 字段
- [ ] `utils/utils.py:construct_task()`: 检测 `file["gfs_path"]`，跳过 base64 路径
- [ ] `routes/files.py`: 加 `POST /api/files/v4/presign-put` 端点（可选，做浏览器直传时需要）
- [ ] `routes/files.py`: 加 `POST /api/files/v4/presign-get` 端点（可选，预览用，按需调用）
- [ ] 前端 upload 组件: 改成调用 `presign-put` + PUT 到 GFS 的两段式上传（可选）
- [ ] 前端预览组件: 用 `file.url` 而不是 webui 本地路径
- [ ] 部署: 在 worker 与 webui backend 的 `.env` 都加 `DRSAI_GFS_ENABLED=true` + `GFS_OPENAPI_KEY=...`
- [ ] 部署: 在 worker 与 webui backend 都 `pip install boto3>=1.34`

---

## 13. 文件清单

### 新增

| 文件 | 行数 | 说明 |
|---|---|---|
| `cores/python/packages/drsai/src/drsai/modules/managers/gfs/__init__.py` | ~80 | 包 API |
| `cores/python/packages/drsai/src/drsai/modules/managers/gfs/admin_client.py` | ~320 | 管理面 |
| `cores/python/packages/drsai/src/drsai/modules/managers/gfs/user_client.py` | ~290 | 数据面 (S3) |
| `cores/python/packages/drsai/src/drsai/modules/managers/gfs/provisioner.py` | ~210 | 进程级缓存 |
| `cores/python/packages/drsai/src/drsai/modules/managers/gfs/agent_tools.py` | ~190 | function-calling 工具 |
| `cores/python/packages/drsai/tests/gfs/test_admin_client.py` | ~380 | 25 tests |
| `cores/python/packages/drsai/tests/gfs/test_user_client.py` | ~320 | 43 tests |
| `cores/python/packages/drsai/tests/gfs/test_provisioner.py` | ~330 | 22 tests |
| `cores/python/packages/drsai/tests/gfs/test_agent_tools.py` | ~210 | 19 tests |

### 修改

| 文件 | 改动 |
|---|---|
| `apps/webui/run_drsai_agent.py` | + import logging；+ `_build_gfs_tools` helper；`create_agent` 内挂 `tools=extra_tools or None` |

### 待修改（Step 4 / 前端）

见 §12.8 清单。

---

## 14. 验证

```bash
# 单测
cd cores/python/packages/drsai && python -m pytest tests/gfs/ -v
# 109 passed in ~2.5s

# E2E（需要 admin key + 网络）
GFS_OPENAPI_KEY=gfs-ihep-ccstor-api \
  python test/task/task-20260610/verify_gfs.py --cleanup
# ✓ OpenAPI ✓ AKSK 拉取 ✓ boto3 读写 ✓ presigned URL

# 多用户验证
GFS_OPENAPI_KEY=gfs-ihep-ccstor-api \
  python test/task/task-20260610/verify_gfs.py --email haiuser01@ihep.ac.cn --cleanup
# ✓ 跨用户能力确认

# Agent 工具真实环境烟雾测试
GFS_OPENAPI_KEY=gfs-ihep-ccstor-api python -c "
from drsai.modules.managers.gfs import make_gfs_tools
tools = {t.__name__: t for t in make_gfs_tools('xiongdb@ihep.ac.cn')}
print(tools['gfs_write']('test/hello.txt', 'hello'))
print(tools['gfs_read']('test/hello.txt'))
print(tools['gfs_delete']('test/hello.txt'))
"
```
