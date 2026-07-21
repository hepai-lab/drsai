# Android APP 自动更新实现与验收报告

## 当前轮次结果（2026-07-19）

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
| GitHub CDN 慢速下载保护 | 已实现：连接 30 秒、读取 2 分钟、整次下载 10 分钟；保留 partial 断点文件 |
| 超时错误提示 | 已实现：显示“下载超时，已保留已下载部分，请重试继续” |
| JVM 单元测试 | 通过：103 项 |
| Debug Lint | 通过 |
| Release Lint Vital | 通过 |
| MVP APK 构建 | 通过：`OpenDrSai-Android-v1.4.9.apk` |
| Release APK 构建 | 通过：`OpenDrSai-Android-v1.4.9.apk` |
| 当前测试签名 APK | `apps/android/app/build/outputs/apk/mvp/OpenDrSai-Android-v1.4.9.apk`，SHA-256 `83DE554BC5C9CE40CA730A014624D352CA6157CE3EBFAE1ED732D3FB0165CDCA` |
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

API 35 模拟器已成功连接为 `emulator-5554`。复测结果：

- 使用测试签名 Debug APK `OpenDrSai-Android-v1.4.9.apk` 覆盖安装成功并启动，无崩溃；
- 使用未签名 Release APK 安装被 Android 拒绝：`INSTALL_PARSE_FAILED_NO_CERTIFICATES`；
- 生产更新地址 `https://github.com/hepai-lab/drsai/releases/latest/download/latest-android.json`
  当前返回 HTTP 200，清单指向 `v1.4.9`，APK 大小约 2.9 MB。

## 本轮修复

此前下载器的 `callTimeout` 仅为 30 秒，GitHub Release 的多级重定向和 CDN 慢速响应会触发
超时。本轮将其调整为连接 30 秒、读取 2 分钟、整次下载 10 分钟，并启用 OkHttp 网络故障重试；
下载仍写入 `.partial` 文件，重试会从已接收字节继续。客户端代码、生产清单请求、构建和模拟器
启动链路已验证。
