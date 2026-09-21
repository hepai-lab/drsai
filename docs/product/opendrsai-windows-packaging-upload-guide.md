# OpenDrSai Windows 桌面版打包与上传指南

> 适用项目路径：`apps/desktop/windows`
> 分发目标：阿里云北京 OSS → CDN `download-opendrsai.ihep.ac.cn`

---

## 1. 产物一览

| 产物 | 文件名 | 用途 |
|------|--------|------|
| Runtime ZIP | `OpenDrSai-Windows-v{版本}-x64.zip` | 应用内自更新 |
| MSI 安装包 | `OpenDrSai-Windows-v{版本}-Installer-x64.msi` | 首次安装 |
| 更新清单 | `latest-windows.json` | 客户端检查更新 |
| 发布摘要 | `release-summary.json` | 审计记录 |

产物输出目录：`apps/desktop/windows/release/bootstrapper/`

### OSS 路径布局

```text
oss://hepai-release/releases/v{版本}/windows/OpenDrSai-Windows-v{版本}-Installer-x64.msi
oss://hepai-release/releases/v{版本}/windows/OpenDrSai-Windows-v{版本}-x64.zip
oss://hepai-release/channels/beta/latest-windows.json
oss://hepai-release/channels/stable/latest-windows.json    ← 最后上传
```

- 版本化资产（`/releases/v{版本}/`）：不可覆盖，Cache 1 年
- 通道清单（`/channels/`）：可覆盖，Cache 30~60 秒

---

## 2. 一次性环境准备

### 2.1 安装 ossutil

```powershell
winget install Aliyun.ossutil
# 或从阿里云官网下载解压到 PATH
ossutil version
```

### 2.2 配置 OSS 凭证

```powershell
ossutil config -e oss-cn-beijing.aliyuncs.com -i <AccessKeyID> -k <AccessKeySecret> -L EN
```

配置文件：`%USERPROFILE%\.ossutilconfig`（仅当前用户可读，不要提交到 git）

验证连通：

```powershell
ossutil ls oss://hepai-release/
```

---

## 3. 打包

### 3.1 安装依赖

```powershell
cd apps\desktop\windows
npm ci
```

### 3.2 一键构建

```powershell
npm run build:win
```

内部执行：`build`（electron-vite）→ `build:unpack`（electron-builder）→ `prepare-ci-python-agent`（准备 Python Agent）→ `create-opendrsai-runtime.ps1`（生成 Runtime ZIP）→ `build-msi.ps1`（生成 MSI）

### 3.3 自检

```powershell
npm run verify:final-runtime    # Runtime ZIP 完整性
npm run verify:artifacts        # 全部产物校验
```

### 3.4 生成更新清单

```powershell
npm run manifest:win            # → release\bootstrapper\latest-windows.json
npm run summary:win             # → release\bootstrapper\release-summary.json
```

### 3.5 确认产物

```powershell
Get-ChildItem release\bootstrapper | Where-Object { $_.Name -match 'OpenDrSai-Windows|latest-windows|release-summary' }
```

期望看到 4 个文件：MSI、ZIP、`latest-windows.json`、`release-summary.json`

---

## 4. 上传到 OSS

### 4.1 设置变量

```powershell
$VER = "1.5.8"                          # 替换为实际版本
$BUCKET = "hepai-release"
$RELEASE = "apps\desktop\windows\release\bootstrapper"
Set-Location $RELEASE
```

### 4.2 不可覆盖检查

```powershell
ossutil stat "oss://$BUCKET/releases/v$VER/windows/OpenDrSai-Windows-v$VER-x64.zip"
# 期望 404；若已存在说明已发过版，禁止覆盖
```

### 4.3 上传版本化资产

```powershell
ossutil cp "OpenDrSai-Windows-v$VER-Installer-x64.msi" "oss://$BUCKET/releases/v$VER/windows/OpenDrSai-Windows-v$VER-Installer-x64.msi" --force --meta "Cache-Control:public, max-age=31536000, immutable"

ossutil cp "OpenDrSai-Windows-v$VER-x64.zip" "oss://$BUCKET/releases/v$VER/windows/OpenDrSai-Windows-v$VER-x64.zip" --force --meta "Cache-Control:public, max-age=31536000, immutable"
```

> 上传后在阿里云 CDN 控制台刷新预热 MSI 和 ZIP。

### 4.4 CDN 验证

```powershell
curl.exe -I "https://download-opendrsai.ihep.ac.cn/releases/v$VER/windows/OpenDrSai-Windows-v$VER-x64.zip"
curl.exe -L -o temp.zip "https://download-opendrsai.ihep.ac.cn/releases/v$VER/windows/OpenDrSai-Windows-v$VER-x64.zip"
Get-FileHash temp.zip -Algorithm SHA256
# 对比 release-summary.json 中的 sha256
```

### 4.5 上传通道清单

```powershell
# Beta 通道
ossutil cp "latest-windows.json" "oss://$BUCKET/channels/beta/latest-windows.json" --force --meta "Cache-Control:public, max-age=30"

# Stable 通道（最后一步，需确认所有验证通过）
ossutil cp "latest-windows.json" "oss://$BUCKET/channels/stable/latest-windows.json" --force --meta "Cache-Control:public, max-age=30"
```

---

## 5. 发布后验证

```powershell
# 检查清单
curl.exe -L "https://download-opendrsai.ihep.ac.cn/channels/beta/latest-windows.json"

# 下载校验
curl.exe -L -o verify.zip "https://download-opendrsai.ihep.ac.cn/releases/v$VER/windows/OpenDrSai-Windows-v$VER-x64.zip"
Get-FileHash verify.zip -Algorithm SHA256
```

---

## 6. 发布检查表

```
□ npm ci
□ npm run build:win
□ npm run verify:final-runtime
□ npm run verify:artifacts
□ npm run manifest:win
□ npm run summary:win
□ 不可覆盖检查
□ 上传 MSI + ZIP 到 OSS
□ CDN 刷新预热
□ CDN 验证（HEAD/下载/SHA256）
□ 上传 beta 清单
□ 上传 stable 清单（最后）
□ 端到端下载验证
```

---

## 7. 常见问题

| 问题 | 原因 | 处理 |
|------|------|------|
| 清单与版本不一致 | 打包后未重建清单 | 重新执行 `manifest:win` |
| stable 清单拉不到新版 | 传了 beta 路径或缓存未过期 | 确认路径 + 等 30~60s |
| 版本号不匹配 | `package.json` version 与 git tag 不一致 | 统一为 `v{版本}` |