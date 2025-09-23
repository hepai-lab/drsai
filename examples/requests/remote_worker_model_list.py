from hepai import HepAI, HRModel
import os
from hepai.tools.get_woker_functions import get_worker_sync_functions, get_worker_async_functions
import asyncio

# base_url = "https://aiapi.ihep.ac.cn/apiv2"
base_url = "http://192.168.60.170:42812/apiv2"

client = HepAI(
    api_key=os.environ['HEPAI_API_KEY'],
    # base_url="http://localhost:42812/apiv2"
    base_url=base_url,
)
models = client.agents.list()
for model in models:
    print(model.id)

for model in models.data:
    if model.id != "hepai/custom-model":
        # try:
        #     worker = HRModel.connect(
        #         name=model.id, 
        #         api_key=os.environ['HEPAI_API_KEY'],
        #         base_url=base_url,
        #     )
        #     agent_info: dict = worker.get_info()
        #     agent_info.update({"owner": model.owner})
        #     agents[model.id] = agent_info
        # except Exception as e:
        #     pass

        model = HRModel.connect(
                name=model.id, 
                api_key=os.environ['HEPAI_API_KEY'],
                # base_url="http://localhost:42812/apiv2",
                base_url=base_url,
            )
        agent_info: dict = model.get_info()
        print(agent_info)

print(model.lazy_init(chat_id="122333", api_key="**"))

async def test_sync_funcs():
    funcs_map = {f.__name__: f for f in get_worker_sync_functions(
        name=agent_info["name"], 
        api_key=os.environ['HEPAI_API_KEY'],
        # base_url="https://aiapi.ihep.ac.cn/apiv2",
         base_url=base_url,

    )}
    funcs_map["lazy_init"](chat_id="122333", api_key="**")

async def test_async_funcs():
    # funcs_map = {f.__name__: f for f in funcs}
    funcs = await get_worker_async_functions(
        name=agent_info["name"], 
        api_key=os.environ['HEPAI_API_KEY'],
        base_url=base_url,
    )
    funcs_map = {f.__name__: f for f in funcs}
    await funcs_map["lazy_init"](chat_id="122333", api_key="**")

if __name__ == "__main__":
    # asyncio.run(test_async_funcs())
    asyncio.run(test_sync_funcs())

