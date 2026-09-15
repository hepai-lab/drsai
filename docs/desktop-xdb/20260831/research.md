# OpenDrSai 安全审批拦截机制调研报告

> 日期：2026-08-31
> 作者：OpenDrSai 分析
> 状态：已完成

---

## 一、概述

OpenDrSai 的安全审批（Security Approval）机制并非单一模块，而是由 **能力需求分类 → 模型响应校验 → 错误处理** 三层组成的一条拦截链路。其主要目的是防止模型在不具备必要能力（如联网检索）时给出未经核实的答案。

---

## 二、架构全景

```
用户输入
  │
  ▼
① build_tool_decision_requirement()   ← 关键词匹配，判断需要哪些能力域
  │                                       (retrieval / workspace / process / ...)
  ▼
② 模型生成响应
  │
  ▼
③ resolve_tool_decision()             ← 校验模型是否调用了正确的工具
  │
  ├─ required_tool_unavailable  → 拦截！系统返回友好提示
  ├─ required_tool_selected     → 放行
  ├─ wrong_tool_selected        → 重试（已废弃，现直接放行）
  ├─ required_tool_omitted      → 重试（已废弃，现直接放行）
  └─ direct_answer              → 放行
  │
  ▼
④ 错误处理层
  ├─ Mobile:  engine.py _model_completed()  → 生成中文错误消息
  └─ Desktop: _agent_backend.py _failure()  → 转换为 RuntimeExecutionError
```

---

## 三、关键文件与函数

### 3.1 能力需求分类

| 文件 | 函数 | 行号 | 作用 |
|---|---|---|---|
| `agent_kernel.py` | `build_tool_decision_requirement()` | L198-262 | 分析用户输入，通过关键词匹配确定 `required_domains` |

**触发关键词（部分）：**

| 能力域 | 中文关键词 | 英文关键词 |
|---|---|---|
| retrieval | 最新、今天、核实、查证、来源、搜索、检索、联网 | latest, today, verify, source, citation, search |
| workspace | 读取文件、写入文件、修改文件 | read file, write file, edit file |
| process | 执行命令 | powershell, execute command |
| device | 这台设备、安卓版本 | this device, android version |
| memory | 记住、已保存、我的偏好 | remember, saved memory, my preference |
| plan | 制定计划、多步骤 | create a plan, multi-step |
| delegate | 并行调查 | delegate, parallel investigation |

### 3.2 模型响应校验

| 文件 | 函数 | 行号 | 作用 |
|---|---|---|---|
| `agent_kernel.py` | `resolve_tool_decision()` | L486-534 | 校验模型工具选择是否满足需求 |
| `agent_kernel.py` | `_tool_decision_domain()` | L147-183 | 将工具名映射到能力域 |

**决策分类：**

| 分类 | 条件 | 行为 |
|---|---|---|
| `required_tool_unavailable` | 所需能力完全不可用 | **拦截** |
| `required_tool_selected` | 模型正确选择了所需工具 | 放行 |
| `wrong_tool_selected` | 模型选了工具但不匹配 | 放行（已废弃拦截） |
| `required_tool_omitted` | 模型未选工具但需要 | 放行（已废弃拦截） |
| `direct_answer` | 无需工具 | 放行 |

### 3.3 错误处理

| 文件 | 位置 | 作用 |
|---|---|---|
| `mobile_core/engine.py` | L982-1001 | 生成中文错误消息："当前运行位置缺少完成核实所需的检索或主机能力..." |
| `desktop_gateway/_agent_backend.py` | L51-67 | 将 `RuntimeError("required_capability_unavailable")` 转换为 `RuntimeExecutionError` |
| `gateway_legacy.py` | L3258-3267 | 同上（旧版网关） |

---

## 四、拦截触发条件

### 4.1 必要条件

拦截触发需**同时满足**以下条件：

1. 用户输入包含能力域触发关键词（如"核实"、"搜索"）
2. 当前运行环境中**没有**对应能力域的工具
3. 模型返回了文本回答（而非工具调用）

### 4.2 不触发拦截的情况

- 用户输入不含关键词 → `direct_answer`
- 环境中有对应工具且模型正确调用 → `required_tool_selected`
- 之前轮次已调用过对应工具 → `required_tool_satisfied`
- 模型选了工具但不对（已废弃拦截） → 放行
- 模型未选工具但需要（已废弃拦截） → 放行

---

## 五、工具 → 能力域映射

`_tool_decision_domain()` 函数负责将工具名映射到能力域：

```python
# retrieval 域工具：
web.*, web_*, browser.*, browser_*, mcp.*, mcp_*
knowledge_search, search_web, fetch_url
run_inspect, run_manifest_read, run_compare

# workspace 域工具：
workspace.*
run_read, run_glob, run_grep, run_write, run_edit

# process 域工具：
run_powershell, run_bash

# 其他域：
get_device_info → device
get_current_time → time
save_memory, search_memory → memory
core.update_plan → plan
delegate → delegate
regression_* → regression
```

---

## 六、Desktop vs Mobile 差异

| 特性 | Mobile (Android) | Desktop |
|---|---|---|
| 拦截入口 | `engine.py` `_model_completed()` | `_agent_backend.py` `_failure()` |
| 错误消息 | 中文："当前运行位置缺少完成核实所需的检索或主机能力" | 英文："This task requires a capability that is not available..." |
| 处理方式 | 立即终止 run，返回友好提示 | 抛出 `RuntimeExecutionError` |
| 是否可重试 | 否 | 否 |

---

## 七、结论

整条拦截链路的核心决策点是 `resolve_tool_decision()` 函数。修改此函数即可同时影响 Mobile 和 Desktop 两条路径，是最经济的屏蔽方案。