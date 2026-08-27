# OpenDrSai 自定义模型 Provider 配置开发方案

## 1. 文档目的

本文定义 OpenDrSai 通过 `~/.drsai/config.toml` 支持自定义模型、API Key 和 Base URL 的统一方案。方案参考 Codex 的全局 TOML 配置形式，但将用户配置保持在最小范围：用户只填写模型选择和连接差异，稳定的 Provider 默认值、模型能力及客户端参数由程序内置注册表维护。

本方案覆盖 Python Runtime、Gateway、CLI/TUI、Windows/macOS 桌面端、配置迁移、安全、测试和发布验收。

## 2. 目标与非目标

### 2.1 目标

- 使用 `~/.drsai/config.toml` 作为统一的用户级主配置。
- 支持自定义模型 ID、Base URL、API Key 和协议类型。
- 支持 HepAI、OpenAI-compatible、Anthropic-compatible 以及无需密钥的本地服务。
- 默认 HepAI 用户无需配置 Provider 细节。
- CLI、TUI、桌面端、Gateway、daemon 和子智能体使用同一份解析结果。
- 已知模型的上下文、视觉、推理等能力由内置注册表提供。
- 未登记的模型仍能以安全的通用默认值运行。
- 兼容现有 YAML、JSON、环境变量和命令行配置。
- API Key 不进入 Renderer、日志、状态响应或诊断包。

### 2.2 非目标

第一阶段不实现以下内容：

- 在主配置中维护完整模型目录或模型别名数组。
- 要求用户填写 `token_limit`、`vision`、`reasoning` 等能力字段。
- 支持任意自定义 HTTP Header、代理和厂商专属参数。
- 完整实现 OpenAI Responses、Gemini Native 或 Azure OpenAI 协议。
- 将项目级配置作为密钥存储位置。

## 3. 精简配置规范

### 3.1 默认 HepAI

```toml
model = "deepseek-v4-pro"
```

未指定 `model_provider` 时，默认使用内置 `hepai` Provider。

### 3.2 自定义 OpenAI-compatible 服务

```toml
model = "deepseek-chat"
model_provider = "custom"

[model_providers.custom]
base_url = "https://api.deepseek.com/v1"
api_key_env = "DEEPSEEK_API_KEY"
```

`wire_api` 默认是 `openai`，`requires_api_key` 默认是 `true`，因此常见场景无需填写。

### 3.3 配置文件内直接保存 Key

```toml
model = "deepseek-chat"
model_provider = "custom"

[model_providers.custom]
base_url = "https://api.deepseek.com/v1"
api_key = "sk-..."
```

应优先推荐 `api_key_env` 或系统凭据存储。明文 `api_key` 作为兼容桌面用户的显式能力保留，并在 UI 和 CLI 中显示安全提示。

### 3.4 Anthropic-compatible 服务

```toml
model = "claude-sonnet-4-6"
model_provider = "anthropic-custom"

[model_providers.anthropic-custom]
base_url = "https://example.com/anthropic"
api_key_env = "ANTHROPIC_API_KEY"
wire_api = "anthropic"
```

### 3.5 无密钥本地服务

```toml
model = "qwen3:32b"
model_provider = "ollama"

[model_providers.ollama]
base_url = "http://127.0.0.1:11434/v1"
requires_api_key = false
```

### 3.6 字段定义

顶层字段：

| 字段 | 必填 | 默认值 | 说明 |
|---|---:|---|---|
| `model` | 否 | 内置默认模型 | 发送给 Provider 的实际模型 ID |
| `model_provider` | 否 | `hepai` | 当前 Provider 名称 |
| `config_version` | 否 | 当前版本 | 用于迁移和兼容判断 |

Provider 字段：

| 字段 | 必填 | 默认值 | 说明 |
|---|---:|---|---|
| `base_url` | 自定义 Provider 必填 | 内置值 | API 根地址 |
| `api_key` | 否 | 无 | 配置文件内的 API Key |
| `api_key_env` | 否 | 无 | API Key 所在环境变量名 |
| `api_key_credential` | 否 | 无 | 系统凭据存储引用，第二阶段实现 |
| `wire_api` | 否 | `openai` | `openai` 或 `anthropic` |
| `requires_api_key` | 否 | `true` | 本地服务可设置为 `false` |

