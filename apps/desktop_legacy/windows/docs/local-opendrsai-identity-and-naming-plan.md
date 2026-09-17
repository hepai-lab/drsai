# Windows 本机 OpenDrSai 命名与用户身份统一方案

## 1. 目标与结论

本方案解决两个表面相关、实质独立的问题：

1. 智能体广场中的默认本机智能体统一显示为 **OpenDrSai**，不再显示 `My DrSai`；
2. 已登录用户不再在本机智能体配置区看到可编辑的 `anonymous`，桌面端明确显示当前 HepAI 登录身份，并确保所有用户级调用以经验证的 OIDC `sub` 为唯一主体。

当前的 `anonymous` **不代表 HepAI 登录失效**。它来自 Python CLI 的本地配置文件 `cli_config.json.user_id`，默认值硬编码为 `anonymous`。Windows App 已经通过 OIDC 获得真实用户身份，但智能体广场配置面板错误地把 CLI 配置字段展示成了桌面端“用户 ID”，造成了身份错觉。

立即修复时应遵守以下边界：

- 本机智能体稳定 ID 暂时保留为 `my-drsai`，避免破坏历史任务、默认智能体、收藏、测试和遥测；
- 所有面向用户的名称统一为 `OpenDrSai`；
- Desktop 的权威用户 ID 只能来自已验证 OIDC token 的 `sub`，不能来自表单、查询参数、`cli_config.json`、邮箱或 Windows 用户名；
- 邮箱和姓名只用于显示，不作为持久化主键；
- CLI/TUI 的 `user_id=anonymous` 继续作为离线兼容配置，但不再暴露为 Desktop 登录身份，也不得影响 Desktop 对话、记忆和用户数据隔离；
- 设备配置与账号数据分开：模型、工作区安全开关等是设备配置，记忆、历史、计划任务等是账号数据。

## 2. 当前代码事实与根因

### 2.1 两套身份来源被混在同一界面

| 身份 | 当前来源 | 当前用途 | 问题 | 目标 |
| --- | --- | --- | --- | --- |
| HepAI 登录主体 | OIDC access token 的 `sub` | 本机运行时执行、平台请求、账号级数据 | 配置页没有显示这套身份 | Desktop 唯一权威主体 |
| 登录显示信息 | OIDC session 的 `name`、`email` | 头像、账号菜单 | 未复用到智能体配置页 | 只读显示当前账号 |
| CLI 用户 ID | `~/.drsai/configs/cli_config.json.user_id` | 独立 CLI/TUI 离线兼容 | 默认 `anonymous`，却被标为 Desktop“用户 ID”且允许编辑 | 从 Desktop 配置 UI 和写接口移除 |
| 系统用户回退 | `DRSAI_DESKTOP_USER` / `USER` / `USERNAME` | 部分旧 Gateway 路由 | 可能得到 `win11`，仍不是 HepAI 账号 | 只允许离线模式使用，并明确标记来源 |

### 2.2 已存在的正确认证调用链

本机 OpenDrSai 对话的主链路已经使用真实登录身份：

```text
OIDC 登录
  -> auth.ts 校验 token，取 access token 的 sub
  -> chat.ts 取得 AuthContext
  -> runtimeClient.ts 发送 Bearer token、auth mode、principal 和 user_id
  -> Python Gateway 再次校验 token，并检查请求 user_id 与 token sub 一致
  -> platform_auth_scope
  -> OpenDrSai backend 以 auth.subject 执行、读取记忆和凭据
```

因此，不能用“把 `cli_config.user_id` 改成邮箱”来修复截图问题。这会建立第二套可编辑身份，既不能解决账号切换，也可能削弱用户数据隔离。

### 2.3 真正需要继续加固的旧链路

聊天主链已正确，但 Python Gateway 中仍有若干旧接口通过 `_get_user_id()`、请求体可选 `user_id` 或系统用户名处理用户级数据。需要逐项审计记忆、看板、计划任务、技能、统计和配置等路由，统一到请求作用域的认证主体，防止同一登录用户在不同功能中出现 `sub`、邮箱、`win11`、`anonymous` 四种键。

