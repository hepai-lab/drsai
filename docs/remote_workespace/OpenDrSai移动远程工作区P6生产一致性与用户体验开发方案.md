# OpenDrSai 移动远程工作区 P6 生产一致性与用户体验开发方案

## 1. 当前结论与进度

P5 已建立 OAEP/OWOP、Runtime Conversation Journal、设备绑定授权、双端会话同步、幂等恢复、端侧安全扫描和统一验收基础，但代码与真实 HAI Relay、移动端日常使用路径之间仍存在产品化距离。P6 的目标不是再增加一套协议，而是把现有能力收敛为一条可部署、可理解、可恢复、可证明的生产主路径。

P6 共 **8 个模块、40 个功能点**。当前完成 **16/40（40.00%）**。只有功能实现、对应自动门禁以及该功能要求的本地、公开环境或物理证据全部满足后才计为完成；源码存在、mock 通过或历史截图均不能替代验收。

| 轮次 | 完成进度 | 本轮完成 | 证据 |
|---|---:|---|---|
| 第 1 轮 | 2/40（5.00%） | P6-M01-F01、P6-M07-F01 | 发现并修复本仓库 `conversation-latency` 与 ai-dev 冻结合同的真实漂移：Android 改用 Event 级 `/latency-observation`，请求体改为 `client_receive_at_ms/render_at_ms`；指标改用 `/metrics/relay-latency`；Reference Relay 增加生产等价 POST/GET，并仅保留隐藏旧别名；共享 schema、Python/Kotlin 生成物和 OpenAPI 已重生成。Android 接收时只记本地时间，渲染后单次上报，4096 个待配对 Event 有界；Event ID 通过独立 path segment 编码。公开 smoke 验证 ai-dev health、OAEP schema hash、三个 Latency DTO、两个延迟端点及匿名 401；本地 Python/Android/合同/架构五套门禁通过。`round1-local-acceptance.json` SHA-256=`EDC414B0373A0137DC4A4831568A8D89B26193BF0E2F6C2FEA9894F4619CDD32`；`round1-public-contract.json` SHA-256=`9A1E1D214C8D0A78B3925B79432B2130BAFFCACD62C84C15836B6A0D386BFE9A`。 |
| 第 2 轮 | 3/40（7.50%） | P6-M01-F02 | Android 的 Discovery/Pairing、Remote Repository、SSE、OWOP 四类联网入口统一使用逐段 `addPathSegment`，Python Gateway/Relay/Mobile Pairing 统一使用 `encoded_path`；资源 ID 不再作为路径语法参与拼接，query 也统一编码。新增 `/ % ? # 空格 Unicode`、query 注入、空值/NUL fail-closed 以及设备 proof 对最终 encoded path 签名一致性测试；架构门禁拒绝重新出现动态插值路径。修复权威本地门禁误用系统 Anaconda 导致 20 分钟插件扫描超时，固定使用仓库 `.venv`。保留失败的 round2/round3 报告；最终 round4 五套门禁同轮通过，Android JVM 566 项、0 失败（2 跳过），Debug/Release AndroidTest 编译通过；ai-dev 公开 OAEP/Latency 合同及匿名 401 共 8 项通过。`round4-local-acceptance.json` SHA-256=`6672A15F674FEA2397A333CC38AB27FABCDCCDE29B71582CDCC986849CB5F53A`；`round4-public-contract.json` SHA-256=`4C0029E2BC87C05F1DF4A878706488204F224824A2F4CFD6C551722CB3C0214E`。 |
| 第 92 轮 | 4/40（10.00%） | P6-M01-F03 | 共享 Relay schema 新增 Session/Run/Approval/Latency 写请求、权威投影及三类幂等恢复 wrapper 的严格 DTO；Python/Kotlin 生成器统一输出 unknown/missing/type fail-closed 模型并嵌入 schema SHA，Reference Relay 与 Android 主路径移除对应手写 dict/JSONObject。Gradle 生成与 `--check` 绑定，公开 smoke 接受唯一严格 2xx 响应且覆盖 200/201。ai-dev 依次修正 Session 可选字段、Run 必填字段、Approval `agent_definition_id` 和最小恢复 projection，最终 revision=`5cf32af306dbef97af5afad15afecdde2e43064a`，HAI 回归 `199 passed`。本地五套门禁同轮通过；公开写合同 7 项及既有 OAEP/Latency 8 项通过。`round7-local-acceptance.json` SHA-256=`1C112B83EC55ECCC652B0A07C290D83D14B4E9D1FF3DFA7B853523A6E9C4D766`；`round7-public-write-contract.json` SHA-256=`A5AAAB9270A3B6464A62F5A61BB1909C8A85490D63BD27E609F6BE3D08E3C296`；`round7-public-contract.json` SHA-256=`885271B2BC1D13566CC94CB7A70CE64E3BBEFB23B2A846D9045EAC2676703BFB`。 |
| 第 92 轮（第二阶段） | 5/40（12.50%） | P6-M01-F04 | 在共享 schema 中冻结 `retry/login/re-pair/update/contact-admin` 五类唯一用户动作；生成器同步输出 Python、Kotlin、TypeScript 映射。Android 改为按结构化 error code/retryable/status 选择单 CTA，移除从中文错误文案推断登录、撤销和版本状态的逻辑，并让登录、扫码、更新、诊断和重试按钮均有真实落点；Desktop 提供同源安全 presentation。Reference Relay AST 穷举与 HAI 生产审计合并为 131 个固定公开错误码，未知上游错误只按 retryable 安全兜底。ai-dev revision=`7f08638b9962ec23e955cd9f4f553f4aac062cba`，HAI `333 passed`；公开扩展哈希=`1d879874f04f22ee23f973d40a0dc3f21339ff3dcbda3f7bc9044e53c9114ffe`。本地 6 套门禁通过。`round8-local-acceptance.json` SHA-256=`8D57565DD3FBF0A2BF0A06B33885E14FD6FA307C2C95A5642B1E6DEB566BA7EF`；`round8-public-error-actions.json` SHA-256=`188F4AB328683E233822577310C1B1848CBE164710DFD4077CE00EABDA6EF4BB`；`round8-public-write-contract.json` SHA-256=`2A980B3E3BF8C41871C61B50F2D581C691F8B9631FCABB1743F072256F731349`；`round8-public-contract.json` SHA-256=`BF48A40225AA44531C17E6CEB278B0331C2866B4BD36842C8C40B33EF89E3328`。 |
| 第 92 轮（第三阶段） | 6/40（15.00%） | P6-M01-F05 | 自动生成远程工作区专属 Legacy 清单，现存 11 项 route/DTO/table/subscription/adapter/selector/telemetry 均绑定真实消费者、匿名聚合 usage telemetry 和回滚 owner；OAEP Python/Android/Desktop 核心反向依赖门禁为零。删除条件移除 14 日与两个发布周期等待，改为 OAEP 使用率、Legacy/回退率、迁移完整性、受支持 Runtime 依赖、回滚包和 transcript 哈希的即时证据门禁。确定性回滚包包含 35 个文件，隔离 SQLite up/down/up 后 transcript 哈希一致；首次两份整套报告因沙箱不能读取 Gradle 用户缓存而保留为失败，允许缓存访问后 7/7 门禁同轮通过。Legacy inventory SHA-256=`222F208EB913DA1EDACF10032839B0487FDFA80CA9B2DCEC7FAC25210E710DEB`；`round9-legacy-rollback.zip` SHA-256=`A8C42C621E76A375A7BA67C7769798B19AE194700432ECE430EF75CBCB154EBF`；`round9-legacy-migration.json` SHA-256=`AE75FEC2CBE733C13DE2D6544E726939839ACDBDF7C67C26F73F273A5856119E`；`round11-local-acceptance.json` SHA-256=`12EFD9EB5E50E881EFF494DCACC72AD9B3DA43CD5270ADEAFC0B61851FAAA820`。 |
| 第 93 轮 | 7/40（17.50%） | P6-M02-F01 | `RemoteWorkspaceContainer` 不再公开 Repository、SSE、Proof、Legacy adapter 和幂等 ledger，而是只提供 Auth、Association、Catalog、Session、Run、Approval、File、Push 八个显式边界；Home、Workspace、Session、Audit、Push Worker 与设备 Presence 已迁移到各自能力边界，仍复用唯一 DB/HTTP/Auth/Proof 资源。新增 fail-closed 架构扫描，验证恰好 8 个边界、0 个原始能力绕过和关键消费者依赖方向；Android JVM 576 项通过、0 失败、2 跳过，Debug/Release instrumentation 编译通过。旧审计页泄露内部 correlation ID 同轮移除。round12 静态清单失败证据保留，修正后统一 8/8 门禁通过；`round13-local-acceptance.json` SHA-256=`D1D977ED4CE94887A09DAA180CE812132AC0400E6C7E190E8527FF9D96CA8B9D`。由于容器结构变化，Legacy 回滚包同步重发为 36 文件且 transcript 仍一致：`round14-legacy-rollback.zip` SHA-256=`82CE092422F98ECDC4EADB9C495EC33C123B5E718219FFEB1AD4C22B66E44EBD`；`round14-legacy-migration.json` SHA-256=`FAA54DA2B5F9439E8850AD8229C4A3AABE74992A724244EDD37418F0DF0E1A20`。 |
| 第 93 轮（第二阶段） | 8/40（20.00%） | P6-M02-F02 | 从 1300 行会话 ViewModel 抽出 SessionSync、Projection、RunControl、Approval、Draft 五个纯状态机，并接入前后台/换网/认证撤销、OAEP/Legacy sequence、取消/重试 single-flight、审批恢复和草稿 revision 路径；ViewModel 不构造任何 HTTP/SSE 实现。新增 10,000 次同步交错和 10,000 级序列单调性 property test，gap/duplicate 不推进、旧草稿持久化不覆盖新 revision、运行和审批重复提交 fail closed。Android JVM 580 项通过、0 失败、2 跳过。round15/round16 因旧门禁和共享 Kotlin incremental cache 竞争保留失败；验收脚本改为单 worker + in-process Kotlin 后统一 9/9 通过。`round17-local-acceptance.json` SHA-256=`5F1290F65E92AD482BBDEB2F40F131F978AA298E736B1E3EEFAD665C7465EF3D`。Legacy 回滚包随状态机依赖更新为 37 文件，transcript 不变：`round18-legacy-rollback.zip` SHA-256=`8CD632E09D9B4B29483017D178C034E4DFC7BFD2B247243D67C2A5D7BEC46769`；`round18-legacy-migration.json` SHA-256=`29FEDEE3EB7848FDCC8DCE592BEF64C102C971268962B43F8B885D7227D9336A`。 |
| 第 94 轮 | 9/40（22.50%） | P6-M02-F03 | `RemoteChatUiState` 移除可独立写入的 `online/running/canRetry/connectionState` 四个字段，统一从 `RemoteSessionUiAuthorityState` 派生；Room 是否有内容、连接状态与 Run 状态由单一 reducer 汇聚，所有 ViewModel 写路径改为 Connection/Run/Snapshot authority event。Reducer 对 generation 严格 fencing，旧 generation 直接返回当前状态。新增 10,000 次随机连接×缓存×Run 组合 property test，验证 `running && canRetry` 永不成立、online 与 connection 唯一对应、lifecycle 不矛盾，并显式验证 generation 19 不能覆盖 generation 20。Android JVM 582 项通过、0 失败、2 跳过；统一 10/10 门禁通过。`round19-local-acceptance.json` SHA-256=`2047FFE34B9C55BF80190AC2BBF2F6B636FC9DEA5947B5B4C5FFF936BEBABB0B`。Legacy 回滚包更新为 38 文件且 transcript 一致：`round20-legacy-rollback.zip` SHA-256=`FF8000D02666A4C7B81287BA75E1CCE4CC699918FAE5B7B29D1D299270F429BC`；`round20-legacy-migration.json` SHA-256=`39239EB0F2C54936CDB5CF5F225731549C0243F074F5C252AC3E3F3B3FA206E2`。 |
| 第 95 轮 | 10/40（25.00%） | P6-M02-F04 | 将 DB、共享 HTTP/连接池、四类 SSE、token refresh、device proof、latency tracker、connectivity、single-flight 与 session sync 收敛到进程级 `RemoteWorkspaceContainer` 的9类唯一 owner；原始 DB/HTTP/Auth/Proof/Repository/SSE 改为私有，只经8个领域边界借用。`RemoteResourceLeaseRegistry` 改为先注册 owner、再借用，拒绝第二 owner、未注册资源、目录/容量溢出；四个真实 SSE 入口全部在完成、异常或取消时归还租约，最多8条；SingleFlight 最多128个活跃键；Latency tracker 最多4096条。新增页面、账号、换网各100次回基线、1万 latency event、真实 SSE 租约归还和溢出 fail-closed 测试。Android JVM 586项通过、0失败、2跳过；统一11/11门禁通过。`round21-local-acceptance.json` SHA-256=`58A7A6674972CF027F0E867D8AF35110F741E20E070D76D09AF1DCED85E73B5F`。Legacy 回滚包更新为42文件且隔离 migration transcript 一致：`round22-legacy-rollback.zip` SHA-256=`39ADBE1DCC5B7DBCD4BED4ED6DBAC666D26A382EE24AB33B1F7309DAC90760E3`；`round22-legacy-migration.json` SHA-256=`9CE6C96363B59BD6F478BF4191EA5F2DA3506D29C2F9145967EDB2516A827C17`。 |
| 第 96 轮 | 11/40（27.50%） | P6-M02-F05 | 新增进程级 `RemoteTimeScheduler`，统一注入 wall clock、monotonic clock、suspend sleeper 与16ms frame scheduler；Session 持久时间/账本过期、重试窗口、两处帧合并，Home/Workspace 搜索和目录重连，Run/Approval 幂等恢复，SSE 解码计时及 Presence 循环均不再直接依赖真实时间或 sleep。Wall age 与 monotonic elapsed 对时钟回拨饱和为0；持久过期使用 wall clock，进程重建后不复用旧 monotonic 起点。新增回拨、跨日、进程重建、100轮 retry+frame 无真实 sleep 测试；旧 P5 latency/backpressure 门禁同步升级为要求注入式单调时钟与 frame scheduler，而非削弱语义。Android JVM 589项通过、0失败、2跳过；统一12/12门禁通过。`round23-local-acceptance.json` SHA-256=`4AE8D67EB8257E39A13037E1F103E8EDA671AF6061A0ECA0406D96EB46871ED5`。Legacy 回滚包更新为47文件且隔离 migration transcript 一致：`round24-legacy-rollback.zip` SHA-256=`085FC8BE3B21E06D0D2937895DA280BF31650CF89DAD1B1B4DBC506F38B4FCE2`；`round24-legacy-migration.json` SHA-256=`86485640786F02718A0F39A05E6482B56E2C10F229B843F8DE63A7A2E7652DBE`。 |
| 第 97 轮 | 11/40（27.50%） | P6-M03-F01 local_pass / physical_pending | Desktop 配对弹窗改为“允许连接→选择范围→扫码连接→完成”的显式向导；范围必须先写入一次性 Grant 再展示二维码，避免 Android 扫码后扩大权限。自动创建 Grant 改为用户确认范围后创建，范围变化不再后台反复签发/撤销；每个状态最多一个主操作。Android 新增 SCANNING/CONNECTING/COMPLETE/FAILED/IDLE 纯 reducer，扫码启动、空码、取消、连接中、成功和结构化失败均有可见状态，payload 未经显式扫描直接消费会 fail closed。8条 Desktop 状态旅程、Android reducer 测试、Windows 全量 TypeScript 和 Android JVM 592项（0失败、2跳过）通过；统一13/13本地门禁通过。`round25-local-acceptance.json` SHA-256=`A4D56B05BE96C30C093DDB7ED764643E02869E94F5BF569DAC2CECF4A07D59D0`；53文件回滚与 transcript 验证通过：`round26-legacy-rollback.zip` SHA-256=`0243493EC56976121CC3F1F607718549D3EFC313C9A6C3863C1346AA2C141A26`，`round26-legacy-migration.json` SHA-256=`77399A38C73E91AE34379612C6B5B44FCAE30ED8593187B464159541D5355D3C`。三星仍未出现在 ADB（仅 `emulator-5554`），故未注册、过期码、错误账号、成功四条真机旅程缺证据，本功能不计完成。 |
| 第 98 轮 | 12/40（30.00%） | P6-M03-F02 | 新增二维码生命周期纯模型，pending 在边界时刻确定性转为 expired，consumed/revoked 不被本地时钟覆盖；刷新先撤销旧 Grant，再签发新 Grant，并以 `activeGrantRef.grant_id` fencing 迟到轮询，旧响应不能覆盖新二维码。移除 UI 中明文手工 pairing code 与复制入口，日志/DOM 文本不再包含 code；二维码仍只承载短时、单次 Grant。既有 Registry 并发测试证明同一码仅一个消费赢家；新增服务测试证明过期恢复只调用两次 create，不启停或重注册 Runtime。定向 Python 37项、Windows 全量 TypeScript、生命周期4边界与统一13/13门禁通过。`round27-local-acceptance.json` SHA-256=`14A0675D513C2F0D77302A9F6FC05A8420DE78FB6A41C5D5ECFE8B55150D9F1B`；54文件回滚与 transcript 验证通过：`round28-legacy-rollback.zip` SHA-256=`8E18F587B87C0660C2A53CBF40D0D6AD3EE1965F4A6F9BB4EC2224CBC18AAB82`，`round28-legacy-migration.json` SHA-256=`18F6CB05CE76CD16A0A92CFDD62C6AA88A31BEAFD4A2E5070887683B9C3EE1D5`。 |
| 第 99 轮 | 13/40（32.50%） | P6-M03-F03 | Android 主机状态收敛为单一产品展示模型，在线、离线、暂停、撤权、不兼容、通知不可用均给出明确原因和唯一下一步；空状态移除 `Runtime` 术语，`RemoteComputerUi` 移除 `instanceId/connectionGeneration`，界面不展示 generation、WSS、issuer。新增六状态纯模型测试、fail-closed 静态门禁及 Compose 语义/视觉矩阵；在 `emulator-5554` 生成6个不同快照，完整 `RemoteWorkspaceUiTest` 11/11，通过仅作为模拟器 UI 证据。Android JVM 594项通过、0失败、2跳过，统一14/14门禁和 Debug/Release AndroidTest 编译通过。首次 round29 因旧架构检查仍读取迁移前通知文案而失败并保留，修正后同名最终报告通过：`round29-local-acceptance.json` SHA-256=`985FC438ED75DDCB7143526B3911D2D956A2E7DEC3418840BCD933C394723281`；57文件回滚与 transcript 验证通过：`round30-legacy-rollback.zip` SHA-256=`D51559C33400B8410931835CA774AAAE7F3B52141FC90773BB238863CEAAEEE8`，`round30-legacy-migration.json` SHA-256=`3ED4AD8281C2697157F71BAC79DDBE8755EB45F94C855B0B8CB9919D1591F577`。三星真机仍未进入 ADB，本功能不以模拟器冒充真机；M03-F01 的四条物理旅程继续保持 pending。 |
| 第 100 轮 | 14/40（35.00%） | P6-M03-F04 | 设备管理已贯通 Relay→本地 Runtime→Desktop：设备列表展示安全别名、最近在线、友好权限和指定 Workspace 数量；保留暂停、恢复、单设备/全部撤销，并新增“管理范围”编辑器。范围编辑纯模型只暴露当前授权内的工作区，拒绝空范围与无变化保存；`all` 可收敛为当前 selected，selected 只能继续取真子集。Gateway/Transport/DTO 新增严格 `workspace_scope/workspace_ids`，Relay 在代理前执行设备绑定 Workspace 门禁，缩减后立即发送 `authorization_changed` 关闭实时流；任何扩权返回 `authorization_expansion_forbidden`，必须重新扫码授权。A/B 两设备分别绑定 W1/W2，四个允许/拒绝 IDOR 分支、缩减断流、扩权拒绝及本地管理 API 实链共72项定向测试通过；Windows Desktop 全量 TypeScript 通过，macOS 新增 IPC 类型无新增错误但全仓仍有既有基线错误。统一15/15门禁通过：`round31-local-acceptance.json` SHA-256=`BED02DC01561B780111847F38DF3DD75C75235CC357783EC9C45F26EBD989BF7`；67文件回滚与 transcript 验证通过：`round32-legacy-rollback.zip` SHA-256=`8139F27F903A4F07F8374E34F25FFF6EF87B49E0AC64D05AC47A595B35A97B20`，`round32-legacy-migration.json` SHA-256=`DDA39B6E24CCEBF735DE48F16AB2FAF90C330A55D0AF833AF84FA3607E6499BF`。 |
| 第 101 轮 | 15/40（37.50%） | P6-M03-F05 | Desktop 与 Android 已提供统一的一键连接检查。诊断按电脑、平台连接、登录、设备身份、版本协议、后台通知六个用户边界分段，健康态加六类单故障组成七个固定 fixture；只选择最早的真实失败并给一个建议，`unknown` 只作信息状态，不再误报故障。Android 远程工作区菜单新增“检查连接”，结果卡片可直接重试、登录、重新扫码、更新或启用通知；Desktop 原有入口补齐设备身份与通知边界。诊断包只含 schema、枚举检查状态与动作，不含 ID、token、正文、路径或原始错误。七类 fixture、七个唯一动作及七份诊断包扫描零命中；Windows Desktop 全量 TypeScript 通过，Android JVM 596项通过、0失败、2跳过，Debug AndroidTest 编译通过。统一16/16门禁通过：`round33-local-acceptance.json` SHA-256=`A0CEBF909BF0F0ED13C9281F0CB494B66A3397E5DD35CD19C90D5D64138290CA`；70文件回滚与 transcript 验证通过：`round34-legacy-rollback.zip` SHA-256=`8003C01BCD8CBFC05E5890F3E3F57C48916D9192035E406E001EC4F50E7FF685`，`round34-legacy-migration.json` SHA-256=`3DE4BB016A28A880BFB95FE209D059BCE0E2A49DF77720DDEB1E7C3FD8C8D609`。三星真机仍未进入 ADB，M03-F01 的四条物理旅程继续保持 pending。 |
| 第 102 轮 | 15/40（37.50%，local_pass） | P6-M04-F01 | Session Catalog 两端实现已从轮询/无类型信号收敛为 Runtime Conversation Journal 驱动：Runtime 新增 Workspace 级本地 SSE，只在事务提交后发送不含标题、正文和路径的 Event；Desktop 为每个已打开 Workspace 建立有界重连订阅，按 Event 读取单个权威 Session 并实时更新侧栏，不再依赖15秒目录轮询处理 rename/archive；Android 严格解析四字段 Event，执行 event-id/sequence 去重、碰撞 fail-closed，并以单一投影校验 scope、lifecycle、重复 ID 和稳定排序。rename→archive→unarchive→rollback 四阶段、本地零手动刷新、10,000 Session 稳定投影、断流后连接刷新恢复均通过；Windows Desktop 全量 TypeScript 通过，Android JVM 599项通过、0失败、2跳过，Debug/Release AndroidTest 编译通过。统一17/17门禁通过：`round35-local-acceptance.json` SHA-256=`5F422531A6BE80644DF040FAEC93747826CA803C2ECB2F3B903D32832377B48C`；73文件回滚与 transcript 验证通过：`round36-legacy-rollback.zip` SHA-256=`81F4FAEFB95213839CEE5684ABD944B9CEA46B389B1678C69917EC73FED34032`，`round36-legacy-migration.json` SHA-256=`D242FEB49D15D7AE1AE06172D32E6B7A2914EF8D62E5762A535AA326C9BBFF6B`。三星仍未进入 ADB，双端真机四阶段证据缺失，故本功能保持 `physical_pending`，不计入40项完成数。 |
| 第 103 轮 | 15/40（37.50%，实现完成、门禁未通过） | P6-M04-F02 第一阶段 | Runtime、Desktop、Android 已统一使用 OAEP 语义 transcript 摘要；Snapshot 完整窗口新增 checkpoint 校验，Event 新增 session/run/item scope 校验，Android Room v15 持久化完整 source metadata，并支持 delta 先于 Item 到达时建立实时 shadow projection；Reasoning 的 kind/visibility/source、Command/Tool 的 replay policy 和 Run 投影均不再在编解码或展示中丢失。首轮统一验收 17/18，仅综合 Python 套件中旧 Snapshot 测试仍按原始 JSON 字节哈希验算，故保留失败证据 `round38-local-acceptance.json` SHA-256=`D95BFA4C92BA7163E0B46713AF58D174B1ABBFF00886A56156D04B45607AEE52`，本轮不计完成。 |
| 第 104 轮 | 15/40（37.50%，local_pass / physical_pending） | P6-M04-F02 本地闭环 | 修正 Desktop 未归一化空 `parts`、Android 空 `replay_policy` 判断以及旧 Snapshot 测试的字节哈希假设，三端对同一完整窗口得到唯一语义摘要 `7b96a4bc0d4a4138cc37dc40a25e7e17147ef99802a76edd61cc98e6cbe50798`。Python 聚焦44/44、Desktop Conversation verifier、Windows node TypeScript、Android OAEP 10项聚焦测试、Debug/Release AndroidTest 编译均通过；统一18/18门禁通过：`round39-local-acceptance.json` SHA-256=`2EC5970C2E925AF6A89FA20435B525239BFA36F66340A60F510CB7661E357864`。82文件确定性回滚包与隔离 SQLite up/down/up transcript 验证通过：`round40-legacy-rollback.zip` SHA-256=`8DFEA77ACA8ABB81E500DA17A20E990D5F4D8E0CF794AD159EE6B68CD513E719`，`round40-legacy-migration.json` SHA-256=`A6385FA9ADCD24CD078030C9F510297A1993B49274048A70328574767FE31826`。三星真机当前未进入 ADB，Windows→Android 与 Android→Windows 新轮次、模型增量、Tool/Approval 的真实链路及三端最终 transcript hash 尚缺物理证据，因此不计入40项完成数。 |

