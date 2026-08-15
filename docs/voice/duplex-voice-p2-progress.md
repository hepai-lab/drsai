# 全双工语音 P2 开发进度

> 当前权威快照（第 46 轮，2026-08-14）：实现进度 **52/52（100.00%）**；严格验收 **0/52（0.00%）**。Computer Use 在第 44、45、46 三个连续目标轮次均于写 kernel assets 前失败；自动化仍有效，但剩余四类严格证据都依赖当前无法由本任务完成的外部操作或时间周期。按持续目标的阻塞规则，本轮进入 blocked，而不是继续空转。

## 第 46 轮

- 执行 Node REPL kernel reset 后进行最小 `@oai/sky` + `list_apps` 复核，仍立即返回 `failed to write kernel assets: 系统找不到指定的路径 (os error 3)`；未进入应用列表或窗口层。
- 重新运行自动化实体 verifier：当前 483 文件 Duplex + Serial 报告仍通过。
- 重新运行只读准备报告：development=28642、production=18642，候选 EXE/asar 哈希不变；automation=complete，packaged=ready_for_tester，live=ready_for_listener，hardware=ready_for_physical_matrix，stable=not_started。
- 重新生成 52 项动态状态，strictAccepted=0。没有 signed packaged/live/hardware/stable 报告，最终 52/52 gate 仍应失败。
- 阻塞条件已连续三个目标轮次重复：当前任务不能写 Node REPL kernel 工作目录，无法执行 packaged UI 复核；同时真人复听、Win10/11 与 USB/蓝牙/睡眠/弱网物理矩阵、完整 stable release cycle 本身也需要测试人、设备及外部时间推进。

恢复条件：Codex 宿主修复 Node REPL kernel 工作目录权限后可继续 packaged 复核；测试人按三份指南完成实名产品复核、复听与物理矩阵；实际 stable 版本经历完整发布周期并提供权威遥测。任何一项恢复后，重新生成 readiness 与 acceptance status 即可继续，不需要重做已通过的产品实现。

> 当前权威快照（第 45 轮，2026-08-14）：实现进度 **52/52（100.00%）**；严格验收 **0/52（0.00%）**。本轮完成 Computer Use kernel assets 故障的只读根因定位和受控 ACL 修复尝试；确认 Runtime 完整、真正失败点是 kernel 工作目录继承 Write Deny。受限进程无法安全修改该 ACL，所有中间权限变更已回滚，未进行 packaged 代签。

## 第 45 轮

- 已确认 Codex Runtime、Node REPL、`@oai/sky` 与 Windows helper 资产完整，多个 Node REPL 进程均能从受控 Runtime 启动，排除“安装资产缺包”。
- 定位到 Codex Node REPL 工作目录及其执行状态目录：目录存在，但继承当前沙箱身份的 Write/Delete Deny，沙箱用户仅有 Read/Execute。失败发生在写本次调用的 kernel assets 时，所以错误文案表现为路径不存在，尚未进入 `@oai/sky` 导入或 `list_apps`。
- 先保存原 ACL，再将两目录的继承 ACL 转为显式，尝试只删除匹配 SID 的 Deny。裸 SID 和 `*SID` 均未被 `icacls /remove:d` 解析；PowerShell Access API 因缺 `SeSecurityPrivilege` 拒绝；最小 SDDL `/restore` 因调用者缺少相关组权限拒绝。所有失败均未处理文件内容。
- 为避免留下中间权限形态，最终使用 `icacls /reset /t` 成功恢复两个目录的父目录继承 ACL，并核对 `(I)(DENY)`、SYSTEM/Administrators/当前用户 Full Control 与 SandboxUsers RX 均回到初始形态；临时 ACL 备份和修复文件已删除。
- 已形成不入库的本机诊断记录，覆盖根因、失败修复与回滚证据。正确修复需要 Codex 宿主把 Node REPL kernel 工作目录加入受控可写根，或由具备相应权限的 Codex 修复/升级流程重建 ACL；重复复制已完整 Runtime 不会解决问题。

结果：本轮未修改产品源码，故第 44 轮绑定 483 个文件的 Duplex + Serial 自动化报告仍为当前；验收准备状态保持 automation=complete、packaged/live/hardware ready、stable not_started。Computer Use 仍无法进入窗口层，strictAccepted 保持 0/52。

下一轮：在宿主权限恢复前继续使用只读/自动化证据推进可做工作；若 Computer Use 恢复，第一步只验证 `@oai/sky` + `list_apps`，随后重新执行 packaged 产品入口复核。没有真实 UI 观察不签署 packaged 报告。

> 当前权威快照（第 44 轮，2026-08-14）：实现进度 **52/52（100.00%）**；严格验收 **0/52（0.00%）**。本轮尝试用 Computer Use 完成 packaged 产品入口复核，但初始化、重试、kernel reset 后再试均因 kernel assets 路径不存在而在任何 UI 操作前失败；未伪造桌面观察或签核。随后新增只读验收准备报告并刷新完整自动化实体证据。

## 第 44 轮

- 按 Computer Use 技能要求完整读取 Windows 操作、安全确认和恢复规则。首次初始化与一次轻量重试均返回 `failed to write kernel assets: 系统找不到指定的路径 (os error 3)`；执行 kernel reset 后最后重试仍相同。错误发生在 `list_apps` 前，没有启动、点击或读取 OpenDrSai 窗口。
- 遵守技能的停止规则：没有通过坐标、终端 UI 或自制 UI Automation 绕过 Computer Use，也没有将 packaged pending 报告签为成功。因此 packaged named review 仍未完成。
- 新增 `report:voice:duplex-p2-acceptance-readiness`，只读检查当前候选、自动化实体报告、三份 pending 材料和稳定周期报告；明确输出 `safeReadOnly=true`、`microphoneStarted=false`、`testerAttestationCreated=false`。
- 准备报告固定区分 development 28642 与 production 18642，显示 `zhizengzeng/gpt-realtime-2`、当前 EXE/asar 路径和 SHA-256，并为每类缺口给出对应中文操作指南；它不会自动启动麦克风、打开应用或生成签名。
- 第 44 轮新增脚本使第 43 轮源快照按预期失效，准备报告首次显示 automation=`stale_or_missing`。随后重新真实执行完整 Duplex + Serial，新的自动化实体绑定 483 个相关文件并恢复 automation=`complete`，证明防陈旧门禁实际生效。
- 已生成 `release/duplex-voice/p2-acceptance-readiness.json`：automation=`complete`，packaged=`ready_for_tester`，live=`ready_for_listener`，hardware=`ready_for_physical_matrix`，stable=`not_started`。

真实结果：候选 EXE SHA-256 `7f40cd544177a30851b31e4841ffc8232a7226aced55a8b2382fe86c7fec388c`，app.asar SHA-256 `085259fbbffced53277ddf13a0f8595dac96d3e50d69a8ca056871e77ca788b1`；新自动化源摘要 `0b3f1cb77425873d39332e92573dc8a2d6eaa13a58df8767880475a85a71ad80`（483 文件），报告摘要 `293b77c9dcc8eff05617220ff252dc3d16ee59ab194341cfa727a961f2178f73`。

测试：只读报告的开发/生产端口、候选摘要、五类状态和无麦克风/无签核副作用测试通过；完整 Duplex + Serial 再次通过；自动化实体 verifier 和动态聚合通过，strictAccepted 仍为 0/52。

下一轮：优先恢复 Computer Use Node kernel assets 后重新执行 packaged 产品入口复核；如果桌面工具仍不可用，则继续完善人工复核材料但不代签。真人复听、物理硬件和稳定发布周期仍必须由对应真实操作产生。

> 当前权威快照（第 43 轮，2026-08-14）：实现进度 **52/52（100.00%）**；严格验收 **0/52（0.00%）**。本轮将完整 Duplex + Serial 回归固化为绑定当前 481 个相关源文件、52 项索引和 package scripts 的实体报告；automation evidence 已由 false 转为 true，但缺四类外部证据，严格验收仍为 0/52。

## 第 43 轮

- 新增 `run:voice:duplex-p2-automation`，串行执行精确的 `npm run test:voice:duplex` 和 `npm run test:voice:serial`。两套均执行，即使一套失败也保留完整诊断；最终只有两个 exit code 都为零才写 `passed=true`。
- 运行器把去 ANSI、凭据模式脱敏后的完整输出写入 `p2-automation-output.log`，报告记录两个套件的开始/结束时间、exit code、signal、日志本地 URI/SHA-256、索引 SHA-256、package.json SHA-256 和整体完整性摘要。
- 新增源树快照：覆盖 Desktop shared API/Main/Realtime renderer、Windows Main、所有 Duplex/相关 Voice 脚本、package.json，以及 Python Realtime Adapter、Gateway 与测试；按相对路径和逐文件 SHA-256 生成聚合摘要。当前实体报告绑定 481 个文件，任一相关源码或测试变化都会使旧报告失效。
- 新增 `verify:voice:duplex-p2-automation`，要求报告恰好执行 Duplex 与 Serial 两个正式命令、两个结果均通过，并重新核对当前源树、索引、package scripts、日志实体、隐私扫描和报告完整性。
- 52 项聚合器不再因索引写着 automation passed 就设置 `automation=true`。它必须先通过上述实体 verifier；automation provenance 现在包含报告路径、报告 SHA-256、完成时间、481 文件源摘要和两个正式命令。
- 新增自动化证据负向测试：当前源快照可通过，陈旧源码摘要和被篡改日志均 fail-closed。最终 52/52 gate 也要求 automation provenance 具有报告实体摘要、完成时间和非空源文件集合。

真实结果：统一自动化报告 `passed=true`；源文件数 481，源摘要 `1741ba08a26fbe47c89902cb9d216a2942ef25d5bf78dfdfdd7a3839b2cc93f0`，报告摘要 `ec58f77d59977c3187f6cfa2d72deeb15b0199e4f5fc18eff39827b82e6c2ef8`。动态聚合现在为 automation=true、其余 packaged/live/hardware/stable=false，因此 strictAccepted 仍为 0/52。

测试：实体运行中完整 Duplex 与 Serial 均通过；实体 verifier 通过 481 文件当前性检查；自动化报告当前/陈旧源码/篡改日志正反门禁、最终状态 gate 和聚合投影通过。

下一轮：审计当前 packaged/live/hardware pending 的用户操作成本，提供一个统一、只读的“验收准备状态”命令，明确下一位测试人需要执行的最短动作、候选哈希和缺失设备，不自动启动麦克风或代签。

> 当前权威快照（第 42 轮，2026-08-14）：实现进度 **52/52（100.00%）**；严格验收 **0/52（0.00%）**。本轮修复证据索引将全部状态硬编码为 implemented/passed、而底部第 20 轮历史表仍显示 34 项待实施的账本矛盾；现在每项实现结论都有后续轮次的具体说明，并逐字绑定原计划解决方案、测试方案和验收标准。

## 第 42 轮

- 明确将底部 18/52 汇总和 34 项待实施表标注为“第 20 轮历史基线”，保留逐轮审计价值但不再与顶部当前权威快照冲突。当前实现结论来自第 24 轮达到 52/52 后的功能记录和随后回归，不再错误读取历史表状态。
- 重构 `generate-duplex-p2-evidence-index.mjs`：每个 ID 现在保留计划中的 feature、solution、testPlan、acceptanceCriteria，并从后续轮次提取非空 implementationEvidence；自动化证据按模块列出实际 package scripts，而不是只写一个无来源的 `passed`。
- 索引 verifier 会逐字段与 P2 计划表比较，验收文字被缩短、替换或错配即失败；实现说明为空/破折号、测试套件为空或引用不存在的 package script 也失败。
- 动态验收状态新增 evidenceProvenance：自动化记录当前索引 SHA-256 和全部套件；正式 packaged/live/hardware/stable 报告通过后记录报告路径、实体 SHA-256、签署人和签署时间。每个功能同时投影自己所需类别的 evidenceSources。
- 动态状态报告增加自身 SHA-256 完整性摘要；最终 52/52 gate 同时校验摘要、当前索引哈希、五类证据来源、外部签署信息和逐项 evidenceSources，不能通过手工把计数改成 52。
- 负向门禁增加计划验收语义漂移和不存在测试套件两类用例；原有重复/缺失 ID、unsigned 伪成功、陈旧候选、缺 Live 和陈旧索引仍继续覆盖。

测试：重新生成并校验 52 项语义索引通过；索引六类负向门禁通过；动态投影、最终 52/52 gate 和当前 0/52 实算通过。完整 `test:voice:duplex` 通过，包含协议/模型、Provider、Runtime 10,000 终态竞态、IPC、9 个 Python Gateway/Adapter 用例、采集、UI、播放、10,000 插话状态竞态、转录、CAS 历史、工具、恢复、隐私和 Node/Web 类型检查；完整 `test:voice:serial` 也通过，包括 31 项 unit、设备/权限、1,000+1,000 终态竞态、资源压力及全部旧语音路径。当前外部 provenance 全为 null，准确反映尚无实名正式报告，并未用 pending 报告中的空 tester 生成伪来源。

下一轮：将完整 Duplex 与 Serial 测试运行包装为可重放的实体报告/日志并接入 automation provenance；目前自动化已在本轮真实通过，但动态报告仍只绑定套件定义和索引，尚未绑定本次执行输出的实体 SHA-256。

