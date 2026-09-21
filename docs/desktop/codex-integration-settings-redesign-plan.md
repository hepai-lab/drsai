# OpenDrSai Desktop：Codex 集成设置页改版方案

状态：规划完成，待实施  
范围：`设置 → 集成 → Codex`  
主要实现：`apps/desktop/shared/renderer/src/App.tsx`、`styles.css` 及 Codex Desktop 集成验证脚本

## 1. 一句话定义

> Codex 是 OpenDrSai 中可选的编程智能体集成。连接 ChatGPT/Codex 账户后，用户可以在当前工作区让 Codex 编写、修改、审查和解释代码。

> 该能力通过自研 Codex Adapter 集成，符合 OpenDrSai Agent 协议（OAEP），从而实现任务过程可复现，并将数据、技能沉淀为可复用资产。

这句话应成为页面设计和文案取舍的唯一基准。

它不是：

- 面向普通用户的 Runtime 调试器；
- OpenDrSai 的默认模型提供方；
- OpenDrSai 本地智能体的替代品；
- 需要用户理解 OAEP、App Server、Adapter 或 Runtime instance 的基础设施页面。

页面名称保持为“Codex”，所属分组“集成”已经表达了产品关系。页面首屏不再使用“Codex Agent Runtime”作为标题。

## 2. 当前页面为什么显得杂乱

### 2.1 信息层级倒置

当前页面首屏展示十项内部状态：Desktop → Runtime、Runtime → Codex、账户/模型、App Server、Transport、Adapter、二进制来源、Runtime instance、Runtime home、观察时间。用户真正关心的三个问题反而不突出：

1. Codex 是什么；
2. 现在能不能使用；
3. 如果不能，下一步做什么。

### 2.2 操作没有主次

刷新、登录、退出、安装、升级、重启和复制诊断使用相似按钮并排展示。正常操作、恢复操作、破坏性操作和技术支持操作没有分组，也没有唯一主操作。

### 2.3 首次向导永久占位

“检查/安装 → 登录 → 新建会话”在已经就绪后仍作为三张大卡展示。它适合未配置状态，不适合日常状态。

### 2.4 技术名称泄漏

“Agent Runtime”“App Server”“Adapter”“binary source”等术语对开发诊断有意义，但不应成为产品设置页的主视觉。

### 2.5 视觉语言不统一

页面复用了 About 页的标题和按钮样式，又额外加入状态网格与向导卡片，缺少明确的顶部身份、状态色、视觉锚点和内容分区。

## 3. 用户任务与设计原则

### 3.1 用户任务

按优先级排序：

1. 判断 Codex 是否已经可以使用；
2. 完成安装、升级或 ChatGPT 登录；
3. 查看当前连接的账户及运行位置；
4. 出错时恢复连接；
5. 在技术支持场景查看和复制脱敏诊断；
6. 主动退出账户。

### 3.2 设计原则

- 结果优先：首屏只回答“是什么、是否可用、下一步”。
- 单一主操作：每个状态最多一个高强调按钮。
- 渐进披露：内部链路与路径默认折叠。
- 状态驱动：安装、登录、升级、恢复不能同时平铺。
- 产品语言优先：用“连接、账户、可用、需要更新”，不用“Adapter、OAEP、App Server”。
- 品牌克制：使用 OpenAI Blossom 单色图标；不自行增加颜色、渐变或效果。
- 正常态安静：已经就绪时页面应短、稳定，不制造“还需要设置”的感觉。

## 4. 新的信息架构

### 4.1 顶部：集成身份与总状态

顶部使用一张无厚重边框的 Hero 区域：

- OpenAI Blossom；
- 标题：`Codex`；
- 说明：`在当前工作区使用 Codex 完成编程任务。`；
- 状态徽标：已连接 / 需要登录 / 需要安装 / 需要更新 / 连接异常；
- 状态对应的唯一主操作；
- 一个低强调刷新图标按钮。

就绪状态补充两项摘要：

- 账户：账号标签；
- 运行位置：本机或远程 SSH。

不在 Hero 展示版本、端口、进程 ID、Runtime home 或 Adapter 版本。

### 4.2 中部：连接组成

用三行语义化状态代替十行链路诊断：

| 行 | 用户文案 | 数据来源 | 用户意义 |
|---|---|---|---|
| Codex | 已安装 · 版本号 / 需要安装 / 需要更新 | `installed`、`version`、`contractCompatible` | 软件是否可用 |
| ChatGPT 账户 | 账号标签 / 尚未登录 | `loggedIn`、`accountLabel` | 授权是否完成 |
| 工作区连接 | 本机 / 远程 SSH · 已连接 / 正在恢复 | `transport`、`connectionState`、Runtime liveness | 当前从哪里运行 |