## 3. 名称修改策略

### 3.1 稳定标识与显示名称分离

- 稳定 ID：本期继续使用 `my-drsai`；
- Agent definition：继续使用现有 `opendrsai@1`；
- 新显示名称：`OpenDrSai`；
- 内部常量可从 `LOCAL_AGENT_ID` 重命名为 `LOCAL_OPENDRSAI_AGENT_ID`，值不变；
- 新增统一的显示名称常量或 catalog 元数据，Renderer、Main、诊断文案和测试都从同一来源取值。

不建议本期把稳定 ID 直接改为 `opendrsai`。如果未来确需更换，应另做带别名表、持久化迁移和协议版本升级的专项变更。

### 3.2 历史数据迁移

历史任务已经保存 `boundAgentId` 和 `boundAgentName`。读取任务时执行窄范围迁移：

- 仅当 `boundAgentId === "my-drsai"`；
- 且名称属于已知旧别名，如 `My DrSai`、`My Dr.Sai`；
- 将展示名称更新为 `OpenDrSai`；
- 使用现有原子写入机制惰性回写；
- 不替换任务标题、用户消息、智能体回复或第三方智能体的同名文本。

## 4. 身份模型与界面方案

### 4.1 新的 Desktop 身份视图

在 Desktop API 中提供只读的有效身份对象，可直接复用 `AuthSession.user`，或在配置响应中增加明确 DTO：

```ts
type DesktopEffectiveIdentity = {
  principalId: string;       // OIDC sub，技术主键
  displayName?: string;
  email?: string;
  source: "oidc" | "offline-local" | "api-key";
  authenticated: boolean;
};
```

规则：

- OIDC 模式下 `principalId` 必须来自已验证 token 的 `sub`；
- `displayName`、`email` 来自登录 session，仅用于展示；
- Renderer 不得提交或覆盖 `principalId`；
- IPC 返回前继续执行现有 secret scan，不暴露 access token、refresh token；
- 未登录时不伪装成一个名为 `anonymous` 的已登录用户，应显示“未登录”或阻止进入要求登录的账号能力。

### 4.2 智能体配置面板

配置卡标题改为“OpenDrSai 配置”。当前“用户 ID”文本框改为只读账号区域：

- 主行显示登录姓名；没有姓名时显示邮箱；
- 次行显示邮箱和“已通过 HepAI 登录”；
- 技术 `principalId` 默认隐藏，可在开发者信息中复制；
- 不允许在 OpenDrSai 配置保存请求中编辑身份；
- 模型、Plan mode、工作区限制、危险命令等保留为设备配置，并增加“设备配置”语义，避免误以为随账号同步。

## 5. 分阶段实施

### P0：行为定桩与回归保护

1. 为当前 OIDC `sub -> Runtime -> Gateway -> backend` 链路补充契约测试；
2. 为 `cli_config.user_id=anonymous` 不得影响 Desktop 对话主体增加负向测试；
3. 记录现有历史任务、默认智能体和配置文件的兼容样本。

### P1：统一显示名称

1. 将本地 catalog 名称从 `My DrSai` 改为 `OpenDrSai`；
2. 修改聊天默认 `boundAgentName`、后端不可用提示、诊断文案和配置标题；
3. 保持 `my-drsai` 路由判断不变，并集中定义稳定 ID；
4. 更新中英文文案、ARIA、测试 fixture、快照和产品文档；
5. 对历史任务执行受限别名迁移。

### P2：拆分登录身份与 CLI 配置

1. 从 `MyDrSaiConfigPanel` 的可编辑表单中移除 `user_id`；
2. 从 Desktop `UpdateMyDrSaiConfigRequest` 和 Main `WRITABLE_KEYS` 移除 `user_id`；
3. 通过 `AuthSession.user` 或新的 `DesktopEffectiveIdentity` 显示当前 HepAI 账号；
4. 将账号信息与设备配置在视觉和数据结构上分区；
5. 保留 Python CLI/TUI 对旧 `user_id` 的读取兼容，但改进其注释和标签，明确它是离线 profile，而不是 HepAI 主体。

