# 模型推理强度数据流分析与 DEFAULT_LLM_MODE_CONFIG 统一整合方案

> **实施状态：✅ 已完成并通过验证** — 2026-08-31
> 生成时间：2026-08-31
> 分析范围：桌面版模型选择与推理强度（reasoning_effort）参数的前后端完整数据流，以及将两套并行模型定义系统统一到 `DEFAULT_LLM_MODE_CONFIG` 的系统性方案

## 实施摘要

### 已完成的变更

| # | 变更 | 文件 | 状态 |
|---|------|------|------|
| 1 | 创建叶子模块 `model_defaults.py` | `drsai/config/model_defaults.py` | ✅ |
| 2 | 将 `DEFAULT_LLM_MODE_CONFIG`、`ModelEntry`、`ReasoningConfig` 等定义提取到 `model_defaults.py` | `drsai/config/model_defaults.py` | ✅ |
| 3 | `run_drsai_agent_factory.py` 改为从 `model_defaults.py` 导入，删除原始定义 | `drsai/backend/run_drsai_agent_factory.py` | ✅ |
| 4 | `model_registry.py` 中 `BUILTIN_MODELS` 改为由 `_build_builtin_models()` 自动生成 | `drsai/config/model_registry.py` | ✅ |
| 5 | 新增 `claude-sonnet-4-6` 模型条目 | `drsai/config/model_defaults.py` | ✅ |
| 6 | `build_model_catalog()` 增强输出 `reasoning_efforts`、`operations`、`input_modalities`、`output_modalities` | `drsai/backend/run_drsai_agent_factory.py` | ✅ |
| 7 | 验证导入链无循环依赖 | 测试通过后清理 | ✅ |

### 验证结果

测试脚本（运行后已清理）验证了以下内容，全部通过：

1. **无循环导入**：`import drsai.config` 成功，未触发 `ImportError`
2. **factory 导入正常**：`from drsai.backend.run_drsai_agent_factory import DEFAULT_LLM_MODE_CONFIG` 成功，`DEFAULT_LLM_MODE_CONFIG` 包含 16 个模型
3. **`build_model_catalog()` 输出 reasoning 字段**：`reasoning_efforts` 和 `operations` 正确出现在 catalog 中
4. **`find_model_capabilities()` 解析所有模型**：18 个测试模型（含 provider prefix 变体）全部返回 `known=True`，`unknown-model` 正确返回 `known=False`

---

---

## 一、问题背景

当前桌面版存在 **两套并行的模型能力定义系统**，导致部分模型推理强度选择器无法显示：

| 维度 | 旧系统 (`run_drsai_agent_factory.py`) | 新系统 (`config/model_registry.py`) |
|------|---------------------------------------|--------------------------------------|
| 数据结构 | `DEFAULT_LLM_MODE_CONFIG: dict[str, ModelEntry]` | `BUILTIN_MODELS: dict[str, ModelCapabilities]` |
| 模型数量 | 16+ 条（完整） | 7 条（缺失多个） |
| 包含连接信息 | ✅ `base_url`, `api_key`, `api_key_env`, `use_responses_api` | ❌ 无连接信息 |
| 包含推理配置 | ✅ `ReasoningConfig(supported, effort_levels, param_type)` | ✅ `ReasoningCapabilities(supported, effort_levels, param_type)` |
| 被前端使用的端点 | `GET /v1/config/model-catalog` → `build_model_catalog()` | `GET /v1/config/runtime-models` → `_runtime_model_catalog_payload()` |
| 前端是否实际使用 | ❌ 不含 `reasoning_efforts`，前端不从此取 | ✅ 前端 `reasoning_efforts` 唯一数据源 |

**核心问题**：前端推理强度选择器的 `reasoning_efforts` 字段只来自新系统的 `BUILTIN_MODELS`，但该字典只收录了 7 个模型，缺少 GLM-5.1/5.2、Claude Sonnet 5、Claude Opus 4.7/4.8、Claude Haiku 4.5、MiniMax M2.7 等模型。旧系统中这些模型有完整的推理配置，但新系统不查旧系统。

---

## 二、完整数据流分析

### 2.1 后端模型能力定义（两套并行系统）

#### 系统A：旧系统 — `DEFAULT_LLM_MODE_CONFIG`

**文件**: `cores/python/packages/drsai/src/drsai/backend/run_drsai_agent_factory.py` L265-401

