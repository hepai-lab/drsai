import fitz, sys

def get_pdf_page_count(input_path: str) -> int:
    """获取PDF文件总页数"""
    doc = fitz.open(input_path)
    page_count = doc.page_count
    doc.close()
    return page_count

def split_pdf_range(input_path: str, output_path: str, start_page: int, end_page: int):
    """
    按页数范围分割PDF
    :param start_page: 起始页（从1开始）
    :param end_page: 结束页（包含）
    """
    doc = fitz.open(input_path)
    
    # 创建新PDF
    new_doc = fitz.open()
    
    # 插入指定范围的页面（注意：内部索引从0开始）
    new_doc.insert_pdf(doc, from_page=start_page-1, to_page=end_page-1)
    
    new_doc.save(output_path)
    new_doc.close()
    doc.close()

def split_pdf_by_pages(input_path: str, output_prefix: str = None):
    """
    将PDF按每页单独分割
    :param input_path: 输入PDF路径
    :param output_prefix: 输出文件前缀，默认为原文件名_页码

    Example:
    ```
    input_pdf = "/mnt/d/work/synchrotron_agent/docs_and_refs/spec_man.pdf"
    output_prefix = "/mnt/d/work/synchrotron_agent/docs_and_refs/spec_man_pages/spec_man_"
    split_pdf_by_pages(
        input_path = input_pdf,
        output_prefix = output_prefix,
        )
    ```
    """
    if output_prefix is None:
        import os
        base_name = os.path.splitext(os.path.basename(input_path))[0]
        output_prefix = f"{base_name}_page"
    
    total_pages = get_pdf_page_count(input_path)
    
    for page_num in range(1, total_pages + 1):
        output_path = f"{output_prefix}_{page_num}.pdf"
        split_pdf_range(input_path, output_path, page_num, page_num)
        # print(f"已创建第 {page_num} 页: {output_path}")
    
    print(f"{input_path}分割完成，系列保存文件保存在：{output_prefix}")

if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python pdf_parse_script.py <input_path>")
        sys.exit(1)
    
    input_path = sys.argv[1]
    # output_prefix = sys.argv[2]
    split_pdf_by_pages(input_path)