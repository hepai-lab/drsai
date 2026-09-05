from typing import Any, Dict, List, Optional, Tuple
import os
from openai import OpenAI

def upload_to_hepai_filesystem(file_path: str, api_key: str|None = None) -> Dict[str, Any]:
 
    client = OpenAI(
        base_url="https://aiapi.ihep.ac.cn/apiv2",
        api_key= api_key or os.environ.get("HEPAI_API_KEY")
    )

    file_obj = client.files.create(
        file=open(file_path, "rb"),
        purpose="user_data"
    )
    print(f"https://aiapi.ihep.ac.cn/apiv2/files/{file_obj.id}/preview")