"""
PDF文档内容清洗编排流程
用于将目录结构与分页markdown文件关联，并生成带摘要的索引JSON
"""

from openai import OpenAI
import os
import json
import re
from typing import List, Optional
from dataclasses import dataclass


@dataclass
class TocItem:
    """目录项数据结构"""
    title: str
    level: int  # 1对应#，2对应##，3对应###
    page_in_toc: int  # 目录中标注的页数
    page_range: List[int]  # 实际页数范围 [start, end]
    markdown_files: List[str]  # 对应的markdown文件列表
    parent_title: Optional[str]  # 父标题
    children_titles: List[str]  # 子标题列表
    summary: str = ""  # 内容摘要


def get_openai_create_response(
        client: OpenAI,
        messages: list[dict],
        model: str = "deepseek-ai/deepseek-v3.2",
        stream: bool = False,
) -> str:
    """获取OpenAI API的文本回复"""
    response = client.chat.completions.create(
        model=model,
        messages=messages,
        stream=stream
    )

    if stream:
        full_response = ""
        for chunk in response:
            if chunk.choices and chunk.choices[0].delta.content:
                content = chunk.choices[0].delta.content
                print(content, end="", flush=True)
                full_response += content
        print()
        return full_response
    else:
        content = response.choices[0].message.content
        return content


def parse_toc_file(toc_file_path: str) -> List[TocItem]:
    """
    解析目录文件，提取标题和页数

    Args:
        toc_file_path: 目录文件路径

    Returns:
        目录项列表
    """
    with open(toc_file_path, 'r', encoding='utf-8') as f:
        lines = f.readlines()

    toc_items = []

    for line in lines:
        line = line.rstrip()
        if not line:
            continue

        # 优先匹配带页码的格式: ### Title 123 或 ## Title 123 或 # Title 123
        match_with_page = re.match(r'^(#{1,3})\s+(.+?)\s+(\d+)\s*$', line)
        # 其次匹配普通 markdown 标题（无页码）
        match_plain = re.match(r'^(#{1,3})\s+(.+?)\s*$', line)

        if match_with_page:
            level_marks, title, page_str = match_with_page.groups()
            level = len(level_marks)
            page = int(page_str)
        elif match_plain:
            level_marks, title = match_plain.groups()
            level = len(level_marks)
            page = -1
        else:
            continue

        toc_item = TocItem(
            title=title.strip(),
            level=level,
            page_in_toc=page,
            page_range=[],
            markdown_files=[],
            parent_title=None,
            children_titles=[]
        )
        toc_items.append(toc_item)

    return toc_items


def build_hierarchy(toc_items: List[TocItem]) -> List[TocItem]:
    """
    构建目录的层级关系（父子关系）

    Args:
        toc_items: 目录项列表

    Returns:
        带有层级关系的目录项列表
    """
    for i, item in enumerate(toc_items):
        # 向前查找父标题（level更小的最近标题）
        for j in range(i - 1, -1, -1):
            if toc_items[j].level < item.level:
                item.parent_title = toc_items[j].title
                toc_items[j].children_titles.append(item.title)
                break

    return toc_items


def calculate_page_ranges(
        toc_items: List[TocItem],
        redundancy_page: int = 1
        ) -> List[TocItem]:
    """
    计算每个标题的页面范围

    规则：
    - 起始页为目录中标注的页数
    - 结束页为下一个同级或更高级标题的页数（+1冗余页）
    - 如果是最后一项，需要用户指定或默认到最后

    Args:
        toc_items: 目录项列表

    Returns:
        带有页面范围的目录项列表
    """
    for i, item in enumerate(toc_items):
        start_page = item.page_in_toc

        # 查找下一个同级或更高级标题
        end_page = None
        for j in range(i + redundancy_page, len(toc_items)):
            if toc_items[j].level <= item.level:
                # +1 冗余页（因为内容可能跨页）
                end_page = toc_items[j].page_in_toc
                break

        # 如果没找到，说明是最后一个同级标题，暂时设为起始页
        if end_page is None:
            # 这里可以设置一个较大的值，或在实际使用时指定
            end_page = start_page

        item.page_range = [start_page, end_page]

    return toc_items


