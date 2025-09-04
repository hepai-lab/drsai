# 使用 OpenAI ChatCompletions API 访问智能体后端

- 1.导入必要的包，设置后端访问的 base_url 和 api_key，检查启动的后端智能体是否可用。

```python
from openai import OpenAI
import os

HEPAI_API_KEY = os.getenv("HEPAI_API_KEY")
base_url = "http://localhost:42807/apiv2"

client = OpenAI(api_key=HEPAI_API_KEY, base_url=base_url)

models = client.models.list()
for idx, model in enumerate(models):
  print(model)

```

- 2.使用标准的OpenAI ChatCompletions格式构造请求，并发送到后端。

```python
stream = True

completion = client.chat.completions.create(
  model='hepai/drsai',
  messages=[
    # {"role": "user", "content": "请使用百度搜索什么是Ptychography?"}
    {"role": "user", "content": "What is the weather in New York?"}
  ],
  stream=stream,
  extra_body = {
    "chat_id": "1234567890",
    "user": {"name": "Alice", "email": "alice@example.com"}
    }
)

if stream:
  for chunk in completion:
    if chunk.choices[0].delta.content:
      print(chunk.choices[0].delta.content, end='', flush=True)
  print('\n')

else:
  print(completion)
```

-注意：extra_body可传入额外参数，如chat_id、user等信息，所有的信息会存储在数据表UserInput中，可在智能体全局获取，具体见tutorials/components/db_manager01.md。