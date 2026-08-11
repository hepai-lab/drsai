# OpenDrSai Android 双源自动更新开发方案

## 1. 文档信息

- 状态：功能开发与本地自主验收完成；线上 Beta/stable 发布准入待组织签名和 OSS 凭据
- 目标版本：Android 下一发布版本
- 产品范围：OpenDrSai Android 应用内检查、下载、校验和升级
- 发布主源：`download-opendrsai.ihep.ac.cn`
- 发布备用源：GitHub Releases
- 上游发布架构：
  [`docs/product/opendrsai-download-distribution-plan.md`](../../../product/opendrsai-download-distribution-plan.md)
- 既有实现基础：
  [`ANDROID_APP_UPDATE_DEVELOPMENT_PLAN.md`](./ANDROID_APP_UPDATE_DEVELOPMENT_PLAN.md)
  和
  [`ANDROID_APP_UPDATE_IMPLEMENTATION_REPORT.md`](../../reports/implementation/ANDROID_APP_UPDATE_IMPLEMENTATION_REPORT.md)

本方案不是从零重写更新器。现有 Android 代码已经具备版本判断、断点下载、
大小与 SHA-256 校验、APK 证书摘要校验、FileProvider、系统安装器入口、
WorkManager 和基本更新界面。本阶段在此基础上补齐双源回退、构建渠道隔离、
安装状态恢复、固定签名链和自动发布闭环。

## 2. 目标与非目标

### 2.1 目标

用户在 Android 个人中心点击“检查并更新”后，应用应自动完成：

1. 从 CDN 检查所属频道的最新版本；
2. CDN 不可用时自动回退 GitHub；
3. 下载、恢复下载并校验 APK；
4. 必要时引导用户授予“安装未知应用”权限；
5. 拉起 Android 系统安装器；
6. 用户确认后覆盖安装新版本；
7. 新版本启动后确认升级成功并保留原有登录、会话和远程工作区数据。

后台检查只允许产生更新提醒，不得在没有用户操作时弹出系统安装器。

### 2.2 非目标

- 不绕过 Android Package Installer 静默安装；
- 不允许用户输入任意更新服务器；
- 不通过 HAI/OIDC 接口分发 APK，也不携带登录 Token 请求更新资产；
- 不在本阶段接入 Google Play In-App Updates；
- 不支持降级、跨 applicationId 覆盖或不同签名证书之间的直接升级；
- 不允许使用 Android Debug Certificate 发布 stable 版本。

## 3. 已确定的设计决策

### 3.1 固定频道

| Android 构建 | applicationId | 频道 | 主清单 |
|---|---|---|---|
| `debug` | `ai.drsai.remote.debug` | `dev` | 测试构建显式注入 |
| `acceptance` | `ai.drsai.remote.acceptance` | `dev` | 本地或验收环境显式注入；与用户正式应用隔离 |
| `mvp` | `ai.drsai.remote` | `beta` | `/channels/beta/latest-android.json` |
| `release` | `ai.drsai.remote` | `stable` | `/channels/stable/latest-android.json` |

生产构建不能在运行时切换频道或更新地址。测试构建只能通过 Gradle 属性或环境变量
注入测试地址，且明文 HTTP 仅允许 `127.0.0.1`、`localhost` 和模拟器宿主
`10.0.2.2`。

### 3.2 发布路径

版本化 APK 永远不可覆盖：

```text
https://download-opendrsai.ihep.ac.cn/releases/v{version}/android/OpenDrSai-Android-v{version}.apk
https://github.com/hepai-lab/drsai/releases/download/v{version}/OpenDrSai-Android-v{version}.apk
```

频道清单允许更新：

```text
https://download-opendrsai.ihep.ac.cn/channels/beta/latest-android.json
https://download-opendrsai.ihep.ac.cn/channels/stable/latest-android.json
```

GitHub 备用频道：

```text
stable: https://github.com/hepai-lab/drsai/releases/latest/download/latest-android.json
beta:   https://github.com/hepai-lab/drsai/releases/download/android-beta/latest-android.json
```

`android-beta` 是可更新的 GitHub Beta 频道指针；实际 APK 仍来自不可变的
`v{version}` Release。

### 3.3 清单契约

继续使用 `android-update-manifest/v1`，不新增必须字段：