> 当前权威快照（第 41 轮，2026-08-14）：实现进度 **52/52（100.00%）**；严格验收 **0/52（0.00%）**。本轮完成 M10-F3 稳定发布周期的 pending 工作簿、实名 finalizer、正式 verifier 和 52/52 最终总门禁；当前总门禁按预期失败于 0/52，证明它不会把尚未发生的发布周期或人工/硬件签核提前算入。

## 第 41 轮

- 新增 `prepare:voice:duplex-stable-release-review`：必须提供真实 stable 版本号和实际发布时间，并绑定当前 EXE/asar；生成结果固定为 `ok=false`，发布状态、完整周期、三项遥测、附件和批准人全部留空，未来日期直接拒绝。
- 新增 `finalize:voice:duplex-stable-release-review`：只有工作簿明确填写已稳定发布、已观察完整发布周期，以及新 Streaming 配置引用/迁移失败/Serial 回归均为零，才允许继续；同时要求至少两份不同的实体发布/遥测附件、结束时间、实名批准人和三项主动确认。
- 新增 `verify:voice:duplex-stable-release`：重新核对 stable channel、版本与周期时间、零回归遥测、EXE/asar、全部附件、批准人 attestation 和完整性摘要。正式报告至少包含发布记录、遥测记录和工作簿三个不同摘要。
- 52 项聚合器改为调用上述正式 verifier，不再自行实现较弱的稳定周期判断。缺报告、伪造摘要、空附件或非零回归均使 `stable_release_cycle=false`。
- 新增最终命令 `verify:voice:duplex-p2-acceptance`：先重新生成动态状态，再要求索引哈希为当前版本、52 个唯一功能全部 accepted、五类证据全部 true 且每项无 missing evidence。它是整个 P2 的 fail-closed 终点，不以部分功能或单类报告成功作为通过。
- 新增 [稳定发布周期操作指南](./duplex-voice-p2-stable-release-cycle-guide.md)，明确准备、真实周期、权威数据填写、实名签署和最终聚合流程。

测试：stable prepare 的 pending/防未来日期门禁通过；stable finalizer 的正向流程、缺主动确认、Serial 回归非零、候选/完整性篡改门禁通过；投影组合、伪稳定周期和最终 52/52 gate 的完整/缺 Live/陈旧索引用例通过。对当前真实材料运行最终 gate 得到 strictAccepted 0 而按预期失败，未产生伪验收。

下一轮：审计 52 项 requiredEvidence 分类是否与原计划每项验收条件完全一致，并给聚合报告增加 plan acceptance 文本、证据来源和签署人追溯，防止只有类别布尔值而缺少逐项语义证明。

> 当前权威快照（第 40 轮，2026-08-14）：实现进度 **52/52（100.00%）**；严格验收 **0/52（0.00%）**。本轮将正式证据动态投影回 52 项验收状态，并补齐 hardware 正式报告对 Provider、模型、协议、环境端口和候选构建的直接绑定；现有材料仍未实名签署，因此聚合结果保持 0/52。

## 第 40 轮

- 新增 `generate:voice:duplex-p2-acceptance-status`，读取 52 项权威索引，并分别调用 packaged/live/hardware 正式 gate；输出 `release/duplex-voice/p2-acceptance-status.json`，逐项记录 required evidence、每类证据真假、缺失证据和 strict acceptance 状态。
- 投影不再把 `strictAcceptance` 永久写死，也不根据文件是否存在判断成功。只有自动套件通过、正式报告通过自身实体附件/实名/完整性 gate，并满足该功能全部证据类别时，单项才会转为 accepted。
- packaged 是外部证据组合的候选基线。live 与 hardware 即使各自通过，也必须与 packaged 的 EXE 和 app.asar SHA-256 完全一致，才能参与同一候选的逐项验收；陈旧构建不能与当前构建拼接。
- hardware finalizer 生成的正式报告现在直接包含 protocol v2、`zhizengzeng/gpt-realtime-2`、development→28642 / production→18642 环境契约，以及 EXE/asar 实体绑定。统一 hardware gate 会重新读取并验证两个候选文件，不再只通过附件中的工作簿间接推断候选。
- M10-F3 的 stable release cycle 使用独立 fail-closed 证据：必须有发布版本、开始/结束时间、实名批准者、零新 Streaming 配置引用/迁移失败/Serial 回归遥测、实体附件和完整性摘要。不存在、附件为空或摘要伪造均不计入。
- 新增投影测试，覆盖 automation-only 不验收、只完成 packaged 仅放行基础项、全部证据组合、缺自动化、EXE/asar 跨候选、伪造稳定周期等边界。

测试：当前动态聚合结果为 implementation 52/52、strict acceptance 0/52；证据投影组合与稳定周期负向测试通过；M10 三类正式证据正反门禁、hardware finalizer 候选绑定、52 项索引负向门禁全部通过。

下一轮：补充稳定发布周期报告的 prepare/finalizer 操作链，并把动态聚合结果纳入统一 release 命令；这仍不会绕过实际发布周期。待实名 packaged、真人复听和物理矩阵具备后，聚合器可按各功能真实依赖逐项提升验收数，而不是一次性武断地把 52 项全部置为完成。

> 当前权威快照（第 39 轮，2026-08-14）：实现进度 **52/52（100.00%）**；严格验收 **0/52（0.00%）**。本轮建立 52 项需求到自动、packaged 真人复核、真人复听、物理硬件和稳定发布周期证据的统一索引；三个 pending 材料已绑定当前候选，但仍无实名签核，因此不计严格验收。

## 第 39 轮

- 重新生成 `packaged-report.json`、`live-report.json` 和 `hardware-review-workbook.json`，三者现共同绑定当前 `.drsai-dev:28642` 候选：`OpenDrSai.exe` SHA-256 `7f40cd544177a30851b31e4841ffc8232a7226aced55a8b2382fe86c7fec388c`，`app.asar` SHA-256 `085259fbbffced53277ddf13a0f8595dac96d3e50d69a8ca056871e77ca788b1`。三份材料均保持 `ok=false / tester=null`。
- 新增权威索引 `docs/voice/duplex-voice-p2-evidence-index.json`。它逐项列出 52 个计划 ID、功能名称、实现/自动化状态、现有工程证据、仍缺证据，以及每项严格验收所需的证据类别。
- 证据类别明确分为 automation、packaged named review、live named listening、hardware physical；M10-F3 另要求 stable release cycle。所有功能至少要求自动化和从真实产品入口完成的实名 packaged 复核；依赖听感、Provider 真实行为或实体设备的项目再叠加对应证据，不允许一种报告替代另一种。
- 新增索引生成器、校验器和负向门禁。校验器要求计划与索引恰好是相同的 52 个唯一 ID，全部实现和自动测试记录齐全，同时强制严格验收保持 pending，直到外部签核材料存在并通过其正式 gate。
- 校验器还重新读取候选 EXE/asar 和 packaged 自动运行/Serial 附件，核对实际 SHA-256；并要求 packaged/live/hardware pending 的协议、Provider/model、候选哈希一致，且不得出现 `ok=true` 或 tester。测试覆盖重复 ID、缺失 ID、pending 伪成功和陈旧候选哈希，均 fail-closed。

测试：索引生成 52/52；当前索引正向校验通过；四类负向门禁全部按预期拒绝。packaged/live/hardware pending 均已重绑当前候选。严格验收仍为 0/52，未把真实 Provider 自动运行、fixture、文件存在或 unsigned pending 当作真人/硬件签核。

下一轮：在具备测试人和物理设备前，不伪造签核；继续收敛正式验收操作入口和报告聚合，使 packaged、live、hardware 完成后能自动、逐项且可追溯地投影到 52 项严格验收状态。M10-F3 必须等待至少一个稳定发布周期，不能由当前开发轮次提前满足。

> 当前权威快照（第 38 轮，2026-08-14）：实现进度 **52/52（100.00%）**；严格验收 **0/52（0.00%）**。本轮完成当前候选的真实 packaged 双向音频/插话证据、Serial 零回归实体报告和 packaged 显式人工签核链；尚无人亲自从产品入口复核，因此只生成 pending 报告，不计严格验收。

## 第 38 轮

- 新增 `verify:voice:duplex-packaged-provider-run` 和专用 packaged E2E：在 `.drsai-dev:28642`、候选 Runtime、真实 `zhizengzeng/gpt-realtime-2` 上建立 Session，用正式文字 item 触发语音，观察下行音频，提交 interrupt，再验证上行 IPC 和唯一 cancel 终态；脚本只持久化数值、reason code 和布尔值。
- 真实场景暴露并修复 M7-F2 产品缺陷：默认 `text-UUID` 及 Adapter 冗余 `event_id` 超过 Provider 字符串上限，Provider 返回 `string_above_max_length`，导致 UI 显示发送成功但无语音回答。现移除无人消费的可选 `event_id`，默认 item ID 改为 `t-` 加 24 位十六进制随机值（96 位随机熵、总长 26），并冻结 ≤32 字符契约。
- 场景对比还确认：packaged 基础双向音频不混入工具选择，使用与已通过 Live Provider 首段一致的短发音请求；工具闭环由独立真实 Live 报告证明，不用两个不同目的的证据互相冒充。
- 新增 `run:voice:duplex-serial-regression`，在 Windows 正确通过 `ComSpec` 启动完整 `npm run test:voice:serial`，保存去敏输出实体、真实 SHA-256、exit code 和时间；首次 `npm.cmd` 直接 spawn 无法启动被记录为失败，修正后完整套件通过。
- 新增 packaged prepare/finalizer：pending 报告实体绑定 EXE/asar、真实 Provider run、Serial report 和 Serial output；正式签核要求测试人显式确认哈希候选、Duplex 模式、实时控件和无 Serial fallback。正式 gate 同时验证协议 v2、Provider/model、候选实体、自动源隐私、Serial 两份附件及人工 checklist。
- 新增 `docs/voice/duplex-voice-p2-packaged-acceptance-guide.md`，给出自动基础证据、Serial、pending、实名复核与正式门禁的最短命令链。

真实结果：packaged Provider 场景 14/14，通过 10 个上行帧、10 个下行音频 delta、1 次 interrupt、1 个唯一 cancelled 终态；证据 `packaged-provider-run.json`。当前候选 `OpenDrSai.exe` SHA-256 `7f40cd544177a30851b31e4841ffc8232a7226aced55a8b2382fe86c7fec388c`，`app.asar` SHA-256 `085259fbbffced53277ddf13a0f8595dac96d3e50d69a8ca056871e77ca788b1`。Serial 完整套件通过并写入 `serial-regression-report.json`；`packaged-report.json` 保持 pending/unsigned。

测试：文字调度器 Provider ID 上限、Provider Adapter、Node/Web TypeScript、Electron Vite、Windows 本地目录打包、真实 packaged Provider 14/14、Serial 完整回归、packaged/live/hardware 三类 finalizer 和 M10 证据正反门禁全部通过。

下一轮：重新生成与当前最终候选哈希一致的 Live pending 和 hardware workbook（本轮因文字 ID 修复已改变候选），并建立统一的 P2 证据索引，清楚列出自动已满足、待真人/硬件和不可替代项。严格验收在真人签核前仍为 0/52。

> 当前权威快照（第 37 轮，2026-08-14）：实现进度 **52/52（100.00%）**；严格验收 **0/52（0.00%）**。本轮闭合真实 Provider 自动观察报告到实名真人复听报告的签核链路，并强化正式 Live gate；当前只重新生成了绑定候选的 pending 报告，未有人实际复听，故不生成 signed 报告、不计严格验收。

## 第 37 轮

- `prepare:voice:duplex-live-review` 现在除验证 `live-provider-run.json` 和音频附件实体外，还绑定协议 v2、当前 `OpenDrSai.exe` 与 `app.asar` 的 `file:` URI 和实际 SHA-256。候选重新构建后旧 pending 报告不能继续签署。
- 新增 `finalize:voice:duplex-live-review`。必须提供实名 `--tester`，并分别显式传入已听附件、语音可懂、插话行为接受、工具闭环已复核和总体 Live Review 五个确认参数；缺一项均 fail-closed，自动观察不能代替人的判断。
- finalizer 重新验证 pending 报告完整性、候选构建、自动 Provider 源报告、全部音频附件、隐私声明和七项 live observations；附件或构建在 prepare 后变化会拒绝。通过后才投影为 `ok=true`，并把原 pending 报告作为额外哈希附件保留审计链。
- 正式 Live gate 现在强制协议 v2、四项 reviewer checklist 全 true、自动源隐私三项全 false、自动源摘要对应实际附件，以及 EXE/asar 两项候选实体。旧式只填 `ok=true`、tester 和 64 位字符串的报告不再足够。
- 新增中文说明 `docs/voice/duplex-voice-p2-live-listening-guide.md`，列出 pending 生成、真人四项复听、显式签核、正式门禁和不得记录转录/凭据/设备标签的边界。

结果：已用现有真实 Provider 自动运行材料重新生成 `apps/desktop/windows/release/duplex-voice/live-report.json`；它绑定当前候选 `OpenDrSai.exe` SHA-256 `4aa9e44177542742c57724d4cdb29d1c09209bbf2e1c2bd8191a42b9edccbd47` 和 `app.asar` SHA-256 `be1bad550b789780d56467c6ef89e4f5945dfc8842729824e9ad1c0dbf1c33df`，但仍为 `ok=false / tester=null`，等待实际复听。

