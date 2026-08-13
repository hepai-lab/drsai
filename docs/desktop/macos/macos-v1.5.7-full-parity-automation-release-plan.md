# OpenDrSai macOS v1.5.7 完整补齐、全自动验收与发布方案

> 状态：执行基线草案
> 基线日期：2026-08-12
> 目标版本：macOS Desktop v1.5.7（Apple Silicon arm64）
> 对照版本：Windows Desktop tag `v1.5.7`（commit `85b25aad`）
> 发布目标：阿里云 OSS、macOS 稳定更新通道及 `opendrsai-dev.ihep.ac.cn` 线上验证

## 1. 范围和完成定义

本方案只对齐 Windows `v1.5.7` tag，不纳入 tag 之后的流式语音、Runtime、OAEP 或其他候选 v1.5.8 增量。实施过程中若共享代码已包含 v1.5.7 之后的修改，必须先用机器可读差异账本标记为“继承增量”，不得把它们计入 v1.5.7 完成度，也不得让其破坏 v1.5.7 回归。

“补齐”同时要求：

1. Windows v1.5.7 的用户功能在 macOS 有等价入口和结果；
2. 成功、失败、取消、审批、幂等、恢复和安全边界语义一致；
3. Keychain、TCC、Finder、Dock、菜单、PTY、通知、睡眠唤醒符合 macOS 平台行为；
4. 最终签名、公证产物通过自动安装、升级、回滚和数据保护验收；
5. OSS、更新元数据、网站下载入口和实际文件摘要一致；
6. 所有证据绑定同一 clean commit、版本和产物哈希。

当前 374/374 IPC parity 只能证明 preload、Windows main、macOS main 的通道数量一致，不能单独作为产品完成或发布结论。

## 2. Windows v1.5.7 产品基线

产品范围以 Windows 产品验收台账的 A～M 类能力为主，并以 `v1.5.7` 源码、共享 API、preload 和最终 Windows 产物契约交叉校验。

| 类别 | macOS 必须具备的产品能力 |
| --- | --- |
| A 首次使用与任务入口 | 首次启动、认证、服务/Runtime 阻断说明、自然语言入口、模板和示例任务 |
| B 模糊需求理解与澄清 | 识别缺失信息、结构化澄清、目标确认、用户纠正、输出要求补齐 |
| C 材料导入、识别与使用 | 多格式/文件夹导入、角色识别、建议、冲突发现、材料问答、异常文件、中文路径和隐私 |
| D 自动规划与连续完成 | 任务拆解、计划编辑、深度选择、连续执行、计划变化、完成标准 |
| E 进度、介入与长任务 | 业务进度、统一状态、阶段成果、暂停/继续/取消、追加要求、后台继续、断网和异常退出恢复 |
| F 决策、权限与安全 | 风险分级、关键操作审批、业务说明、异常数据选项、敏感信息、工作区边界 |
| G 成果生成、查看与修改 | 成果中心、交付文件、多版本、预览下载、局部修改、图表一致性、完成页 |
| H 依据、可信度与复核 | 结论依据、真实引用、数字追溯、不确定性、一致性检查、独立复核、可信度标签 |
| I 版本、撤销与路线比较 | 自动版本、整体/局部撤销、分支路线、版本比较、外部修改冲突保护 |
| J 记忆和任务复用 | 偏好记忆、敏感信息边界、记忆管理、范围隔离、保存和调整复用任务 |
| K 自动任务和通知 | 自然语言计划任务、exactly-once、摘要、失败升级、系统通知、离开摘要、任务管理 |
| L 分享与协作 | 分享、原始材料隔离、秘密扫描、权限、评论转任务、撤销、版本一致性 |
| M 原生体验与可靠性 | 安装、更新、窗口缩放、键盘、无障碍、性能、稳定性、错误恢复、中文、清理和卸载保护 |

详细功能事实来源：

