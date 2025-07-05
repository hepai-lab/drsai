# HepAI 模型/工具 API服务指南


**相关链接**：

- [HepAI 平台](https://ai.ihep.ac.cn/)
- [HepAI API 文档](https://aiapi.ihep.ac.cn/mkdocs)

## 1.简介

[HepAI 平台](https://ai.ihep.ac.cn/)是一个集算力服务、算法与大模型服务、数据集、工具等于一体的AI服务平台，提供高性能计算、模型训练、模型推理、数据分析能力，以及大模型/智能体工具/知识库及检索等服务API的功能。

## 2.HepAI模型的获取与测试

### 2.1.获取大模型/智能体工具/知识库及检索等服务API KEY

- **1.登录[HepAI 平台](https://ai.ihep.ac.cn/)，点击右上角头像，进入设置，创建大模型和工具服务的API KEY。如下图所示：**

<p align="center">
  <img src="https://note.ihep.ac.cn/uploads/ee22ef7f-2235-45b9-aefb-23870e762d1c.png" width="600" />
</p>

**图2.1：进入设置**

<p align="center">
  <img src="https://note.ihep.ac.cn/uploads/90dce66e-ccdc-4411-974a-1ece1a76f934.png" width="600" />
</p>

**图2.2：进入API KEY创建**

- **2.将获取的API KEY以HEPAI_API_KEY变量保存在环境中：**

linux/mac平台:
```shell
vi ~/.bashrc
export HEPAI_API_KEY=your_api_key
source ~/.bashrc
```
windows平台：
```shell
setx "HEPAI_API_KEY" "your_api_key"
# 注意 windows环境变量需要重启电脑才会生效
```

- **3.使用python代码查看可用的大模型和工具**

先在命令行中安装hepai：

```shell
pip install hepai
```

然后复制以下代码后运行：

```python
from openai import OpenAI
import os

client = OpenAI(
    api_key=os.environ.get("HEPAI_API_KEY"),
    base_url="https://aiapi.ihep.ac.cn/apiv2"
)

for model in client.models.list():
    print(model)
```

运行后你可以看到可用的模型（因账号而异）：

```shell
Model(id='ark/doubao-vision-pro', created=None, object='model', owned_by=None)
Model(id='aliyun/qwen-max-latest', created=None, object='model', owned_by=None)
Model(id='aliyun/qwq-plus-latest', created=None, object='model', owned_by=None)
Model(id='aliyun/qwen-coder-plus-latest', created=None, object='model', owned_by=None)
Model(id='deepseek-ai/deepseek-v3:671b', created=None, object='model', owned_by=None)
Model(id='aliyun/qwen-vl-max-latest', created=None, object='model', owned_by=None)
Model(id='aliyun/qwen2.5-vl-32b-instruct', created=None, object='model', owned_by=None)
Model(id='aliyun/qwen-plus-latest', created=None, object='model', owned_by=None)
Model(id='ark/doubao-embedding-large', created=None, object='model', owned_by=None)
Model(id='openai/gpt-4o', created=None, object='model', owned_by=None)
Model(id='aliyun/qwen2.5-vl-72b-instruct', created=None, object='model', owned_by=None)
Model(id='aliyun/qwen-turbo-latest', created=None, object='model', owned_by=None)
Model(id='aliyun/qwen3-30b-a3b', created=None, object='model', owned_by=None)
Model(id='openai/o1-mini', created=None, object='model', owned_by=None)
Model(id='deepseek-ai/deepseek-r1:7b', created=None, object='model', owned_by=None)
Model(id='deepseek-ai/deepseek-r1:32b', created=None, object='model', owned_by=None)
Model(id='aliyun/qwen3-235b-a22b', created=None, object='model', owned_by=None)
Model(id='deepseek-ai/deepseek-r1:671b', created=None, object='model', owned_by=None)
Model(id='aliyun/qwen-vl-ocr-latest', created=None, object='model', owned_by=None)
Model(id='aliyun/qwen-long-latest', created=None, object='model', owned_by=None)
Model(id='openai/gpt-4o-mini', created=None, object='model', owned_by=None)
Model(id='aliyun/qvq-max-latest', created=None, object='model', owned_by=None)
Model(id='openai/o1', created=None, object='model', owned_by=None)
Model(id='hepai/deepseek-r1:671b', created=None, object='model', owned_by=None)
Model(id='hepai/markitdown', created=None, object='model', owned_by=['xiongdb@ihep.ac.cn'])
Model(id='hepai/deepseek-r1:32b', created=None, object='model', owned_by=None)
Model(id='hepai/mineru', created=None, object='model', owned_by=['xiongdb@ihep.ac.cn'])
Model(id='hepai/bge-m3:latest', created=None, object='model', owned_by=None)
Model(id='hepai/bge-reranker-v2-m3:latest', created=None, object='model', owned_by=None)
```

此时你可以使用[openai的格式](https://platform.openai.com/docs/api-reference)去访问大模型，如openai系列、qwen系列、deepseek系列；进行矢量知识库检索的embedding和reranker模型；PDF/Office/图像等多模态转markdown的工具：```hepai/markitdown```、```hepai/mineru```等。

### 2.2.测试大模型/智能体工具/知识库及检索等服务

- 1.大模型测试
```python
from openai import OpenAI

client = OpenAI(
    api_key=os.environ.get("HEPAI_API_KEY"),
    base_url="https://aiapi.ihep.ac.cn/apiv2"
)

completion = client.chat.completions.create(
  model="hepai/deepseek-r1:671b",
  messages=[
    {"role": "system", "content": "You are a helpful assistant."},
    {"role": "user", "content": "Hello!"}
  ],
  stream=True
)

for chunk in completion:
  print(chunk.choices[0].delta)

```
- 2.embedding测试
```python
from openai import OpenAI

client = OpenAI(
    api_key=os.environ.get("HEPAI_API_KEY"),
    base_url="https://aiapi.ihep.ac.cn/apiv2"
)

embedding_result = client.embeddings.create(
  model="hepai/bge-reranker-v2-m3:latest",
  input="The food was delicious and the waiter...",
  encoding_format="float"
)
print(embedding_result)
```

- 3. PDF/Office/图像等多模态转markdown的工具具体见：

```hepai/markitdown```：https://code.ihep.ac.cn/xdb/markitdown_worker/-/blob/main/request_markitdown.py?ref_type=heads
```hepai/mineru```：https://code.ihep.ac.cn/xdb/mineru_hepai/-/blob/main/request_mineru_pdf.py?ref_type=heads


- 4. DDF文件系统（将本地图像转化为url，以供前端等页面进行展示）：https://note.ihep.ac.cn/s/lZVIBAQsb