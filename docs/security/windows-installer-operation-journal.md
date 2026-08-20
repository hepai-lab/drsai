# Windows Installer Operation Journal

## 安全目标

`WindowsInstallerOperationJournal` 将 install、upgrade、repair、rollback 和 uninstall 变成持久安全状态机。它的首要目标不是自动完成安装，而是保证任何异常、中断或并发都不会提前启动未经完整验证的 Runtime service，也不会开启 observability pipe。

该模块属于特权 installer/recovery host，不接受 Agent、Workspace、Gateway、Electron、TUI、WebUI 或模型输出作为 authority。

## 状态顺序

正常操作严格按以下顺序：

1. `safe_disabled`：SCM service 已 disabled、stopped，process ID 为零；尚未注册的全新 service 也视为安全；
2. `artifacts_staged`：记录完整 staged artifact-set SHA-256；
3. `service_registered`：service 已注册，但再次证明 disabled/stopped/no-process；
4. `package_verified`：signed key policy、catalog、metadata、release pins、ACL、SCM 和全部 artifact identity 已联合验证；
5. `committed`：在 service 仍 disabled/stopped 的条件下提交安装事实；
6. installer 可签发一次性、短 TTL bootstrap authorization。

顺序不能跳过。特别是必须先把 service 注册为 disabled/stopped，才能由 installation verifier 读取真实 SCM 配置；不能在注册前声称 package/SCM 已验证。

installation verification 现区分 `installer_safe` 和 `final` 两个 phase。journal 的 package verification、commit 和 authorization issue 只接受实际 SCM 为 disabled 的 `installer_safe` evidence；envelope 发布后由受控 activation adapter 写入 catalog 最终 start type，随后必须重新执行完整 `final` verification 才能启动。这样不再要求一个真实 service 同时为 disabled 和 automatic。详见 [Windows Installer Service Activation](windows-installer-service-activation.md)。

## Native SCM safety controller

`NativeWindowsInstallerSafetyController` 通过 Advapi32 执行 installer 唯一允许的安全方向变更：

- service 不存在时返回 `registered=false, disabled=true, stopped=true`；
- service 已存在时先把 start type 设置为 disabled；
- 请求 STOP，并在有界 deadline 内轮询 `QueryServiceStatusEx`；
- 只有 `SERVICE_STOPPED` 且 process ID 为零才返回安全 evidence；
- access denied、配置不可读、disable/stop/timeout 均 fail closed。

Controller 会在写入 disabled 前返回原 start type，并由 installer operation 持久化 `prior_service_registered/prior_service_start_type`。升级 rollback 因此不会把临时 disabled 当成旧产品配置。CreateService、配置 snapshot、operation marker、owned delete 和 exact restore 由 [Windows Installer SCM Actions](windows-installer-scm-actions.md) 实现。

该 controller 不负责启用或启动 service。测试只对随机不存在的 service name 调用原生适配器，从未 disable/stop Windows 系统服务。

## 崩溃恢复与回滚

所有非终态 operation 会在 startup recovery 中先重新执行 `ensure_disabled_and_stopped()`，再进入 rollback callback。rollback reason 只能是低基数 code。

SQLite writer transaction 会覆盖整个 privileged rollback callback，以防两个 installer/recovery 进程同时执行同一回滚。进程在 callback 中崩溃时事务回滚到原阶段，下一次 startup recovery 重试；因此 callback 必须按 catalog/operation identity 设计为幂等。回滚异常提交为 `rollback_failed`，service 仍保持 disabled/stopped，下一次恢复可以重试。

operation 当前状态可以更新，但每次状态转换另写 append-only installer event，并写统一安全哈希链。事件表禁止 update/delete。

真实文件副作用由 [Windows Installer Filesystem Actions](windows-installer-filesystem-actions.md) 承担：signed artifact inventory 先复制到同卷 staging，旧 install root 原子进入 quarantine，新 staging 再原子提升；每个目录都用持久 volume/file identity 和 pinned trusted-writer/service ACL policy 绑定。该 action journal 可作为 installer rollback callback，并与 installer operation 共用同一 SQLite writer transaction，避免嵌套 writer 死锁和双状态部分提交。

## Bootstrap authorization

`committed` 并不自动启用 service。只有精确匹配 operation 中 catalog/build/metadata/root/service identity 的 frozen verified objects 才能签发 bootstrap authorization：

- 使用 256-bit 随机 token；SQLite 只保存 SHA-256，不保存 token 明文；
- authorization 有短 TTL、每个 operation 至多签发一次、只能消费一次；
- token、catalog、metadata、service 或 operation 任一替换均拒绝；
- 新 install/upgrade/repair operation 开始时，在同一事务撤销该安装根所有旧 issued token；
- 只有该安装根最新 operation 可以签发 authorization，旧 committed operation 不能在新升级期间复活旧 service。

service 消费 token 后得到不含秘密的 `ConsumedWindowsServiceBootstrapReceipt`。Receipt 不能仅凭 dataclass 形状获得权限：Runtime factory 会回查同一 SQLite 中 authorization、operation、latest-root、catalog/build/metadata/service identity、consumed-at 和 expiry，并原子执行 `consumed → activated`。伪造、过期、已激活或被升级 supersede 的 receipt 均拒绝。

`SecurityObservabilityRuntimeFactory` 的所有 enabled 入口现在遵循三层门禁：

1. 直接 `HostSecurityObservabilityConfig(pipe_enabled=true)` 构造 factory 在任何数据库或 policy 副作用前拒绝；
2. `from_verified_deployment()` 只允许 disabled deployment；enabled deployment 必须调用 `from_verified_service_bootstrap()`；
3. 后者先 claim durable consumed receipt，并再次绑定 install root、Runtime build 和 service SID。每个 factory 实例只允许一次 `build()`，失败后不能重试或复用 authority。

新 installer operation 会把旧 authorization 的 `issued`、`consumed` 或 `activated` 状态统一改为 revoked；begin 前先由 SCM controller 停止旧 service。因此旧 receipt 即使仍在进程内也不能为升级中的旧 package 重建 host pipe。

authorization 已接入 `WindowsServiceBootstrapEnvelopeChannel`：installer 将其写入 machine-DPAPI 加密、SYSTEM/Admin/精确 service SID ACL 保护的 envelope；service 解密并消费后删除密文，再由 Runtime claim receipt。`from_verified_service_envelope()` 可直接完成这条 enabled factory 启动链，Electron/Gateway 环境变量和客户端协议均不携带 token 或 receipt。详细约束见 [Windows Service Bootstrap Envelope](windows-service-bootstrap-envelope.md)。

## 尚缺正式验收

- installer 对 staging/rename/service-register/uninstall 的真实幂等 rollback implementation；
- 管理员安装 runner 中逐阶段进程 kill、断电和 SQLite FULL/IOERR/CORRUPT；
- Program Files install/upgrade/repair/rollback/uninstall；
- 正式 installer/OpenDrSai service 对 service-only bootstrap envelope 的产品接线；
- elevated installer runner 中 SYSTEM owner/service SID ACL 与非管理员攻击账户 E2E；
- Authenticode/package catalog chain、HSM key 和非管理员攻击账户 E2E。