```json
{
  "schemaVersion": 1,
  "platform": "android",
  "channel": "beta",
  "version": "1.5.3",
  "versionCode": 10503,
  "publishedAt": "2026-07-26T00:00:00Z",
  "minimumSupportedVersion": "1.5.0",
  "mandatory": false,
  "apk": {
    "url": "https://download-opendrsai.ihep.ac.cn/releases/v1.5.3/android/OpenDrSai-Android-v1.5.3.apk",
    "sizeBytes": 3000000,
    "sha256": "64位小写十六进制",
    "signingCertSha256": "64位小写十六进制"
  },
  "releaseNotesUrl": "https://github.com/hepai-lab/drsai/releases/tag/v1.5.3"
}
```

同一个版本生成两份内容等价的清单：

- CDN 清单中的 `apk.url` 指向 CDN；
- GitHub 清单中的 `apk.url` 指向对应 GitHub 不可变 Release 资产；
- 除 `apk.url` 外，版本、大小、文件哈希和签名摘要必须一致。

### 3.4 双源策略

```text
用户/后台触发检查
        |
        v
请求 CDN 频道清单 ----失败----> 请求 GitHub 频道清单
        |                            |
       成功                         成功
        +-------------+--------------+
                      v
            校验频道、版本和安全字段
                      |
                      v
              优先下载 CDN APK
                      |
                   下载失败
                      |
                      v
       读取 GitHub 清单并核对发布身份元组
                      |
                      v
              下载 GitHub APK
                      |
                      v
         大小、哈希、包名、版本、签名校验
                      |
                      v
               Android 系统安装器
```

发布身份元组定义为：

```text
(channel, version, versionCode, sizeBytes, sha256, signingCertSha256)
```

从 CDN 切换到 GitHub 时必须完全匹配该元组，禁止下载同版本号但内容不同的备用资产。

### 3.5 签名策略

长期维护两套固定签名：

- OpenDrSai Android Beta Keystore；
- OpenDrSai Android Release Keystore。

Keystore 和密码只存放在受保护的 CI Secret 中，不进入仓库和构建日志。候选 APK
必须同时满足：

1. 签名摘要等于清单声明；
2. 签名与当前已安装应用兼容；
3. stable 构建不是 Android Debug Certificate。

当前使用本机 Debug Certificate 安装的测试版本不能直接升级到新的固定 Beta 或 Release
签名。首次切换固定签名时需要执行一次明确的一次性卸载重装；完成切换后，后续版本必须
保持签名不变。

## 4. 开发范围

本阶段共 **5 个模块、29 个功能点**。

| 模块 | 名称 | 功能点数 |
|---|---|---:|
| M1 | 构建、版本与频道配置 | 5 |
| M2 | 双源更新发现与版本策略 | 6 |
| M3 | 弹性下载与安全校验 | 6 |
| M4 | 安装状态机、恢复与用户界面 | 6 |
| M5 | 发布流水线与发布门禁 | 6 |
|  | **合计** | **29** |

## 5. M1：构建、版本与频道配置（5 个功能点）

| ID | 功能点 | 实现要求 | 测试与验收 |
|---|---|---|---|
| M1-F01 | 统一版本读取 | `versionName` 从系统统一版本文件读取，`versionCode` 按既有规则确定性生成 | 构建脚本、APK badging、清单三者的版本完全一致 |
| M1-F02 | 构建类型固定频道 | `mvp=beta`、`release=stable`、`debug/acceptance=dev` | 单元或 Gradle 契约测试断言每个 Variant 的频道 |
| M1-F03 | 主备清单固化 | 每个可发布 Variant 在 `BuildConfig` 中分别写入主、备清单 URL | APK 反编译/BuildConfig 测试确认没有任意用户输入入口 |
| M1-F04 | 测试源安全隔离 | 只有 debug/acceptance 可开启本地明文测试源 | mvp/release 对本地 HTTP 和非白名单主机全部拒绝 |
| M1-F05 | 签名配置分离 | Beta 和 stable 使用独立、固定 Keystore；stable 禁止 Debug 签名 | 构建门禁检测证书 DN/摘要，错误签名直接失败 |

主要代码落位：

- `apps/android/app/build.gradle.kts`
- `apps/android/scripts/build-stage5-release.ps1`
- 新增 Gradle Variant/BuildConfig 契约测试

## 6. M2：双源更新发现与版本策略（6 个功能点）