`api_key`、`api_key_env` 和 `api_key_credential` 互斥；同时出现时配置加载失败并指出字段位置。

## 4. 预制配置与代码组织

建议新增统一配置包：

```text
cores/python/packages/drsai/src/drsai/config/
├── __init__.py
├── schema.py
├── loader.py
├── resolver.py
├── defaults.py
├── provider_registry.py
└── model_registry.py
```

### 4.1 Provider 注册表

`provider_registry.py` 保存稳定的内置 Provider，例如 HepAI 的协议、默认地址和默认密钥环境变量。开发/生产平台地址仍可由现有 `[platforms.*]` 配置切换。

### 4.2 模型注册表

`model_registry.py` 保存已知模型的：

- 上下文窗口和最大输出；
- 视觉能力；
- 工具调用和结构化输出能力；
- 推理支持及参数格式；
- token 模型和客户端兼容参数。

这些信息属于版本化的产品默认值，不写入用户目录。

### 4.3 未知模型兜底

注册表中不存在的模型不得被拒绝。第一版使用通用默认值：

```text
token_limit      = 128000
max_tokens       = 8192
vision           = true
function_calling = true
reasoning        = false
wire_api         = Provider 的 wire_api
```

界面应显示“能力未校准”，并允许用户继续使用。未来若需要能力覆盖，可引入独立的 `~/.drsai/models.toml`，但不在第一阶段实现。

## 5. 配置加载与合并

统一优先级：

```text
运行时或命令行覆盖
> 环境变量
> 项目级 .drsai/config.toml（未来能力）
> 用户级 ~/.drsai/config.toml
> 旧版用户配置
> 内置 Provider/模型注册表
> 通用兜底值
```

API Key 是例外：密钥只能从当前 Provider 明确声明的来源解析，不允许从其他 Provider 或 `HEPAI_API_KEY` 隐式回退，避免把一个服务的凭据发送给另一个地址。

建议核心接口：

```python
load_user_config() -> DrSaiConfig
resolve_model_config(config, env, overrides=None) -> ResolvedModelConfig
```

`ResolvedModelConfig` 至少包含模型 ID、Provider、协议、Base URL、Secret 引用、模型能力和各字段来源。解析结果为只读对象，其他模块不得再次独立读取配置文件或环境变量。

Python 3.11 及以上使用标准库 `tomllib`；若继续支持 Python 3.10，则使用 `tomli` 兼容依赖。桌面/Gateway 修改 TOML 时使用能保留注释和格式的库，例如 `tomlkit`。

## 6. Secret 安全模型

- 引入 `SecretValue` 类型，其 `str`、`repr` 和序列化始终返回掩码。
- API Key 只在 Gateway/Runtime 后端解析和使用。
- Renderer 只能获得 `has_api_key` 和 `api_key_source`。
- 日志、异常、遥测、诊断导出和请求调试信息必须过滤 Key、Authorization Header 及 URL 凭据。
- 保存配置时使用临时文件、解析校验和原子替换，并保留一份 `config.toml.bak`。
- 桌面第二阶段使用 Electron `safeStorage`、Windows Credential Manager 或 macOS Keychain，实现 `api_key_credential`。
- 项目级 `.drsai/config.toml` 不允许包含 `api_key`，只能引用用户级 Provider 或环境变量。

## 7. Runtime 改造

当前 `run_drsai_agent_factory.py` 分别解析 OpenAI、Anthropic 和 HepAI 的全局 Base URL/API Key，并通过模型名推断客户端类型。改造后应只消费 `ResolvedModelConfig`：

1. 根据 `wire_api` 创建 OpenAI-compatible 或 Anthropic-compatible Client。
2. 将模型注册表解析出的能力传入 `model_info`。
3. 保留现有 `set_model_client()` 和 `switch_model()` 接口。
4. 删除自定义 Provider 对 HepAI Key 的隐式回退。
5. 收敛重复的模型名规范化、最大输出参数选择和视觉推断逻辑。
6. daemon、子智能体、上下文压缩客户端和会话恢复必须使用同一 Resolver。

