from typing import Dict, Any
from openai import OpenAI
import os, sys

def upload_to_hepai_filesystem(file_path: str, api_key: str|None = None):
 
    client = OpenAI(
        base_url="https://aiapi.ihep.ac.cn/apiv2",
        api_key= api_key or os.environ.get("HEPAI_API_KEY")
    )

    file_obj = client.files.create(
        file=open(file_path, "rb"),
        purpose="user_data"
    )
    url = f"https://aiapi.ihep.ac.cn/apiv2/files/{file_obj.id}/preview"
    file_obj = file_obj.model_dump()
    file_obj["url"] = url
    # return file_obj
    print(f"File uploaded to Hepai, The info is: \n {file_obj}")

if __name__ == "__main__":
    if len(sys.argv) < 2 or len(sys.argv) > 3:
        print("Usage: python upload_file_to_hepai.py <file_path> [api_key]")
        sys.exit(1)
    
    file_path = sys.argv[1]
    api_key = sys.argv[2] if len(sys.argv) == 3 else None
    upload_to_hepai_filesystem(file_path, api_key)