每行只保留：图标、名称、简短结果和必要时的小型修复入口。不要重复顶部总状态。

### 4.3 未就绪时：上下文向导

三步向导只在未就绪时出现，并满足：

- 已完成步骤压缩为一行；
- 当前步骤突出并包含主操作；
- 后续步骤降低对比度；
- 达到 `available` 后整组消失；
- 不重复显示顶部已有按钮。

设备码登录期间，把向导当前步骤替换成明确的登录卡：验证码、复制按钮、打开登录页、取消。不能只在页面底部显示一行验证码。

### 4.4 底部：高级设置与诊断

使用默认折叠的 `details`：`高级设置与诊断`。

折叠内展示：

- App Server 状态；
- Adapter 版本；
- Codex 二进制来源及签名/兼容性状态；
- Runtime mode、instance、home、port；
- 最近观察时间；
- readiness facets 和原始原因的用户安全摘要；
- 复制脱敏诊断；
- 重启 Codex（只在有意义时显示）；
- 退出 Codex 账户，放在独立的低强调/危险操作区。

## 5. 建议线框

```text
┌──────────────────────────────────────────────────────┐
│  OpenAI Logo   Codex                     [已连接]  ↻ │
│                在当前工作区使用 Codex 完成编程任务。 │
│                                                      │
│  账户  zhang@example.com     运行位置  本机          │
│                                      [开始使用 Codex] │
└──────────────────────────────────────────────────────┘

连接
┌──────────────────────────────────────────────────────┐
│ ✓ Codex           已安装 · 0.x.x                     │
│ ✓ ChatGPT 账户    zhang@example.com                  │
│ ✓ 工作区连接      本机 · 已连接                      │
└──────────────────────────────────────────────────────┘

› 高级设置与诊断
```

未就绪状态将右下角主操作替换为“安装 Codex”“登录 ChatGPT”“更新 Codex”或“恢复连接”；只有就绪态显示“开始使用 Codex”。

## 6. 状态与主操作矩阵

| 状态 | 标题状态 | 主操作 | 次要内容 |
|---|---|---|---|
| 正在读取 | 正在检查 | 无，显示轻量进度 | 不显示错误或向导跳变 |
| `available` | 已连接 | 开始使用 Codex | 刷新；高级诊断 |
| `not_installed` | 需要安装 | 安装 Codex | 说明安装由 OpenDrSai 管理 |
| `version_incompatible` | 需要更新 | 更新 Codex | 展示当前版本和最低兼容说明 |
| `not_logged_in` | 需要登录 | 登录 ChatGPT | 展示设备码登录流程 |
| `account_unavailable` | 账户暂不可用 | 重新检查账户 | 允许退出后重新登录 |
| `fault` + retryable | 连接异常 | 恢复连接 | 高级诊断中提供重启 |
| `fault` + non-retryable | 无法使用 | 查看解决方法 | 复制诊断，不承诺自动恢复 |
| liveness reconnecting | 正在恢复连接 | 无 | 保留上次稳定信息，避免按钮抖动 |

主操作必须由统一函数从状态计算，禁止在 JSX 中分别堆叠多个条件按钮。

## 7. 视觉规格

- 内容最大宽度：720–760 px；在设置内容区左对齐。
- Hero 内边距：18–20 px；卡片圆角 12 px；边框使用现有 `--app-border-soft`。
- OpenAI 图标：32 px，单色 `currentColor`，周围至少 8 px 可视留白。
- 页面标题：18 px / 650；说明：12.5–13 px / 1.55。
- 状态徽标：11–12 px；成功用低饱和绿色，注意用琥珀色，错误用低饱和红色。
- 主按钮：32–34 px 高；同一屏只出现一个填充按钮。
- 连接行：最小高度 44 px；三行共用一个容器，不制作三张悬浮卡。
- 高级区域默认折叠，内部技术字段使用 11.5–12 px 和等宽值，不抢占主层级。
- 小屏下摘要改为单列；不允许水平滚动条。
- 动画仅用于检查/恢复中的 12–16 px spinner；禁止整卡闪烁或布局位移。

## 8. 文案收敛

推荐中文：

- 标题：`Codex`
- 描述：`在当前工作区使用 Codex 完成编程任务。`
- 补充说明：`Codex 由 OpenAI 提供，需要使用 ChatGPT 账户连接。`
- 集成说明：`通过自研 Codex Adapter 接入并符合 OpenDrSai Agent 协议（OAEP），使任务过程可复现，并将数据与技能沉淀为可复用资产。`
- 可用状态：`已连接`
- 登录操作：`登录 ChatGPT`
- 就绪操作：`开始使用 Codex`
- 高级入口：`高级设置与诊断`
- 退出操作：`退出 Codex 账户`