- `docs/product/opendrsai-windows-product-acceptance-tracker.md`
- `apps/desktop/windows/src/main`
- `apps/desktop/windows/scripts`
- `apps/desktop/shared/api`
- `apps/desktop/shared/main/preload.ts`
- `apps/desktop/shared/renderer`

历史台账曾使用 88、93 和 Phase 3 子集等不同统计口径。执行前必须生成唯一的 `macos-v1.5.7-feature-ledger.json`，每项包含 `featureId`、Windows source、macOS entry、IPC/service、test、evidence、status 和 platform exception；后续完成率只读取该账本。

## 3. 当前事实基线

截至 2026-08-12 的只读检查结果：

| 项目 | 当前结果 | 判定 |
| --- | --- | --- |
| macOS package version | `1.5.7` | 满足目标版本 |
| 架构/系统 | Apple Silicon arm64，macOS 26.5.2 | 可做真机验收 |
| IPC inventory | preload 374 / Windows 374 / macOS 374 | 静态 parity 通过 |
| main composition | 374 IPC | 组合静态检查通过 |
| v1.5.7 parity 聚合门禁 | Node 22.23.2 下完整通过 | 通过 |
| unsigned update-feed 门禁 | Node 22.23.2 下通过 | 通过 |
| Node | `.nvmrc`、package engines、dev/setup/preflight 入口均固定 Node 22 | 通过；当前为 v22.23.2 / npm 10.9.8 |
| 本地 Runtime | `import drsai` 通过，manifest 为 0600 | 开发 Runtime 可用 |
| Developer ID | `~/.keys/mac_developer` 的 P12/证书/私钥匹配；一次性 Keychain 真实签名和 strict verify 通过 | 通过；本地发布凭据 loader 已接入 |
| 公证凭据 | Key ID、Issuer、P8 格式正确；`notarytool history` 认证通过 | 通过；本地发布凭据 loader 已接入 |
| `ossutil` | `~/.local/bin/ossutil` v1.7.19 | 满足工具版本 |
| OSS 配置 | `~/.keys/aliyun_oss/AccessKey.csv` 为 0600；stable stat 和 validation 前缀隔离写/读/删探针通过 | 发布权限就绪；stable 晋级仍受 L6 门禁保护 |
| GitHub Device OAuth client ID | 未注入 | GitHub Channel 真实验收阻塞 |
| 真实 Provider 平台会话 | 本机已有 `ai-dev.ihep.ac.cn` HepAI OIDC 会话与启用模型目录 | 统一平台真实模型矩阵可执行；不再要求六套外部 Provider 账号 |
| macOS Keychain `ai.drsai.desktop` | 真实 put/get/replace/delete 原生测试通过 | 就绪；不保留验收秘密 |
| OSS 发布事务静态测试 | 通过；stable metadata 最后更新且唯一可覆盖 | 设计满足 |
| 线上发布入口 | `opendrsai-dev.ihep.ac.cn` HTTPS 200；macOS stable OSS/CDN 元数据 HTTPS 200 且支持 Range | 线上读取链可用；发布只需写 OSS，域名用于发布后验收 |
| 上一稳定版本 | 线上 stable 为 macOS v1.5.3、Runtime v1.5.3；已从 OSS/CDN 下载并验证 size/SHA-512/严格签名 | v1.5.3 → v1.5.7 升级基线就绪 |
| 工作树 | 存在大量任务开始前的未提交修改 | 不能签发 release attestation |

本地 `~/.drsai` 和 `~/.drsai-dev` 存在认证、Runtime、Agent 和模型配置；敏感主配置、认证、Runtime token 和诊断 key 主要使用 0600。字段名审计未发现直接的 `api_key/token/secret/password` 配置项，但这不能替代 Keychain put/get/replace/delete 和真实 Provider 探针。

## 4. 实施工作包

### P0：冻结基线和证据防伪

