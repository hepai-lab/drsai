# Android 模型配置验收台账

- 依据：`docs/android/plans/ANDROID_MODEL_CONFIGURATION_DEVELOPMENT_PLAN.md`
- 最后审计：2026-08-04（第 16 轮，最终验收）
- 判定规则：仅在代码、自动化测试和对应运行环境证据同时完整时标记通过。

## F01–F12 功能审计

| 编号 | 状态 | 实现证据 | 测试/验收证据 | 剩余缺口 |
| --- | --- | --- | --- | --- |
| F01 设置入口与响应式分组 | 通过 | `OpenDrSaiApp.kt` 左侧栏 `open-settings`；720dp 手机/平板断点；分组导航 | API 35 设置入口点击 1/1；响应式 4/4；Samsung 平板横竖屏生产 Compose 页面截图复核通过 | 无发布阻断缺口 |
| F02 预设与自定义提供方 | 通过 | `AndroidModelProviderPresets`；UUID 提供方 ID；自定义名称/主机/协议 | 预设、同名实例不同 UUID、空名称、非法/内嵌凭据/换行 URL 测试通过 | 无发布阻断缺口 |
| F03 API Key 安全保存 | 通过 | `EncryptedSharedPreferences` + `MasterKey`；Room 无凭据字段；留空不改；`allowBackup=false`；已保存状态持续可见 | API 35 加密及强制停止恢复；Samsung logcat/私有目录 0 命中；横竖屏截图无明文且显示安全保存状态 | 无发布阻断缺口 |
| F04 N 模型配置 | 通过 | Room 一对多；LazyColumn；提供方整行折叠 | 500 项 Repository 完整性、滚动与批量 UI 性能；Samsung 真机用例及强制停止恢复通过 | 无发布阻断缺口 |
| F05 模型发现、合并与同步 | 通过 | OpenAI/Anthropic 目录；保留手工项；新增/保留/缺失摘要；空目录响应明确报错 | 目录契约、401/403/404/429/500、超时、空响应、无效 JSON、合并测试通过 | 无发布阻断缺口 |
| F06 批量管理 | 通过 | 清空确认、全部启停、多选删除、撤销；窄屏分行工具栏 | `ModelProviderEditorUiTest` 6/6；500 项批量草稿变更 `<300ms` 门禁通过 | 无发布阻断缺口 |
| F07 逐模型能力与启用 | 通过 | 启用/视觉/工具/推理/Token 字段；来源标记；发现能力识别 | `ModelProviderPersistenceTest`、500 项完整性测试、默认回退测试 | 无发布阻断缺口 |
| F08 保存、冲突与反馈 | 通过 | 顶部保存、进度、状态区、revision、未保存确认、凭据/Room 回滚；`SingleFlightGate` | Repository 失败/冲突；16 线程仅一次事务；实例状态恢复不重复提交；API 35 强制停止后配置完整恢复 | 无发布阻断缺口 |
| F09 默认模型与历史会话 | 通过 | 稳定模型 ID；停用/删除回退；影响提示；会话记录 modelId | 旧 ID 兼容、历史会话稳定、删除影响，以及强制停止后默认稳定 ID 恢复通过 | 无发布阻断缺口 |
| F10 运行时协议路由 | 通过（真实调用延期豁免） | HepAI/OIDC、OpenAI/Bearer、Anthropic/x-api-key；稳定 ID→上游 ID；文本/图片/工具流；响应统一脱敏 | MockWebServer 分片、工具、图片、流中断、错误脱敏、活动网络请求取消全部通过；opt-in 真实调用脚本保留 | Zhengde Zhang 于 2026-08-04 批准本版本在无测试 Key 条件下跳过真实上游调用，不影响协议实现验收 |
| F11 数据迁移与回滚 | 通过 | Room 13→14；旧 JSON 宽容迁移；空模型/缺密钥可保留；损坏条目跳过；幂等；无 destructive migration | Samsung 迁移通过；API 35 schema/级联及旧配置变体测试通过 | 无发布阻断缺口 |
| F12 删除与恢复 | 通过 | HepAI 防删；影响确认；Room 级联；凭据删除/失败恢复 | Repository 删除回滚；迁移级联；删除 UI 测试通过 | 无发布阻断缺口 |

## 发布门禁

| 门禁 | 状态 | 备注 |
| --- | --- | --- |
| P0 功能全部完成 | 通过 | 连接检查、密钥显隐、未保存保护、搜索/筛选、错误映射、默认影响提示均实现 |
| 单元/Repository/网络/Compose 测试 | 通过 | `testDebugUnitTest` 通过；API 35 合并仪器回归 18/18 通过 |
| v13→14 真机升级 | 通过 | Samsung SM-X936C 无线 ADB 最终矩阵通过；迁移 1/1、强制重启 2/2 |
| OpenAI + Anthropic 真实流式调用 | 批准豁免 | 无测试 Key；Zhengde Zhang 于 2026-08-04 批准本版本暂时跳过，脚本保留供后续凭据可用时补跑 |
| API Key 无泄漏 | 通过 | 加密落盘/Room schema 通过；Samsung logcat、私有文件金丝雀 0 命中；横竖屏截图无明文 |
| 500 模型无 ANR/批量可完成 | 通过 | API 35 与 Samsung 真机滚动、搜索和 `<300ms` 批量草稿门禁通过 |
| 默认模型无悬空引用 | 通过 | 停用、删除、重命名、旧 ID 兼容及历史会话专项测试均通过 |
| Go/No-Go 签字 | 通过 | 产品、Android、Runtime、安全四角色均由 Zhengde Zhang 签署 Go |

## 当前结论

F01–F12、P0、完整单元回归、Samsung 无线真机最终矩阵、强制重启、迁移、性能、安全与视觉复核全部完成。真实 OpenAI/Anthropic 调用因没有测试 Key 获责任人明确延期豁免，四角色已签署 Go；本版本模型配置功能完成验收。
