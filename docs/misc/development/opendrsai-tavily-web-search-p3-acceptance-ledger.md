# OpenDrSai Tavily Web Search P3 验收台账

更新日期：2026-08-14  
权威方案：`opendrsai-tavily-web-search-p3-hai-managed-worker-plan.md`

状态含义：`PASS` 表示已有与验收范围匹配的证据；`CANDIDATE` 表示实现和局部测试完成，但缺真实环境或完整端到端证据；`PENDING` 表示尚未满足。

| 功能 | 状态 | 当前证据 | 剩余条件 |
|---|---|---|---|
| F01 Worker 注册与 heartbeat | PASS | ai-dev Worker `wk-tavily-p3-hepai-4c7c2340` 在线；Worker/DDF TTL 测试 | 无 |
| F02 HAI 登录鉴权 | PASS | DDF 未认证 401 `login_required`；subject 不从请求体读取 | 无 |
| F03 entitlement | PASS | 缺失策略 fail closed；ai-dev 唯一验收主体允许态与未授权主体拒绝态均已验证 | 正式环境改用平台 entitlement 数据源 |
| F04 Search IF 契约 | PASS | Worker Tavily v1 fixture 与 Client 合同测试 | 无 |
| F05 Extract IF 契约 | PASS | Worker 单 URL/参数测试与 Client 映射测试 | 无 |
| F06 Worker Key 注入 | PASS | Key 仅存 Worker 主机 `0600` secret 文件；Worker JSON 仅存引用；PM2 dump、DDF、Client 均无 Key | 无 |
| F07 参数白名单 | PASS | Worker fuzz；DDF 递归拒绝 provider/route/secret 字段 | 无 |
| F08 Worker 响应映射 | PASS | Worker Search/Extract 黄金响应测试 | 无 |
| F09 Worker 错误映射 | PASS | Worker 8 类错误矩阵，28 tests | 无 |
| F10 DDF IF 路由 | PASS | 精确 model/function、心跳和 ACL 测试；ai-dev 已部署 | 无 |
| F11 DDF 幂等 | PASS | 主体+函数+key+body 指纹测试；key 不下发 Worker | 无 |
| F12 取消传播 | CANDIDATE | DDF 按主体隔离取消的自动化测试 | 真实在途请求取消与无迟到计费演练 |
| F13 用户级限流 | PASS | 配置驱动边界和跨用户隔离测试；检查发生在 Worker 前 | 正式数值由平台配置 |
| F14 用户/组织额度 | PASS | 配置缺失 fail closed、credits 边界及 Worker invoke=0 测试 | 正式数值由平台配置 |
| F15 managed 感知器发现 | PASS | Core 目录 DTO 测试；Desktop 可视化验收 | 无 |
| F16 Provider 路由 | PASS | `auto/managed/byok/none` 矩阵；无静默 fallback | 无 |
| F17 P2 登录引导 | PASS | 33 项 P2 合同 | 无 |
| F18 登录后恢复原 Run | PASS | Desktop 登录并继续合同；同一 Run 恢复路径 | 真实 OIDC E2E 随 F30 复核 |
| F19 BYOK 保留 | PASS | BYOK 配置/路由回归；托管策略不迁移已有显式选择 | 无 |
| F20 拒绝联网 | PASS | `answer_without_network` 与三 Provider 零调用合同 | 无 |
| F21 Search 公共契约 | PASS | Core provider-neutral response 测试 | 无 |
| F22 Fetch 公共契约 | PASS | Extract→文档映射、hash、截断测试 | 无 |
| F23 URL/SSRF | PASS | Core 与 Worker 私网/本机/凭据 URL 测试 | 无 |
| F24 来源 UI | PASS | 单一简要来源合同与 Renderer 回归 | 无 |
| F25 Inspector | PASS | 真实 Search/Extract 与 20 轮稳定性已核对 request/trace/invoke/credits；20/20 Trace ID 贯通 | Worker 独立日志仍以 request ID 关联 |
| F26 日志脱敏 | PASS | 最终 DDF/Worker 日志及审计仅存 content-free summary；相关测试 33/33 | 修复前验收 JSONL 曾含 query，历史审计未删除或篡改 |
| F27 健康与熔断 | CANDIDATE | Worker/DDF 健康、错误与有界重试测试 | 真实 Tavily 故障/恢复演练 |
| F28 多用户隔离 | PASS | DDF entitlement/quota/idempotency/cancel 主体隔离测试 | 无 |
| F29 多端契约 | CANDIDATE | 公共 JSON fixture；Desktop/TUI/Android 13 错误码一致性验证 | Android 全工程受既有 `RemoteMarkdown.kt` 编译错误阻断 |
| F30 ai-dev 真实 E2E | CANDIDATE | 真实 DDF→Worker→Tavily Search（3 结果）与 Extract（1 URL）成功；各 1 invoke/1 credit | 生产 Desktop 真实 HAI OIDC 登录、恢复原 Run 与来源 UI 终态 |
| F31 20 轮稳定性 | PASS | 20/20 terminal；20 唯一 request/trace/invoke；20×1 credit；幂等复核零新增 | 无 |
| F32 Key 轮换 | PENDING | Worker 支持环境注入和 PM2 重载 | 双 Key、旧 Key 撤销与回滚演练 |

## 当前自动化证据

- Python Web Search/Core 回归：`77 passed`，包含 Client 取消不映射错误、无迟到结果的测试；
- Desktop P2 合同：`33 contracts`；
- Desktop P3 managed 合同：`28 contracts`；
- Desktop P3 错误 UX：`12 states`；
- Desktop/TUI/Android 公共合同：`13 errors`；
- 真实验收脚本已通过 fake DDF 的 capability→Search→Extract→稳定性→脱敏全链测试；
- Worker：`29 passed`；
- DDF trace、Web Search 审计与脱敏：`33/33 passed`；
- ai-dev 真实 Search/Extract：各一次成功、各一次 Worker invoke、各一次 1-credit reservation；
- ai-dev 20 轮低成本 Search：`20/20` 成功，无重复调用或重复 reservation；
- Windows Electron production build：main/preload/renderer 全部通过；
- Renderer 全量可视化验收通过，包含 `tavily-p3-managed-perceptor-settings.png`；
- Desktop secret redaction 与 Run Inspection safety 通过，secret/path leak 均为 0。

## 阻塞输入

1. 在生产 Desktop 中由用户完成真实 HAI OIDC 登录，复核原 Run 恢复、来源 UI 与 Inspector 终态；
2. 为 F32 提供第二个有效 Tavily Key，完成双 Key、旧 Key 撤销与回滚演练；
3. 正式上线前把当前进程内验收额度迁移到共享持久化额度后端，并冻结生产 entitlement/额度来源；
4. 完成 F30、F32 后，由产品、平台、Worker、安全和运维负责人签字。
