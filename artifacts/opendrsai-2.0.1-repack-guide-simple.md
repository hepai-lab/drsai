# 改了桌面代码后，重新出包并上传（简版）

> 适用：改了 `apps\desktop` 的前端（renderer）或后端（main/preload）代码，要把改动做成新包发到阿里云。
> 全程 PowerShell，在 `D:\work\projects\drsai` 下操作。
> 完整原理版见 `opendrsai-2.0.1-repack-guide.md`；平时照这份做就行。

---

## 0. 一句话流程

```
关进程 → npm ci → 重建 Python Agent → build:win → 生成清单 → 自检 → 装一遍验证 → 发布到 OSS
```

改了代码只需重跑这些，**版本号不用改**（还是 2.0.1）。

---

## 1. 关掉所有 OpenDrSai / Electron 进程

不关会占用文件，后面 `npm ci` 必报 `EPERM`。

```powershell
Get-CimInstance Win32_Process -Filter "Name='electron.exe'" |
  Where-Object { $_.ExecutablePath -like '*\apps\desktop\*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
```

---

## 2. 装依赖

```powershell
cd D:\work\projects\drsai\apps\desktop\windows
npm ci
```

---

## 3. 重建 Python Agent（关键，别跳）

用标准 CPython 3.12，别让 conda 的 python 混进来。

```powershell
cd D:\work\projects\drsai\apps\desktop\windows
Remove-Item -Recurse -Force ".tmp\bootstrapper-msi3" -ErrorAction SilentlyContinue
npm run prepare-ci-python-agent -- -Python "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe"
```

检查（`home` 必须是 `...\Programs\Python\Python312`，不能是 miniconda）：

```powershell
Get-Content ".tmp\bootstrapper-msi3\.drsai\drsai-agent\venv\pyvenv.cfg"
```

---

## 4. 打包

```powershell
cd D:\work\projects\drsai\apps\desktop\windows
npm run build:win
```

最耗时（压缩约 320 MB），**中途别关窗口**。

如果报 `backend-source.json version does not match`，先跑 `npm run prepare:backend-source` 再重来。

---

## 5. 生成更新清单

```powershell
npm run manifest:win
npm run summary:win
```

---

## 6. 自检（两条都必须过）

```powershell
npm run verify:final-runtime
npm run verify:artifacts
```

再看产物齐不齐，**应有 4 个文件**：

```powershell
Get-ChildItem release, release\bootstrapper -File |
  Where-Object { $_.Name -match 'OpenDrSai-Windows|latest-windows|release-summary' } |
  Select-Object FullName, Length
```

| 文件 | 位置 |
|------|------|
| `OpenDrSai-Windows-v2.0.1-Installer-x64.msi` | `release\bootstrapper\` |
| `OpenDrSai-Windows-v2.0.1-x64.zip` | `release\bootstrapper\` |
| `latest-windows.json` | `release\` |
| `release-summary.json` | `release\` |

---

## 7. 本地装一遍确认（别跳过）

```powershell
cd D:\work\projects\drsai\apps\desktop\windows
msiexec /i "release\bootstrapper\OpenDrSai-Windows-v2.0.1-Installer-x64.msi" INSTALLFOLDER="D:\software\opendrsai"
```

启动 OpenDrSai，**能正常进界面、不弹「本地运行环境需要修复」** 才算通过。
有问题把界面「复制脱敏诊断」发给助手。

---

## 8. 上传到阿里云 OSS

### 8.1 设环境变量（每开一个新终端都要设一次）

```powershell
$env:OSSUTIL_PATH   = 'D:\work\release\ossutil-2.4.0-windows-amd64\ossutil.exe'
$env:OSSUTIL_CONFIG = Join-Path $env:USERPROFILE '.ossutilconfig'
```

### 8.2 先预演

```powershell
cd D:\work\projects\drsai\apps\desktop\windows
.\scripts\publish-windows-release-to-oss.ps1 `
  -Channel beta `
  -ReleaseDirectory release `
  -BuildLabel "Beta 4" `
  -StageVersionAssets `
  -DryRun
```

### 8.3 正式发布

```powershell
cd D:\work\projects\drsai\apps\desktop\windows
.\scripts\publish-windows-release-to-oss.ps1 `
  -Channel beta `
  -ReleaseDirectory release `
  -BuildLabel "Beta 4" `
  -StageVersionAssets `
  -VerifyOnline
```

> 约 5 分钟，别关窗口。中途失败**原样重跑即可**（幂等，不会重复上传）。
> `-Channel` 决定发到哪个通道（beta / stable），`-BuildLabel` 一定要显式写，别让它继承旧值。

### 8.4 验证

```powershell
curl.exe -L "https://download-opendrsai.ihep.ac.cn/channels/beta/latest-windows.json"
```

看到 `"version": "2.0.1"` 和你要的 `buildLabel` 就成了。

---

## 附：出错怎么办

| 报错 | 处理 |
|------|------|
| `npm ci` 报 `EPERM ... unlink` | 还有 Electron 进程，回第 1 步 |
| `ModuleNotFoundError: No module named 'drsai'` | Agent 被 conda 建了，重做第 3 步 |
| `backend-source.json version does not match` | 跑 `npm run prepare:backend-source` 再 `build:win` |
| `Materialized backend version does not match runtime 2.0.1` | 跑 `python scripts\sync_version.py 2.0.1` |
| `Missing release artifact: latest-windows.json` | 漏跑第 5 步 |
| 装完仍报 `runtime-missing` / 白屏 | 把界面诊断发助手 |
| 发布中断 | 原样重跑 |

> 改**渠道/版本号/打包脚本**时，才需要看完整版指南；日常改代码照这份走。
