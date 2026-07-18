---
tags: OpenDrSai, 智能体文档
---

# OpenDrSai-智能体的RAG知识库和记忆管理组件

这里主要介绍基于[RAGFlow](https://ragflow.ihep.ac.cn/)的智能体的RAG知识库和记忆管理组件-`RAGFlowMemory`，继承于AutoGen的`Memory`组件，可通过`drsai.modules.components.memory`导入。通过以下的方式进行实例化使用：

```python
from drsai import RAGFlowMemory, RAGFlowMemoryConfig
from drsai.modules.components.memory import MemoryQueryResult
import asyncio

async def test_ragflow_memory():
    
    RAGFlowMemoryConfig(
        name="ragflow_memory_01",
        RAGFLOW_URL=RAGFLOW_URL,
        RAGFLOW_TOKEN=RAGFLOW_TOKEN,
        dataset_ids=["28e3ad8499b311f0a65d0242ac120006"],
        keyword=True,
        )
    
    ragflow_component = RAGFlowMemory(config)

    retrieve_result:MemoryQueryResult = await ragflow_component.query(
        query="What is the capital of France?",
    )
    print(retrieve_result)

asyncio.run(test_ragflow_memory())
```

## 1.实例化参数解释

- `name`: 记忆实例的名称（可选）
- `RAGFLOW_URL`: RAGFlow API 的网络地址（默认值："https://ragflow.ihep.ac.cn/"）
- `RAGFLOW_TOKEN`: 用于 RAGFlow 的 API 令牌（默认值：空字符串）
- `dataset_ids`: 需要检索的数据集 ID 列表（可选参数，但该参数与 `document_ids` 参数二者必须设置其一）
- `document_ids`: 需要检索的文档 ID 列表（可选参数，但该参数与 `dataset_ids` 参数二者必须设置其一）
- `page`: 页码（默认值：1）
- `page_size`: 每页返回的最大文本块数量（默认值：30）
- `similarity_threshold`: 最低相似度分数阈值（默认值：0.2）
- `vector_similarity_weight`: 向量余弦相似度的权重占比（默认值：0.3）
- `top_k`: 参与向量余弦相似度计算的文本块数量上限（默认值：1024）
- `rerank_id`: 重排序模型的 ID（可选）
- `keyword`: 启用基于关键词的匹配功能（默认值：False）
- `highlight`: 启用匹配关键词的高亮显示功能（默认值：False）

### 1.1.获取`RAGFLOW_URL`和`RAGFLOW_TOKEN`

对于`RAGFLOW_URL`和`RAGFLOW_TOKEN`，你需要从"https://ragflow.ihep.ac.cn/"或者任何其他的RAGFlow服务提供商获取。获取方式如下：

1. 登录到RAGFlow服务后从右上角的`我的`进入：

![](https://note.ihep.ac.cn/uploads/c52e139e-a885-4f69-ad57-7a1c899c2a35.png)

2. 在`API`中获取服务商给你的`RAGFLOW_URL`和`RAGFLOW_TOKEN`：

![](https://note.ihep.ac.cn/uploads/8594c1b9-7232-454b-8dd2-2b07bc37cb28.png)

### 1.2.获取`dataset_ids`和`document_ids`

可以通过以下的方式获取RAGFlow服务中配置的`dataset_ids`，以及具体的`document_ids`。

```python
from drsai.modules.components.memory.ragflow_memory import RAGFlowMemoryManager
import os
from dotenv import load_dotenv
load_dotenv()
async def check_ragflow():
    
    RAGFLOW_URL = os.getenv('RAGFLOW_URL')
    RAGFLOW_TOKEN = os.getenv('RAGFLOW_TOKEN')
    
    Manager = RAGFlowMemoryManager(
        rag_flow_url=RAGFLOW_URL,
        rag_flow_token=RAGFLOW_TOKEN
    )

    datasets = await Manager.list_datasets()
    for dataset in datasets:
        print(dataset["id"], dataset["name"])
    print(json.dumps(datasets, indent=4, ensure_ascii=False))

    documents = await Manager.list_documents("c204f51ad05211f0962d0242ac120006")
    print(json.dumps(documents, indent=4, ensure_ascii=False))
```

## 2.在智能体内部的调用方式

`Memory`组件在`DrSaiAgent.on_messages_stream`函数内，通过`update_context`方法，将根据用户问题查询的到的内容加入智能体的上下文管理组件`ChatCompletionContext`中。下面的代码展示了智能体的RAG知识库和记忆管理组件与上下文管理组件的交互方式：

1. 根据用户的最新问题去知识库匹配相似知识。
2. 整理为`UserMessage`加入到上下文管理组件，即加入到智能体的上下中。
3. 将查询的内容以`UpdateContextResult`格式返回。

```python
async def update_context(
        self,
        model_context: ChatCompletionContext,
    ) -> UpdateContextResult:
        """Update the model context by appending memory content.

        This method mutates the provided model_context by adding all memories as a UserMessage.

        Args:
            model_context: The context to update. Will be mutated if memories exist.

        Returns:
            UpdateContextResult containing the memories that were added to the context
        """

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
            await model_context.add_message(UserMessage(content=memory_context, source="MemoryManager"))

        return UpdateContextResult(memories=query_results)
```

## 3.将智能体的RAG知识库和记忆管理组件-`RAGFlowMemory`接入智能体

```python

from drsai.modules.components.model_client import HepAIChatCompletionClient, ModelFamily
from drsai.modules.components.memory import RAGFlowMemory, RAGFlowMemoryConfig
from drsai.modules.components.model_context import (
    TokenLimitedChatCompletionContext,
    )
from drsai.modules.baseagent import DrSaiAgent
from drsai import run_backend, run_console, run_worker
import os, json, sys
import asyncio
from dotenv import load_dotenv
load_dotenv()

# Create a factory function to ensure isolated Agent instances for concurrent access.
async def create_agent() -> DrSaiAgent:

    # Create model client
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

    # Create a RAGFlow memory for your specific knowledge
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

    # Create model context
    model_context = TokenLimitedChatCompletionContext(
        model_client=model_client,
        token_limit=100000,
    )

    # Create assistant agent with the model client and memory
    assistant_agent = DrSaiAgent(
        name="assistant_agent",
        system_message="""你是一个问答助手，需要根据检索到的记忆内容进行回复。""",
        description="一个问答助手",
        model_client=model_client,
        model_client_stream=True,
        memory=[ragflow_memory],
        model_context=model_context
    )

    return assistant_agent

```

## 相关参考

1. https://mp.weixin.qq.com/s/NkAh0yh9vP073Kcu7SsInw
2. https://mp.weixin.qq.com/s/bK7bJ7YYYTvhl8jfAW_dcQ