# Update and Log

- [x] 2026.06.01 更新Frontend版本到1.2.50，移除消息缓存，新增聊天内联图片与消息持久化。
- [x] 2026.06.01 更新Frontend版本到1.2.49，UI组件重构与国际化支持。

- [x] 2026.05.29 更新Frontend版本到1.2.48，统一会话校验与Token自动刷新，优化SSO本地登录。

- [x] 2026.05.28 更新Frontend版本到1.2.47，优化默认智能体主推位，聊天页新增问题导航侧栏。

- [x] 2026.05.25 更新Frontend版本到1.2.46，修复dev路由404，会话模型切换持久化，顶栏配置按会话显示。

- [x] 2026.05.22 更新Frontend版本到1.2.45，修复登入后侧栏菜单卡顿与顶栏体验更多显示。

- [x] 2026.05.22 更新Frontend版本到1.2.44，输入框底部新增模型切换栏，交互更直观。

- [x] 2026.05.21 更新Frontend版本到1.2.43，统一智能体列表并优化首屏加载提示。

- [x] 2026.05.19 更新Frontend版本到1.2.42，适配移动端。

- [x] 2026.05.19 更新Frontend版本到1.2.41，新增平台管理员使用分析页。

- [x] 2026.05.18 更新Frontend版本到1.2.40，例行前端发版。

- [x] 2026.05.14 增加skill上传

- [x] 2026.04.24 更新Frontend版本到1.2.39，修复状态图标与模型选择同步。

- [x] 2026.03.31 更新Frontend版本到1.2.4，精简聊天输入区附件菜单并移除语音输入入口。

- [x] 2026.03.31 更新Frontend版本到1.2.3，优化BESIII面板终端区域圆角与内边距展示效果。

- [x] 2026.03.31 更新Frontend版本到1.2.2，新增右侧面板历史会话列表并优化顶部/内容头部按钮展示逻辑。

- [x] 2026.03.31 更新Frontend版本到1.2.0，优化 AgentCard 与 SessionManager 的布局和导航。

- [x] 2026.03.31 更新Frontend版本到1.1.0，更新了页面布局。

- [x] 2026.03.31 更新Frontend版本到1.0.1，更新了登录界面。


**2025.11.26**:

## drsai-1.0.5:

- [x] Add the `DrSaiChatCompletionContext` for intelligent long memory compression. Example: `tutorials/components/ModelContext-long_memory.md`

- [x] Add the `tool_call_summary_prompt` in DrSaiAgent, which summarize the tool call history using llm and the `tool_call_summary_prompt`.

TODO:



## drsai_ui-0.0.9:

- [x] Add the `RAGFlowAgent` for customized frontend RAG agent.  In: `python/packages/drsai_ui/src/drsai_ui/agent_factory/local_agents/ragflow_agent.py`

- [x] Add the `models` route in `python/packages/drsai_ui/src/drsai_ui/ui_backend/backend/web/routes/models.py`

- [x] Add a ddf worker cache in `python/packages/drsai_ui/src/drsai_ui/ui_backend/backend/web/routes/agent_worker.py`

TODO:

[ ] `RAGFlowAgent`增加用户的个人长期记忆document_id与chat_id+thread_id进行绑定

## drsai_ext-0.0.1:

- [x] Add the `LongTaskManager` for MCP long running task.

TODO:
