# OpenDrSai 模型持久化配置方案

> 2026-08-06 权威来源修订：产品不存在“全局默认模型”。`config.toml` 只负责提供方连接与模型目录；每个智能体在 `agent-model-policies.json` 中的 `primary_model` 及各能力模型选择，是运行时唯一权威来源。旧顶层 `model` / `model_provider`、CLI `defult_config_name` 和 Desktop `defaultModelAlias` 只作为一次性迁移输入；成功迁移为明确的提供方/模型引用后即删除。智能体策略缺失、歧义、停用或失效时必须明确报错并引导到智能体模型配置，不得回退到提供方或进程级默认值。

本文记录截至 2026-08-06 已落地的模型配置持久化结构、读写边界、校验规则和兼容策略。本文描述的是当前代码事实，可作为 Desktop、Gateway 和 Agent Runtime 后续演进的共同基线。

## 1. 设计目标

模型配置按职责拆成三类数据：

1. `config.toml` 保存当前默认模型、提供商连接信息和模型目录文件引用。
2. 每个提供商独立的 TOML 文件保存该提供商的完整模型目录。
3. `agent-model-policies.json` 保存本机 OpenDrSai 智能体对不同能力模型的选择。

API Key 不直接返回 Renderer，也不应默认明文写入 TOML。OIDC Access Token 只存在于登录会话和请求上下文中，不属于模型配置文件。

## 2. 文件布局

所有相对路径均以 `DRSAI_HOME` 为根目录：

```text
DRSAI_HOME/
├── config.toml
├── config.toml.bak
├── agent-model-policies.json
├── credentials/
│   └── <credential-id>.bin
└── configs/
    └── models/
        ├── provider_hepai.toml
        ├── provider_zhizengzeng.toml
        └── provider_<provider-id>.toml
```

Windows 默认位置：

| 环境 | `DRSAI_HOME` |
| --- | --- |
| 生产安装版 | `%USERPROFILE%\.drsai` |
| `windows-desktop-dev.cmd` 开发版 | `%USERPROFILE%\.drsai-dev` |

开发版与生产版的配置、凭据、智能体策略和 Electron 用户数据必须相互隔离。

## 3. `config.toml`

### 3.1 顶层模型字段已移除

新配置只保留 `config_version` 和提供方配置。旧版 `model`、`model_provider` 仅在迁移时读取；能唯一解析时写入智能体的显式 `primary_model`，随后从 TOML 删除。无法解析时保留旧文件供人工修复，但运行会明确失败，不会选择任何默认模型。

### 3.2 提供商连接配置

```toml
[model_providers.hepai]
base_url = "https://aiapi.ihep.ac.cn/apiv2"
anthropic_base_url = "https://aiapi.ihep.ac.cn/anthropic"
google_base_url = "https://aiapi.ihep.ac.cn/google"
requires_api_key = false
models_file = "configs/models/provider_hepai.toml"

[model_providers.zhizengzeng]
base_url = "https://api.zhizengzeng.com/v1"
requires_api_key = true
api_key_credential = "drsai-credential:00000000-0000-0000-0000-000000000000"
models_file = "configs/models/provider_zhizengzeng.toml"
```

字段语义：

| 字段 | 含义 |
| --- | --- |
| `base_url` | OpenAI 兼容接口的主机；也是未显式配置其他协议主机时的基础连接地址。 |
| `anthropic_base_url` | Anthropic 兼容接口主机，可选。 |
| `google_base_url` | Gemini/Google 兼容接口主机，可选。 |
| `requires_api_key` | 此提供商是否要求持久化 API Key。OIDC 登录的 HepAI 应为 `false`。 |
| `api_key_credential` | 安全凭据存储中的引用，不是 API Key 明文。 |
| `api_key_env` | 从环境变量读取 API Key 的替代方案。 |
| `api_key` | 兼容的明文方案，不推荐。 |
| `models_file` | 相对于 `DRSAI_HOME` 的提供商模型目录文件。 |