def map_to_markdown_files(
    toc_items: List[TocItem],
    markdown_dir: str,
    file_prefix: str,
    page_offset: int
) -> List[TocItem]:
    """
    将页面范围映射到实际的markdown文件

    Args:
        toc_items: 目录项列表
        markdown_dir: markdown文件所在目录
        file_prefix: 文件前缀，如 "spec_man__"
        page_offset: 页数偏移量（目录页数 + offset = 实际文件序号）

    Returns:
        带有markdown文件列表的目录项列表
    """
    for item in toc_items:
        start_page, end_page = item.page_range
        markdown_files = []
        if start_page == -1:
            continue
        for page in range(start_page, end_page + 1):
            actual_file_num = page + page_offset
            filename = f"{file_prefix}{actual_file_num}.md"
            filepath = os.path.join(markdown_dir, filename)

            # 检查文件是否存在
            if os.path.exists(filepath):
                markdown_files.append(filename)

        item.markdown_files = markdown_files

    return toc_items


def read_markdown_content(markdown_dir: str, filenames: List[str]) -> str:
    """
    读取多个markdown文件的内容并合并

    Args:
        markdown_dir: markdown文件所在目录
        filenames: 文件名列表

    Returns:
        合并后的内容
    """
    content = []
    for filename in filenames:
        filepath = os.path.join(markdown_dir, filename)
        if os.path.exists(filepath):
            with open(filepath, 'r', encoding='utf-8') as f:
                content.append(f.read())

    return "\n\n".join(content)


def generate_summary_for_leaf(
    client: OpenAI,
    title: str,
    content: str,
    model: str = "deepseek-ai/deepseek-v3.2"
) -> str:
    """
    为叶子节点（最小标题）生成摘要

    Args:
        client: OpenAI客户端
        title: 标题
        content: 内容
        model: 模型名称

    Returns:
        生成的摘要
    """
    prompt = f"""请为以下章节生成一个简洁的摘要（200-300字），概括其主要内容：

章节标题：{title}

章节内容：
{content[:4000]}  # 限制长度避免token超限

要求：
1. 用中文回答
2. 概括该章节的核心内容和关键信息
3. 保持客观简洁
"""

    messages = [
        {"role": "system", "content": "你是一个专业的技术文档摘要助手。"},
        {"role": "user", "content": prompt}
    ]

    summary = get_openai_create_response(client, messages, model=model, stream=False)
    return summary.strip()


def generate_summary_for_parent(
    client: OpenAI,
    title: str,
    children_summaries: List[str],
    model: str = "deepseek-ai/deepseek-v3.2"
) -> str:
    """
    为父节点生成摘要（基于子节点的摘要）

    Args:
        client: OpenAI客户端
        title: 父标题
        children_summaries: 所有子标题的摘要列表
        model: 模型名称

    Returns:
        生成的摘要
    """
    children_text = "\n\n".join([f"- {summary}" for summary in children_summaries])

    prompt = f"""请基于以下子章节的摘要，为父章节生成一个综合摘要（300-400字）：

父章节标题：{title}

子章节摘要：
{children_text}

要求：
1. 用中文回答
2. 综合所有子章节内容，提炼出该大章节的整体框架和核心主题
3. 保持逻辑清晰，层次分明
"""

    messages = [
        {"role": "system", "content": "你是一个专业的技术文档摘要助手。"},
        {"role": "user", "content": prompt}
    ]

    summary = get_openai_create_response(client, messages, model=model, stream=False)
    return summary.strip()


def get_own_content_range(item: TocItem, toc_items: List[TocItem]) -> tuple:
    """
    获取标题自己的内容范围（不包括子标题的内容）

    Args:
        item: 当前标题项
        toc_items: 所有目录项列表

    Returns:
        (start_page, end_page) 自己的内容页面范围
    """
    start_page = item.page_in_toc

    # 如果有子标题，结束页为第一个子标题的起始页（不包括）
    if item.children_titles:
        # 找到第一个子标题的页数
        for toc_item in toc_items:
            if toc_item.title == item.children_titles[0]:
                end_page = toc_item.page_in_toc - 1
                return (start_page, max(start_page, end_page))

    # 如果没有子标题，使用原始的 page_range
    return (item.page_range[0], item.page_range[1])