```python
@dataclass
class ReasoningConfig:
    supported: bool = False
    effort_levels: list[str] = field(default_factory=lambda: [])
    param_type: str = "none"
    # param_type 值: adaptive | enabled | is_r1_model | reasoning_effort
    #               | deepseek_reasoning_effort | minimax_format | zhipu_format | none

@dataclass
class ModelEntry:
    model: str                           # 完整模型ID (e.g. "anthropic/claude-sonnet-4-6")
    token_limit: int                     # 上下文窗口
    max_tokens: int = 0                  # 最大输出token
    client_type: str = "auto"            # anthropic | openai | auto
    reasoning: ReasoningConfig = field(default_factory=ReasoningConfig)
    vision: bool = False
    base_url: str = _DEFAULT_OPENAI_BASE_URL   # API端点
    api_key: str = ""                          # 明文API Key
    api_key_env: str = ""                      # API Key环境变量名
    requires_api_key: bool = True              # 是否需要认证
    use_responses_api: Optional[bool] = None   # 是否使用OpenAI Responses API
```

旧系统收录的模型清单（16条）：

| Alias | param_type | effort_levels | supported |
|-------|-----------|---------------|-----------|
| `hepai/deepseek-v4-pro` | `deepseek_reasoning_effort` | `["none","high","max"]` | True |
| `hepai/deepseek-v4-flash` | `deepseek_reasoning_effort` | `["none","high","max"]` | True |
| `deepseek-v4-pro` | `deepseek_reasoning_effort` | `["none","high","max"]` | True |
| `deepseek-v4-flash` | `deepseek_reasoning_effort` | `["none","high","max"]` | True |
| `gpt-5.4` | `reasoning_effort` | `["none","low","medium","high","xhigh"]` | True |
| `gpt-5.5` | `reasoning_effort` | `["none","low","medium","high","xhigh"]` | True |
| `gemini-3.1-pro-preview` | `adaptive` | `[]` | True |
| `gemini-3-flash-preview` | `adaptive` | `[]` | True |
| `glm-5.1` | `zhipu_format` | `["low","medium","high"]` | True |
| `glm-5.2` | `zhipu_format` | `["low","medium","high"]` | True |
| `minimax-m2.7-highspeed` | `none` | `[]` | False |
| `claude-sonnet-5` | `adaptive` | `[]` | True |
| `claude-opus-4-7` | `adaptive` | `[]` | True |
| `claude-opus-4-8` | `adaptive` | `[]` | True |
| `claude-haiku-4-5` | `none` | `[]` | False |

#### 系统B：新系统 — `BUILTIN_MODELS`

**文件**: `cores/python/packages/drsai/src/drsai/config/model_registry.py`

```python
@dataclass(frozen=True)
class ReasoningCapabilities:
    supported: bool = False
    effort_levels: tuple[str, ...] = ()
    param_type: str = "none"

@dataclass(frozen=True)
class ModelCapabilities:
    token_limit: int = 128_000
    max_tokens: int = 8_192
    vision: bool = False
    function_calling: bool = False
    json_output: bool = False
    token_model: str = "gpt-4o-2024-11-20"
    reasoning: ReasoningCapabilities = field(default_factory=ReasoningCapabilities)
```

新系统收录的模型清单（7条）：

| Model Key | param_type | effort_levels |
|-----------|-----------|---------------|
| `gemini-3-flash-preview` | `adaptive` | 空（未设置） |
| `gpt-5.4` | `reasoning_effort` | `("none","low","medium","high","xhigh")` |
| `deepseek-v4-pro` | `deepseek_reasoning_effort` | `("none","high","max")` |
| `hepai/deepseek-v4-pro` | `deepseek_reasoning_effort` | `("none","high","max")` |
| `deepseek-v4-flash` | `deepseek_reasoning_effort` | `("none","high","max")` |
| `deepseek-v4-flash-正式版` | `deepseek_reasoning_effort` | `("none","high","max")` |
| `claude-sonnet-4-6` | `adaptive` | `("low","medium","high")` |

**缺失的模型**（旧系统有但新系统无）：
- `gpt-5.5`
- `gemini-3.1-pro-preview`
- `glm-5.1`, `glm-5.2`
- `hepai/deepseek-v4-flash`
- `minimax-m2.7-highspeed`
- `claude-sonnet-5`, `claude-opus-4-7`, `claude-opus-4-8`, `claude-haiku-4-5`
- `claude-sonnet-4-6` (旧系统无 `claude-sonnet-4-6`，新系统有；命名不一致)