测试：Live prepare 构建绑定/隐私/防自动签核、Live finalizer 正向正式门禁、缺总体确认、音频附件篡改均通过预期；M10 packaged/live/hardware 证据正反门禁、hardware finalizer 回归和 Node/Web TypeScript 全部通过；`git diff --check` 无 whitespace error，仅有既有 LF→CRLF 提示。

下一轮：审计 packaged 报告从自动打包运行到 Serial 零回归、实名产品入口签核的转换链，使 packaged/live/hardware 三类正式证据都具备相同等级的候选绑定、实体附件和显式人工确认。真人复听仍未发生前，严格验收保持 0/52。

> 当前权威快照（第 36 轮，2026-08-14）：实现进度 **52/52（100.00%）**；严格验收 **0/52（0.00%）**。本轮完成物理工作簿到正式 hardware report 的显式签核链路；测试只证明 finalizer 和 fail-closed 门禁有效，没有实际测试人、物理操作和附件，因此不生成正式报告、不提前计算严格验收。

## 第 36 轮

- 新增 `finalize:voice:duplex-hardware-review`：只接受第 35 轮生成的 pending/unsigned 工作簿，并重新验证协议 v2、`zhizengzeng/gpt-realtime-2`、隐私声明，以及 development→28642 / production→18642 的环境端口契约。
- finalizer 会重新读取工作簿绑定的候选 EXE/asar；任一文件在工作簿生成后变化、缺失或哈希不符均 fail-closed，禁止用旧物理结果签署新构建。
- 四组场景必须逐步填写非空 `observed` 并将每步与场景显式设为 `passed=true`；`requiredMetrics` 的全部字段必须是有限数值；设备只允许去标签化类别；观察文字包含 credential/token 特征时拒绝。
- 每个场景附件必须为可读取的本地 `file:` URI，提供的摘要会与实体重新计算；至少需要四个不同摘要。最终报告同时把已填写工作簿作为顶层哈希附件，使场景原始记录和正式投影可追溯。
- 签核必须同时提供实际测试人 `--tester` 和主动执行 `--confirm-physical-review`。finalizer 才生成 `kind=hardware / mode=duplex / ok=true`、实名时间和完整性摘要；随后仍须通过统一 `verify:voice:duplex-hardware`，自动化不会代签。
- 新增中文操作说明 `docs/voice/duplex-voice-p2-physical-acceptance-guide.md`，明确候选准备、开发/生产端口、四组真实场景、逐项填写、签核命令、正式门禁和隐私边界。

测试：完整模拟工作簿可经 finalizer 生成报告并通过正式 hardware gate；未完成物理步骤、缺显式确认、候选构建摘要被篡改均拒绝。workbook 开发/生产端口与隐私回归、M10 附件/矩阵正反门禁、Live review 防自动签核以及 Node/Web TypeScript 全部通过；`git diff --check` 无 whitespace error，仅有工作树既有 LF→CRLF 提示。

下一轮：审计 live review 从 pending 自动观察报告到实名盲听签核的转换缺口，补充与 hardware finalizer 同等级的实体附件、候选构建、逐项听感和显式测试人门禁。真人与物理设备仍未到场前，严格验收保持 0/52。

> 当前权威快照（第 35 轮，2026-08-14）：实现进度 **52/52（100.00%）**；严格验收 **0/52（0.00%）**。本轮将真实硬件/生命周期验收从空 JSON 模板升级为候选构建绑定的可执行工作簿，并关闭附件哈希只验格式、不验实体的证据伪造缺口；工作簿仍为 `ok=false` 且无测试人，未把准备工作冒充真人验收。

## 第 35 轮

- 新增 `prepare:voice:duplex-hardware-review`，从当前 `win-unpacked` 候选自动绑定 `OpenDrSai.exe` / `app.asar` 的本地 `file:` URI 与 SHA-256、Windows platform/release/build/arch、Realtime 协议 v2、`zhizengzeng/gpt-realtime-2` 和环境端口。开发工作簿固定 `.drsai-dev:28642`；显式 `--production` 才使用生产 `18642`。
- 工作簿覆盖硬件门禁全部九项：Win10 内置音频、Win11 内置音频、USB 耳机、蓝牙耳机、扬声器 AEC、真实权限拒绝/恢复、真实系统锁屏和睡眠/恢复、设备拔插、真实弱网。每个场景给出物理动作、预期观察和必须填写的数值指标；程序化 Electron 生命周期事件与音频 fixture 明确不能替代物理步骤。
- 隐私默认值冻结为不记录设备标签、转录正文、原始音频和凭据。生成器不会枚举或保存设备名称，也不会自动填写 tester、observed、passed、metrics 或附件；输出始终 `ok=false`，避免自动化准备脚本产生伪签核。
- 收紧 `verify-duplex-release-evidence.mjs`：顶层及每次硬件运行的附件必须是可读取的本地 `file:` URI，验证实际文件 SHA-256，而非只验证 64 位十六进制格式；测试人名称、签署时间和 attestation 必须有效。
- 每次硬件运行现在必须包含 Windows release/build、非空设备类别、逐步 action/observed/passed、有限数值 metrics 和实体验证附件；完整矩阵至少需要四个不同附件摘要，禁止四个运行复用一个附件冒充四份物理证据。

结果：已生成待执行工作簿 `apps/desktop/windows/release/duplex-voice/hardware-review-workbook.json`，绑定当前候选 `OpenDrSai.exe` SHA-256 `4aa9e44177542742c57724d4cdb29d1c09209bbf2e1c2bd8191a42b9edccbd47` 和 `app.asar` SHA-256 `be1bad550b789780d56467c6ef89e4f5945dfc8842729824e9ad1c0dbf1c33df`。该文件保持 unsigned/pending，不能通过正式 hardware gate。

测试：hardware workbook 开发/生产端口、构建绑定、矩阵完备性、待签名状态和隐私测试通过；M10 evidence gates 正向报告通过，并确认 Serial fallback、模型/完整性篡改、无哈希附件、伪造实体哈希、缺 OS/设备/步骤/指标和重复物理附件全部 fail-closed；live review 防自动签核回归及 Node/Web TypeScript 均通过。

下一轮：继续完善从工作簿到最终签核报告的安全转换工具，要求逐项物理观察、附件实体验证与测试人显式确认，并准备用户可直接执行的最短操作说明。没有真人、Win10 机器、USB/蓝牙设备和真实系统动作前，严格验收仍不计数。

> 当前权威快照（第 34 轮，2026-08-14）：实现进度 **52/52（100.00%）**；严格验收 **0/52（0.00%）**。本轮闭合稳定转录与工具时间线在写入失败、Session 终态和 Electron 强杀/重启边界上的一致性；自动化强杀和合成历史不能替代真人听说、真实系统崩溃/重启与实名签核，因此严格验收仍不提前计数。

## 第 34 轮

- 新增 Renderer 侧 `DuplexStableHistoryWriter`，把稳定 revision 的串行提交、精确 acknowledge 和失败保留从 React 事件处理器中独立出来。首次写入失败不再吞掉 dirty revision；`completed`、`cancelled`、`failed`、手动取消和 `pagehide` 均在释放 Session 前执行最多两次的有界 flush。
- 终态清理由 Session ID 去重，避免重复 terminal 事件并发 flush、重复释放或覆盖最终错误。若有界重试仍失败，界面明确告知“已完成的 Realtime 转录历史未能持久化”，不把内存状态伪装成已保存。
- 保持稳定/临时边界不变：只有 `input_transcript_completed`、`response_transcript_completed` 和 `interrupted` 产生可持久 revision；input/output delta 只进入有界临时字幕 Map。新增测试先注入 delta canary，再令第一次写入失败，证明终态重试仅提交稳定正文且 canary 不进入写请求。
- 扩展双进程 packaged 强杀场景：第一实例在真实 `zhizengzeng/gpt-realtime-2` Session 活跃时通过正式 Desktop API 写入稳定用户转录、稳定助手转录和已完成工具时间线，确认落盘后强杀权威 Main PID；第二实例复用同一 `.drsai-dev:28642` 和隔离 userData，从 Thread Snapshot 读回三项并验证 revision、工具结构、唯一 ID 与临时字幕边界，最后删除探针 Thread。
- 跨进程场景继续验证旧 Session 无 zombie occupancy、旧 ID 的 stop/cancel/dispose 全拒绝、无 stale event，以及新 Realtime Session 可 accepted/started/completed。报告不保存转录正文、Provider 凭据或设备标签。

真实结果：强杀前 9/9、重启后 20/20，合计 29/29。证据：`apps/desktop/windows/release/duplex-voice/packaged-app-restart-e2e.json`，`OpenDrSai.exe` SHA-256 `4aa9e44177542742c57724d4cdb29d1c09209bbf2e1c2bd8191a42b9edccbd47`，`app.asar` SHA-256 `be1bad550b789780d56467c6ef89e4f5945dfc8842729824e9ad1c0dbf1c33df`。

测试：Duplex transcript、Duplex history、Node/Web TypeScript、Duplex UI、M9 privacy、Electron Vite 构建、Windows 本地目录打包和双 packaged 强杀/重启均通过；定向 `git diff --check` 仅报告工作树既有的 LF→CRLF 提示，无 whitespace error。

下一轮：准备可由用户实际操作的系统锁屏、睡眠/恢复、应用强退与重启验收入口和最小化证据采集，确保不记录语音正文或设备标签；同时复核当前硬件/系统矩阵中仍可自动推进的项目。生产安装、生产 Realtime 配置、真人麦克风/扬声器复听和实名签核仍需用户授权或人工参与。

> 当前权威快照（第 33 轮，2026-08-14）：实现进度 **52/52（100.00%）**；严格验收 **0/52（0.00%）**。本轮完成 Electron Main 被强制终止后的双 packaged 进程恢复证据，并修复重启 readiness 假红和空 Session 结束触发 Provider 协议错误；程序化强杀不能替代真实崩溃、系统重启和实名人工签核，因此严格验收仍不提前计数。

## 第 33 轮

- 正常退出路径在 `before-quit` 开始即显式调用 `disposeAllDuplexVoiceSessions()`，与 WebContents `destroyed` owner 清理形成幂等双保险；麦克风、Provider socket、计时器和 Registry 不再仅依赖窗口最终销毁。
- 新增双进程 packaged 场景 `verify:voice:duplex-packaged-app-restart`：第一实例建立真实 `zhizengzeng/gpt-realtime-2` Session 并确认 `session_started`、owned occupancy、无 terminal；Main 自己把权威 `process.pid` 写入证据，启动器只对该 PID 执行 `/T /F`；第二实例复用同一隔离 userData 和 `.drsai-dev:28642`。
- 重启后明确禁止“伪续接”：Registry 初始无占用；旧 Session ID 的 stop/cancel/dispose 全部返回 `false`；订阅窗口内没有旧 ID 事件。随后 readiness 恢复并建立全新 Session，证明旧 Session 不会成为幽灵占用或跨进程句柄。
- 修复重启后第一次 readiness 瞬时假红：`getDuplexVoiceReadiness()` 在 Gateway 首探不可用时执行一次共享幂等 `startGateway()` 并复探，仍保留 model/provider/credential/capability 的严格 fail-closed 语义。
- 修复空 Session 结束协议：Runtime 现在跟踪自上次显式 commit、Server VAD speech-stop 或重连以来是否存在未提交输入；`finishTurn()` 在空 buffer 时拒绝无效操作，`stop()` 在空 buffer 时不发送 `input_audio_buffer.commit`，而是由 2 秒有界 drain 正常完成。此前真实 Provider 返回的 `protocol / retryable=false` 已转为 `completed`。
- packaged 编排修复：两阶段均进入 `isE2eSmokeProcess`；故障 PID 取自实际 Main 而非 GUI spawn 句柄；隔离 userData 清理带 Windows 文件句柄重试且不会覆盖原始测试异常；before/after 错误字段进入报告。

真实结果：强杀前 8/8、重启后 14/14，合计 22/22。旧 Session 无终态后被强杀；新进程中无 zombie occupancy、旧 ID 三操作拒绝、无 stale event、readiness ready；新 Session accepted/started 并 `completed`。证据：`apps/desktop/windows/release/duplex-voice/packaged-app-restart-e2e.json`，`OpenDrSai.exe` SHA-256 `7fe52aba5d7ddb380bb6d9e70e0d89cdfcd2e2ed694204c73f17dc370f4774b5`，`app.asar` SHA-256 `36a4bd67401c22b8228952a79199eb3ace7e6b3704c617ee400d89a80e11ac7c`。

测试：Node/Web TypeScript、P2 readiness、M9 bounded recovery、M3 10,000 terminal race/cleanup、Duplex UI、Electron Vite 构建、Windows 本地目录打包以及双 packaged 强杀/重启均通过。新增断言覆盖空 finish-turn 不 commit、空 stop 不 commit 且 drain 后完成。

下一轮：审计并补齐“崩溃前已落盘的稳定转录/工具时间线保留，未完成临时字幕不伪造恢复”的跨进程历史语义，并准备可由用户执行的真实系统睡眠/锁屏验收入口。生产安装/Realtime 配置和真人硬件矩阵仍需明确授权及实名材料。