- 将对照范围固定为 tag `v1.5.7`；
- 生成 Windows v1.5.7 到当前 macOS/shared 的差异账本；
- 建立唯一产品功能账本并消除 88/93 等口径混用；
- 所有 receipt 写入 commit、dirty、source fingerprint、inventory、版本和产物哈希；
- dirty 工作树只能运行开发门禁，不得生成 L4～L6 release attestation；
- 既有绑定旧 commit 的 receipt 一律判 stale，不复制或改写。

退出条件：范围和账本可机器校验，旧证据不能被误用。

### P1：修复自动验收基础设施

- 修复本机/npm Runner 的 PATH，禁止落到 Node 16；测试启动器在 Node v24 已证明可用；
- 固定并校验 Node 22、npm lockfile 和 Python 3.11.9；
- 保证聚合命令可从仓库根、desktop workspace、macOS workspace 三处执行；
- 缺参数时给出明确失败，不产生底层 TypeError；
- 子门禁任一失败时聚合命令必须非零退出；
- 新增凭据 readiness 检查，只输出 PRESENT/MISSING、权限和可用性，不输出值；
- 新增证据 schema 和 stale/dirty/跨产物哈希拒绝测试。

退出条件：L0～L3 的每个 npm 入口可独立和聚合运行，结果稳定可解析。

### P2：功能账本逐项对齐

- 逐项运行 A～M 功能入口和服务闭环；
- 平台无关业务状态机留在 `shared/main`，macOS registrar 仅做安全注册和适配；
- 对真实不适用项使用显式 capability 和批准过的 platform exception；
- 禁止以空 handler、固定成功返回、renderer mock 或 Windows 证据代替 macOS 实现；
- 所有副作用通道覆盖输入 schema、超时、取消、幂等、审计、恢复和错误脱敏；
- 对工作区路径、文件 mutation、分享、网络、计算和秘密操作保持 fail-closed；
- 对 Keychain、Finder、Dock/menu、通知、TCC、PTY 和 relaunch 使用 macOS adapter。

退出条件：账本所有必选项 implemented，IPC parity 保持 100%，P0/P1 缺陷为 0。

### P3：真实服务与平台验收

- 使用真实 arm64 Runtime 验证 Gateway、聊天、Agent、Thread、Workspace、终端和 Browser；
- Keychain 验证保存、读取、替换、重启保留、删除、锁屏和损坏恢复；
- TCC 验证麦克风、通知和相关 usage description；
- Finder open/reveal、Dock/menu、deep link、单实例和退出清理；
- 睡眠/唤醒、offline/online、Runtime crash、App crash 和订阅恢复；
- SSH、远程工作区、端口转发和远端 host-key 安全；
- 真实发布 Provider（HepAI）模型目录与已启用模型探测，秘密不得进入日志或 receipt；OpenAI/Anthropic/DeepSeek/Ollama/chat-only/custom proxy 的配置兼容性由确定性 loopback 矩阵覆盖。

退出条件：L4 真机证据绑定当前 clean commit，所有关键恢复旅程自动通过。

### P4：最终产物、安装与升级

- 构建可复现 arm64 Runtime archive、SBOM、manifest 和 provenance；
- 构建签名 `.app`、DMG 和薄更新 ZIP；
- 执行 codesign strict、hardened runtime、notarization、staple 和 Gatekeeper；
- 干净用户安装、首次启动、登录和黄金任务；
- 覆盖安装及上一签名稳定版本升级到 v1.5.7；
- 损坏下载、摘要不符、启动失败和 Runtime 不兼容必须失败关闭；
- watchdog 回滚 App，但不降级、删除或回滚用户数据；
- 卸载只删除 App，除非用户显式确认全量本地数据清理。

退出条件：L5/L6 全绿，DMG/ZIP/App/Runtime 哈希和签名身份被同一 receipt 绑定。

## 5. 全自动验收架构

