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

print("=====")
for model in model_name:
    if "aliyun/" in model:
        print(model)

print("=====")
for model in model_name:
    if "openai/" in model:
        print(model)

print("=====")
for model in model_name:
    if "anthropic/" in model:
        print(model)

# print("=====")
# for model in model_name:
#     if "ark/" in model:
#         print(model)

print("=====")
for model in model_name:
    if "moonshot/" in model:
        print(model)

print("=====")
for model in model_name:
    if "scienceone/" in model:
        print(model)

print("=====")
for model in model_name:
    if "xAI/" in model:
        print(model)

print("=====")
for model in model_name:
    if "minimax/" in model:
        print(model)

print("=====")
for model in model_name:
    if "zhipu/" in model:
        print(model)

print("=====")
for model in model_name:
    if "bytedance/" in model:
        print(model)

print("=====")
for model in model_name:
    if "google/" in model:
        print(model)

print("=====")
for model in model_name:
    if "tencent/" in model:
        print(model)

print("=====")
for model in model_name:
    if "baidu/" in model:
        print(model)

print("=====")
for model in model_name:
    if "baichuan/" in model:
        print(model)

print("=====")
for model in model_name:
    if "meta/" in model:
        print(model)

print("=====")
for model in model_name:
    if "iflytech/" in model:
        print(model)

print("=====")
for model in model_name:
    if "360/" in model:
        print(model)

print("=====")
for model in model_name:
    if "deepseek-ai/" in model:
        print(model)

print("=====")
for model in model_name:
    if "hepai/" in model:
        print(model)