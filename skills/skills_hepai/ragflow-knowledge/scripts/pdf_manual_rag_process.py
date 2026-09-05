from drsai.modules.components.memory.ragflow_memory import RAGFlowMemoryManager
import os, asyncio, json
from pathlib import Path
from typing import List, Dict, Any
from loguru import logger
from dotenv import load_dotenv
load_dotenv()

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

class ManualRAGUploader:
    """
    上传和检索单个PDF手册的工具类
    """
    def __init__(
        self,
        rag_flow_url: str,
        rag_flow_token: str,
        dataset_id: str,
        index_json_flie: str,
        markdown_dir: str,
        document_id: str = None,
        common_keywords: List[str] = []
    ):
        self.manager = RAGFlowMemoryManager(
            rag_flow_url=rag_flow_url,
            rag_flow_token=rag_flow_token
        )
        self.dataset_id = dataset_id
        self.document_id = document_id
        self.index_json_flie = Path(index_json_flie)
        self.base_dir = Path(markdown_dir)
        self.common_keywords = common_keywords

    def load_spec_index(self) -> List[Dict[str, Any]]:
        """加载spec_man_index.json文件"""
        with open(self.index_json_flie, 'r', encoding='utf-8') as f:
            return json.load(f)

    def load_markdown_content(self, markdown_files: List[str]) -> str:
        """加载markdown文件内容"""
        content = []
        for md_file in markdown_files:
            md_path = self.base_dir / md_file
            if md_path.exists():
                with open(md_path, 'r', encoding='utf-8') as f:
                    content.append(f.read())
            else:
                # print(f"Warning: Markdown file not found: {md_file}")
                logger.warning(f"Warning: Markdown file not found: {md_file}")
        return "\n".join(content)

    def build_hierarchy_path(self, entry: Dict[str, Any], all_entries: List[Dict[str, Any]]) -> str:
        """构建层级路径，如: USER MANUAL > Introduction > Starting Up"""
        path = [entry['title']]
        current_parent = entry.get('parent_title')

        # 向上追溯父节点
        while current_parent:
            for e in all_entries:
                if e['title'] == current_parent:
                    path.insert(0, e['title'])
                    current_parent = e.get('parent_title')
                    break
            else:
                break

        return " > ".join(path)

    def extract_keywords(self, entry: Dict[str, Any]) -> List[str]:
        """从标题和摘要中提取关键词"""
        keywords = []
        title = entry['title'].lower()

        # 常见的命令和概念关键词
        

        for keyword in self.common_keywords:
            if keyword in title:
                keywords.append(keyword)

        return keywords

    def build_chunk_content(self, entry: Dict[str, Any], hierarchy_path: str, markdown_content: str = None) -> str:
        """构建要上传的chunk内容"""
        content_parts = [
            f"# {entry['title']} (Level {entry['level']})",
            f"\n**层级路径**: {hierarchy_path}",
            f"\n**页码范围**: {entry['page_range'][0]}-{entry['page_range'][1]}",
        ]

        # 添加摘要
        if entry.get('summary'):
            content_parts.append(f"\n## 内容摘要\n{entry['summary']}")

        # 添加详细内容（如果提供了markdown内容）
        if markdown_content:
            content_parts.append(f"\n## 详细内容\n{markdown_content}")

        return "\n".join(content_parts)

    async def create_document(self, document_name: str) -> str:
        """
        创建一个新文档用于存放spec手册的chunks
        返回document_id
        """
        # 先创建一个临时文件
        temp_file = self.base_dir / "temp_spec_manual.txt"
        with open(temp_file, 'w', encoding='utf-8') as f:
            f.write(f"SPEC Manual - {document_name}\n")

        try:
            # 上传文件到dataset
            result = await self.manager.add_files_to_dataset(
                dataset_id=self.dataset_id,
                files_path=str(temp_file)
            )

            if result.get("code") == 0 and result.get("data"):
                document_id = result["data"][0]["id"]
                print(f"Document created with ID: {document_id}")

                # 更新文档配置：使用manual chunk方法，避免自动分块
                await self.manager.update_document(
                    dataset_id=self.dataset_id,
                    document_id=document_id,
                    name=document_name,
                    chunk_method="manual"  # 使用手动分块
                )

                return document_id
            else:
                raise Exception(f"Failed to create document: {result}")
        finally:
            # 删除临时文件
            if temp_file.exists():
                temp_file.unlink()

    async def update_document_matadata(self, document_id: str, meta_fields: Dict[str, Any]):
        """更新文档配置"""
        await self.manager.update_document(
            dataset_id=self.dataset_id,
            document_id=document_id,
            meta_fields=meta_fields
        )
    async def upload_entries(
        self,
        upload_detailed_content: bool = False,
        level_filter: List[int] = None,
        document_name: str = None,
    ):
        """
        上传spec手册条目到RAGFlow

        Args:
            document_name: 文档名称
            upload_detailed_content: 是否上传详细的markdown内容（如果为False，只上传摘要）
            level_filter: 只上传指定层级的条目，例如 [1, 2] 只上传1-2级标题
        """
        # 加载索引
        all_entries = self.load_spec_index()
        # print(f"Loaded {len(all_entries)} entries from spec_man_index.json")

        # 创建文档
        if not self.document_id:
            document_id = await self.create_document(document_name)
        else:
            document_id = self.document_id

        # 过滤条目
        entries_to_upload = all_entries
        if level_filter:
            entries_to_upload = [e for e in all_entries if e['level'] in level_filter]
            # print(f"Filtered to {len(entries_to_upload)} entries with levels {level_filter}")

        # 上传每个条目
        success_count = 0
        error_count = 0

        for i, entry in enumerate(entries_to_upload, 1):
            try:
                # 构建层级路径
                hierarchy_path = self.build_hierarchy_path(entry, all_entries)

                # 加载markdown内容（如果需要）
                markdown_content = None
                if upload_detailed_content and entry.get('markdown_files'):
                    markdown_content = self.load_markdown_content(entry['markdown_files'])

                # 构建chunk内容
                content = self.build_chunk_content(entry, hierarchy_path, markdown_content)

                # 提取关键词
                if self.common_keywords:
                    keywords = self.extract_keywords(entry)
                else:
                    keywords = []

                # 上传chunk
                keywords.append(f"title:{entry['title']}")
                result = await self.manager.add_chunks_to_dataset(
                    dataset_id=self.dataset_id,
                    document_id=document_id,
                    content=content,
                    important_keywords=keywords if keywords else None
                )

                if result.get("code") == 0:
                    success_count += 1
                    print(f"[{i}/{len(entries_to_upload)}] ✓ Uploaded: {entry['title']} (Level {entry['level']})")
                else:
                    error_count += 1
                    print(f"[{i}/{len(entries_to_upload)}] ✗ Failed: {entry['title']} - {result}")

                # 避免请求过快
                if i % 10 == 0:
                    await asyncio.sleep(0.5)

            except Exception as e:
                error_count += 1
                print(f"[{i}/{len(entries_to_upload)}] ✗ Error uploading {entry['title']}: {str(e)}")

        print(f"\n=== Upload Summary ===")
        print(f"Total: {len(entries_to_upload)}")
        print(f"Success: {success_count}")
        print(f"Failed: {error_count}")
        print(f"Document ID: {document_id}")

        return document_id

    async def simple_search(
        self,
        question: str,
        page_size: int = 10,
        similarity_threshold: float = 0.2,
        vector_similarity_weight: float = 0.3,
        top_k: int = 1024,
        rerank_id: str = "hepai/bge-reranker-v2-m3___OpenAI-API@OpenAI-API-Compatible",
        keyword: bool = True,
        cross_languages: list[str] = ["English", "Chinese"],
    ) -> List[Dict[str, Any]]:
        """
        简单的检索功能

        Args:
            question: 用户问题
            top_k: 返回top k个结果
            similarity_threshold: 相似度阈值

        Returns:
            检索结果列表
        """
        result = await self.manager.retrieve_chunks_by_content(
            question=question,
            page_size=page_size,
            dataset_ids=[self.dataset_id],
            document_ids=[self.document_id],
            similarity_threshold=similarity_threshold,
            vector_similarity_weight=vector_similarity_weight,
            top_k = top_k,
            rerank_id=rerank_id,
            keyword=keyword,
            cross_languages = cross_languages
        )

        if result and "chunks" in result:
            return result["chunks"]
        return []

    def print_search_results(self, results: List[Dict[str, Any]]):
        """格式化打印检索结果"""
        if not results:
            print("No results found.")
            return

        print(f"\n=== Found {len(results)} results ===\n")
        for i, chunk in enumerate(results, 1):
            print(f"--- Result {i} ---")
            print(f"Similarity: {chunk.get('similarity', 'N/A')}")
            print(f"Content preview:")
            content = chunk.get('content', '')
            # 打印前500个字符
            print(content[:500] + "..." if len(content) > 500 else content)
            print()

