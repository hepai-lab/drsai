# 全双工语音 P2 Packaged 验收说明

在 `apps/desktop/windows` 下使用同一候选依次执行：

```powershell
npm run verify:voice:duplex-packaged-provider-run
npm run run:voice:duplex-serial-regression
npm run prepare:voice:duplex-packaged-review
```

第一项在真实 `zhizengzeng/gpt-realtime-2` 上验证 packaged Session、上行帧、下行音频、插话和唯一终态；开发环境固定使用 `.drsai-dev:28642`。第二项运行完整 `npm run test:voice:serial` 并保存去敏输出实体。第三项重新验证候选 EXE/asar、Provider 报告、Serial 报告和输出哈希，生成 `ok=false` 的 `release/duplex-voice/packaged-report.json`。

实际测试人必须亲自启动该哈希候选，从产品入口确认实时对话模式可见，开始/插话/结束控件可操作，并确认没有降级成 Serial 或旧 Streaming。完成后运行：

```powershell
npm run finalize:voice:duplex-packaged-review -- `
  --tester "测试人姓名" `
  --confirm-candidate `
  --confirm-duplex-mode `
  --confirm-controls `
  --confirm-no-fallback `
  --confirm-packaged-review
```

最后验证：

```powershell
node scripts/verify-duplex-release-evidence.mjs packaged release/duplex-voice/packaged-report-signed.json
```

候选、Provider 报告或 Serial 输出变化后必须重新准备和复核。报告不得包含转录正文、凭据、Provider 原始 payload 或设备标签。