| 第 105 轮 | 15/40（37.50%，local_pass / physical_pending） | P6-M04-F03 本地闭环 | 消息提交统一为 `optimistic→sending→accepted→running→terminal`，并显式保留 `uncertain/failed` 分支；Runtime 新增按 Session 与幂等键只读查询既有 Run 的端点，跨 Session 查询 fail closed，SQLite 重启后仍可恢复同一 Run。Desktop 在请求后断线、504 或 Runtime 重启时只执行有界只读查询，不重复 POST；持久 Outbox 保存交付阶段，进程重启可接回已创建 Run。Android 既有幂等结果查询、504/断线恢复和 Room 状态防回退纳入统一门禁。Python 聚焦42/42、Desktop 全量 TypeScript、89项 Remote Gateway OpenAPI 生成物防漂移、Android JVM/Debug/Release AndroidTest 编译均通过；统一19/19门禁通过：`round41-local-acceptance.json` SHA-256=`0CF0E51921850CC48B8EE430B6F26C62ABFF2842165E90C3FF95BEFACC86DD84`。90文件确定性回滚包与隔离 SQLite transcript 验证通过：`round42-legacy-rollback.zip` SHA-256=`FA8B41B10314257625CC0A8FC3A085904B12333E44AA2029732D763485571445`，`round42-legacy-migration.json` SHA-256=`3F90EA2AD8B81E9864CEA3D0E85CE9335E0D4D37F10D00E8F22B585F2671CEBD`。尚缺三星真机请求前/后断网、504 与 Runtime 重启的双端证据，故不计入40项完成数。 |
| 第 106 轮 | 15/40（37.50%，local_pass / physical_pending） | P6-M04-F04 本地闭环 | 修复 Approval 已批准但 Tool 尚未领取时另一端取消 Run 后授权仍可执行的问题：取消及所有 Run 终态现在原子撤销 requested/approved Side Effect、关闭 pending Approval，并提交唯一 OAEP 终态 Item/Event；Side Effect 领取同时校验 Run 与 Approval 仍为 active。Android Approval 投影终态不再被迟到 pending/相反决定覆盖；Desktop 的 Run Approval 和 Agent Approval 在响应丢失或5xx后只读取权威 Approval，不重复 POST，确定性409直接失败。64路 approve/deny/cancel 与64路 claim/cancel 竞态证明唯一终态和最多一次 Tool；Runtime/Relay/Codex 聚焦117项与12个子测试通过，Desktop 全量 TypeScript、Android状态机及Debug/Release编译通过。统一20/20门禁通过：`round43-local-acceptance.json` SHA-256=`CACC16CE6C21F6A74ED309F24C9F8AF74355A81FA9E258C6296CD484A5BFCDF1`；91文件回滚与隔离 SQLite transcript 验证通过：`round44-legacy-rollback.zip` SHA-256=`4702BEA516955CFC47BF103DD731F4D9C7132EADBF62868A52C4BA2BCCE73DC0`，`round44-legacy-migration.json` SHA-256=`0F653DDA37C279C160B0CE19E12B50A1CB4C85CDDA879AF04FD623E460522E55`。尚缺两端真机64路竞态和失败端1秒内收敛证据，故不计入40项完成数。 |
| 第 107 轮 | 15/40（37.50%，local_pass / physical_pending） | P6-M04-F05 本地闭环 | Android 首屏从“把 Room 中整个会话读入内存”改为最多2,000条的数据库窗口，保留 checkpoint 分页与完整离线缓存；新增经 `%/_/\\` 转义的本地分层搜索、150ms 可取消防抖、无结果状态、类型过滤，以及按稳定 Item ID 恢复历史加载锚点。未读/自动跟随抽成纯状态机：读旧内容、搜索或加载历史时新增消息只建立未读边界，不抢滚动位置。Desktop OAEP 投影由逐 Run 全表扫描的 O(R×N) 改为一次分组，既有窗口分页、内容虚拟化和会话搜索纳入同一门禁。真实构造100,000 Item/10,000 Run 的 Desktop 投影约107ms，10,000 delta约3ms；Runtime 的100k checkpoint 流式窗口测试、Android 2,500行 Room 窗口/离线特殊字符搜索 instrumentation 测试（已编译）、导航状态机及长会话门禁全部通过。稳定工作树上 Python 415项、Android JVM 604项（0失败、2跳过）、Desktop 全量 TypeScript、Debug/Release AndroidTest 编译及统一21/21门禁通过：`round47-local-acceptance.json` SHA-256=`07DF19321450184D5DEC22D911C302474E57F291233406D12706DFF7B18462D1`。运行中改动工作树导致的首份失败报告 `round45-local-acceptance.json` SHA-256=`C0C65D077CE09A4BD479573B1D1F86827B30DD6F9D5195A95F3238A2D3D77664` 保留且未冒充通过。95文件回滚与隔离 SQLite transcript 验证通过：`round46-legacy-rollback.zip` SHA-256=`5C19604A30467F6042FB08018CDCA96E589B2206FEADC55A7F8D82C86E0B80F8`，`round46-legacy-migration.json` SHA-256=`7F568F62E92C4709B76E013452213C17E2CD97C31C24FF149B04AF68CFE74703`。三星仍未进入 ADB，Android 真机100k冷启动/内存、离线搜索、阅读位置及10k delta主线程响应证据缺失，故不计入40项完成数。 |
| 第 108 轮 | 16/40（40.00%） | P6-M05-F01 | Reference Relay 新增公开、严格且无认证依赖的 `/v1/push/readiness`，独立报告 FCM 配置与 Worker 存活，只有二者同时成立才返回 `ready=true`；OpenAPI 已重生成。Android 不再把本地 Firebase SDK/系统权限误当成端到端成功：先检查安装包、Play Services 与通知权限，再严格读取平台 readiness，未知字段、错误类型或不可能组合均 fail closed；异步结果以 generation fencing，不能覆盖更新后的本地权限状态。Remote Home 每次回到前台都会重新检查 readiness、调度注册并权威补拉目录；三类不可用状态统一明确“打开 App 后会自动同步最新进度”，不伪装后台通知成功。Reference Relay false/true 四组合、Android 本地/平台矩阵、严格 JSON 漂移、文案和前台生命周期均通过；Android JVM 610项（0失败、2跳过），Relay 聚焦82项及统一22/22门禁通过。首次统一门禁因旧架构检查仍要求枚举位于 ViewModel 而保留失败：`round49-local-acceptance.json` SHA-256=`4A650962A00477DD097C8820A60780F53D12AE7592AF133DE4B46F3C0714DF6D`；最终 `round53-local-acceptance.json` SHA-256=`250792EBDAE08E8D3A531EAEC19C5D21A11A8DDF996C87111D0724B6D74FBB60`。ai-dev 公开端点只读实测 `FCM=false/worker=true/ready=false`，证明生产环境诚实降级：`round108-public-push-readiness.json` SHA-256=`2A4EA643B98AB0FD91BDA907C70C7B3EF065FA95714486BD690A749329916E35`。98文件确定性回滚及隔离 SQLite transcript 验证通过：`round52-legacy-rollback.zip` SHA-256=`7CF0467967B3CFBCCFF7E05E670F41B6FB2BDF22872129D91490B542C6E8E47B`，`round52-legacy-migration.json` SHA-256=`06975A7A5CA22F11ECC85C294D82971E03BB6CBFDAB6BED562CD795F813A7BE9`。 |
| 第 109 轮 | 16/40（40.00%，local_pass / physical_pending） | P6-M05-F02 本地闭环 | 审计发现旧实现虽已有 opaque FCM payload 与安全 PendingIntent，却在进入会话时提前清除持久导航；目标 Item 不在首屏窗口时无法精确恢复。现改为通知 route+Item 原子持久化，只有目标 Item 真正滚动可见才清除；冷启动从 Room 按 Item ID 补入窗口，找不到时刷新权威 Snapshot 后再查，仍不可用则明确保留并提示，不静默跳到会话底部。新增 pending/locked/login-required/navigating/focused 状态机，覆盖 App 被杀恢复、锁屏解锁、有效登录、启动时过期和导航中401；错误 Item 不能确认另一通知。会话401新增可执行的重新登录入口，登录完成后继续原导航；外部 item ID 严格限制为 bounded opaque ID，关键 SharedPreferences 写入/清除改用同步 commit。Relay payload 仍严格只有7个 opaque 字段，消息、命令、路径和正文为0。Android JVM 615项（0失败、2跳过）、通知专项9项、Debug/Release AndroidTest 编译及统一23/23门禁通过：`round55-local-acceptance.json` SHA-256=`21126E6D156799643ACAC6ABE099848DB8D6F4AC4B5BC87CD076E1FD7D76AC86`；100文件回滚与隔离 SQLite transcript 验证通过：`round54-legacy-rollback.zip` SHA-256=`286D8D4DA1D1946559C4E0A7E8D4C26EB9553EB4C146746F60F6252E1485F6AF`，`round54-legacy-migration.json` SHA-256=`0CF375973CAC1C44C9AB5A4D3D6ABA3A5B7A6DB80204CDC45ABDA96A8B4A2073`。因三星不在 ADB 且 ai-dev 当前 `ready=false`，尚无真实 FCM 的杀进程、锁屏、冷启动、登录有效/过期五场景证据，故不计入40项完成数。 |

