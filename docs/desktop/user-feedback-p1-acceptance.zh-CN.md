# OpenDrSai Desktop 用户反馈 P1 验收记录

> 验收日期：2026-08-14  
> 对应方案：`user-feedback-product-plan.zh-CN.md`

## 功能验收

| 能力 | 结果 | 证据 |
| --- | --- | --- |
| 全局反馈入口与快捷键 | 通过 | 用户菜单及 `Ctrl/Cmd+Shift+F` |
| 错误现场一键报告 | 通过 | 失败消息携带错误码、类型、运行 ID |
| 崩溃恢复反馈 | 通过 | Electron Crashpad 本地采集、启动恢复提示、转储关联 |
| 四种反馈类型 | 通过 | 报错、不好用、建议、需求 |
| 默认安全诊断摘要 | 通过 | 双端脱敏、最近 20 个裁剪事件、环境与关联 ID |
| 详细诊断授权 | 通过 | 默认关闭；用户单独勾选后才包含完整脱敏历史 |
| 截图与涂抹 | 通过 | 当前窗口捕获、用户拖拽遮挡、客户端重新渲染后发送 |
| 上传前预览 | 通过 | 数据类别、附件、大小、脱敏数量和保留期 |
| 离线与幂等 | 通过 | AES-256-GCM 本地队列、自动重试、幂等键 |
| Web 接收服务 | 通过 | FastAPI 接口、本机模式及带令牌的远程部署模式 |
| Dr. Zhengde 分诊 | 通过 | 脱敏事实投影、结构化输出校验、失败重试与人工确认 |
| 邮件通知 | 通过 | 仅内部元数据通知；不含正文、诊断或联系方式 |
| 人工联系用户 | 通过 | 用户授权、联系方式单独加密、显式查看及审计 |
| 聚类、分派与修复版本 | 通过 | 错误指纹、重复关联、负责人确认、状态机和版本字段 |
| 管理台 | 通过 | 列表、筛选、详情、状态流转、负责人确认和删除 |
| 保留与删除 | 通过 | 30 天默认保留、定时清理、附件联动删除、审计保留 |
| 企业策略 | 通过 | 可禁止反馈、截图或诊断；远程接收默认关闭 |
| 生命周期指标 | 通过 | 曝光、打开、成功、失败、排队和重试事件 |

## 自动化结果

- 后端服务与 Agent：19 项测试通过；
- Python 模块编译：通过；
- Desktop P1 契约验证：通过；
- Windows 主进程与 Web TypeScript 定向检查：通过；
- Windows Electron 生产构建：通过；
- macOS Electron 生产构建：通过；
- `git diff --check`：通过。

全仓严格 TypeScript 检查当前受反馈范围外的双工语音 mock 缺少 `sendDuplexVoicePlaybackAck` 阻塞。该问题不进入本功能改动，反馈代码的定向类型检查与两端实际构建均已通过。

## 上线后指标

提交完成率、完成耗时、可定位率和再次询问信息比例属于真实流量指标，不能由开发环境伪造。P1 已完成相应事件和字段采集；上线后应按产品方案第 13 节，以至少一个完整观察周期的数据决定指标是否达到目标。

## 部署配置

- `OPENDRSAI_FEEDBACK_SERVICE_URL`：独立反馈服务地址；未设置时使用本机 Gateway；
- `OPENDRSAI_FEEDBACK_INTAKE_TOKEN`：Desktop 与远程接收服务共享的接收令牌；
- `OPENDRSAI_FEEDBACK_ALLOW_REMOTE=1`：服务端显式启用远程接收；
- `OPENDRSAI_FEEDBACK_ADMIN_TOKEN`：操作员接口令牌；
- `OPENDRSAI_FEEDBACK_AGENT_BASE_URL/API_KEY/MODEL`：Dr. Zhengde 模型配置；
- SMTP 相关变量：内部邮件通知配置；
- `OPENDRSAI_FEEDBACK_DISABLED`、`OPENDRSAI_FEEDBACK_ALLOW_SCREENSHOT`、`OPENDRSAI_FEEDBACK_ALLOW_DIAGNOSTICS`：企业策略。
