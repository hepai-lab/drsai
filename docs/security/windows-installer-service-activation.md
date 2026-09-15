# Windows Installer Service Activation

## 修复的状态矛盾

真实 SCM service 不能同时是 `disabled` 和 catalog 要求的最终 `automatic`。此前 installer journal 在 package verification/commit/bootstrap issue 时要求 disabled，但 installation verifier 同时要求 automatic，导致正式安装 E2E 在逻辑上不可实现。

现在明确拆为两个不同的 verified phase：

1. `installer_safe`：文件、ACL、binary、account、service SID/type 等全部验证，但 SCM start type 必须是 disabled；仅此 phase 可进入 journal 的 package-verified、commit 和 bootstrap issue。
2. `final`：installer 已发布 service-only bootstrap envelope，再把 SCM start type 改为 catalog pin；Runtime 启动前重新运行完整 installation verifier，SCM 必须是最终 automatic/manual 配置。

metadata 和 catalog 始终保存产品期望的最终 start type；installer-safe mode 只改变本次 OS evidence 的预期值，不能重定义签名配置。

## 启动门禁

`WindowsInstallerServiceActivationController` 的顺序固定为：

`installer_safe verification → journal commit/issue → protected envelope publish → SCM final config → final installation reverify → SCM start`

finalize 要求：

- published-envelope receipt 与 authorization、operation、catalog/build/metadata/root/service/SID/expiry 完全一致；
- envelope path 是 canonical absolute path；
- journal 回查 authorization 仍为 `issued` 且 TTL 未到期；
- 输入 installation phase 为 `installer_safe`，实际 SCM start type 为 disabled；
- 修改后再次读取 SCM，binary 以外的全部 final identity 与 catalog 一致；binary 会在后续完整 final verifier 中再次绑定到 pinned artifact。

start 要求：

- 输入必须是重新验证得到的 `final` installation；
- 当前 SCM evidence 必须与 final verifier evidence 逐字段相等，防止 verify/start 间配置漂移；
- authorization 必须仍 issued 且未过期；
- `StartServiceW` 后必须在有界时间内证明 running 且 PID 大于零。

SCM final config 不匹配、verify/start 间 drift、start 异常或 running proof 不成立时，native adapter 调用既有 safety controller 将 service disable+stop，并要求 stopped/PID=0 证据。无法证明回到安全态时返回独立 rollback-unproven 错误，不把失败启动当作成功。

## Native API 范围

Native adapter 只暴露两种正向 SCM 变更：将已存在的 pinned service 改为 catalog start type，以及启动该已存在 service。它不创建任意服务、不接受命令行参数、不改变 binary/account/SID，并使用 `NativeWindowsServiceConfigurationApi` 回读最终事实。

前置 CreateService/disabled registration 和失败恢复由 [Windows Installer SCM Actions](windows-installer-scm-actions.md) 承担；activation controller 只处理已经 commit 的 owned service 从 disabled finalization 到启动。

本机原生测试只尝试打开随机不存在的 service，确认 adapter fail closed；没有创建、修改、停止或启动任何真实 Windows 服务。正式 CreateService/register/rollback 仍属于后续 installer action adapter。
