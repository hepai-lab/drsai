# Android v1.5.6：v1.5.5 登录后“运行异常”修复与发布验收方案

> 文档版本：V1.0  
> 故障版本：Android v1.5.5（versionCode 10505）  
> 修复版本：Android v1.5.6（versionCode 10506）  
> 适用包名：`ai.drsai.remote`；诊断对照包：`ai.drsai.remote.debug` / `ai.drsai.remote.acceptance`  
> 制定日期：2026-08-04  
> 状态：待执行  
> 关联方案：`ANDROID_V1_5_6_FULL_RUNTIME_DEFAULT_DEVELOPMENT_TEST_PLAN.md`

## 1. 版本与处置结论

本问题必须通过 **v1.5.6 / 10506** 修复，不能重新发布同一个 `versionCode=10505` 的 v1.5.5 APK：Android 无法把同版本号的替换包作为正常升级推送，而且同名不同哈希会破坏发布物不可变性和审计链。

v1.5.6 的两条工作流必须保持隔离：

1. `OpenDrSai.Debug` / `acceptance` 继续执行既定的 Full Agent Runtime 默认绑定开发方案；
2. 面向已安装 v1.5.5 的 `mvp` / `release` 修复包，先解决公开包登录后异常和 OEM 兼容性，不自动把尚未通过 OEM 矩阵的 Full Runtime 推进稳定渠道；
3. Debug Full Runtime 验收通过不等于 Stable 可发布，Stable 必须单独通过本文的签名、二进制、OEM、升级和线上发布门禁；
4. v1.5.5 产物、哈希、签名、数据库和线上清单保持只读，作为复现与升级基线。

## 2. 已知现象与当前证据

用户可完成 OIDC 登录，但登录后系统弹出：

> OpenDrSai 运行异常。OpenDrSai 使用的加固技术还没有适配当前安卓系统版本。

这不是应用当前自定义的错误页面，而是设备系统/OEM 安全组件产生的运行异常提示。截图本身还不足以证明具体是哪一家加固壳或哪一个 native 库崩溃，必须取得“查看应用异常记录”、logcat 和 tombstone 后才能定责。

当前仓库与留存产物已有以下可复核证据：

- v1.5.5 基线：`OpenDrSai-Android-v1.5.5.apk`，SHA-256 `d52b7df0cee4fab11fa817e0ba25be4db7e67a2ca3e3a4596c205e1a641321a6`，大小 26,370,437 字节；
- APK 元数据：`ai.drsai.remote`、`versionName=1.5.5`、`versionCode=10505`、`minSdk=26`、`targetSdk=35`；
- 留存基线没有发现常见第三方加固壳命名，但实际包含完整 Chaquopy/Python native 与资源：`libpython3.11.so`、`libchaquopy_java.so`、OpenSSL/SQLite native 库、`assets/chaquopy/**`；
- v1.5.5 稳定默认配置把 `PYTHON_LOCAL_RUNTIME_ENABLED` 设为 `false`，但打包系统仍把 Python Runtime 和 `PythonRuntimeService` 放入 APK；“功能关闭”没有实现“二进制不进入稳定包”；
- 留存的 v1.5.5 `mvp` 基线使用 `Android Debug` 证书，仅通过 APK Signature Scheme v2；它不能作为正式公开 Stable 包的合规签名证据；
- 当前发布流水线允许 `mvp` 在缺少 Beta keystore 时回退到 Debug keystore，这对本地开发方便，但必须禁止进入任何公开发布动作；
- 线上公开 APK 是否与该基线完全相同、是否经过仓库外二次加固，尚未取得可验证证据。

## 3. 根因假设与定责顺序

| 优先级 | 假设 | 当前判断 | 必须取得的证据 |
|---|---|---|---|
| H1 | 未启用的 Chaquopy/Python native 仍进入稳定 APK，被 OEM 安全组件识别为不兼容加固/动态运行环境 | 高 | 同设备安装“无 Python 资产”对照包后提示消失；异常记录指向相关 `.so` 或加载器 |
| H2 | 线上 v1.5.5 在仓库外被二次加固，且加固壳不支持设备当前系统 | 高，待核对 | 从线上 URL 重新下载，比较 SHA-256、签名和 ZIP 内容；确认所有发布后处理步骤 |
| H3 | Beta/MVP Debug 签名包被当作正式包分发，触发 OEM 风控或破坏升级信任链 | 已确认基线存在风险，线上未知 | 线上 APK 签名证书摘要、渠道清单 `signingCertSha256`、已安装包签名三方一致性 |
| H4 | 登录后应用自身崩溃，OEM 只用通用“加固不兼容”文案包装了异常 | 中 | `ApplicationExitInfo`、FATAL EXCEPTION、ANR、native tombstone 和异常时间线 |
| H5 | 某个 ABI/native 库不支持具体 Android/HarmonyOS 版本或 16 KB page size | 中 | 设备 ABI/page size、ELF 对齐、加载失败库名、目标机复现 |
| H6 | OIDC 成功后的并行初始化造成崩溃、ANR或错误启动 Runtime | 中低 | 分阶段 bootstrap trace；分别关闭模型、Relay、Runtime、数据库恢复后的 A/B 结果 |

