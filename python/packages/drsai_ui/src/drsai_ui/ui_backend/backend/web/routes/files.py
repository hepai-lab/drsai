from typing import Dict, List, Any
import os, shutil
from fastapi import (
    APIRouter, 
    File, 
    UploadFile, 
    Depends, 
    Request,
    HTTPException,
    )
from fastapi.responses import FileResponse, HTMLResponse
import uuid

from ..initialization import AppInitializer
from ..deps import get_db
from ...datamodel.db import UserFiles

router = APIRouter()
initializer=None

def upload_to_filesystem(file_path: str, user_id: str) -> Dict[str, Any]:
    from openai import OpenAI
    from .....drsai_adapter.singleton import personal_key_config_fetcher as fetcher
                
    client = OpenAI(
        base_url="https://aiapi.ihep.ac.cn/apiv2",
        api_key= fetcher.get_personal_key(username=user_id)
    )

    file_obj = client.files.create(
        file=open(file_path, "rb"),
        purpose="user_data"
    )
    url = f"https://aiapi.ihep.ac.cn/apiv2/files/{file_obj.id}/preview"
    file_obj = file_obj.model_dump()
    file_obj["url"] = url
    return file_obj

@router.post("/")
async def upload_files(
    user_id: str, 
    session_id: str,
    files: List[UploadFile] = File(...), 
    db=Depends(get_db)
    ) -> Dict:
    '''
    接受上传的文件列表，解析上传到本地
    '''
    try:
        userfiles_path =  str(initializer.user_files / user_id / session_id)
        if not os.path.exists(userfiles_path):
            os.makedirs(userfiles_path, exist_ok=True)

        file_info = {} # 储存文件的名称、绝对路径、后缀名、byte大小

        # 保存文件到本地
        for file in files:
            
            # 首先判断文件大小是否超过了10MB
            if file.size > 10485760:
                raise HTTPException(status_code=413, detail="单个文件大小不能超过10MB，需要使用知识库进行上传：https://aiweb01.ihep.ac.cn:886/knowledge(Size limit exceeded 10MB)")
            
            file_path = os.path.join(userfiles_path, file.filename)
            file_id = str(uuid.uuid4())
            with open(file_path, "wb") as buffer:
                shutil.copyfileobj(file.file, buffer)
            
            # 顺便上传到文件系统
            # SERVICE_MODE = os.getenv("SERVICE_MODE", None)
            # if SERVICE_MODE == "PROD":
            #     file_obj = upload_to_filesystem(file_path, user_id)
            # else:
            #     file_obj = None

            file_info[file_id] = {
                "name": file.filename,
                "path": file_path,
                "suffix": os.path.splitext(file.filename)[1],
                "size": os.path.getsize(file_path),
                # "hepai_file_obj": file_obj
            }
        
        # 保存文件到数据库
        response = db.get(UserFiles, filters={"user_id": user_id, "session_id": session_id})
        if not response.status or not response.data:
            userfiles = UserFiles(
                user_id=user_id, 
                session_id=session_id,
                files=file_info,
                )
        else:
            # file_info_org: dict[str, Any] = response.data[0]["files"]
            # file_info_org.update(file_info)
            # file_info = file_info_org
            userfiles: UserFiles = response.data[0]
            if userfiles.files:
                userfiles.files.update(file_info)
            else:
                userfiles.files = file_info

        
        
        db.upsert(userfiles)
        return {"status": True, "data": file_info}
    except Exception as e:
        # Clean up session if run creation failed
        raise HTTPException(status_code=500, detail=str(e)) from e

# @router.get("/")
# async def get_user_files(user_id: str, db=Depends(get_db)) -> Dict:
#     """
#     检索用户上传的文件列表
#     """
#     response = db.get(UserFiles, filters={"user_id": user_id})
#     if not response.status or not response.data:
#         return {"status": False, "data": {}}
#     else:
#         # 处理多个session
#         user_files = {}
#         for files_i in response.data:
#             if "files" in files_i:
#                 user_files.update(files_i["files"])

#         return {"status": True, "data": response.data[0]["files"]}

@router.get("/{session_id}")
async def get_user_session_files(session_id: str, user_id: str, db=Depends(get_db)) -> Dict:
    """
    检索用户上传的文件列表
    """
    response = db.get(UserFiles, filters={"user_id": user_id, "session_id": session_id})
    if not response.status or not response.data:
        return {"status": False, "data": {}}
    else:
        userfiles: UserFiles = response.data[0]
        if not userfiles.files:
            return {"status": False, "data": userfiles.files}

        return {"status": False, "data": {}}