def parse_args():
    import argparse
    parser = argparse.ArgumentParser(description='PDF Manual RAG Process Tool')
    parser.add_argument('--dataset-id', required=True, help='RAGFlow dataset ID')
    parser.add_argument('--document-id', required=True, help='RAGFlow document ID')
    parser.add_argument('--index-json', required=True, help='Path to index JSON file')
    parser.add_argument('--markdown-dir', required=True, help='Path to markdown directory')

    subparsers = parser.add_subparsers(dest='command', required=True)

    # step1: upload entries
    upload_parser = subparsers.add_parser('upload', help='Step 1: Upload entries to RAGFlow')
    upload_parser.add_argument('--detailed', action='store_true', help='Upload detailed markdown content (default: summary only)')

    # step2: update metadata
    meta_parser = subparsers.add_parser('update-meta', help='Step 2: Update document metadata')
    meta_parser.add_argument('--meta-fields', type=str, default=None,
                             help='Metadata fields as JSON string, e.g. \'{"file_name": "my-doc"}\'')

    # step3: search
    search_parser = subparsers.add_parser('search', help='Step 3: Retrieve chunks by question')
    search_parser.add_argument('--question', required=True, help='Search question')
    search_parser.add_argument('--page-size', type=int, default=10, help='Number of results to return (default: 10)')
    search_parser.add_argument('--similarity', type=float, default=0.5, help='Similarity threshold (default: 0.5)')

    return parser.parse_args()


