# OpenDrSai for Android

OpenDrSai 的原生 Android 最小 MVP：真实 HAI/IHEP 登录、Kotlin 本地 Agent Runtime、HAI 流式回答、安全本地工具和本机会话记忆。

产品与技术规划见 [`docs/android_app/README.md`](../../docs/android_app/README.md)。

## 本地运行

1. 用 Android Studio 打开 `apps/android`，等待 Gradle 同步完成。
2. 启动 Android 模拟器或连接真机，运行 `app`。
3. 在系统浏览器完成 HAI OIDC 授权；浏览器会自动返回 OpenDrSai，App 随后直接访问 `https://ai.ihep.ac.cn/apiv2/v1`。

无需启动 WebUI 后端、Windows Gateway 或配置局域网地址。

## 构建与测试

要求 JDK 17 和 Android SDK 35：

```powershell
$env:JAVA_HOME="C:\Program Files\Android\Android Studio\jbr"
.\gradlew.bat testDebugUnitTest connectedDebugAndroidTest lintDebug assembleMvp
```

`mvp` 只使用 HAI HTTPS、关闭明文流量并进行 R8 压缩。文件名从 OpenDrSai 系统版本自动生成，例如：

`app/build/outputs/apk/mvp/OpenDrSai-Android-v1.4.3.apk`

当前 `mvp` 是使用 Android Debug Certificate 签名的可安装内测包。登录使用 `ai.ihep.ac.cn` OIDC，Agent Runtime 和历史位于手机本机，不依赖 `/api/mobile/v1`。公开分发前必须替换为组织持有的 Release Keystore。
