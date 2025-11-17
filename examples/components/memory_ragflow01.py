from drsai import RAGFlowMemory, RAGFlowMemoryConfig
from autogen_core.memory._base_memory import (MemoryQueryResult)
import os
import asyncio
from dotenv import load_dotenv
load_dotenv()

RAGFLOW_URL = os.getenv('RAGFLOW_URL')
RAGFLOW_TOKEN = os.getenv('RAGFLOW_TOKEN')

# 
async def test_ragflow_memory(config: RAGFlowMemoryConfig) -> RAGFlowMemory:

    ragflow_component = RAGFlowMemory(config)

    retrieve_result:MemoryQueryResult = await ragflow_component.query(
        query="What is the capital of France?",
    )
    print(retrieve_result)

if __name__ == '__main__':
    # create a RAGFlowMemory instance
    config = RAGFlowMemoryConfig(
        name="ragflow_memory_01",
        RAGFLOW_URL=RAGFLOW_URL,
        RAGFLOW_TOKEN=RAGFLOW_TOKEN,
        dataset_ids=["28e3ad8499b311f0a65d0242ac120006"],
        keyword=True,
        )
    
    asyncio.run(test_ragflow_memory(config))