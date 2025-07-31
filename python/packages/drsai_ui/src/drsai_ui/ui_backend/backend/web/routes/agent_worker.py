from typing import Dict
from fastapi import APIRouter, Depends, HTTPException, Header
from openai import OpenAI 
from hepai import HRModel
# from ...datamodel.db import UserAgents


from ..deps import get_db

import uuid

router = APIRouter()


@router.get("/")
async def get_remote_agent(user_id: str, authorization: str = Header(...), db=Depends(get_db)) -> Dict:
    '''
    获取后端的mode种类设置
    '''
    try:
        # Extract API key from Authorization header (Bearer format)
        if not authorization.startswith("Bearer "):
            raise HTTPException(status_code=401, detail="Invalid authorization header format")
        
        apikey = authorization[7:]  # Remove "Bearer " prefix

        client = OpenAI(
            api_key=apikey,
            base_url="https://aiapi.ihep.ac.cn/apiv2"
        )
        models = client.models.list()
        agents = {}
        for model in models:
            if model.id.startswith("drsai/"):
                worker = HRModel.connect(
                    name=model.id, 
                    api_key=apikey,
                    base_url="https://aiapi.ihep.ac.cn/apiv2",
                )
                agent_info: dict = worker.get_info()
                agent_info.update({"owner": model.owned_by})
                agents[model.id] = agent_info
        return {"status": True, "data": agents}
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e