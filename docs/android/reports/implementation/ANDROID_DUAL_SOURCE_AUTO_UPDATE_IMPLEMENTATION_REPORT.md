# OpenDrSai Android 双源自动更新实施报告

## 结论

Android 应用内更新的 5 个模块、29 个功能点已完成代码实现和本地自主验收。
用户从个人中心触发更新后，应用能够检查 CDN、自动回退 GitHub、下载和校验 APK、
处理未知来源权限，并交由 Android 系统安装器覆盖升级。

线上 Beta/stable 发布准入是独立的部署门禁。当前机器没有组织 Beta/Release
Keystore 和 OSS 发布凭据，因此本报告不把 Dry Run 记为真实线上发布。

## 模块完成情况

| 模块 | 功能点 | 状态 | 主要结果 |
|---|---:|---|---|
| M1 构建、版本与频道 | 5 | 完成 | dev/beta/stable 固定映射，主备清单固化，验收包隔离，签名配置分离 |
| M2 双源发现与版本策略 | 6 | 完成 | CDN 优先、GitHub 回退、严格清单解析、版本和最低支持策略、结果持久化 |
| M3 下载与安全校验 | 6 | 完成 | 主备 APK 回退、断点续传、大小/哈希/包名/版本/签名链校验 |
| M4 安装状态与恢复 | 6 | 完成 | 完整状态机、权限恢复、FileProvider、系统安装器、通知和重启恢复 |
| M5 发布流水线 | 6 | 完成 | 双清单、不可变资产、GitHub/OSS 顺序、频道清单最后发布、CI 门禁 |
| **合计** | **29** | **29/29** | 功能实现完成 |

## 关键实现

- `AndroidUpdateCheckEngine` 负责双源清单发现、严格重定向与来源记录。
- `AndroidUpdateDownloadEngine` 负责断点续传、CDN→GitHub 回退和发布身份元组核对。
- `ApkVerifier` 同时校验 APK 元数据、清单证书和当前安装包签名兼容性。
- `AndroidUpdateManager` 管理检查、下载、校验、权限、安装、恢复和通知状态。
- `AndroidUpdateStore` 持久化最近检查结果与已校验待安装资产。
- 安装使用 `ACTION_INSTALL_PACKAGE` 和只读 FileProvider URI，避免三星设备把 APK
  交给普通文件“打开方式”选择器。
- `acceptance` 使用 `ai.drsai.remote.acceptance`，真机验收不会覆盖用户正式应用。

## 自动测试结果

### JVM 与 MockWebServer

- 结果：200/200 通过，0 failure，0 error。
- 覆盖：双源清单回退、身份元组、严格解析、状态机、权限策略、下载回退、
  Range 恢复、损坏文件删除、哈希/版本策略。

### 真机 Instrumentation

- 设备：Samsung SM-X936C，Android 16。
- 更新专项：4/4 通过。
- 覆盖：FileProvider URI、系统安装 Intent、未知来源设置 Intent、检查结果持久化、
  已安装 APK 的包名/版本/签名链校验。

### 旧版到新版覆盖升级

验收使用独立包执行了完整用户路径：

| 项目 | 结果 |
|---|---|
| 旧版本 | 1.5.1 / versionCode 10501 |
| 新版本 | 1.5.2 / versionCode 10502 |
| 检查、下载、校验 | 通过 |
| 系统安装器 | 自动打开，识别并点击“更新” |
| 覆盖升级 | 通过 |
| `firstInstallTime` | 升级前后相同 |
| 模拟登录密文 SHA-256 | 升级前后相同 |
| 自动步骤 | 8/8 通过 |

机器可读证据位于构建目录：
`apps/android/app/build/update-e2e/android-update-e2e-report.json`。

### 发布门禁

- GitHub Actions/发布脚本静态契约：13/13 通过。
- Beta 双清单生成：通过。
- 本地 APK/清单大小、SHA-256、签名摘要和不可变路径一致性：通过。
- OSS/GitHub/频道清单发布顺序 Dry Run：通过，频道清单最后发布。
- stable 使用 Debug 证书：按预期拒绝。
- Lint MVP：通过。
- MVP APK 构建：通过。

## 尚需发布环境完成的准入

以下项目需要组织级外部凭据，不属于本地代码可伪造的测试条件：

1. 配置固定 Beta Keystore 并执行一次真实 Beta 发布；
2. 配置组织 Release Keystore，确认 stable 不含 Debug 证书；
3. 配置 OSS 发布凭据并验证 CDN HEAD、Range、大小和 SHA-256；
4. 分别通过 CDN 主源和 GitHub 备用源完成一次真实旧版→新版升级；
5. 保存线上发布报告后再提升 stable 频道。

当前环境已检测到 GitHub Token，但没有 Beta/Release Keystore 和 OSSUTIL 配置，
因此未擅自创建线上 Release 或更新生产频道清单。
