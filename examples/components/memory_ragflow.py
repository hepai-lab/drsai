import os
import httpx
from dotenv import load_dotenv
load_dotenv()

import asyncio

RAGFLOW_URL = os.getenv('RAGFLOW_URL')
RAGFLOW_TOKEN = os.getenv('RAGFLOW_TOKEN')

async def list_ragflow_datasets(
    page: int = 1,
    page_size: int = 10,
    orderby: str = "create_time",
    desc: bool = True,
    name: str = None,
    dataset_id: str = None
):
    """
    List all available RAGFlow datasets.

    Args:
        page: Page number (default: 1)
        page_size: Number of items per page (default: 10)
        orderby: Field to order by (default: "create_time")
        desc: Sort in descending order (default: True)
        name: Filter by dataset name (optional)
        dataset_id: Filter by dataset ID (optional)

    Returns:
        JSON response containing the list of datasets
    """
    url = f"{RAGFLOW_URL}/api/v1/datasets"

    # Build query parameters
    params = {
        "page": page,
        "page_size": page_size,
        "orderby": orderby,
        "desc": desc
    }

    # Add optional parameters if provided
    if name:
        params["name"] = name
    if dataset_id:
        params["id"] = dataset_id

    # Set up headers with authorization token
    headers = {
        "Authorization": f"Bearer {RAGFLOW_TOKEN}"
    }

    # Make the async HTTP request
    async with httpx.AsyncClient() as client:
        response = await client.get(url, params=params, headers=headers)
        response.raise_for_status()
        data = response.json()["data"]
    
    return data

async def list_ragflow_chats(
    page: int = 1,
    page_size: int = 10,
    orderby: str = "create_time",
    desc: bool = True,
    name: str = None,
    chat_id: str = None
):
    """
    List all available RAGFlow chats.

    Args:
        page: Page number (default: 1)
        page_size: Number of items per page (default: 10)
        orderby: Field to order by (default: "create_time")
        desc: Sort in descending order (default: True)
        name: Filter by chat name (optional)
        chat_id: Filter by chat ID (optional)

    Returns:
        JSON response containing the list of chats
    """
    url = f"{RAGFLOW_URL}/api/v1/chats"

    # Build query parameters
    params = {
        "page": page,
        "page_size": page_size,
        "orderby": orderby,
        "desc": desc
    }

    # Add optional parameters if provided
    if name:
        params["name"] = name
    if chat_id:
        params["id"] = chat_id

    # Set up headers with authorization token
    headers = {
        "Authorization": f"Bearer {RAGFLOW_TOKEN}"
    }

    # Make the async HTTP request
    async with httpx.AsyncClient() as client:
        response = await client.get(url, params=params, headers=headers)
        response.raise_for_status()
        data = response.json()["data"]

    return data

async def get_document_chunks(
    dataset_id: str,
    document_id: str,
    keywords: str = None,
    page: int = 1,
    page_size: int = 10,
    chunk_id: str = None
):
    """
    Get chunks from a specific document in a RAGFlow dataset.

    Args:
        dataset_id: The ID of the dataset (required)
        document_id: The ID of the document (required)
        keywords: Keywords to filter chunks (optional)
        page: Page number (default: 1)
        page_size: Number of items per page (default: 10)
        chunk_id: Filter by specific chunk ID (optional)

    Returns:
        JSON response containing the list of document chunks
    """
    url = f"{RAGFLOW_URL}/api/v1/datasets/{dataset_id}/documents/{document_id}/chunks"

    # Build query parameters
    params = {
        "page": page,
        "page_size": page_size
    }

    # Add optional parameters if provided
    if keywords:
        params["keywords"] = keywords
    if chunk_id:
        params["id"] = chunk_id

    # Set up headers with authorization token
    headers = {
        "Authorization": f"Bearer {RAGFLOW_TOKEN}"
    }

    # Make the async HTTP request
    async with httpx.AsyncClient() as client:
        response = await client.get(url, params=params, headers=headers)
        response.raise_for_status()
        data = response.json()["data"]

    return data

async def retrieve_chunks(
    question: str,
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

if __name__ == "__main__":
    # 查询 dataset_id: 28e3ad8499b311f0a65d0242ac120006，问题是"BOSS8 使用的C++版本"
    chunks = asyncio.run(retrieve_chunks(
        question="BOSS8 使用的C++版本",
        dataset_ids=["28e3ad8499b311f0a65d0242ac120006"],
        page=1,
        page_size=10,
        similarity_threshold=0.2,
        vector_similarity_weight=0.3,
        keyword=True,
    ))

    for chunk in chunks["chunks"]:
        print(chunk)
    