定责原则：先证明“哪个发布物、哪个进程、哪个模块、哪个异常”，再决定是否仅移除资产、升级依赖或修改登录流程。禁止只根据 OEM 文案替换错误提示后宣布修复。

## 4. 总体目标

1. v1.5.6 能从 v1.5.5 同签名原位升级，账号、会话、OAEP、Memory、Artifact 和 SAF 授权引用不丢失；
2. 用户完成登录、回到应用、进入主界面、刷新 Token 和冷启动恢复登录态时，不崩溃、不 ANR、不出现 OEM“运行异常”；
3. `mvp` / `release` 只包含该渠道真实启用的 Runtime，不再携带“关闭但仍打包”的 Python/Chaquopy native 资产和 Service；
4. `debug` / `acceptance` 继续完整携带并验证 Full Runtime，不能因为稳定包修复而退回 Kotlin Lite；
5. 公开 APK 必须使用批准的 Beta/Production 证书，不得回退 Debug 证书，不得经过未记录的仓库外二次加固；
6. 构建产物、CDN、GitHub、更新清单和用户实际下载文件的大小、SHA-256、签名证书完全一致；
7. 建立 OEM/Android 版本、ABI、登录生命周期、升级和异常恢复的自动化发布门禁，防止同类问题再次进入稳定渠道。

## 5. 目标架构与渠道边界

```text
共同层
  Auth/OIDC -> AuthenticatedBootstrapCoordinator
  Room/OAEP/Model/Relay/UI/Update
              |
              +-- debug / acceptance
              |     -> runtime-full contract implementation
              |     -> PythonRuntimeService :runtime
              |     -> Chaquopy + shared Python Agent Core
              |
              +-- mvp / release compatibility hotfix
                    -> stable runtime implementation selected by product policy
                    -> no PythonRuntimeService
                    -> no Chaquopy classes/assets/native libraries
```

稳定渠道的临时二进制隔离是 v1.5.5 事故修复要求，不改变 Android 最终完全 OAEP/Full Runtime 的产品目标。Full Runtime 只有在同一套 OEM、签名、升级和发布门禁全部通过后，才能另行决定进入 Stable。

## 6. 需要实现、更新或移除的模块

### 6.1 新增

- `AuthenticatedBootstrapCoordinator`：把登录后的初始化拆成可观测、可取消、可降级的阶段状态机；
- `RuntimeDistributionContract`：按 variant 声明允许的 Service、class、assets、native 库和 ABI；
- APK 二进制审计器：扫描 ZIP、DEX、Manifest、ELF、签名和疑似加固壳指纹；
- `ApplicationExitInfo`/native crash 脱敏导出器；
- v1.5.5→v1.5.6 同签名升级测试夹具；
- OEM 真机登录回归和发布物在线同一性验证任务。

### 6.2 更新

- `app/build.gradle.kts`：把 Full Runtime 依赖和打包内容改为 variant 级隔离；
- `AndroidManifest.xml`：`PythonRuntimeService` 仅合并到需要 Full Runtime 的 variant；
- `AppViewModel`：登录成功后只触发协调器，不在一个协程内串联全部重型初始化；
- `MainActivity` / OIDC callback：保证回调幂等、Activity 重建安全、重复 Intent 不重复 bootstrap；
- `PythonRuntimeClient` / binding coordinator：只在允许 Full Runtime 的发行契约下可构造和绑定；
- R8/ProGuard：稳定包删除不可达 Runtime/Chaquopy 类，并建立 keep 规则差异检查；
- `build-stage5-release.ps1`、`verify-android-release.ps1`、`android-release.yml`：加入签名、Runtime 分发、OEM、在线哈希和禁止外部加固门禁；
- 更新清单与个人中心：展示 versionName/versionCode、渠道、签名证书短摘要、Runtime distribution 和 build fingerprint。