| 层级 | 自动检查 | 强制门槛 |
| --- | --- | --- |
| L0 静态 | typecheck、架构边界、schema/codegen、版本、IPC inventory、secret scan | missing=0，版本一致，秘密原值命中=0 |
| L1 单元/契约 | 状态机、正负输入、审批、错误码、超时、取消、幂等、回滚 | 每个副作用入口至少正向+拒绝+重复+恢复 |
| L2 组合 | service injection、registrar、Gateway、Runtime adapter、重启恢复 | 无 handler 空接线；capability/readiness 一致 |
| L3 Electron | 真实 UI、键盘、axe、视觉、中文、窗口、操作可达性 | serious/critical axe=0；无未实现入口 |
| L4 真机 | Keychain、TCC、Finder、Dock、PTY、通知、sleep/wake、网络 | 必须 darwin-arm64 真机 receipt |
| L5 Packaged | 最终 `.app`/DMG、Runtime、干净安装、升级、崩溃恢复 | 禁止 dev server 或 unsigned dir 代替 |
| L6 发布 | 签名、公证、staple、Gatekeeper、在线更新、回滚、OSS/网站 | 同一 commit/version/hash，P0/P1=0 |

### 5.1 稳定性矩阵

- 核心黄金任务连续 20 轮；
- 冷启动、登录/退出、重启、Runtime crash recovery 各 20 轮；
- 高风险审批拒绝副作用为 0，批准 exactly-once；
- 正常网、慢网、断网恢复；
- 干净用户、升级用户、Keychain 锁定/解锁；
- 默认 Retina、最小支持窗口、外接屏切换；
- 睡眠/唤醒 20 轮；
- 用户文件和成果前后 SHA-256 不变；
- 截图黑屏、无限 loading、未解析 i18n key、乱码和技术噪声为 0。

### 5.2 推荐统一入口

```bash
npm run verify:v1.5.7:source
npm run verify:v1.5.7:electron
npm run verify:v1.5.7:device
npm run verify:v1.5.7:packaged
npm run verify:v1.5.7:update
npm run verify:v1.5.7:release
npm run verify:v1.5.7:all
```

`verify:v1.5.7:all` 生成 JUnit、JSON ledger、截图、Accessibility Tree、性能数据、产物清单、签名/公证 receipt、commit/source fingerprint 和 go/no-go 结论。任何 required、gated 或 stale 项不得被统计为 passed。

## 6. 凭据与 Runner 准备

生产环境必须通过 GitHub Environment `macos-production-release` 或等价的受控 secret store 注入，不把秘密写入仓库、命令行参数或日志。

| 能力 | 所需配置 | 当前状态 |
| --- | --- | --- |
| Developer ID | `MACOS_CSC_LINK`、`MACOS_CSC_KEY_PASSWORD` | 缺失 |
| Apple 公证 | `APPLE_API_KEY`、`APPLE_API_KEY_ID`、`APPLE_API_ISSUER` | 缺失 |
| OSS | 固定版本 `ossutil`、0600 config、最小权限 RAM/STS | v1.7.19 和读取已通过；CSV 为 0644，写权限未验证 |
| GitHub Release | 可选备份渠道，不作为本次 OSS 发布硬门槛 | 本次可不配置 |
| GitHub Channel | `OPENDRSAI_GITHUB_CLIENT_ID` | 缺失 |
| Provider 矩阵 | HepAI OIDC 会话、`https://ai-dev.ihep.ac.cn/apiv2/v1` 与发布启用模型；其他 Provider 类型使用无外部凭据的确定性协议矩阵 | 本机 HepAI 会话与模型配置已存在 |
| 本地 App 凭据 | Keychain service `ai.drsai.desktop` | 未找到可确认条目 |

自动 readiness 脚本必须检查：变量存在但不输出值、证书有效期和唯一性、API key 文件 0600、Keychain put/get/delete、OSS stat、Provider 最小探针、Runner 标签、可用磁盘和网络。若启用 GitHub 备份发布，再检查 GitHub API 权限。真实写入或发布前仍需受控发布审批。

OSS 发布身份只允许读目标对象、创建当前版本不可变对象、创建 history/rollback 元数据以及覆盖唯一 stable key。不得获得 Bucket 全量删除或覆盖历史版本权限。

