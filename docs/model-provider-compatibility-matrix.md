# 模型 Provider 兼容矩阵运行手册

## 本地确定性矩阵

每次提交和 Windows CI 使用本地 HTTP fixture，运行产品真实 `probe_provider_draft()` / `test_provider_connection()`：

```text
.venv\Scripts\python.exe scripts\verify_model_provider_compatibility.py --local --require-all
```

矩阵覆盖 OpenAI、Anthropic、DeepSeek、Ollama、仅聊天兼容服务、自定义代理，以及401、429、模型不存在。报告不记录 Base URL、Key、响应正文或Header。

## 发布前真实矩阵

真实矩阵只在受保护的signed RC Runner运行：

```text
python3 scripts/verify_model_provider_compatibility.py --real-env --require-all \
  --output apps/desktop/macos/build/acceptance/model-provider-real-opt-in.json
```

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
