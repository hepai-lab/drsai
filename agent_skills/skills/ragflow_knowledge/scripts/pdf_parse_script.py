
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
def parse_pdf_files(
        pdf_file: str,
        api_key: str = HEPAI_API_KEY,
        pdf_model: str = PDF_MODEL,
        base_url: str = BASE_URL,
        ):
    """
    pdf_file : 需要解析的PDF文件路径
    api_key: HepAI的API密钥
    pdf_model: pdf解析模型名称
    base_url: pdf解析模型的API base URL
    """
    model = HRModel.connect(
        api_key=api_key,
        name=pdf_model,
        base_url=base_url,
    )
    
    print(f"Processing: {pdf_file}")
        
    # 将PDF文件转换为base64
    with open(pdf_file, 'rb') as file:
        file_content = file.read()
        file_base64 = base64.b64encode(file_content).decode('utf-8')
    
    # 获取文件名（不含路径）
    file_name = Path(pdf_file).name
    
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


def parse_pdf_files_background(
        pdf_file: str,
        log_file: str = None,
        ) -> dict:
    """
    将 parse_pdf_files 任务投递到后台执行，立即返回。

    Args:
        pdf_file: 需要解析的 PDF 文件路径（建议绝对路径）
        log_file: 日志输出路径，默认为同目录下 <stem>_parse.log

    Returns:
        dict: {"pid": int, "log_file": str}
    """
    import subprocess

    script_path = os.path.abspath(__file__)
    if log_file is None:
        p = Path(os.path.abspath(pdf_file))
        log_file = str(p.parent / (p.stem + "_parse.log"))

    cmd = (
        f"nohup python {script_path} {pdf_file} "
        f"> {log_file} 2>&1 &"
    )
    proc = subprocess.Popen(cmd, shell=True, stdout=subprocess.DEVNULL,
                            stderr=subprocess.DEVNULL)
    proc.wait()

    result = subprocess.run(
        f"pgrep -f '{script_path} {pdf_file}'",
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
        description="Parse a single PDF file using HepAI model."
    )
    parser.add_argument("pdf_file", help="Path to the PDF file to parse")
    parser.add_argument("--background", "-b", action="store_true",
                        help="Run in background via nohup, return immediately")
    parser.add_argument("--log-file", default=None,
                        help="Log file path (only used with --background)")
    args = parser.parse_args()

    if args.background:
        parse_pdf_files_background(args.pdf_file, args.log_file)
    else:
        parse_pdf_files(args.pdf_file)