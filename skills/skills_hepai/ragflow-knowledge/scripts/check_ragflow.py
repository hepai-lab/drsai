from drsai.modules.components.memory.ragflow_memory import RAGFlowMemoryManager
import os, asyncio, json, sys
from dotenv import load_dotenv
load_dotenv()

RAGFLOW_URL = os.getenv('RAGFLOW_URL')
RAGFLOW_TOKEN = os.getenv('RAGFLOW_TOKEN')
async def check_ragflow(
    rag_flow_url: str,
    rag_flow_token: str,
    is_check_dataset_ids: bool = True,
    check_dataset_id:str = None,
):
    
    Manager = RAGFlowMemoryManager(
        rag_flow_url=rag_flow_url,
        rag_flow_token=rag_flow_token
    )
    
    if is_check_dataset_ids:
        datasets = await Manager.list_datasets()
        for dataset in datasets:
            print(dataset["id"], dataset["name"])
        print(json.dumps(datasets, indent=4, ensure_ascii=False))
    else:
        documents = await Manager.list_documents(check_dataset_id)
        for document in documents:
            print(document["id"], document["name"])
        print(json.dumps(documents, indent=4, ensure_ascii=False))

# if __name__ == "__main__":
    
#     # asyncio.run(check_ragflow(
#     #     rag_flow_url=RAGFLOW_URL,
#     #     rag_flow_token=RAGFLOW_TOKEN,
#     #     is_check_dataset_ids = False,
#     #     check_dataset_id="df102048145511f1b1ff0242ac120006"
#     #     ))

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python check_ragflow.py --list-datasets")
        print("       python check_ragflow.py --dataset-id <dataset_id>")
        sys.exit(1)

    command = sys.argv[1]
    
    if command == "--list-datasets":
        asyncio.run(check_ragflow(
            rag_flow_url=RAGFLOW_URL,
            rag_flow_token=RAGFLOW_TOKEN,
            is_check_dataset_ids=True
        ))
    elif command == "--dataset-id":
        if len(sys.argv) != 3:
            print("Error: --dataset-id requires a dataset ID")
            sys.exit(1)
        dataset_id = sys.argv[2]
        asyncio.run(check_ragflow(
            rag_flow_url=RAGFLOW_URL,
            rag_flow_token=RAGFLOW_TOKEN,
            is_check_dataset_ids=False,
            check_dataset_id=dataset_id
        ))
    else:
        print(f"Unknown command: {command}")
        sys.exit(1)



