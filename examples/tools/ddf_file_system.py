from typing import Dict, Any
from openai import OpenAI
import os


def upload_to_filesystem(file_path: str, user_id: str) -> Dict[str, Any]:
    
                
    client = OpenAI(
        base_url="https://aiapi.ihep.ac.cn/apiv2",
        api_key= os.getenv("HEPAI_API_KEY"),
    )

    file_obj = client.files.create(
        file=open(file_path, "rb"),
        purpose="user_data"
    )
    url = f"https://aiapi.ihep.ac.cn/apiv2/files/{file_obj.id}/preview"
    file_obj = file_obj.model_dump()
    file_obj["url"] = url
    return file_obj

if __name__ == "__main__":
    file_path = "/home/xiongdb/VSproject/drsai/assets/drsai.png"
    print(upload_to_filesystem(file_path, "xiongdb"))