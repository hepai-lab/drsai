# api/routes/models.py
from typing import Dict
from fastapi import APIRouter, Depends, HTTPException, Header
from ..deps import get_db
from hepai import HepAI

router = APIRouter()

@router.get("/llm_models")
async def get_llm_models(user_id: str, authorization: str = Header(...), db=Depends(get_db)) -> Dict:
    '''
    获取HepAI的模型种类设置
    '''
    try:
        if not authorization.startswith("Bearer "):
            raise HTTPException(status_code=401, detail="Invalid authorization header format")
        
        apikey = authorization[7:]  # Remove "Bearer " prefix

        client = HepAI(
            api_key=apikey,
            base_url="https://aiapi.ihep.ac.cn/apiv2"
        )

        models = client.models.list()
        models_json = models.model_dump()

        return {"status": True, "data": models_json}
    
    except Exception as e:
        # raise HTTPException(status_code=500, detail=str(e)) from e
        return {"status": False, "data": {}, "message": str(e)}