`api_key`、`api_key_env`、`api_key_credential` 三者最多只能存在一个。`requires_api_key = false` 时通常不写上述字段。

当前写入器不再持久化提供商级 `wire_api`。旧配置中的 `wire_api` 和 `gemini_base_url`仍可读取并迁移，但新配置应使用各协议主机和模型级 `api_protocol`。

## 4. 提供商模型目录

每个提供商使用独立的 `models_file`。文件必须包含 `[models]` 下的嵌套表，模型之间保留一个空行：

```toml
# Model catalog for this Provider. Managed by OpenDrSai.

[models."deepseek-v4-pro"]
alias = "DeepSeek V4 Pro"
input_modalities = ["text"]
output_modalities = ["text"]
api_protocol = "openai"
enabled = true
capabilities = ["chat", "tool_calling", "reasoning"]

[models."vision-model"]
input_modalities = ["text", "image"]
output_modalities = ["text"]
api_protocol = "openai"
enabled = true
capabilities = ["chat"]

[models."image-model"]
input_modalities = ["text", "image"]
output_modalities = ["image"]
api_protocol = "openai"
enabled = true
capabilities = ["image_generation", "image_edit"]

[models."whisper-1"]
input_modalities = ["audio"]
output_modalities = ["text"]
api_protocol = "openai"
enabled = true
capabilities = ["speech_to_text"]

[models."tts-1"]
input_modalities = ["text"]
output_modalities = ["audio"]
api_protocol = "openai"
enabled = true
capabilities = ["text_to_speech"]
```

### 4.1 模型字段

| 字段 | 必需 | 说明 |
| --- | --- | --- |
| 表名 | 是 | 提供商内唯一的规范模型 ID。 |
| `alias` | 否 | 面向用户的显示名称；缺省时界面使用模型 ID。 |
| `input_modalities` | 是 | 输入模态数组。 |
| `output_modalities` | 是 | 输出模态数组。 |
| `api_protocol` | 是 | 当前使用的协议族。 |
| `enabled` | 是 | 是否进入可选择、可解析的运行时目录。 |
| `capabilities` | 是 | 模型能力声明。未知能力不会通过校验。 |
| `upstream_id` | 否 | 实际发送给上游的模型 ID；缺省时等于规范模型 ID。 |

模态取值：`text`、`image`、`audio`、`video`。

能力取值：

- `chat`
- `tool_calling`
- `reasoning`
- `image_generation`
- `image_edit`
- `speech_to_text`
- `text_to_speech`
- `video_generation`

能力和模态必须一致：

| 能力 | 最低模态要求 |
| --- | --- |
| `tool_calling`、`reasoning` | 同时包含 `chat` |
| `image_generation` | 输出包含 `image` |
| `image_edit` | 输入、输出均包含 `image` |
| `speech_to_text` | 输入包含 `audio`，输出包含 `text` |
| `text_to_speech` | 输入包含 `text`，输出包含 `audio` |
| `video_generation` | 输出包含 `video` |

### 4.2 当前协议值

当前代码接受的 `api_protocol` 只有：

- `openai`
- `anthropic`
- `gemini`

它们目前表示协议族，而不是具体接口方法。`openai-chat-completions`、`openai-responses`、`anthropic-messages` 等细分值尚未进入当前持久化 Schema，直接写入会被判定为无效配置。后续若细分协议，应通过配置版本迁移完成，不能静默改变现有字段语义。

## 5. 智能体模型策略

本机 OpenDrSai 智能体的能力模型选择不写入 `config.toml`，而是独立保存在：

```text
DRSAI_HOME/agent-model-policies.json
```

示例：

