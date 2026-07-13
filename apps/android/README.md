# OpenDrSai for Android

OpenDrSai 的原生 Android 客户端。第一版支持 HAI 登录、Agent 选择、新建及恢复对话、流式回答、停止/重试、历史记录、深色模式和退出登录。

产品与技术规划见 [`docs/android_app/README.md`](../../docs/android_app/README.md)。

## 本地运行

1. 启动 OpenDrSai WebUI 后端（默认监听 `8081`）。
2. 用 Android Studio 打开 `apps/android`，等待 Gradle 同步完成。
3. 启动 Android 模拟器，运行 `app`。模拟器通过 `http://10.0.2.2:8081/api` 访问电脑上的后端。
4. 正式登录使用现有桌面端的 HAI 设备授权流程；浏览器授权完成后会自动进入 App。

仅在本地联调时，可给后端设置 `OPENDRSAI_MOBILE_DEV_AUTH=1`，Debug 构建的登录页会显示“本地开发登录”。请勿在共享或生产环境开启此变量。

## 构建与测试

要求 JDK 17 和 Android SDK 35：

```powershell
$env:JAVA_HOME="C:\Program Files\Android\Android Studio\jbr"
.\gradlew.bat testDebugUnitTest assembleDebug
```

生成的 Debug APK 位于 `app/build/outputs/apk/debug/app-debug.apk`。
