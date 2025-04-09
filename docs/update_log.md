**2025-4-9: **
- 更新适配了autogen 0.5.1版本，支持openai系列模型的Structured Outputs，deepseek系列目前没有该功能， 具体见案例```example/oai_client/assistant_structured_output.py```。
- 将后端持久化保持对象：thread、threadmanager传递到了自定义回复函数中，具体见案例```example/oai_client/assistant_custom_reply_demo_oai.py```。
- 修复了一些bug。