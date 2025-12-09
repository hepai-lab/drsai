from typing import (
    AsyncGenerator, 
    List, 
    Sequence, 
    Dict, 
    Any, 
    Callable, 
    Awaitable, 
    Union, 
    Optional, 
    Tuple,
    Self,
    Mapping,
    )

import asyncio
import json
import os
from dotenv import load_dotenv
load_dotenv()


from drsai.modules.components.memory.ragflow_memory import RAGFlowMemory, RAGFlowMemoryConfig, RAGFlowMemoryManager
from drsai.modules.components.model_context import DrSaiChatCompletionContext
from drsai.modules.components.model_client.LLMClient import ModelFamily, HepAIChatCompletionClient

from assistant_literature import LiteratureAgent

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

async def test_literature() -> LiteratureAgent:
    
    # Create model client
    model_client = HepAIChatCompletionClient(
        model="aliyun/qwen3-max-preview",
        base_url="https://aiapi.ihep.ac.cn/apiv2",
        api_key=os.getenv('HEPAI_API_KEY'),
        model_info={
                "vision": True,
                "function_calling": True,  # You must sure that the model can handle function calling
                "json_output": True,
                "structured_output": False,
                "family": ModelFamily.GPT_41,
                "multiple_system_messages":True,
                "token_model": "gpt-4o-2024-11-20", # Default model for token counting
            },)

    # Create a RAGFlowMemory instance with the given configuration.
    RAGFLOW_URL = os.getenv('RAGFLOW_URL')
    RAGFLOW_TOKEN = os.getenv('RAGFLOW_TOKEN')
    ragflow_memory = RAGFlowMemory(
        RAGFlowMemoryConfig(
            name="ragflow_memory",
            RAGFLOW_URL=RAGFLOW_URL,
            RAGFLOW_TOKEN=RAGFLOW_TOKEN,
            dataset_ids=[
                # "28e3ad8499b311f0a65d0242ac120006", # Knowledge
                "c204f51ad05211f0962d0242ac120006", # Long Term Memory
                ],
            document_ids = None,
            page = 1,
            page_size = 30,
            similarity_threshold = 0.2,
            vector_similarity_weight = 0.3,
            top_k = 1024,
            rerank_id = None,
            keyword = False,
            highlight = False,
            )
    )

    # Create a Long meomory ModelContext and use RAGFlow to store the long-term memory
    model_context = DrSaiChatCompletionContext(
            agent_name = "LiteratureAgent",
            model_client = model_client,
            token_limit = 100000,
            tool_schema = None,
            dataset_id = "c204f51ad05211f0962d0242ac120006",
            document_id = "eeb04af6d05211f0b1210242ac120006", # Used for storing long-term memory
        )
    
    literature_agent = LiteratureAgent(
        name="LiteratureAgent",
        system_message="""""",
        description="一个",
        model_client=model_client,
        model_client_stream=True,
        memory=[ragflow_memory],
        model_context=model_context
    )


if __name__ == "__main__":
    asyncio.run(check_ragflow())