配置变更时，正在生成的请求不中断；下一次请求重建 Client。重建失败则继续保留旧 Client，并向 UI 报告新配置未生效。

## 8. Gateway API

新增以下接口：

```text
GET    /v1/config/model
PUT    /v1/config/model
GET    /v1/config/model-providers
PUT    /v1/config/model-providers/{name}
DELETE /v1/config/model-providers/{name}
POST   /v1/config/model-providers/{name}/test
```

读取接口只返回脱敏信息：

```json
{
  "model": "deepseek-chat",
  "model_provider": "custom",
  "provider": {
    "base_url": "https://api.deepseek.com/v1",
    "wire_api": "openai",
    "requires_api_key": true,
    "has_api_key": true,
    "api_key_source": "environment"
  },
  "metadata": {
    "known_model": false,
    "token_limit": 128000,
    "vision": true
  }
}
```

连接测试错误必须结构化为：认证失败、权限不足、模型不存在、路径错误、协议不匹配、超时、连接失败或响应无效。任何错误不得回显请求 Header 或 Key。

## 9. CLI、TUI 与桌面端

### 9.1 CLI

新增命令：

```text
drsai config path
drsai config show
drsai config check
drsai config migrate
drsai config set-model <model>
drsai config set-provider <provider>
drsai provider list|add|edit|test|remove
```

`config show` 必须脱敏。手工修改 TOML 后，通过文件修改时间检测实现新请求热加载。

### 9.2 TUI

- 模型选择器同时显示模型和 Provider。
- 允许直接输入任意模型 ID。
- 未知模型显示“能力未校准”，不阻塞运行。
- Provider 编辑表单只展示必要字段，高级协议选项折叠显示。

### 9.3 桌面端

设置页增加“模型服务”区域，包含当前模型、Provider、Base URL、Key 来源、协议高级选项、测试连接、恢复 HepAI 默认值和打开配置文件。

数据流固定为：

```text
Renderer → preload → Electron Main → Local Gateway → Config Service
```

Renderer 不直接读写文件，也不持久保存 API Key。Key 只允许作为一次性写入参数通过受控 IPC 提交。

## 10. 旧配置迁移

需要兼容的现有来源：

- `~/.drsai/config.toml` 中已有的 `[platforms.*]`；
- `~/.drsai/config.yaml`；
- `~/.drsai/configs/cli_config.json`；
- `~/.drsai/configs/llm_mode_config.yaml`；
- `.env` 和现有环境变量。

迁移规则：

1. 新 TOML 已包含 `model` 或 `[model_providers]` 时，以新格式为准。
2. 否则从旧配置读取默认模型、协议和地址并追加到 TOML。
3. 不把环境变量中的真实 Key 复制到 TOML，只写 `api_key_env`。
4. 保留已有 `[platforms.*]`、注释和未知字段。
5. 写入 `config_version = 2`。
6. 旧文件不删除，迁移可重复执行且结果幂等。
7. 支持 `DRSAI_CONFIG_AUTO_MIGRATE=false` 禁用自动写入。

兼容期建议跨两个小版本：首个版本新旧并读且新格式优先；下一版本输出旧格式弃用警告；再下一版本默认只使用 TOML，同时保留显式迁移命令。

## 11. 实施阶段

### Phase 1：统一配置核心

- 建立 TOML schema、内置 Provider/模型注册表和 Secret 类型。
- 实现加载、验证、合并、来源追踪和未知模型兜底。
- 为配置核心补齐单元测试。

完成标准：精简 TOML 能生成完整且只读的 `ResolvedModelConfig`，现有 HepAI 默认行为不变。

### Phase 2：接入模型 Runtime

- 改造模型工厂和模型切换。
- 接入 OpenAI/Anthropic Client 路由。
- 覆盖 daemon、子智能体、上下文客户端和状态恢复。
- 移除跨 Provider 密钥回退。

