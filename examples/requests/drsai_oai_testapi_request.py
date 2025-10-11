from hepai import HepAI 
import os
import json
import requests
import sys

HEPAI_API_KEY = os.getenv("HEPAI_API_KEY")
base_url = "http://localhost:42807/apiv2"
# base_url = "https://aiapi.ihep.ac.cn/apiv2"

client = HepAI(api_key=HEPAI_API_KEY, base_url=base_url)

# models = client.models.list()
# for idx, model in enumerate(models):
#   print(model)


# 获取Agents信息
new_hearers = {}
new_hearers["Authorization"] = f"Bearer DrSai_38ad330e-d032-4d40-8c2d-3cfd59b15738"
new_hearers["Content-Type"] = "application/json"

response = requests.get(f"{base_url}/agents/get_info", headers=new_hearers)
print(response.text)


# 访问指定的Agent进行测试
hearers = {}
hearers["Authorization"] = f"Bearer {HEPAI_API_KEY}"
hearers["Content-Type"] = "application/json"
body={
    "messages":[{"content":"Write a short poem about the fall season.", "role":"user"}],
    "stream":True,
    "chat_id" : "22578926-f5e3-48ef-873b-13a8fe7ca3e4",
    # "history_mode" : "frontend",
    "model" : "groupchat" # "primary" #,
}
r = requests.post(
    f"{base_url}/agents/test_api", 
    # f"{base_url}/chat/completions",
    headers=hearers,
    json=body,
    stream=True,
    )

for line in r.iter_lines():
    if line:
        oai_json = json.loads(line.decode('utf-8').split("data: ")[1])
        textchunck = oai_json["choices"][0]["delta"]["content"]
        if textchunck:
            sys.stdout.write(textchunck)
            sys.stdout.flush()
print()
