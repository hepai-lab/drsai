# OpenDrSai 移动远程工作区 P5 推送部署与验收清单

## 1. 安全边界

推送只携带 Runtime、Workspace、Session、Event、Item 等不透明标识和固定事件类型。消息正文、命令参数、文件路径与 reasoning 不得进入推送载荷、日志、指标或验收证据。Android 收到通知后，必须在前台重新通过 OIDC、设备证明和 association 授权读取正文。

## 2. Android 构建配置

构建 1.5.6 及以上非调试包前，通过 Gradle property 或同名环境变量提供：

| 环境变量 | 格式 |
|---|---|
| `OPENDRSAI_ANDROID_FIREBASE_API_KEY` | Firebase Android App 的 API key |
| `OPENDRSAI_ANDROID_FIREBASE_APPLICATION_ID` | `数字:数字:android:十六进制标识` |
| `OPENDRSAI_ANDROID_FIREBASE_PROJECT_ID` | Firebase project ID |
| `OPENDRSAI_ANDROID_FIREBASE_SENDER_ID` | 纯数字 sender ID |

这些值不写入仓库。执行：

```powershell
python scripts/remote_workspace.py accept push-preflight android
```

`release` 与 `mvp` 变体的 `preBuild` 会再次执行等价的一致性门禁：API key、application ID、project ID、sender ID 任一缺失、格式错误，或 application ID 内的 sender 与独立 sender ID 不一致，构建均以固定错误码失败。`debug` 与 `acceptance` 可保留空配置，用于验证“推送未配置”的产品提示，但不能作为 M04-F01/F02 的发布验收包。

### 2.1 Android 四项配置从哪里来

它们来自同一个 Firebase Android App，而不是 OpenDrSai 自行生成：

