**2025-04-09: **
- 更新适配了autogen 0.5.1版本，支持openai系列模型的Structured Outputs，deepseek系列目前没有该功能， 具体见案例```example/oai_client/assistant_structured_output.py```。
- 将后端持久化保持对象：thread、threadmanager传递到了自定义回复函数中，具体见案例```example/oai_client/assistant_custom_reply_demo_oai.py```。
- 修复了一些bug。

**2025-04-14: **
- 尝试修复了thread后端历史消息加载和前端历史消息加载可能的冲突的问题。具体而言，在```drsai/dr_sai.py```的```a_start_chat_completions```函数中，会通过对接前端```dialog_id```创建或者检索后端的```thread```对象，并传递给后面的每一个智能体和groupchat，以保证前端和后端的智能体和多智能体之间的消息和设置都是一致的。```thread.messages```保存历史消息，并在每次智能体聊天中更新。由于前端每次都会传递当前聊天界面完整的消息记录，后端也会通过```threads_mgr.create_message```和自定义的逻辑保存消息记录。为了解决前端历史消息加载和后端历史消息加载可能存在的冲突的问题，新增```history_mode```参数，用于控制究竟是加载前端的历史消息还是后端的历史消息。前端的历史消息加载模式为```history_mode='frontend'```，后端的历史消息加载模式为```history_mode='backend'```。默认情况下，为后端的历史消息加载模式，即```history_mode='backend'```。这些加载的历史消息记录会被缓存到```thread.metadata["history_aoi_messages"]```中，在```drsai/modules/baseagent/drsaiagent.py```的```_call_llm```函数中被整合到上下文消息记录中。具体见案例```examples/oai_client/roundgroup_oai_thread.py```。

- ```thread.messages```的历史消息存储由```drsai/modules/baseagent/drsaiagent.py```的```_call_llm```函数转移到了```drsai/modules/baseagent/drsaiagent.py```的```a_start_chat_completions```函数中，通过捕捉```TextMessage```和```ToolCallSummaryMessage```事件来更新```thread.messages```。drsai智能体的内部的非思考文本输出和工具调用的输出会被捕捉并存储。用户还通过自定义事件和捕获来进行自定义储存修改。

- 自定义消息事件类型，使用多智能体系统时需要在```DrSaiGroupChat```中传入注册。具体见https://microsoft.github.io/autogen/stable/user-guide/agentchat-user-guide/tutorial/messages.html。这意味着我们可以定义自己的消息类型，用户捕获特殊的事件进行操作。