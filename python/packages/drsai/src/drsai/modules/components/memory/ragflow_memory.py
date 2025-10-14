import requests
from typing import Any
import httpx


from pydantic import BaseModel
from typing import List, Dict, Any
from typing_extensions import Self
from autogen_core._component_config import Component
from autogen_core import CancellationToken
from autogen_core.model_context import ChatCompletionContext
from autogen_core.models import SystemMessage, UserMessage, AssistantMessage
from autogen_core.memory._base_memory import (
    Memory, 
    MemoryContent, 
    MemoryQueryResult, 
    UpdateContextResult,
    MemoryMimeType
    )



class RAGFlowMemoryConfig(BaseModel):
    """
    Configuration for ListMemory component.
    Args:
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

    name: str | None = None
    RAGFLOW_URL: str = "https://aiweb01.ihep.ac.cn:886"
    RAGFLOW_TOKEN: str = ""
    dataset_ids: list[str] = None
    document_ids: list[str] = None
    page: int = 1
    page_size: int = 30
    similarity_threshold: float = 0.2
    vector_similarity_weight: float = 0.3
    top_k: int = 1024
    rerank_id: str = None
    keyword: bool = False
    highlight: bool = False


class RAGFlowMemory(Memory, Component[RAGFlowMemoryConfig]):
    component_type = "memory"
    component_provider_override = "drsai.RAGFlowMemory"
    component_config_schema = RAGFlowMemoryConfig

    def __init__(
            self, 
            config: RAGFlowMemoryConfig,
            ) -> None:
        self._config = config
        self._name = config.name or "ragflow_memory"

    @property
    def name(self) -> str:
        """Get the memory instance identifier.

        Returns:
            str: Memory instance name
        """
        return self._name

    async def query(
        self,
        query: str | MemoryContent = "",
        cancellation_token: CancellationToken | None = None,
        config: RAGFlowMemoryConfig = None,
    ) -> MemoryQueryResult:
        """Return all memories without any filtering.

        Args:
            query: Ignored in this implementation
            cancellation_token: Optional token to cancel operation
            config: Optional configuration to use instead of the one provided at initialization

        Returns:
            MemoryQueryResult containing all stored memories
        """
        async def retrieve_chunks(
            question: str,
            RAGFLOW_URL: str,
            RAGFLOW_TOKEN: str,
            dataset_ids: list[str] = None,
            document_ids: list[str] = None,
            page: int = 1,
            page_size: int = 30,
            similarity_threshold: float = 0.2,
            vector_similarity_weight: float = 0.3,
            top_k: int = 1024,
            rerank_id: str = None,
            keyword: bool = False,
            highlight: bool = False
        ):
            """
            Retrieve chunks from specified datasets using RAGFlow retrieval API.

            Args:
                question: The user query or query keywords (required)
                RAGFLOW_URL: str,
                RAGFLOW_TOKEN: str,
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

            Returns:
                JSON response containing the retrieved chunks

            Raises:
                ValueError: If neither dataset_ids nor document_ids is provided
            """
            # Validate that at least one of dataset_ids or document_ids is provided
            if not dataset_ids and not document_ids:
                raise ValueError("Either dataset_ids or document_ids must be provided")

            url = f"{RAGFLOW_URL}/api/v1/retrieval"

            # Build request body
            body = {
                "question": question,
                "page": page,
                "page_size": page_size,
                "similarity_threshold": similarity_threshold,
                "vector_similarity_weight": vector_similarity_weight,
                "top_k": top_k,
                "keyword": keyword,
                "highlight": highlight
            }

            # Add optional parameters if provided
            if dataset_ids:
                body["dataset_ids"] = dataset_ids
            if document_ids:
                body["document_ids"] = document_ids
            if rerank_id:
                body["rerank_id"] = rerank_id

            # Set up headers with authorization token and content type
            headers = {
                "Content-Type": "application/json",
                "Authorization": f"Bearer {RAGFLOW_TOKEN}"
            }

            # Make the async HTTP POST request
            async with httpx.AsyncClient() as client:
                response = await client.post(url, json=body, headers=headers)
                response.raise_for_status()
                data = response.json()["data"]

            return data
        try:
            if not config:
                config = self._config
            data = await retrieve_chunks(
                question=query,
                RAGFLOW_URL=config.RAGFLOW_URL,
                RAGFLOW_TOKEN=config.RAGFLOW_TOKEN,
                dataset_ids=config.dataset_ids,
                document_ids=config.document_ids,
                page=config.page,
                page_size=config.page_size,
                similarity_threshold=config.similarity_threshold,
                vector_similarity_weight=config.vector_similarity_weight,
                top_k=config.top_k,
                rerank_id=config.rerank_id,
                keyword=config.keyword,
                highlight=config.highlight
            )
            results = [MemoryContent(content=chunk["content"], mime_type =MemoryMimeType.TEXT, metadata=chunk) for chunk in data["chunks"]]
            return MemoryQueryResult(results=results)
        except Exception as e:
            print(f"Error retrieving chunks from RAGFlow: {str(e)}")
            return MemoryQueryResult(results=[])
    
    async def update_context(
        self,
        model_context: ChatCompletionContext,
    ) -> UpdateContextResult:
        """Update the model context by appending memory content.

        This method mutates the provided model_context by adding all memories as a
        SystemMessage.

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

    async def add(self, content: MemoryContent, cancellation_token: CancellationToken | None = None) -> None:
        """
        Add a new content to memory.

        Args:
            content: The memory content to add
            cancellation_token: Optional token to cancel operation
        """
        pass

    async def clear(self) -> None:
        """Clear all entries from memory."""
        pass

    async def close(self) -> None:
        """Clean up any resources used by the memory implementation."""
        pass

    @classmethod
    def _from_config(cls, config: RAGFlowMemoryConfig) -> Self:
        return cls(config=config)

    def _to_config(self) -> RAGFlowMemoryConfig:
        return self._config
    

class RAGFlowMemoryManager:
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
    ragflow_memory = RAGFlowMemoryManager(base_url, api_key)

    # print(json.dumps(ragflow_memory.list_datasets(), indent=4))
    # print(json.dumps(ragflow_memory.list_documents("70722df8519011f08a170242ac120006"), indent=4))
    result = ragflow_memory.retrieve_chunks_by_content(
        question="The Open Molecules 2025 (OMol25) Dataset",
        dataset_ids=["70722df8519011f08a170242ac120006"]

    )
    print(json.dumps(result, indent=4))
  