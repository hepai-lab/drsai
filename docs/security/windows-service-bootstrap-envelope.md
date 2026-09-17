# Windows Service Bootstrap Envelope

## 安全目标

该通道把 installer journal 签发的一次性 bootstrap authorization 交付给正式 Windows service，且不经过环境变量、命令行、Desktop/Gateway、Agent Core、TUI、WebUI 或客户端协议。

它解决的是“秘密如何到达正确服务进程”，不是替代 package catalog、installation verifier 或 journal。三者仍须全部通过。

## 实现边界

`WindowsServiceBootstrapEnvelopeChannel` 强制以下组合：

1. authorization 连同 catalog、installation、Runtime build、install root 和 service SID 绑定为 canonical JSON；
2. 使用 DPAPI `CRYPTPROTECT_LOCAL_MACHINE` 加密，并以 schema + service SID 作为额外 entropy；
3. 密文只能写入由 installer 创建的受保护目录；目录与文件 owner 必须是 SYSTEM；
4. 目录和文件 DACL 必须 protected，且只能有 SYSTEM、Builtin Administrators、精确 service SID 三个 full-control allow ACE；
5. 文件通过 `CREATE_NEW`、无共享写入、flush 和 write-through rename 发布；已有 envelope 时拒绝覆盖；
6. 每次读取和删除前重新检查 owner、DACL、ACE 类型、权限和继承标志；reparse directory 拒绝；
7. 密文、明文 JSON 和 authorization 均有 64 KiB 上限与严格字段集合；未知字段、错误类型、错误 entropy、损坏 Base64/DPAPI 全部拒绝。

DPAPI machine scope 本身不区分同机进程，因此它不能单独构成 service identity 边界；真正的进程访问控制来自 service SID ACL。DPAPI 用于抵抗离线复制、明文泄露和误存储，ACL 用于限制在线读取和删除。

## 消费与崩溃语义

固定顺序为：

`ACL 验证 → 读取 → DPAPI 解密 → identity 验证 → journal issued→consumed → 删除密文 → Runtime consumed→activated`

- journal consume 前崩溃：密文仍在，authorization 仍是 `issued`，服务可在 TTL 内安全重试；
- journal consume 后、删除前崩溃：authorization 已是 `consumed`，不能再次取得 receipt；重启时仅在 token 和全部 installation identity 仍精确匹配时删除残留密文，并返回 `windows_bootstrap_envelope_replay_cleaned`；
- 删除后、Runtime claim 前崩溃：秘密已消失、authorization 保持 `consumed`，为避免重发 receipt，必须通过新的 installer operation 恢复，默认不可用；
- Runtime claim 后崩溃：authorization 已是 `activated`，同一 envelope/factory 不能再次启用 transport；
- 删除失败会显式返回 cleanup failure，不会回滚已经 durable 的 consume，也不会重新签发秘密。

这种选择优先保证不可重放。它可能在极窄崩溃窗口造成需要 repair 的可用性损失，但不会为了自动恢复而让 receipt 可重复派生。

## Runtime 接入

installer 的 SCM 顺序由 `WindowsInstallerServiceActivationController` 约束：只有 journal token 仍 issued、envelope 已成功发布时才能把 disabled service 改为 catalog 最终配置；完整 final installation reverify 后才允许 start。详见 [Windows Installer Service Activation](windows-installer-service-activation.md)。

`SecurityObservabilityRuntimeFactory.from_verified_service_envelope()` 是 enabled deployment 的 Runtime 入口：

1. 由 channel 消费受保护 envelope；
2. journal 生成无秘密 receipt；
3. factory 立即回查数据库并原子 claim receipt；
4. 仍需通过 deployment、signed SLO policy 和 native named-pipe backend identity 门禁；
5. factory 实例仅允许一次 build。

测试依赖可以注入 protector/file API；生产默认始终使用 native machine-DPAPI 和 service-only ACL adapter。

## 当前验收状态

已覆盖：明文 token 不落 envelope、错 service SID、密文篡改、严格 schema、单次消费、DB claim、删除失败、崩溃残留清理、factory 端到端启用，以及 Windows machine-DPAPI 原生往返。

当前测试进程不是 elevated installer，不能创建 owner=SYSTEM 的目录，因此 native SYSTEM/service-only DACL 创建与非管理员攻击账户读取拒绝仍须在管理员安装 runner 验收。正式 installer/service 尚未接入该 channel，不能据此宣称 P0/P1/P2 完全验收。