### P3：统一用户级调用链

1. 在 Gateway 建立单一的请求级 `effective_principal`/`RuntimePrincipal` 解析入口；
2. OIDC 请求只接受 token `sub`，对请求体、Header 中不一致的 `user_id` 返回 403；
3. 审计并迁移记忆、看板、计划任务、技能、统计、分享和配置等用户级路由；
4. Main 对所有用户级 Gateway 请求附带同一 AuthContext，设备级请求则不附带伪用户 ID；
5. 为离线 CLI/TUI 保留显式 `offline-local` 分支，禁止该回退进入已认证 Desktop 会话。

### P4：引用收敛与兼容清理

1. 清理 shared Main、shared Renderer、preload、Desktop API 中所有面向用户的 `My DrSai`；
2. 将 Windows 目录下未被活动构建使用的重复实现改为 re-export 或删除，避免修错副本；
3. 保留协议、持久化和测试所需的 `my-drsai`，并为每处保留项添加稳定 ID 说明；
4. 更新智能体广场总规划、联调文档和发布说明中的名称与身份边界。

### P5：测试、联调与发布

1. 单元测试：名称解析、身份 DTO、配置白名单、历史迁移；
2. IPC 契约测试：Renderer 无法写入身份，返回结构不含 token；
3. 集成测试：登录 A、退出、登录 B 后，记忆和任务数据不串号；
4. E2E：智能体广场展示 OpenDrSai，账号只读，开始使用后本机和云端分别进入正确执行通道；
5. HAI 联调：验证 token `sub`、平台账号信息和 Runtime 校验结果一致，并验证过期登录仍触发现有重新登录流程。

## 6. 重点文件范围

| 方向 | 主要文件 | 修改要点 |
| --- | --- | --- |
| 本机 catalog | `apps/desktop/shared/main/agents.ts` | 显示名、常量命名，稳定 ID 不变 |
| 聊天路由 | `apps/desktop/shared/main/chat.ts` | 默认绑定名、提示与诊断文案；继续使用 AuthContext |
| 历史任务 | `apps/desktop/shared/main/threads.ts` | 旧显示名称的窄迁移 |
| 登录会话 | `apps/desktop/shared/main/auth.ts` | 复用现有 verified `sub`，必要时输出只读身份视图 |
| 运行时客户端 | `apps/desktop/shared/main/runtimeClient.ts` | 保持 bearer/principal/user_id 一致性，补契约测试 |
| 配置 Main | `apps/desktop/shared/main/myDrSaiConfig.ts` | 从可写字段移除 `user_id` |
| IPC/API | `apps/desktop/shared/api/desktopApi.ts`、preload | 收紧更新 DTO，增加只读身份类型或复用 AuthSession |
| 广场 UI | `apps/desktop/shared/renderer/src/components/AgentSquareView.tsx` | OpenDrSai 名称、只读登录账号、设备配置分区 |
| Renderer 接线 | `apps/desktop/shared/renderer/src/App.tsx` | 传递完整 auth user，而非仅邮箱 |
| Python Gateway | `cores/python/packages/drsai/src/drsai/backend/gateway.py` | 统一请求主体，清理旧用户 ID 回退 |
| CLI 配置 | `cores/python/packages/drsai/src/drsai/backend/cli/config.py` 等 | 保持离线兼容，澄清 profile 语义 |
| 测试与文档 | Windows verify/e2e、Python tests、智能体广场文档 | 更新断言并补跨账号隔离测试 |

活动 Windows Electron 构建使用 `apps/desktop/shared/renderer`，Main 也已经大量引用 shared 实现。修改前应先确认 `apps/desktop/windows/src` 中同名文件是否仍有入口；无入口的副本不得继续独立维护。

## 7. 开发项统计

本方案共 **6 类开发项、27 个功能点**：

| 类别 | 功能点数 |
| --- | ---: |
| A. 行为定桩与回归保护 | 3 |
| B. 显示名称统一与历史迁移 | 5 |
| C. 登录身份与 CLI 配置拆分 | 5 |
| D. 用户级调用链统一 | 5 |
| E. 引用收敛与兼容清理 | 4 |
| F. 测试、HAI 联调与发布 | 5 |
| **合计** | **27** |

