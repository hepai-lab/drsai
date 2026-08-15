# Desktop 设置-频道微信接入 P2 验收台账

更新日期：2026-08-15  
对应方案：[settings-channels-wechat-integration-development-plan-p2.zh-CN.md](./settings-channels-wechat-integration-development-plan-p2.zh-CN.md)

## 状态说明

- `通过`：已有自动化或构建证据。
- `待真机`：代码和自动化门槛通过，仍需真实微信账号/真实 macOS 设备确认。
- P2 发布完成要求：所有条目通过；`待真机` 不视为最终通过。

## 功能验收

| ID | 状态 | 当前证据 | 尚需验收 |
| --- | --- | --- | --- |
| P2-W01 | 通过 | Runtime 首次入站事务测试；正式 Session、脱敏标题和 origin 元数据断言 | — |
| P2-W02 | 通过 | 10 线程绑定竞争测试；Run 入站幂等；Agent 回复持久化投递与跨 Bot 重启重放测试 | — |
| P2-W03 | 待真机 | Windows 实机审计发现并修复“仅消费增量事件、重启后不回填已有 Session”；现为先建立 SSE 水位、再分页同步全部已有 Session、最后消费增量，Windows/macOS 共用分页回归测试 | 新微信入站后重启 Desktop，确认左栏仍显示会话 |
| P2-W04 | 通过 | Runtime snapshot/journal 测试；同一 user/assistant item 重启后无重复 | — |
| P2-W05 | 通过 | Session origin 契约、线程投影和侧栏“微信”徽标契约 | — |
| P2-W06 | 通过 | 安装级 HMAC、脱敏标题、持久化内容负向断言；登录终端不再输出 provider ID | — |
| P2-W07 | 通过 | 微信入站直接创建 Runtime Run；Desktop 与 Bot 读取同一 conversation journal；Desktop 路径不再使用旧 AgentSessionAdapter | — |
| P2-W08 | 通过 | 两联系人交错测试；绑定、Session、序号和内存路由隔离 | — |
| P2-W09 | 通过 | `/newsession` 绑定轮换测试；旧 Session 保留 | — |
| P2-W10 | 通过 | archived Session 新入站恢复 active 的 lifecycle 测试 | — |
| P2-W11 | 通过 | Runtime 投递 pending→unknown 恢复；Bot 重启重复入站不重复执行/外发 | — |
| P2-W12 | 通过 | 微信稳定错误文案和内部错误脱敏测试；Runtime Run/诊断保留失败状态 | — |
| P2-W13 | 通过 | Composer 纯策略测试：普通点击、Enter、Ctrl/Cmd+Enter 均不可绕过显式确认 | — |
| P2-W14 | 待真机 | Desktop API、双平台 IPC、二次确认、幂等投递和 sent/unknown 状态自动测试通过 | 从 Desktop 点击“发送到微信”，手机只收到一次并核对 sent 状态 |
| P2-W15 | 通过 | 缺少进程内 route/context token 时 capability 禁用并返回 waiting_for_inbound | — |
| P2-W16 | 通过 | Gateway OIDC、Session/provider 归属校验、opaque binding 与无隐式审批测试 | — |
| P2-W17 | 待真机 | Windows/macOS TypeScript 类型检查及两端 `electron-vite build` 通过，共用同一 Renderer | macOS 真机 UI 冒烟 |
| P2-W18 | 待真机 | Runtime 使用当前图像理解配置；固定 CDN 白名单、AES-128-ECB、图片资源入正式 Run、附件投影和隐私负向测试通过；频道卡片不重复展示具体模型 | 从微信发送真实图片，核对 Desktop 附件及模型理解回复 |
| P2-W19 | 待真机 | Runtime 使用当前图像生成配置；生成 Artifact 提取、图片回传、投递幂等和纯图片回复测试通过；频道卡片不重复展示具体模型 | 从微信请求真实图像生成，核对手机只收到一次且 Desktop 保留 Artifact |

## 已执行门禁

