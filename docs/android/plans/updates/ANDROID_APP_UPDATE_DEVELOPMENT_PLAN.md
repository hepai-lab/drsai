# OpenDrSai Android APP 自动更新开发方案

## 1. 目标与桌面端对齐原则

第一阶段新增“应用内检查更新、下载 APK、校验并引导系统安装”能力。方案参考
`apps/desktop/windows/src/main/updates.ts` 和 Windows Release Checklist，但不复制
Windows 的 MSI/管理员提权/原子替换逻辑：Android 更新必须由系统 Package Installer
完成，应用不能静默覆盖自身。

必须保持以下原则：

- 只从固定的 HTTPS 发布源读取清单和 APK，不允许用户输入任意更新地址；
- 先校验清单结构、渠道、版本、最低可更新版本，再下载；
- 下载完成后同时校验文件大小、SHA-256 和 APK 签名证书；
- 只允许同一 applicationId、同一签名证书的升级包，禁止降级和跨渠道覆盖；
- 更新失败不影响当前已安装版本；更新完成由系统安装器确认，应用重新启动后再确认版本；
- 测试签名仅用于 Beta，正式发布前必须切换组织 Release Keystore，否则无法形成正式升级链路。

## 2. 发布清单契约

稳定渠道默认地址：

`https://github.com/hepai-lab/drsai/releases/latest/download/latest-android.json`

清单采用独立的 `android-update-manifest/v1` 结构：

```json
{
  "schemaVersion": 1,
  "platform": "android",
  "channel": "stable",
  "version": "1.4.7",
  "versionCode": 10407,
  "publishedAt": "2026-07-18T00:00:00Z",
  "minimumSupportedVersion": "1.4.0",
  "mandatory": false,
  "apk": {
    "url": "https://github.com/hepai-lab/drsai/releases/download/android-v1.4.7/OpenDrSai-Android-v1.4.7.apk",
    "sizeBytes": 12345678,
    "sha256": "64-hex-lowercase",
    "signingCertSha256": "64-hex-lowercase"
  },
  "releaseNotesUrl": "https://github.com/hepai-lab/drsai/releases/tag/android-v1.4.7"
}
```

`versionCode` 是 Android 安装器的最终比较依据，`version` 用于展示和清单兼容性；
生产构建只接受 `stable`，Beta 构建才接受 `beta`。APK URL 必须指向不可变的版本化
Release，不能使用 `latest/download` 作为 APK 下载地址。

## 3. 模块与功能点

### U1 更新配置与版本判断（8 个功能点）

1. 从 `BuildConfig` 读取当前版本、versionCode、渠道和固定 manifest URL；
2. 启动延迟检查、手动检查和 WorkManager 周期检查；
3. 仅在有网络时检查，遵循退避、超时和取消策略；
4. 解析并限制清单大小、字段类型、schemaVersion、platform 和 channel；
5. 以 versionCode 判断可用更新，拒绝降级、同版本和跨渠道更新；
6. 检查 `minimumSupportedVersion`，决定普通提示或强制更新门禁；
7. 发布说明链接只允许白名单 HTTPS 主机；
8. 检查失败不阻塞现有聊天和远程工作区，返回可重试的错误状态。

### U2 安全下载与完整性验证（8 个功能点）

1. 仅允许 GitHub Release/CDN 白名单和 HTTPS；
2. 手动处理可信重定向，限制重定向次数并逐跳校验主机；
3. 下载到应用私有缓存目录，不直接覆盖已安装 APK；
4. 支持断点续传或 DownloadManager 恢复，并限制单文件大小；
5. 展示下载进度、暂停/取消和失败重试；
6. 校验下载字节数与清单 `sizeBytes`；
7. 流式计算 SHA-256，与清单值严格比较；
8. 清理校验失败、过期或未完成的临时文件。

### U3 APK 安装与升级状态（7 个功能点）

