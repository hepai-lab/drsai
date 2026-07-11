# DrSai Remote for Android

Android 端是 DrSai 桌面网关的局域网遥控台。MVP 支持连接、会话列表、历史记录、流式回复、工具/子 Agent 进展和发送指令。

## 桌面端

在桌面电脑启动网关前开启 WebSocket，并明确允许监听局域网地址：

```powershell
$env:PYTHONPATH="cores/python/packages/drsai/src"
$env:DRSAI_TUI_WS="1"
$env:DRSAI_TUI_WS_HOST="0.0.0.0"
$env:DRSAI_TUI_WS_PORT="8765"
python -m drsai.backend.tui_gateway
```

确保 Windows 防火墙只允许可信的专用网络访问 8765 端口。手机与电脑连接同一个 Wi-Fi，然后输入：

```text
ws://电脑的局域网IP:8765/attach
```

## 构建

使用 Android Studio 打开 `apps/android`，等待 Gradle 同步后运行 `app`。要求 JDK 17、Android SDK 35。

> 当前网关没有鉴权。不要将端口暴露到公网；正式版本应增加一次性配对码与 TLS。
