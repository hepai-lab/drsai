import requests
from typing import Any

class RAGFlowMemory:
    """
    Functions to interact with RAGFlow Memory API
    - List datasets 
    - list_documents
    - retrieve chunks by question
    """
    def __init__(
            self,
            base_url: str,
            api_key: str
    ):
        self.base_url = base_url
        self.api_key = api_key
        self.headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }

    def list_datasets(self) -> list[dict[str, Any]]:
        try:
            response = requests.get(f"{self.base_url}/api/v1/datasets", headers=self.headers)
            return response.json()["data"]
        except:
            return []
    
    def list_documents(self, dataset_id: str) -> list[dict[str, Any]]:
        try:
            response = requests.get(f"{self.base_url}/api/v1/datasets/{dataset_id}/documents", headers=self.headers)
            return response.json()["data"]
        except:
            return []
    
    def retrieve_chunks_by_content(
            self,
            question: str,
            dataset_ids: list[str] = [],
            document_ids: list[str] = [],
            similarity_threshold: float = 0.2,
            vector_similarity_weight: float = 0.3,
            **kwargs: Any
            ) -> dict[str, Any]:
        """
        Retrieve chunks by question.
        kwargs:
            page: int = 1
            page_size: int = 30
            top_k: int = 1024
            rerank_id: int
            keyword: bool 
            highlight bool 
        """
        params = {
            "question": question,
            "dataset_ids": dataset_ids,
            "document_ids": document_ids,
            "similarity_threshold": similarity_threshold,
            "vector_similarity_weight": vector_similarity_weight,
            **kwargs
        }
        try:
            if not dataset_ids and not document_ids:
                raise
            response = requests.post(
                f"{self.base_url}/api/v1/retrieval", 
                headers=self.headers,
                json=params
                )
            return response.json()["data"]
        except:
            return {}

if __name__ == "__main__":

    import json

    base_url = "https://aiweb01.ihep.ac.cn:886"
    api_key = "ragflow-***" 
    ragflow_memory = RAGFlowMemory(base_url, api_key)

    # print(json.dumps(ragflow_memory.list_datasets(), indent=4))
    # print(json.dumps(ragflow_memory.list_documents("70722df8519011f08a170242ac120006"), indent=4))
    result = ragflow_memory.retrieve_chunks_by_content(
        question="The Open Molecules 2025 (OMol25) Dataset",
        dataset_ids=["70722df8519011f08a170242ac120006"]

    )
    print(json.dumps(result, indent=4))
  