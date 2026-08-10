# ASR、LLM 与 TTS 真实请求测试脚本

## 目的

`apps/desktop/windows/scripts/test-real-serial-voice.mjs` 用于请求 Windows 桌面程序当前运行的 Gateway，分别验证：

- ASR：音频文件上传与真实转写。
- LLM：流式模型调用、正文输出和 `[DONE]` 完成帧。
- TTS：语音合成、媒体类型、文件大小和音频签名。
- All：按照 `ASR -> LLM -> TTS` 完成一次串行语音闭环。

脚本不直接读取或输出 OpenAI Key。Key 由正在运行的 Gateway 持有，脚本只读取 `~/.drsai/runtime/instance-token` 调用本机接口。

## 前置条件

1. 使用包含真实 Provider 配置的环境启动 Windows 桌面程序。
2. Gateway 健康地址可访问：开发环境默认为 `http://127.0.0.1:28642/health`，正式环境默认为 `http://127.0.0.1:18642/health`。
3. ASR 或完整链路测试需要一个不超过 10 MB 的授权音频文件。

## 运行命令

在 `apps/desktop/windows` 目录执行。

测试脚本默认连接开发环境的 `28642` 端口，并读取 `~/.drsai-dev/runtime/instance-token`。验证正式环境时传入 `--environment production`；`--gateway` 或 `OPENDRSAI_GATEWAY_BASE_URL` 始终具有最高优先级。

完整串行链路：

```powershell
$env:OPENDRSAI_VOICE_LIVE_FIXTURE = "C:\path\voice.wav"
npm run test:voice:providers-real
```

仅测试 ASR：

```powershell
$env:OPENDRSAI_VOICE_LIVE_FIXTURE = "C:\path\voice.wav"
npm run test:voice:asr-real
```

仅测试 LLM：

```powershell
$env:OPENDRSAI_LLM_TEST_MODEL = "gpt-5.4"
$env:OPENDRSAI_LLM_TEST_PROMPT = "只回复 OK"
npm run test:voice:llm-real
```

仅测试 TTS：

```powershell
$env:OPENDRSAI_TTS_TEST_TEXT = "语音合成测试完成"
$env:OPENDRSAI_TTS_TEST_VOICE = "alloy"
npm run test:voice:tts-real
```

需要查看转写和模型回复正文时增加 `--verbose`。默认只输出字符数、音频字节数和各阶段耗时，避免在测试日志中保存敏感内容。

## 通过标准

- 顶层 `ok` 为 `true`。
- ASR 的 `textChars` 大于 0。
- LLM 的 `textChars` 大于 0，且 `completed` 为 `true`。
- TTS 的 `audioBytes` 大于 0，`contentType` 以 `audio/` 开头。
- 任一 HTTP 错误、Provider 错误、超时、空响应或错误音频签名都会使脚本以非零状态退出。