async def main():
    args = parse_args()

    RAGFLOW_URL = os.getenv('RAGFLOW_URL')
    RAGFLOW_TOKEN = os.getenv('RAGFLOW_TOKEN')

    uploader = ManualRAGUploader(
        rag_flow_url=RAGFLOW_URL,
        rag_flow_token=RAGFLOW_TOKEN,
        dataset_id=args.dataset_id,
        index_json_flie=args.index_json,
        markdown_dir=args.markdown_dir,
        document_id=args.document_id,
    )

    if args.command == 'upload':
        await uploader.upload_entries(upload_detailed_content=args.detailed)

    elif args.command == 'update-meta':
        if args.meta_fields:
            meta_fields = json.loads(args.meta_fields)
        else:
            meta_fields = {
                "file_name": "opendrsai-docs",
                "markdown_dir": args.markdown_dir,
                "file_prefix": "opendrsai-manual-0",
                "index_json_file": args.index_json,
            }
        await uploader.update_document_matadata(document_id=args.document_id, meta_fields=meta_fields)

    elif args.command == 'search':
        result = await uploader.simple_search(
            question=args.question,
            page_size=args.page_size,
            similarity_threshold=args.similarity,
        )
        uploader.print_search_results(result)


if __name__ == "__main__":
    asyncio.run(main())