1. 使用 PackageManager 校验 applicationId、versionCode 和签名证书摘要；
2. 拒绝签名不一致、版本过低、包损坏或非 APK 文件；
3. 通过 FileProvider 暴露只读 `content://` URI；
4. 使用 `ACTION_VIEW`/Package Installer 发起用户确认安装；
5. 在 Android 8+ 检查 `REQUEST_INSTALL_PACKAGES` 和“允许安装未知应用”状态；
6. 保存 pending/installed/failed 状态，应用回到前台后重新读取已安装版本；
7. 安装取消、空间不足、签名不匹配时保留旧版本并给出可理解的处理建议。

### U4 UI、通知与运维发布（7 个功能点）

1. 设置页显示当前版本、检查结果、目标版本和发布日期；
2. 普通更新提供“稍后/下载/安装”，强制更新提供明确门禁和重试；
3. 下载期间提供通知栏进度，完成后提供“安装”入口；
4. 前后台切换、旋转和进程重启后恢复更新状态；
5. 支持 Beta 渠道开关，但生产稳定版不得被切换到任意地址；
6. 发布脚本生成 APK、SHA-256、签名摘要和 `latest-android.json`，并校验版本一致；
7. GitHub Release 同时保留 APK、清单、Release Notes，记录可审计的校验值。

合计：**4 个模块、30 个功能点**。

## 4. Android 组件落位

- `data/AndroidUpdateRepository`：清单请求、解析、版本策略和错误映射；
- `data/AndroidUpdateDownloader`：OkHttp/DownloadManager、进度、断点和哈希；
- `data/ApkVerifier`：PackageManager、签名证书和文件安全检查；
- `data/UpdateStore`：DataStore 保存检查时间、pending 文件和安装结果；
- `ui/UpdateViewModel`：把状态映射为 Compose 提示、设置页和强制门禁；
- `UpdateWorker`：WorkManager 网络约束、周期检查和指数退避；
- `FileProvider`：仅暴露缓存目录下待安装 APK，禁止暴露数据库和 Token；
- `BuildConfig`：`ANDROID_UPDATE_MANIFEST_URL`、`ANDROID_UPDATE_CHANNEL`、允许主机和证书摘要。

更新模块不复用 OIDC Token，不向 HAI API 发送认证信息；更新清单和 APK 是公开发布资产。

## 5. 测试与验收

### JVM 单元测试

- 清单 schema、字段缺失、超大清单、错误 JSON、非法 URL 和不可信重定向；
- versionCode/版本比较、同版、降级、最低支持版本、stable/beta 渠道；
- 下载断点、HTTP 200/206、超时、取消、重试、大小不匹配和 SHA-256 不匹配；
- APK applicationId、证书摘要和版本校验；
- pending 状态恢复、安装取消和失败状态映射。

### Android 模拟器/Instrumentation

- API 30 与 API 35：FileProvider URI、Package Installer Intent 和未知来源设置引导；
- 下载完成后能打开系统安装器，取消安装后旧版本仍可启动；
- 进程重启、旋转、后台恢复后状态和通知一致；
- 强制更新门禁只影响主页面，不破坏登出和诊断入口。

### 发布验收

1. 发布 N 与 N+1，检查 N 能发现并安装 N+1；
2. 使用错误 hash、错误证书、降级 APK、伪造主机和损坏 APK，全部被拒绝；
3. 断网、切后台、杀进程后恢复下载，不产生半成品可安装文件；
4. N+1 安装后 OIDC 登录、聊天、附件和远程工作区数据仍可访问；
5. 测试签名 Beta 只验证 Beta 升级；正式 Release 另行验证同一 Release Keystore 的连续升级；
6. 产物 APK、清单、versionName、versionCode、SHA-256 和 GitHub Release 资产逐项一致。

## 6. 自主端到端验收方案（旧版本 → 新版本）

这套验收由开发环境自行完成，不以真机作为门禁。目标是证明用户在旧版本中点击
“检查更新/立即更新”后，可以安全地完成新 APK 的下载、系统安装和应用恢复。

### 6.1 测试准备

