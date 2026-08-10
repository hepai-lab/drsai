# OpenDrSai Agent 与模型配置持久化

> 更新于 2026-08-08。本文描述当前实现，是 Desktop、Gateway 和 Agent Runtime 的配置基线。

## 1. 设计原则

- Provider 配置、模型目录和 Agent 配置各自独立。
- `config.toml` 只保存当前 Agent 指针及 Provider 连接，不保存 Agent 的模型选择。
- 每个 Agent 使用独立 TOML 文件，支持同时配置多个 Agent。
- Runtime 只使用目标 Agent 明确绑定的模型；配置缺失、无效或被停用时明确报错，不静默切换模型。
- 模型身份始终是 `{provider_id, model_id}`，不能只用 `model_id` 判断。
- API Key 不以明文返回 Renderer，也不应以明文写入普通 TOML。

## 2. 文件布局

所有相对路径均以 `DRSAI_HOME` 为根目录：

```text
DRSAI_HOME/
├── config.toml
├── credentials/
│   └── <credential-id>.bin
└── configs/
    ├── agents/
    │   ├── agent_opendrsai.toml
    │   └── agent_<agent_name>.toml
    └── models/
        ├── provider_hepai.toml
        └── provider_<provider_id>.toml
```

Windows 默认目录：

| 环境 | `DRSAI_HOME` |
| --- | --- |
| 正式版 | `%USERPROFILE%\.drsai` |
| 开发版 | `%USERPROFILE%\.drsai-dev` |

两套环境的配置、凭据和桌面数据必须隔离。

## 3. 根配置 `config.toml`

根配置通过两个字段选择当前 Agent：

```toml
config_version = 3
current_agent = "opendrsai"
agent_config_file = "configs/agents/agent_opendrsai.toml"
```

约束：

- `current_agent` 是变量，不是产品级常量。
- `agent_config_file` 必须严格对应 `configs/agents/agent_<current_agent>.toml`。
- Agent 名称只允许小写字母开头，后续使用小写字母、数字、`_` 或 `-`。
- `opendrsai` 只是当前内置 Agent 的名称，其显示名是 `OpenDrSai`；未来可增加其他 Agent。

Provider 连接也保存在 `config.toml`：

```toml
[model_providers.zhizengzeng]
base_url = "https://api.zhizengzeng.com/v1"
requires_api_key = true
api_key_credential = "drsai-credential:<id>"
models_file = "configs/models/provider_zhizengzeng.toml"
```

`models_file` 必须是 `DRSAI_HOME` 内的相对 TOML 路径。Provider 可配置不同协议所需的主机，但模型使用的协议由模型目录声明。

## 4. Agent 配置

每个 Agent 独立保存在：

```text
configs/agents/agent_<agent_name>.toml
```

示例：

```toml
schema_version = 1
agent_name = "opendrsai"
display_name = "OpenDrSai"
enabled = true

[models]
reasoning_effort = "high"

[models.primary]
mode = "explicit"
provider_id = "zhizengzeng"
model_id = "gpt-5.6"

[models.image_understanding]
mode = "explicit"
provider_id = "zhizengzeng"
model_id = "gpt-5.6"

[models.image_generation]
mode = "explicit"
provider_id = "zhizengzeng"
model_id = "gpt-image-1"

[models.text_to_speech]
mode = "explicit"
provider_id = "zhizengzeng"
model_id = "tts-1"

[models.speech_to_text]
mode = "explicit"
provider_id = "zhizengzeng"
model_id = "whisper-1"
```

可用模型槽位为：

- `primary`
- `image_understanding`
- `image_generation`
- `text_to_speech`
- `speech_to_text`
- `reasoning_effort`

每个模型引用必须能在对应 Provider 的模型目录中解析，并满足该槽位需要的模态和能力。Agent 文件名、`agent_name` 和根配置指针必须一致。

## 5. Provider 模型目录

每个 Provider 使用独立目录文件：

```toml
[models."gpt-5.6"]
alias = "GPT-5.6"
input_modalities = ["text", "image"]
output_modalities = ["text"]
api_protocol = "openai"
enabled = true
capabilities = ["chat", "tool_calling", "reasoning"]
upstream_id = "gpt-5.6"
```

主要字段：

| 字段 | 含义 |
| --- | --- |
| 表名 | Provider 内唯一的规范模型 ID |
| `alias` | 用户可见名称，可选 |
| `input_modalities` / `output_modalities` | `text`、`image`、`audio` 或 `video` |
| `api_protocol` | 当前支持 `openai`、`anthropic`、`gemini` |
| `enabled` | 是否可被 Agent 引用 |
| `capabilities` | 如 `chat`、`tool_calling`、`reasoning`、`image_generation`、`speech_to_text` |
| `upstream_id` | 实际发送给上游的模型 ID；缺省时等于规范 ID |

Provider 页面负责连接和模型目录；Agent 页面负责选择模型。两者不能互相覆盖。

## 6. 读取与运行时解析

```text
config.toml
  → current_agent + agent_config_file
  → 加载目标 Agent TOML
  → 取得各槽位的 {provider_id, model_id}
  → 加载 Provider 连接及 models_file
  → 校验启用状态、协议、模态和能力
  → 解密凭据或注入 OIDC 请求凭据
  → 创建或复用统一 Model Client
  → 发起上游请求
```

聊天请求可携带具体 `agent_name`。未指定时使用 `current_agent`。Gateway、Desktop 和 Runtime 不得各自维护另一份当前 Agent 或模型策略。

## 7. 写入、安全与完整性

- 配置写入使用文件锁、同目录临时文件和原子替换。
- Agent 配置带内容 revision；保存时使用 `expected_revision` 防止双窗口静默覆盖。
- 删除 Provider 前扫描所有 `configs/agents/agent_*.toml`；仍被任一 Agent 引用时拒绝删除。
- API Key 保存到安全凭据存储，`config.toml` 只保存 `api_key_credential` 引用。
- Windows 凭据使用 DPAPI 保护；OIDC Access Token 不进入这些配置文件。
- 公共 API、日志和错误信息不得回显密钥明文，但应保留真实、可诊断的非敏感错误原因。

## 8. 兼容迁移

- 旧 `agent-model-policies.json` 只作为一次性迁移输入。
- 旧策略中的 `my-drsai` 映射为 `opendrsai`，随后写入 `configs/agents/agent_opendrsai.toml`。
- 迁移成功后，旧 JSON 重命名为 `agent-model-policies.json.migrated.bak`，不再参与读取和写入。
- `my-drsai` 仅用于识别历史线程或旧配置，不是当前 Agent 常量。
- 旧顶层 `model`、`model_provider` 等字段只有在能够唯一解析为 `{provider_id, model_id}` 时才迁移；不能解析时明确报错。

新增或修改 Schema 时必须提升版本、提供显式迁移，并覆盖加载、保存、并发冲突和 Runtime 解析测试。
