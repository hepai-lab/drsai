import requests
from typing import Any
import httpx
import os

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
from loguru import logger


class RAGFlowMemoryConfig(BaseModel):
    """
    Configuration for ListMemory component.
    Args:
        name: The name of the memory instance (optional)
        RAGFLOW_URL: The URL of the RAGFlow API (default: "https://ragflow.ihep.ac.cn/")
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
    RAGFLOW_URL: str = "https://ragflow.ihep.ac.cn"
    RAGFLOW_TOKEN: str = ""
    dataset_ids: list[str]|None = None
    document_ids: list[str]|None = None
    page: int = 1
    page_size: int = 30
    similarity_threshold: float = 0.2
    vector_similarity_weight: float = 0.3
    top_k: int = 1024
    rerank_id: int|None = None
    keyword: bool = False
    highlight: bool = False
    cross_languages: list[str] = []


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
            highlight: bool = False,
            cross_languages: list[str] = [],
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
                "highlight": highlight,
                "cross_languages": cross_languages
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
                response = response.json()
                if "data" in response:
                    data = response["data"]
                else:
                    # Log server message if available to aid debugging
                    logger.warning(f'No data found in response: {response.get("message")}')
                    data = {"chunks": []}
                

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
                highlight=config.highlight,
                cross_languages=config.cross_languages,
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
            rag_flow_url: str,
            rag_flow_token: str
    ):
        self.base_url = rag_flow_url
        self.api_key = rag_flow_token
        self.headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }

    async def list_datasets(self) -> list[dict[str, Any]]:
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(f"{self.base_url}/api/v1/datasets", headers=self.headers)
                return response.json()["data"]
        except:
            return []
    
    async def list_documents(self, dataset_id: str) -> list[dict[str, Any]]:
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(f"{self.base_url}/api/v1/datasets/{dataset_id}/documents", headers=self.headers)
                return response.json()["data"]
        except:
            return []
    
    async def add_files_to_dataset(
            self,
            dataset_id: str,
            files_path: str|List[str],
            ) -> dict[str, Any]:
        """
        Add content to dataset.
        
        Args:
            dataset_id: The ID of the dataset to which the documents will be uploaded.
            files_path: Path to the file(s) to upload. Can be a single path (str) or list of paths (List[str]).
            
        Returns:
            Response from the API.
        """
        url = f"{self.base_url}/api/v1/datasets/{dataset_id}/documents"
        
        headers = {
            "Authorization": f"Bearer {self.api_key}"
        }
        
        # Convert single file path to list
        if isinstance(files_path, str):
            files_path = [files_path]
            
        # Prepare files for upload
        files = []
        opened_files = []
        try:
            # Open all files
            for file_path in files_path:
                abs_file_path = os.path.abspath(file_path)
                file_handle = open(abs_file_path, 'rb')
                opened_files.append(file_handle)
                files.append(('file', (os.path.basename(abs_file_path), file_handle, 'application/octet-stream')))
            
            # Upload all files in a single request
            async with httpx.AsyncClient() as client:
                response = await client.post(url, headers=headers, files=files)
                response.raise_for_status()
                return response.json()
        except Exception as e:
            print(f"Error uploading file(s) to dataset: {str(e)}")
            return {"error": str(e)}
        finally:
            # Close all opened files
            for file_handle in opened_files:
                try:
                    file_handle.close()
                except:
                    pass
    
    async def parse_files(self, dataset_id: str, document_ids: List[str]):
        """
        Parse documents in a specified dataset.
        
        Args:
            dataset_id: The dataset ID.
            document_ids: The IDs of the documents to parse.
            
        Returns:
            Response from the API.
        """
        url = f"{self.base_url}/api/v1/datasets/{dataset_id}/chunks"
        
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    url, 
                    headers=self.headers, 
                    json={"document_ids": document_ids}
                )
                response.raise_for_status()
                return response.json()
        except Exception as e:
            print(f"Error parsing files: {str(e)}")
            return {"error": str(e)}
    
    async def update_document(
        self,
        dataset_id: str,
        document_id: str,
        name: str = None,
        meta_fields: Dict[str, Any] = None,
        chunk_method: str = None,
        parser_config: Dict[str, Any] = None
    ) -> dict[str, Any]:
        """
        Update configurations for a specified document.
        
        Args:
            dataset_id: (Path parameter)
                The ID of the associated dataset.
            document_id: (Path parameter)
                The ID of the document to update.
            "name": (Body parameter), string name of the document
            "meta_fields": (Body parameter), dict[str, Any] The meta fields of the document.
            "chunk_method": (Body parameter), string
                The parsing method to apply to the document:
                "naive": General
                "manual: Manual
                "qa": Q&A
                "table": Table
                "paper": Paper
                "book": Book
                "laws": Laws
                "presentation": Presentation
                "picture": Picture
                "one": One
                "email": Email
            "parser_config": (Body parameter), object
                The configuration settings for the dataset parser. The attributes in this JSON object vary with the selected "chunk_method":
                If "chunk_method" is "naive", the "parser_config" object contains the following attributes:
                    "chunk_token_num": Defaults to 256.
                    "layout_recognize": Defaults to true.
                    "html4excel": Indicates whether to convert Excel documents into HTML format. Defaults to false.
                    "delimiter": Defaults to "\n".
                    "task_page_size": Defaults to 12. For PDF only.
                    "raptor": RAPTOR-specific settings. Defaults to: {"use_raptor": false}.
                If "chunk_method" is "qa", "manuel", "paper", "book", "laws", or "presentation", the "parser_config" object contains the following attribute:
                    "raptor": RAPTOR-specific settings. Defaults to: {"use_raptor": false}.
                If "chunk_method" is "table", "picture", "one", or "email", "parser_config" is an empty JSON object.
            
        Returns:
            Response from the API.
        """
        url = f"{self.base_url}/api/v1/datasets/{dataset_id}/documents/{document_id}"
        
        # Prepare request body
        body = {}
        if name is not None:
            body["name"] = name
        if meta_fields is not None:
            body["meta_fields"] = meta_fields
        if chunk_method is not None:
            body["chunk_method"] = chunk_method
        if parser_config is not None:
            body["parser_config"] = parser_config
        
        try:
            async with httpx.AsyncClient() as client:
                response = await client.put(
                    url,
                    headers=self.headers,
                    json=body
                )
                response.raise_for_status()
                return response.json()
        except Exception as e:
            print(f"Error updating document: {str(e)}")
            return {"error": str(e)}

    async def add_files_to_dataset_and_parse(
            self,
            dataset_id: str,
            files_path: str|List[str],
            ) -> dict[str, Any]:
        """
        add files to dataset and parse
        Args:
            dataset_id: The ID of the dataset to which the documents will be uploaded.
            files_path: Path to the file(s) to upload. Can be a single path (str) or list of paths (List[str]).
            
        Returns:
            Response from the API.
        """
        result = await self.add_files_to_dataset(dataset_id, files_path)
        if result["code"] != 0:
            raise result["message"]
        document_ids = [datai["id"] for datai in result["data"]]
        return await self.parse_files(dataset_id, document_ids)
    
    async def add_chunks_to_dataset(
            self,
            dataset_id: str,
            document_id: str,
            content: str,
            important_keywords: List[str] = None,
            questions: List[str] = None
            ) -> dict[str, Any]:
        """
        Adds a chunk to a specified document in a specified dataset.
        
        Args:
            dataset_id: The associated dataset ID.
            document_id: The associated document ID.
            content: The text content of the chunk.
            important_keywords: The key terms or phrases to tag with the chunk.
            questions: If there is a given question, the embedded chunks will be based on them.
            
        Returns:
            Response from the API.
        """
        url = f"{self.base_url}/api/v1/datasets/{dataset_id}/documents/{document_id}/chunks"
        
        # Prepare request body
        body = {
            "content": content
        }
        
        if important_keywords is not None:
            body["important_keywords"] = important_keywords
            
        if questions is not None:
            body["questions"] = questions
        
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    url, 
                    headers=self.headers, 
                    json=body
                )
                response.raise_for_status()
                return response.json()
        except Exception as e:
            print(f"Error adding chunks to dataset: {str(e)}")
            return {"error": str(e)}
    
    async def retrieve_chunks_by_content(
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
            highlight: bool 
            cross_languages: list[str]
            rerank_id: int
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
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{self.base_url}/api/v1/retrieval", 
                    headers=self.headers,
                    json=params
                )
            return response.json()["data"]
        except:
            return {}
if __name__ == "__main__":

    import json
    import asyncio

    base_url = "https://ragflow.ihep.ac.cn"
    api_key = "ragflow-I1OWE2N2U0NTE5ODExZjA5NzgyMDI0Mm" 
    ragflow_memory = RAGFlowMemoryManager(base_url, api_key)

    # list the datasets
    # datasets = asyncio.run(ragflow_memory.list_datasets())
    # print(json.dumps(datasets, indent=4, ensure_ascii=False))

    # list the documents
    # documents = asyncio.run(ragflow_memory.list_documents("70722df8519011f08a170242ac120006"))
    # print(json.dumps(documents, indent=4, ensure_ascii=False))

    # search content from datasets
    # result = asyncio.run(ragflow_memory.retrieve_chunks_by_content(
    #     question="北京出差的报销标准",
    #     dataset_ids=["70722df8519011f08a170242ac120006"]
    # ))
    # print(json.dumps(result, indent=4, ensure_ascii=False))

    # add files to dataset
    # file_path = "/home/xiongdb/drsai/README.md"
    # result = asyncio.run(ragflow_memory.add_files_to_dataset(
    #     dataset_id="70722df8519011f08a170242ac120006",
    #     files_path=file_path
    # ))
    # print(json.dumps(result, indent=4, ensure_ascii=False))

    # parse files
    # result = asyncio.run(ragflow_memory.parse_files(
    #     dataset_id="70722df8519011f08a170242ac120006",
    #     document_ids=["424b7bb8c8e711f091ce0242ac120006"]
    # ))
    # print(json.dumps(result, indent=4, ensure_ascii=False))
    
    # add chunks to dataset
    # dataset_id="70722df8519011f08a170242ac120006"
    # document_id="424b7bb8c8e711f091ce0242ac120006"
    # result = asyncio.run(ragflow_memory.add_chunks_to_dataset(
    #     dataset_id=dataset_id,
    #     document_id=document_id,
    #     content="opendrsai常用于专业科学智能体开发",
    #     important_keywords=["Opendrsai"],
    #     questions=["opendrsai常用于做什么"]
    # ))
    # print(json.dumps(result, indent=4, ensure_ascii=False))