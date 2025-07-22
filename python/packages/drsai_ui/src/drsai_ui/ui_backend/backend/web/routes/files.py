from typing import Dict, List
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

from ..initialization import AppInitializer
from ..deps import get_db
from ...datamodel.db import UserFiles

router = APIRouter()


def get_initializer(request: Request):
    return request.app.state.initializer

@router.post("/")
def upload_files(
    user_id: str, 
    files: List[UploadFile] = File(...), 
    initializer: AppInitializer = Depends(get_initializer),
    db=Depends(get_db)) -> Dict:
    '''
    接受上传的文件列表，解析上传到本地
    '''
    try:
        userfiles_path =  str(initializer.user_files / user_id)
        if not os.path.exists(userfiles_path):
            os.makedirs(userfiles_path, exist_ok=True)

        file_info = {} # 储存文件的名称、绝对路径、后缀名、byte大小
        # 保存文件到本地
        for file in files:
            file_path = os.path.join(userfiles_path, file.filename)
            file_info = {}
            with open(file_path, "wb") as buffer:
                shutil.copyfileobj(file.file, buffer)
        
        # 保存文件到数据库
        response = db.get(UserFiles, filters={"user_id": user_id})
        if not response.status or not response.data:
            userfiles = UserFiles(
                user_id=user_id, 
                files={file.filename: file.filename for file in files}
                )
            
    #     if not run.status:
    #         # Clean up session if run creation failed
    #         raise HTTPException(status_code=400, detail=run.message)
    #     return {"status": True, "data": session_response.data}
    except Exception as e:
        # Clean up session if run creation failed
        raise HTTPException(status_code=500, detail=str(e)) from e
    