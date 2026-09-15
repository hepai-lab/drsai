# Runtime 审批限制全面屏蔽报告

> 日期：2026-08-31
> 状态：已完成
> 关联：`research.md`（审批拦截机制调研）、`change.md`（方案 A 修改）

---

## 一、概述

对 OpenDrSai Runtime 中所有限制最长输出、工具调用次数、Web 搜索次数、消息预算的审批拦截机制进行了全面屏蔽。所有原始代码均以**注释形式保留**，标注了 `# === BYPASS ===` 标记，便于后续回滚。

共涉及 **2 个文件、8 个修改点**。

---

## 二、修改清单

### 2.1 `agent_kernel.py` — 核心常量与决策函数

| # | 修改点 | 行号 | 原始值 | 修改后 | 屏蔽方式 |
|---|--------|------|--------|--------|----------|
| 1 | `resolve_tool_decision()` | L504-540 | 完整审批逻辑 | `return direct_answer` | bypass return + 原始代码注释 |
| 2 | `DEFAULT_MAX_TOOL_ROUNDS` | L51 | 24 | **100_000** | 注释原始值 + 新值 |
| 3 | `DEFAULT_MAX_PARALLEL_TOOL_CALLS` | L52 | 8 | **100** | 注释原始值 + 新值 |
| 4 | `MAX_INLINE_TOOL_OUTPUT_CHARS` | L53 | 16_384 | **100_000_000** | 注释原始值 + 新值 |

### 2.2 `engine.py` — Mobile 引擎运行时

| # | 修改点 | 行号 | 原始行为 | 修改后 | 屏蔽方式 |
|---|--------|------|----------|--------|----------|
| 5 | `WEB_SEARCH_MAX_ATTEMPTS` | L39 | 3 | **100_000** | 注释原始值 + 新值 |
| 6 | `_request_budget_finalization()` | L748-779 | 强制模型无工具完成 | **`return ()`** | bypass return + 原始代码注释 |
| 7 | `_finish_rejected_web_search_round()` | L781-800 | 拒绝搜索并结束 run | **`return ()`** | bypass return + 原始逻辑说明 |
| 8 | `_complete_ignored_exhausted_web_search()` | L802-820 | 搜索耗尽后强制完成 | **`return ()`** | bypass return + 原始代码注释 |

---

## 三、屏蔽链路分析

### 3.1 审批决策链路（已屏蔽 ✓）

```
用户输入 → build_tool_decision_requirement() → resolve_tool_decision()
                                                      ↓
                                              [BYPASS] → direct_answer
                                                      ↓
                                            engine._model_completed()
                                              decision["category"] != "required_tool_unavailable"
                                                      ↓
                                              正常继续执行
```

### 3.2 工具预算链路（已屏蔽 ✓）

```
_model_completed() → tool_calls 存在
    ↓
    projected_messages > max_messages? → _request_budget_finalization() → [BYPASS] return ()
    ↓
    tool_round_count >= max_tool_rounds? → _request_budget_finalization() → [BYPASS] return ()
    ↓
    正常继续执行工具
```

### 3.3 Web 搜索限制链路（已屏蔽 ✓）

```
_model_completed() → web_search 调用
    ↓
    len(web_search_queries) > WEB_SEARCH_MAX_ATTEMPTS? → [100_000, 永不触发]
    ↓
    _finish_rejected_web_search_round() → [BYPASS] return ()
    ↓
    state.web_search_exhausted = True? → [永不触发]
    ↓
    _complete_ignored_exhausted_web_search() → [BYPASS] return ()
```

### 3.4 工具输出截断链路（已屏蔽 ✓）

```
_tool_result() → normalize_tool_output()
    ↓
    len(output) > MAX_INLINE_TOOL_OUTPUT_CHARS? → [100_000_000, 永不触发]
    ↓
    完整输出保留
```

---

## 四、未修改的限制（仅诊断，不阻塞）

| 限制 | 位置 | 说明 |
|------|------|------|
| `ContextBudgetPolicy` | `agent_kernel.py` L1848 | 仅诊断报告，不阻塞执行 |
| `validate_context_within_budget()` | `agent_kernel.py` L1912 | 仅返回诊断 JSON，注释明确"Budget overflow is not fail-closed" |
| `CHAT_TIMEOUT_MS` (5分钟) | `chat.ts` L149 | 前端超时，非 runtime |
| `MAX_MESSAGES` (40) | `chat.ts` L130 | 前端请求校验，非 runtime |

---

## 五、回滚方案

所有原始代码均以注释形式保留，带有 `# === BYPASS ===` / `# === END BYPASS ===` 标记。

**回滚步骤：**
1. 删除 `# === BYPASS ===` 到 `# === END BYPASS ===` 之间的 bypass 代码
2. 取消注释原始代码
3. 恢复原始常量值

具体位置：
- `agent_kernel.py` L46-55: 常量定义
- `agent_kernel.py` L504-540: `resolve_tool_decision()` 原始逻辑
- `engine.py` L38-41: `WEB_SEARCH_MAX_ATTEMPTS`
- `engine.py` L748-779: `_request_budget_finalization()` 原始逻辑
- `engine.py` L781-800: `_finish_rejected_web_search_round()` 原始逻辑
- `engine.py` L802-820: `_complete_ignored_exhausted_web_search()` 原始逻辑

---

## 六、风险评估

| 风险 | 等级 | 说明 |
|------|------|------|
| 工具无限循环 | 🟡 中 | 模型可能陷入工具调用死循环，依赖模型自身判断停止 |
| 上下文溢出 | 🟡 中 | 消息不受限可能导致 token 超出模型上下文窗口 |
| Web 搜索滥用 | 🟢 低 | 搜索次数极大值，实际使用中不会达到 |
| 输出过长 | 🟢 低 | 工具输出截断阈值极大，正常使用不会触发 |

---

## 七、修改文件汇总

```
cores/python/packages/drsai/src/drsai/backend/runtime/agent_kernel.py
    L46-55: 常量修改 (DEFAULT_MAX_TOOL_ROUNDS, DEFAULT_MAX_PARALLEL_TOOL_CALLS, MAX_INLINE_TOOL_OUTPUT_CHARS)
    L504-540: resolve_tool_decision() bypass + 原始代码注释

cores/python/packages/drsai/src/drsai/backend/runtime/mobile_core/engine.py
    L38-41: WEB_SEARCH_MAX_ATTEMPTS 修改
    L748-779: _request_budget_finalization() bypass + 原始代码注释
    L781-800: _finish_rejected_web_search_round() bypass + 原始逻辑说明
    L802-820: _complete_ignored_exhausted_web_search() bypass + 原始代码注释
```