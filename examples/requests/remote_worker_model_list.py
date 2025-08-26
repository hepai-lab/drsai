from hepai import HepAI, HRModel
import os



client = HepAI(
    api_key=os.environ['HEPAI_API_KEY'],
    base_url="https://aiapi.ihep.ac.cn/apiv2"
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
        #         base_url="https://aiapi.ihep.ac.cn/apiv2",
        #     )
        #     agent_info: dict = worker.get_info()
        #     agent_info.update({"owner": model.owner})
        #     agents[model.id] = agent_info
        # except Exception as e:
        #     pass

        worker = HRModel.connect(
                name=model.id, 
                api_key=os.environ['HEPAI_API_KEY'],
                base_url="https://aiapi.ihep.ac.cn/apiv2",
            )
        agent_info: dict = worker.get_info()
        print(agent_info)