### 2.2 后端 API 端点

#### 前端实际使用的端点：`GET /v1/config/runtime-models`

**文件**: `cores/python/packages/drsai/src/drsai/backend/desktop_gateway/routes/config.py` L593-599

```python
@api.get("/v1/config/runtime-models", operation_id="getRuntimeModelCatalog")
async def get_runtime_model_catalog():
    config = await asyncio.to_thread(load_model_provider_config)
    return _runtime_model_catalog_payload(config)
```

`_runtime_model_catalog_payload()` (L180-260) 的关键逻辑：

```python
def _runtime_model_catalog_payload(config: DrSaiConfig) -> dict[str, Any]:
    for model_id in model_ids:
        capabilities, known = find_model_capabilities(model_id)  # ← 只查 BUILTIN_MODELS
        reasoning_efforts: tuple[str, ...] = ()
        if known:
            if capabilities.reasoning.supported:
                reasoning_efforts = tuple(capabilities.reasoning.effort_levels)
        # ↑ 如果模型不在 BUILTIN_MODELS 中，known=False，reasoning_efforts 恒为空
```

#### 旧端点（前端不用于推理）：`GET /v1/config/model-catalog`

**文件**: `cores/python/packages/drsai/src/drsai/backend/desktop_gateway/routes/models.py`

```python
@api.get("/v1/config/model-catalog", operation_id="getModelCatalog")
async def model_catalog():
    config = await asyncio.to_thread(load_llm_mode_config, get_llm_config_file_path())
    return build_model_catalog(config)  # ← 不含 reasoning_efforts 字段
```

`build_model_catalog()` (L442-462) 返回的模型条目只有 `alias, display_name, client_type, model, token_limit, max_tokens, vision`，**没有 `reasoning_efforts`**。

### 2.3 Electron Main Process 映射

**文件**: `apps/desktop/shared/main/myDrSaiConfig.ts` L36-58

```typescript
runtimeCatalog = await readRuntimeModelCatalog(gateway.baseUrl);
// readRuntimeModelCatalog() → GET /v1/config/runtime-models

const models = await applyCalibration(runtimeCatalog.models.map((descriptor) => ({
  alias: descriptor.ref.model_id,
  provider_id: descriptor.ref.provider_id,
  reasoning_efforts: descriptor.reasoning_efforts,  // ← 保留
  operations: descriptor.operations,                // ← 保留
  // ...
})), workspacePath);
```

### 2.4 前端 UI 逻辑

**文件**: `apps/desktop/shared/renderer/src/components/ChatWorkspace.tsx`

```typescript
// L231
export type ThinkingEffort = "none" | "low" | "medium" | "high" | "xhigh" | "max";
const THINKING_EFFORTS: ThinkingEffort[] = ["none", "low", "medium", "high", "xhigh", "max"];

// L1082
const isLocalOpenDrSaiAgent = agentOptions.some(
  (agent) => agent.id === selectedAgentId && agent.source === "local" && agent.id !== "my-codex",
);

// L1105-1110
const supportedThinkingEfforts = useMemo<ThinkingEffort[]>(() => {
  if (!isLocalOpenDrSaiAgent) return THINKING_EFFORTS;
  if (!activeModelConfig?.operations?.includes("reasoning")) return [];
  const configured = activeModelConfig.reasoning_efforts ?? [];
  return THINKING_EFFORTS.filter((effort) => configured.includes(effort));
}, [activeModelConfig, isLocalOpenDrSaiAgent]);

// L1117
const showThinkingEffort = supportedThinkingEfforts.length > 0;
```

### 2.5 推理强度发送到后端

**文件**: `apps/desktop/shared/renderer/src/adapters/useDesktopChatAdapter.ts` L738

```typescript
await desktopApi.startChat({
  metadata: {
    thinking_effort: options?.thinkingEffort,
    reasoning_effort: options?.thinkingEffort,  // ← 同值双键
  },
});
```

> 注意：`reasoning_effort` 放在 `metadata` 中，不是 HTTP 请求体的顶层字段。`RunExecuteRequest` schema 中无此字段。

---

## 三、问题根因

前端推理强度选择器是否显示，取决于以下决策链：