```json
{
  "schema_version": 1,
  "policies": {
    "my-drsai": {
      "primary_model": {
        "mode": "explicit",
        "ref": {
          "provider_id": "hepai",
          "model_id": "deepseek-v4-pro"
        }
      },
      "image_understanding_model": {
        "mode": "explicit",
        "ref": {
          "provider_id": "hepai",
          "model_id": "vision-model"
        }
      },
      "image_generation_model": {
        "mode": "explicit",
        "ref": {
          "provider_id": "zhizengzeng",
          "model_id": "image-model"
        }
      },
      "text_to_speech_model": {
        "mode": "explicit",
        "ref": {
          "provider_id": "zhizengzeng",
          "model_id": "tts-1"
        }
      },
      "speech_to_text_model": {
        "mode": "explicit",
        "ref": {
          "provider_id": "zhizengzeng",
          "model_id": "whisper-1"
        }
      },
      "reasoning_effort": "max"
    }
  }
}
```

`primary_model` 只支持 `explicit`，必须包含明确的 `{provider_id, model_id}`。

四个能力模型当前只允许显式选择；未配置时省略对应字段：

- `image_understanding_model`：要求 `image → text`。
- `image_generation_model`：要求输出包含 `image`。
- `text_to_speech_model`：要求 `text → audio`。
- `speech_to_text_model`：要求 `audio → text`。

`reasoning_effort` 保存文本模型的默认推理强度。该值必须来自当前文本模型在 Runtime Model Catalog 中声明的 `reasoning_efforts`。截至 2026-08-06，DeepSeek V4 Pro、V4 Flash，以及 HepAI 的 `deepseek-v4-flash-0731`、`deepseek-v4-flash-正式版` 等 `deepseek-v4-flash-*` 部署 ID，有效档位均为 `high`、`max`；旧兼容值 `low`、`medium` 会归一到 `high`，`xhigh` 会归一到 `max`。智能体设置页保存该字段后，后续会话默认使用该强度，输入栏仍可在单次发送前临时调整。

旧字段 `image_model` 仍可读取，并在内存中映射到 `image_generation_model`；下一次保存只写新字段。

## 6. 凭据持久化

Renderer 提交 API Key 后，Gateway 将密钥写入平台安全存储，并只在 `config.toml` 中保留 `api_key_credential` 引用。

- Windows：凭据文件位于 `DRSAI_HOME/credentials`，内容使用 Windows DPAPI 保护。
- macOS：使用系统 Keychain。
- 其他本地环境：使用受限权限目录和 Fernet 主密钥。
- 公共配置响应只返回 `has_api_key` 和 `api_key_source`，不会返回密钥明文。
- 替换或删除提供商凭据时，旧凭据在配置提交成功后清理。
- HepAI OIDC Access Token 不写入 `config.toml`、模型目录或凭据文件；它由登录会话按请求提供。

## 7. 读取与解析流程

```text
config.toml
  → 读取 model_provider/model
  → 读取 model_providers.<id>
  → 校验并加载 models_file
  → 合并内建提供商默认值
  → 解析安全凭据或 OIDC 请求凭据
  → 生成 Runtime Model Catalog
  → 应用 agent-model-policies.json
  → 得到 Provider-aware ModelRef 和实际 upstream_id
```

模型身份始终使用 `{provider_id, model_id}`。不同提供商可以存在同名模型，不能只用裸 `model_id` 判断身份。

禁用模型不会进入可用模型选择。若当前默认模型被禁用，保存流程会选择同提供商的第一个启用模型；同提供商没有启用模型时尝试其他已配置提供商。系统必须保证至少保留一个可用模型。

## 8. 保存事务与并发控制

保存模型提供商时采用以下流程：

1. 根据当前 `config.toml` 和所有被引用的 `models_file` 计算 revision。
2. 用调用方的 `expected_revision` 做乐观并发检查。
3. 在临时目录构造完整候选配置。
4. 加载候选 TOML，校验所有提供商、模型、模态、能力、协议和默认模型。
5. 先原子替换发生变化的模型目录文件，再原子替换 `config.toml`。
6. 任一步失败时恢复已修改的模型目录，并清理本次新建的凭据。
7. 成功后返回新 revision，并生成最近可用配置快照。