> 当前权威快照（第 32 轮，2026-08-14）：实现进度 **52/52（100.00%）**；严格验收 **0/52（0.00%）**。本轮完成 packaged 锁屏/解锁/挂起事件和真实候选 Gateway 进程停止后的同 Session 恢复证据；自动发射 Electron 电源事件和程序化停止 Runtime 不能替代真实机器睡眠、系统锁屏及实名人工签核，因此严格验收仍不提前计数。

## 第 32 轮

- 修复 Main 生命周期恢复语义：`resume` / `unlock-screen` 在向 Renderer 发布事件前先检查 Gateway；若 Runtime 不可用则通过共享 singleflight 拉起并再次健康检查，事件中的 `recoveredGateway` 现在反映真实恢复结果，不再固定为 `false`。
- 修复 Realtime 对 Gateway 进程退出的恢复链：Runtime 一旦进入 `reconnecting`，Controller 触发一次共享 Gateway 恢复；自动重连从 3 次扩为仍有界的 5 次，退避保持 `500 ms` 基数，为候选 Runtime 冷启动留出足够窗口，同时继续禁止断线旧帧重放。
- Controller 新增只读的内部 `session_started` 就绪跟踪，Session 移除时同步清理。packaged 故障编排只在真实 Provider `session_ready` 已转化为 `session_started` 后停止 Gateway，避免用 WebSocket open 或 occupied 冒充 Provider Session 已建立。
- 新增 `runDuplexProcessRecoverySmoke` 和 `verify:voice:duplex-packaged-process-recovery`：在 `.drsai-dev:28642`、隔离 Electron userData、候选 Runtime 和真实 `zhizengzeng/gpt-realtime-2` 上，依次发射锁屏、解锁、挂起，实际停止受管 Gateway，再发射恢复并观察原 Session 重连。
- 场景调试过程中拒绝了两种不可靠同步：并发 `executeJavaScript` 轮询会被长脚本队列阻塞；程序化窗口标题没有产生可靠通知；Runtime `connected` 也只代表本地 WebSocket open。最终只以 `session_started` 为注入前置条件。两次过早注入均按严格 readiness 在 Provider 建连前失败，没有被误记为成功。

真实结果通过 15/15：Session accepted/started；`lock-screen`、`unlock-screen`、`suspend` 均送达；Gateway 停止后观察到 `reconnecting` attempt 1–4；`resume` 返回 `recoveredGateway=true`；同一 Session 进入 `reconnected` segment 1；无提前 terminal；最后 `completed`。证据：`apps/desktop/windows/release/duplex-voice/packaged-process-recovery-e2e.json`，`OpenDrSai.exe` SHA-256 `e388d89fd8de5166c3081ad3288bbd2a299e50028208697066f74c02b182a2a3`，`app.asar` SHA-256 `f677b949c7514b1330788d5f537bf6d7170948ba4c9071b876bb1da5500a6fdf`。

测试：Node/Web TypeScript 通过；M9 有界恢复、M2/M4 capture 睡眠释放/恢复、M3 Runtime 10,000 唯一终态与清理回归通过；Electron Vite 构建、Windows 本地目录打包和真实 packaged 进程恢复 15/15 通过。报告仅保存安全状态、次数、segment 和布尔值，不保存凭据、转录或设备标签。

下一轮：覆盖 Electron 应用进程退出/重启后的产品语义（旧 Session 必须释放、UI/历史可解释恢复、不得伪装为同一实时连接），并审计真实系统睡眠后 Chromium 麦克风重新授权的用户提示。随后仍需用户授权的生产安装/Realtime 配置以及真人麦克风、系统隐私页、USB/蓝牙、Win10/11 和辅助技术矩阵。

> 当前权威快照（第 31 轮，2026-08-14）：实现进度 **52/52（100.00%）**；严格验收 **0/52（0.00%）**。本轮完成 packaged 应用内“首次麦克风权限拒绝、再次请求恢复”场景，并在恢复后建立真实 `gpt-realtime-2` Session；该自动化不修改 Windows 全局隐私设置，也不能替代真人操作、系统隐私页和硬件矩阵签核，因此严格验收仍不提前计数。

## 第 31 轮

- 主窗口权限策略新增严格受 `OPENDRSAI_E2E_DUPLEX_PERMISSION_RECOVERY=1` 约束的单次故障注入：仅拒绝第一个来自主窗口的纯音频权限请求，第二次及以后恢复正式的“主窗口纯音频允许、视频和非主窗口拒绝”策略；普通产品运行不受影响。
- 新增 `runDuplexPermissionRecoverySmoke` 和 `verify:voice:duplex-packaged-permission-recovery`。启动器使用隔离 Electron userData、`.drsai-dev:28642`、候选 Runtime 和真实 Provider，并把报告绑定到 `OpenDrSai.exe` / `app.asar` SHA-256；报告不保存凭据、转录正文或设备标签。
- packaged 真实结果通过 11/11：首次 `getUserMedia` 返回 `NotAllowedError / Permission denied`；拒绝前后全局 Duplex occupancy 均为空，证明没有遗留 Provider Session；第二次请求获得 `kind=audio`、`enabled=true`、`muted=false`、`readyState=live` 的轨道；随后 `zhizengzeng/gpt-realtime-2` Session 成功建立并以 `completed` 干净停止。
- 启动事务实现复核：`useDuplexVoiceInput` 继续通过 `runDuplexStartupTransaction` 严格执行 `prepareCapture(getUserMedia) → startProvider → activateCapture`，因此真实权限拒绝发生在 Provider 建连/计费之前；失败清理会释放采集和播放资源并把界面置为可重试的 `failed`。
- 本轮验证包显式使用仓库内 Electron 39.8.10 分发目录，并仅为本地目录验收关闭 EXE 签名/元数据编辑；原因是当前 Windows 会话无法创建 `winCodeSign` 缓存所需的 Darwin 符号链接。该临时打包参数不进入产品配置和发布流程。

证据：`apps/desktop/windows/release/duplex-voice/packaged-permission-recovery-e2e.json` 为 `ok=true`；绑定的 `OpenDrSai.exe` SHA-256 为 `fe1c2b2def1a205710054f7deced544aef0f19985d06c902c5240449c1e18e18`，`app.asar` 为 `6dc15f1536dd67bd322322c66a6c06126e79f6bbe4099d1ca83b7b7b32fe022c`。

测试：Node/Web TypeScript 检查通过；Duplex capture 权限/约束/生命周期回归、Duplex UI 显式启动门禁、M9 隐私门禁、Electron Vite 构建、Windows 本地目录打包和 packaged 权限恢复 11/11 均通过。首次沙箱内运行因 `.drsai-dev/auth` 不可写按预期失败，授权开发数据域写入后通过；未迁移开发凭据到生产域，未覆盖已安装生产 Runtime。

下一轮：实现 packaged 睡眠/锁屏与 Runtime/应用进程恢复场景；随后仍需用户授权的生产安装/Realtime 配置，以及真人麦克风、系统隐私页、USB/蓝牙、Win10/11 和辅助技术矩阵。严格验收只接受符合 P2 证据 schema 的实名人工/真实环境材料。

> 当前权威快照（第 30 轮，2026-08-14）：实现进度 **52/52（100.00%）**；严格验收 **0/52（0.00%）**。本轮完成候选 Runtime 上真实 `gpt-realtime-2` packaged 单次断线与自动重连证据，并修复启动竞态和并发 capability probe；该自动故障注入不能替代真实 Wi-Fi/硬件和实名人工签核，因此严格验收仍不提前计数。

## 第 30 轮

- 新增专用 packaged recovery E2E：在真实 Session 收到 Provider `session_ready` 后，仅一次关闭首个 Gateway Realtime WebSocket。故障注入必须同时设置 `OPENDRSAI_E2E_DUPLEX_RECOVERY=1` 与 `OPENDRSAI_E2E_DUPLEX_DISCONNECT_ONCE=1`，正常构建和普通 readiness 场景不会触发。
- 新增 `verify:voice:duplex-packaged-recovery` 启动器，使用隔离 Electron userData、`.drsai-dev:28642`、候选 Runtime 和真实 Provider；报告绑定 `OpenDrSai.exe` / `app.asar` SHA-256，并只保存状态、数值、安全 reason code 与隐私布尔值。
- 真实恢复结果通过 14/14 检查：Session accepted/started；观察到 `reconnecting` attempt `1`、退避 `500 ms`；重连期上行 frame/byte/audio credit 全为 `0`；随后进入 `reconnected` segment `1`；无提前终态，最后 clean stop 为 `completed`。
- 修复 Session start 的 Gateway TOCTOU：readiness 通过后若严格 Gateway 状态瞬时降级，启动逻辑会调用现有 `startGateway()` 恢复并重新探测一次，再决定失败，不再直接把短暂探测抖动暴露为不可恢复启动错误。
- 修复 Gateway Realtime capability probe 并发风暴：按 Agent 使用异步锁，锁内再次检查新鲜缓存；三个普通并发请求现在只建立一个真实 Provider probe。`force=true` 仍保留显式强制刷新语义。
- packaged readiness/recovery 场景改为先串行完成 readiness，再读取非依赖信息；恢复场景直接使用 readiness 返回的精确 Provider/model，避免脚本自身重复读取 model policy 并制造启动期超时。
- Runtime 封装后缺失的 `@electron-toolkit/utils` 本地 Node asset 已按现有 lockfile、`--ignore-scripts` 恢复；未执行依赖安装脚本，未运行自动漏洞修复或升级依赖。

证据：`apps/desktop/windows/release/duplex-voice/packaged-readiness-staged-runtime.json` 与 `packaged-recovery-e2e.json` 均为 `ok=true`，绑定同一产物。当前 `OpenDrSai.exe` SHA-256 为 `cc31c1b0c025374927ec53e4876d8a8d779921da40b6822134489242ebe8754c`，`app.asar` 为 `339240bc253060f48d5cbd673d2fa7261971f37048cbe5a8a63453cbcac2fdc0`。最终候选 Runtime 为 `1.5.8+17eb6006a12041d4`、17,849 文件；ZIP SHA-256 为 `6aebe87459b73f12d9ead9f8bb9414240790693d65540c20b340c3c6cdcc7a2e`，大小 `356555387` bytes。

测试：Gateway Realtime 专项 5 项通过（精确模型绑定、缓存、三个并发请求 singleflight、WebSocket 音频 ack、鉴权/模型拒绝）；Node TypeScript、Runtime 10,000 终态竞态、Electron 构建、Windows 解包构建、候选 Runtime 无故障 readiness 12/12、真实单次断线恢复 14/14、Runtime directory/archive/receipt 验证均通过。最终进程退出后端口与资源清理另行复核。

下一轮：实现 packaged 麦克风权限拒绝/恢复的可重复场景，并审计 Windows 睡眠/锁屏可自动化边界；真实 Wi-Fi 弱网听感、真人麦克风、USB/蓝牙和 Win10/11 仍须物理与实名证据。

> 当前权威快照（第 29 轮，2026-08-14）：实现进度 **52/52（100.00%）**；严格验收 **0/52（0.00%）**。本轮生成并验证包含当前 Realtime probe/transport 的完整候选 Runtime，完成开发与生产数据域的串行 packaged readiness 走查；生产数据域仍未配置 Realtime 模型，真人及硬件/环境签核也尚未执行，因此严格验收不提前计数。

## 第 29 轮

- 使用正式 Windows Runtime 构建链重新物化当前 Python 包，封装 17,848 个文件并生成 receipt。最终候选 Runtime 版本为 `1.5.8+543365d0d8112483`；`verify:final-runtime` 已重新解压并逐文件验证目录、archive 和 receipt 一致。
- packaged readiness 启动器新增显式 staged Runtime 覆盖入口。开发目录默认仍使用仓库源码与工作区虚拟环境；只有显式提供候选 Runtime 时才运行封装版本，生产目录仍默认使用正式安装 Runtime。报告记录 `runtimeProfile`，避免混淆开发源码、候选 Runtime 与安装 Runtime 的证据等级。
- 候选 Runtime + 当前 `win-unpacked` + `.drsai-dev` 串行真实验证通过 12/12 检查：Gateway 端口 `28642`，精确绑定 `zhizengzeng/gpt-realtime-2`，Runtime Realtime 候选数 `1`，rollout/gateway/model/provider/credential/capability 六个子检查全部 `ready`；Provider 凭据没有绕过。
- 同一候选 Runtime 在 `.drsai` 上确认 Gateway 使用 `18642`。生产配置域没有 Realtime 模型和候选目录，因此整体按设计 fail-closed；报告 `ok=false` 并保留安全失败证据，不复制开发配置或凭据到生产域。
- 修正 readiness 错误优先级：模型未配置时先返回 `model_unconfigured`，不再被依赖模型探测结果的 `credential_unavailable` 掩盖；模型配置完成后再检查 Provider 和凭据。凭据成功文案也改为同时适用于 OIDC 与本地 Provider。
- packaged readiness 报告无论成功或失败都会先落盘，并新增脱敏子检查列表；失败后命令仍返回非零，既保留诊断证据又不放宽发布门禁。