## 2. 代码实现审计

### 2.1 当前设计合理的部分

1. **Runtime 是会话权威。** Session、Run、Event、Approval 和 Conversation Item 均由远端 Runtime 产生，Android/Windows 只维护可重建投影，符合“人机交互在移动端，Agent 仍在 Windows 执行”的边界。
2. **OAEP 与 OWOP 分工清楚。** OAEP 表达长期可回放的会话事实，OWOP 表达文件、Shell、Tool 等工作区操作；Relay 只做身份、路由、重放和跨网络扇出，不成为第二个 Agent Runtime。
3. **恢复语义优先于盲目重试。** `source_message_id`、幂等键、Run/Approval 本地加密账本和权威查询避免网络异常造成重复 Tool 或重复审批。
4. **授权边界基本完整。** OIDC 用户身份、设备 proof、association、Workspace allowlist、read/send/approve/files 权限分别建模，撤权发生在代理调用前。
5. **本地数据可重建。** Snapshot checkpoint、Event cursor、Room 投影和账号/Runtime 清理边界已经具备长会话和离线查看基础。
6. **验收开始 fail closed。** 统一 CLI、物理设备识别、secret scan、环境指纹和 finalizer 能拒绝模拟器冒充、混环境和缺来源证据。

### 2.2 功能完整性问题

