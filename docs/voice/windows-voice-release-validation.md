# Windows 串行语音发布验证

文档状态：发布执行清单  
适用阶段：串行语音交互  
最终门禁：`npm run verify:voice-release-ready`

## 1. 自动化准备

在 `apps/desktop/windows` 执行：

```text
npm run test:voice
npm run verify:voice-visual
npm run smoke:voice-windows-packaged
```

三项必须全部通过。打包证据写入 `release/voice-packaged-evidence/report.json`。

## 2. Live Provider

使用项目有权处理的测试音频，不得使用真实用户录音：

```powershell
$env:OPENDRSAI_VOICE_LIVE_FIXTURE="C:\fixtures\authorized-voice.wav"
$env:HEPAI_API_KEY="<release credential>"
npm run smoke:voice-provider
```

也可使用 `OPENAI_API_KEY`。命令必须同时完成 STT、STT 取消和 TTS，并扫描 stdout/stderr 与系统临时目录。成功报告位于 `release/voice-provider-live-evidence/report.json`，不得包含音频字节、完整转写或完整回复。

## 3. 物理设备矩阵

每个场景都从新启动的解包或安装版本开始：

| 场景 | 操作 | 通过标准 |
| --- | --- | --- |
| Windows 10 | 完成一次完整串行回合 | 录音、转写、回复和朗读均成功 |
| Windows 11 | 完成一次完整串行回合 | 录音、转写、回复和朗读均成功 |
| 内置麦克风 | 录制静音、低音量和正常说话 | 波纹与输入一致，来源正确 |
| USB 麦克风 | 选择设备并录制 10 秒 | 标签、选择和录音来源一致 |
| 蓝牙麦克风 | 选择设备并录制 10 秒 | 无错误切回其他输入设备 |
| 内置输出 | 使用 Windows 系统音色朗读 | 声音来自所选内置输出，暂停、继续和停止有效 |
| USB 输出 | 切换 USB 耳机或扬声器后朗读 | 新任务使用当前 Windows 默认输出，无双重播放 |
| 蓝牙输出 | 切换蓝牙耳机或扬声器后朗读 | 播放可完成，断开后错误可恢复且文字不丢失 |
| 权限拒绝 | 关闭麦克风权限后点击录音 | 不采集、不提交，显示可恢复错误 |
| 睡眠恢复 | 录音和空闲状态分别睡眠/唤醒 | 无残留录音，下一次可正常启动 |
| 设备拔出 | 录音中拔出设备 | 轨道停止，输入文字保留，可重选设备 |
| 断网 | STT/TTS 前后断开网络 | 错误可恢复，不返回 Fixture 文本，不破坏聊天 |
| 系统音色 | 中文、英文和中英混合回复 | 速度、音色、暂停、继续和停止有效 |

在目标硬件额外连续执行 20 个完整回合，确认任务管理器中的内存和句柄没有持续线性增长，系统临时目录没有 `opendrsai-voice-*` 残留。

## 4. 证据格式

将脱敏结果写入 `apps/desktop/windows/release/voice-windows-hardware-evidence/report.json`：

```json
{
  "ok": true,
  "testedAt": "2026-07-18T00:00:00.000Z",
  "appVersion": "1.4.8",
  "checks": {
    "windows10": true,
    "windows11": true,
    "builtinMicrophone": true,
    "usbMicrophone": true,
    "bluetoothMicrophone": true,
    "builtinOutput": true,
    "usbOutput": true,
    "bluetoothOutput": true,
    "permissionDenied": true,
    "sleepResume": true,
    "deviceUnplug": true,
    "networkLoss": true,
    "systemSpeech": true,
    "twentyTurnStability": true,
    "memoryStable": true,
    "handleStable": true,
    "tempFilesClean": true,
    "privacyLogsClean": true
  },
  "notes": "不得填写转写正文、回复正文、密钥或用户录音路径。"
}
```

最后执行：

```text
npm run verify:voice-release-ready
```

只有该命令通过，串行语音功能才满足发布条件。
