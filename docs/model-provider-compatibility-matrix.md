# 模型 Provider 兼容矩阵运行手册

## 本地确定性矩阵

每次提交和 Windows CI 使用本地 HTTP fixture，运行产品真实 `probe_provider_draft()` / `test_provider_connection()`：

```text
.venv\Scripts\python.exe scripts\verify_model_provider_compatibility.py --local --require-all
```

矩阵覆盖 OpenAI、Anthropic、DeepSeek、Ollama、仅聊天兼容服务、自定义代理，以及401、429、模型不存在。报告不记录 Base URL、Key、响应正文或Header。

## 发布前真实矩阵

真实矩阵在具备专用 Secret 的受保护 Runner 运行，不依赖 macOS；macOS 签名产物门禁是独立发布步骤。本机执行时应使用临时环境变量和低额度测试账号：

```text
python scripts/verify_model_provider_compatibility.py --real-env --require-all \
  --output build/acceptance/model-provider-real-opt-in.json
```

发送任何网络请求前可先做安全预检。预检只报告字段是否存在，不读取到报告、不显示具体值，也不连接服务：

```text
python scripts/verify_model_provider_compatibility.py --real-env --preflight --require-all \
  --output build/acceptance/model-provider-real-preflight.json
```

预检还会拒绝以下结构错误，并只输出稳定错误码：Base URL 不是绝对 `http(s)` 地址、URL 内嵌用户名/密码、查询参数或片段，以及 `REQUIRES_KEY` 不是 `true/false`、`1/0` 或 `yes/no`。结构错误不会进入网络探测。

六类凭据不必一次性接入。可重复使用 `--service-type` 做分阶段预检或实测，例如只验证 OpenAI 和 Ollama：

```text
python scripts/verify_model_provider_compatibility.py --real-env --preflight --require-all \
  --service-type openai --service-type ollama \
  --output build/acceptance/model-provider-real-preflight-partial.json
```

分阶段报告的 `requiredServiceTypes` 只包含所选类型，发布审计会拒绝把它当成六类完整证据。最终发布仍必须去掉全部 `--service-type` 参数，以六类完整矩阵生成 `model-provider-real-opt-in.json`。

每类服务使用以下变量，其中 `TYPE` 为 `OPENAI`、`ANTHROPIC`、`DEEPSEEK`、`OLLAMA`、`CHAT_ONLY` 或 `CUSTOM_PROXY`：

```text
DRSAI_MATRIX_<TYPE>_BASE_URL
DRSAI_MATRIX_<TYPE>_MODEL
DRSAI_MATRIX_<TYPE>_API_KEY
DRSAI_MATRIX_<TYPE>_REQUIRES_KEY
```

`OLLAMA` 默认无需Key；`CHAT_ONLY` 可通过 `REQUIRES_KEY` 指定。其他类型默认要求Key。Base URL和模型也放在CI Secret中，避免证据暴露内部服务地址。

`--require-all` 要求六类服务全部配置并通过；变量缺失返回退出码2，不生成伪造证据。真实矩阵会执行最小模型请求，必须使用低权限、低额度专用账号，并由平台侧设置费用上限。

## 证据与安全不变量

机器报告只包含：服务类型、内部测试名、测试模式、通过状态、稳定错误码、状态码、耗时和费用风险标记。发布前必须确认：

- 六类服务全部出现在 `configuredServiceTypes`；
- `missingServiceTypes` 为空；
- 所有结果 `passed=true`；
- 报告、日志和CI命令行不含Key、Base URL、响应正文或敏感Header；
- `model` 模式使用专用测试账户，允许产生一次最小调用费用。