## 7. OSS 事务发布

Bucket 默认 `hepai-release`。v1.5.7 对象布局：

```text
releases/v1.5.7/macos/OpenDrSai-macOS-v1.5.7-arm64.dmg
releases/v1.5.7/macos/OpenDrSai-macOS-v1.5.7-arm64.zip
channels/stable/macos/arm64/OpenDrSai-macOS-v1.5.7-arm64.zip
channels/history/macos/arm64/v1.5.7/latest-mac.yml
channels/rollback/macos/arm64/before-v1.5.7/latest-mac.yml
channels/stable/macos/arm64/latest-mac.yml
```

发布顺序：

1. 验证本地签名产物和 update metadata；
2. 上传版本化 DMG、ZIP、stable 版本化 ZIP 和 history metadata，全部禁止覆盖；
3. 对 OSS/CDN 执行 HEAD、Range、Content-Length、SHA-256；
4. 快照旧 stable metadata；
5. 最后原子晋级 `latest-mac.yml`；
6. 验证 stable OSS/CDN；失败则自动恢复旧 metadata；
7. 验证 `opendrsai-dev.ihep.ac.cn` 的发布后入口；
8. 归档发布和回滚 receipt，不删除版本化资产。

GitHub Release 仅作为可选备份渠道，不是本次发布的硬性依赖。生产 workflow、晋级策略和发布后校验已实施 OSS-only；`prepare-previous-release.mjs` 已从 stable OSS/CDN metadata 解析、分段下载、摘要校验和展开上一签名 App。v1.5.3 的真实基线下载与严格验签已通过。

`publish-update-to-oss.mjs` 的静态事务测试、`ossutil 1.7.19`、真实 stable 读取以及 validation 前缀隔离写/读/删探针均已通过。stable 晋级仍必须等待签名候选的 L4～L6 全绿后才允许执行。

## 8. `opendrsai-dev.ihep.ac.cn` 发布验证

仓库当前更新源是 `https://download-opendrsai.ihep.ac.cn/`。本次不单独部署 `opendrsai-dev.ihep.ac.cn`：发布动作只写阿里云 OSS，`opendrsai-dev.ihep.ac.cn` 仅作为发布后的线上入口验收。2026-08-12 实测该域名 HTTPS 返回 200，stable macOS 元数据经 OSS/CDN 返回 200 并支持 Range。

无论部署方式为何，最终自动验收至少包括：

- DNS、TLS、证书链、SNI、HTTP 200 和重定向；
- 页面显示 v1.5.7、Apple Silicon 和正确文件名；
- 下载链接指向版本化不可变对象，不能只指向可变 latest；
- HEAD、Range、Content-Length、cache-control 和 SHA-256；
- 下载 DMG 后执行 mount、codesign、stapler、spctl 和 App 版本检查；
- `latest-mac.yml` version/path/SHA-512/size/Runtime metadata 校验；
- 上一签名版本从线上 feed 检测、下载、安装、重启到 v1.5.7；
- 网站、OSS/CDN、App About 和 update metadata 版本及摘要一致；仅在启用备份渠道时额外校验 GitHub Release；
- 页面不得残留旧 Windows/Android/macOS 版本硬编码。

建议新增：

```bash
npm run verify:website-release -- \
  --origin https://opendrsai-dev.ihep.ac.cn \
  --download-origin https://download-opendrsai.ihep.ac.cn \
  --version 1.5.7 \
  --arch arm64
```

网站验证失败不得把发布标记为完成。若仅网站页面失败且 stable feed 正常，应回滚网站入口；若 feed/资产失败，应回滚 stable metadata。

## 9. Go/No-Go

仅当以下全部满足才可发布：

