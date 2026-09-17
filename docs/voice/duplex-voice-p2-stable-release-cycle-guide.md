# 全双工语音 P2 稳定发布周期验收

本流程只用于 M10-F3。自动化、开发轮次、候选打包或一次真实 Provider 运行都不能替代“一个稳定发布周期”。

## 1. 发布时准备工作簿

在实际版本进入 stable channel 后，用真实版本号和发布时间生成工作簿：

```powershell
cd apps/desktop/windows
npm run prepare:voice:duplex-stable-release-review -- --release-version 1.5.8 --started-at 2026-08-14T00:00:00.000Z
```

生成的 `release/duplex-voice/stable-release-cycle-workbook.json` 必须保持 `ok=false`。工具只绑定候选 EXE/asar，不会自动宣称版本已发布、周期已完成或遥测为零。

## 2. 完成真实发布周期

周期结束后，由发布负责人根据权威发布记录和遥测填写：

- `published=true`；
- `observedFullReleaseCycle=true`；
- `newStreamingConfigReferences=0`；
- `migrationFailures=0`；
- `serialRegressions=0`；
- 至少两个不同的本地 `file:` 附件及实际 SHA-256：稳定发布记录、发布周期遥测/变更窗口记录。

缺少仪表盘或数据不能推断为零。任一回归非零时不得签署。

## 3. 实名签署并验证

```powershell
npm run finalize:voice:duplex-stable-release-review -- `
  --ended-at 2026-08-28T00:00:00.000Z `
  --approver "Release Owner" `
  --confirm-stable-publication `
  --confirm-full-release-cycle `
  --confirm-authoritative-telemetry

npm run verify:voice:duplex-stable-release
npm run generate:voice:duplex-p2-acceptance-status
```

finalizer 会重新核对候选和附件实体、周期时间、零回归遥测与三项显式确认。正式报告通过后，聚合器只会解除 M10-F3 的 `stable_release_cycle` 缺口；它不会替代 packaged、Live 或 hardware 证据。