TOML 写入使用同目录临时文件、`fsync` 和 `os.replace`；覆盖既有文件前生成 `.bak`。写入器只管理模型顶层字段和 `model_providers.<id>`，尽量保留其他配置表及注释。

配置 revision 是 `config.toml` 与所有被引用模型目录文件内容的联合 SHA-256。任一模型文件变化都会使旧窗口保存失败，避免双窗口静默覆盖。

`agent-model-policies.json` 使用独立的规范 JSON SHA-256 revision，并通过文件锁、临时文件和 `os.replace` 原子提交。revision 不写入策略文件，只在 GET/PUT API 中传递。

## 9. 删除与引用完整性

删除提供商前必须检查：

- 是否为当前顶层默认提供商。
- 是否被本机 OpenDrSai 的文本模型策略引用。
- 是否被图像理解、图像生成、文字转语音或语音转文字策略引用。

存在任何引用时删除返回冲突，界面应先引导用户迁移这些模型选择。系统不得通过静默回退留下含义不明的智能体配置。

## 10. 兼容与迁移规则

当前读取器保留以下兼容能力：

- 提供商内联 `models` 数组或字典仍可读取。
- 旧 `model_aliases`、`model_upstream_ids`、`model_operations` 可转换为结构化模型配置。
- 保存提供商时模型目录自动外置到 `configs/models/provider_<provider-id>.toml`。
- 旧 `wire_api = "anthropic"` 或 `"gemini"` 可映射到相应协议主机，新写入不保留 `wire_api`。
- 旧 `gemini_base_url` 可读取为 `google_base_url`。
- 旧智能体 `image_model` 映射为 `image_generation_model`。
- 旧 DeepSeek `xhigh` 推理强度可读取，并在新保存中归一为原生 `max`。

`models` 与 `models_file` 不允许同时存在。`models_file` 必须是配置根目录内的相对 `.toml` 路径，绝对路径或 `..` 越界路径会被拒绝。

## 11. 当前限制与后续演进

1. `api_protocol` 尚未细分到 OpenAI Chat Completions、OpenAI Responses、Anthropic Messages 等具体方法。
2. `agent-model-policies.json` 当前为 JSON，未并入 TOML 外联体系；这样可以独立做高频策略写入和 revision 控制。
3. 最近可用快照目前以 `config.toml` 为主体；模型目录具有事务内回滚和 `.bak`，但完整跨文件快照仍可进一步统一。
4. 能力模型已完成配置、持久化和能力校验；具体运行入口应始终通过该策略解析 ModelRef，避免另建语音或图像模型配置源。

任何后续 Schema 变更都应：提升配置版本或策略 schema、提供显式迁移、保持旧配置可读，并增加加载、保存、冲突、回滚和 Runtime 解析测试。

## 12. 验收清单

- `config.toml` 只保存连接信息和 `models_file`，不重新内联模型字典。
- 每个提供商模型文件可独立阅读，模型表之间有空行。
- 模型 ID、别名、输入/输出模态、协议、能力、启用状态和 upstream ID 可往返保存。
- 不匹配能力模态的模型无法保存或绑定到智能体能力槽位。
- DeepSeek V4 Pro、V4 Flash 均展示并可持久化 `high`、`max` 推理强度，`max` 原样进入上游请求。
- 禁用当前模型后会得到确定性回退，不产生失效默认模型。
- API Key 不出现在 Renderer 响应、日志和普通配置界面。
- 开发版和生产版读取不同的 `DRSAI_HOME`。
- 双窗口用旧 revision 保存时返回冲突，不覆盖新配置。
- 删除被任一智能体能力引用的提供商时被阻止。
- 旧内联模型、`wire_api`、`gemini_base_url` 和 `image_model` 均有兼容迁移覆盖。
