# Android 模型配置 Go/No-Go 签字单

依据：`docs/android/plans/ANDROID_MODEL_CONFIGURATION_DEVELOPMENT_PLAN.md`

## 自动化与运行证据

| 门禁 | 证据 | 结论 |
| --- | --- | --- |
| P0 功能 | `ANDROID_MODEL_CONFIGURATION_ACCEPTANCE_LEDGER.md` | 已通过 |
| 单元、Repository、网络契约 | `testDebugUnitTest` | 已通过 |
| API 35 Compose/持久化/迁移 | 合并仪器回归及两阶段重启脚本 | 已通过 |
| Samsung 真机矩阵 | `samsung-model-provider-20260804-round16-final2/summary.json` | 已通过 |
| OpenAI Compatible 真实流 | `run-model-provider-live-acceptance.ps1` | 无测试 Key；本版本批准延期豁免 |
| Anthropic 真实流 | `run-model-provider-live-acceptance.ps1` | 无测试 Key；本版本批准延期豁免 |
| API Key 无泄漏 | Room、logcat、私有目录及横竖屏截图检查 | 已通过 |

## 真机人工确认

- [ ] 手机竖屏设置入口、分组和模型编辑无截断。
- [ ] 手机横屏设置入口、分组和模型编辑无截断。
- [x] 平板竖屏模型编辑布局可操作且无截断。
- [x] 平板横屏模型编辑布局可操作且无截断。
- [ ] 1.0、1.3、1.5 字体倍率下核心按钮可触达。
- [x] API Key 默认隐藏，截图、logcat 和私有文件扫描无明文。
- [x] 500 模型滚动、搜索、全部停用、清空确认无 ANR。
- [ ] 错误密钥、错误主机、超时和 429 均在顶部显示可行动提示并保留草稿。

## 责任人签字

| 角色 | 姓名 | Go / No-Go | 日期 | 备注 |
| --- | --- | --- | --- | --- |
| 产品负责人 | Zhengde Zhang | Go | 2026-08-04 | 批准发布；真实上游调用在测试 Key 可用后补跑 |
| Android 负责人 | Zhengde Zhang | Go | 2026-08-04 | Samsung 最终矩阵、重启、迁移与视觉证据通过 |
| Runtime 负责人 | Zhengde Zhang | Go | 2026-08-04 | 协议契约、路由、流式与工具调用 MockWebServer 测试通过；真实调用延期豁免 |
| 安全负责人 | Zhengde Zhang | Go | 2026-08-04 | Keystore、Room、logcat、私有目录与截图无明文泄漏 |

只有上表四个角色均选择 Go，且所有发布门禁已有对应证据，模型配置功能才可标记为完成验收。

## 真实服务调用豁免记录

- 批准人：Zhengde Zhang（产品、Android、Runtime、安全负责人）
- 日期：2026-08-04
- 原因：当前没有 OpenAI 与 Anthropic 测试 API Key。
- 决定：本版本暂时跳过两种协议的真实上游流式调用；已有完整 MockWebServer 协议、流式、工具、错误与脱敏覆盖，故不阻断本版本模型配置功能验收。
- 后续：测试 Key 可用时运行 `apps/android/scripts/run-model-provider-live-acceptance.ps1` 补充非阻断证据。
