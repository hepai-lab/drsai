import os
import json
import asyncio
from pathlib import Path
from typing import List, Dict, Any, Optional
from loguru import logger
from dotenv import load_dotenv
from drsai.modules.components.memory.ragflow_memory import RAGFlowMemoryManager

load_dotenv()


class PDFManualSearcher:
    """
    基于RAGFlow检索PDF手册内容，并定位对应的Markdown文件路径。

    依赖约定：
    - chunk 上传时在 important_keywords 中包含 'title:{entry_title}' 格式的标识
    - document 的 meta_fields 中存有 'index_json_file' 和 'markdown_dir' 字段
    """

    def __init__(
        self,
        rag_flow_url: str,
        rag_flow_token: str,
        dataset_id: str,
    ):
        self.manager = RAGFlowMemoryManager(
            rag_flow_url=rag_flow_url,
            rag_flow_token=rag_flow_token,
        )
        self.dataset_id = dataset_id
        # document_id -> meta_fields dict
        self._doc_meta_cache: Dict[str, Dict[str, Any]] = {}
        self._doc_meta_loaded: bool = False
        # index_json_file_path -> {title: entry}
        self._index_cache: Dict[str, Dict[str, Dict]] = {}

    async def _load_doc_meta_cache(self):
        """从 RAGFlow 加载数据集内所有文档的 metadata，缓存到 _doc_meta_cache。"""
        if self._doc_meta_loaded:
            return
        documents = await self.manager.list_documents(self.dataset_id)
        for doc in documents:
            doc_id = doc.get('id') or doc.get('document_id')
            meta = doc.get('meta_fields') or {}
            if doc_id:
                self._doc_meta_cache[doc_id] = meta
        self._doc_meta_loaded = True

    async def _get_doc_meta(self, document_id: str) -> Dict[str, Any]:
        """获取指定 document_id 的 meta_fields。"""
        await self._load_doc_meta_cache()
        return self._doc_meta_cache.get(document_id, {})

    def _load_index(self, index_json_file: str) -> Dict[str, Dict]:
        """
        加载 index JSON 文件，返回 {title: entry} 映射，结果被缓存。
        """
        if index_json_file not in self._index_cache:
            with open(index_json_file, 'r', encoding='utf-8') as f:
                entries = json.load(f)
            self._index_cache[index_json_file] = {e['title']: e for e in entries}
        return self._index_cache[index_json_file]

    def _extract_title(self, chunk: Dict[str, Any]) -> Optional[str]:
        """从 important_keywords 中提取 'title:...' 格式的标题。"""
        for kw in chunk.get('important_keywords', []):
            if isinstance(kw, str) and kw.startswith('title:'):
                return kw[6:]
        return None

    async def _enrich_chunk(self, chunk: Dict[str, Any]) -> Dict[str, Any]:
        """
        为 chunk 补充 title、markdown_files（完整路径）和 index_entry。
        在原始 chunk 字段基础上追加，不覆盖已有字段。
        """
        result = dict(chunk)
        result['title'] = None
        result['markdown_files'] = []
        result['index_entry'] = None

        title = self._extract_title(chunk)
        if not title:
            logger.debug(f"Chunk {chunk.get('id')} has no 'title:' keyword")
            return result

        result['title'] = title

        document_id = chunk.get('document_id')
        meta = await self._get_doc_meta(document_id)

        index_json_file = meta.get('index_json_file')
        markdown_dir = meta.get('markdown_dir')

        if not index_json_file or not markdown_dir:
            logger.warning(
                f"Document {document_id} meta_fields missing 'index_json_file' or 'markdown_dir'. "
                f"Got: {meta}"
            )
            return result

        try:
            index_by_title = self._load_index(index_json_file)
        except FileNotFoundError:
            logger.error(f"Index file not found: {index_json_file}")
            return result

        entry = index_by_title.get(title)
        if not entry:
            logger.warning(f"Title '{title}' not found in index: {index_json_file}")
            return result

        result['index_entry'] = entry
        md_dir = Path(markdown_dir)
        result['markdown_files'] = [
            str(md_dir / f) for f in entry.get('markdown_files', [])
        ]
        return result

    async def search(
        self,
        question: str,
        page_size: int = 10,
        similarity_threshold: float = 0.2,
        vector_similarity_weight: float = 0.3,
        top_k: int = 1024,
        rerank_id: str = "hepai/bge-reranker-v2-m3___OpenAI-API@OpenAI-API-Compatible",
        keyword: bool = True,
        cross_languages: List[str] = None,
        document_ids: List[str] = None,
    ) -> List[Dict[str, Any]]:
        """
        检索用户问题，返回包含 markdown_files 路径的增强结果列表。

        Args:
            question:                 用户问题
            page_size:                返回结果数量
            similarity_threshold:     相似度阈值
            vector_similarity_weight: 向量相似度权重
            top_k:                    候选 chunk 数量
            rerank_id:                rerank 模型 ID
            keyword:                  是否启用关键词匹配
            cross_languages:          跨语言检索列表，默认 ["English", "Chinese"]
            document_ids:             限定检索的 document_id 列表，None 表示检索整个 dataset

        Returns:
            增强后的 chunk 列表，每个 chunk 在原有字段基础上额外包含：
            - 'title':         str | None，条目标题
            - 'markdown_files': List[str]，对应 markdown 文件的完整路径列表
            - 'index_entry':   Dict | None，index JSON 中的完整条目（含 summary、page_range 等）
        """
        if cross_languages is None:
            cross_languages = ["English", "Chinese"]

        kwargs: Dict[str, Any] = dict(
            question=question,
            dataset_ids=[self.dataset_id],
            document_ids=document_ids or [],
            similarity_threshold=similarity_threshold,
            vector_similarity_weight=vector_similarity_weight,
            page_size=page_size,
            top_k=top_k,
            rerank_id=rerank_id,
            keyword=keyword,
            cross_languages=cross_languages,
        )
        
        raw = await self.manager.retrieve_chunks_by_content(**kwargs)
        chunks = raw.get('chunks', []) if raw else []

        enriched = []
        for chunk in chunks:
            enriched.append(await self._enrich_chunk(chunk))
        return enriched

    def format_results(
            self, 
            results: List[Dict[str, Any]],
            is_detailed: bool = False
            ) -> str:
        """格式化检索结果为可读字符串，包含 markdown 文件路径信息。"""
        if not results:
            return "No results found."

        lines = [f"=== Found {len(results)} results ===\n"]
        for i, chunk in enumerate(results, 1):
            lines.append(f"--- Result {i} ---")
            lines.append(f"Title:      {chunk.get('title') or 'N/A'}")
            lines.append(f"Similarity: {chunk.get('similarity', 0):.4f}")

            entry = chunk.get('index_entry')
            if entry:
                lines.append(f"Page range: {entry.get('page_range')}")

            md_files = chunk.get('markdown_files', [])
            if md_files:
                lines.append(f"Markdown files ({len(md_files)}):")
                for f in md_files:
                    lines.append(f"  {f}")
            else:
                lines.append("Markdown files: (not resolved)")

            content = chunk.get('content', '')
            lines.append("Content preview:")
            if is_detailed:
                lines.append(content)
            else:
                lines.append(content[:300] + "..." if len(content) > 300 else content)
            lines.append("")

        return "\n".join(lines)


async def main():
    RAGFLOW_URL = os.getenv('RAGFLOW_URL')
    RAGFLOW_TOKEN = os.getenv('RAGFLOW_TOKEN')
    DATASET_ID = "df102048145511f1b1ff0242ac120006"

    searcher = PDFManualSearcher(
        rag_flow_url=RAGFLOW_URL,
        rag_flow_token=RAGFLOW_TOKEN,
        dataset_id=DATASET_ID,
    )

    results = await searcher.search(
        question="What is the purpose of the scan command?",
        page_size=10,
        similarity_threshold=0.2,
    )
    print(searcher.format_results(results))


if __name__ == "__main__":
    asyncio.run(main())