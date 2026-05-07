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
from fastapi.responses import FileResponse
# from fastapi.responses import FileResponse, HTMLResponse
import uuid
from dotenv import load_dotenv
load_dotenv()

# from ..initialization import AppInitializer
from ..deps import get_db
from ...datamodel.db import UserFiles

from openai import OpenAI
from .....drsai_adapter.singleton import personal_key_config_fetcher as fetcher

router = APIRouter()

def get_initializer():
    """Get the initializer instance from app module"""
    from .. import app
    return app.initializer

def upload_to_filesystem(file_path: str, user_id: str) -> Dict[str, Any]:

    SERVICE_MODE = os.getenv("SERVICE_MODE", "DEV")    
    client = OpenAI(
        base_url="https://aiapi.ihep.ac.cn/apiv2",
        api_key= fetcher.get_personal_key(username=user_id) if SERVICE_MODE == "PROD" else os.environ.get("HEPAI_API_KEY")
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
    files: List[UploadFile] = File(...),
    db=Depends(get_db)
    ) -> Dict:
    '''
    接受上传的文件列表，解析上传到本地
    '''
    try:
        initializer = get_initializer()
        userfiles_path =  str(initializer.user_files / user_id)
        if not os.path.exists(userfiles_path):
            os.makedirs(userfiles_path, exist_ok=True)

        files_info = {} # 储存文件的名称、绝对路径、后缀名、byte大小
        files_list = []

        # 保存文件到本地
        for file in files:
            file_path = os.path.join(userfiles_path, file.filename)
            file_id = str(uuid.uuid4())
            with open(file_path, "wb") as buffer:
                shutil.copyfileobj(file.file, buffer)

            # Starlette UploadFile.size 在部分客户端下可能为 None，以落盘后的实际大小为准
            byte_size = file.size if file.size is not None else os.path.getsize(file_path)
            if byte_size > 10485760:
                try:
                    os.remove(file_path)
                except OSError:
                    pass
                raise HTTPException(status_code=413, detail="单个文件大小不能超过10MB，需要使用知识库进行上传：https://ragflow.ihep.ac.cn(Size limit exceeded 10MB)")
            
            files_info[file_id] = {
                "name": file.filename,
                "type": file.content_type,
                "path": file_path,
                "suffix": os.path.splitext(file.filename)[1],
                "size": byte_size,
                "uuid": file_id,
            }

            # 顺便上传到文件系统
            USE_HEPAI_FILE = os.getenv("USE_HEPAI_FILE", False)
            if USE_HEPAI_FILE:
                file_obj = upload_to_filesystem(file_path, user_id)
                files_info[file_id]["url"] = file_obj["url"]
            
            files_list.append(files_info[file_id])
        
        # 保存文件到数据库
        response = db.get(UserFiles, filters={"user_id": user_id})
        if not response.status or not response.data:
            userfiles = UserFiles(
                user_id=user_id, 
                files=files_info,
                )
        else:
            # file_info_org: dict[str, Any] = response.data[0]["files"]
            # file_info_org.update(file_info)
            # file_info = file_info_org
            userfiles: UserFiles = response.data[0]
            if userfiles.files:
                userfiles.files.update(files_info)
            else:
                userfiles.files = files_info
        db.upsert(userfiles)

        return {"status": True, "data": files_list}
    
    except Exception as e:
        # Clean up session if run creation failed
        raise HTTPException(status_code=500, detail=str(e)) from e

@router.get("/download/{file_uuid}")
async def download_user_file(file_uuid: str, user_id: str, db=Depends(get_db)) -> FileResponse:
    """Download a file previously uploaded by the user (local disk path)."""
    response = db.get(UserFiles, filters={"user_id": user_id})
    if not response.status or not response.data:
        raise HTTPException(status_code=404, detail="No files for user")
    userfiles: UserFiles = response.data[0]
    if not userfiles.files or file_uuid not in userfiles.files:
        raise HTTPException(status_code=404, detail="File not found")
    info = userfiles.files[file_uuid]
    path = info.get("path")
    name = info.get("name") or "download"
    if not path or not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="File missing on disk")
    return FileResponse(path, filename=name, media_type=info.get("type") or "application/octet-stream")


@router.delete("/item/{file_uuid}")
async def delete_user_file(file_uuid: str, user_id: str, db=Depends(get_db)) -> Dict:
    """Remove one file from the user's library and delete it from disk if present."""
    response = db.get(UserFiles, filters={"user_id": user_id})
    if not response.status or not response.data:
        raise HTTPException(status_code=404, detail="No files for user")
    userfiles: UserFiles = response.data[0]
    if not userfiles.files or file_uuid not in userfiles.files:
        raise HTTPException(status_code=404, detail="File not found")
    info = userfiles.files.pop(file_uuid)
    path = info.get("path")
    if path and os.path.isfile(path):
        try:
            os.remove(path)
        except OSError:
            pass
    db.upsert(userfiles)
    return {"status": True, "data": {"uuid": file_uuid}}


