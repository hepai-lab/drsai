5. 完整的消息流程图

[用户调用 team.run_stream()]
    ↓
[创建 _output_message_queue]
    ↓
[runtime.send_message(GroupChatStart, recipient=groupchat_manager)]
    ↓
    ├─→ [放入 _message_queue]
    ↓
[Runtime消息循环: _process_next()]
    ↓
    ├─→ [从 _message_queue 取出 SendMessageEnvelope]
    ↓
[_process_send(envelope)]
    ↓
    ├─→ [获取 groupchat_manager 实例]
    ├─→ [调用 manager.handle_start(GroupChatStart)]
    ↓
[GroupChatManager.handle_start()]
    ↓
    ├─→ [① 直接输出初始消息] → _output_message_queue.put(msg)
    ├─→ [② 发布消息到 group_topic]
    ├─→ [③ 选择发言者]
    ├─→ [④ 发布 GroupChatRequestPublish 到 speaker_topic]
    ↓
[ChatAgentContainer 订阅 speaker_topic]
    ↓
[ChatAgentContainer.handle_request()]
    ↓
    ├─→ [调用 agent.on_messages_stream()]
    ├─→ [遍历 agent 产生的消息]
    │      ├─→ [_log_message(msg)]
    │      │      ├─→ [publish_message(GroupChatMessage, output_topic)]
    │      │      ↓
    │      │   [Manager 订阅 output_topic]
    │      │      ├─→ [handle_group_chat_message()]
    │      │      ├─→ [_output_message_queue.put(message)] ✅ 输出
    │      │      ↓
    ├─→ [发布 GroupChatAgentResponse 到 parent_topic]
    ↓
[Manager.handle_agent_response()]
    ↓
    ├─→ [检查终止条件]
    ├─→ [选择下一个发言者]
    ├─→ [发布 GroupChatRequestPublish 到下一个 speaker]
    ↓
[循环往复，直到终止条件满足]
    ↓
[Manager._signal_termination()]
    ↓
    ├─→ [_output_message_queue.put(GroupChatTermination)] ✅ 输出终止事件
    ↓
[run_stream() 从 _output_message_queue 读取消息并 yield]
    ↓
[用户接收到消息流]