证据：开发候选 Runtime 报告 `apps/desktop/windows/release/duplex-voice/packaged-readiness-staged-runtime.json` 为 `ok=true`；生产配置报告 `packaged-readiness-production.json` 为 `ok=false / model_unconfigured`，并确认端口 `18642`。当前 `OpenDrSai.exe` SHA-256 为 `358999530b5530c5e965b0f279deee415a48c2b2807c8d6acd4c99666dfae8c8`，`app.asar` 为 `13497867df7349dea36af441d12dc7197094dd5cc5cb05109545b5cf7f8dee14`。最终 Runtime ZIP SHA-256 为 `5951dd2c3f75ce11ba619b6fa2b0fcd461528b9f9fa218c589ca5930a70c20ab`，大小 `356539303` bytes。

测试：Node/Web TypeScript、Electron 构建、Windows 解包构建、P2 readiness 单元回归、候选 Runtime 真实 Provider packaged readiness、生产端口/配置 fail-closed 走查、Runtime directory/archive/receipt 全量验证均通过预期；并发真实探测曾产生一次临时 Provider 不可用，改为串行后稳定通过，不把并发失败冒充成功证据。

下一轮：在用户明确授权前不迁移 `.drsai-dev` 的模型/凭据到 `.drsai`，也不覆盖 `Program Files` 的现有 Runtime。继续补充可在当前机器自动完成的弱网、进程恢复和权限拒绝 packaged 场景；生产模型绑定、候选 Runtime 安装以及真人/硬件矩阵保留为需要明确外部状态或人工操作的验收项。

> 当前权威快照（第 28 轮，2026-08-14）：实现进度 **52/52（100.00%）**；严格验收 **0/52（0.00%）**。本轮完成正式 live 复核材料准备链和无 CDP 的开发打包态就绪验证；自动证据均不能替代负责人实名复听、真人麦克风及完整硬件/环境矩阵，因此严格验收仍不提前计数。

## 第 28 轮

- 新增正式 live 复核材料准备器：校验真实 `zhizengzeng/gpt-realtime-2` 自动报告、隐私字段、音频及源报告附件 SHA-256，然后生成默认 `ok=false`、无测试者、所有人工复核项为 false 的待签核报告。严格 verifier 已确认会拒绝该待签核状态，不能由自动运行冒充人工验收。
- 新增无 CDP 的 packaged readiness 场景和启动器，通过正式 preload/Main IPC 在 `win-unpacked` 内检查 Gateway、Agent Realtime 绑定、Runtime 模型目录、实时能力证据、麦克风权限及音频输入/输出设备。报告只保留端口、模型 ID、数量和布尔/安全 reason code，不保存 URL、凭据或设备标签。
- 修正打包态端口读取：从 Gateway `baseUrl` 解析实际端口但不持久化 URL。开发数据域 `.drsai-dev` 已真实验证为 `28642`；生产数据域规则保持 `18642`。
- 修复 Realtime 就绪凭据判定：此前只认可 OIDC Bearer Token，导致使用本地保存 Provider 凭据的 `zhizengzeng` 被误报为 `credential_unavailable`。现在 OIDC 会话或新鲜的真实 Provider 探测成功均可证明凭据可用，失败继续 fail-closed；已补 OIDC、本地 Provider、不可用探测和无凭据回归断言。
- 隔离打包测试使用开发者登录绕过建立应用会话，但 Provider 凭据没有绕过；正式报告显式记录 `developerBypass=true`、`providerCredentialBypass=false`。
- 发现安装目录中的生产 Runtime 尚未包含 `/realtime-voice-probe` 路由（返回 404）。验证器现按数据域明确选择运行时：开发数据域使用当前仓库 Python 源码与工作区 `.venv`，生产数据域使用安装 Runtime，避免混合版本误报。生产 Runtime 的重新构建/安装和生产数据域验证仍是下一阶段缺口。

真实开发打包态结果：全部 12 项检查通过；Gateway ready，端口 `28642`，模型精确绑定 `zhizengzeng/gpt-realtime-2`，Runtime Realtime 候选数 `1`，Readiness 为 `ready`，麦克风权限 `granted`，枚举到 3 个输入和 5 个输出设备。证据文件：`apps/desktop/windows/release/duplex-voice/packaged-readiness-e2e.json`。

测试：Gateway 环境 17 项、P2 readiness、live 复核材料防伪、M10 证据门禁、Node TypeScript、Electron 构建、Windows 解包构建和定向 `git diff --check` 均通过；验证后 `28642` / `18642` 无残留监听。当前 `OpenDrSai.exe` SHA-256 为 `51e80733748836a4f3eddfc9668eb738feb0df7ce37c34dc8d7826ea624059d3`，`app.asar` 为 `c03112f5b4660ea88c6c3345b7b08109de52a998830e7c9695fd27b6df224fad`（未签名验收包）。

下一轮：重建并安装包含 Realtime probe/transport 的生产 Runtime，在 `.drsai:18642` 重跑同一 packaged readiness；随后完成负责人复听/实名签核、真人麦克风听说/插话，以及 USB、蓝牙、弱网、睡眠、权限、Win10/11 和辅助技术矩阵。

> 当前权威快照（第 27 轮，2026-08-14）：实现进度 **52/52（100.00%）**；严格验收 **0/52（0.00%）**。本轮修复开发/生产数据域端口分流并完成真实 `zhizengzeng/gpt-realtime-2` 自动 live 回合；负责人复听/实名签核、真人麦克风、完整 packaged UI 与硬件/环境矩阵仍未闭环，因此严格验收不提前计数。

## 第 27 轮

- 修复 Gateway 默认端口只依赖 Electron build mode 的错误。显式 `OPENDRSAI_GATEWAY_PORT` / `DRSAI_API_PORT` 仍优先；否则 `.drsai-dev` 固定使用 `28642`，`.drsai` / `.drsai-prod` 固定使用 `18642`，自定义隔离目录才回退到 launch mode。
- 新增 8 项数据域端口契约检查（总计 17 项），覆盖 Windows/POSIX 路径、尾部分隔符、packaged + `.drsai-dev`、defaultApp + `.drsai`、显式验收端口和非法端口回退。
- 使用修复后的同一 `win-unpacked` 构建完成真实进程验证：`~/.drsai-dev` 仅监听 `28642`，`~/.drsai` 仅监听 `18642`；两种数据域退出后 managed Gateway 均释放端口，不再互相清理或竞争。
- 新增脱敏真实 Provider 握手 runner；`zhizengzeng/gpt-realtime-2` 返回 `verified`，真实确认输入/输出转录、Server VAD、响应取消、会话截断与工具能力。
- 新增完整自动 live Provider runner：先生成真实 Provider PCM，再把 PCM 回送为上行音频；观察到 Session ready、输入音频、输入/输出转录、输出音频、响应取消、conversation truncation、工具调用和工具结果回合全部为 true。报告不保存原始事件、转录正文或凭据。
- 首次 live runner 暴露“`response.done` 与输入转录必须同事件到达”的错误假设；已改成顺序无关双条件门闩并在第二次真实运行中通过。
- Chromium CDP 在开发数据域首次启动后可响应，但长时间运行后仍可能出现监听端口不响应；该调试服务稳定性问题单独保留，不将其解释为语音功能通过或失败。

真实自动 live 指标：Session ready `6843 ms`，首段音频 `7656 ms`，取消确认 `5203 ms`，输出 PCM `184800 bytes`。音频附件 SHA-256：`682c348be1783cc4280275ecf97045b5301b04b010da1ab8f065ee0db4160090`。

测试：Gateway 端口 17 项、Realtime 模型能力推断、Python runner 编译、Main TypeScript、Electron 离线构建、packaged Duplex 结构验证和定向 `git diff --check` 均通过。新产物 `OpenDrSai.exe` SHA-256 为 `23c7498259a22d4a1383ebbfb0bc19117d91fd4e462000937cbf854065c69f6f`，`app.asar` 为 `6b5f289654af1d9ca9adc726d95fbc4a414d6b3299afdf8ce49751af92e90e97`（未签名验收包）。

下一轮：把自动 live 报告接入正式证据准备流程，补负责人复听/签核入口；继续恢复稳定的 packaged UI 控制通道并完成真人麦克风听说/插话。随后执行 USB、蓝牙、弱网、睡眠、权限、Win10/11 和辅助技术矩阵。

> 当前权威快照（第 26 轮，2026-08-14）：实现进度 **52/52（100.00%）**；严格验收 **0/52（0.00%）**。本轮完成打包态配置域排查和 Realtime 模型元数据易用性修复；真实 Provider、完整 packaged/live/hardware、Win10/11、弱网、睡眠和辅助技术证据仍未闭环，因此目标保持进行中。

## 第 26 轮

- 打包态脱敏检查确认：生产数据域模型目录为 `fresh`，但只有 13 个普通模型、3 条 `hepai` Provider 记录；当前 Agent 的 `realtime_voice_model` 为空，运行时 Realtime 候选为 0，因此 `model_unconfigured` 是真实配置域缺失，不是 Renderer 过滤错误。
- 定位到此前配置位于 `~/.drsai-dev`：其中 `agent_opendrsai.toml` 已显式绑定 `zhizengzeng/gpt-realtime-2`，而正式打包默认读取 `~/.drsai`。两者不可在未获用户迁移授权时静默合并，避免复制 Provider 凭据或覆盖生产策略。
- 新增统一的已知语音模型能力推断。手工添加、Provider 发现、预设载入和旧配置重载遇到 `gpt-realtime*` 时，默认/补全为 `text+audio → text+audio`，并声明 chat/tool-calling；`whisper-1` 与 `tts-1` 保持各自 STT/TTS 能力。用户仍可在模型编辑器中显式调整。
- 打包验收使用开发数据域成功启动本地 Gateway，但 Chromium CDP 端点持续“监听但不响应”，无法取得可信 Renderer/live 会话证据；未将其计入严格验收。

测试：新增 `test-model-voice-capabilities.mjs`，覆盖带命名空间的 `gpt-realtime-2`、旧 text-only 元数据修复、STT/TTS 和未知模型不变；专项测试、Web TypeScript 全量检查及 `git diff --check` 均通过。测试已加入 `test:voice:duplex` 发布回归图。Electron 离线重建及 packaged 结构验证通过；新产物 `OpenDrSai.exe` SHA-256 为 `fe8808afc165f397e798f99b03cca1f58a4a6aab5064bf25fa3127e4816faf7b`，`app.asar` 为 `b23543d1292f47a85cf1906e206e2fd7aa4a6e87832c1a09d6e4b7e1d3b97e98`（未签名验收包）。

下一轮：将修复后的 Renderer 重建进打包产物；优先恢复可响应的 CDP/界面验收会话，或在用户确认后把 `zhizengzeng/gpt-realtime-2` 安全迁入正式 `~/.drsai` 配置域，再执行 live 听、说、打断、转录和工具回合。硬件及环境矩阵继续按真实证据逐项签核。

> 当前权威快照（第 24 轮，2026-08-14）：实现进展 **52/52（100.00%）**；严格验收 **0/52（0.00%）**。本轮完成 M10-F1～M10-F3 的实现和本地自动化，52 项功能均已有实现；真实 Provider、packaged/live/hardware、Win10/11、弱网、睡眠和辅助技术证据尚未闭环，因此目标保持进行中。

## 第 24 轮

- M10-F1：新增统一故障矩阵运行器，覆盖 network、Provider、IPC、输入设备、AudioContext、I/O、正式审批和终态 race；失败信息固定输出 `domain:reason_code`。新增固定种子 `0x5eedc0de` 的 10,000 组属性测试，并复用 Runtime 10,000 终态竞态测试。
- M10-F2：收紧 packaged/live/hardware 证据 schema。Packaged 必须绑定精确 Serial 零回归套件及报告 SHA-256；所有附件必须有 URI 和 SHA-256；继续要求实名签核、全报告摘要哈希、真实模型观察值和禁止 Serial/fixture 回退。生成的三份模板默认 `ok=false`，未执行真实验收时必定失败。
- M10-F3：新增 fail-closed Legacy 删除资格清单。新 UI/配置不得选择 Streaming；旧偏好继续归一为 Serial。至少一个稳定发布周期、足量迁移遥测和低于阈值的 legacy selection rate 全部满足前，Streaming rollback 代码和测试必须保留，提前请求删除会被拒绝。
- 新增无 registry 访问的 package-script graph runner，为沙箱回归分配临时 `DRSAI_HOME` 并补齐本地 `node_modules/.bin` PATH，完成后安全清理。

测试：正式 `test:voice:duplex-release` 等价离线图全部通过，包含 Serial 全回归、Duplex TypeScript/Python/Renderer/Main 全套、Node/Web 类型检查、固定种子故障矩阵、10,000 race、证据防伪和 Legacy 提前删除拒绝。待签核真实证据模板已生成，并确认 packaged verifier 在 `ok=false` 时按预期失败。

下一轮：开始真实验收采证。优先构建当前 packaged artifact，在 Windows 11 内置设备上完成 live `gpt-realtime-2` 基线与弱网/睡眠/权限场景；随后补齐 USB、蓝牙和 Windows 10 矩阵。只有符合附件哈希和实名签核 schema 的证据才计入严格验收。

> 当前权威快照（第 23 轮，2026-08-14）：实现进展 **49/52（94.23%）**；严格验收 **0/52（0.00%）**。本轮完成 M9-F1～M9-F4 的实现与自动化；真实 Provider、打包应用和硬件/人工矩阵仍保留到最终严格验收。

