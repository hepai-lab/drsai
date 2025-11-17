from openai import OpenAI
import os
client = OpenAI(
    api_key=os.environ.get("HEPAI_API_KEY"),
    base_url="https://aiapi.ihep.ac.cn/apiv2"
)

embedding_result = client.embeddings.create(
#   model="hepai/bge-reranker-v2-m3:latest",
  model="openai/text-embedding-3-large",
  input="The food was delicious and the waiter...",
  encoding_format="float"
)
print(embedding_result)
