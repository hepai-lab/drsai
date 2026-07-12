# 模型服务凭证管理规划

## 目标与边界

OIDC 凭证证明“用户是谁、是否可以使用 HepAI 平台”；模型服务凭证证明“某个模型供应商是否允许调用”。两类凭证必须分开存储、分开刷新、分开注销，模型 API key 不得写入 OIDC `auth.json`，也不得进入 Renderer 状态、日志或工作区文件。

第一阶段 OIDC 会话固定存放在 `~/.drsai/auth/auth.json`。模型服务凭证采用独立的元数据文件 `~/.drsai/auth/model-credentials.json`，秘密值由 Windows Credential Manager 或 Electron `safeStorage` 保护。

## 凭证来源

支持三类来源，并按以下优先级解析：

1. `platform_managed`：HepAI 平台依据 OIDC access token 代理模型请求，桌面端不持有模型 key。这应是默认路径。
2. `user_managed`：用户为 OpenAI、Anthropic 或兼容服务保存自己的 API key。
3. `environment`：开发环境从进程环境变量读取，只读且不落盘。

工作区不得默认覆盖全局凭证。若未来允许按工作区选择凭证，只保存 credential id 引用，不复制秘密值。

## 数据模型

`model-credentials.json` 只保存非敏感索引：

```json
{
  "version": 1,
  "default_credential_id": "hepai-platform",
  "credentials": [
    {
      "id": "hepai-platform",
      "provider": "hepai",
      "auth_type": "platform_managed",
      "base_url": "https://ai-dev.ihep.ac.cn/api",
      "secret_ref": null,
      "created_at": "2026-07-11T00:00:00.000Z",
      "updated_at": "2026-07-11T00:00:00.000Z"
    }
  ]
}
```

用户自带 key 的 `secret_ref` 指向系统凭证项，例如 `OpenDrSai/model-credential/{credential-id}`。若 Credential Manager 不可用，使用 `safeStorage` 加密后的独立 secret 文件作为兼容实现，禁止回退为明文。

## 请求流程

1. Renderer 只提交模型别名和可选 credential id。
2. Main Process 的 `ModelCredentialResolver` 根据模型配置解析 provider、base URL 和凭证来源。
3. `platform_managed` 调用 `requireAuthContext()`，将 OIDC access token 作为 HepAI 网关 Bearer token。
4. `user_managed` 从系统凭证库按 `secret_ref` 读取 API key，仅在 Main Process 内构造供应商请求头。
5. `environment` 从允许列表中的环境变量读取；UI 只显示“来自环境变量”，不回显内容。
6. 401 处理按凭证类型分流：平台凭证触发一次 OIDC 刷新；用户 key 不自动重试，提示检查或替换；环境凭证提示更新运行环境。

## 功能清单

- M1：凭证元数据 CRUD，包含稳定 id、provider、auth type、base URL 和显示名称。
- M2：系统安全存储适配器，支持写入、读取、删除和可用性探测。
- M3：模型到凭证的解析器，默认优先平台托管凭证。
- M4：认证请求头注入，秘密仅存在于 Main Process 请求生命周期。
- M5：凭证连通性测试，返回 provider、HTTP 状态和脱敏错误。
- M6：删除与退出语义；退出 HepAI 不删除用户自带 key，清除本地数据时才显式删除。
- M7：迁移现有 `.env`/settings API key，用户确认后写入安全存储并移除旧明文。
- M8：审计与脱敏，日志、异常、IPC、遥测均不得含完整 key。

## 原子开发任务

- MC01：定义 `ModelCredentialMetadata`、`ModelCredentialSummary` 和 IPC 类型；类型检查通过。
- MC02：实现 `ModelCredentialMetadataStore` 的原子读写、版本校验和损坏隔离；单元测试覆盖。
- MC03：实现 Windows Credential Manager 适配器及 `safeStorage` 兼容适配器；验证秘密不会出现在元数据文件。
- MC04：实现 create/update/delete/list；Renderer 只能获得摘要和 `hasSecret`。
- MC05：实现 `ModelCredentialResolver` 的三种来源优先级；表驱动测试覆盖冲突情况。
- MC06：将 chat、agent run 和模型探测统一接入 resolver；集成测试检查正确请求头。
- MC07：实现按凭证类型区分的 401 行为，确保每个请求最多重试一次。
- MC08：实现凭证连通性测试和错误脱敏；测试中放置 canary key 并断言输出不存在 canary。
- MC09：实现旧 API key 检测与一次性迁移；迁移失败不删除原数据，成功后清除明文。
- MC10：实现设置页的凭证列表、添加、替换、测试、删除和默认选择；视觉与键盘操作验证通过。
- MC11：实现“退出账号”与“清除本地数据”的不同清理范围；E2E 验证用户 key 的保留和删除。
- MC12：增加发布门禁，扫描打包产物、日志 fixture 和 Renderer bundle 中的测试秘密。

## 验收标准

- 未配置用户 key 时，HepAI 模型请求只使用有效 OIDC access token。
- 用户 key、refresh token 和 access token 均不出现在 Renderer、日志、工作区或元数据文件中。
- 并发请求不会触发重复 OIDC refresh，也不会重复读取后复制秘密。
- 401 不产生无限重试，403 不触发刷新。
- 普通退出仅清除 OIDC 会话；“清除本地数据”按确认范围删除模型凭证。
- 旧明文 key 可安全迁移，且迁移过程可恢复、可验证。
