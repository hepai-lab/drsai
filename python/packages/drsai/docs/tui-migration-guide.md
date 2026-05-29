# DrSai TUI 迁移指南：从 `drsai chat` 到新版 TUI

本指南帮助用户从旧版 `drsai chat` CLI 迁移到 Phase 0-4 重写的双进程 TUI（Ink UI + Python JSON-RPC gateway）。

---

## 主要变化

| 维度 | 旧版（`drsai chat`） | 新版（`drsai-tui`） |
|------|----------------------|---------------------|
| 渲染层 | prompt_toolkit + 直写 stdout | TypeScript + React + Ink |
| 进程模型 | 单进程 | UI 进程 ↔ Gateway 子进程（JSON-RPC over stdio/WebSocket） |
| 协议 | 直接调用 Python 内部 API | JSON-RPC 2.0 |
| 远程连接 | 不支持 | WebSocket attach 模式 |
| 智能体后端 | 同一份 | **完全不变** |
| 会话存储 | `CLISessionStore` | **复用同一存储** |
| 配置 | `cli_config.json` | **复用同一配置** |

## 启动方式

### 旧版

```bash
drsai chat                  # 启动 REPL
drsai chat --skip-setup     # 跳过设置向导
```

### 新版

```bash
# 标准模式（最常用）
drsai-tui

# 或直接进入 ui-tui 目录
cd ui-tui && pnpm dev

# 远程 attach 模式（连接已运行的 gateway）
drsai-tui --attach ws://127.0.0.1:8765/attach
```

> 旧版 `drsai chat` 仍然可用（Phase 3 已保留，标记为 deprecated）。建议在迁移期间并行使用，验证新版功能。

## Slash 命令兼容性

**全部 30+ 个命令已迁移**，名称和行为保持一致：

| 命令 | 状态 |
|------|------|
| `/help`, `/quit`, `/config`, `/info` | ✅ 完全兼容 |
| `/model`, `/models`, `/model_global` | ✅ 完全兼容 + **新增可视化选择器**（无参数调用时弹出） |
| `/list`, `/switch` | ✅ 完全兼容 + **新增可视化选择器**（无参数调用时弹出） |
| `/new`, `/rename`, `/history`, `/save`, `/clear`, `/retry` | ✅ 完全兼容 |
| `/plan_mode`, `/pm_global`, `/inject` | ✅ 完全兼容 |
| `/workspace`, `/ws_global`, `/dangerous`, `/dg_global` | ✅ 完全兼容 |
| `/memory`, `/init`, `/agent`, `/delegate` | ✅ 完全兼容 |
| `/reasoning`, `/verbose`, `/bell`, `/fast` | ✅ 完全兼容 |
| `/image`, `/img` | 🆕 **新增** — 图像多模态输入 |
| `/cd`, `/workdir` | ⚠️ 桌面 GUI 专用，CLI 自动使用当前目录 |
| 旧 Tk/Tray GUI 命令：`/install`, `/tray`, `/win_*` | 🗑️ 已移除，新的多平台 GUI 由 `desktop/` 项目承接 |

## 新功能

### 1. 可视化选择器

**会话选择**：`/list` 或 `/switch`（无参数）→ 弹出选择面板

```
┌─ Select session ──────────────────────────────────────┐
│ ▶ 1. main-work        [05dc4aef] msgs=42 ← current   │
│   2. doc-review       [a3b2c1d4] msgs=8              │
│   3. exploration      [9f8e7d6c] msgs=12             │
│                                                       │
│ ↑/↓ navigate · Enter select · 1-9 jump · Esc cancel  │
└───────────────────────────────────────────────────────┘
```

**模型选择**：`/model`（无参数）→ 弹出选择面板

```
┌─ Select model ────────────────────────────────────────┐
│ ▶ 1. default        — claude-sonnet-4-5  ← current   │
│   2. fast           — claude-haiku-4-5               │
│   3. opus           — claude-opus-4-7 [reasoning: low,medium,high] │
└───────────────────────────────────────────────────────┘
```

### 2. WebSocket Attach 模式

启动 gateway 时启用 WebSocket：

```bash
DRSAI_TUI_ENABLE_WS=1 DRSAI_TUI_WS_PORT=8765 drsai-tui
```

从另一个终端 attach：

```bash
drsai-tui --attach ws://127.0.0.1:8765/attach
```

两个 UI 实例**共享同一个 agent + 会话状态**。

### 3. 改进的 Markdown 渲染

- ` ```代码块``` ` — 带边框显示，语言标签
- `` `内联代码` `` — 突出显示
- `**粗体**` / `*斜体*`
- `# 标题` `## 二级标题`
- `> 引用`
- `- 列表` `1. 有序列表`

### 4. 虚拟滚动

超过 50 条消息时只渲染最近 50 条（终端 scrollback 仍保留旧消息），1000+ 消息会话不再卡顿。

### 5. 图像多模态输入 🆕

新版 TUI 支持在 CLI 中向视觉模型（如 Claude Sonnet、GPT-4o 等）传入图像。提供两种方式，可自由组合使用。

#### 方式 A：`/image` 命令

直接发送一张或多张图像作为一轮对话：

