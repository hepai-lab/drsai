from openai import OpenAI
import os

client = OpenAI(
    api_key=os.environ.get("HEPAI_API_KEY"),
    base_url="https://aiapi.ihep.ac.cn/apiv2"
)

model_name = []
for model in client.models.list():
    print(model)
    model_name.append(model.id)

print(0)
for model in model_name:
    if "aliyun" in model:
        print(model)

print(0)
for model in model_name:
    if "openai" in model:
        print(model)

print(0)
for model in model_name:
    if "anthropic" in model:
        print(model)

print(0)
for model in model_name:
    if "ark" in model:
        print(model)

print(0)
for model in model_name:
    if "deepseek-ai" in model:
        print(model)