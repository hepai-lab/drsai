# Windows App 串行语音路线 P1 实施报告

最后更新：2026-07-19  
适用范围：`apps/desktop/windows`  
实现状态：代码、自动化、打包与真实 Provider 完整回合已完成；物理设备发布矩阵待人工签核

## 1. 当前结论

串行语音交互的 12 个模块均已完成产品代码与自动化验收。打包后的 Windows 应用已经通过以下真实完整回合：

```text
模拟麦克风输入
-> MediaRecorder WebM 录音
-> OpenAI whisper-1 整段转写
-> 审核并插入输入框
-> 点击发送
-> OpenAI gpt-4.1-mini 完整回复
-> OpenAI gpt-4o-mini-tts 整段合成
-> 播放控制器播放完成
```

本轮真实回合依次观察到：

```text
requesting_permission -> recording -> preparing_audio -> transcribing
-> reviewing -> ready_to_send -> submitting -> awaiting_response
-> response_ready -> synthesizing -> playing -> completed
```

自动化与真实 Provider 总体完成度为 **100%**。最终发布门禁仍要求 Windows 10/11 及内置、USB、蓝牙物理输入输出设备的人工测试和签名，因此整体发布验收进度记为 **99.5%**，不得用模拟结果替代该签核。

## 2. 模块状态

| 模块 | 实现结果 | 验收结果 |
| --- | --- | --- |
| M1 共享契约与回合状态机 | 完成 | 状态矩阵、非法转换和完整 phase 轨迹通过 |
| M2 麦克风与设备生命周期 | 完成 | 权限、设备断开、并发点击、超时和清理自动化通过；物理矩阵待签核 |
| M3 录音交互与波纹 | 完成 | 真振幅、右向左移动、响应式宽度和 9 张视觉证据通过 |
| M4 音频、IPC 与临时资源 | 完成 | 二进制 IPC、格式/签名/10 MB 边界和临时文件清理通过 |
| M5 STT 编排 | 完成 | 成功、失败、取消、重试、竞态和旧事件隔离通过 |
| M6 STT Runtime 与 Gateway | 完成 | Fixture、Provider 契约及真实 `whisper-1` 通过 |
| M7 审核与 Composer | 完成 | 可编辑审核、光标插入、主动发送和不自动提交通过 |
| M8 回合与串行仲裁 | 完成 | 录音、聊天、TTS、播放互斥及导航清理通过 |
| M9 TTS Runtime | 完成 | 系统、Fixture、Gateway Provider 及真实 TTS 通过 |
| M10 播放与消息控件 | 完成 | 播放、暂停、继续、停止、结束和资源释放通过 |
| M11 设置、隐私与诊断 | 完成 | 迁移、授权、脱敏、日志扫描和数据清理通过 |
| M12 自动化与发布门禁 | 自动化部分完成 | 单元、视觉、打包和真实完整回合通过；物理设备矩阵待人工签核 |

## 3. 本轮修复

真实 UI 录音最初得到有效的 `audio/webm;codecs=opus`，但 OpenAI 转写返回 HTTP 400。根因不是 WebM 编码，而是桌面 UI 使用 BCP-47 地区标签 `en-US`，OpenAI 兼容转写接口要求 ISO-639-1 语言码 `en`。

Gateway 现已在 Provider 边界把 `en-US`、`zh-CN` 等地区标签规范化为 `en`、`zh`，并新增 Provider 请求参数测试。修复后，同一份 UI 录音在真实打包应用中完成了 ASR、LLM、TTS 和播放。

完整回合验收器同时补齐了：

- 已登录 renderer 的稳定启动路径。
- 每个关键阶段的独立 checkpoint 和失败快速返回。
- Chromium fake microphone 到真实 `MediaRecorder` 的采集。
- 真实 LLM 回复与 Provider TTS 的串联检查。
- 播放控制器完成检查，不依赖测试机器的物理扬声器。
- phase、诊断隐私、临时文件和日志正文泄漏检查。

## 4. 已通过验证

```text
npm run typecheck
npm run test:voice
npm run verify:voice-visual
npm run verify:packaged-voice
node scripts/verify-live-voice-provider.mjs --full-round
```

关键结果：

- 串行语音 18 组命令全部通过。
- Provider 行为测试 12 个场景通过。
- STT 与 TTS 各 1,000 次同步终态竞态通过。
- 20 轮采集、STT、播放压力测试通过，堆增量为负。
- 9 张视觉截图通过；桌面波纹宽 706 px，窄窗口波纹宽 590 px。
- 打包 Fixture Main/Preload IPC 验收通过。
- 打包真实 Provider 完整回合通过，未新增语音临时文件，日志未保存转写或回复正文。

证据位置：

- `apps/desktop/windows/out/verification/voice-visual/report.json`
- `apps/desktop/windows/release/voice-packaged-evidence/report.json`
- `apps/desktop/windows/release/voice-provider-live-evidence/report.json`

## 5. 唯一剩余门禁

`npm run verify:voice-release-ready` 当前只因 `Windows physical audio-device matrix` 失败。需要按 [Windows 串行语音发布验证](./windows-voice-release-validation.md) 在真实硬件上完成并签名：

- Windows 10 与 Windows 11。
- 内置、USB、蓝牙麦克风。
- 内置、USB、蓝牙输出设备。
- 权限拒绝、睡眠恢复、设备拔出和断网。
- Windows 系统声音。
- 20 个真实完整回合及内存、句柄、临时文件、隐私日志复核。

待人工结果写入 `apps/desktop/windows/release/voice-windows-hardware-evidence/report.json` 后，重新运行：

```text
npm run verify:voice-release-ready
```

只有该命令通过后，才能把“发布验收”标记为 100%。
