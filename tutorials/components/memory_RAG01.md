# RAG和智能体记忆系统设计

## 模型的上下文管理类-model_context

模型上下文管理类是用来管理模型的状态和记忆的类，在智能体内部接受传入智能体的messages（主要为BaseTextMessage类型），然后处理传入智能体的memory类列表，转化为LLMMessage的SystemMessage，将最终的LLMMessage发送给LLM（ModelClient）做出回复。目前AutoGen框架默认支持以下四种模型上下文管理类：

- `BufferedChatCompletionContext`:保持固定最后几条LLMMessage作为消息上下文。
  - buffer_size (int): 最后保留的消息数量。
  - initial_messages (List[LLMMessage] | None): 初始消息列表 
- `UnboundedChatCompletionContext`: 默认的消息上下文管理类，不做任何限制。
- `TokenLimitedChatCompletionContext`: 限制消息的token数量。
  - model_client (ModelClient): 模型客户端, 用于计数
  - token_limit (int | None): 最大token数量
  - tool_schema (List[ToolSchema] | None): 智能体所使用的工具ToolSchema列表
  - initial_messages (List[LLMMessage] | None): 初始消息列表
- `HeadAndTailChatCompletionContext`: 保留前n条和后m条消息
 - head_size (int): 头部消息数量
 - tail_size (int): 尾部消息数量
 - initial_messages (List[LLMMessage] | None): 初始消息列表

**接入智能体:**

```python
AssistantAgent(
    name="weather_agent",
    model_client=model_client,
    system_message="You are a helpful assistant.",
    tools=FunctionTools # 或者直接传入列表tools
    model_context=BufferedChatCompletionContext(
        buffer_size=10,
        initial_messages=None)
    )
```

## AutoGen原生记忆层设计-Memory

这里以AutoGen的原生的ChromaDBVectorMemory为例, 说明AutoGen的记忆层的设计。

**构建ChromaDBVectorMemory矢量数据库知识管理类:**

- 构建ChromaDBVectorMemory类，继承自Memory类。
```python
from autogen_ext.memory.chromadb import ChromaDBVectorMemory, PersistentChromaDBVectorMemoryConfig
chroma_user_memory = ChromaDBVectorMemory(
    config=PersistentChromaDBVectorMemoryConfig(
        collection_name="preferences",
        persistence_path=os.path.join(str(Path.home()), ".chromadb_autogen"),
        k=2,  # Return top  k results
        score_threshold=0.4,  # Minimum similarity score
    )
)
```

- ChromaDBVectorMemory为model_context更新模型上下文

可以看到, 这里使用model_context储存的智能体历史消息的最后消息作为查询的query_text。然后将查询的结果以SystemMessage(content=memory_context)返回到model_context中。这是在智能体的on_messages_stream函数中作为消息处理的一个过程。
```python
    async def update_context(
        self,
        model_context: ChatCompletionContext,
    ) -> UpdateContextResult:
        messages = await model_context.get_messages()
        if not messages:
            return UpdateContextResult(memories=MemoryQueryResult(results=[]))

        # Extract query from last message
        last_message = messages[-1]
        query_text = last_message.content if isinstance(last_message.content, str) else str(last_message)

        # Query memory and get results
        query_results = await self.query(query_text)

        if query_results.results:
            # Format results for context
            memory_strings = [f"{i}. {str(memory.content)}" for i, memory in enumerate(query_results.results, 1)]
            memory_context = "\nRelevant memory content:\n" + "\n".join(memory_strings)

            # Add to context
            await model_context.add_message(SystemMessage(content=memory_context))

        return UpdateContextResult(memories=query_results)
```

具体见:[examples/components/memory01.py](examples/components/memory01.py)。具体的功能用户可以继承ChromaDBVectorMemory或者Memory类进行定制。

**接入智能体:**

```python
assistant_agent = AssistantAgent(
    name="assistant_agent",
    model_client=model_client,
    tools=[get_weather],
    memory=[chroma_user_memory],
    )
```

## 组件式加载

具体见[examples/components/memory01.py](../../examples/components/memory01.py)

## OpenDrSai记忆层设计-memory_function

OpenDrSai的记忆层设计与AutoGen的记忆层设计类似，不同之处在于OpenDrSai的记忆层设计在智能体调用LLM模型时使用，具体见python/packages/drsai/src/drsai/modules/baseagent/drsaiagent.py的415行。memory_function需要用户自定义的功能是：根据消息列表内容进行自定义查询，直接更新闯入的消息列表，最后返回更新后的消息列表，作为传入大模型的上下文。此时这些查询的外部知识并不会进入智能体的历史记录-model_context中。内部的实现逻辑如下：

```python
    async def _call_memory_function(
            self, 
            llm_messages: List[LLMMessage],
            model_client: ChatCompletionClient,
            cancellation_token: CancellationToken,
            agent_name: str,) -> List[LLMMessage]:
        """使用自定义的memory_function，为大模型回复增加最新的知识"""
        # memory_function: 自定义的memory_function，用于RAG检索等功能，为大模型回复增加最新的知识
        memory_messages: List[Dict[str, str]] = await self.llm_messages2oai_messages(llm_messages)
        try:
            memory_messages_with_new_knowledge: List[Dict[str, str]]|List[LLMMessage] = await self._memory_function(
                memory_messages, 
                llm_messages, 
                model_client, 
                cancellation_token,
                agent_name,
                **self._user_params)
            if isinstance(memory_messages_with_new_knowledge[0], dict):
                llm_messages: List[LLMMessage] = await self.oai_messages2llm_messages(memory_messages_with_new_knowledge)
            else:
                llm_messages = memory_messages_with_new_knowledge
            return llm_messages
        except Exception as e:
            raise ValueError(f"Error: memory_function: {self._memory_function.__name__} failed with error {e}.")
```
可以看到智能体内部会向用户的自定义memory_function传入：
- memory_messages: 传入的LLMMessage列表，经过转换后为OAIMessage列表
- llm_messages: 传入的LLMMessage列表
- model_client: 模型客户端，用于调用LLM模型
- cancellation_token: 取消标记
- agent_name: 智能体名称
- **self._user_params: 用户自定义参数
返回值可以为List[LLMMessage]或List[Dict[str, str]]，如果返回List[Dict[str, str]]，则会自动转换为List[LLMMessage]。

一个简单的memory_function示例如下：

```python
async def rag_demo(
    messages: List[Dict], 
    llm_messages: List[LLMMessage], 
    model_client: HepAIChatCompletionClient,
    cancellation_token: CancellationToken,
    agent_name: str,
    **kwargs
    ):
    query = messages[-1]["content"]  # Select the last message of the chat history as the RAG query statement.
    retrieve_txt = "1. Humans will be destroyed by AI in 2050;\n2. Humans are destroyed by AI due to their arrogance and conceit."
    last_txt = f"""The following are some reference materials, and you must refer to these materials to answer the question:\n{retrieve_txt}. My question is: {query}"""
    messages[-1]["content"] = last_txt
    return messages
```

**接入智能体:**

```python
AssistantAgent(
    name="weather_agent",
    model_client=model_client,
    memory_function=rag_demo,
    system_message="You are a helpful assistant.",
)
```