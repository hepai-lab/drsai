from openai import OpenAI
# from hepai import HepAI
import os
import json
import requests
import sys
import asyncio

HEPAI_API_KEY = os.getenv("HEPAI_API_KEY")
# base_url = "http://localhost:42813/apiv2"
base_url = "https://aiapi.ihep.ac.cn/apiv2"



def request_client():
    client = OpenAI(api_key=HEPAI_API_KEY, base_url=base_url)

    models = client.models.list()
    for idx, model in enumerate(models):
      print(model)

    stream = True

    completion = client.chat.completions.create(
      model='R1_test',
      messages=[
        # {"role": "user", "content": "请使用百度搜索什么是Ptychography?"}
        {"role": "user", "content": "What is the weather in New York?"}
      ],
      stream=stream,
      extra_body = {
        "chat_id": "1234567893",
        "user": {"name": "Alice", "email": "alice@example.com"}
        }
    )

    if stream:
      for chunk in completion:
        if chunk.choices and chunk.choices[0].delta.content:
          print(chunk.choices[0].delta.content, end='', flush=True)
      print('\n')

    else:
      print(completion)

async def request_async_client():
  from openai import AsyncOpenAI
  client = AsyncOpenAI(api_key=HEPAI_API_KEY, base_url=base_url)
  completion = await client.chat.completions.create(
    model='R2_test',
    messages=[
      # {"role": "user", "content": "请使用百度搜索什么是Ptychography?"}
      {"role": "user", "content": "What is the weather in New York?"}
    ],
    stream=True,
    extra_body = {
      "chat_id": "1234567893",
      "user": {"name": "Alice", "email": "alice@example.com"}
      }
  )
  async for chunk in completion:
    if chunk.choices and chunk.choices[0].delta.content:
        print(chunk.choices[0].delta.content, end='', flush=True)
  print('\n')

def request_url():
    url = base_url + "/chat/completions"
    headers = {
        "Authorization": "Bearer " + HEPAI_API_KEY,
        "Content-Type": "application/json"
    }
    data = {
        "model": "R1_test",
        "messages": [
            {"role": "user", "content": "What is the weather in New York?"},
            ],
        "stream": True, 
        "chat_id": "1234567893",
        "user": {"name": "Alice", "email": "alice@example.com"}
    }
    response = requests.post(url, headers=headers, data=json.dumps(data))
    if response.status_code == 200:
        for chunk in response.iter_content(chunk_size=None):
            if chunk:
                print(chunk.decode('utf-8'), end='', flush=True)
    else:
        print(response.status_code)
        print(response.text)
   
if __name__ == '__main__':
    # request_client()
    asyncio.run(request_async_client())