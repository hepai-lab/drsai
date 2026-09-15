# 全双工语音 P2 Live Provider 复听签核说明

本流程把真实 Provider 自动运行证据与真人复听结论组合成正式 Live 报告。自动检测到音频、转录、插话和工具闭环不代表真人已经听过，不能自动签核。

## 1. 生成待复听报告

在 `apps/desktop/windows` 下运行：

```powershell
npm run prepare:voice:duplex-live-review
```

命令会验证 `release/duplex-voice/live-provider-run.json` 及其附件实体，并绑定当前 `release/win-unpacked/OpenDrSai.exe`、`app.asar` 的 SHA-256。输出 `release/duplex-voice/live-report.json`，状态固定为 `ok=false`、`tester=null`。

## 2. 真人复听

测试人必须亲自打开待复听报告列出的输出音频附件，并逐项确认：

1. 附件确实已播放和听取。
2. 语音内容可懂，听感无阻断任务的异常。
3. 插话停止行为与附件及自动指标一致、可以接受。
4. 工具调用和结果闭环已人工复核。

不要在报告或附件中增加转录正文、原始 Provider 事件、Authorization、API key、token 或设备标签。候选重新构建、Provider 报告或音频附件改变后，必须重新生成并重新复听。

## 3. 显式签核

四项均由实际测试人确认后运行：

```powershell
npm run finalize:voice:duplex-live-review -- `
  --tester "测试人姓名" `
  --confirm-listened `
  --confirm-intelligible `
  --confirm-interruption `
  --confirm-tool-round-trip `
  --confirm-live-review
```

finalizer 会重新校验候选构建、自动 Provider 源报告、音频附件、pending 报告完整性和隐私声明，然后生成 `release/duplex-voice/live-report-signed.json`。缺少任一显式确认、附件变化或构建变化都会失败。

## 4. 正式门禁

```powershell
node scripts/verify-duplex-release-evidence.mjs live release/duplex-voice/live-report-signed.json
```

Live 门禁通过不能替代 packaged、Serial 零回归、Windows 硬件矩阵、SLO 门槛以及产品/工程/QA 最终签核。