1. **生产合同没有被持续当作权威。** 第 1 轮实测发现本仓库发送 `/conversation-latency`，而 ai-dev 已冻结 `/events/{event_id}/latency-observation`；本地测试全部通过仍无法在生产工作。共享 schema、Reference Relay 和 HAI OpenAPI 必须进入同一个 drift gate。
2. **物理链路仍缺完整闭环。** P5 剩余的 Session Catalog、Approval 竞态、504/Runtime 重启、两设备隔离、后台/换网、1 小时稳定性和真实 canary 仍需转正，不能由 P6 重新命名后消失。
3. **推送仍依赖未配置的平台资源。** Firebase project、ADC、keyring、active key 未就绪时必须明确显示“后台通知不可用”，不能让用户误以为杀进程后仍会收到通知。
4. **路径构造仍以字符串拼接为主。** OAEP ID 合同允许一般字符串；直接插入 URL path 会造成 `/`、`%` 等字符的路径歧义。第 1 轮仅先修复 Latency Event ID，其余资源需迁移到类型化 segment builder。
5. **Legacy 删除还缺生产阈值。** compatibility 层已经隔离，但迁移率、fallback 和回滚包未达到删除条件，不能提前移除，也不能永久保留双实现。

### 2.3 用户易用性问题

1. **连接过程暴露实现术语。** 用户关心“这台电脑能否连接、为什么不能连接、下一步做什么”，不应先理解 Runtime、Relay、OIDC、WSS、generation。
2. **状态来源过多。** Host、Workspace、Session、SSE、Room cache 和 optimistic Item 分别维护状态，用户可能看到“主机在线但会话加载失败”而没有统一解释与唯一操作。
3. **恢复动作不够聚合。** 登录过期、设备撤权、Runtime 暂停、协议不兼容、网络离线应分别给出唯一 CTA；当前部分页面仍依赖刷新或通用错误提示。
4. **会话页面职责过重。** `RemoteSessionViewModel` 约 1470 行，同时承担协议选择、Snapshot、SSE、投影、Run、Approval、草稿、重连、性能埋点和 UI 状态，修改任一功能容易产生跨状态回归。
5. **网络 Repository 过于集中。** `RelayRemoteRepository` 约 720 行，目录、会话、Run、Approval、文件、审计、推送和遥测共享手写路径与 JSON，生产合同漂移难以及时定位。
6. **后台能力缺少诚实降级。** Push 未 ready 时应说明“打开 App 后同步”，并在恢复前台后主动补拉；不能静默依赖已停止的 SSE。

