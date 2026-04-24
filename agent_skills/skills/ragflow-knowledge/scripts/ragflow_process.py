from drsai.modules.components.memory.ragflow_memory import RAGFlowMemoryManager
import os, asyncio, json
from typing import Any
from dotenv import load_dotenv
load_dotenv()

RAGFLOW_URL = os.getenv('RAGFLOW_URL')
RAGFLOW_TOKEN = os.getenv('RAGFLOW_TOKEN')

manager = RAGFlowMemoryManager(
    rag_flow_url=RAGFLOW_URL,
    rag_flow_token=RAGFLOW_TOKEN
)

async def upload_documents(
    dataset_id: str,
    files_path: str|list[str],
) -> None:
    document_ids = await manager.add_files_to_dataset_and_parse(
        dataset_id = dataset_id,
        files_path = files_path,
    )
    print(f"The following documents have been uploaded: {document_ids}")

async def update_document_matadata(
    dataset_id: str,
    document_id: str,
    meta_fields: dict[str, Any]
) -> None:
    await manager.update_document(
        dataset_id = dataset_id,
        document_id = document_id,
        meta_fields = meta_fields
    )
    print(f"The document metadata has been updated.")

async def add_chunks_to_document(
    dataset_id: str,
    document_id: str,
    content: str,
    important_keywords: list[str] = None,
    questions: list[str] = None
) -> None:
    
    await manager.add_chunks_to_dataset(
        dataset_id = dataset_id,
        document_id = document_id,
        content = content,
        important_keywords = important_keywords,
        questions = questions
    )
    print(f"The chunk have been added to the document.")

async def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(description="RAGFlow management CLI")
    subparsers = parser.add_subparsers(dest="command", required=True)

    # upload_documents
    p_upload = subparsers.add_parser("upload", help="Upload documents to a dataset")
    p_upload.add_argument("--dataset-id", required=True, help="Dataset ID")
    p_upload.add_argument("--files", required=True, nargs="+", help="File path(s) to upload")

    # update_document_metadata
    p_update = subparsers.add_parser("update-meta", help="Update document metadata")
    p_update.add_argument("--dataset-id", required=True, help="Dataset ID")
    p_update.add_argument("--document-id", required=True, help="Document ID")
    p_update.add_argument("--meta", required=True, help="Metadata as JSON string, e.g. '{\"key\": \"value\"}'")

    # add_chunks_to_document
    p_chunk = subparsers.add_parser("add-chunk", help="Add a chunk to a document")
    p_chunk.add_argument("--dataset-id", required=True, help="Dataset ID")
    p_chunk.add_argument("--document-id", required=True, help="Document ID")
    p_chunk.add_argument("--content", required=True, help="Chunk text content")
    p_chunk.add_argument("--keywords", nargs="+", default=None, help="Important keywords (optional)")
    p_chunk.add_argument("--questions", nargs="+", default=None, help="Related questions (optional)")

    args = parser.parse_args()

    if args.command == "upload":
        files = args.files if len(args.files) > 1 else args.files[0]
        await upload_documents(args.dataset_id, files)

    elif args.command == "update-meta":
        meta_fields = json.loads(args.meta)
        await update_document_matadata(args.dataset_id, args.document_id, meta_fields)

    elif args.command == "add-chunk":
        await add_chunks_to_document(
            args.dataset_id,
            args.document_id,
            args.content,
            important_keywords=args.keywords,
            questions=args.questions,
        )

if __name__ == "__main__":
    asyncio.run(main())