| ID | 功能点 | 实现要求 | 测试与验收 |
|---|---|---|---|
| M2-F01 | CDN 主源检查 | 手动检查和后台检查默认请求所属频道 CDN 清单 | MockWebServer/在线 Beta 验证首次请求只访问 CDN |
| M2-F02 | GitHub 清单回退 | CDN DNS、连接、超时、5xx、404或非法清单时尝试 GitHub | 分别注入上述错误，均能从 GitHub 发现相同版本 |
| M2-F03 | 清单严格解析 | 限制 64 KiB，校验 schema、platform、channel、字段类型、HTTPS和主机白名单 | 缺字段、超大、错误类型、非法 URL、跨频道全部拒绝 |
| M2-F04 | 版本策略 | 以 `versionCode` 为安装依据；拒绝同版和降级；展示 `version` | 同版返回“已是最新”，低版本不下载，高版本可用 |
| M2-F05 | 最低支持版本 | 当前版本低于 `minimumSupportedVersion` 时升级为强制更新状态 | 强制更新只限制核心业务，仍保留诊断、重试和退出登录 |
| M2-F06 | 来源与结果持久化 | 保存检查时间、来源、目标版本、失败代码和可用状态 | 旋转、切后台和进程重启后状态可恢复且不过期误用 |

主要代码落位：

- `data/AndroidUpdate.kt`
- `data/AndroidUpdateManager.kt`
- 新增 `data/AndroidUpdateSource.kt`
- `AndroidUpdatePolicyTest.kt`
- 新增双源 Repository 测试

## 7. M3：弹性下载与安全校验（6 个功能点）

| ID | 功能点 | 实现要求 | 测试与验收 |
|---|---|---|---|
| M3-F01 | CDN 优先下载 | 接受 CDN 清单后优先下载 CDN 版本化 APK | 正常网络只产生一次 CDN APK 请求 |
| M3-F02 | APK 下载回退 | CDN APK 失败时读取 GitHub 清单，身份元组一致后切换 GitHub | CDN 下载中断后成功从 GitHub 完成，元组不一致则拒绝 |
| M3-F03 | 断点续传 | 私有缓存使用 `.partial`，支持 HTTP 206；服务器不支持 Range 时安全重下 | 断线、进程重启、200/206 场景最终文件哈希一致 |
| M3-F04 | 大小与 SHA-256 | 流式限制最大尺寸，完成后严格校验 `sizeBytes` 和 `sha256` | 截断、超长、损坏文件全部删除且不拉起安装器 |
| M3-F05 | APK 元数据校验 | 校验 applicationId、versionCode、versionName 和可解析性 | 包名错误、版本错误、损坏 APK 全部拒绝 |
| M3-F06 | 签名链校验 | 候选签名同时匹配清单和当前安装应用，正确处理签名历史 | 错误清单证书、不同 Keystore、伪造 APK 全部拒绝 |

缓存文件以频道和 `versionCode` 隔离，避免同名版本或频道之间复用错误 partial：

```text
cache/updates/{channel}/{versionCode}/OpenDrSai-Android-v{version}.apk.partial
cache/updates/{channel}/{versionCode}/OpenDrSai-Android-v{version}.apk
```

主要代码落位：

- `data/AndroidUpdate.kt`
- 拆分 `data/AndroidUpdateDownloader.kt`
- 拆分 `data/ApkVerifier.kt`
- `res/xml/file_paths.xml`
- 下载、回退和 APK 校验 JVM/Instrumentation 测试

## 8. M4：安装状态机、恢复与用户界面（6 个功能点）

| ID | 功能点 | 实现要求 | 测试与验收 |
|---|---|---|---|
| M4-F01 | 明确更新状态机 | 支持 Idle、Checking、Available、Downloading、Verifying、Ready、PermissionRequired、Installing、Installed、Failed、Cancelled | 状态迁移测试拒绝非法跳转，错误状态保留可重试上下文 |
| M4-F02 | 未知来源权限 | Android 8+ 安装前检查 `canRequestPackageInstalls()`，必要时进入应用专属授权页 | 未授权时不报笼统失败，授权返回后无需重新下载即可继续 |
| M4-F03 | 安全系统安装器 | FileProvider 只读 URI 拉起 Package Installer，禁止 `file://` 和外部任意路径 | API 30/35 验证 URI、MIME、授权 Flag 和安装器页面 |
| M4-F04 | 前后台与重启恢复 | 持久化已校验 APK、目标版本和安装阶段；回到前台重新读取已安装版本 | 旋转、切后台、杀进程后不会重复下载或丢失 Ready 状态 |
| M4-F05 | 更新界面与通知 | “检查并更新”自动检查、下载并拉起安装器；后台只发可点击通知；显示来源、版本、进度和可理解错误 | Compose 测试覆盖所有状态；通知点击能回到对应更新界面 |
| M4-F06 | 升级完成与清理 | 新版启动确认 versionCode，显示升级成功，清理旧 APK/partial/过期状态 | 升级后登录、会话、附件索引和远程工作区数据保留，缓存无残留 |

用户主动点击时的目标流程：

