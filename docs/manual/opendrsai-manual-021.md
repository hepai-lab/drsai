---
tags: OpenDrSai, 智能体开发实践
---

# OpenDrSai智能体开发实践-RAGFlow知识库的接入

高能所ragflow网址：https://ragflow.ihep.ac.cn/
案例具体链接见：https://github.com/hepai-lab/drsai/blob/main/examples/agent_groupchat/assistant_memory_ragflow.py

这里展示了RAGFlow接入OpenDrSai智能体框架的过程：

## 1.RAGFlow接入OpenDrSai智能体框架

- 登录RAGFlow，配置基础模型

![](https://note.ihep.ac.cn/uploads/0bb0cb11-7ec2-4bec-9e43-c2ffa2dd9652.PNG)

- 通过`https://aiapi.ihep.ac.cn`配置chat/embbeding/rerank模型

![](https://note.ihep.ac.cn/uploads/74776881-e5a5-49ca-99ad-c49b274555a2.PNG)

- 创建专属知识库并确定embbeding模型，选择文件解析模式，上传文件

![](https://note.ihep.ac.cn/uploads/56c49792-79dc-41f8-807c-a54ecbccc4b4.PNG)

- 在RAGFlow中进行检索测试

![](https://note.ihep.ac.cn/uploads/28b58867-d3ef-464b-b48a-45ed030a2881.png)

**注意**，此时可以使用Rerank模型与跨语言搜索增加多语言知识的召回率：

![](https://note.ihep.ac.cn/uploads/bf280070-50eb-40d2-bdb3-db02bad6f58d.png)

- 获取RAGFlow的API URL和RAGFLOW_TOKEN

![](https://note.ihep.ac.cn/uploads/98083c10-f71e-4290-a651-5f8432351435.png)

- 使用以下代码获取RAGFlow知识库的ID以及所需要检索的文件ID

```python
from drsai.modules.components.memory.ragflow_memory import RAGFlowMemoryManager
import asyncio

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
    # print(json.dumps(datasets, indent=4, ensure_ascii=False))

    documents = await Manager.list_documents("c204f51ad05211f0962d0242ac120006")
    print(json.dumps(documents, indent=4, ensure_ascii=False))
    
if __name__ == "__main__":
    asyncio.run(check_ragflow())
```

**注意**，需要先从Manager.list_datasets获取有哪些dataset_id，然后再根据dataset_id使用Manager.list_documents看看知识库中的文件ID

## 2.RAGFlow接入OpenDrSai智能体框架

- 通过API URL和RAGFLOW_TOKEN将RAGFlow的知识库接入OpenDrSai智能体

```python

# 导入大模型Client、RAGFlow知识库管理模块、模型上下文管理模块、智能体框架、智能体运行方式等
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
            document_ids = None,
            page = 1,
            page_size = 30,
            similarity_threshold = 0.2,
            vector_similarity_weight = 0.3,
            top_k = 1024,
            rerank_id = None,
            keyword = True,
            highlight = False,
            cross_languages=["en", "zh"],
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

if __name__ == "__main__":
    
    # asyncio.run(
    #     run_console(
    #         agent_factory=create_agent, 
    #         task="什么是OpenDrSai"
    #     )
    # )

    asyncio.run(
        run_worker(
            # 智能体注册信息
            agent_name="Your_Assistant",
            author = "xiongdb@ihep.ac.cn",
            permission='groups: drsai, payg, ddf_free; users: admin, xiongdb@ihep.ac.cn, ddf_free, yqsun@ihep.ac.cn; owner: xiongdb@ihep.ac.cn',
            description = "一个问答助手",
            version = "0.1.0",
            logo="https://aiapi.ihep.ac.cn/apiv2/files/file-8572b27d093f4e15913bebfac3645e20/preview",
            # 智能体实体
            agent_factory=create_agent, 
            # 后端服务配置
            port = 42816, 
            no_register=False,
            enable_openwebui_pipeline=True, 
            history_mode = "backend",
            # use_api_key_mode = "backend",
        )
    )
```

更多的案例见：https://github.com/hepai-lab/drsai/tree/main/examples/agent_groupchat