### 6.3 从 `mvp` / `release` 移除

- `PythonRuntimeService` 及 `:runtime` 进程声明；
- `assets/chaquopy/**`；
- `libpython*`、`libchaquopy*`、Chaquopy OpenSSL/SQLite 和 Python extension `.so`；
- Full Runtime 专属 Python Core、bootstrap 和 requirements；
- 无 keystore 时自动回退 Debug 签名的公开发布路径；
- 未记录、不可复现的 APK 二次加固或重签步骤；
- 登录成功后无条件初始化所有 Runtime/Relay/Model/恢复模块的单体流程。

说明：以上“移除”仅针对 v1.5.6 `mvp` / `release` 兼容修复包；Debug/Acceptance 必须保留 Full Runtime。

## 7. 功能点、测试与验收（9 模块 / 47 项）

### M01 事故证据与根因定责（5 项）

| 编号 | 功能点/实现 | 测试方法 | 验收标准 |
|---|---|---|---|
| M01-F01 | 固化问题设备身份和复现步骤 | 记录品牌、型号、系统构建号、Android API、ABI、page size、安装来源、登录前后时间线 | 任何成员可按记录稳定复现或明确标记不可复现，字段无缺失 |
| M01-F02 | 导出 OEM“应用异常记录” | 点击截图入口并保存完整记录；与系统时间、包版本对应 | 得到异常类型、进程、模块/库、时间戳，不只保留截图 |
| M01-F03 | 采集系统退出与崩溃证据 | `ApplicationExitInfo`、logcat、ANR traces、native tombstone、`dumpsys package` | 能判断 crash/ANR/native kill/security block 中至少一种；敏感 Token 0 泄漏 |
| M01-F04 | 三份 APK 同一性核对 | 比较 CI 原始产物、CDN/GitHub 下载物、问题机已安装 APK 的 hash/signature/ZIP 清单 | 三份完全一致；不一致则确定首次发生差异的发布步骤并阻断发布 |
| M01-F05 | 最小 A/B 定责 | 同签名构建：原包、移除 Python 资产包、仅升级 Chaquopy包、无 R8 包依次测试 | 至少一个变量能稳定改变结果，或异常记录直接锁定模块；无证据不得关闭事故 |

### M02 版本、签名与供应链身份（5 项）

| 编号 | 功能点/实现 | 测试方法 | 验收标准 |
|---|---|---|---|
| M02-F01 | 修复版本固定为 1.5.6/10506 | 用 `aapt2`/`apkanalyzer` 解析所有候选包 | 文件名、APK metadata、BuildConfig、个人中心、更新清单完全一致 |
| M02-F02 | Stable 强制生产签名 | 缺失 release keystore 构建和发布负向测试 | `release` 无生产证书直接失败，不生成可发布报告 |
| M02-F03 | Beta 强制 Beta 签名 | 缺失 beta keystore 时执行 publish | 可以生成明确标识的本地开发包，但公开 publish 必须失败，禁止 Debug fallback |
| M02-F04 | 产物可追溯 manifest | 记录 commit、dirty 状态、Gradle/JDK/SDK、APK/mapping/SBOM/hash/signature | 任一线上 APK 可唯一反查构建和输入；manifest 与 APK 相互校验 |
| M02-F05 | 禁止未声明二次加固/重签 | 构建后、上传前、线上下载后三次 hash/signature 检查 | 三次一致；检测到新增壳特征、重签或 ZIP 差异立即 No-Go |

### M03 Runtime 按发行变体物理隔离（6 项）

| 编号 | 功能点/实现 | 测试方法 | 验收标准 |
|---|---|---|---|
| M03-F01 | 建立 Runtime API 与实现边界 | Gradle 依赖图、源码引用和 DEX 引用扫描 | app 公共层只依赖 Runtime contract；variant 决定具体实现 |
| M03-F02 | Debug/Acceptance 注入 Full Runtime | 构建后扫描 Manifest、DEX、assets、JNI | `PythonRuntimeService`、`:runtime`、Chaquopy、Python Core 全部存在且唯一 |
| M03-F03 | MVP/Release 不注入 Full Runtime | 同上并执行负向二进制扫描 | Service、Chaquopy/Python class、assets 和 `.so` 命中数全部为 0 |
| M03-F04 | Variant 行为与 BuildConfig 一致 | JVM contract test + 启动时诊断 | 不允许出现“flag=false 但二进制存在”或“flag=true 但 Runtime 缺失” |
| M03-F05 | 删除稳定包运行时反射/延迟加载入口 | DEX 字符串、Class.forName、Service bind Intent 扫描 | MVP/Release 不存在可触发 Python Runtime 的入口 |
| M03-F06 | APK 体积与内容预算 | 比较 v1.5.5 与 v1.5.6 ZIP entry/size diff | 每项增减可解释；稳定包移除 Python 后体积显著下降且业务资源无误删 |