### 2.4 确认需要移除的部分

| 对象 | 处理方式 | 删除门槛 |
|---|---|---|
| Android 未使用的 `postNoContent` | 立即删除 | 调用点为 0，Android 全量编译与单测通过 |
| 手写字符串 URL 拼接 | 逐端点替换 | 所有资源 ID 走类型化 path segment，特殊字符矩阵通过 |
| 旧 `/conversation-latency` 与旧指标路径 | 作为隐藏兼容别名保留后条件删除 | 生产 OpenAPI、当前 Android、Desktop 均只使用新路径，Legacy 使用为 0，回滚包可恢复 |
| legacy conversation/session-event 主路径 | 条件删除 | OAEP≥99.9%、migration=100%、fallback≤0.1%，历史 transcript hash 和回滚验证通过 |
| 截图哈希、固定坐标和单次 Accessibility 采样作为业务正确性证据 | 永久禁止 | 应用内权威状态机或 API/Event 证据覆盖对应验收 |
| 分散的 V2/V3/V4/P5 直接发布入口 | 保留兼容脚本但禁止 CI/发布直接调用 | 统一 `remote-workspace accept` 覆盖全部阶段 |

### 2.5 确认需要完善的部分

- 建立“生产 OpenAPI → 共享 schema → 生成客户端 → Reference Relay”的双向 drift gate。
- 把 Android 网络层拆成 Host、Session、Execution、Security、Telemetry 五个窄接口。
- 把会话同步、Run 控制、Approval、草稿和 UI 投影从单一 ViewModel 拆为独立状态机。
- 提供统一连接向导、统一状态解释和唯一恢复动作。
- 把 Push readiness、前台补拉、后台策略和深链恢复组成一个完整用户旅程。
- 完成两台物理设备、Windows、真实 HAI 多 worker Relay 的最终证据闭环。