- v1.5.7 唯一功能账本冻结并全通过；
- clean release commit，版本、tag、Runtime 和元数据一致；
- Node 22 和固定依赖可复现；
- L0～L6 全绿，P0/P1 为 0；
- IPC parity 100%，不存在空 handler 或假成功；
- Keychain/TCC/PTY/Finder/sleep-wake 真机通过；
- Developer ID、公证、staple、Gatekeeper 通过；
- 干净安装、在线升级、失败回滚和用户数据保护通过；
- OSS/CDN 与本地产物字节一致，stable 晋级可回滚；GitHub 仅在启用备份渠道时参与一致性检查；
- `opendrsai-dev.ihep.ac.cn` 页面和最终下载验收通过；
- 所有 receipt 绑定同一 commit、version 和产物哈希。

当前结论：**No-Go（已进入签名候选阶段）**。Node 22/PATH、Developer ID 真实签名、Apple 公证认证、OSS AccessKey 0600、OSS 隔离读/写/删权限、OSS-only 工作流和上一稳定版基线均已通过。剩余阻塞是 clean release commit、签名/公证最终产物的 L4～L6、从 v1.5.3 真实在线升级与回滚证据，以及最终 OSS stable 晋级和线上验证。

## 10. 实施进度（2026-08-12）

- 工具链：固定 Node `22.23.2`，npm `10.9.8`，增加 `.nvmrc`、package engines 和入口 fail-fast 校验。
- L0～L3：功能账本与 IPC parity 为 `374/374/374`；67/67 套件全通过；共享业务行覆盖率 `88.93%`，核心状态机分支 `90.4%`，adapter `59.37%`；开放 P0/P1 为 0。
- 签名准备：P12 证书与私钥匹配，证书有效期到 2027-02-01；临时 Keychain 导入、hardened runtime 签名、严格验签与 `notarytool history` 均通过；预检状态为 `ready-to-build-signed-rc`。
- OSS 准备：`ossutil 1.7.19`，AccessKey CSV 已收紧到 `0600`；stable 读取和 validation 前缀隔离创建/读取/删除探针通过，不触碰 stable 或版本化资产。
- OSS-only：生产 workflow、晋级策略、发布后校验和上一版准备均已移除 GitHub Release 硬依赖。
- 上一版基线：已从 OSS/CDN 真实下载 v1.5.3 ZIP，验证 metadata size/SHA-512、解包和 `codesign --verify --strict`。
- 自动验收入口：已实现 `verify:v1.5.7:{source,electron,device,packaged,update,release,all}`，逐命令生成 JSON/JUnit，并绑定 commit、source fingerprint 和 App executable SHA-256；任一 required/gated/stale 项失败即停止。
- 稳定性矩阵：正式 L5 已扩展为核心黄金任务、登录/退出、Runtime 与 Native Helper 强杀恢复各 20 轮，继续强制 100 次 App 重启和两小时浸泡；正常、慢速、中断、离线/在线恢复均形成结构化证据。
- 真机矩阵：睡眠/唤醒默认执行 20 轮，可由 `pmset` 定时自动唤醒，逐轮验证事件顺序、Gateway 恢复、零残留进程和用户数据 SHA-256；隔离 Keychain 锁定/解锁/删除生命周期已动态通过且不记录秘密。
- L6 防伪：新增 `stability-matrix.json` 聚合门禁；L6 强制纳入 HepAI 统一平台真实目录与发布模型流式探针、Keychain、20 轮睡眠/唤醒和自动化 TCC Notification `show` 事件，不再接受人工点击确认或旧收据。六类 Provider 形态继续由 15 项确定性 loopback 探针覆盖，不虚构六套生产部署。
- 当前剩余：提交并重建上述自动化对应的最终签名/公证候选，重跑 L4～L6、v1.5.3 在线升级/回滚、OSS 晋级及线上验证。真实 Provider 门禁改为使用本机安全存储中的 HepAI OIDC 会话，对 `ai-dev.ihep.ac.cn/apiv2/v1` 的 `deepseek-v4-flash`、`deepseek-v4-pro`、`gpt-5.6-luna` 执行目录与流式响应验证；GitHub 不是硬门槛。
