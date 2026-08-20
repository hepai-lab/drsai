## 7 模型与推理控制

### 7.1 模型切换

OpenDrSai CLI 支持在会话内即时切换模型，有两种模式：

| 命令 | 别名 | 作用域 | 说明 |
|------|------|--------|------|
| `/model <alias>` | `/m` | session-local | 仅当前会话切换，不影响全局配置 |
| `/model_global <alias>` | `/mg` | session + global | 当前会话切换 + 保存为全局默认 |

**其他用法**：

```
/model                # 无参 → 弹出 ModelPicker 覆盖层
/model info <alias>   # 查看模型详细信息（model ID、token limit、推理支持）
```

**ModelPicker 快捷键**（在覆盖层内）：

| 按键 | 行为 |
|------|------|
| `↑/↓` | 移动光标 |
| `Enter` | 切换到光标行 |
| `1-9` | 跳到第 N 项并切换 |
| `f-z` | 跳到第 10+ 项并切换 |
| `a` | 新增模型（打开 ModelEditor） |
| `e` | 编辑光标行（打开 ModelEditor） |
| `d` | 删除光标行 |
| `Esc` | 关闭 |

### 7.2 模型库管理（add / edit / rm）

模型目录持久化到 `cli_config.json` 中 `llm_config_file` 指向的 YAML 文件。修改后**无需重启**，新别名立即可用。

```
/model add                      # 弹出空白表单
/model add <alias>              # 弹出表单，alias 预填
/model edit <alias>             # 直接编辑指定 alias
/model edit                     # 先弹 ModelPicker，按 e 选要编辑的
/model rm <alias>               # 删除别名
```

**ModelEditor 表单字段**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `alias` * | 文本 | 必填；不能含空格、不能以 `_` 开头 |
| `model_id` * | 文本 | 必填；如 `openai/gpt-5.5`、`anthropic/claude-sonnet-4-6` |
| `token_limit` | 整数 | 上下文窗口大小（输入 + 输出共享或独立，按模型而定） |
| `max_tokens` | 整数 | 单次最大输出 token；`0` = 自动（≈ token_limit × 25%） |
| `client_type` | 枚举 | `auto` / `openai` / `anthropic` |
| `reasoning supported` | 复选框 | 是否启用推理；关闭时下面两行禁用 |
| `param_type` | 枚举 | `none` / `adaptive` / `enabled` / `is_r1_model` / `reasoning_effort` / `minimax_format` / `zhipu_format` |
| `effort_levels` | 文本 | 逗号分隔，例如 `low,medium,high`；空 = 任意强度 |

**ModelEditor 快捷键**：

| 按键 | 行为 |
|------|------|
| `Tab` / `Shift+Tab` | 切换字段焦点（自动跳过禁用项） |
| `↑/↓` | 同上 |
| `←/→` | 切换枚举值（`client_type` / `param_type`） |
| `Space` | 切换复选框 / 推进枚举 |
| 任意可见字符 | 文本字段编辑；number 字段只接受数字 |
| `Backspace` | 删除一字符 |
| `Enter` | 提交（前端最低校验 + 后端权威校验） |
| `Esc` | 取消（不写盘） |

**提交语义**：
- 新增 alias：保存成功后**自动切到该模型**（session-local）。
- 编辑 alias 且不改名：当前会话不会自动重新加载该 alias 的 client，下次 `/model <alias>` 会拿到新配置。
- 编辑时改名（`alias` 改成了新值）：旧 alias 从目录中删除；新 alias 自动切到当前会话；如果旧 alias 是全局默认，自动改写默认指针。
- 校验失败：错误信息红字显示在表单底部，表单不关闭，用户改完再 Enter。

**后端校验规则**（所有规则在 `model.save` RPC 中强制执行）：
- `alias`：非空、不含空格、首字符字母数字、不以 `_` 开头、不与现有 alias 冲突（编辑时排除自己）
- `model_id`：非空
- `client_type` ∈ `{auto, openai, anthropic}`
- 若 `reasoning.supported = true`，`param_type` 必须在白名单内
- `token_limit` 和 `max_tokens` 必须为非负整数

**删除规则**：
- 不能删除最后一个剩余 alias（避免目录为空）
- 删除的若是当前会话使用的模型，自动切到第一个剩余 alias
- 删除的若是全局默认，自动改写默认指针到第一个剩余 alias

### 7.3 模型列表

```
/models               # 列出所有可用模型，显示推理支持信息
/models reasoning     # 只列出支持推理的模型
```

输出示例：
```
  Available models (8 total)
  ──────────────────────────────────────────────────────────────────────
  Alias                              Reasoning       Effort Levels
  ──────────────────────────────────────────────────────────────────────
  → minimax-m2.7-highspeed           ❌ none          -
    claude-sonnet-4-6                 ✅ extended      adaptive
    deepseek-v4-pro                   ✅ R1 model      unlimited
  ──────────────────────────────────────────────────────────────────────
```

### 7.4 快速模式

```
/fast                 # 切换到最快的模型别名（自动识别 highspeed/flash/haiku）
/fast off             # 切换回默认模型
```

### 7.5 推理控制

```
/reasoning            # 切换推理框显示 (on/off)
/reasoning show       # 显示推理框
/reasoning hide       # 隐藏推理框
/reasoning low        # 设置推理强度为 low
/reasoning medium     # 设置推理强度为 medium
/reasoning high       # 设置推理强度为 high（自动开启推理框）
/reasoning xhigh      # 设置推理强度为 xhigh
```

推理强度通过 `DrSaiCLIAssistant.reasoning_effort` 属性设置，支持值：`off`, `low`, `medium`, `high`, `xhigh`。

---

---