## 3. P6 目标架构

```text
Android / Windows UI
        │
        ▼
User Journey State（连接、目录、会话、恢复、唯一 CTA）
        │
        ▼
Domain Services
├─ Host & Pairing
├─ Session Sync
├─ Run & Approval Control
├─ Notification & Recovery
└─ Security & Cleanup
        │
        ▼
Generated Relay Client + Safe Path Builder
        │
        ▼
HAI Runtime Relay（身份、路由、重放、推送、指标）
        │  OAEP + OWOP
        ▼
OpenDrSai Runtime（Session/Run/Event/Agent/Tool 权威）
```

核心原则：UI 不拼 URL、不解释内部异常、不拥有共享连接；Repository 不决定用户文案；Relay 不执行 Agent；Runtime 不保存移动设备 OIDC 凭据；所有缓存均可从 Runtime 权威状态重建。

## 4. 模块与功能点

### P6-M01 生产合同与传输收敛（5项）

| 功能 | 实现/更新模块 | 解决方案 | 自动测试与验收 |
|---|---|---|---|
| P6-M01-F01 生产 OpenAPI drift gate | `runtime-relay.schema.json`、生成器、public smoke | 冻结 OAEP、Latency、Association、Run/Approval 关键路径和 DTO；公开环境只读比对 | 本地任一单文件漂移失败；ai-dev OpenAPI、schema hash、匿名 401 全通过。**第1轮已完成** |
| P6-M01-F02 类型化安全路径 | Android Relay client、Python Gateway/Relay client | 所有 runtime/workspace/session/run/event/file ID 使用 segment builder，不允许手写插值路径 | `/ % ? # 空格 Unicode` 矩阵；请求只命中一个预期 endpoint，设备 proof 签名路径一致。**第2轮已完成** |
| P6-M01-F03 生成式请求/响应 DTO | Kotlin/Python codegen | 为关键写操作和恢复响应生成严格 DTO，逐步移除主路径手写 JSONObject/dict | 未知字段、缺字段、类型漂移 fail closed；四端 codegen `--check` 零 diff。**第92轮已完成** |
| P6-M01-F04 统一错误与动作合同 | Relay error schema、Android/Desktop mapper | Error code 映射为 retry/login/re-pair/update/contact-admin 五类唯一动作 | 全错误码穷举；无原始 URL、路径、token、异常正文；每状态只有一个主 CTA。**第92轮第二阶段已完成** |
| P6-M01-F05 Legacy 合同清单 | compatibility、usage telemetry、rollback | 自动生成仍在使用的 Legacy route/DTO/table/subscription 清单 | 漏项或 OAEP core 反向依赖失败；删除前后 transcript 与回滚包一致。**第92轮第三阶段已完成** |