def generate_summaries(
    client: OpenAI,
    toc_items: List[TocItem],
    markdown_dir: str,
    file_prefix: str,
    page_offset: int,
    model: str = "deepseek-ai/deepseek-v3.2"
) -> List[TocItem]:
    """
    自底向上生成所有标题的摘要

    Args:
        client: OpenAI客户端
        toc_items: 目录项列表
        markdown_dir: markdown文件所在目录
        file_prefix: 文件前缀
        page_offset: 页数偏移量
        model: 模型名称

    Returns:
        带有摘要的目录项列表
    """
    # 创建标题到TocItem的映射
    title_to_item = {item.title: item for item in toc_items}

    # 找出最大层级（叶子节点）
    max_level = max(item.level for item in toc_items)

    # 从最深层级开始，逐层向上生成摘要
    for current_level in range(max_level, 0, -1):
        items_at_level = [item for item in toc_items if item.level == current_level]

        for item in items_at_level:
            print(f"\n正在处理: {item.title} (Level {item.level})")

            if len(item.children_titles) == 0:
                # 叶子节点：读取markdown内容生成摘要
                content = read_markdown_content(markdown_dir, item.markdown_files)
                if content.strip():
                    item.summary = generate_summary_for_leaf(client, item.title, content, model)
                    print(f"  生成叶子节点摘要完成")
                else:
                    item.summary = "（内容为空）"
                    print(f"  内容为空，跳过")
            else:
                # 父节点：需要同时考虑自己的内容和子节点摘要

                # 1. 读取父标题自己的内容（不包括子标题部分）
                own_start, own_end = get_own_content_range(item, toc_items)
                own_markdown_files = []
                for page in range(own_start, own_end + 1):
                    actual_file_num = page + page_offset
                    filename = f"{file_prefix}{actual_file_num}.md"
                    filepath = os.path.join(markdown_dir, filename)
                    if os.path.exists(filepath):
                        own_markdown_files.append(filename)

                own_content = read_markdown_content(markdown_dir, own_markdown_files)

                # 2. 收集子节点摘要
                children_summaries = []
                for child_title in item.children_titles:
                    child_item = title_to_item.get(child_title)
                    if child_item and child_item.summary:
                        children_summaries.append(f"{child_title}: {child_item.summary}")

                # 3. 根据情况生成摘要
                if own_content.strip() and children_summaries:
                    # 既有自己的内容，又有子标题 → 综合生成
                    own_summary = generate_summary_for_leaf(client, item.title + " (概述部分)", own_content, model)
                    all_summaries = [f"[本节概述]: {own_summary}"] + children_summaries
                    item.summary = generate_summary_for_parent(client, item.title, all_summaries, model)
                    print(f"  生成父节点综合摘要完成（包含自身内容 + {len(children_summaries)}个子节点）")

                elif own_content.strip():
                    # 只有自己的内容，没有有效子标题 → 当作叶子节点处理
                    item.summary = generate_summary_for_leaf(client, item.title, own_content, model)
                    print(f"  生成父节点摘要完成（仅包含自身内容）")

                elif children_summaries:
                    # 只有子标题摘要，自己没有内容 → 基于子节点生成
                    item.summary = generate_summary_for_parent(client, item.title, children_summaries, model)
                    print(f"  生成父节点摘要完成（仅基于{len(children_summaries)}个子节点）")

                else:
                    item.summary = "（无有效内容）"
                    print(f"  无有效内容，跳过")

    return toc_items


def export_to_json(toc_items: List[TocItem], output_path: str):
    """
    将目录项列表导出为JSON文件

    Args:
        toc_items: 目录项列表
        output_path: 输出文件路径
    """
    # 转换为字典列表
    data = []
    for item in toc_items:
        item_dict = {
            "title": item.title,
            "level": item.level,
            "page_in_toc": item.page_in_toc,
            "page_range": item.page_range,
            "markdown_files": item.markdown_files,
            "parent_title": item.parent_title,
            "summary": item.summary
        }
        data.append(item_dict)

    # 写入JSON文件
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print(f"\n索引JSON已保存到: {output_path}")


def process_pdf_content(
    toc_file_path: str,
    markdown_dir: str,
    output_json_path: str,
    file_prefix: str = "spec_man__",
    page_offset: int = 10,
    redundancy_page: int = 1,
    model: str = "deepseek-ai/deepseek-v3.2",
    api_key: str = None,
    base_url: str = "https://aiapi.ihep.ac.cn/apiv2"
):
    """
    完整的PDF内容处理流程

    Args:
        toc_file_path: 目录文件路径
        markdown_dir: markdown文件所在目录
        output_json_path: 输出JSON文件路径
        file_prefix: markdown文件前缀
        redundancy_page: 页面冗余页数
        page_offset: 页数偏移量
        model: 使用的模型
        api_key: API密钥
        base_url: API base URL
    """
    print("=== PDF文档内容清洗编排流程 ===\n")

    # 1. 解析目录文件
    print("步骤1: 解析目录文件...")
    toc_items = parse_toc_file(toc_file_path)
    print(f"  解析完成，共 {len(toc_items)} 个标题")

    # 2. 构建层级关系
    print("\n步骤2: 构建层级关系...")
    toc_items = build_hierarchy(toc_items)
    print(f"  层级关系构建完成")

    # 3. 计算页面范围
    print("\n步骤3: 计算页面范围...")
    toc_items = calculate_page_ranges(
        toc_items,
        redundancy_page=redundancy_page,
        )
    print(f"  页面范围计算完成")

    # 4. 映射到markdown文件
    print(f"\n步骤4: 映射到markdown文件（偏移量={page_offset}）...")
    toc_items = map_to_markdown_files(toc_items, markdown_dir, file_prefix, page_offset)
    print(f"  文件映射完成")

    # 5. 生成摘要
    print(f"\n步骤5: 生成摘要（使用模型: {model}）...")
    client = OpenAI(
        api_key=api_key or os.environ.get("HEPAI_API_KEY"),
        base_url=base_url
    )
    toc_items = generate_summaries(client, toc_items, markdown_dir, file_prefix, page_offset, model)
    print(f"  摘要生成完成")

    # 6. 导出JSON
    print("\n步骤6: 导出JSON...")
    export_to_json(toc_items, output_json_path)

    print("\n=== 处理完成！===")


