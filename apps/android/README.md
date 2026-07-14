# OpenDrSai for Android

开发环境联调使用：

```powershell
$env:OPENDRSAI_ANDROID_HAI_BASE_URL="https://ai-dev.ihep.ac.cn"
$env:OPENDRSAI_ANDROID_OIDC_CLIENT_ID="opendrsai-android"
$env:OPENDRSAI_ANDROID_OIDC_REDIRECT_URI="ai.drsai.remote:/oauth2redirect"
```

HAI 开发环境已注册该 Android Public Client。Android 原生回调与上游 IHEP 回调不是同一个地址；
IHEP 开发客户端仍使用平台注册的 `https://ai-dev.ihep.ac.cn/umt/callback`。

OpenDrSai 的原生 Android 最小 MVP：真实 HAI/IHEP 登录、Kotlin 本地 Agent Runtime、HAI 平台智能体、流式回答、安全本地工具和本机会话记忆。

产品与技术规划见 [`docs/android_app/README.md`](../../docs/android_app/README.md)。

## 本地运行

1. 用 Android Studio 打开 `apps/android`，等待 Gradle 同步完成。
2. 启动 Android 模拟器或连接真机，运行 `app`。
3. 在系统浏览器完成 HAI OIDC 授权；浏览器会自动返回 OpenDrSai。App 通过 `/apiv2/v1` 使用本机 Runtime 的模型，并通过 `/api/native/v1` 加载和运行平台智能体。

无需启动 WebUI 后端、Windows Gateway 或配置局域网地址。

## Android OIDC 原生回调

HAI 注册 `opendrsai-android` Public Client，并允许
`ai.drsai.remote:/oauth2redirect` 后，使用以下环境变量构建正式原生回调版本：

```powershell
$env:OPENDRSAI_ANDROID_OIDC_CLIENT_ID="opendrsai-android"
$env:OPENDRSAI_ANDROID_OIDC_REDIRECT_URI="ai.drsai.remote:/oauth2redirect"
$env:OPENDRSAI_ANDROID_HAI_BASE_URL="https://ai-dev.ihep.ac.cn"
```

未设置时继续使用 `opendrsai-desktop` 的随机 loopback 兼容回调。兼容模式用于 HAI 配置生效前的内测，可能因
真机后台回收、VPN/代理或五分钟超时而失败，不应作为最终 Android 发布配置。原生模式下每台手机使用独立的
state、nonce 和 PKCE verifier，同一个回调 URI 可以安全支持多设备并发登录。

## 构建与测试

要求 JDK 17 和 Android SDK 35：

```powershell
$env:JAVA_HOME="C:\Program Files\Android\Android Studio\jbr"
.\gradlew.bat testDebugUnitTest connectedDebugAndroidTest lintDebug assembleMvp
```

`mvp` 只使用 HAI HTTPS、关闭明文流量并进行 R8 压缩。文件名从 OpenDrSai 系统版本自动生成，例如：

`app/build/outputs/apk/mvp/OpenDrSai-Android-v1.4.5.apk`

当前 `mvp` 是使用 Android Debug Certificate 签名的可安装内测包。登录使用 HAI OIDC；会话历史位于手机本机，本机 Runtime 在 Android 执行，平台智能体通过 HAI `/api/native/v1` 执行，不依赖 `/api/mobile/v1`。公开分发前必须替换为组织持有的 Release Keystore。
