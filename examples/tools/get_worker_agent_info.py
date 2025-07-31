
from typing import Dict
# from openai import OpenAI 
from hepai import HepAI
from hepai import HRModel
import os,asyncio

async def get_remote_agent(apikey: str) -> Dict:
    '''
    获取后端的mode种类设置
    '''
    try:
       
        client = HepAI(
            api_key=apikey,
            base_url="https://aiapi.ihep.ac.cn/apiv2"
        )
        models = client.agents.list()
        agents = {}
        for model in models.data:
            if model.id != "hepai/custom-model":
                worker = HRModel.connect(
                    name=model.id, 
                    api_key=apikey,
                    base_url="https://aiapi.ihep.ac.cn/apiv2",
                )
                agent_info: dict = worker.get_info()
                agent_info.update({"owner": model.owner})
                agents[model.id] = agent_info
        return {"status": True, "data": agents}
    
    except Exception as e:
       raise e

if __name__ == '__main__':
    apikey = os.getenv("HEPAI_API_KEY")
    info = asyncio.run(get_remote_agent(apikey))
    print(info)