## 8. HAI 联调要求

名称修改和配置 UI 拆分可本地完成；以下事项需要 HAI 环境联调：

- ID token 与 access token 中主体字段的实际约定；
- `sub` 在 `ai-dev.ihep.ac.cn`、`aiapi.ihep.ac.cn` 与本机 Runtime 之间是否稳定一致；
- 账号切换、token 刷新、token 过期后的身份更新；
- 平台智能体对话和本机 OpenDrSai 对话是否使用同一账号主体；
- 服务端是否仍接受客户端自报 `user_id`，以及不一致时是否可靠拒绝。

如需平台改动或真实环境验证，按既有约定向会话 `019f5208-0f19-7883-b3e2-4dcc8ffa4b61` 发送联调请求。该会话运行在 `zzd_3090_via_chat_ihep`，修改大部分可热加载到 `ai-dev.ihep.ac.cn`；联调消息需包含接口、期望 `sub`、脱敏请求 ID、时间戳和实际/期望状态，不发送 token。

## 9. 验收标准

- 智能体广场、配置面板、聊天绑定标签、诊断信息中均显示 `OpenDrSai`；
- 现有 `my-drsai` 历史任务仍可打开、续聊和执行，旧绑定名自动显示为 OpenDrSai；
- 登录后展示当前 HepAI 姓名/邮箱，不出现可编辑的 `anonymous` 用户 ID；
- Renderer 和配置 IPC 无法修改认证主体；
- 本机对话的执行主体等于已验证 token `sub`，伪造不同 `user_id` 被拒绝；
- 登录 A 与登录 B 的记忆、任务、计划任务和其他账号级数据严格隔离；
- 未登录、过期登录和离线 CLI 三种状态有不同且准确的提示；
- 云端智能体仍直连平台，本机 OpenDrSai 仍走本机 Runtime/Gateway，名称修改不改变路由；
- 不把 token、refresh token 或完整认证响应写入日志、任务存储或 Renderer；
- Windows 类型检查、相关 verify 脚本、Python 单测和关键 E2E 全部通过。

## 10. 不建议采用的修复

- 不要把 `cli_config.user_id` 直接写成邮箱；邮箱可变且不一定唯一；
- 不要在每次登录时把 OIDC `sub` 写入全局 CLI 配置；这会污染离线 CLI，并在账号切换时产生共享状态；
- 不要只改卡片标题；历史任务、默认绑定、提示、ARIA、测试和文档会继续泄漏旧名称；
- 不要全局替换字符串 `my-drsai`；它当前是兼容性稳定 ID；
- 不要信任 Renderer 或请求体提供的用户主体，必须以后端验证后的 token claims 为准。

## 11. 实施与验收记录（2026-08-04）

本方案的 **6 类开发项、27 个功能点已全部完成，完成度 100%**。

- 本机智能体稳定 ID 保持 `my-drsai`，用户可见名称统一为 `OpenDrSai`；历史绑定名按白名单惰性迁移。
- Desktop 配置 DTO、写入白名单和界面均已移除可编辑 `user_id`；配置界面只读展示当前 HepAI 姓名、邮箱和技术主体。
- OIDC 请求统一以服务端验证后的 token `sub` 为主体；客户端伪造不一致的 `user_id` 返回 403，过期 token 返回 401。
- 本机 OpenDrSai 继续通过本机 Runtime/Gateway 执行，云端智能体继续直连 HAI；本机所选模型会透传到 Runtime，且不会修改持久化智能体定义。
- Windows 类型检查、构建、配置/目录/Runtime/Gateway/视觉校验、Python 身份与 Runtime 单测、源码态及打包态 OIDC E2E 均通过。
- HAI 真实联调通过：目录和模型接口返回 200；DDF 智能体返回 `text/event-stream`，收到文本增量及 `[DONE]`。实测响应约 80 秒，因此真实联调脚本采用可配置的 120 秒默认超时。

本轮未发现需要 HAI 平台修改的协议或鉴权问题，因此没有向联调会话发送改动请求。
