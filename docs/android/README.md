# OpenDrSai Android 文档

本目录是 OpenDrSai Android 的统一文档入口。原有的另一 Android 文档目录已经合并到这里，并按用途归类；新增文档也应放入对应子目录，避免再次散落在根目录。

## 目录结构

| 目录 | 内容 |
| --- | --- |
| [`overview/`](overview/) | 产品定位、范围和总体说明 |
| [`architecture/`](architecture/) | 技术架构、本机 Runtime、远程智能体集成 |
| [`design/`](design/) | 主界面与远程工作区交互设计 |
| [`plans/`](plans/) | 总体计划、自动更新、附件、远程工作区和 Runtime 专项计划 |
| [`reports/`](reports/) | 实施报告与阶段进度 |
| [`testing/`](testing/) | 测试报告、验收报告及机器生成的验收证据 |
| [`releases/`](releases/) | Release Notes 与 Beta 真机检查清单 |
| [`manual/`](manual/) | OpenDrSai 用户与开发手册 |

## 推荐阅读顺序

1. [Android 产品概览](overview/ANDROID_PRODUCT_OVERVIEW.md)
2. [Android 技术架构报告](architecture/ANDROID_TECHNICAL_ARCHITECTURE_REPORT.md)
   - [Android Agent Runtime → OAEP 映射基线](architecture/ANDROID_AGENT_RUNTIME_OAEP_MAPPING.md)
3. [Android 完整开发计划](plans/master/ANDROID_COMPLETE_DEVELOPMENT_PLAN.md)
4. [主界面设计](design/MAIN_INTERFACE_DESIGN.md)
5. [远程工作区开发方案](plans/remote-workspace/ANDROID_REMOTE_WORKSPACE_DEVELOPMENT_PLAN_V1.md)
6. [v1.5.6：移除 Kotlin Lite、默认绑定 Full Runtime 开发测试方案](plans/runtime/ANDROID_V1_5_6_FULL_RUNTIME_DEFAULT_DEVELOPMENT_TEST_PLAN.md)
7. [第 8 阶段：Android Agent Runtime 完全 OAEP 化开发计划](plans/runtime/ANDROID_STAGE8_AGENT_RUNTIME_OAEP_DEVELOPMENT_PLAN.md)
8. [第 9 阶段：Desktop Full Agent Runtime 能力对等开发与测试方案](plans/runtime/ANDROID_P9_DESKTOP_FULL_AGENT_RUNTIME_PARITY_DEVELOPMENT_PLAN.md)
9. [测试与验收报告](testing/reports/)
10. [第 8 阶段实施进度](reports/progress/ANDROID_STAGE8_AGENT_RUNTIME_OAEP_PROGRESS.md)
11. [第 9 阶段实施进度](reports/progress/ANDROID_P9_DESKTOP_FULL_AGENT_RUNTIME_PARITY_PROGRESS.md)

## 维护约定

- 产品说明放入 `overview/`，技术边界和组件关系放入 `architecture/`。
- 尚未实施或用于指导开发的内容放入 `plans/`；已经执行的结果放入 `reports/`。
- 测试方案、验收结论和自动化证据统一放入 `testing/`。
- 版本发布说明与设备检查清单放入 `releases/`。
- 文档之间优先使用相对链接；移动文档后必须运行链接检查。