### M04 登录后初始化状态机（6 项）

| 编号 | 功能点/实现 | 测试方法 | 验收标准 |
|---|---|---|---|
| M04-F01 | 实现分阶段 bootstrap | 单测验证 `AUTH_VALIDATED→LOCAL_DATA→MODEL→RELAY→RUNTIME→READY` 合法迁移 | 阶段可观测、可重试；非法跳转和重复执行被拒绝 |
| M04-F02 | OIDC 回调幂等 | 同一个 redirect Intent 连续投递、旋转、进程重建 | code 只兑换一次，Token 只保存一次，只启动一个 workspace bootstrap |
| M04-F03 | 首屏与重型初始化解耦 | 人为让模型/Relay/Runtime 超时 | 登录后仍可进入可用主界面；单模块失败不杀主进程、不永久 loading |
| M04-F04 | Runtime 发行契约门禁 | MVP/Release 登录后监视 service/process/native load | 不启动 `:runtime`，不加载 Python `.so`；Debug 必须按策略绑定 Full Runtime |
| M04-F05 | 并发与取消 | 快速登录→退出→换账号、前后台切换、重复点击登录 | 旧账号任务全部取消；无跨账号数据、无重复 observer/job/service |
| M04-F06 | 恢复已有登录态 | 冷启动、Token refresh、网络中断恢复、系统回收后重启 | 100 次循环 0 crash/0 ANR；用户状态和当前会话正确恢复 |

### M05 Native、ABI 与 OEM 兼容（5 项）

| 编号 | 功能点/实现 | 测试方法 | 验收标准 |
|---|---|---|---|
| M05-F01 | ELF/ABI 静态审计 | `readelf`/APK Analyzer 检查 ABI、依赖、alignment、可执行栈 | 无错误 ABI、缺失依赖、text relocation、可执行栈；16 KB page-size 检查通过 |
| M05-F02 | Android API 矩阵 | API 26、30、33、35、36 模拟器执行安装/登录/恢复 | 全部 0 crash/0 ANR，权限和后台限制行为符合预期 |
| M05-F03 | OEM 真机矩阵 | 问题同型号/同系统优先，再覆盖华为/荣耀、三星、小米、OPPO/vivo 的可用设备 | 问题设备连续 20 次登录无弹窗；其他每设备至少 10 次无异常 |
| M05-F04 | Debug Full Runtime OEM 验证 | 在支持的 arm64 真机执行 bind/health/tool/kill-rebind | Full Runtime 可用设备通过；不兼容设备明确 No-Go，不得静默进入 Stable |
| M05-F05 | 疑似加固指纹门禁 | 扫描常见壳 loader/lib/application 替换和 DEX 异常熵；准备带测试指纹的负向夹具 | 官方包 0 未声明命中；负向夹具能稳定阻断流水线 |

### M06 故障隔离、诊断与用户体验（5 项）

| 编号 | 功能点/实现 | 测试方法 | 验收标准 |
|---|---|---|---|
| M06-F01 | 模块级超时与错误边界 | 模型 503、Relay 断网、DB 慢、Runtime bind 失败注入 | 错误只影响对应模块；主进程不退出，用户可重试/退出登录 |
| M06-F02 | 结构化启动诊断 | 验证阶段、耗时、结果、build/runtime distribution 事件 | 可还原登录后时间线；不记录 Token、authorization code、用户正文 |
| M06-F03 | 系统退出原因导出 | 制造 Java crash、ANR、native crash 测试包 | 重启后能导出脱敏退出原因和时间，不自动上传 |
| M06-F04 | 可理解错误文案 | 错误码快照/UI 测试 | 区分登录、模型、网络、Runtime、系统兼容；不把自定义供应商统一称为 HAI |
| M06-F05 | 个人中心版本与分发信息 | Compose/UIAutomator 测试 | 显示 1.5.6/10506、Stable/Beta/Debug、Full/Compatibility、签名短摘要和诊断入口 |

