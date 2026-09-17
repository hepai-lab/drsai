# Security Observability 离线发布工具

## 目的与信任边界

`drsai-security-observability-release` 用于发布环境离线生成和验证 Approval SLO policy、security observability deployment manifest 及 Runtime build pins。它不是 Runtime 启动配置接口，也不得由 Electron、Gateway、Workspace、Agent 或客户端调用来临时开启观测 pipe。

信任链如下：

1. SLO 私钥签署阈值 policy；
2. 工具根据 policy canonical payload 计算摘要，自动写入 deployment，调用者不能手填该摘要；
3. release 私钥签署绑定 product、channel、Runtime build、service SID、pipe identity 和 policy identity 的 deployment；
4. 工具输出 `security-observability-release-pins.json`，供后续受签名 package catalog/build metadata 固化 minimum version、摘要、key ID 和 public-key digest；
5. 最终 Runtime build 仍须由产品发布签名保护。pins 文件本身不是新的在线信任根。

两个 Ed25519 私钥只以 PEM 文件路径传给离线 `build` 命令。工具不会把私钥写入 bundle、pins、日志或命令输出。正式流水线应使用受保护的签名 runner/HSM，并在签名后销毁临时私钥材料。

## 输入和输出

输入必须严格符合 `security-observability-release-input/1`。顶层字段为：

- `manifest_filename`、`slo_policy_filename`：安装根目录内的 JSON basename；
- `release_key_id`、`slo_policy_key_id`：已登记的发布 key identity；
- `policy_payload`：完整 `approval-security-slo-policy/1` payload；
- `deployment_payload`：manifest identity/version、product/channel、Runtime build digest、启用状态、service/pipe identity 和有效期。

工具派生以下 deployment 字段，输入不得提供或覆盖：

- `slo_policy_id`
- `slo_policy_digest`
- `slo_policy_key_id`
- `slo_policy_minimum_version`

输出目录必须是新建或空的可信发布 staging 目录。三个输出文件均使用 create-new 语义，已有文件绝不覆盖：

- 签名 SLO policy；
- 签名 deployment manifest；
- `security-observability-release-pins.json`。

pins 同时记录两类不可互换的摘要：`manifest_digest`/`slo_policy_digest` 是 canonical payload identity，用于策略和版本绑定；`manifest_file_digest`/`slo_policy_file_digest` 是包含 key ID、签名和结尾换行的完整磁盘文件 SHA-256，用于 installer artifact 完整性校验。

构建结束前，工具会用生产 `SignedSecurityObservabilityDeploymentLoader` 和 `SignedApprovalSloPolicyLoader` 联合验证三个工件。验证失败会删除本次创建的半成品。

## 命令

```powershell
drsai-security-observability-release build `
  --input release-input.json `
  --output-root staging/security-observability-v5 `
  --release-private-key release-ed25519-private.pem `
  --slo-private-key slo-ed25519-private.pem
```

在隔离的发布验证步骤中使用对应公钥联合校验：

```powershell
drsai-security-observability-release verify `
  --bundle-root staging/security-observability-v5 `
  --pins staging/security-observability-v5/security-observability-release-pins.json `
  --release-public-key release-ed25519-public.pem `
  --slo-public-key slo-ed25519-public.pem `
  --now 1786838400
```

`--now` 必须来自发布流水线的受控时间输入，以便构建可重放。verify 同时检查签名、key digest、product/channel/build pins、manifest minimum version、policy ID/version/digest 和有效期。`runtime_build_digest` 必须使用发布系统定义的稳定 build identity（例如 Authenticode 规则下排除签名区的 image digest），而 pins/installer metadata 应进入随后签名的 package catalog/build metadata；不得通过“把最终文件 SHA 写回同一个待计算 SHA 的文件”形成循环 pin。仅验证成功不代表可以启用 transport；还必须通过 Windows installer/service identity、安装目录 owner/DACL、正式内置公钥和运维演练门禁。

## 禁止事项

- 不得把 pins、manifest 或 key path 从 `DRSAI_HOME`、Workspace、Gateway request 或 Electron 继承环境变量传入 production bootstrap；
- 不得把 `security-observability-release-pins.json` 当作自签名信任根；它必须固化进随后签名的 package catalog/build metadata；
- 不得复用 SLO key 签 deployment，也不得把私钥打包进应用；
- 不得在验证失败时降级为 Desktop 当前用户 SID、随机 pipe 或未签名 policy；
- 不得覆盖旧版本工件。版本升级必须创建新 staging 目录并保留可审计的发布证据。