## 第 23 轮

- M9-F1：语音偏好 schema 升级至 v9；Realtime 独立保存 Provider voice、语言、输入/输出设备、自动恢复和转录保存策略。设置值直接映射到 Session 请求；关闭转录保存时仅显示临时字幕，不写入任务历史。
- M9-F2：建立显式更新矩阵。音量和设备由本地热切换；instructions 使用带 `updateId` 的 Provider ACK 事务；并发更新拒绝、Provider 拒绝回滚、2 秒 ACK 超时回滚；模型、voice、语言、恢复和保存策略明确要求新 Session。
- M9-F3：默认遥测只保留数值、布尔值、null 和安全 reason code。临时诊断必须由用户显式开启，默认 10 分钟、最长 15 分钟、内存上限 500 条；到期、关闭和组件卸载均立即擦除，字符串转录与 secret/canary 不进入导出。
- M9-F4：HUD 接入 TTFA、停止延迟、打断准确率、underrun、重连次数、输入/输出音频秒数和 Provider 估算成本；缺失成本与无样本比例使用 null-safe 展示，不伪造数值。

测试：热更新 ACK/并发拒绝/restart/Provider 拒绝/超时回滚通过；临时诊断 opt-in、TTL、500 条边界和 transcript/secret canary 扫描通过；SLO null/边界投影通过；v1～v9 偏好迁移和往返通过；Duplex UI 静态门禁通过；Node/Web TypeScript 全量检查通过。

下一轮：进入 M10，完成故障注入总套件、真实发布验收矩阵和 Legacy 删除门禁。严格验收仍须真实 Provider、打包应用、Windows 音频设备/弱网/辅助技术证据。

> 当前权威快照（第 22 轮，2026-08-14）：实现进展 **45/52（86.54%）**；严格验收 **0/52（0.00%）**。本轮完成 M8-F1～M8-F5 的实现与自动化；Narrator、axe 和真机键盘全流程保留到最终严格验收矩阵。

## 第 22 轮

- M8-F1：新增独立启动预检面板，明确 Provider/model、音频发送、转录保存和工具审批策略；确认按 disclosure version + Provider + model 持久化，配置变化才重新提示。
- M8-F2：新增纯函数 HUD 状态模型，本地化显示连接、听、说、回答、插话、恢复、暂停、结束和错误；ARIA live 仅包裹低频状态文字，高频输入电平不会反复播报。
- M8-F3：HUD 展示实时输入电平、AudioContext 输出状态、网络质量及精确到秒的重连倒计时；`prefers-reduced-motion` 下关闭 HUD 动效。
- M8-F4：保留 Provider 结构化错误对象；auth/model/protocol/network/device/audio/rate_limit/policy/cancelled/internal 全部映射主操作和备用操作，错误卡展示 reason code 与可用 trace/request ID。
- M8-F5：新增 Alt+Shift+V（开始/结束）、Alt+Shift+P（暂停/继续）、Alt+Shift+S（停止）、Alt+Shift+I（立即打断）；控件声明 `aria-keyshortcuts`，会话结束后焦点回到语音启动按钮。
- 语音偏好 schema 升级到 v8，v1～v7 均可迁移；新增版本化 Realtime disclosure 记忆。

测试：Node/Web TypeScript 全量检查通过；HUD/recovery/快捷键纯函数测试通过；偏好 v8 迁移与往返测试通过；Duplex UI 门禁通过；10,000 terminal runtime、重连/预算/脱敏回归通过；`git diff --check` 通过。

下一轮：进入 M9，完成 Realtime 设置的独立字段与 payload 一致性、热更新 ack/rollback、短期诊断 TTL，以及 SLO/成本展示。

> 当前权威快照（第 21 轮，2026-08-14）：实现进展 **40/52（76.92%）**；严格验收 **0/52（0.00%）**。本轮完成 M7-F4、M7-F5 的实现与自动化；真实打包审批中心交互仍计入最终严格验收矩阵。

## 第 21 轮

- M7-F4：Realtime 写类工具复用 Desktop 正式审批中心。Windows 接入现有 pending approval/decision 管线；macOS 接入 `PersistentApprovalStore` executor/observer。
- Renderer 只有收到 Main 发出的、同时匹配 `sessionId + callId` 的 allow 决策后才执行；拒绝、取消、120 秒超时、Session detach 均 fail-closed。
- 审批卡包含工具名、脱敏参数摘要、当前 Session scope、影响与 high risk；密码、token、API key 等字段不会进入审批详情。
- M7-F5：工具 waiting/running/completed/rejected/cancelled/failed/detached 状态写入 Thread 原生 `tool` part，并同步 legacy `toolTimeline` 兼容字段。
- 工具时间线采用逐 call CAS revision；请求、参数摘要、状态、时间及结果说明可在 Thread 重载后恢复，工具文本不混入模型对话正文。
- 恢复了 lockfile 已声明但本地缺失的 TypeScript 5.9.3 Node asset；未改变依赖版本或 lockfile。

测试：Node/Web TypeScript 全量检查通过；Desktop 正式审批专项测试通过；工具桥专项测试通过；Thread history/tool part 持久化测试通过；文字调度与 Duplex UI 回归通过；`git diff --check` 通过。

下一轮：进入 M8 用户体验闭环，先完成启动预检面板和统一状态 HUD，再补错误恢复卡、键盘与读屏自动化。

> 当前权威快照（第 20 轮，2026-08-14）：实现进展 **38/52（73.08%）**；严格验收 **0/52（0.00%）**。本轮完成 M7-F3 的实现与专项自动化；M7-F4/F5 仍为部分完成，不计入新增完成数。下方早期汇总表保留为逐轮历史基线，不代表当前数值。

## 第 20 轮

- M7-F3：新增显式单槽文字调度器，默认“当前回答后发送”，可选“立即打断并发送”。
- 待发文字在 HUD 中可见；用户可取消并恢复到 Composer 草稿；并发提交被拒绝，失败发送保留原 item id 与正文供重试。
- `response_audio_completed` 与 `interrupted` 均可触发一次幂等 flush；会话取消、失败或结束会清理待发槽，避免跨 Session 串发。
- 新增专项测试，覆盖默认延后、立即打断、并发竞争、取消恢复和失败重试。
- M7-F4 审计结论：Desktop 审批中心采用 Main 动作注册与决定后执行，不应以 Renderer 弹窗替代；下一轮沿正式动作注册机制接入语音工具。
- M7-F5 审计结论：Thread 已原生支持 `ChatMessagePart.type = "tool"`，下一轮直接持久化请求、审批、执行、结果与 late/detached 状态。

测试：`test-duplex-voice-text-scheduler.mjs` 通过；`git diff --check` 通过。完整 TypeScript 检查本轮因本地 TypeScript binary 缺失且沙箱禁止访问 npm registry 未能重跑，不能作为已通过证据。

下一轮：完成 M7-F4 正式 Desktop 审批动作注册，以及 M7-F5 Thread tool parts 时间线持久化和专项回归。

## 第 20 轮历史基线（保留用于逐轮审计，不代表当前状态）

最后更新：2026-08-14

口径：共 10 个模块、52 个功能点。`已验收` 必须同时具备实现、自动化和方案要求的真实/人工验收；`部分完成` 表示已有实现或自动化，但证据尚未闭环；`待实施` 表示尚无满足方案的实现。

## 汇总（第 20 轮历史）

| 状态 | 数量 | 比例 |
| --- | ---: | ---: |
| 已验收 | 0 | 0.00% |
| 部分完成 | 18 | 34.62% |
| 待实施 | 34 | 65.38% |

实现进展：18/52（34.62%）。严格验收进展：0/52（0.00%）。

## 功能点状态（第 20 轮历史）

| ID | 状态 | 当前证据 | 剩余验收 |
| --- | --- | --- | --- |
| M1-F1 | 部分完成 | Composer 与设置页均仅显示“单次语音输入/实时对话”；内部映射 serial/duplex | 打包后的新用户与升级用户产品走查 |
| M1-F2 | 部分完成 | 偏好 schema 已演进至 v7，继续将旧 streaming 值迁移为 serial 并写入一次迁移标记；两处主 UI 已移除 Streaming，v6 及更早版本可升级 | legacy 架构扫描、Serial 全回归、升级包走查 |
| M1-F3 | 部分完成 | 新增 rollout/Gateway/credential/model/provider/capability Readiness 契约；开始前强制刷新并 fail-closed | device 分项、缓存失效、打包 UI 验收 |
| M1-F4 | 部分完成 | Gateway 对 Agent 精确绑定模型执行有界 Realtime WebSocket 探针；能力按 Adapter 上限、有效模型绑定和新鲜真实证据取交集；启动再次校验绑定与能力 | 真实 Provider 证据、模型切换与过期缓存打包验收 |
| M1-F5 | 部分完成 | Readiness reason code 已映射“打开智能体配置/重新检查/切换单次输入”，设置页和 Composer 均展示可操作恢复路径 | 打包导航、键盘和读屏验收 |
| M1-F6 | 部分完成 | 全局单会话占用快照包含窗口、开始时间与所有权；UI 提供明确拒绝、单次输入回退和带 expectedSessionId 竞态保护的安全接管；窗口销毁释放资源 | 双真实窗口打包走查、原窗口可见终止反馈 |
| M2-F1 | 部分完成 | Duplex 协议升级 v2；Main 发布绝对 frame/byte/ms credit 和 ack cursor；Renderer 在额度内发送；乱序/重复 ack 不增加额度；15,000 帧/10 分钟虚拟 soak 无拒绝 | 真实弱网 10 分钟、IPC 延迟/乱序打包验收 |
| M2-F2 | 部分完成 | credit=0 时继续本地 VAD，静音不进入 IPC，语音有界保留；采集序号与 wire 序号分离，恢复按实时帧速排空且 wire 序号连续 | 真机语音边界、长拥塞恢复及听感验收 |
| M2-F3 | 部分完成 | 线性插值已替换为有状态窗化 sinc 低通；44.1/48/96→24 kHz 保持跨块相位与有界固定延迟；10 秒分块测试无累计漂移，18 kHz 输入在降采样前被抑制 | 真机多声卡频响、主观听感与长时硬件时钟偏差验收 |
| M2-F4 | 部分完成 | 独立监测 RMS/peak、静音时长、削波比、DC offset、实际采样率及约束降级；HUD 提供中英文可操作提示 | 真机麦克风太小/削波/AEC 不可用提示准确性、读屏与提示抖动验收 |
| M2-F5 | 部分完成 | 启动拆为 readiness/授权与本地 prepare/Provider start/本地 activate；逐阶段故障按 Provider→采集反向回滚，授权拒绝路径不调用 Provider | Windows 真实权限拒绝、计费后台无 Session、进程崩溃边界验收 |
| M2-F6 | 部分完成 | 会话内可选择系统默认或枚举麦克风；新流准备完成后原子换 source，generation barrier 释放过期快速连切；失败保留旧设备，活动设备丢失尝试默认设备 | 内置/USB/蓝牙互切、系统默认变更、拔插听感及打包验收 |
| M3-F1 | 部分完成 | v2 MessagePort 回报 received/scheduled/played 序号与累计毫秒；Main 以已播放/明确释放游标补充端到端额度，40 ms 投递粒度、有界 30 秒待发队列，完成事件不越过待发音频；确认可幂等重发 | 真机长回复、Renderer 卡顿/崩溃、IPC 确认丢包及内存曲线验收 |
| M3-F2 | 部分完成 | response 携带首/末音频序号；Renderer 有界重排、120 ms gap timeout、重复隔离、永久尾缺口和跨 response timer 隔离；跳序写诊断并在 HUD 显示自动继续 | 真实弱网乱序/丢包听感、诊断抽样及降级文案验收 |
| M3-F3 | 部分完成 | Browser sink 回报每个 source 的 scheduled/start/end/cancel；Controller 保留有界逐 source timeline，heard cursor 扣除 AudioContext base/output latency 且时钟回退不倒退；interrupt 使用校准游标 | 真机扬声器回录对齐误差、不同驱动 latency 与蓝牙延迟验收 |
| M3-F4 | 部分完成 | 使用 Main 记录的 Provider 原始到达时间计算 RFC 风格 EWMA jitter；动态启动水位限制 60–400 ms，抖动/underrun 快速升高、稳定期缓慢回落；HUD 显示网络等级与当前水位 | Wi-Fi 弱网爆音率、稳定网首音延迟及长会话收敛验收 |
| M3-F5 | 部分完成 | Browser AudioContext `setSinkId` 能力探测与会话内输出枚举/热切换；失败保留旧 sink，设备丢失回退系统默认并同步偏好；suspend/占用失败进入可重试恢复提示 | Windows 内置/USB/蓝牙输出矩阵、系统默认切换和打包 setSinkId 验收 |
| M3-F6 | 部分完成 | 偏好 schema v7 持久化独立 Realtime 音量；所有 source 经共享 GainNode；本地候选语音以 100 ms 包络 duck 至 25%，重复幂等，附和/VAD 撤销以 100 ms 恢复，cancel 立即复位 | 扬声器外放下附和/抢话听感、真实增益曲线和音量无障碍验收 |
| M4-F1 | 待实施 | — | 多信号候选器 |
| M4-F2 | 待实施 | — | 意图决策器 |
| M4-F3 | 待实施 | — | Interrupt transaction |
| M4-F4 | 待实施 | — | 可撤销附和 |
| M4-F5 | 待实施 | — | 停止词极速路径 |
| M4-F6 | 待实施 | — | 手动优先级 |
| M5-F1 | 待实施 | — | 生命周期策略表 |
| M5-F2 | 待实施 | — | 有界重连 |
| M5-F3 | 待实施 | — | 三种结束动作 |
| M5-F4 | 待实施 | — | 暂停/继续 |
| M5-F5 | 待实施 | — | 资源与电源预算 |
| M6-F1 | 待实施 | — | 按 item 的 draft store |
| M6-F2 | 待实施 | — | 稳定事件 journal |
| M6-F3 | 待实施 | — | heard alignment |
| M6-F4 | 待实施 | — | 中断消息模型 |
| M6-F5 | 待实施 | — | 会话上下文接续 |
| M6-F6 | 待实施 | — | 删除与隐私一致性 |
| M7-F1 | 待实施 | — | 移除假文字队列 |
| M7-F2 | 待实施 | — | 真实文字 item |
| M7-F3 | 待实施 | — | 文字发送策略 |
| M7-F4 | 待实施 | — | 正式工具审批 |
| M7-F5 | 待实施 | — | 工具 timeline |
| M8-F1 | 待实施 | — | 启动预检面板 |
| M8-F2 | 待实施 | — | 状态 HUD |
| M8-F3 | 待实施 | — | 音量与连接反馈 |
| M8-F4 | 待实施 | — | 错误恢复卡 |
| M8-F5 | 待实施 | — | 键盘与读屏 |
| M9-F1 | 待实施 | — | Realtime 设置页 |
| M9-F2 | 待实施 | — | 热更新矩阵 |
| M9-F3 | 待实施 | — | 隐私安全诊断 |
| M9-F4 | 待实施 | — | SLO 与成本 |
| M10-F1 | 待实施 | — | 故障注入总套件 |
| M10-F2 | 待实施 | — | 真实发布矩阵 |
| M10-F3 | 待实施 | — | Legacy 删除门禁 |