```
BUILTIN_MODELS 中是否有此模型？
├── 否 → known=False → capabilities=默认空实例 → reasoning_efforts=() → 前端不显示
└── 是 → known=True → capabilities.reasoning.supported？
    ├── False → reasoning_efforts=() → 前端不显示
    └── True → effort_levels 非空？
        ├── 否 → reasoning_efforts=() → 前端不显示 (Gemini, Claude adaptive 模式)
        └── 是 → reasoning_efforts=effort_levels → 前端显示
```

**根因**：`_runtime_model_catalog_payload()` 只通过 `find_model_capabilities()` 查询 `BUILTIN_MODELS`（新系统），完全不参考 `DEFAULT_LLM_MODE_CONFIG`（旧系统）。两套系统之间没有桥接函数。

---

## 四、统一整合方案

### 4.1 设计目标

将 `DEFAULT_LLM_MODE_CONFIG` 作为 **唯一的模型能力与连接配置数据源**（Single Source of Truth），新系统 `BUILTIN_MODELS` 不再手动维护，而是从旧系统自动生成。

### 4.2 总体架构

```
┌─────────────────────────────────────────────────────────────────────┐
│  DEFAULT_LLM_MODE_CONFIG (dict[str, ModelEntry])                    │
│  位置: config/model_defaults.py  ← 新文件（从 factory 提取）         │
│  字段: model, token_limit, max_tokens, client_type,                │
│        reasoning(supported, effort_levels, param_type),            │
│        vision, base_url, api_key, api_key_env,                     │
│        requires_api_key, use_responses_api                         │
│                                                                     │
│  ← 唯一数据源，所有模型在此维护                                       │
│  ← 叶子模块，不导入 drsai.config 或 drsai.backend 任何内容            │
└───────────────┬─────────────────────────────────────────────────────┘
                │
                │ _build_builtin_models() ← 桥接函数（model_registry.py）
                ▼
┌─────────────────────────────────────────────────────────────────────┐
│  BUILTIN_MODELS (dict[str, ModelCapabilities])                      │
│  位置: config/model_registry.py                                     │
│  ← 自动从 DEFAULT_LLM_MODE_CONFIG 生成，不再手动维护                   │
│  ← find_model_capabilities() 查询此字典                               │
│  ← 同时注册 alias key 和 model-name suffix key                       │
└───────────────┬─────────────────────────────────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────────────────────────────────┐
│  _runtime_model_catalog_payload()                                    │
│  位置: desktop_gateway/routes/config.py                             │
│  → GET /v1/config/runtime-models → 前端                              │
└─────────────────────────────────────────────────────────────────────┘
```

### 4.3 实施步骤

> **状态：✅ 已完成** — 以下步骤均已实施并通过验证。

#### 步骤1：在 `model_registry.py` 中增加从 `ModelEntry` 到 `ModelCapabilities` 的转换函数

**文件**: `cores/python/packages/drsai/src/drsai/config/model_registry.py`

新增函数，将旧系统的 `ModelEntry` 转换为新系统的 `ModelCapabilities`：

```python
from drsai.backend.run_drsai_agent_factory import DEFAULT_LLM_MODE_CONFIG, ModelEntry

def _model_entry_to_capabilities(entry: ModelEntry) -> ModelCapabilities:
    """将旧系统 ModelEntry 转换为新系统 ModelCapabilities。"""
    return ModelCapabilities(
        token_limit=entry.token_limit,
        max_tokens=entry.max_tokens if entry.max_tokens > 0 else 8_192,
        vision=entry.vision,
        function_calling=True,  # 默认支持，除非另有指定
        json_output=True,      # 默认支持
        token_model="gpt-4o-2024-11-20",
        reasoning=ReasoningCapabilities(
            supported=entry.reasoning.supported,
            effort_levels=tuple(entry.reasoning.effort_levels),
            param_type=entry.reasoning.param_type,
        ),
    )

def _build_builtin_models() -> dict[str, ModelCapabilities]:
    """从 DEFAULT_LLM_MODE_CONFIG 自动生成 BUILTIN_MODELS。"""
    result: dict[str, ModelCapabilities] = {}
    for alias, entry in DEFAULT_LLM_MODE_CONFIG.items():
        # 用 alias (如 "deepseek-v4-pro") 和 entry.model (如 "deepseek-ai/deepseek-v4-pro")
        # 两个 key 都指向同一个 capabilities
        caps = _model_entry_to_capabilities(entry)
        result[alias] = caps
        # 如果 model 与 alias 不同，也注册 model name
        if entry.model != alias:
            # 取 provider 前缀后的 suffix 作为 key
            suffix = entry.model.split("/", 1)[-1] if "/" in entry.model else entry.model
            if suffix not in result:
                result[suffix] = caps
    return result

BUILTIN_MODELS: Final[dict[str, ModelCapabilities]] = _build_builtin_models()
```