```text
检查并更新
  → 正在检查
  → 发现 vN+1
  → 自动下载
  → 正在校验
  → 必要时申请安装权限
  → 打开系统安装器
  → 用户确认更新
  → 新版本启动并显示升级完成
```

主要代码落位：

- `data/AndroidUpdateManager.kt`
- 新增 `data/AndroidUpdateStore.kt`
- 新增 `ui/update/UpdateViewModel.kt`
- `ui/OpenDrSaiApp.kt`
- `MainActivity.kt`
- `AndroidManifest.xml`
- 更新通知与 Compose/Instrumentation 测试

## 9. M5：发布流水线与发布门禁（6 个功能点）

| ID | 功能点 | 实现要求 | 测试与验收 |
|---|---|---|---|
| M5-F01 | 可重复构建和签名 | CI 从统一版本构建指定频道 APK，并使用对应固定 Keystore | APK 文件名、versionName、versionCode、频道和签名一致 |
| M5-F02 | 双清单生成 | 一次发布生成 CDN版与 GitHub版 `latest-android.json` | 除 APK URL 外发布身份元组逐字段一致 |
| M5-F03 | OSS 版本资产发布 | 上传 `/releases/v{version}/android/`，拒绝覆盖已有版本资产 | 重复发布不同内容失败；同内容幂等校验通过 |
| M5-F04 | CDN 发布验证 | 验证 HTTPS、HEAD、Range、Content-Length、实际大小和 SHA-256，并预热 APK | 任一验证失败不得更新频道清单 |
| M5-F05 | GitHub Release 备份 | 创建 `v{version}` Release，上传 APK、GitHub清单、校验值和 Release Notes；Beta 同步 `android-beta` 指针 | GitHub 下载资产与 CDN 资产 SHA-256 完全一致 |
| M5-F06 | 清单最后发布与回滚 | 所有资产验证成功后最后更新频道清单；失败时频道仍指向上一可用版本 | 注入上传失败，旧客户端仍能下载并安装上一版本 |

建议新增：

- `.github/workflows/android-release.yml`
- `apps/android/scripts/generate-android-update-manifests.ps1`
- `apps/android/scripts/publish-android-release.ps1`
- `apps/android/scripts/verify-android-release.ps1`
- 发布证据 `android-release-report.json`

发布顺序固定为：

1. 构建、测试、签名；
2. 上传 OSS 版本化 APK；
3. 验证 CDN HEAD、Range、大小和 SHA-256；
4. 预热 APK；
5. 创建并验证 GitHub Release；
6. 上传 CDN 频道清单；
7. 验证客户端 CDN 更新；
8. 阻断 CDN 后验证 GitHub 回退；
9. 生成发布证据并允许频道提升。

## 10. 测试与自主验收方案

### 10.1 JVM 单元测试

覆盖：

- 所有清单字段、大小上限、错误 JSON 和 URL 白名单；
- stable/beta/dev 频道隔离；
- versionCode、同版、降级和最低支持版本；
- CDN→GitHub 回退决策；
- 两份清单身份元组比较；
- 200/206、断点、超时、取消、大小和哈希错误；
- APK 包名、版本和签名策略；
- 更新状态持久化和合法状态迁移。

通过标准：所有相关 JVM 测试通过，无跳过测试。

### 10.2 MockWebServer 集成测试

至少覆盖：

1. CDN 正常，全程不访问 GitHub；
2. CDN 清单 DNS/超时/404/5xx，GitHub 成功；
3. CDN 清单成功、APK 下载失败，GitHub APK 成功；
4. CDN 与 GitHub 身份元组不一致；
5. 两个源都失败；
6. CDN partial 与 GitHub Range 续传；
7. 重定向逐跳主机校验；
8. 超过重定向次数和重定向到非白名单主机。

### 10.3 API 30/API 35 Instrumentation

覆盖：

- FileProvider URI；
- 未知来源权限引导和返回；
- Package Installer Intent；
- 通知权限及通知点击；
- 旋转、后台、杀进程后的状态恢复；
- 安装取消后旧版本继续运行；
- 强制更新门禁保留诊断、重试和退出入口。

### 10.4 旧版本 N → 新版本 N+1 自动升级

扩展 `apps/android/scripts/accept-update-e2e.ps1`，完整执行：

1. 使用同一固定测试签名构建 N 和 N+1；
2. 安装 N；
3. 写入模拟登录、历史会话、附件索引和远程工作区测试数据；
4. 发布 N+1 到本地 HTTPS 或 Beta 测试频道；
5. 在 N 中点击“检查并更新”；
6. 等待检查、下载和校验；
7. UIAutomator 操作系统安装器确认“更新”；
8. 等待 PackageManager 报告 `versionCode=N+1`；
9. 启动 N+1，核对签名、首次安装时间和原有数据；
10. 发送一条测试消息并打开一次远程工作区；
11. 检查没有失败 `.partial` 和过期 APK；
12. 输出 `android-update-e2e-report.json`、截图和 Logcat。

