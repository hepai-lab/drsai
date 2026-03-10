
import base64
from pathlib import Path
import glob
from hepai import HRModel
import os, sys

def batch_process_paged_pdfs(directory_path, model, file_mode):
    """
    批量处理指定目录中的分页PDF文件
    
    Args:
        directory_path (str): 包含分页PDF文件的目录路径
        model: 已连接的HRModel实例
    
    Returns:
        list: 处理结果列表
    """
    # 获取目录中所有符合 spec_man__数字.pdf 格式的文件
    pdf_pattern = os.path.join(directory_path, file_mode)
    pdf_files = glob.glob(pdf_pattern)
    
    # 按文件名排序，确保按顺序处理
    pdf_files.sort(key=lambda x: int(Path(x).stem.split('__')[1]))
    
    results = []
    
    for pdf_file in pdf_files:
        print(f"Processing: {pdf_file}")
        
        # 将PDF文件转换为base64
        with open(pdf_file, 'rb') as file:
            file_content = file.read()
            file_base64 = base64.b64encode(file_content).decode('utf-8')
        
        # 获取文件名（不含路径）
        file_name = Path(pdf_file).name
        
        try:
            # 调用模型接口处理文件
            result = model.interface(
                suffix='pdf',
                api_key=os.environ["HEPAI_API_KEY"],
                file_id=None,
                file_base64=file_base64,
                file_name=file_name
            )
            
            # 生成输出MD文件路径
            output_md_path = pdf_file.rsplit('.', 1)[0] + '.md'
            
            # 保存结果到MD文件
            with open(output_md_path, 'w', encoding='utf-8') as f:
                f.write(result)
            
            print(f"Converted markdown saved to: {output_md_path}")
            
            # 记录处理结果
            results.append({
                'file': pdf_file,
                'output_md': output_md_path,
                'status': 'success'
            })
            
        except Exception as e:
            print(f"Error processing {pdf_file}: {str(e)}")
            results.append({
                'file': pdf_file,
                'status': 'error',
                'error': str(e)
            })
    
    return results

def parse_pdf_files(
        directory_path: str,
        file_mode: str,
        api_key: str = os.environ["HEPAI_API_KEY"],
        pdf_model: str = "hepai/mineru2_2B_4090-2",
        base_url: str = "https://aiapi.ihep.ac.cn/apiv2"
        ):
    """
    directory_path: 文件所在目录
    file_mode: 需要解析文件的文件名格式，如："spec_man__*.pdf"
    api_key: HepAI的API密钥
    pdf_model: pdf解析模型名称
    base_url: pdf解析模型的API base URL
    """
    model = HRModel.connect(
        api_key=api_key,
        name=pdf_model,
        base_url=base_url,
    )
    
    # 执行批量处理
    # directory_path = "/mnt/d/work/synchrotron_agent/docs_and_refs/spec_man_pages"
    results = batch_process_paged_pdfs(directory_path, model, file_mode)
    
    # 输出处理统计
    success_count = len([r for r in results if r['status'] == 'success'])
    error_count = len([r for r in results if r['status'] == 'error'])
    
    print(f"\nProcessing completed: {success_count} successful, {error_count} failed")


# # 使用示例
# if __name__ == "__main__":
    
#     model = HRModel.connect(
#         api_key=os.environ["HEPAI_API_KEY"],
#         name="hepai/mineru2_2B_4090-2",
#         base_url="https://aiapi.ihep.ac.cn/apiv2"
#     )
    
#     # 执行批量处理
#     directory_path = "/mnt/d/work/synchrotron_agent/docs_and_refs/spec_man_pages"
#     results = batch_process_paged_pdfs(directory_path, model)
    
#     # 输出处理统计
#     success_count = len([r for r in results if r['status'] == 'success'])
#     error_count = len([r for r in results if r['status'] == 'error'])
    
#     print(f"\nProcessing completed: {success_count} successful, {error_count} failed")

# if __name__ == "__main__":
#     if len(sys.argv) != 5:
#         print("Usage: python pdf_parse_script.py <input_path> <output_prefix>")
#         sys.exit(1)
    
#     input_path = sys.argv[1]
#     output_prefix = sys.argv[2]
#     parse_pdf_files(input_path, output_prefix)