1. 在 [Firebase Console](https://console.firebase.google.com/) 创建或选择项目，并为发布包的准确 Android package name 注册 Android App。
2. 下载该 App 的 `google-services.json`。按照 Firebase 官方 [Android 设置文档](https://firebase.google.com/docs/android/setup)，从匹配 package name 的 `client` 读取：
   - `project_info.project_id` → `OPENDRSAI_ANDROID_FIREBASE_PROJECT_ID`
   - `project_info.project_number` → `OPENDRSAI_ANDROID_FIREBASE_SENDER_ID`
   - `client_info.mobilesdk_app_id` → `OPENDRSAI_ANDROID_FIREBASE_APPLICATION_ID`
   - `api_key[].current_key` → `OPENDRSAI_ANDROID_FIREBASE_API_KEY`
3. 这四项是 Firebase 项目/App 标识，不是服务账号私钥；仍应由构建系统注入，避免把开发、测试和发布项目混用。

## 3. HAI Runtime Relay 配置

| 环境变量 | 格式与语义 |
|---|---|
| `HAI_RUNTIME_RELAY_FCM_PROJECT_ID` | 启用 Firebase Cloud Messaging API 的 Google Cloud project ID |
| `GOOGLE_APPLICATION_CREDENTIALS` | 仅服务进程可读的 service-account JSON 文件路径；也可由运行环境提供标准 ADC，但发布门禁应证明实际身份可用 |
| `HAI_RUNTIME_RELAY_PUSH_TOKEN_KEYS` | JSON object：`key_id -> base64url(32-byte AES key)`，作为 secret 注入 |
| `HAI_RUNTIME_RELAY_PUSH_TOKEN_ACTIVE_KEY_ID` | 当前写入密钥 ID，必须存在于 keyring；轮换时保留旧 key 供解密历史密文 |

在服务进程实际环境中执行：

```bash
python scripts/preflight_remote_workspace_push.py relay
pm2 restart run_hai_backend --update-env
```

不得在命令输出、任务消息或证据 JSON 中打印 service-account、keyring、FCM token 或其可逆编码。

### 3.1 Relay 四项配置的权威来源

| 配置 | 权威来源与负责人 |
|---|---|
| `HAI_RUNTIME_RELAY_FCM_PROJECT_ID` | 与 Android App 相同的 Firebase/Google Cloud project ID；由 Firebase 项目管理员提供，并在该项目启用 FCM HTTP v1 API。 |
| ADC | Google Cloud 上优先使用绑定到运行工作负载的 service account / Workload Identity；非 Google Cloud 的 ai-dev 主机由平台管理员创建最小权限 service account，将 JSON 安全下发到主机并仅通过 `GOOGLE_APPLICATION_CREDENTIALS` 指向它。参见 [FCM HTTP v1 授权](https://firebase.google.com/docs/cloud-messaging/send/v1-api) 与 [ADC 配置](https://cloud.google.com/docs/authentication/provide-credentials-adc)。不得把 JSON 放入仓库或任务消息。 |
| `HAI_RUNTIME_RELAY_PUSH_TOKEN_KEYS` | 不是 Firebase 提供；由 OpenDrSai/HAI 运维使用密码学安全随机源生成。每个值必须是独立的 32-byte AES-256 key 的 base64url 表示，保存于 Secret Manager 或等价受控 secret store。 |
| `HAI_RUNTIME_RELAY_PUSH_TOKEN_ACTIVE_KEY_ID` | 不是一把新密钥，而是 keyring 中当前用于新写入的 key ID，由 OpenDrSai/HAI 运维选择。轮换时先加入新 key，再切 active ID；旧 key 保留到历史密文全部迁移或过期后才删除。 |

密钥生成、注入和轮换必须在目标 secret store 内完成，命令输出不得回显明文。Firebase Console 管理 Firebase 项目和 Android App；Google Cloud IAM 管理发送身份；OpenDrSai/HAI 运维管理 token 加密 keyring，三者不能混为一类凭据。

## 4. 公网 readiness

精确路径：

```text
GET https://ai-dev.ihep.ac.cn/api/runtime-relay/v2/push/readiness
```

允许公开的字段只有：

```json
{
  "ready": true,
  "providers": {"fcm": true},
  "worker_running": true
}
```

自动门禁：

```powershell
python scripts/remote_workspace.py accept push-preflight public --relay-url https://ai-dev.ihep.ac.cn/api/runtime-relay
```

任一字段为 false、响应结构漂移、HTTP 降级或请求失败均阻断发布。诊断时可加 `--allow-not-ready` 采集无敏感字段的未就绪状态，但该结果不能作为验收通过证据。

readiness 响应执行严格字段白名单：顶层只允许 `ready/providers/worker_running`，`providers` 只允许 `fcm`。增加路径、凭据类型、项目标识或任何诊断细节都视为合同失败，防止运维信息通过公开端点扩散。

## 5. 真机验收

1. 在已授权三星真机安装与上述 Firebase Android App 匹配的非调试 APK并登录。
2. 允许系统通知，确认 push registration 返回成功且数据库、Redis、日志无明文 token。
3. 杀死 App，由 Windows 在同一 Session 产生完成、失败和待审批事件；系统通知应出现且不含正文。
4. 分别验证锁屏、冷启动、登录有效和登录过期，点击通知均恢复到正确 Session/Item；登录过期必须先登录再拉取正文。
5. 注入一次 429/5xx，确认有界重试；注入不可恢复 4xx，确认死信且不忙循环。
6. 撤销 association 后再次触发事件，确认不再投递，并清理 provider handle。
7. 执行 P5 Android/Windows/Relay 全边界 canary scan，所有规定来源非空且零命中。

## 6. 证据汇聚与发布

先由生产 OpenAPI 取证器同时保存报告和原始 OpenAPI；再用唯一 evidence 阶段从真实文件生成 ledger，禁止手填摘要：

```powershell
python scripts/collect_p5_platform_contract_evidence.py --relay-url https://ai-dev.ihep.ac.cn/api/runtime-relay --environment-id <本次环境ID> --output <证据目录>/contract-report.json --openapi-output <证据目录>/openapi.json
python scripts/remote_workspace.py accept evidence <证据目录>/p5-manifest.json --output <证据目录>/p5-ledger.json
python scripts/remote_workspace.py accept finalize <证据目录>/p5-ledger.json --output <证据目录>/p5-final-result.json
```

manifest 只声明安全相对路径、环境和功能映射。assembler 自动计算 Release APK、OpenAPI、两台真机证明、稳定性报告、secret-scan 报告和八类功能证据的字节数与 SHA-256；finalizer 再从磁盘独立复核。缺文件、路径逃逸、摘要/大小漂移、功能重复或覆盖不全均 fail closed。

只有上述步骤、两台独立物理设备隔离以及 P5 finalizer 全部通过，才可将 P5-M04-F01 与 P5-M08-F06 标记完成。