一次正向验收必须同时满足：

- 从 N 成功升级到 N+1；
- 用户只需发起更新并确认 Android 系统安装；
- applicationId 和签名保持不变；
- 登录、会话、附件和远程工作区数据未丢失；
- 更新失败不会破坏旧版本；
- 没有可安装的未校验 APK；
- 证据包含来源、版本、哈希、签名、耗时和安装结果。

### 10.5 必须执行的异常验收

- CDN 清单不可用，GitHub 成功；
- CDN APK 中断，GitHub 成功；
- CDN/GitHub 内容不一致；
- 错误 SHA-256；
- 错误签名；
- 错误 applicationId；
- 同版和降级 APK；
- 下载中断与恢复；
- 用户拒绝未知来源权限；
- 用户取消系统安装；
- 存储空间不足；
- 清单发布成功但 APK 不存在；
- 应用在下载、校验和 Ready 阶段被杀进程。

每个异常场景都必须证明旧版本仍可启动，并输出稳定、可诊断的失败代码。

### 10.6 在线 Beta 发布验收

发布 Beta 后执行：

1. CDN 清单可读取且缓存策略符合频道要求；
2. CDN APK 支持 HEAD 和 Range；
3. CDN 下载文件与 CI 产物 SHA-256 一致；
4. GitHub Release 资产与 CDN 文件一致；
5. 旧 Beta 通过 CDN 完成一次升级；
6. 阻断 CDN 域名后，另一台旧 Beta 通过 GitHub 完成一次升级；
7. 两次升级后核心数据和功能均正常。

stable 发布必须重复相同验收，并额外确认使用组织 Release Keystore。

## 11. 实施轮次

### R1：配置和双源检查

- 完成 M1、M2；
- 完成 JVM 与 MockWebServer 检查源测试；
- 输出双源检查证据。

### R2：下载、校验和安装状态机

- 完成 M3、M4；
- 通过 API 30/API 35 Instrumentation；
- 完成本地 N→N+1 自动升级。

### R3：固定 Beta 签名和发布流水线

- 建立 Beta Keystore Secret；
- 完成 M5；
- 发布两个连续 Beta 版本；
- 通过 CDN 正常升级和 GitHub 回退升级。

### R4：stable 准入

- 配置组织 Release Keystore；
- 验证 stable 连续升级；
- 通过所有发布门禁后启用 stable 清单。

## 12. 完成定义

以下条件全部满足后，本阶段才能标记完成：

- 5 个模块、29 个功能点全部实现；
- JVM、MockWebServer、API 30和 API 35测试全部通过；
- 同一签名的 N→N+1 自动升级通过；
- CDN 主链路和 GitHub 回退链路各完成一次真实升级；
- 错误哈希、错误签名、降级和伪造主机全部被拒绝；
- 升级后登录、会话、附件和远程工作区数据完整；
- Beta 使用固定 Beta Keystore；
- stable 使用组织 Release Keystore且不含 Debug 证书；
- OSS/CDN、GitHub Release、频道清单和发布证据完全一致；
- 任何失败都不会让频道清单指向不可安装版本。

## 13. 实施结果（2026-07-26）

- 5 个模块、29 个功能点已全部实现。
- JVM/MockWebServer 测试 200/200 通过。
- 更新专项真机 Instrumentation 测试 4/4 通过。
- 独立验收包 `ai.drsai.remote.acceptance` 已在三星 Android 16 设备上从
  `1.5.1`（versionCode 10501）覆盖升级到 `1.5.2`（versionCode 10502）。
- 升级前后 `firstInstallTime` 与模拟登录密文 SHA-256 均保持一致。
- 发布工作流静态契约 13/13 通过；双清单生成、本地一致性校验、发布顺序 Dry Run
  和 stable Debug 签名拒绝均通过。
- 详细证据见
  [`ANDROID_DUAL_SOURCE_AUTO_UPDATE_IMPLEMENTATION_REPORT.md`](../../reports/implementation/ANDROID_DUAL_SOURCE_AUTO_UPDATE_IMPLEMENTATION_REPORT.md)。

尚未把本地验收结果表述为线上发布完成。真实 CDN/GitHub 双源升级和 stable 准入需要
组织提供固定 Beta/Release Keystore 与 OSS 发布凭据；凭据配置后执行本文 10.6
即可完成线上发布准入。