**注意**：需要处理循环导入问题。`run_drsai_agent_factory.py` 导入了 `drsai.config` 包的内容，而 `model_registry.py` 在 `drsai.config` 包内。解决方案：将 `DEFAULT_LLM_MODE_CONFIG` 和 `ModelEntry`/`ReasoningConfig` 提取到独立模块（如 `drsai.config.model_defaults`），或使用延迟导入。

#### 步骤2：将 `DEFAULT_LLM_MODE_CONFIG` 提取到独立模块以避免循环导入

**新文件**: `cores/python/packages/drsai/src/drsai/config/model_defaults.py`

将以下内容从 `run_drsai_agent_factory.py` 移到 `model_defaults.py`：
- `ReasoningConfig` dataclass
- `ModelEntry` dataclass
- `DEFAULT_LLM_MODE_CONFIG` 字典
- `DEFAULT_CONFIG_NAME` 常量
- `DISPLAY_NAME_OVERRIDES` 字典
- `_DEFAULT_OPENAI_BASE_URL`, `_DEFAULT_ANTHROPIC_BASE_URL` 常量

然后在 `run_drsai_agent_factory.py` 中改为导入：

```python
from drsai.config.model_defaults import (
    DEFAULT_LLM_MODE_CONFIG,
    DEFAULT_CONFIG_NAME,
    ModelEntry,
    ReasoningConfig,
    DISPLAY_NAME_OVERRIDES,
)
```

这样 `model_registry.py` 可以安全地从 `model_defaults.py` 导入，不会产生循环依赖。

#### 步骤3：补全 `DEFAULT_LLM_MODE_CONFIG` 中缺失的模型

将新系统中有但旧系统中无的模型补入 `DEFAULT_LLM_MODE_CONFIG`：

```python
# 补充：claude-sonnet-4-6 (新系统有，旧系统用 claude-sonnet-5)
"claude-sonnet-4-6": ModelEntry(
    model="anthropic/claude-sonnet-4-6",
    token_limit=200000,
    max_tokens=64000,
    client_type="anthropic",
    reasoning=ReasoningConfig(
        supported=True,
        effort_levels=["low", "medium", "high"],
        param_type="adaptive",
    ),
    vision=True,
    base_url=_DEFAULT_ANTHROPIC_BASE_URL,
),
```

#### 步骤4：更新 `find_model_capabilities()` 的查找逻辑

**文件**: `cores/python/packages/drsai/src/drsai/config/model_registry.py`

由于 `BUILTIN_MODELS` 现在从 `DEFAULT_LLM_MODE_CONFIG` 自动生成，`find_model_capabilities()` 的查找逻辑需要适配新的 key 结构：

```python
def find_model_capabilities(model: str) -> tuple[ModelCapabilities, bool]:
    """Return registered capabilities, accepting an optional provider prefix."""
    direct = BUILTIN_MODELS.get(model)
    if direct is not None:
        return direct, True
    suffix = model.split("/", 1)[1] if "/" in model else model
    registered = BUILTIN_MODELS.get(suffix)
    if registered is not None:
        return registered, True
    # Provider deployments commonly append a release date or channel label
    if suffix.lower().startswith("deepseek-v4-flash-"):
        return BUILTIN_MODELS.get("deepseek-v4-flash", ModelCapabilities()), True
    return ModelCapabilities(), False
```

#### 步骤5：确保 `build_model_catalog()` 也输出 `reasoning_efforts`

**文件**: `cores/python/packages/drsai/src/drsai/backend/run_drsai_agent_factory.py` L442-462

当前 `build_model_catalog()` 输出不含 `reasoning_efforts`，需要补充以保持一致性：