@router.get("/{session_id}")
async def get_user_session_files(session_id: str, user_id: str, db=Depends(get_db)) -> Dict:
    """
    检索用户上传的文件列表
    """
    response = db.get(UserFiles, filters={"user_id": user_id})
    if not response.status or not response.data:
        return {"status": False, "data": {}}
    else:
        userfiles: UserFiles = response.data[0]
        if userfiles.files:
            files_list = [userfiles.files[file] for file in userfiles.files]
            return {"status": True, "data": files_list}

        return {"status": True, "data": []}


@router.post("/docx/edit")
async def edit_docx_file(
    user_id: str,
    file_name: str,
    file_path: str,
    original_paragraphs: List[str],
    edits: List[Dict[str, Any]],
    db=Depends(get_db)
) -> Dict:
    """
    Edit a .docx file using structured edits with content-based paragraph matching.
    
    This endpoint:
    1. Applies edits to the docx using DocumentProcessor
    2. Copies the edited file to user's files space
    3. Registers the new file in UserFiles database
    
    Args:
        user_id: User identifier
        file_name: Original file name
        file_path: Path to the docx file on disk
        original_paragraphs: List of original paragraph texts for content matching
        edits: List of edit operations (replace_text, format_text, etc.)
    
    Returns:
        {status: True, data: {success, saved_name, path, uuid, ...}}
    """
    from .....drsai_ext.tools.docx_processor import edit_docx_by_content_match
    import datetime
    
    try:
        # Validate file exists
        if not os.path.isfile(file_path):
            raise HTTPException(status_code=404, detail="Source file not found")
        
        # Get user's files directory
        initializer = get_initializer()
        userfiles_path = str(initializer.user_files / user_id)
        if not os.path.exists(userfiles_path):
            os.makedirs(userfiles_path, exist_ok=True)
        
        # Generate new file name with timestamp
        timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        name_parts = file_name.rsplit(".", 1)
        if len(name_parts) == 2:
            new_file_name = f"{name_parts[0]}_edited_{timestamp}.{name_parts[1]}"
        else:
            new_file_name = f"{file_name}_edited_{timestamp}.docx"
        
        # Create a copy for editing (don't modify original)
        temp_copy_path = os.path.join(userfiles_path, f"temp_{timestamp}_{file_name}")
        shutil.copy2(file_path, temp_copy_path)
        
        # Apply edits using DocumentProcessor
        result = edit_docx_by_content_match(
            file_path=temp_copy_path,
            edits=edits,
            original_paragraphs=original_paragraphs,
            preserve_format=True
        )
        
        if not result.get("success", False):
            # Clean up temp file
            if os.path.exists(temp_copy_path):
                os.remove(temp_copy_path)
            raise HTTPException(status_code=500, detail=result.get("message", "Edit failed"))
        
        # Move to final location
        final_path = os.path.join(userfiles_path, new_file_name)
        if os.path.exists(final_path):
            os.remove(final_path)
        shutil.move(temp_copy_path, final_path)
        
        # Register in database
        file_id = str(uuid.uuid4())
        file_info = {
            "name": new_file_name,
            "type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "path": final_path,
            "suffix": ".docx",
            "size": os.path.getsize(final_path),
            "uuid": file_id,
            "description": f"Edited version of {file_name}",
        }
        
        # Upload to HepAI filesystem if enabled
        USE_HEPAI_FILE = os.getenv("USE_HEPAI_FILE", False)
        if USE_HEPAI_FILE:
            try:
                file_obj = upload_to_filesystem(final_path, user_id)
                file_info["url"] = file_obj["url"]
            except Exception as upload_err:
                print(f"Warning: HepAI upload failed: {upload_err}")
        
        # Save to database
        response = db.get(UserFiles, filters={"user_id": user_id})
        if not response.status or not response.data:
            userfiles = UserFiles(
                user_id=user_id,
                files={file_id: file_info},
            )
        else:
            userfiles: UserFiles = response.data[0]
            if userfiles.files:
                userfiles.files[file_id] = file_info
            else:
                userfiles.files = {file_id: file_info}
        db.upsert(userfiles)
        
        return {
            "status": True,
            "data": {
                "success": True,
                "saved_name": new_file_name,
                "uuid": file_id,
                "path": final_path,
                "url": file_info.get("url"),
                "changes": result.get("changes_made", []),
                "message": result.get("message", ""),
            }
        }
    
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e