def process_pdf_content_background(
    toc_file_path: str,
    markdown_dir: str,
    output_json_path: str,
    file_prefix: str = "spec_man__",
    page_offset: int = 10,
    redundancy_page: int = 1,
    model: str = "deepseek-ai/deepseek-v3.2",
    base_url: str = "https://aiapi.ihep.ac.cn/apiv2",
    log_file: str = None,
) -> dict:
    """
    将 process_pdf_content 任务投递到后台执行，立即返回。

    Returns:
        dict: {"pid": int, "log_file": str}
    """
    import subprocess

    script_path = os.path.abspath(__file__)
    if log_file is None:
        log_file = os.path.join(os.path.dirname(os.path.abspath(output_json_path)),
                                "pdf_content_process.log")

    cmd = (
        f"nohup python {script_path}"
        f" {toc_file_path}"
        f" {markdown_dir}"
        f" {output_json_path}"
        f" --file-prefix {file_prefix}"
        f" --page-offset {page_offset}"
        f" --redundancy-page {redundancy_page}"
        f" --model {model}"
        f" --base-url {base_url}"
        f" > {log_file} 2>&1 &"
    )
    proc = subprocess.Popen(cmd, shell=True, stdout=subprocess.DEVNULL,
                            stderr=subprocess.DEVNULL)
    proc.wait()

    result = subprocess.run(
        f"pgrep -f '{script_path} {toc_file_path}'",
        shell=True, capture_output=True, text=True
    )
    pid = int(result.stdout.strip().splitlines()[0]) if result.stdout.strip() else None

    print(f"Task started in background.")
    print(f"  PID      : {pid}")
    print(f"  Log file : {log_file}")
    print(f"  Monitor  : tail -f {log_file}")
    print(f"  Stop     : kill {pid}")
    return {"pid": pid, "log_file": log_file}


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(
        description="Process PDF content: parse TOC, map markdown files, generate summaries."
    )
    parser.add_argument("toc_file", help="Path to the TOC markdown file")
    parser.add_argument("markdown_dir", help="Directory containing markdown files")
    parser.add_argument("output_json", help="Output JSON file path")
    parser.add_argument("--file-prefix", default="spec_man__",
                        help="Markdown file prefix (default: spec_man__)")
    parser.add_argument("--page-offset", type=int, default=10,
                        help="Page number offset (default: 10)")
    parser.add_argument("--redundancy-page", type=int, default=1,
                        help="Redundant page number (default: 1)")
    parser.add_argument("--model", default="deepseek-ai/deepseek-v3.2",
                        help="LLM model name")
    parser.add_argument("--base-url", default="https://aiapi.ihep.ac.cn/apiv2",
                        help="API base URL")
    parser.add_argument("--background", "-b", action="store_true",
                        help="Run in background via nohup, return immediately")
    parser.add_argument("--log-file", default=None,
                        help="Log file path (only used with --background)")
    args = parser.parse_args()

    if args.background:
        process_pdf_content_background(
            toc_file_path=args.toc_file,
            markdown_dir=args.markdown_dir,
            output_json_path=args.output_json,
            file_prefix=args.file_prefix,
            redundancy_page=args.redundancy_page,
            page_offset=args.page_offset,
            model=args.model,
            base_url=args.base_url,
            log_file=args.log_file,
        )
    else:
        process_pdf_content(
            toc_file_path=args.toc_file,
            markdown_dir=args.markdown_dir,
            output_json_path=args.output_json,
            file_prefix=args.file_prefix,
            page_offset=args.page_offset,
            redundancy_page=args.redundancy_page,
            model=args.model,
            base_url=args.base_url,
        )
