from typing import Dict, List, Any, Optional
import os, shutil, tempfile, base64
from fastapi import (
    APIRouter, 
    File, 
    UploadFile, 
    Depends, 
    Request,
    HTTPException,
    )
from fastapi.responses import FileResponse
from pydantic import BaseModel
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


class EditDocxRequest(BaseModel):
    user_id: str
    file_name: str
    original_paragraphs: List[str]
    edits: List[Dict[str, Any]]
    file_path: Optional[str] = None
    file_url: Optional[str] = None
    file_base64: Optional[str] = None


@router.post("/docx/edit")
async def edit_docx_file(
    req: EditDocxRequest,
    db=Depends(get_db)
) -> Dict:
    """
    Edit a .docx file using structured edits with content-based paragraph matching.
    
    This endpoint:
    1. Applies edits to the docx using DocumentProcessor
    2. Copies the edited file to user's files space
    3. Registers the new file in UserFiles database
    
    The source file can be provided via one of three methods (tried in order):
    - file_path: Direct path to a docx file on disk
    - file_url:  URL to download the docx from (e.g. HepAI filesystem)
    - file_base64: Base64-encoded docx content
    
    Args:
        user_id: User identifier
        file_name: Original file name
        original_paragraphs: List of original paragraph texts for content matching
        edits: List of edit operations (replace_text, format_text, etc.)
        file_path: (Optional) Path to the docx file on disk
        file_url: (Optional) URL to download the docx from
        file_base64: (Optional) Base64-encoded docx content
    
    Returns:
        {status: True, data: {success, saved_name, path, uuid, ...}}
    """
    from drsai_ext.tools.docx_processor import edit_docx_by_content_match
    import datetime
    import requests as http_requests
    
    _temp_file_to_cleanup: Optional[str] = None
    
    # Unpack request fields
    user_id = req.user_id
    file_name = req.file_name
    original_paragraphs = req.original_paragraphs
    edits = req.edits
    file_path = req.file_path
    file_url = req.file_url
    file_base64 = req.file_base64

    try:
        # Resolve the source file: file_path > file_url > file_base64
        if file_path and os.path.isfile(file_path):
            source_path = file_path
        elif file_url:
            # Download from URL to a temp file
            resp = http_requests.get(file_url, timeout=60)
            resp.raise_for_status()
            tmp = tempfile.NamedTemporaryFile(
                suffix=".docx", delete=False, prefix="docx_edit_"
            )
            tmp.write(resp.content)
            tmp.close()
            source_path = tmp.name
            _temp_file_to_cleanup = source_path
        elif file_base64:
            # Decode base64 to a temp file
            raw = base64.b64decode(file_base64)
            tmp = tempfile.NamedTemporaryFile(
                suffix=".docx", delete=False, prefix="docx_edit_"
            )
            tmp.write(raw)
            tmp.close()
            source_path = tmp.name
            _temp_file_to_cleanup = source_path
        else:
            raise HTTPException(
                status_code=400,
                detail="No file source provided. Supply file_path, file_url, or file_base64.",
            )
        
        # Get user's files directory
        initializer = get_initializer()
        userfiles_path = str(initializer.user_files / user_id)
        if not os.path.exists(userfiles_path):
            os.makedirs(userfiles_path, exist_ok=True)
        
        # Generate new file name with sequential numbering: name_edited1.docx, name_edited2.docx, ...
        name_parts = file_name.rsplit(".", 1)
        base_name = name_parts[0] if len(name_parts) == 2 else file_name
        ext = name_parts[1] if len(name_parts) == 2 else "docx"
        # Strip any existing _editedN suffix to find the true base name
        import re as _re
        stripped = _re.sub(r"_edited\d+$", "", base_name)
        prefix = f"{stripped}_edited"
        # Find the highest existing number
        max_num = 0
        existing_files = os.listdir(userfiles_path) if os.path.isdir(userfiles_path) else []
        for f in existing_files:
            if f.startswith(prefix) and f.endswith(f".{ext}"):
                num_str = f[len(prefix):-len(f".{ext}")]
                if num_str.isdigit():
                    max_num = max(max_num, int(num_str))
        new_file_name = f"{prefix}{max_num + 1}.{ext}"
        
        # Create a copy for editing (don't modify original)
        temp_copy_path = os.path.join(userfiles_path, f"temp_{new_file_name}")
        shutil.copy2(source_path, temp_copy_path)
        
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
    finally:
        # Clean up temp file downloaded from URL or decoded from base64
        if _temp_file_to_cleanup and os.path.exists(_temp_file_to_cleanup):
            try:
                os.remove(_temp_file_to_cleanup)
            except OSError:
                pass