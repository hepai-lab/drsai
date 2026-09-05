
import base64
from pathlib import Path
import glob
from hepai import HRModel
import os
from dotenv import load_dotenv
load_dotenv()

HEPAI_API_KEY = os.getenv("HEPAI_API_KEY")
PDF_MODEL = os.getenv("PDF_MODEL", "hepai/mineru2_2B_4090-2")
BASE_URL = os.getenv("BASE_URL", "https://aiapi.ihep.ac.cn/apiv2")

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
        api_key: str = HEPAI_API_KEY,
        pdf_model: str = PDF_MODEL,
        base_url: str = BASE_URL,
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


def parse_pdf_files_background(
        directory_path: str,
        file_mode: str,
        log_file: str = None,
        ) -> dict:
    """
    将 parse_pdf_files 任务投递到后台执行，立即返回。

    Args:
        directory_path: 文件所在目录（建议绝对路径）
        file_mode: 文件名匹配模式，如 "spec_man__*.pdf"
        log_file: 日志输出路径，默认为 directory_path/pdf_parse.log

    Returns:
        dict: {"pid": int, "log_file": str}
            pid      — 后台进程 PID，可用 `kill <pid>` 终止
            log_file — 实时日志路径，用 `tail -f <log_file>` 跟踪进度
    """
    import subprocess

    script_path = os.path.abspath(__file__)
    if log_file is None:
        log_file = os.path.join(os.path.abspath(directory_path), "pdf_parse.log")

    cmd = (
        f"nohup python {script_path} {directory_path} {file_mode} "
        f"> {log_file} 2>&1 &"
    )
    proc = subprocess.Popen(cmd, shell=True, stdout=subprocess.DEVNULL,
                            stderr=subprocess.DEVNULL)
    proc.wait()  # 等 shell 退出，nohup 子进程已独立

    # 从 log 文件所在进程组里找到实际 PID（简单方案：读 pgrep）
    result = subprocess.run(
        f"pgrep -f '{script_path} {directory_path}'",
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
        description="Batch parse PDF files using HepAI model."
    )
    parser.add_argument("directory_path", help="Directory containing PDF files")
    parser.add_argument("file_mode", help="Glob pattern for PDF files, e.g. 'spec_man__*.pdf'")
    parser.add_argument("--background", "-b", action="store_true",
                        help="Run in background via nohup, return immediately")
    parser.add_argument("--log-file", default=None,
                        help="Log file path (only used with --background)")
    args = parser.parse_args()

    if args.background:
        parse_pdf_files_background(args.directory_path, args.file_mode, args.log_file)
    else:
        parse_pdf_files(args.directory_path, args.file_mode)