### P6-M02 Android 客户端结构与状态一致性（5项）

| 功能 | 实现/更新模块 | 解决方案 | 自动测试与验收 |
|---|---|---|---|
| P6-M02-F01 拆分 Relay Repository | Android data | 拆为 Auth、Association、Catalog、Session、Run、Approval、File、Push 八个显式边界，复用单 DB/HTTP/Auth/Proof 核心 | 架构门禁限制职责和依赖方向；现有 Repository 行为回归全部通过。**第93轮已完成** |
| P6-M02-F02 拆分 Session ViewModel | Android UI/domain | SessionSync、Projection、RunControl、Approval、Draft 分别为可测试状态机 | property test 覆盖交错 Event、重连、进程重建；ViewModel 不直接发 HTTP。**第93轮第二阶段已完成** |
| P6-M02-F03 单一权威 UI State | Android state | 从 Room + connectivity + auth + lifecycle 派生，不保留互相矛盾布尔量 | 10k 随机状态转换无非法组合；旧 generation 结果不能覆盖新状态。**第94轮已完成** |
| P6-M02-F04 有界资源所有权 | Application container | DB、HTTP、SSE、token refresh、proof、latency tracker 均有单一 owner 和容量 | 页面切换/账号切换/换网各100次后线程、连接、队列和记录回基线 |
| P6-M02-F05 可测试时钟与调度 | Android domain | wall clock、monotonic clock、重试和16ms帧调度全部注入 | 无真实 sleep 的确定性测试；时钟回拨、进程重建和跨日场景通过 |

### P6-M03 连接、主机和授权用户旅程（5项）

| 功能 | 实现/更新模块 | 解决方案 | 自动测试与验收 |
|---|---|---|---|
| P6-M03-F01 三步连接向导 | Desktop pairing、Android scan | “电脑允许连接→选择范围→扫码并完成”，范围先绑定一次性 Grant，隐藏内部协议术语 | 未注册、过期码、错误账号、成功四条真机旅程；每屏唯一主操作 |
| P6-M03-F02 二维码生命周期 | Desktop/Relay/Android | 展示剩余时间、已消费、已撤销；过期后原位刷新且旧码失效 | 并发消费仅一次；截图/日志不含 code；过期恢复不重新启停 Runtime |
| P6-M03-F03 主机状态解释 | Android Host UI | 在线、离线、暂停、撤权、不兼容、通知不可用分别说明原因和动作 | Compose 语义/截图矩阵；不展示 generation、WSS、issuer 等内部字段。**第99轮已完成** |
| P6-M03-F04 设备与范围管理 | Desktop + Relay | 显示设备别名、最近在线、Workspace 范围和权限；支持缩减、撤销、暂停 | A/B 设备与 W1/W2 IDOR 矩阵；缩减立即断流，扩大必须重新授权。**第100轮已完成** |
| P6-M03-F05 一键诊断与修复 | Desktop/Android diagnostics | Runtime、Relay、OIDC、proof、协议、Push 分段检查并给唯一建议 | 七类故障 fixture；诊断包 secret/path/body 扫描零命中。**第101轮已完成** |

### P6-M04 会话实时体验与执行控制（5项）

| 功能 | 实现/更新模块 | 解决方案 | 自动测试与验收 |
|---|---|---|---|
| P6-M04-F01 Session Catalog 实时一致 | Runtime journal、Relay workspace stream、Android/Desktop | rename/archive/unarchive/rollback 全部由目录 Event 驱动 | 双端四阶段、≥4 Event、零手动刷新、最终回滚一致。**第102轮 local_pass / physical_pending** |
| P6-M04-F02 Conversation 实时一致 | OAEP Snapshot/Event、Room projection | Snapshot→cursor→SSE；双方新轮次、Tool、Approval、模型输出统一投影 | Windows/Android 双向输入；sequence 无重无漏；三端 transcript hash 一致 |
| P6-M04-F03 消息交付与不确定恢复 | Android/Desktop execution | optimistic→sending→accepted→running→terminal；响应丢失只查幂等结果 | 请求前/后断网、504、Runtime 重启；用户 Item 一份、副作用一次。**第105轮 local_pass / physical_pending** |
| P6-M04-F04 Approval 与 Run 竞态 | Run/Approval state machine | 双端 cancel/retry/approve/deny 统一账本与权威终态 | 64路并发 + 两端真机；唯一终态，失败端1秒内收敛且无重复 Tool。**第106轮 local_pass / physical_pending** |
| P6-M04-F05 长会话导航与搜索 | Android/Desktop timeline | checkpoint 窗口、虚拟列表、未读分界、过滤、分层搜索 | 100k Item 冷启动、10k delta/s、离线搜索、阅读位置不被新增消息打断。**第107轮 local_pass / physical_pending** |

### P6-M05 后台通知、网络与恢复（5项）