1. 构建两个使用**同一 Android 签名证书**的 APK：旧版本 `N` 和新版本 `N+1`；
2. 启动 API 30 或 API 35 Android Emulator，创建独立测试用户数据；
3. 使用本地 HTTPS 测试发布目录或测试 GitHub Release，放置 `latest-android.json`、
   `OpenDrSai-Android-vN+1.apk` 和 Release Notes；清单 URL 通过仅测试构建的
   `ANDROID_UPDATE_MANIFEST_URL` 注入，生产构建仍使用固定 GitHub 地址；
4. 由验收脚本计算 APK 的大小、SHA-256 和签名证书摘要，写入清单，避免手工录入；
5. 通过 `adb install` 安装旧版本 N，启动应用并写入一条会话/设置数据，记录
   `versionName`、`versionCode`、applicationId、签名摘要和数据快照。

### 6.2 正向升级步骤

1. 在旧版本设置页点击“检查更新”，断言状态从 checking → available，目标版本为 N+1；
2. 点击“下载更新”，断言通知/页面出现进度，最终进入 verified/ready；
3. 点击“立即安装”，断言应用打开 Android Package Installer，URI 为受保护的
   `content://`，且安装包不是外部任意路径；
4. 由 UIAutomator/ADB 测试脚本确认系统安装器的“安装”操作（Android 的安全模型不允许
   应用静默覆盖自身，因此“自动完成”定义为应用自动拉起安装器并完成用户确认）；
5. 等待应用进程重启，读取 PackageManager，确认 versionCode=N+1、签名摘要不变；
6. 回到应用后确认 OIDC 会话、历史聊天、附件索引、远程工作区配置仍然存在；
7. 再发送一条测试消息并打开一个远程工作区会话，证明升级没有破坏核心业务；
8. 保存升级前后版本信息、Logcat、更新状态、安装器结果和截图/视频证据。

### 6.3 自动化脚本接口与通过标准

建议提供 `apps/android/scripts/accept-update-e2e.ps1`（或等价 Gradle task），支持：

- `-OldApk`、`-NewApk`、`-ManifestUrl`、`-AvdName`、`-ApiLevel` 参数；
- 启动/重置 Emulator，安装 N，等待应用可用，注入测试状态；
- 通过 UIAutomator resource-id 或 Compose semantics 点击检查、下载、安装；
- 轮询 PackageManager 直到 versionCode=N+1，超时则收集 logcat、bugreport 和缓存目录；
- 输出机器可读的 `update-e2e-report.json`，包含每一步状态、耗时、版本和 SHA-256。

一次正向验收通过必须同时满足：

- 清单被接受且只下载 N+1；
- 下载字节数和 SHA-256 正确，安装器成功完成；
- 新版本签名和 applicationId 与旧版本一致；
- 旧数据完整保留，登录、聊天和远程工作区冒烟成功；
- 没有遗留可安装的 `.partial` 文件或未清理的失败缓存。

### 6.4 必须自动执行的异常场景

- 修改 `sha256`：更新进入 failed，旧版本继续可用；
- 修改 `signingCertSha256` 或使用不同签名 APK：安装前被拒绝；
- 提供 versionCode 更低的 APK：状态为 downgrade-rejected，不拉起安装器；
- 下载中断后恢复：从断点继续，最终 hash 与完整下载一致；
- 断网/超时/清单 404：显示可重试错误，不影响聊天；
- 安装器取消或存储空间不足：旧版本和原数据保持可用；
- `minimumSupportedVersion` 高于当前版本：进入强制更新门禁，但保留登出、诊断和重试入口。

异常场景也必须生成同一格式的报告，并明确记录“拒绝原因”和旧版本仍可运行。

## 7. 实施顺序与门禁

1. 先完成 U1/U2 的纯 Kotlin 逻辑和清单生成/校验脚本；
2. 接入 U3 系统安装器和 FileProvider，再接入 U4 UI、通知与 WorkManager；
3. 通过 JVM、Instrumentation、Lint 后发布 Beta；
4. Beta 连续升级通过后，才允许把功能纳入第一阶段正式 Release；
5. 任何签名证书变更、更新主机变更或清单 schema 变更都必须提升发布门禁并重新验证升级链路。