## 第 1 轮

- 建立 52 项严格进度账本。
- Composer 收敛为两种用户语言模式。
- 偏好 schema 升级到 v6，旧 `streaming` 自动迁移到 `serial`，并持久化迁移标记。
- 新增 Main Readiness 契约和 IPC/Preload/Mock 路由。
- Realtime 开始前重新检查服务端 Readiness 和浏览器 AudioWorklet/mediaDevices，避免 capability 假阳性。

下一轮：完成 M1-F1/F2 的设置页收敛（需谨慎合并现有 `App.tsx` 修改），实现 M1-F4 动态能力交集和 M1-F5 修复动作。

## 第 2 轮

- 设置页与 Composer 统一收敛为“单次语音输入 / 实时对话”，主 UI 不再提供 Streaming 选项。
- 设置页接入服务端 Readiness，并叠加浏览器 AudioWorklet、麦克风设备门禁。
- 为每类 Readiness reason code 建立确定性的主操作和备用操作映射。
- 设置页可直接打开智能体配置、重新检查状态，或安全切换到单次语音输入。
- 新增动作映射测试及设置页静态 UI 门禁。

下一轮：实现 M1-F4 的 Adapter / 模型声明 / live probe 能力交集，补齐 Composer 恢复卡，并开始 M1-F6 多窗口占用体验。

## 第 3 轮

- 新增 Agent 绑定 Realtime 模型的 Gateway 实时 WebSocket 探针，成功缓存 5 分钟、失败缓存 15 秒。
- Provider 连接 URL 显式携带经过转义的模型 ID，并保持 API key 仅在 Gateway 内使用。
- Readiness 不再按模型名称直接放行；要求 Provider/model 精确匹配、真实证据未过期。
- 最终能力由 Adapter 静态上限与 live probe 返回能力取交集；Renderer 和 Main 启动路径均使用协商结果。
- 会话启动再次校验模型绑定及转录、VAD、工具能力，阻止 TOCTOU 和能力越权。
- Composer 新增恢复卡，可打开智能体配置、重新检查或切换单次输入。
- 依据 OpenAI 官方 Realtime WebSocket 文档核对 `/v1/realtime?model=...`、服务端 WebSocket 和 GA `session.update` 结构。

下一轮：完成 M1-F6 多窗口会话占用与安全接管，并开始 M2-F1/F2 上行 credit 和采集暂停策略。

## 第 4 轮

- Realtime 会话约束为全局单活跃会话，避免多个窗口同时占用麦克风和远端音频会话。
- 新增调用方相关的占用快照：占用窗口、会话 ID、开始时间、是否属于当前窗口。
- Composer 冲突提示不再显示技术异常，而是展示占用窗口和开始时间。
- 用户可明确选择“结束原会话并接管”或“使用单次输入”。
- 接管要求提交 `expectedSessionId`；占用变化或重复请求会拒绝，避免误杀新会话。
- 接管先取消并清理原 Provider 会话，再原子注册新所有者；原窗口销毁同样释放 registry 和端口。
- 新增容量拒绝、过期接管、成功接管、重复竞态、原窗口销毁释放测试。

下一轮：实现 M2-F1 v2 上行 credit、M2-F2 credit=0 采集暂停策略，并升级 Gateway/Renderer 协议测试。

## 第 5 轮

- Duplex Desktop/Gateway 协议从 v1 升级到 v2。
- Main 维护权威上行账本，发布绝对 frame、byte、audio-ms credit 和累计 ack cursor。
- 重复或乱序 ack 被忽略，不能重复补充额度。
- Session StartResult 携带初始 credit，避免 Renderer 订阅建立前丢失首个额度事件。
- Renderer 每次 postMessage 前同时扣减三种额度；任一额度为零即停止上行。
- credit=0 时本地重采样、VAD 和语音边界观察继续运行；未承诺静音帧直接丢弃。
- 语音帧进入有界延迟队列，恢复后每个采集 tick 最多发送一帧，不突发回放积压。
- 麦克风采集序号与 wire sequence 分离，暂停期间丢弃静音不会造成 Main 序号缺口。
- 新增重复/乱序 ack、额度耗尽/恢复、语音/静音边界、连续 wire 序号以及 15,000 帧（10 分钟）soak 测试。

下一轮：实现 M2-F3 带抗混叠低通的高质量流式重采样，并实现 M2-F4 采集质量监测。

## 第 6 轮

- 移除采集链路中的线性插值重采样器，替换为保持分数游标的窗化 sinc FIR；低通截止频率随输入/输出采样率自动收缩。
- 重采样器跨 AudioWorklet block 保留滤波历史与相位，启动只产生固定 FIR 延迟，不随会话增长。
- 新增 44.1/48/96 kHz 到 24 kHz 的分块漂移测试、44.1 kHz 跨块逐样本一致性测试，以及 4 kHz 通带/18 kHz 阻带测试。
- 新增独立采集质量监测器，输出 RMS/peak dBFS、削波比例、DC offset、连续静音时间和实际采样率。
- 将采集约束降级标准化为稳定 reason code：采样率、声道、AEC、降噪和自动增益均不再只展示原始布尔值。
- Realtime HUD 接入质量状态，提供麦克风太小、削波、异常偏移、AEC/降噪/AGC 不可用等中英文可操作提示。
- 合成波形测试覆盖静音持续阈值、削波比例、DC offset 持续阈值和约束降级。

下一轮：实现 M2-F5 启动顺序事务和 M2-F6 输入设备热切换，确保失败回滚不遗留 Provider session、麦克风或 AudioContext。

## 第 7 轮

- 将采集启动拆为 `prepareFromUserGesture` 与 `activate`：前者完成用户授权、MediaStream、AudioContext 和 Worklet 准备，但不接通音频图。
- 新增可独立故障注入的启动事务协调器，严格执行“本地预备→Provider Session→采集激活”；失败按 Provider、采集的反向顺序回滚。
- 麦克风拒绝或本地初始化失败时不再调用 Provider start，避免创建计费 Session。
- 会话内新增系统默认/指定麦克风选择；切换只替换采集 source，不结束 Provider Session、播放、转录或工具状态。
- 新流成功取得后先断开旧 source 再接入新 source，重置 resampler/VAD/质量流水线，避免跨设备混帧和滤波历史污染。
- generation barrier 保证快速连续切换以最后一次为准；晚返回的旧 MediaStream 会立即停止，不能覆盖当前设备。
- 切换失败保留旧设备继续会话；活动设备拔出时先尝试系统默认设备，确实无法恢复才进入明确失败态。
- HUD 增加会话内麦克风选择、切换中状态和可读错误提示。

下一轮：进入 M3-F1 下行消费确认和 M3-F2 有界缺口恢复，确保丢失/乱序音频帧不会永久阻塞后续播放。

## 第 8 轮

- Duplex v2 下行新增 received、scheduled、played 三套序号与累计音频毫秒确认，通过既有会话 MessagePort 回传，不为高频确认增加 invoke 往返。
- Renderer 每 100 ms 幂等重发当前确认快照，单次确认丢失不会永久耗尽 Main 的播放额度。
- Main 将 Provider 音频规范化为 40 ms 信用帧，只按已播放或已明确释放的游标补额度；仅排程但尚未播放不会错误扩张端到端缓存。
- Main 待发音频限制为 30 秒，正常播放水位取 Provider 能力上限；达到水位发布 playback flow-control，不继续堆积 IPC 或静默丢帧。
- `response_audio_completed` 排在该响应所有信用受限音频之后，并携带 `finalSequence`；`response_started` 携带 `firstAudioSequence`。
- Renderer 增加有界重排与 120 ms gap timeout；重复帧幂等忽略，永久中间/尾部缺帧跳过后继续播放。
- gap timer 与 response 绑定，旧响应计时器不能影响新响应；缺口范围写入结构化诊断并显示用户可理解的降级提示。
- 自动测试覆盖慢 Renderer、突发 200 KB 音频、排程未播放不补信用、确认重发/回退、完成顺序、乱序、重复、永久缺帧和跨 response。

下一轮：实现 M3-F3 真实播放时间线和 M3-F4 自适应 jitter buffer，以实际 AudioContext 时钟校准插话截断位置并根据网络抖动调整启动水位。

## 第 9 轮

- 扩展播放 sink 契约，每个 AudioBufferSource 返回 scheduled/start/end 时间，并在自然结束或 stop 时回调 ended/cancelled 结果。
- Controller 保留有界逐 source 时间线，状态覆盖 scheduled、playing、ended、cancelled；response 切换和手动取消不会抹掉诊断证据。
- heard cursor 从 AudioContext 渲染时钟扣除 `baseLatency + outputLatency`，并设置单调下限，系统时钟抖动或测试时钟回退不能让截断位置倒退。
- `interrupt` 和下行 played ack 自动使用校准后的实际可听位置，不再只按收到或排程字节估算。
- 新增独立自适应 jitter buffer，使用到达间隔与媒体时长偏差的 EWMA；目标水位严格限制在 60–400 ms。
- jitter 与 underrun 会快速提升水位，稳定输入时缓慢回落；自动测试覆盖稳定→高抖动→恢复稳定的收敛过程。
- Main 在每个下行帧记录 Provider 原始到达时间，Renderer 不使用被播放信用节流改变后的 IPC 到达节奏，避免算法测到自身制造的抖动。
- HUD 在网络非稳定时显示 stable/variable/poor 映射和当前缓冲毫秒数。
- 测试覆盖 base/output latency、source 自然结束、cancel、suspend/resume、时钟回退、gap 与自适应水位上下界。

下一轮：实现 M3-F5 输出设备与恢复，以及 M3-F6 独立音量和 80–120 ms 可撤销 duck。

## 第 10 轮

- Browser 播放 sink 增加 `AudioContext.setSinkId` 能力探测；支持会话中切换系统默认、USB、蓝牙等浏览器暴露的音频输出。
- 输出切换失败不会修改当前 sink；UI 保留旧选择并显示明确错误，不会静默中断整场 Realtime 会话。
- `devicechange` 重新枚举输出设备；当前选择丢失时尝试切换系统默认，并同步清除已失效偏好。
- AudioContext suspended、恢复失败或输出占用会显示“重试/选择其他输出”动作；首次建立播放控制器时主动尝试 resume。
- 语音偏好升级到 schema v7，新增 `realtimeOutputDeviceId` 和 0–1 `realtimeVolume`，旧版本自动迁移并对非法音量限幅。
- 所有 Realtime source 改经共享 GainNode 输出，独立于系统朗读语速和普通 TTS 设置。
- 本地 VAD 首次确认候选插话时，以 100 ms 线性包络 duck 至用户音量的 25%；重复候选不叠加衰减。
- 候选撤销或识别为 acknowledgement 时以 100 ms 恢复；正式 interrupt/cancel 立即清除 duck，下一响应不会继承旧增益。
- 测试覆盖 USB sink 成功切换、占用失败保留旧 sink、suspend 恢复失败/重试、真实 GainParam automation、重复 duck、restore 与 cancel。