推荐英文：

- `Use Codex for coding tasks in the current workspace.`
- `Codex is provided by OpenAI and connects with your ChatGPT account.`
- `Connected` / `Sign in to ChatGPT` / `Use Codex` / `Advanced settings and diagnostics`

不要在主层级使用：`Agent Runtime`、`Backend`、`Adapter`、`App Server`、`Runtime instance`。

## 9. 实现拆分

### F1：派生展示模型

从 `CodexBackendStatus` 与 `DesktopHealth` 派生单一 `CodexIntegrationViewModel`：

- `tone`：neutral / success / warning / danger；
- `headline`、`summary`；
- `primaryAction`；
- 三项连接状态；
- `showSetup`；
- `advancedDiagnostics`。

验收：相同输入永远产生相同展示，不在多个 JSX 分支重复判断状态。

### F2：组件拆分

从巨型 `App.tsx` 提取：

- `CodexIntegrationSettings.tsx`；
- `CodexIntegrationHero`；
- `CodexConnectionSummary`；
- `CodexSetupFlow`；
- `CodexAdvancedDiagnostics`。

保留既有 IPC 和 `CodexBackendStatus` 合约，不改 Runtime 后端。

验收：`App.tsx` 只负责传入数据和回调；页面组件可以用 fixture 独立渲染。

### F3：状态化操作

- 建立唯一主操作映射；
- 登录设备码形成完整卡片；
- 成功后自动收起向导；
- 重启、诊断、退出移入高级区；
- 操作中禁用重复提交并显示就地进度。

验收：任一时刻最多一个主按钮；不会同时显示安装、升级、登录和重启。

### F4：视觉与响应式

新增 `codex-integration-*` 专属样式，停止复用 `about-*` 作为页面主结构；复用全局设计 token，不新增硬编码品牌渐变。

验收：宽度 640、900、1280 px 无溢出；中英文、浅色和深色主题均无截断。

### F5：诊断兼容

保留当前复制诊断包含的脱敏字段、既有 test id 和恢复能力；技术字段移动不等于删除。

验收：现有 Codex 集成、V3 P1、V3 P4、V5 usability 验证继续通过，并更新仅依赖旧布局文案的脆弱断言。

## 10. 测试与验收

### 10.1 派生状态单元测试

为所有 `CodexBackendState`、Runtime liveness、retryable、local/ssh 组合建立表驱动测试，检查状态文案、tone、主操作和向导可见性。

### 10.2 组件测试

- 就绪态：只显示一个“开始使用 Codex”，不显示三步向导；
- 未安装：主操作为安装；
- 未登录：主操作为登录；
- 登录中：显示验证码、复制和打开页面；
- 恢复中：不产生错误闪烁，不允许重复恢复；
- 高级区：默认折叠，展开后技术字段与诊断操作完整；
- 退出：需要明确操作，不与正常主操作并列。

### 10.3 视觉回归

固定至少八张快照：浅/深主题 × 就绪/未登录/故障，以及中文/英文关键状态。检查图标比例、文本换行、按钮数量、滚动和对齐。

### 10.4 键盘与无障碍

- Tab 顺序从主操作到刷新，再到高级区；
- 状态变化使用 `role=status`，错误使用 `role=alert`；
- 图标按钮具备中英文 `aria-label`；
- 设备码可键盘复制；
- 折叠区域使用原生 `details/summary` 或等价语义。

### 10.5 最终产品验收

请一名不了解 Runtime/OAEP 的用户在 10 秒内回答：

1. 这个集成用来做什么；
2. 当前是否可用；
3. 下一步该点哪里。

三项均能正确回答，且用户无需展开高级诊断，才算页面完成。

## 11. 实施顺序

1. 先建立 view model 和状态矩阵测试；
2. 再提取组件，保持功能与 test id 不变；
3. 完成 Hero、连接摘要和条件向导；
4. 收纳高级诊断与次要操作；
5. 完成响应式、深色主题和视觉回归；
6. 最后更新旧的源码字符串验证，执行完整 Codex Desktop 验证集。

## 12. 非目标

- 本阶段不改变 Codex 安装、发现、认证或 OAEP 协议；
- 不改变 Codex 与 OpenDrSai 智能体的运行路由；
- 不新增全局默认智能体语义；
- 不把 OpenAI 标识用于 OpenDrSai 自身品牌；
- 不在设置页内重做完整聊天体验。

## 13. 品牌依据

OpenAI 官方将图形标识称为 Blossom，要求保持规定比例与留白、不得添加颜色或未经授权的元素。Codex 页面只在直接表示 OpenAI Codex 服务时使用该标识，并保持 OpenDrSai 为界面主品牌：<https://openai.com/brand/>。
