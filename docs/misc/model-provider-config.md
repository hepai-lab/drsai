# 配置自定义模型服务

OpenDrSai 使用 `~/.drsai/config.toml` 保存默认模型和模型服务连接。HepAI 用户只需要选择模型：

```toml
model = "deepseek-v4-pro"
```

配置 OpenAI-compatible 服务：

```toml
model = "deepseek-chat"
model_provider = "custom"

[model_providers.custom]
base_url = "https://api.deepseek.com/v1"
api_key_env = "DEEPSEEK_API_KEY"
```

配置 Anthropic-compatible 服务时增加协议字段：

```toml
model = "claude-sonnet-4-6"
model_provider = "anthropic-custom"

[model_providers.anthropic-custom]
base_url = "https://api.anthropic.com"
api_key_env = "ANTHROPIC_API_KEY"
wire_api = "anthropic"
```

本地无密钥服务：

```toml
model = "qwen3:32b"
model_provider = "ollama"

[model_providers.ollama]
base_url = "http://127.0.0.1:11434/v1"
requires_api_key = false
```

推荐使用 `api_key_env`。手工在 TOML 中显式使用 `api_key` 会把密钥以明文保存在用户配置及其备份中；通过 Gateway、桌面、TUI 或 CLI 的 `--api-key` 提交时，后端会改为写入 `api_key_credential` 引用，并把真实 Key 保存到 Windows DPAPI、macOS Keychain 或权限受限的本地加密存储中。`api_key`、`api_key_env` 和 `api_key_credential` 只能选择一种。

常用命令：

```text
drsai config path
drsai config check
drsai config migrate
drsai config status --json
drsai config doctor
drsai config doctor --online
drsai config restore
drsai config credential-cleanup
drsai provider setup
drsai config set-model deepseek-chat
drsai config set-provider custom
drsai provider add custom --base-url https://api.deepseek.com/v1 --api-key-env DEEPSEEK_API_KEY
drsai provider test custom --model deepseek-chat --mode basic
drsai provider test custom --model deepseek-chat --mode model
drsai provider models custom --refresh
drsai provider remove custom
```

CLI、TUI 和桌面设置页使用同一个 TOML 文件。桌面和 TUI 只返回 `has_api_key` 与密钥来源，不会读取或显示真实 Key。TUI Provider 编辑器中可按 `Ctrl+T` 测试连接。

## 预设和最小配置

内置预设包括 HepAI、OpenAI、Anthropic、DeepSeek、Ollama，以及自定义 OpenAI-compatible 和 Anthropic-compatible 服务。预设中的固定 URL、协议、测试方式和展示说明由程序维护，不会重复写入用户 TOML。桌面端、TUI 和 `drsai provider setup` 都可以使用这些预设；高级用户仍可直接编辑 TOML。

`basic` 测试优先检查模型目录，通常不会产生模型调用费用。`model` 测试会验证指定模型；当 OpenAI-compatible 服务没有模型目录时，会回退到最小聊天请求，因此可能产生少量费用。测试草稿不会保存 TOML、创建凭据引用或切换当前会话。

## 生效、冲突与恢复

每次读取都会返回基于文件内容的 revision。桌面、TUI 和 CLI 默认携带读取时的 revision；如果另一个窗口或进程先修改了配置，保存会失败并要求重新加载。CLI 只有显式指定 `--force` 才绕过该检查。

配置成功提交后，当前生成不会中断。新 Client 会在下一轮请求前创建，成功后原子替换；创建失败时继续使用旧 Client。`drsai config status` 和桌面状态卡会显示配置 revision、运行中 revision、最近测试结果以及 `pending_next_turn`、`partially_applied` 或 `applied` 状态。

每次成功提交都会更新 `config.toml.last-good`。出现错误时运行：

```text
drsai config doctor
drsai config restore
```

“恢复 HepAI 默认”“删除自定义 Provider”和“清理孤儿凭据”是三个独立操作。凭据清理默认只预览，必须明确执行 `drsai config credential-cleanup --apply` 才会删除未被当前配置或最后可用配置引用的本地凭据。

## 故障排查

- `authentication_failed`：重新输入 Key，并检查模型权限。
- `credential_unavailable`：安全存储缺失或损坏，重新保存 Key 或改用环境变量。
- `config_conflict`：重新加载配置，检查差异后再次保存。
- `dns_failed` / `tls_failed`：检查域名、证书、系统时间和网络代理。
- `protocol_mismatch`：检查 OpenAI/Anthropic 协议和 Base URL。
- `model_not_found`：刷新模型列表，或确认服务端真实模型 ID。
- `rate_limited`：稍后重试并检查账户配额。

Doctor 默认离线运行；`--online` 会执行指定模型测试，可能产生少量费用。所有诊断、IPC 和 API 响应只包含凭据存在状态和来源，不包含 Key、上游响应正文或敏感 Header。

## 迁移、兼容与运维回退

旧 `config.yaml`、`cli_config.json` 和模型目录可通过 `drsai config migrate` 非破坏迁移；旧文件会保留，已有紧凑 TOML 始终优先。明文 `api_key` 继续兼容手工 TOML，但界面默认使用平台安全存储。

紧急情况下可设置 `DRSAI_MODEL_CONFIG_WRITES=disabled` 禁止所有界面和 API 写入，当前有效配置与运行中 Client 保持不变。解除变量后恢复事务写入；熔断期间仍可读取状态、运行 Doctor、备份文件或回退到已发布的旧版本。

完整架构、迁移和测试方案见 [自定义模型 Provider 配置开发方案](custom-model-provider-config-development-plan.md)。