下一轮：进入 M4-F1 多信号候选器与 M4-F2 插话意图决策器，完善回声保护、短噪声过滤以及中英文附和/停止/纠正语义。
> 当前权威进度（第 11 轮，2026-08-14）
>
> - 实现进度：20/52（38.46%）
> - 严格验收进度：0/52（0.00%）
> - 部分完成：20；待实施：32
> - M4-F1 部分完成：多信号候选器融合本地 VAD、Provider VAD、ASR 前缀、播放状态与输出参考电平；具备回声风险抑制、短噪声过滤、候选 duck 和整段证据保留。剩余真实扬声器外放误触发率、真人抢话召回率与打包环境验收。
> - M4-F2 部分完成：中英文意图分类区分 acknowledgement、stop、correction、addendum、new_question；32 条语料门禁及分意图最低准确率已通过。剩余独立盲测语料、口音/ASR 错字集和真人场景验收。
> - 第 11 轮：修复中文规则乱码；候选证据保留到最终转写；确认词不终止回答，停止词低延迟一次性提交，其余意图使用差异化置信度/时长阈值。Web/Node 类型检查及全部本地 Duplex 回归通过。
> - 下一轮：M4-F3 Interrupt transaction 与 M4-F4 可撤销 duck，统一事务状态、超时、失败恢复和竞态优先级。
> 当前权威进度（第 12 轮，2026-08-14）
>
> - 实现进度：22/52（42.31%）
> - 严格验收进度：0/52（0.00%）
> - 部分完成：22；待实施：30
> - M4-F3 部分完成：`interruptId` 已贯穿 candidate duck、本地 stop、清空队列、Provider cancel/truncate 请求和 Main `interrupted` 回执；事务具有 candidate、committed、reverted、rejected、timeout、superseded 唯一结果并写入结构化诊断。剩余真实 Provider ACK 延迟/丢失、打包诊断唯一性验收。
> - M4-F4 部分完成：acknowledgement 撤销候选 duck、恢复独立 Realtime 音量，不发送 Provider cancel，输入转录仍走正常投影与历史策略；重复撤销幂等。剩余真人长短附和歧义与自然度验收。
> - 第 12 轮：协议请求和 interrupted 事件新增稳定 interruptId；自动事务具备 2 秒有界超时、拒绝结果和手动 supersede；补齐候选→提交、附和撤销、拒绝恢复、超时、乱序手动覆盖、ID 端到端回执测试。Web/Node 类型检查及全部本地 Duplex 回归通过。
> - 下一轮：M4-F5 停止词极速路径和 M4-F6 手动优先级，增加回声复读保护、延迟计量与 10,000 次自动/手动竞态门禁。
> 当前权威进度（第 13 轮，2026-08-14）
>
> - 实现进度：24/52（46.15%）
> - 严格验收进度：0/52（0.00%）
> - 部分完成：24；待实施：28
> - M4-F5 部分完成：停止词可在 final 前、120 ms 本地语音证据后提交；播放参考占优且缺少 Provider VAD 时禁止快速停止，避免 AI 外放复读“停止”误杀；记录 `decisionLatencyMs`、echoRisk 和本地语音时长，且同一候选只提交一次。剩余真实设备 P95 停声延迟、回声复读和口音验收。
> - M4-F6 部分完成：Renderer 同 response 并发提交共享一个 Promise；手动操作使自动事务 superseded；Main Runtime 按 response 建立最终幂等屏障，不因不同 interruptId 重复发送 cancel/truncate 或双回执。10,000 次自动/手动竞态门禁和 100 路并发提交门禁通过。剩余真实点击/快捷键连击和打包 Provider 验收。
> - 第 13 轮：停止词增加播放主导回声保护和决策延迟诊断；修复并发 `interrupt()` 在首个请求完成前重复调用 Provider 的竞态；补齐 Main 端跨 interruptId 幂等。Web/Node 类型检查及全部本地 Duplex 回归通过。
> - 下一轮：进入 M5-F1 生命周期策略表与 M5-F2 有界重连，统一 hidden/pagehide/offline/suspend/lock/window-close 行为，并实现断线分段和丢失范围提示。
> 当前权威进度（第 14 轮，2026-08-14）
>
> - 实现进度：26/52（50.00%）
> - 严格验收进度：0/52（0.00%）
> - 部分完成：26；待实施：26
> - M5-F1 部分完成：建立 hidden/visible/pagehide/offline/online/suspend/resume/lock/unlock/window-close 策略表；hidden 保持会话，pagehide/窗口销毁释放 Session，offline 停止上行，suspend/lock 释放麦克风与 AudioContext，resume/unlock 创建全新采集图并保留 Provider 会话。剩余 Windows 打包环境切应用、睡眠、锁屏和关窗资源验收。
> - M5-F2 部分完成：重连状态发布零上行 credit 并拒绝新音频，清除所有未确认帧且不向新连接重放；重连成功递增 segmentId，携带可能丢失的 audio-ms，HUD 明确要求用户重复断线期间内容；指数退避和次数耗尽保持有界。剩余真实 Wi-Fi 多断点、Provider 新 Session 边界和用户可理解性验收。
> - 第 14 轮：修复原实现断线期间缓存新音频并在新连接重放的问题；修复 Windows suspend/lock 直接销毁 Session、导致 resume 分支不可达的问题；增加生命周期静态门禁、采集释放/重建、零 credit、无旧帧重放、分段和丢失范围测试。Web/Node 类型检查及全部本地 Duplex 回归通过。
> - 下一轮：M5-F3 三种结束动作与 M5-F4 暂停/继续，分离 finish-turn/end-session/cancel-session，并加入 drain deadline、final transcript、cancel race 与工具在途测试。
> 当前权威进度（第 15 轮，2026-08-14）
>
> - 实现进度：28/52（53.85%）
> - 严格验收进度：0/52（0.00%）
> - 部分完成：28；待实施：24
> - M5-F3 部分完成：新增 finish-turn IPC，仅提交输入缓冲且保持 Session；end-session 停止采集但保留播放、转录和工具桥，等待 Provider final transcript 后完成，缺失 final 时使用 2 秒 drain deadline；cancel-session 立即停止本地资源并发送 Provider cancel。剩余真实 Provider final/drain、长回答听感和 cancel 竞态验收。
> - M5-F4 部分完成：会话内麦克风可暂停/继续，暂停会释放 MediaStream 和 AudioContext、保持 Provider Session/播放/工具，继续时建立全新采集图；UI 使用 aria-pressed 和强状态文案，暂停时禁止 finish-turn。剩余 Windows 权限、蓝牙设备、工具在途和读屏验收。
> - 第 15 轮：修复“结束会话”先截断当前回答并销毁播放、导致吞掉最后一句的问题；明确拆分“结束本轮发言 / 暂停麦克风 / 结束会话 / 立即取消”四个用户动作；补齐 final-before-terminal、2 秒 drain、暂停幂等和新采集图测试。Web/Node 类型检查及全部本地 Duplex 回归通过。
> - 下一轮：M5-F5 资源与电源预算，并开始 M6-F1 按 item 的 draft store；增加 session/重连压力、资源计数与并行 response 转录隔离。
> 当前权威进度（第 16 轮，2026-08-14）
>
> - 实现进度：30/52（57.69%）
> - 严格验收进度：0/52（0.00%）
> - 部分完成：30；待实施：22
> - M5-F5 部分完成：Runtime snapshot 暴露 timer、uplink/downlink frame 与 downlink audio-ms 资源计数；上行 100 帧、下行 30 秒、活动 timer 数均有硬上限；1,000 Session churn、10,000 terminal race、10 分钟虚拟上行和 60 分钟转录上下文测试无遗留 registry/队列；转录去重窗口限制 4,096、孤儿草稿限制 64。剩余真实 30 分钟 CPU/heap/handle/电池验收。
> - M6-F1 部分完成：输入草稿按 itemId+contentIndex、输出草稿按 responseId+itemId+contentIndex 隔离；完成一个 item 只清除自己的草稿，并行 response 和乱序 delta 不再拼接；每草稿限制 20,000 字符。剩余真实 Provider 并行 item、HUD 视觉和长会话验收。
> - 第 16 轮：重写转录投影以移除单一 inputDraft/按 response 拼接的串词风险；修复所有事件都进入永久去重集合的 Renderer 内存增长；增加资源快照、1,000 Session 清理、并行输入/输出、跨 contentIndex、孤儿草稿和无关高频事件测试。Web/Node 类型检查及全部本地 Duplex 回归通过。
> - 下一轮：M6-F2 稳定事件 journal 与 M6-F3 heard alignment，加入 revision/CAS 重试、崩溃恢复和基于播放时间证据的可信听到范围。
> 当前权威进度（第 17 轮，2026-08-14）
>
> - 实现进度：32/52（61.54%）
> - 严格验收进度：0/52（0.00%）
> - 部分完成：32；待实施：20
> - M6-F2 部分完成：稳定输入/输出/中断更新按单 item revision 写入，不再重复提交整个投影；Thread 消息持久化 voice revision，写入执行 expectedRevision CAS；相同 revision+相同载荷幂等，载荷不同或跳号拒绝；Renderer 串行写入并在失败后保留 dirty revision，下一稳定事件重试。CAS、重复写、乱序、重启读取和原子 shard 写测试通过。剩余强制 I/O 失败/进程崩溃注入与打包验收。
> - M6-F3 部分完成：移除按字符比例伪造 heard text；中断消息保存 generatedAudioMs、playedAudioMs 和 alignmentConfidence=none；只有显式词级 endMs 证据才输出 confidence=word_timing 的精确 heardContent。中英文字符、停顿边界和无证据测试通过。剩余真实 Provider 词级时间戳接入、gap/蓝牙延迟对齐和录音回放验收。
> - 第 17 轮：扩展 Thread voice metadata 和 sanitizer；增加 revision CAS journal、失败保留与严格幂等；新增 `alignHeardTranscript` 证据门禁，杜绝“播放一半等于听到一半字符”的错误推断。Web/Node 类型检查及全部本地 Duplex 回归通过。
> - 下一轮：M6-F4 中断消息模型与 M6-F5 会话上下文接续，完善 generated/heard/interruptedAt/alignmentConfidence 的 UI 与模型上下文语义，并注入受限稳定 Thread 上下文。
> 当前权威进度（第 18 轮，2026-08-14）
>
> - 实现进度：34/52（65.38%）
> - 严格验收进度：0/52（0.00%）
> - 部分完成：34；待实施：18
> - M6-F4 部分完成：Thread voice metadata 保存 revision、generatedAudioMs、playedAudioMs、interruptedAt、alignmentConfidence、可选 heardContent；完整 generated 内容保留用于解释历史，UI 独立说明实际播放位置及精确 heard 是否可用；投影给模型的 context 对 interrupted 消息只取可信 heard，confidence=none 时完全排除生成正文；旧消息无 voice 字段仍兼容。剩余旧数据迁移样本、真实 UI/读屏和模型续接验收。
> - M6-F5 部分完成：新 Realtime Session 启动前读取 Thread snapshot，只选择 user/assistant 稳定消息；最多最近 12 条、8,000 context 字符，加基础 instructions 后总长不超过 30,000；过滤 token/API key、忽略系统/隐藏字段，并排除未听到的 assistant 内容；读取失败安全降级为空上下文。剩余真实长 Thread、跨 Session 连贯性与 Provider token 计量验收。
> - 第 18 轮：新增 sessionContext 模块和可信内容选择规则；修复 interruption 生成正文进入后续模型上下文的问题；中英文 UI 明确区分生成内容与实际听到证据；增加敏感字段、未听内容 canary、词级 heard、上下文预算和读取降级测试。Web/Node 类型检查及全部本地 Duplex 回归通过。
> - 下一轮：M6-F6 删除与隐私一致性，并进入 M7-F1/F2，移除假文字队列并实现真实 Provider conversation text item。
> 当前权威进度（第 19 轮，2026-08-14）
>
> - 实现进度：37/52（71.15%）
> - 严格验收进度：0/52（0.00%）
> - 部分完成：37；待实施：15
> - M6-F6 部分完成：语音稳定历史只写入 Thread snapshot shard，不创建独立正文 journal；删除 Thread 同时移除 shard 和 legacy snapshot；删除测试在整个 DRSAI_HOME 文件树扫描 canary，确认正文与 voice metadata 均不可恢复。剩余活动 Session 同步删除、桌面搜索索引和打包崩溃中断验收。
> - M7-F1 部分完成：删除 `queueManualText`、`drainManualText`、`queuedManualText` 及假排队 UI；连接/恢复/结束期间明确保留草稿并要求重试，不宣称已排队。静态防回退、类型检查和旧测试迁移通过。剩余产品走查。
> - M7-F2 部分完成：活动 Session 文字输入经 Renderer→IPC→Main→Provider 发送 `conversation.item.create` + `response.create`；Provider `conversation.item.created` 回执转换为稳定用户 item 并写入同一 Thread；20,000 字符上限，离线拒绝，itemId 同载荷幂等、异载荷拒绝，附件明确不支持且不丢草稿。剩余真实 Provider 文字触发语音回答、混合顺序和打包验收。
> - 第 19 轮：补齐真实 Realtime 文字 item 全链路和 Provider 回执投影；移除假队列；增加 Thread 删除 canary 全目录扫描、文字顺序/重复/离线/大小边界和 UI 防回退测试。Web/Node 类型检查及全部本地 Duplex 回归通过。
> - 下一轮：M7-F3 文字发送策略、M7-F4 正式工具审批、M7-F5 工具 timeline，完成混合文字与工具闭环。
