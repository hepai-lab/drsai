# OpenDrSai Runtime 测试资料

文档版本：1

OpenDrSai Runtime 使用 Session 表示一段持续的用户会话。

每次具体的智能体执行使用 Run 表示。一个 Session 可以包含多个 Run。

OAEP 是 OpenDrSai 的统一智能体事件协议，用于描述消息、工具调用、审批、引用和产物等结构化运行事件。

Run Manifest 记录重现一次运行所需的关键配置和资源摘要，包括智能体定义、模型、工具、技能、知识库及输入附件信息。

原始 Run 证据是不可变的。重放或实验必须创建新的 Run，不能覆盖原始 Run。
