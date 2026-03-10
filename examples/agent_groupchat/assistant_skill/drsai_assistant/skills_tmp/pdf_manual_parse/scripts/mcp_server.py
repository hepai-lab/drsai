import os
from pdf_manual_search import PDFManualSearcher

async def pdf_manual_search(
        question: str,
        max_items: int = 5,
        similarity_threshold: float = 0.2,
) -> str:
    """
    该函数通过匹配输入问题相近的文档目录及其对应的文件markdown文件位置，帮助进行下一步文档的仔细阅读
    Arguments:
        question: The question to search for.
        max_items: The maximum number of items to return.
        similarity_threshold: The similarity threshold for filtering results.
    """
    RAGFLOW_URL = os.getenv('RAGFLOW_URL')
    RAGFLOW_TOKEN = os.getenv('RAGFLOW_TOKEN')
    DATASET_ID = os.getenv("RAGFLOW_DATASET_ID")

    searcher = PDFManualSearcher(
        rag_flow_url=RAGFLOW_URL,
        rag_flow_token=RAGFLOW_TOKEN,
        dataset_id=DATASET_ID,
    )

    results = await searcher.search(
        question=question,
        page_size=max_items,
        similarity_threshold=similarity_threshold,
        document_ids=["da82759e184c11f198850242ac120006"]
    )
    
    return searcher.format_results(results, is_detailed=True)
