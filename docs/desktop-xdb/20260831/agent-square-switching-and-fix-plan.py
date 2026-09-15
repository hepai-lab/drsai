#!/usr/bin/env python3
"""Write the solution report with correct UTF-8 encoding."""
report = r"""# 智能体广场切换设计与修复方案

## 一、问题概述

改造（取消智能体选择 + 任务模式→计划模式）后发现三个问题：

| # | 现象 | 根因 |
|---|------|------|
| 1 | 智能体广场切换智能体后聊天报 "OpenDrSai 未能完成操作" | `context_window_tokens_invalid` 异常 |
| 2 | 工作区构建智能体提问报 `ValueError: context_window_tokens_invalid` | 同上 |
| 3 | 远程智能体没有工作区，session 建立时未考虑此情况 | `runRuntimeBackendChat` 要求 `workspacePath` |

## 二、智能体广场架构分析

### 2.1 智能体类型分类

桌面智能体广场通过 `listAgents()` (`agents.ts:L96`) 返回一个合并列表，由两类来源组成：

```
listAgents()
  ├── listLocalAgents()          ← 本地智能体
  │     ├── listConfiguredAgents()           ← OpenDrSai 配置的智能体
  │     ├── listExternalAgentRuntimeAgents() ← 外部注册的 OAEP Runtime 智能体
  │     └── Codex agent (my-codex)           ← 手动添加的 Codex
  │
  └── listPlatformAgents()       ← HAI 平台智能体
        └── fetchHostedAgentCatalog()        ← 从 HAI Portal 拉取
```

**注意**：设备远程智能体 (`remoteAgents.ts` 的 `listDeviceRemoteAgents()`) **不会**被合并到广场列表中。
代码 `agents.ts:L110-113` 明确注释：
> "The Agent Square has exactly two authorities: this device owns OpenDrSai,
> and HAI owns every other catalog entry. Do not merge legacy device-side
> remote-agent records here."

### 2.2 DesktopAgent 数据结构

```typescript
// desktopApi.ts:L3401-3426
interface DesktopAgent {
  id: string;
  name: string;
  source: "local" | "remote";     // ← 关键区分字段
  status: "running" | "stopped" | "unreachable";
  mode?: string;                    // "local" | "oaep-runtime" | "remote"
  capabilities?: string[];          // ["chat","workspace","tools"] 等
  url?: string;                     // 远程智能体的连接 URL
  model?: string;                   // 绑定的模型
  models?: string[];                // 支持的模型列表
  catalogGroup?: "local" | "official" | "mine";
}
```

### 2.3 各类智能体的属性

| 类型 | source | mode | capabilities | 有 workspace | 有 url |
|------|--------|------|-------------|-------------|--------|
| OpenDrSai 本地 | "local" | "local" | chat,workspace,tools | ✅ | gateway.baseUrl |
| Codex | "local" | "local" | chat,streaming,workspace,tools | ✅ | — |
| 外部 OAEP Runtime | "local" | "oaep-runtime" | chat,streaming,workspace,tools | ❓ | descriptor.baseUrl |
| HAI 平台 | "remote" | — | chat,streaming | ❌ | platform baseUrl |
| 设备远程 | "remote" | "remote" | chat,streaming | ❌ | record.url |

### 2.4 聊天分发路径

`chat.ts:runChat()` (L964) 中的三分式分发：

```
runChat(request)
  │
  ├── ① 检查 platformDescriptor = getPlatformAgentExecutionDescriptor(agentId)
  │     ↓ 找到 → fetch SSE 路径（不需要 workspacePath）
  │         POST {platformBaseUrl}/chat/completions
  │         model: platformDescriptor.platformId
  │
  ├── ② 未找到 platformDescriptor → 读取 configuredAgents = listConfiguredAgents()
  │     ↓ localAgent = configuredAgents.agents.find(...)
  │     ↓ 找到 → runRuntimeBackendChat()
  │         ❌ 要求 request.workspacePath（L1831: throw if missing）
  │         → connectRuntimeClientForWorkspace(workspacePath)
  │         → 本地 Gateway OAEP Session/Run
  │
  └── ③ 未找到 localAgent && 不是 Codex && 不是 platform → throw
          "The selected platform agent is unavailable"
```

**关键发现**：
- **外部 OAEP Runtime 智能体**在广场中可见（通过 `listExternalAgentRuntimeAgents`），但在 `runChat` 中既不在 `platformExecutionDescriptors` 也不在 `configuredAgents.agents`，会触发路径③报错
- **设备远程智能体**不在广场中显示（代码明确排除），但如果通过其他方式选择也会触发路径③

## 三、问题根因详解

### 3.1 问题1&2: context_window_tokens_invalid

**验证链**：
```
model_defaults.py
  │  deepseek-v4-flash: token_limit=10000000  ← 10M，注释写的 163,840
  │  hepai/deepseek-v4-flash: token_limit=10000000  ← 同上
  ↓
run_drsai_agent_factory.py:L966
  │  assistant._p9_context_budget = {
  │    "context_window_tokens": int(token_limit),  ← 10000000
  │    ...
  │  }
  ↓
desktop_agent_kernel_adapter.py:L1757
  │  context_budget = getattr(agent, "_p9_context_budget", None)
  ↓
agent_kernel.py:L1879-1880
  │  if not isinstance(result.context_window_tokens, int)
  │     or not 1_024 <= result.context_window_tokens <= 2_000_000:
  │      raise ValueError("context_window_tokens_invalid")  ← 10M > 2M，抛出异常
```

**根本原因**：`model_defaults.py` 中 `deepseek-v4-flash` 的 `token_limit=10000000` (10M) 超出了 `agent_kernel.py` 的 `ContextBudgetPolicy` 验证上限 `2_000_000` (2M)。

同时注释写的是 "context window: 163,840"，说明 `10000000` 这个值本身就是错误的。

**前端表现**：后端抛出 `ValueError` → HTTP 500 → 前端 `userFacingErrors.ts:L34` 显示通用消息 "OpenDrSai 未能完成操作"。

### 3.2 问题3: 远程智能体没有工作区

**根因**：`runRuntimeBackendChat` (chat.ts:L1831) 硬性要求 `request.workspacePath`：
```typescript
if (!request.workspacePath) throw new Error("Runtime Agent requires an open Workspace.");
```

但远程智能体（HAI 平台智能体）没有本地工作区。虽然 HAI 平台智能体走 fetch SSE 路径（①），不经过 `runRuntimeBackendChat`，但：
- `selectChatAgent` (App.tsx:L2036-2042) 创建 thread 时硬编码 `workspacePath: effectiveWorkspacePath`
- 即使切换到远程智能体，thread 仍绑定 workspace

这意味着如果将来需要支持非平台远程智能体（如外部 OAEP Runtime 智能体），需要增加新的分发路径。

## 四、修复方案

### 4.1 修复 context_window_tokens_invalid（立即修复）

**方案A（推荐）**：修正 `model_defaults.py` 中的错误值

`deepseek-v4-flash` 的注释明确写着 "context window: 163,840"，所以 `token_limit=10000000` 是一个错误值。修正为 `163840`：

**文件**：`cores/python/packages/drsai/src/drsai/config/model_defaults.py`

```python
# L212-218: hepai/deepseek-v4-flash
"hepai/deepseek-v4-flash": ModelEntry(
    model="hepai/deepseek-v4-flash",
    token_limit=163840,       # ← 从 10000000 改为 163840（修正：与注释一致）
    max_tokens=64000,
    ...
),

# L228-234: deepseek-v4-flash
"deepseek-v4-flash": ModelEntry(
    model="deepseek-ai/deepseek-v4-flash",
    token_limit=163840,       # ← 从 10000000 改为 163840
    max_tokens=64000,
    ...
),
```

**方案B（备选）**：提高 `agent_kernel.py` 的验证上限

```python
# agent_kernel.py:L1879
# 从 2_000_000 提高到 10_000_000
if not isinstance(result.context_window_tokens, int) or not 1_024 <= result.context_window_tokens <= 10_000_000:
```

**推荐方案A**，原因：
1. 注释已写明实际 context window 是 163,840，10M 是错误值
2. 10M 的 context window 对 DeepSeek V4 Flash 不现实
3. 不需要修改核心验证逻辑，风险更低

### 4.2 远程智能体 workspace 处理方案

当前架构中，智能体广场只显示两类智能体：
1. **本地智能体**（OpenDrSai、Codex、外部 OAEP Runtime）— 有 workspace
2. **HAI 平台智能体** — 无 workspace，走 fetch SSE 路径

**现有路径分析**：

| 智能体类型 | runChat 路径 | 需要 workspace |
|-----------|-------------|---------------|
| OpenDrSai 本地 | runRuntimeBackendChat | ✅ 需要 |
| Codex | runRuntimeBackendChat | ✅ 需要 |
| HAI 平台 | fetch SSE | ❌ 不需要 |
| 外部 OAEP Runtime | ❌ 路径③报错 | — |
| 设备远程 | 不在广场显示 | — |

**对于 HAI 平台智能体**（已有支持）：
- `runChat` 已正确分发到 fetch SSE 路径
- `selectChatAgent` 创建 thread 时仍绑定 `effectiveWorkspacePath`，但这不影响 fetch SSE 路径
- **无需修改**

**对于外部 OAEP Runtime 智能体**（当前不支持，需新增路径）：

如果需要支持外部 OAEP Runtime 智能体聊天，应在 `runChat` 中增加第四条路径：

```typescript
// chat.ts runChat() 中，在现有三分式之后增加：
const externalDescriptor = getExternalAgentRuntimeDescriptor(requestedAgentName);
if (externalDescriptor && !localAgent && !platformDescriptor && !isCodexBackend) {
    // 外部 OAEP Runtime 智能体：直接连接其 baseUrl，不需要 workspace
    await runExternalRuntimeChat(
        webContents, requestId, sessionId, enrichedRequest, controller,
        externalDescriptor, auth,
    );
    return;
}
```

`runExternalRuntimeChat` 需要实现为：
- 使用 `externalDescriptor.baseUrl` 和 `externalDescriptor.bearerToken` 连接
- 走 OAEP Session/Run 协议
- 不需要 `workspacePath`

### 4.3 selectChatAgent 的 workspace 处理

`selectChatAgent` (App.tsx:L2022) 在创建新 thread 时使用 `workspacePath: effectiveWorkspacePath`。

对于本地智能体：正确，需要 workspace。
对于 HAI 平台智能体：thread 绑定 workspace 不影响 fetch SSE 路径，但语义上不太准确。

**建议改进**（可选，低优先级）：
```typescript
// App.tsx selectChatAgent() 中创建 thread 时
const thread = await desktopApi.createThread({
    kind: "chat",
    title: ...,
    // 仅对 source === "local" 的智能体绑定 workspacePath
    workspacePath: agent.source === "local" ? effectiveWorkspacePath : undefined,
    boundAgentId: agent.id,
    boundAgentName: agent.name,
});
```

## 五、实施步骤

### 步骤1：修复 token_limit（立即，5分钟）

修改 `cores/python/packages/drsai/src/drsai/config/model_defaults.py`：
- L214: `token_limit=10000000` → `token_limit=163840`
- L230: `token_limit=10000000` → `token_limit=163840`

验证：
```bash
python -c "from drsai.config.model_defaults import DEFAULT_LLM_MODE_CONFIG; e = DEFAULT_LLM_MODE_CONFIG['deepseek-v4-flash']; print(f'token_limit={e.token_limit}')"
```

### 步骤2：验证聊天功能（立即，2分钟）

启动桌面版，切换到使用 `deepseek-v4-flash` 模型的智能体，发送消息，确认不再报 `context_window_tokens_invalid`。

### 步骤3：清理死代码（可选，15分钟）

清理 `ChatWorkspace.tsx` 中改造1遗留的死代码：
- `introMenuOpen` (L569)
- `introSearchQuery` (L570)
- `introPickerRef` (L796)
- `toggleIntroMenu` (L2605)
- `filteredIntroWorkspaces` / `filteredIntroAgents` (L1152-1161)
- intro Escape/pointerdown handler (L831-846)

### 步骤4：外部 OAEP Runtime 智能体支持（按需，1-2小时）

如果需要支持外部 OAEP Runtime 智能体聊天：
1. 在 `chat.ts:runChat()` 中增加 `getExternalAgentRuntimeDescriptor()` 检查
2. 实现 `runExternalRuntimeChat()` 函数
3. 在 `selectChatAgent` 中根据 `agent.mode` 决定是否绑定 workspacePath

## 六、风险评估

| 修改 | 风险 | 影响范围 |
|------|------|---------|
| 修正 token_limit=163840 | 低 | 仅影响 deepseek-v4-flash 模型的 context budget 计算 |
| 清理死代码 | 低 | 不影响功能，仅移除未使用变量 |
| 外部 Runtime 支持 | 中 | 需要新增 chat 路径和测试 |

## 七、总结

三个问题中，问题1和2是同一根因（token_limit 值错误），修正 `model_defaults.py` 即可解决。问题3涉及远程智能体的 workspace 处理，当前 HAI 平台智能体已有支持（fetch SSE 路径），外部 OAEP Runtime 智能体需要按需增加新路径。
"""

with open("docs/desktop-xdb/20260831/agent-square-switching-and-fix-plan.md", "w", encoding="utf-8") as f:
    f.write(report)

print(f"Report written: {len(report)} chars")
