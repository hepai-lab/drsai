# Windows Security Installation Verifier

## 作用

`WindowsSecurityInstallationVerifier` 是 Windows 安装完成后的只读安全门禁。它把已验证的 observability deployment、release pins、isolated worker identity 与安装目录中的实际文件和 ACL 证据重新关联。在 verifier 成功前，Windows service bootstrap 和 host metrics pipe 必须保持关闭。即使 verifier 成功，enabled factory 仍要求 installer journal 的一次性 bootstrap receipt；verified installation 本身不授予启动权限。

它不修改 ACL、不授予权限，也不接受 Agent、Workspace、Electron、Gateway 或客户端传入的信任配置。

## 固定输入

以下值必须来自已通过 `windows-security-package-catalog/1` Ed25519 验证和持久防回滚的 catalog，而不是安装目录内的自声明文件：

- installation metadata canonical digest、metadata ID 和 minimum version；
- product、channel 和稳定 Runtime build identity；
- Windows service name、service SID、启动账户、启动类型、SID type 和 delayed-auto 策略；
- installer trusted-writer SID allowlist；
- release key/SLO key 和 worker publisher 的上游 pins。

service SID 不得出现在 trusted-writer allowlist。Runtime service 可以读取/执行安装工件，但不能修改自身 policy、manifest、worker 或 installation metadata。

生产调用使用 `WindowsSecurityInstallationVerifier.from_verified_catalog()`。catalog 和 release-pins 文件自身也进入 owner/DACL/reparse 检查；磁盘 pins 会重新解析并与 Runtime 调用链中的 frozen pins 对象逐字段比较。

## Installation metadata

`windows-security-installation/1` 精确包含：

- metadata ID/version；
- product/channel/Runtime build identity；
- service name/service SID；
- 五项无重复 artifact inventory：签名 deployment manifest、签名 SLO policy、isolated worker manifest/executable、Runtime service executable。

deployment/policy inventory 使用 release pins 中的完整文件 SHA-256，而不是 canonical payload digest。worker manifest 使用磁盘文件 SHA-256，worker executable 使用已通过 manifest pin 和 Authenticode 验证的 executable digest。Runtime service executable 的完整文件 SHA-256 必须等于 deployment 和 verifier 同时 pin 的 `runtime_build_digest`。

## ACL 判定

verifier 检查 install root、installation metadata 和全部 inventory 文件：

- 对象必须存在，且只能是预期的普通目录或普通文件；
- unresolved path 和最终对象都不能是 symlink、junction 或其他 reparse point；
- owner SID 必须属于固化的 installer writer allowlist；
- null DACL 一律拒绝；
- DACL 中任何具有写内容、创建子项、删除、修改 DACL、取得 owner、Generic Write 或 Generic All 的 Allow ACE，只能属于固化 writer allowlist；
- service SID 即使被误配到可写 ACE，也必须单独拒绝；
- 无法解释的 ACE 类型 fail closed；
- 摘要计算前后检查 device/file identity、size 和 mtime，检测验证期间的对象替换。

## SCM 判定

`NativeWindowsServiceConfigurationApi` 只使用 `OpenSCManager`、`OpenService`、`QueryServiceConfig` 和 `QueryServiceConfig2` 读取现有注册，不创建、启动、停止或修改服务。verifier 要求：

- SCM service name 与 package pin 完全一致，并能解析出预期 `NT SERVICE\\<name>` SID；
- service type 必须是独占 `SERVICE_WIN32_OWN_PROCESS`，不能共享宿主进程；
- `SERVICE_SID_TYPE_UNRESTRICTED` 必须开启；
- start account、automatic/manual/disabled 类型和 delayed-auto 状态必须与 package metadata 一致；
- binary command 必须是一个绝对 executable path，不接受参数、环境变量展开、相对路径或多重引号；
- 解析后的 binary path 必须精确等于 inventory 中已通过摘要和 ACL 验证的 Runtime service executable。

允许继承的只读/执行 ACE；不要求所有 DACL 都 protected，因为 Program Files 的安全继承是正常部署形态。判断依据是最终有效 DACL 中是否出现非可信写者，而不是简单检查 protected 标志。

## 仍未覆盖的发布门禁

当前已能查询通用 Windows SCM，并在本机读取既有 `EventLog` 服务作为原生 API 证据；但仓库尚无正式安装的 OpenDrSai service。正式启用前还必须增加并验收：

- 正式 OpenDrSai service 的创建、启动、停止、崩溃恢复和卸载 E2E；
- service executable 和 installation metadata 的 Authenticode/package catalog 身份；
- Program Files 安装器在非管理员账户下的实际不可写测试；
- 安装、升级、回滚、修复和卸载矩阵；
- 正式 release/SLO key rotation 和吊销流程。