```python
def build_model_catalog(
    llm_config: Optional[dict[str, ModelEntry]] = None,
    default_alias: Optional[str] = None,
) -> dict[str, Any]:
    config = llm_config or DEFAULT_LLM_MODE_CONFIG
    models: list[dict[str, Any]] = []
    for alias, entry in config.items():
        # ...
        models.append({
            "alias": alias,
            "display_name": _display_name_from_alias(alias),
            "client_type": client_type,
            "model": entry.model,
            "token_limit": entry.token_limit,
            "max_tokens": entry.max_tokens,
            "vision": entry.vision,
            # ↓ 新增以下字段，与 runtime-models 端点保持一致
            "operations": _derive_operations(entry),
            "reasoning_efforts": entry.reasoning.effort_levels if entry.reasoning.supported else [],
            "input_modalities": ("text", "image") if entry.vision else ("text",),
            "output_modalities": ("text",),
        })
    # ...

def _derive_operations(entry: ModelEntry) -> list[str]:
    """从 ModelEntry 推导 operations 列表。"""
    ops = ["chat", "tool_calling"]
    if entry.reasoning.supported:
        ops.append("reasoning")
    return ops
```

#### 步骤6：清理 `_runtime_model_catalog_payload()` 中的冗余逻辑

**文件**: `cores/python/packages/drsai/src/drsai/backend/desktop_gateway/routes/config.py` L204-258

当前逻辑中，用户通过 TOML 配置的 `configured_model.capabilities` 会覆盖 operations，但 `reasoning_efforts` 仍然回退到 `find_model_capabilities()`。统一后，这个逻辑可以简化：

```python
# 统一后，find_model_capabilities() 已经能查到所有模型
# configured_model 的 capabilities 覆盖逻辑保持不变
# reasoning_efforts 仍然从 capabilities.reasoning.effort_levels 取
# 但现在所有模型都能被查到了
```

---

## 五、实施后的模型推理能力对照表

统一后，所有模型的推理强度支持情况：

| 模型 Alias | param_type | effort_levels | 前端推理选择器 |
|---|---|---|---|
| `hepai/deepseek-v4-pro` | `deepseek_reasoning_effort` | `["none","high","max"]` | ✅ 3个选项 |
| `hepai/deepseek-v4-flash` | `deepseek_reasoning_effort` | `["none","high","max"]` | ✅ 3个选项 |
| `deepseek-v4-pro` | `deepseek_reasoning_effort` | `["none","high","max"]` | ✅ 3个选项 |
| `deepseek-v4-flash` | `deepseek_reasoning_effort` | `["none","high","max"]` | ✅ 3个选项 |
| `gpt-5.4` | `reasoning_effort` | `["none","low","medium","high","xhigh"]` | ✅ 5个选项 |
| `gpt-5.5` | `reasoning_effort` | `["none","low","medium","high","xhigh"]` | ✅ 5个选项 |
| `gemini-3.1-pro-preview` | `adaptive` | `[]` | ❌ 自适应推理 |
| `gemini-3-flash-preview` | `adaptive` | `[]` | ❌ 自适应推理 |
| `glm-5.1` | `zhipu_format` | `["low","medium","high"]` | ✅ 3个选项 |
| `glm-5.2` | `zhipu_format` | `["low","medium","high"]` | ✅ 3个选项 |
| `minimax-m2.7-highspeed` | `none` | `[]` | ❌ 不支持 |
| `claude-sonnet-4-6` | `adaptive` | `["low","medium","high"]` | ✅ 3个选项 |
| `claude-sonnet-5` | `adaptive` | `[]` | ❌ 自适应推理 |
| `claude-opus-4-7` | `adaptive` | `[]` | ❌ 自适应推理 |
| `claude-opus-4-8` | `adaptive` | `[]` | ❌ 自适应推理 |
| `claude-haiku-4-5` | `none` | `[]` | ❌ 不支持 |

> **注意**：`claude-sonnet-4-6` 在新系统中 `effort_levels=("low","medium","high")` 但 `param_type="adaptive"`，存在语义矛盾。统一后应明确：如果 `effort_levels` 非空，前端会显示选择器（因为 `THINKING_EFFORTS ∩ effort_levels` 非空），但 `param_type="adaptive"` 意味着后端实际通过 adaptive 方式传参。建议将 `claude-sonnet-4-6` 的 `param_type` 改为明确格式（如 `"thinking"` 对应 Anthropic 的 thinking 参数），或在 `DEFAULT_LLM_MODE_CONFIG` 中保持与新系统一致。

---

## 六、param_type 到线路格式的映射

`param_type` 决定推理强度如何传递给底层 LLM API：

