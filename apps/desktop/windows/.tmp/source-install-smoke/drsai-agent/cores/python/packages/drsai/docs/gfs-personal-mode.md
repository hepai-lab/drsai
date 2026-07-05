# GFS 个人模式快速上手

> 适用：你想在本地/个人环境启动 `run_drsai_agent.py`，让 agent 能读写自己的 GFS bucket，但**没有管理员 X-API-Key**。

---

## 1. 一句话区别

| 模式 | 谁拿 AKSK | 需要的环境变量 | 适用场景 |
|---|---|---|---|
| **admin（旧）** | Worker 用管理员 key 替每个登录用户拿 | `GFS_OPENAPI_KEY` | 多用户 webui 服务 |
| **personal（新）** | 你自己从 GFS 网页端拿到 AKSK 后给 worker | `GFS_ACCESS_KEY`, `GFS_SECRET_KEY`, `GFS_BUCKET` | 个人本地实例 |

两种模式产生的 agent 工具完全一样（`gfs_ls`、`gfs_read`、`gfs_write` 等 8 个）。

---

## 2. 三步启用 personal 模式

### 2.1 拿到自己的 AKSK

1. 打开 https://gfs.ihep.ac.cn ，IHEP 邮箱登录
2. 左侧"**密钥管理**" → 创建一对 `rw` 密钥（已有可直接复用）
3. 记下：
   - `Access Key`（约 20 字节，形如 `20240527-xxxxx`）
   - `Secret Key`（约 40 字节，**只在创建瞬间能看到**，丢了重新生成）
4. 左侧"**桶管理**"看到自己的完整桶名（形如 `20235-<username>`）

### 2.2 写到 `.env`

在项目根目录的 `.env` 里追加：

```bash
DRSAI_GFS_ENABLED=true
DRSAI_GFS_MODE=personal              # 显式声明，避免误用 admin
GFS_ACCESS_KEY=20240527-xxxxxxxxxxxx
GFS_SECRET_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
GFS_BUCKET=20235-xiongdb              # 你的完整桶名
GFS_USER_EMAIL=xiongdb@ihep.ac.cn     # 可选，仅日志可读
```

> 也可以省略 `DRSAI_GFS_MODE`：检测到完整 AKSK + bucket 会自动走 personal。

### 2.3 启动

```bash
python run_drsai_agent.py
```

启动日志里应能看到：

```
GFS personal mode: bucket=20235-xiongdb ak=20240527... email=xiongdb@ihep.ac.cn
Mounted 8 GFS tools for personal user xiongdb@ihep.ac.cn (bucket=20235-xiongdb)
GFS personal mode enabled: 8 tools registered (user=xiongdb@ihep.ac.cn)
```

---

## 3. 验证 agent 能读写

进入 webui 或 console 后随便问：

> 帮我把 "hello world" 写到 GFS 的 `workspace/test.txt`，然后读出来确认。

agent 会调用 `gfs_write` → `gfs_read`，并把内容贴回。

也可以直接在 Python 里手测：

```python
from drsai.modules.managers.gfs import get_personal_user_client

cli = get_personal_user_client()           # 自动读环境变量
cli.write_text("workspace/test.txt", "hello world")
print(cli.read_text("workspace/test.txt"))
```

---

## 4. 常见问题

### Q: 我可以同时设两个模式的环境变量吗？
A: 可以。优先级：`DRSAI_GFS_MODE` 显式声明 > 自动判定（有 personal 凭证就走 personal）。

### Q: AKSK 会不会落盘？
A: **personal 模式不落盘**——既然是你自己保管的，没必要再缓存。
（admin 模式才会缓存到 `~/.drsai/.cache/gfs/`，因为 admin 模式是 worker 拿来的）

### Q: agent 会不会看到我的 SK？
A: 不会。`gfs_*` 工具都是闭包，agent 只能调用工具的输入参数，看不到底层 AKSK。
凭证只存在于 worker 进程的内存中。

### Q: bucket 名字写错了会怎样？
A: 启动时 `healthcheck`（一次空 list）就会失败，日志报 `PERSONAL_CREDENTIAL_UNUSABLE`，
然后 GFS 工具会**降级为不挂载**，agent 仍能正常用其它工具。

### Q: 切换到 admin 模式怎么做？
A: 设 `DRSAI_GFS_MODE=admin` + `GFS_OPENAPI_KEY=<key>`，把 `GFS_ACCESS_KEY` 等清掉即可。

---

## 5. 文件改动一览

```
cores/python/packages/drsai/src/drsai/modules/managers/gfs/
├── provisioner.py        # + credential_from_env(), get_personal_user_client()
├── agent_tools.py        # + make_gfs_tools_personal(), 抽出 _build_tools()
└── __init__.py           # 导出新 API

run_drsai_agent.py         # _build_gfs_tools() 支持 mode 自动判定
.env.example               # 增加 GFS personal 模式配置示例
```
