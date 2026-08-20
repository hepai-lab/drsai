## 22 GFS 高能所文件系统集成

> **实现状态**：Personal 模式已实现（`modules/managers/gfs/`）。TUI 配置面板已实现（`/gfs`），支持状态查看、内联编辑、连接测试、配置清除。TUI 只支持 Personal 模式。

### 22.1 概述

GFS (高能所文件系统) 集成让 Agent 通过 function-calling 工具直接读写用户的 GFS bucket。Agent 可以：

- `gfs_ls` — 列出 bucket 内的文件/目录（输出截断至 5000 字符）
- `gfs_stat` — 查看文件元信息（大小、etag、修改时间）
- `gfs_read` — 读取文本文件全文（支持 `minilimit`/`maxlimit` 按行分页，输出截断至 5000 字符）
- `gfs_write` — 写入文本到 bucket
- `gfs_upload` — 上传本地文件到 bucket
- `gfs_download` — 下载文件到本地
- `gfs_share_url` — 生成临时预签名下载 URL（限时分享）
- `gfs_delete` — 删除文件

工具名以 `gfs_` 前缀，与 Agent 内置的 `run_read` / `run_write` 等本地文件工具共存，由 system prompt 引导选择。`gfs_read` 和 `gfs_ls` 的输出限制与 `run_read` 保持一致（5000 字符截断），防止单次工具调用占用过多上下文。

### 22.2 两种模式

| 模式 | 凭证来源 | 适用场景 | 是否需要管理员 Key |
|------|---------|---------|-------------------|
| **Personal**（个人） | 用户自己的 AK/SK | 本地 / 单用户实例（TUI `/gfs` 配置） | 否 |
| **Admin**（管理员） | 管理员 X-API-Key 按用户邮箱自动分配 | 多用户服务（生产 worker） | 是 |

> **TUI 只支持 Personal 模式。** Admin 模式由生产环境 worker 使用，不在 CLI/TUI 上下文中。

### 22.3 TUI 配置（`/gfs`）

在 TUI 中输入 `/gfs` 打开 GFS 配置面板。面板有两个视图：**状态视图**（默认）和**编辑视图**。

#### 状态视图

```
📁 GFS Configuration — 高能所文件系统

● GFS Tools: ENABLED (mode: personal)

Credentials:
▶ Enabled: true (Enter to toggle)
  Access Key: ***niLd (Enter to edit)
  Secret Key: ***QMgw (Enter to edit)
  Bucket: 20235-xiongdb (Enter to edit)
  Email: xiongdb@ihep.ac.cn (Enter to edit)
  S3 Endpoint: (default) (Enter to edit)

config: /home/xiongdb/.drsai/configs/cli_config.json

↑↓ navigate · Enter/→ edit · s toggle · t test · c clear · q quit
```

| 快捷键 | 功能 |
|--------|------|
| `↑` / `↓` | 上下移动光标，选中配置项（Enabled / Access Key / Secret Key / Bucket / Email / S3 Endpoint） |
| `Enter` | 光标在 Enabled 行 → 切换启用/禁用；在字段行 → 进入该字段编辑 |
| `→` (右箭头) | 进入当前选中字段的编辑（同 Enter 字段行） |
| `e` | 进入完整编辑表单（从第一个字段开始） |
| `t` | 测试连接（S3 健康检查，调用 `list_objects_v2`） |
| `s` | 切换启用/禁用 |
| `c` | 清除所有 GFS 配置 |
| `r` | 刷新配置状态 |
| `q` / `Esc` | 退出面板 |

#### 编辑视图

在状态视图选中某项后按 `Enter`、`→` 或按 `e` 进入编辑视图，可直接键盘输入修改字段内容：

- **↑ / ↓** 或 **Tab**：在 5 个字段间切换
- **键盘输入**：编辑当前字段文本（字符追加到末尾）
- **Backspace**：删除末尾字符
- **s**：在编辑视图中直接切换启用/禁用
- **Enter**：切换到下一个字段；在最后一个字段（S3 Endpoint）按 Enter 保存
- **Esc**：取消编辑，返回状态视图

已有的 AK/SK 显示为 `(unchanged — ***)`，留空表示不修改原值。

### 22.4 配置存储

GFS 配置持久化在 `~/.drsai/configs/cli_config.json` 的 `"gfs"` 键下：

```json
{
  "user_id": "xiongdb",
  "api_key": "...",
  "gfs": {
    "enabled": true,
    "mode": "personal",
    "access_key": "e94UWOls...",
    "secret_key": "2psxS5...",
    "bucket": "20235-xiongdb",
    "email": "xiongdb@ihep.ac.cn",
    "s3_endpoint": ""
  }
}
```

| 字段 | 必填 | 说明 |
|------|------|------|
| `enabled` | 是 | `true`/`false`，总开关 |
| `mode` | 否 | `"personal"` / 留空（自动判定） |
| `access_key` | Personal 模式必填 | 个人 Access Key |
| `secret_key` | Personal 模式必填 | 个人 Secret Key |
| `bucket` | Personal 模式必填 | 完整桶名（如 `20235-xiongdb`） |
| `email` | 否 | 仅用于日志标识 |
| `s3_endpoint` | 否 | 默认 `https://fgws3-gfs.ihep.ac.cn` |

> **凭证获取**：在 https://gfs.ihep.ac.cn 网页端「密钥管理」页拿到自己的 AK/SK。

### 22.5 工具注入流程

```
Session 创建 (_ensure_agent_session)
  ↓ cli_config.load_config() → cli_cfg (含 "gfs" 子dict)
  ↓
create_agent(cli_cfg=cli_cfg)
  ↓ _build_gfs_tools(user_id, cli_cfg=cli_cfg)
     ↓ 只从 cli_cfg["gfs"] 读取配置（不读 os.environ）
     ↓ GfsCredential(access_key, secret_key, bucket, ...)
     ↓ GfsUserClient(cred) → make_gfs_tools_personal(client=client) → 8个工具
  ↓
DrSaiAssistant(tools=[..., *gfs_tools])
```

**重要**：GFS 工具在 Agent 创建时注入。保存配置后需重启 Session（`/new` 或 `/switch`）才能让新配置生效。

### 22.6 RPC 方法

| RPC 方法 | 说明 | 是否长操作 |
|----------|------|-----------|
| `gfs.status` | 读取当前 GFS 配置（凭证掩码显示） | 否 |
| `gfs.save` | 保存配置到 `cli_config.json`（不写入 `os.environ`） | 否 |
| `gfs.test` | 测试 GFS 连接（S3 健康检查） | 是（`_LONG_HANDLERS`） |
| `gfs.clear` | 清除 GFS 配置（同时清理 `os.environ` 中的残留） | 否 |

---