完成标准：CLI 可通过自定义 Key、Base URL 和模型完成流式对话及工具调用。

### Phase 3：Gateway、写入与迁移

- 实现配置和 Provider API。
- 实现保格式、原子 TOML 写入。
- 实现连接测试和结构化错误。
- 实现旧配置迁移及回滚。

完成标准：所有前端通过统一配置服务工作，旧用户升级后无需手工重配。

### Phase 4：TUI 与桌面端

- 添加模型/Provider 设置和测试连接 UI。
- 实现配置热更新事件。
- 增加恢复默认值、打开配置文件和安全提示。

完成标准：UI 编辑与手工编辑 TOML 的有效结果一致，Key 不返回 Renderer。

### Phase 5：安全与发布验证

- 审计日志、IPC、状态、诊断包和崩溃报告。
- 完成 Windows/macOS 安装包验证。
- 更新 CLI 手册、桌面说明和示例配置。

完成标准：自动扫描确认凭据不泄漏，HepAI、OpenAI-compatible、Anthropic-compatible 和 Ollama 四条路径通过验收。

## 12. 测试计划

### 12.1 单元测试

- 配置不存在、最小配置、自定义 Provider 和多个 Provider。
- `api_key`、`api_key_env`、凭据引用及互斥校验。
- 非法 TOML、URL、协议、Provider 名称和缺失 Key。
- 未知模型兜底和已知模型能力合并。
- 命令行、环境变量、TOML、旧配置和内置值的优先级。
- 自定义 Provider 不继承 HepAI 或其他 Provider 的 Key。
- Secret 的字符串化、序列化、日志和异常脱敏。

### 12.2 集成测试

- HepAI 默认服务。
- OpenAI-compatible 自定义服务。
- Anthropic-compatible 服务。
- Ollama 等无 Key 服务。
- 错误 Key、错误 URL、模型不存在、超时和协议不匹配。
- 流式输出、工具调用、会话切换、daemon 和子智能体。
- 配置热更新成功及失败回退。

### 12.3 迁移测试

- 只有 YAML、只有 JSON、只有模型目录以及多来源共存。
- 已存在平台 TOML、新旧字段冲突和未知字段。
- 重复迁移、迁移中断、写入失败和备份恢复。

### 12.4 桌面 E2E

- 新用户使用 HepAI 时不经过配置步骤。
- 添加 Provider、设置 Key、测试连接、选择模型并聊天。
- 重启后配置恢复。
- 删除当前 Provider 时安全回退。
- Renderer、日志和诊断包无敏感值。

## 13. 验收标准

### 功能

- `model` 一行即可选择内置 HepAI 模型。
- 自定义 Provider 最少只需 Base URL 和一种 Key 来源。
- 任意模型 ID 均可运行，不强制维护用户模型目录。
- 支持 OpenAI-compatible、Anthropic-compatible 和无 Key 本地服务。
- CLI、TUI、桌面端、daemon 使用同一解析结果。
- 新请求可在不重启应用的情况下使用新配置。

### 兼容

- 现有 `[platforms.*]` 保持有效。
- 旧 YAML/JSON/环境变量能够读取并迁移。
- 现有 CLI 参数、模型切换和会话恢复保持工作。

### 安全

- API Key 不返回 Renderer，不进入日志、状态文件或诊断包。
- 自定义 Provider 不继承其他 Provider 的密钥。
- 配置写入失败不会损坏原文件。
- 项目级配置不能嵌入或覆盖用户级明文密钥。

## 14. 最终推荐用户体验

HepAI 用户：

```toml
model = "deepseek-v4-pro"
```

自定义服务用户：

```toml
model = "deepseek-chat"
model_provider = "custom"

[model_providers.custom]
base_url = "https://api.deepseek.com/v1"
api_key_env = "DEEPSEEK_API_KEY"
```

这个边界让 `config.toml` 只表达用户选择和连接差异，模型能力与产品默认值由代码集中维护，从而兼顾配置简洁、运行时扩展、安全和向后兼容。
