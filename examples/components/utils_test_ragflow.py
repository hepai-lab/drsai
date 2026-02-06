from drsai.modules.components.memory.ragflow_memory import RAGFlowMemoryManager
import asyncio
import os, json
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
    # print(json.dumps(datasets, indent=4, ensure_ascii=False))

    documents = await Manager.list_documents("70722df8519011f08a170242ac120006")
    print(json.dumps(documents, indent=4, ensure_ascii=False))
    
if __name__ == "__main__":
    asyncio.run(check_ragflow())