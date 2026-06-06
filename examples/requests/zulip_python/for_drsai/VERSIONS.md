# Zulip Bridge 版本说明

本目录保留**多个独立可运行的 bridge 版本**，便于将来用真实 drsai 后端做 A/B 性能对比。
历史版本集中在 `versions/` 下，`bridge_latest.py` 始终索引最新版。

## 目录布局

```
zulip_python/for_drsai/
├── bridge_latest.py     # 索引最新版（当前 → versions/bridge_v1.py）
├── versions/
│   ├── bridge_v0.py     # v0 baseline：完全串行
│   └── bridge_v1.py     # v1 async：asyncio 优化版
└── VERSIONS.md          # 本文件
```

| 文件 | 版本 | 并发模型 | 定位 |
|---|---|---|---|
| `versions/bridge_v0.py` | **v0 baseline** | 完全串行（`call_on_each_message` 单线程回调） | 性能对照基线，**不要改动** |
| `versions/bridge_v1.py` | **v1 async** | asyncio + per-key 锁 + run_in_executor | 优化版，吸收 wechat / zulipchat-mcp 成熟模式 |
| `bridge_latest.py` | → 最新 | 索引到当前最新版本 | 生产入口，升级时改其 `_LATEST` 一行 |

> 评估 harness 在 `eval/harness_eval/zulip_bridge/`，用 `load_bridge(version="v0"|"v1"|"latest")` 分别加载做对照（见该目录 README）。

---

## v0 → v1 的改进点

| 编号 | 问题（v0） | v1 修复 | 借鉴来源 |
|---|---|---|---|
| P0-1 | 串行阻塞，多用户互等 | 每消息 asyncio task 并发；同步流式调用放 `run_in_executor` | drsai wechat daemon |
| P0-2 | 后端无超时 → 永久冻结 | `asyncio.wait_for(timeout=BACKEND_TIMEOUT)` + `OpenAI(timeout=)` | zulipchat-mcp / wechat |
| P1-1 | 会话内存无界增长 | `OrderedDict` + `MAX_SESSIONS` LRU 淘汰 | zulipchat-mcp 缓存思路 |
| P1-2 | 历史轮数减半（maxlen 语义 bug） | `maxlen = HISTORY_TURNS * 2`，按轮裁剪 | — |
| P2-1 | 流式编辑 API 放大 | 增大间隔 + 字符增量阈值，仅实质变化才 update | bridge 自身计划 |
| 新增 | 无消息去重 | `_seen_ids` 滚动去重 | wechat daemon |
| 新增 | 长轮询出错无退避 | 指数退避（`2^n`，上限 60s） | zulipchat-mcp MessageListener |
| 新增 | 单消息异常杀全局 | `_guarded` 包裹，异常隔离 | 通用 |

### 并发模型对齐 wechat daemon
v1 采用与 `drsai/backend/wechat/wechat_bot.py` 相同的范式：
- **每条消息一个 task** + `asyncio.Semaphore(MAX_WORKERS)` 限流
- **per-conversation `asyncio.Lock`**：同一会话串行保序，不同会话并发
- **同步阻塞调用隔离**：OpenAI 同步流式 `collect_stream` 丢进 `run_in_executor`，不阻塞事件循环
- zulip SDK 的阻塞长轮询 `call_on_each_message` 放独立线程，`call_soon_threadsafe` 把消息送入异步队列

---

## 运行方式

两个版本环境变量基本一致，可直接对照启动：

```bash
export DRSAI_BASE_URL="http://localhost:8000/v1"
export HEPAI_API_KEY="EMPTY"
export DRSAI_MODEL="myassistant"

# baseline
python versions/bridge_v0.py

# 优化版（额外开关）
export BACKEND_TIMEOUT=60        # 后端总超时秒数
export MAX_SESSIONS=1000         # 会话 LRU 上限
export MAX_WORKERS=16            # 并发处理上限
export STREAM_EDIT_INTERVAL=1.0  # 流式编辑间隔
export STREAM_EDIT_MIN_CHARS=40  # 字符增量阈值
python versions/bridge_v1.py

# 或用 latest 索引（等价于当前最新版 v1）
python bridge_latest.py
```

v1 独有的环境开关（均有默认值）：

| 变量 | 默认 | 含义 |
|---|---|---|
| `BACKEND_TIMEOUT` | 60 | 后端调用总超时（秒） |
| `MAX_SESSIONS` | 1000 | 会话数上限，超出 LRU 淘汰 |
| `MAX_WORKERS` | 16 | 并发处理消息上限 |
| `STREAM_EDIT_INTERVAL` | 1.0 | 流式编辑最小间隔（秒） |
| `STREAM_EDIT_MIN_CHARS` | 40 | 触发编辑的最小新增字符数 |

---

## 真实 A/B 性能测试建议

将来要用**真实 drsai 后端**对比两版本时：

1. **固定变量**：同后端、同模型、同 `.zuliprc`、同机器、同一批测试消息。
2. **分别启动**：v0 与 v1 各跑一次（注意不要同时连同一个 bot，会抢消息）。
3. **观测指标**（详见 `eval/harness_eval/zulip_bridge/PERF_EVAL_PLAN.md`）：
   - 多用户并发吞吐、P95/P99 时延、队头阻塞
   - 后端故障注入下的恢复时间
   - 长稳运行内存 / 会话数
   - 长回复的 `update_message` 调用次数
4. **离线快速校验**：无需真实后端，`eval/harness_eval/zulip_bridge/verify_async.py` 用假 SDK 驱动 v1 真实代码，验证并发/保序/超时/LRU 四项已生效。

---

## 行为兼容性

v1 与 v0 在**对用户可见的行为**上保持一致：
- 相同的 `chat_id` 规则（私聊 `dm:<ids>`、频道 `stream:<id>:<topic>`）
- 相同的命令（`/help` `/ping` `/reset`）
- 相同的 mention 解析（频道需 @ 才响应，去除 `@**...**` 再喂模型）

差异仅在**内部实现与资源管理**，因此可作为同一接口的两个性能档位直接对比。
