# Android APP 自动更新实现与验收报告

## 当前轮次结果

| 项目 | 结果 |
|---|---|
| 更新清单/渠道/版本策略 | 已实现 |
| HTTPS 白名单与可信重定向 | 已实现 |
| 断点下载、进度和重试 | 已实现 |
| 大小、SHA-256、APK 签名校验 | 已实现 |
| FileProvider + 系统 Package Installer | 已实现 |
| WorkManager 周期检查 | 已实现 |
| 设置页“检查并更新”入口 | 已实现 |
| 更新通知与状态恢复基础能力 | 已实现 |
| JVM 单元测试 | 通过：103 项 |
| Debug Lint | 通过 |
| Release Lint Vital | 通过 |
| MVP APK 构建 | 通过：`OpenDrSai-Android-v1.4.8.apk` |
| Release APK 构建 | 通过：`OpenDrSai-Android-v1.4.8.apk` |
| 旧版 → 新版模拟器安装器 E2E | 部分完成：模拟器已连接，1.4.6 → 1.4.8 测试签名覆盖安装成功；自动更新清单当前 404 |

## 已产生的代码

- `apps/android/app/src/main/java/ai/drsai/remote/data/AndroidUpdate.kt`
- `apps/android/app/src/main/java/ai/drsai/remote/data/AndroidUpdateManager.kt`
- `apps/android/app/src/test/java/ai/drsai/remote/AndroidUpdatePolicyTest.kt`
- `apps/android/scripts/accept-update-e2e.ps1`

## E2E 执行方式

准备同一签名证书的旧 APK 和新 APK，并启动 API 30/API 35 Emulator：

```powershell
.\scripts\accept-update-e2e.ps1 `
  -OldApk .\old\OpenDrSai-Android-vN.apk `
  -NewApk .\app\build\outputs\apk\release\OpenDrSai-Android-v1.4.8.apk `
  -ManifestUrl https://github.com/hepai-lab/drsai/releases/latest/download/latest-android.json
```

脚本安装旧版、启动应用、记录旧 `versionCode`，等待系统 Package Installer 完成升级，
最后生成 `update-e2e-report.json`。Android 不允许应用静默覆盖自身，因此安装器确认是
系统安全流程的一部分；脚本的通过条件是新 `versionCode` 已安装且大于旧版本。

## 最新模拟器复测

API 30 模拟器已成功连接为 `emulator-5554`。复测结果：

- 预装旧版本：`versionName=1.4.6`、`versionCode=10406`；
- 使用测试签名 MVP APK 覆盖安装成功：`versionName=1.4.8`、`versionCode=10408`；
- 使用未签名 Release APK 安装被 Android 拒绝：`INSTALL_PARSE_FAILED_NO_CERTIFICATES`；
- 生产更新地址 `https://github.com/hepai-lab/drsai/releases/latest/download/latest-android.json`
  当前返回 HTTP 404，因此无法继续自动下载/拉起安装器。

## 当前阻塞

需要在 GitHub Release 发布 `latest-android.json` 和对应版本化 APK（并确保 APK 使用可
连续升级的签名）。发布后重新点击“检查并更新”即可完成自动下载和系统安装器验收；客户端
代码、模拟器和覆盖安装链路本身已验证。