### M07 升级、数据与回滚（5 项）

| 编号 | 功能点/实现 | 测试方法 | 验收标准 |
|---|---|---|---|
| M07-F01 | v1.5.5→v1.5.6 同签名覆盖升级 | 保留 app data 安装 10506 | 安装成功且无需卸载；包签名链一致 |
| M07-F02 | 登录与 Token 数据迁移 | 升级前登录，升级后冷启动和 refresh | 无需重新登录；Token 校验/刷新正常，失败时安全回登录页 |
| M07-F03 | Room/OAEP/业务数据迁移 | 升级前构造会话、Run、Approval、Artifact、Memory | 数量、ID、digest 一致；迁移失败不 destructive fallback |
| M07-F04 | SAF 与权限恢复 | 升级前授权工作区并读写测试文件 | persistable URI 权限可继续使用；撤销后 fail closed |
| M07-F05 | 发布回滚方案 | 演练停止渠道、恢复上一清单、v1.5.6 紧急禁用和数据兼容 | 不覆盖不可变资产；已升级用户数据可由后续修复包继续读取 |

### M08 自动化测试矩阵与质量门禁（5 项）

| 编号 | 功能点/实现 | 测试方法 | 验收标准 |
|---|---|---|---|
| M08-F01 | JVM/单元契约 | Auth、bootstrap、variant、签名、错误映射、迁移测试 | 全量通过，0 flaky，新增路径有正负用例 |
| M08-F02 | Instrumentation 登录 E2E | Mock OIDC + 真实 Activity callback + workspace hydration | 首登、重复回调、旋转、恢复、退出/换号全部通过 |
| M08-F03 | R8 Release E2E | 对最终 minified APK 安装、登录、主界面和基本对话 | 只验最终 APK，不以 Debug 结果代替；0 missing class/反射错误 |
| M08-F04 | 稳定性压力 | 每目标真机 100 次冷启动、20 次登录、20 次前后台、10 次系统回收恢复 | 0 crash、0 ANR、0 OEM 异常弹窗、0 永久 loading |
| M08-F05 | 性能与资源 | 测冷启动、登录后可交互、PSS、CPU、网络和安装体积 | 相对 v1.5.5 无不可解释回退；阈值在证据报告中固化并自动判定 |

### M09 发布、灰度与最终验收（5 项）

| 编号 | 功能点/实现 | 测试方法 | 验收标准 |
|---|---|---|---|
| M09-F01 | 候选物冻结 | 测试开始后禁止重建，所有测试引用同一 APK SHA-256 | 候选 hash 唯一；任何变化必须重开完整验收 |
| M09-F02 | 发布前在线同一性 | 上传不可变路径后重新下载并全量校验 | 大小、hash、签名、ZIP entry、manifest 与候选完全一致 |
| M09-F03 | 小流量灰度 | 5%→25%→100%，每阶段观察 crash/ANR/登录成功/OEM 弹窗 | 每阶段满足阈值且人工批准后才能推进；异常自动暂停 |
| M09-F04 | v1.5.5 用户强制修复策略 | 验证 10505 收到 10506 清单、下载、签名校验和安装 | 只在 10506 全门禁通过后标 mandatory；升级链真实可用 |
| M09-F05 | 最终 Go/No-Go | 汇总本文 47 项、关联 Full Runtime 方案状态和未决风险 | 47/47 且问题机通过才允许 Stable；Debug Full 未完成不得被误报为 Stable Full |

## 8. 分阶段执行计划

### P0：事故控制（当天）

1. 冻结 v1.5.5 新一轮 Stable 推广和任何仓库外加固/重签；
2. 保存 CDN/GitHub/CI/问题机四方产物和清单，不覆盖已有文件；
3. 取得问题设备异常记录、系统版本、安装来源和可复现步骤；
4. 若仍在大规模分发 v1.5.5，先暂停“推荐升级”，但不在没有替代版本时实施破坏性远程操作。

出口：M01-F01～F04 完成，明确线上实际发布物。

### P1：最小对照与根因确认（1～2 天）

1. 从 v1.5.5 source snapshot 构建同签名复现包；
2. 构建移除 Chaquopy/Python 的最小对照包；
3. 构建保留 Python但升级依赖/修正 ELF 的对照包；
4. 在问题设备执行安装→登录→回调→进入主界面；
5. 用异常记录和 A/B 结果选择最终实现，不凭包体大小推断。