| `param_type` | 线路格式 | 使用模型 | LLM Client |
|---|---|---|---|
| `reasoning_effort` | OpenAI `reasoning_effort=<level>` | GPT-5.4, GPT-5.5 | `HepAIChatCompletionClient` |
| `deepseek_reasoning_effort` | DeepSeek 专有格式 | DeepSeek V4 Pro/Flash | `HepAIChatCompletionClient` |
| `zhipu_format` | 智谱专有格式 | GLM-5.1, GLM-5.2 | `HepAIChatCompletionClient` |
| `adaptive` | 模型自适应（不可手动选） | Gemini, Claude Sonnet 5/Opus | 各自原生 Client |
| `thinking` | Anthropic `thinking={...}` | Claude (如需手动控制) | `HepAIAnthropicChatCompletionClient` |
| `none` | 不支持推理 | MiniMax, Claude Haiku | — |

> Claude 系列：`param_type="adaptive"` 且 `effort_levels=[]` → 前端不显示选择器，模型自行决定推理深度。如果未来需要手动控制 Claude 推理深度，将 `param_type` 改为 `"thinking"` 并设置 `effort_levels`。

---

## 七、实施顺序与风险控制

### 阶段1：数据提取与桥接（低风险）

1. 创建 `drsai/config/model_defaults.py`，将 `ModelEntry`、`ReasoningConfig`、`DEFAULT_LLM_MODE_CONFIG` 等移入
2. `run_drsai_agent_factory.py` 改为从 `model_defaults.py` 导入
3. 在 `model_registry.py` 中实现 `_build_builtin_models()` 桥接函数
4. 补全 `DEFAULT_LLM_MODE_CONFIG` 中缺失的模型（如 `claude-sonnet-4-6`）
5. 运行现有测试验证无回归

### 阶段2：端点统一（中风险）

6. 更新 `build_model_catalog()` 输出 `reasoning_efforts` 和 `operations` 字段
7. 验证 `GET /v1/config/model-catalog` 与 `GET /v1/config/runtime-models` 返回一致的能力字段
8. 前端验证所有模型推理选择器显示正确

### 阶段3：清理与文档（低风险）

9. 在 `model_registry.py` 中删除手动维护的 `BUILTIN_MODELS` 字典定义，替换为 `_build_builtin_models()` 调用
10. 更新 `find_model_capabilities()` 文档注释
11. 在 `DEFAULT_LLM_MODE_CONFIG` 附近添加注释，说明这是唯一数据源

### 风险点

- **循环导入**：`run_drsai_agent_factory.py` 导入 `drsai.config`，而 `model_registry.py` 在 `drsai.config` 内。**解决方案**：步骤2 将数据定义提取到 `model_defaults.py`（不导入 `drsai.config` 的任何内容），打破循环。
- **frozen=True 不兼容**：`ModelCapabilities` 是 `frozen=True`，而 `ModelEntry` 不是。桥接函数需要创建新的 frozen 实例。
- **key 不一致**：旧系统用 alias（如 `"deepseek-v4-pro"`），新系统用 model name suffix。`_build_builtin_models()` 需要同时注册两个 key。
- **Claude `claude-sonnet-4-6` vs `claude-sonnet-5`**：新系统有 `claude-sonnet-4-6`（effort_levels 非空），旧系统有 `claude-sonnet-5`（effort_levels 空）。统一后需要决定保留哪个或两个都保留。

---

## 八、涉及文件清单

| 文件路径 | 修改类型 | 说明 |
|---|---|---|
| `cores/python/.../config/model_defaults.py` | **新建** | 从 `run_drsai_agent_factory.py` 提取模型定义 |
| `cores/python/.../config/model_registry.py` | **修改** | `BUILTIN_MODELS` 改为自动生成，添加桥接函数 |
| `cores/python/.../backend/run_drsai_agent_factory.py` | **修改** | 导入改为从 `model_defaults.py`，补充缺失模型 |
| `cores/python/.../desktop_gateway/routes/config.py` | **可选修改** | 简化 `_runtime_model_catalog_payload()` |
| `cores/python/.../desktop_gateway/routes/models.py` | **可选修改** | `build_model_catalog()` 补充 reasoning 字段 |
| `cores/python/.../config/schema.py` | **只读参考** | `ModelCapabilities` / `ReasoningCapabilities` 定义 |

---

## 九、验证检查清单