| 功能 | 实现/更新模块 | 解决方案 | 自动测试与验收 |
|---|---|---|---|
| P6-M05-F01 Push readiness 与诚实降级 | HAI adapter、Android | provider 未配置时明确“打开 App 后同步”，前台自动补拉 | readiness false/true 矩阵；未配置不丢业务事实、不伪装通知成功。**第108轮已完成** |
| P6-M05-F02 安全通知与深链 | Relay outbox、FCM、Android nav | 推送仅 opaque identity；正文前台授权拉取；恢复到正确 Item | App 被杀、锁屏、冷启动、登录有效/过期五场景；payload secret scan 0。**第109轮 local_pass / physical_pending** |
| P6-M05-F03 前后台电量策略 | Android lifecycle | 前台 SSE、后台 Push；无 Push 时低频受限补拉，不保持忙循环 | battery/network 仿真；后台线程/唤醒/连接有上限，回前台无事件缺口 |
| P6-M05-F04 弱网与换网恢复 | SSE/HTTP/Room | 有界指数退避、cursor replay、409 snapshot 恢复、单 flight | Wi-Fi↔蜂窝、离线、429、5xx、EOF；无闪空、无重复、无无限重试 |
| P6-M05-F05 一小时联合稳定性 | Android×2、Windows、Relay | kill/background/network/Runtime/Relay restart 组合故障 | 连续1小时零 sequence gap、零重复副作用、最终 transcript hash 一致 |

### P6-M06 身份、安全与数据治理（5项）

| 功能 | 实现/更新模块 | 解决方案 | 自动测试与验收 |
|---|---|---|---|
| P6-M06-F01 设备 proof 生命周期 | Android Keystore、Relay association | 原子换钥、nonce 防重放、旧钥立即拒绝、设备身份稳定 | 两台物理设备复制 Room/Preferences 不可用；失败换钥保留旧钥 |
| P6-M06-F02 最小权限与即时收敛 | Relay scopes、Desktop UI | read/send/approve/files 与 Workspace allowlist 独立缩减 | 每 scope 独立剥离；拒绝发生在 body、账本、Runtime 调用之前 |
| P6-M06-F03 本地敏感数据边界 | Room、Keystore、DPAPI | token/密钥仅安全存储；账本只留 opaque ID/hash；backup 明确排除 | APK/Room/backup/DB/DPAPI 正反 canary；恢复与卸载语义准确 |
| P6-M06-F04 全边界 secret scan | Android/Windows/Relay collectors | 流式多模式扫描，端侧只输出摘要，不导出原始产物 | 11类非空来源；明文、URL/Base64/Base64URL/hex 零命中；缺源拒绝 |
| P6-M06-F05 退出、撤权与审计 | Android/Desktop/Relay | 仅断开或同时清缓存；审计显示谁/何时/工作区/动作，不含正文 | A/B 账号和设备隔离；既有流立即断，另一主体不受影响 |

### P6-M07 可观测性、性能与容量（5项）

| 功能 | 实现/更新模块 | 解决方案 | 自动测试与验收 |
|---|---|---|---|
| P6-M07-F01 生产延迟合同 | Android、Relay schema、Reference Relay、public smoke | Event 级 receive/render 时间与 `/metrics/relay-latency` 对齐生产 OpenAPI | DTO/path drift、特殊字符路径、匿名401、公开 OpenAPI 通过。**第1轮已完成** |
| P6-M07-F02 多 worker 延迟汇聚 | HAI Relay、共享存储 | 所有 worker 写同一持久库；报告区分 ready/incomplete | 两 worker 20 correlation 五阶段完整；真实 Android 产生非空 P50/P95 |
| P6-M07-F03 用户可用 SLO | metrics/diagnostics | 首屏、Event→render、操作确认、重连分别设门槛和瓶颈定位 | 只输出聚合耗时；无用户/正文维度；超阈值能定位阶段 |
| P6-M07-F04 大规模性能 | Runtime/Relay/Room/UI | keyset cursor、checkpoint、帧合并、有界回放 | 100 Workspace、10k Session、100k Item、10k delta/s；P95/RSS 达标 |
| P6-M07-F05 容量与背压 | Journal、Redis、Room、notification outbox | 每层容量、TTL、overflow/gap 和恢复策略显式化 | 超限不丢终态/Approval；cursor expired 可恢复；无忙循环和无界队列 |

### P6-M08 迁移、发布与最终体验（5项）

| 功能 | 实现/更新模块 | 解决方案 | 自动测试与验收 |
|---|---|---|---|
| P6-M08-F01 P5 遗留项转正 | P5 ledger、P6 ledger | P5 未完成证据逐项映射，不重置完成定义 | Session Catalog、M04、Push、稳定性、两设备、Legacy 阈值全部有新证据 |
| P6-M08-F02 无障碍与本地化 | Android/Desktop UI | TalkBack、键盘、焦点、动态字号、中文/英文状态文案 | Accessibility Scanner、Compose semantics、键盘旅程、200%字号截图 |
| P6-M08-F03 Legacy 条件删除 | compatibility、Room migration、routes | 只在指标达门槛时删除；固定回滚包可恢复 | OAEP≥99.9%、migration=100%、fallback≤0.1%；删前后 transcript hash 一致 |
| P6-M08-F04 唯一 P6 evidence/finalizer | CLI、schema、assembler | 40项 ledger 绑定构建、环境、两设备、Windows、Relay 和证据哈希 | 缺项、旧包、Debug、模拟器、混环境、重复设备、伪造摘要全部拒绝 |
| P6-M08-F05 人工产品验收 | 发布 APK/Desktop/生产 Relay | 从连接、目录、会话、发送、审批、恢复、撤权完整体验 | 两台真机+Windows；无 P0/P1、40/40、P5 遗留全闭合后才发布 |

## 5. 统计与验收规则

每个功能使用 `not_started / code_complete / local_pass / physical_pass / release_pass` 五态。P6 百分比只统计达到该行明确最终门槛的功能：纯合同/架构功能可在 `local_pass + public smoke` 后计入；涉及用户旅程、设备、安全边界或性能的功能必须有对应物理或生产证据。

每轮必须记录：轮次、完成数/40、百分比、新增完成项、代码变更、测试数量、物理/公开环境证据及 SHA-256。任何失败报告必须保留失败状态，不能用后续文字覆盖。

## 6. 实施顺序

1. 先完成 M01 与 M02，消除合同漂移和 Android 单体职责；否则后续 UX 修改会继续建立在不稳定底座上。
2. 并行完成 M03、M04，把连接和会话两条核心旅程做到无需内部知识即可恢复。
3. 完成 M05、M06，闭合后台、换网、设备和数据安全。
4. 完成 M07 的生产汇聚与规模门禁。
5. 最后执行 M08；P5 遗留项未转正时，P6 不得宣称发布完成。

## 7. 第108轮后的下一步

- 执行 P6-M05-F03：前台只维持必要 SSE，后台有 Push 时释放实时连接；Push 不可用时只允许系统调度的低频、有界补拉，不保持忙循环，回前台以 Snapshot/cursor 补齐事实。
- M04-F05、M04-F04、M04-F03、M04-F02、M04-F01 与 M03-F01 的三星物理门禁继续待补；三星重新进入 ADB 后优先补齐，不使用模拟器冒充。
- 协调 HAI Relay 的认证指标读取，完成 P6-M07-F02 的真实五阶段样本；公开 OpenAPI 成功不能代替认证数据验收。
- 三星恢复 ADB 授权后，优先补 P6-M04-F01、F03、F04 的物理门禁，而不是继续依赖本地 fixture。
