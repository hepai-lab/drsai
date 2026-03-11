---
tags: OpenDrSai, 智能体文档
---

# OpenDrSai-智能体的上下文管理组件

这里主要介绍OpenDrSai中实现长期记忆智能压缩和管理的`DrSaiChatCompletionContext`，继承于AutoGen的`ChatCompletionContext`组件，可通过`drsai.modules.components.model_context`导入，具体代码见[drsai_model_context.py](https://github.com/hepai-lab/drsai/blob/main/python/packages/drsai/src/drsai/modules/components/model_context/drsai_model_context.py)。

`ChatCompletionContext`基类中存在两个关键函数：

```python
async def add_message(self, message: LLMMessage) -> None:
        """Add a message to the context."""
        self._messages.append(message)

@abstractmethod
async def get_messages(self) -> List[LLMMessage]: ...

```

- `add_message`:用于将用户等外部消息、记忆知识查询、智能体回复等消息加入到上下文管理组件中，管理智能体的全局记忆。

- `get_messages`:用于获取当前上下文管理类中的消息列表，用于模型调用。

## 1.如何实现智能的记忆压缩和长记忆

`DrSaiChatCompletionContext`进行以下两种改进:

- **1.使用[RAGFlow](https://ragflow.ihep.ac.cn/)储存智能体的记忆：**

```python
async def add_message(
    self, 
    message: LLMMessage, 
    important_keywords: List[str] = None,
    questions: List[str] = None
    ) -> None:
    """
    Add a message to the context and store the content to ragflow memory manager.
    important_keywords: The key terms or phrases to tag with the chunk.
    questions: If there is a given question, the embedded chunks will be based on them.
    """

    if self._rag_flow_manager is not None:
        await self._rag_flow_manager.add_chunks_to_dataset(
            dataset_id = self._dataset_id,
            document_id = self._document_id,
            content = message.content,
            important_keywords = important_keywords,
            questions = questions)
    self._messages.append(message)
    self._history_messages.append(message)
```

在储存智能体历史记忆时，使用RAGFlow矢量知识库管理框架上传消息记录，还可以将与消息记录有关的任务通过`questions`进行索引绑定。

- **2.使用大模型进行长段记忆压缩：**

```python
async def get_messages(self) -> List[LLMMessage]:
    """Get at most `token_limit` tokens in recent messages. If the token limit is not
    provided, then return as many messages as the remaining token allowed by the model client."""
    messages = list(self._messages)
    
    try:
        if self._token_limit is not None:
            token_count = self._model_client.count_tokens(messages, tools=self._tool_schema)
            if token_count > self._token_limit:
                messages.append(UserMessage(source="user", content=self._compression_prompt))
                compressed_response = await self._model_client.create(
                    messages=messages,
                    tools=self._tool_schema,
                )
                compressed_content = compressed_response.content
                
                # keep some key messages
                remaining_messages = []
                
                # Keep first two SystemMessage
                system_count = 0
                for message in messages:
                    if isinstance(message, SystemMessage) and system_count < 2:
                        remaining_messages.append(message)
                        system_count += 1
                
                # Add compressed content as UserMessage in the middle
                remaining_messages.append(UserMessage(content=compressed_content, source="system"))
                
                # Keep last UserMessage
                user_messages = [msg for msg in messages if isinstance(msg, UserMessage)]
                for user_message in reversed(user_messages):
                    if user_message.source == "user":
                        remaining_messages.append(user_message)
                        break
                return remaining_messages
            else:
                return messages
        else:
            raise ValueError("token_limit must be provided.")

    except Exception as e:
        logger.error(f"There is an error when compressing the memory using LLM: {e}. We have to truncate the memory.")
        if self._token_limit is None:
            remaining_tokens = self._model_client.remaining_tokens(messages, tools=self._tool_schema)
            while remaining_tokens < 0 and len(messages) > 0:
                middle_index = len(messages) // 2
                messages.pop(middle_index)
                remaining_tokens = self._model_client.remaining_tokens(messages, tools=self._tool_schema)
        else:
            token_count = self._model_client.count_tokens(messages, tools=self._tool_schema)
            while token_count > self._token_limit and len(messages) > 0:
                middle_index = len(messages) // 2
                messages.pop(middle_index)
                token_count = self._model_client.count_tokens(messages, tools=self._tool_schema)
        if messages and isinstance(messages[0], FunctionExecutionResultMessage):
            # Handle the first message is a function call result message.
            # Remove the first message from the list.
            messages = messages[1:]
        return messages
```

这里通过设置的`self._token_limit`参数控制智能体上下文长度。触发阈值`self._token_limit`后，使用大模型根据压缩提示词`self._compression_prompt`对历史消息进行压缩，一个示例的prompt是：

```python
COMPRESSION_PROMPT_ZN = """
你是一个负责压缩长对话记忆的助手。现在给你一段包含用户、智能助手{name}以及其他助手多轮对话的记录。你的任务是从中提取长期有价值的信息，并输出高度压缩、结构清晰的摘要。

请从以下方面进行总结：

1. **用户的初始任务、目标、背景信息、用户或者其他智能助手查询的记忆等信息**（只保留长期有用内容）。
2. **智能助手{name}在对话中做出的关键回复、思考过程摘要和重要决策**：
   - 包含每个关键动作使用的工具名称、调用目的、输入要点、输出或执行结果。
   - 若工具失败或返回无效结果，也需简要记录原因。
3. **当前轮对话结束时，用户或其他助手对{name}提出的最新需求或待办事项**。

同时请遵守以下要求：
- 忽略闲聊、重复确认、无用解释等短期内容。
- 若对话是中英文或混合语言，保留相应的语言。
- 尽可能压缩 token，同时保持可读性与完整的因果链。
- 输出必须客观、无臆测，仅基于对话内容进行总结。

请最终按照每个部分进行输出。

"""
```

## 3.智能体中进行长期记忆压缩

### 3.1.DrSaiChatCompletionContext的初始化参数如下：

```python
def __init__(
    self,
    agent_name: str,
    model_client: ChatCompletionClient,
    *,
    token_limit: int | None = None,
    compression_prompt: str|None = None,
    rag_flow_url: str | None = None,
    rag_flow_token: str | None = None,
    dataset_id: str|None = None,
    document_id: str|None = None,
    tool_schema: List[ToolSchema] | None = None,
    initial_messages: List[LLMMessage] | None = None,
) -> None:
    """
    name: The name of the memory instance (optional)
    RAGFLOW_URL: The URL of the RAGFlow API (default: "https://aiweb01.ihep.ac.cn:886")
    RAGFLOW_TOKEN: The API token for RAGFlow (default: "")
    dataset_ids: The IDs of the datasets to search (optional, but either this or document_ids must be set)
    document_ids: The IDs of the documents to search (optional, but either this or dataset_ids must be set)
    page: Page number (default: 1)
    page_size: Maximum number of chunks per page (default: 30)
    similarity_threshold: Minimum similarity score (default: 0.2)
    vector_similarity_weight: Weight of vector cosine similarity (default: 0.3)
    top_k: Number of chunks engaged in vector cosine computation (default: 1024)
    rerank_id: The ID of the rerank model (optional)
    keyword: Enable keyword-based matching (default: False)
    highlight: Enable highlighting of matched terms (default: False)
    """
```

**其中需要重要的是：**

**rag_flow_url、rag_flow_token、dataset_id、document_id**：决定你的长期记忆存储在RAGFlow的哪个数据集地址`dataset`中的哪个文件`document`。
**compression_prompt**：进行长记忆压缩的提示语。

### 3.2.使用示例

将`DrSaiChatCompletionContext`和`RAGFlowMemory`放入一个Agent中，`DrSaiChatCompletionContext`进行长记忆的上传和压缩，通过相同的`dataset_id`和`document_id`，`RAGFlowMemory`可以进行记忆的持久化存储和查询。

```python
# 创建大模型管理组件
model_client = HepAIChatCompletionClient(
    model="deepseek-ai/deepseek-v3-1",
    base_url="https://aiapi.ihep.ac.cn/apiv2",
    api_key=os.getenv('HEPAI_API_KEY'),
    model_info={
            "vision": False,
            "function_calling": True,  # You must sure that the model can handle function calling
            "json_output": True,
            "structured_output": False,
            "family": ModelFamily.GPT_41,
            "multiple_system_messages":True,
            "token_model": "gpt-4o-2024-11-20", # Default model for token counting
        },)

# 创建基于RAGFlow的智能体RAG知识库管理组件
RAGFLOW_URL = os.getenv('RAGFLOW_URL')
RAGFLOW_TOKEN = os.getenv('RAGFLOW_TOKEN')
ragflow_memory = RAGFlowMemory(
    RAGFlowMemoryConfig(
        RAGFLOW_URL=RAGFLOW_URL,
        RAGFLOW_TOKEN=RAGFLOW_TOKEN,
        dataset_ids=["28e3ad8499b311f0a65d0242ac120006"],
        keyword=True,
    )
)

# 创建长短期记忆智能管理组件，指定长期记忆传入的数据集和文件的位置
model_context = DrSaiChatCompletionContext(
    agent_name = "assistant_agent",
    model_client = model_client,
    token_limit = 100000,
    rag_flow_url = RAGFLOW_URL,
    rag_flow_token = RAGFLOW_TOKEN,
    dataset_id = "28e3ad8499b311f0a65d0242ac120006",
    document_id = "2155wd8499b311f0a65d0242ac120006",
)

# 将大模型管理组件、RAG知识库管理组件、长短期记忆智能管理组件传入`DrSaiAgent`中即可
assistant_agent = DrSaiAgent(
    name="assistant_agent",
    system_message="""你是一个问答助手，需要根据检索到的记忆内容进行回复。""",
    description="一个问答助手",
    model_client=model_client,
    model_client_stream=True,
    memory=[ragflow_memory],
    model_context=model_context
)
```