| 门禁 | 结果 |
| --- | --- |
| Python Runtime/Journal/Relay/WeChat 相关测试 | 105 passed；1 个第三方 Starlette 弃用警告 |
| 微信 Bot/Bridge 定向回归 | 17 passed；加入隐私回归后应为 18 项 |
| Desktop Windows + macOS typecheck | 通过 |
| 微信 Desktop/Composer 契约 | 通过 |
| Windows `electron-vite build` | 通过 |
| macOS `electron-vite build`（Windows 交叉源构建） | 通过 |
| Runtime catalog 重启回填（405 Sessions、3 页） | 通过 |
| 微信多模态 Bot/Bridge/Channel 定向回归 | 35 passed；1 个第三方 Starlette 弃用警告 |
| Agent 模型策略、图片输入与图片生成回归 | 56 passed，1 skipped |
| 微信模型状态、多模态 Bot/Bridge/Channel 定向回归（第 22 轮） | 36 passed；1 个第三方 Starlette 弃用警告 |
| 微信模型能力 Desktop 契约验证（第 22 轮，第 25 轮移除卡片明细） | 通过 |
| Windows + macOS 四套 TypeScript 配置检查（第 22 轮） | 通过 |
| 微信同一联系人连续入站并发回归（第 23 轮） | 37 passed；1 个第三方 Starlette 弃用警告 |
| OAEP 微信外发白名单与推理泄漏回归（第 24 轮） | 38 passed；1 个第三方 Starlette 弃用警告 |

## 实机审计记录

- 第 18 轮在 Windows 开发版确认微信频道为“运行中”、账号标签脱敏、活动会话计数可读取。
- 同轮发现频道计数与左栏不一致，根因是 Desktop 仅订阅打开后的 catalog 增量事件，未同步此前已存在的 Runtime Session。
- 修复后双平台类型检查、分页回归和双平台 Electron 构建通过。重新启动的干净开发 Runtime 当前没有微信 Session，需要一次新的真实微信入站才能完成该条实机复验。
- 第 22 轮补充当前 Agent 模型策略读取：频道状态安全返回主模型、图像理解、图像生成及语音角色的 `provider/model`；Desktop 微信卡片显示前三项。自动化确认图片理解与图片生成使用当前配置，状态载荷不包含 API Key、微信凭据或本地配置路径。
- 第 23 轮根据实机日志定位 `session_run_already_active`：同一微信联系人在上一条 Agent Run 未完成时又有新入站。Bridge 现按脱敏联系人键串行调度 Run，不同联系人仍可并行；并发回归确认第二条消息只在第一条完成后创建和执行。
- 第 24 轮根据实机回复发现 final 文本混入 HTML 与模型内部自述。微信出口现只接受 OAEP completed final assistant message 和正式图片 Artifact，拒绝 reasoning/commentary/工具/诊断等项目；文本统一纯文本化，并对 `<think>` 及明显内部过程段落执行 fail-closed 截断。复现样例已加入回归，确认只外发“你好！👋 …”正文。
- 第 25 轮按产品反馈移除设置-频道-微信卡片中的主模型、图像理解和图像生成明细；Runtime 仍读取当前 Agent 模型策略，具体模型统一在模型设置中管理。
- 第 26 轮将设置-频道-微信卡片的通用消息气泡替换为本地微信双气泡品牌图标，使用微信绿色底色；图标不依赖网络资源。
- 第 27 轮将设置-频道中的频道卡片布局从自适应横向多列调整为单列纵向排列，聊天入口与消息源均按从上到下顺序展示。
- 第 28 轮提高微信 Logo 样式优先级，确保始终为微信绿底白色双气泡；微信频道卡片默认折叠，仅显示名称、连接/运行状态和协议标识，展开后显示配置详情、二维码及操作。

## 真实账号最终检查单

1. 两个测试微信联系人各发送两轮能引用上文的消息。
2. Desktop 左栏无需重启即出现两个不同的“微信会话 N”，且不显示原始微信 ID。
3. 打开会话核对入站消息与 Agent 回复的顺序、正文和微信端一致。
4. 重发同一 provider message ID，确认 Agent 不重复执行、微信不重复收到回复。
5. 普通 Composer 和键盘提交均不外发；明确点击“发送到微信”并二次确认后只收到一次。
6. 重启 Desktop/Runtime 后再次检查历史、绑定、徽标和回复能力提示。
7. 在 macOS 真机重复左栏、详情、普通发送拦截和显式发送冒烟。
8. 微信发送一张 PNG/JPEG/WebP/GIF 图片，确认使用当前图像理解模型，且 Session/API/日志不包含 CDN 密钥或原始微信 ID。
9. 微信请求生成图片，确认使用当前图像生成模型，手机只收到一份图片，Desktop 同一 Run 显示正式 Artifact。
