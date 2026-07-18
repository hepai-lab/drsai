---
tags: OpenDrSai, 智能体文档
---

# OpenDrSai-智能体和Dr.Sai UI前端的消息/文件交互

## 1.Dr.Sai UI前端发送的消息和文件数据类型

Dr.Sai UI继承了AutoGen人在环路的思想，在用户使用UI与远程部署的智能体服务沟通时，分为两个阶段:

### 1.1.初始聊天

- 初始会话或者中断后重连：此时前端以`"user"`的为角色向后端发送包含`TextMessage`或者多模态消息`MultiModalMessage`的消息列表。`drsai`后端会将前端传入的消息列表传入启动的智能体/多智能体系统实例的`run_stream`函数中发起聊天。具体的消息类型见：[OpenDrSai-事件与消息](https://note.ihep.ac.cn/s/0SL4vDMI5)。具体消息的格式为：

```python

# 1.前端只输入文本时，后端接受的消息列表：

[
    TextMessage(source="user", content="user's input", metadata={"attached_files": '[]','user_request': '{"content": "user's input", "accepted": false, "plan": null}',})
]

# 2.前端输入文本，并上传可解析为文本的文件列表时，后端接受的消息列表：

[
    TextMessage(source="user", content="\n\n".join(f"Attached file: {file.get('name', 'unknown.file')}\n{text_content}"), metadata={"internal": "yes"}),
    TextMessage(source="user", content="user's input", metadata={"attached_files": '[{"name": ***", "type": "application/***", "size": 17**, "url": "***", "base64":"***"}]','user_request': '{"content": "user's input", "accepted": false, "plan": null}',})
]

# 3.前端输入文本，并上传不可解析为文本的文件，且不是图像的文件列表时，后端接受的消息列表：

[
    TextMessage(source="user", content="\n\n".join(f"Attached file: {file.get('name', 'unknown.file')} (failed to process content)"), metadata={"internal": "yes"}),
    TextMessage(source="user", content="user's input", metadata={"attached_files": '[{"name": ***", "type": "application/***", "size": 17**, "url": "***", "base64":"***"}]','user_request': '{"content": "user's input", "accepted": false, "plan": null}',})
]

# 4.前端输入文本，且上传了包含了图像的文件列表时，后端接受的消息列表：

[
    TextMessage(source="user", content="\n\n".join(f"Attached file: {file.get('name', 'unknown.file')}\n{text_content}"), metadata={"internal": "yes"}),
    MultiModalMessage(source="user", content=content=[query, *images], metadata={"attached_files": '[{"name": ***", "type": "application/***", "size": 17**, "url": "***", "base64":"***"}]','user_request': '{"content": "user's input", "accepted": false, "plan": null}',})
]
```

- **用户首次输入**：

![](https://note.ihep.ac.cn/uploads/42564d6c-5799-41ff-a127-d4fa67ed5e81.png)

- **断连后重连**：

![](https://note.ihep.ac.cn/uploads/44c86727-5117-4833-a022-bbd61eb76772.png)

### 1.2.持续聊天

Dr.Sai UI界面所有出现`Waiting for your input`的字样时，前端输入框的角色名为：`source`=`"user_proxy"`，其他的消息的格式与1.1相同。

![](https://note.ihep.ac.cn/uploads/ecf22301-0aae-4886-a1e6-f5e372a18f54.png)

## 2.Dr.Sai UI前端可接收和展示的消息/事件类型

[OpenDrSai-事件与消息](https://note.ihep.ac.cn/s/0SL4vDMI5)中的消息或事件都可以通过智能体/多智能体系统的`run_stream`函数向前端发送。但是Dr.Sai UI只对以下消息或事件进行展示：

- MultiModalMessage：多模态消息
- ModelClientStreamingChunkEvent：流式输出
- TextMessage：文本消息，为了防止与ModelClientStreamingChunkEvent重复展示，需要在metadata字典中明确标明{"internal": "no"}，才能在前端展示
- AgentLogEvent：log事件
- TaskEvent：任务执行事件

以下1展示MultiModalMessage/ModelClientStreamingChunkEvent/TextMessage；2展示TaskEvent；3展示AgentLogEvent。更多的前后端人机交互功能正在开发中，欢迎提出需求。

![](https://note.ihep.ac.cn/uploads/cb6cce91-e5d0-4b3d-9d92-4d78f3a23f2e.png)



## 3.后端对Dr.Sai UI传入消息/文件的处理实践

1. 特别注意检查最后一条消息中`metadata`。用户对[前后端任务系统](https://note.ihep.ac.cn/s/Pe5yVj68X)的交互内容在`'user_request'`字段；前端上传的文件内容都在`"attached_files"`字段。在启动Dr.Sai UI时，设置[.env](https://note.ihep.ac.cn/s/I9jDYXlWb)文件中的USE_HEPAI_FILE字段为true，便可以让前端上传文件时同时上传到hepai文件系统，然后智能体后端可以在`'user_request'`字段的`"url"`字段中获取。

2. Dr.Sai UI限制了单个文件大小为10MB。对于大型文件则需要设计相应的文件系统，如：用户发送消息的内容可以包含智能体可访问URL或者文件路径，智能体对消息内容进行解析后获取相应的文件。