```
# 单张图像 + 描述
/image /tmp/photo.png 描述一下这张图片

# 多张图像 + 描述
/image /tmp/a.png ./b.jpg ~/pics/c.webp 比较这三张图

# 仅图像（无描述时自动用文件名）
/image ~/Desktop/screenshot.png

# /img 是 /image 的别名
/img ./diagram.png 解释这个流程图
```

**路径规则**：
- `/abs/path.png` — 绝对路径
- `~/path.png` — 相对于用户主目录
- `./path.png` 或 `photos/img.png` — 相对于用户工作目录（即启动 `drsai` 时所在的目录，而非 ui-tui 内部目录）

**限制**：
- 单张图像 ≤ 20 MB
- 单次最多 10 张图像
- 支持格式：`.png` `.jpg` `.jpeg` `.gif` `.webp` `.bmp` `.svg`

#### 方式 B：`@/path` 内联引用

在普通对话文本中嵌入图像路径，用 `@` 标记：

```
请分析一下 @/tmp/chart.png 中的数据趋势

对比 @./before.png 和 @./after.png 的差异

看看 @~/Desktop/error.jpg 这个报错截图
```

`@` 引用会在提交时被替换为 `[image: filename]` 标记，图像数据作为 `MultiModalMessage` 传给模型。两种方式可以混用：

```
/image /tmp/a.png 然后再看 @./b.jpg 的细节
```

> ⚠️ 注意：`@` 引用只匹配带图像扩展名的路径。`@/tmp/readme.txt` 不会被识别为图像。

#### 工作原理

```
用户输入 → TUI 解析 @/path 或 /image → 读取文件 → base64 编码
  → JSON-RPC prompt.submit {text, images: [{base64, mime_type}]}
  → Gateway 构造 MultiModalMessage(content=[text, Image, ...])
  → Agent.run_stream(task=MultiModalMessage)
  → 视觉模型接收图像 + 文本
```

- 非视觉模型（不支持 vision）时，Agent 内部的 `_get_compatible_context` 会自动调用 `remove_images()` 去除图像，不会报错。
- 文件读取在 TUI（Node.js）端完成，因此 **attach 模式也能正常工作**——即使 gateway 在远程机器上，本地图像仍可传入。

#### 错误提示

| 场景 | 提示 |
|------|------|
| 文件不存在 | `⚠ File not found: ./photo.png (resolved: /home/user/project/photo.png)` |
| 格式不支持 | `⚠ Unsupported image format: .txt (./readme.txt)` |
| 文件过大 | `⚠ Image too large: 25.0 MB > 20 MB limit (./big.png)` |
| 图像过多 | `⚠ Too many images (max 10)` |

## 环境变量

| 变量 | 说明 | 默认 |
|------|------|------|
| `DRSAI_TUI_ENABLE_WS` | 启用 WebSocket 服务器 | 不启用 |
| `DRSAI_TUI_WS_PORT` | WebSocket 端口 | 8765 |
| `DRSAI_TUI_ATTACH_URL` | 连接到已有 gateway | — |
| `DRSAI_PYTHON` | Python 解释器路径 | `python3` |
| `DRSAI_PYTHON_SRC_ROOT` | drsai 源码根路径 | 自动检测 |
| `DRSAI_TUI_STARTUP_TIMEOUT_MS` | 启动超时（ms） | 15000 |
| `DRSAI_TUI_RPC_TIMEOUT_MS` | RPC 超时（ms） | 120000 |
| `DRSAI_TUI_RPC_POOL_WORKERS` | Gateway 线程池大小 | 4 |

## 故障排除

### Gateway 启动失败

查看日志：`~/.drsai/logs/tui_gateway_crash.log`

常见原因：
- Python 解释器路径错误 → 设置 `DRSAI_PYTHON=/path/to/python`
- 缺少依赖 → 在 drsai 项目下 `pip install -e .`

### UI 卡在 "connecting to gateway"

- Gateway 子进程崩溃，查看 stderr：UI 右侧会显示 `gateway.stderr` 行
- 首次启动 agent 加载技能可能需要 30-60 秒，请耐心等待

### Slash 命令报错 "unknown slash command"

确认 gateway 已加载新 handlers：
```bash
python -c "from drsai.backend.tui_gateway.handlers import slash; print(len(slash.SLASH_HANDLERS))"
# 期望: 41+
```

## 回滚到旧版

旧版未删除，可直接使用：

```bash
drsai chat
```

如需在新版未稳定时使用旧版的 SSE Gateway（Electron 桌面端）：

```bash
# 旧 gateway.py 仍在 python/packages/drsai/src/drsai/backend/gateway.py
python -m drsai.backend.gateway
```

## 已知限制（计划在 Phase 5+ 解决）

- 暂无完整 fuzzy 命令补全 UI（基础 `complete.slash` RPC 已就绪）
- WebSocket 客户端无自动重连
- Markdown 代码块暂无语法高亮
- 旧 Tk/Tray GUI 命令（`/install`、`/tray`、`/win_*`）已移除；新的多平台 GUI 由仓库根目录 `desktop/` 项目承接

## 反馈

如发现兼容性问题，请：
1. 复现命令 + 错误输出
2. `~/.drsai/logs/tui_gateway_crash.log` 末尾内容
3. Gateway stderr（UI 中的 `gateway.stderr` 行）

提交到项目 issue 跟踪。
