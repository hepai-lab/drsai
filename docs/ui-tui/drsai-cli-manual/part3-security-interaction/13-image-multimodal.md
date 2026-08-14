## 13 图像多模态输入与 @ 文件路径引用 🆕

新版 TUI 支持在 CLI 中向视觉模型（如 Claude Sonnet、GPT-4o 等）传入图像，同时支持在输入框中用 `@` 触发当前工作目录的文件/目录路径选择。图像路径会自动复用多模态能力；非图像文件路径则作为普通输入文本的一部分提交，方便 Agent 根据路径继续读取或处理。

### 13.1 `/image` 命令

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

| 写法 | 解析方式 |
|------|----------|
| `/abs/path.png` | 绝对路径 |
| `~/path.png` | 相对于用户主目录 |
| `./path.png` 或 `photos/img.png` | 相对于用户工作目录（即启动 `opendrsai` 时所在的目录） |

**限制**：
- 单张图像 ≤ 20 MB
- 单次最多 10 张图像
- 支持格式：`.png` `.jpg` `.jpeg` `.gif` `.webp` `.bmp` `.svg`

### 13.2 `@` 文件路径选择与 `@/path` 内联引用

在普通对话文本中输入独立的 `@`，TUI 会进入 **Path mode**，从当前工作目录列出文件/目录，帮助你把路径插入到输入框中：

```
请分析 @
```

输入 `@` 后，下方会显示类似竖列文件列表：

```
📂 1/8 — ↑↓ select · Tab complete · Enter open · Backspace back · Esc cancel
▸ 📁 src/
  📁 docs/
  📄 package.json
  📄 README.md
```

**Path mode 按键**：

| 按键 | 作用 |
|------|------|
| `↑` / `↓` | 在候选文件/目录中移动选择 |
| `Shift+Tab` | 反向循环候选项 |
| `Tab` | 补全当前选中项；如果是目录则进入目录，如果是文件则插入路径并退出 Path mode |
| `Enter` | 确认当前选中项；目录会进入，文件会插入路径并退出 |
| `Backspace` | 删除已输入的路径字符；删除到 `@` 时退出 Path mode |
| `Esc` | 取消 Path mode，并移除当前 `@` 路径片段 |
| 空格 | 保留当前 `@path` 文本并退出 Path mode |

插入路径后，它会成为普通输入文本的一部分。例如：

```
请解释 @./docs/architecture.md 的设计
```

如果插入的是图像文件路径，则会自动复用多模态输入能力：

```
请分析一下 @/tmp/chart.png 中的数据趋势

对比 @./before.png 和 @./after.png 的差异

看看 @~/Desktop/error.jpg 这个报错截图
```

带图像扩展名的 `@/path` 引用会在提交时被替换为 `[image: filename]` 标记，图像数据作为 `MultiModalMessage` 传给模型。`/image` 和 `@/path` 两种方式可以混用：

```
/image /tmp/a.png 然后再看 @./b.jpg 的细节
```

> ⚠️ 注意：只有带图像扩展名的 `@/path` 会被识别为图像并作为多模态附件发送。`@/tmp/readme.txt` 会保留为普通文本路径，不会自动读取为图像。

### 13.3 工作原理

```
用户输入 @ → TUI 调用 complete.path 列出当前目录 → 用户选择文件路径
  → 路径作为 @/path 文本插入输入框
  → 提交时 TUI 解析图像 @/path 或 /image → 读取图像文件 → base64 编码
  → JSON-RPC prompt.submit {text, images: [{base64, mime_type}]}
  → Gateway 构造 MultiModalMessage(content=[text, Image, ...])
  → Agent.run_stream(task=MultiModalMessage)
  → 视觉模型接收图像 + 文本
```

**注意事项**：
- 非视觉模型（不支持 vision）时，Agent 内部的 `_get_compatible_context` 会自动调用 `remove_images()` 去除图像，不会报错。
- `@` 路径候选由 gateway 的 `complete.path` RPC 提供；相对路径基于启动 `opendrsai` 时的用户工作目录。
- 图像文件读取在 TUI（Node.js）端完成，因此 **attach 模式也能正常工作**——即使 gateway 在远程机器上，本地图像仍可传入。

### 13.4 错误提示

| 场景 | 提示 |
|------|------|
| 文件不存在 | `⚠ File not found: ./photo.png (resolved: /home/user/project/photo.png)` |
| 格式不支持 | `⚠ Unsupported image format: .txt (./readme.txt)` |
| 文件过大 | `⚠ Image too large: 25.0 MB > 20 MB limit (./big.png)` |
| 图像过多 | `⚠ Too many images (max 10)` |

---

---