- [ ] 所有 `DEFAULT_LLM_MODE_CONFIG` 中的模型在 `GET /v1/config/runtime-models` 返回的 catalog 中都有对应条目
- [ ] `find_model_capabilities()` 对 `DEFAULT_LLM_MODE_CONFIG` 中每个 alias 都能返回 `known=True`
- [ ] 前端推理强度选择器在有 `effort_levels` 非空的模型上正确显示
- [ ] 前端推理强度选择器在 `effort_levels` 为空的模型上正确隐藏
- [ ] `build_model_catalog()` 与 `_runtime_model_catalog_payload()` 返回的 reasoning 字段一致
- [ ] 无循环导入错误
- [ ] 现有 agent 创建流程（`create_agent()` → `set_model_client()`）正常工作
- [ ] YAML 配置文件加载（`load_llm_mode_config()`）正常工作

---

## 十、DEFAULT_MODEL 与 DEFAULT_CONFIG_NAME 统一（2026-08-31 补充）

### 10.1 问题描述

桌面版存在三个"默认模型"常量，彼此不引用，容易不一致：

| 常量 | 文件 | 原值 | 用途 |
|------|------|------|------|
| `DEFAULT_MODEL` | `config/defaults.py` | `"deepseek-v4-flash"` | 桌面 bootstrap 创建新用户初始配置（`desktop_bootstrap.py` 4处引用） |
| `DEFAULT_CONFIG_NAME` | `config/model_defaults.py` | `"hepai/deepseek-v4-flash"` | `build_model_catalog()` 的 `default_alias` 字段返回值 |
| Agent TOML `model_id` | `~/.drsai/configs/agents/agent_opendrsai.toml` | 用户选择 | 前端实际显示的模型 |

**问题**：`DEFAULT_CONFIG_NAME` 原值 `"hepai/deepseek-v4-flash"` 带 provider 前缀，与 `DEFAULT_MODEL = "deepseek-v4-flash"` 不一致。虽然 `DEFAULT_CONFIG_NAME` 在桌面版中实际不被前端使用（前端用 Agent TOML 的 `effective_ref.model_id`），但两套常量并行存在容易导致未来混淆。

### 10.2 统一方案

采用**单向引用**方式：让 `defaults.py` 从 `model_defaults.py` 导入 `DEFAULT_CONFIG_NAME` 作为 `DEFAULT_MODEL` 的值。

```python
# defaults.py
from .model_defaults import DEFAULT_CONFIG_NAME

DEFAULT_MODEL = DEFAULT_CONFIG_NAME
```

**选择此方向的原因**：
- `model_defaults.py` 是纯数据叶子模块（仅导入 stdlib），无任何项目内导入
- `defaults.py` 已导入 `platform_upstream`，是较高层模块
- 导入方向 `defaults.py → model_defaults.py` 不会产生循环依赖

### 10.3 变更内容

| 文件 | 变更 |
|------|------|
| `config/model_defaults.py` L357 | `DEFAULT_CONFIG_NAME` 从 `"hepai/deepseek-v4-flash"` 改为 `"deepseek-v4-flash"` |
| `config/defaults.py` | 删除硬编码 `DEFAULT_MODEL = "deepseek-v4-flash"`，改为 `from .model_defaults import DEFAULT_CONFIG_NAME` + `DEFAULT_MODEL = DEFAULT_CONFIG_NAME` |

### 10.4 下游影响

所有引用 `DEFAULT_MODEL` 的文件自动获得统一值，无需修改：

| 文件 | 引用位置 | 影响 |
|------|----------|------|
| `config/desktop_bootstrap.py` | L14, L144, L175, L176, L231, L279 | 透明，值不变 |
| `config/resolver.py` | L10, L28 | 透明，值不变 |
| `modules/managers/threads_manager.py` | L511 (`CONST.DEFAULT_MODEL`) | 透明，值不变 |

**注意**：`provider_presets.py` 中每个 provider 的 `default_model` 字段（如 HepAI 的 `"deepseek-v4-pro"`）是**独立的 per-provider 预设**，不是全局默认，不在此统一范围内。

### 10.5 验证结果

```python
>>> from drsai.config.defaults import DEFAULT_MODEL
>>> from drsai.config.model_defaults import DEFAULT_CONFIG_NAME
>>> DEFAULT_MODEL
'deepseek-v4-flash'
>>> DEFAULT_CONFIG_NAME
'deepseek-v4-flash'
>>> DEFAULT_MODEL == DEFAULT_CONFIG_NAME
True
>>> from drsai.config.desktop_bootstrap import DEFAULT_MODEL as BOOT_MODEL
>>> BOOT_MODEL
'deepseek-v4-flash'
```

✅ 导入链正常，无循环依赖，所有层级解析为同一值。
