# 全双工语音 P2 物理验收操作说明

本说明用于 P2 的真人听说、Windows 音频设备和真实生命周期验收。自动化测试、程序化电源事件、合成音频和 Provider 探针不能替代这里的物理操作。

## 1. 准备候选与工作簿

在 `apps/desktop/windows` 下构建待验收的 `release/win-unpacked` 候选，然后生成工作簿：

```powershell
npm run prepare:voice:duplex-hardware-review
```

默认使用开发配置域 `.drsai-dev` 和 Gateway 端口 `28642`。只有验收生产配置时才运行：

```powershell
node scripts/prepare-duplex-hardware-review.mjs --production
```

生成文件为 `release/duplex-voice/hardware-review-workbook.json`。它绑定当前 `OpenDrSai.exe`、`app.asar`、OS 构建、协议 v2、Provider/model 和环境端口；生成时保持 `ok=false`、`tester=null`。

## 2. 执行四组真实场景

严格按照工作簿 `scenarios[].steps` 操作：

1. Windows 11 内置麦克风/扬声器、外放 AEC、真实锁屏、真实睡眠和恢复。
2. Windows 10 内置音频、从 Windows 隐私设置真实拒绝麦克风、恢复权限后重试。
3. 活动 Session 内切换 USB 耳机，并在播放期间真实拔出设备。
4. 蓝牙耳机连续对话、自然附和、明确插话、真实 Wi-Fi 中断和恢复。

每一步完成后填写：

- `observed`：只写行为结论，不写转录正文、设备名称、凭据或 Provider 原始事件。
- `passed`：亲自确认符合预期后才能设为 `true`。
- `metrics`：填写工作簿 `requiredMetrics` 中的全部数值，不得用字符串或占位符。
- `attachments`：填写本机 `file:` URI；每个场景应有独立截图、视频或去敏诊断附件及真实 SHA-256。
- 场景全部通过后才把场景的 `passed` 设为 `true`。

不要修改工作簿中的构建哈希、Provider/model、协议、端口、隐私声明、`checks` 或设备类别。候选重新构建后必须重新生成并重做对应验收。

## 3. 显式签核并生成正式报告

完成所有物理步骤后，由实际测试人运行：

```powershell
npm run finalize:voice:duplex-hardware-review -- --tester "测试人姓名" --confirm-physical-review
```

此命令会重新读取候选构建和所有附件，验证实际 SHA-256、步骤、指标、完整矩阵及至少四份不同物理附件，然后生成 `release/duplex-voice/hardware-report.json`。缺任何一项都会失败，不会生成可通过门禁的报告。

## 4. 运行正式门禁

```powershell
npm run verify:voice:duplex-hardware
```

门禁通过仅证明硬件报告本身满足 P2 的格式、实体附件、实名签核和完整性要求。Live Provider、packaged、Serial 零回归、盲听/SLO 以及产品、工程、QA 的最终签核仍需各自证据，不能由该报告替代。

## 隐私边界

- 不保存设备标签、转录正文、原始音频、Authorization header、API key 或 token。
- 附件应只包含完成判断所需的最小画面和去敏数值。
- 正式报告保存设备类别而非设备名称。
- 测试 Thread 和临时诊断在取证完成后按产品删除流程清理。