出口：M01 5/5，形成根因报告。

### P2：v1.5.6 工程修复（2～4 天）

1. 完成 Runtime variant 物理隔离；
2. 完成登录后 bootstrap 状态机与错误边界；
3. 完成签名、二进制、加固指纹和发布物同一性门禁；
4. 增加个人中心版本/分发诊断；
5. 保持 Debug Full Runtime 既定路径不回退。

出口：M02～M06 自动化通过。

### P3：升级与真机验收（2～3 天）

1. v1.5.5→v1.5.6 同签名保数据升级；
2. API 与 OEM 矩阵；
3. 问题设备 20 次登录、100 次冷启动/恢复压力；
4. R8 最终 APK 全链路验收；
5. 冻结唯一 RC hash。

出口：M07～M08 全通过，问题设备 0 异常。

### P4：发布与灰度（需单独发布授权）

1. 上传不可变版本路径；
2. 线上重新下载校验；
3. 依次 5%、25%、100% 灰度；
4. 全量后继续观察 24～48 小时；
5. 完成事故复盘和永久回归用例。

出口：M09 5/5，47/47 正式验收。

## 9. 最终测试矩阵

| 维度 | 最低覆盖 |
|---|---|
| 安装状态 | 全新安装、v1.5.5 覆盖升级、已有登录态、未登录、Token 即将过期 |
| 登录生命周期 | 首登、取消、失败重试、重复回调、旋转、后台返回、进程重建、退出再登录、换账号 |
| 系统 | API 26、30、33、35、36；问题设备实际系统构建号必须单列 |
| CPU/内存架构 | arm64-v8a；x86_64 只作为模拟器测试，不进入 Stable |
| OEM | 问题同型号、华为/荣耀、三星、小米、OPPO/vivo（以实际可用设备记录） |
| 网络 | 正常、弱网、断网、DNS 失败、OIDC/Model/Relay 401/429/5xx/超时 |
| 构建 | Debug、Acceptance、MVP/R8、Release/R8；最终验收只认待发布 R8 APK |
| Runtime | Debug/Acceptance Full Runtime 存在且 READY；MVP/Release 兼容包无 Python 二进制与进程 |
| 发布源 | CI artifact、CDN、GitHub、设备安装包四方一致 |

## 10. 硬性 Go/No-Go

出现以下任一情况即 No-Go：

- 未取得问题设备异常记录，且无法通过 A/B 包证明根因；
- 线上 v1.5.5 与留存/CI 产物 hash 或签名不一致但原因未查明；
- Stable/Beta 使用 Debug 证书，或缺失正式证书仍能执行 publish；
- `mvp` / `release` 仍含未启用的 Chaquopy/Python 资产、native 库或 `PythonRuntimeService`；
- 问题设备出现一次相同 OEM 运行异常；
- 最终测试 APK 与实际上传 APK 不是同一 SHA-256；
- v1.5.5→v1.5.6 需要卸载、丢登录或丢业务数据；
- R8 最终包未执行真实登录回归；
- 47 项有任何一项未通过、无证据或仅以人工口头确认代替。

## 11. 验收证据清单

最终至少产出：

- `v1.5.5-incident-device.json`
- `v1.5.5-oem-abnormal-record.txt`（脱敏）
- `v1.5.5-artifact-identity-comparison.json`
- `v1.5.5-root-cause-report.md`
- `v1.5.6-runtime-distribution-audit.json`
- `v1.5.6-signing-and-provenance.json`
- `v1.5.6-login-bootstrap-e2e.json`
- `v1.5.6-oem-device-matrix.json`
- `v1.5.6-upgrade-v1.5.5.json`
- `v1.5.6-stability-performance.json`
- `v1.5.6-online-artifact-verification.json`
- `v1.5.6-stable-go-no-go.md`

所有证据必须关联同一 RC APK SHA-256；重新构建后旧证据自动失效。

## 12. 进度计算与汇报规则

- 总功能点：47；
- 完成百分比：`已通过并有证据的功能点 / 47 × 100%`；
- “代码已写”“本机单测通过”“问题不可复现”均不能单独计为完成；
- 每轮汇报格式：`轮次 / 本轮通过项 / 累计通过项 / 百分比 / 当前阻塞 / 下一轮目标`；
- 本文建立时为 **0/47（0%）**；现有仓库证据只作为问题基线，不能替代修复版本验收。
