# RAGflow知识库相关操作

## RAGflow界面的配置过程

1. 使用高能所统一认证登录RAGFlow-`https://ragflow.ihep.ac.cn/`，去右上角的Model Provider配置OpenAI-API-Compatible格式的基础模型，如下图：

![](https://note.ihep.ac.cn/uploads/0bb0cb11-7ec2-4bec-9e43-c2ffa2dd9652.PNG)

2. 使用高能所统一认证登录`https://aiapi.ihep.ac.cn`，在模型广场选择配置自己合适的chat/embbeding/rerank模型在Model Provider中配置模型。所有的base_url为`https://aiapi.ihep.ac.cn/apiv2`，apikey为账户详情中的apikey，没有可以自己创建。
    - chat模型推荐deepseek-ai/deepseek-v3.2
    - embbeding模型推荐hepai/bge-m3:latest
    - rerank模型推荐hepai/bge-reranker-v2-m3

如下图：

![](https://note.ihep.ac.cn/uploads/74776881-e5a5-49ca-99ad-c49b274555a2.PNG)

3. 创建专属知识库并确定embbeding模型，选择文件解析模式，上传文件，如下图：

![](https://note.ihep.ac.cn/uploads/56c49792-79dc-41f8-807c-a54ecbccc4b4.PNG)

4. 在RAGFlow中进行检索测试，如下图：

![](https://note.ihep.ac.cn/uploads/28b58867-d3ef-464b-b48a-45ed030a2881.png)

**注意**，此时可以使用Rerank模型与跨语言搜索增加多语言知识的召回率，如下图：

![](https://note.ihep.ac.cn/uploads/bf280070-50eb-40d2-bdb3-db02bad6f58d.png)

5. 获取RAGFlow的API URL和RAGFLOW_TOKEN，如下图：

![](https://note.ihep.ac.cn/uploads/98083c10-f71e-4290-a651-5f8432351435.png)

6. 将RAGFlow的API URL和RAGFLOW_TOKEN追加到自己skill文件的`scripts`文件夹中的`.env`文件中：

```env
RAGFLOW_URL="https://ragflow.ihep.ac.cn"
RAGFLOW_TOKEN="ragflow-****"
```

可以使用`scripts`文件夹中的`check_ragflow.py`脚本检查自己的数据集与文件列表：

```bash
# 列出所有数据集
python check_ragflow.py --list-datasets

# 列出指定数据集下的文档
python check_ragflow.py --dataset-id <dataset_id>
```

**NOTE**：

- 使用脚本前必须先检查`scripts`文件夹中的`.env`文件是否存在`RAGFLOW_URL`和`RAGFLOW_TOKEN`环境变量，不然无法执行。


## 本地文件或内容的上传与更新

在需要将本地的文件、具体的字符串内容上传到远程的RAGFLow服务器，更新具体的文档的元数据信息时，可以使用使用`scripts`文件夹中的`ragflow_process.py`脚本进行处理。

```bash
#上传文档
python ragflow_process.py upload \
  --dataset-id <dataset_id> \
  --files doc1.md doc2.md

#更新文档元数据
python ragflow_process.py update-meta \
  --dataset-id <dataset_id> \
  --document-id <doc_id> \
  --meta '{"author": "Alice", "version": "1.0"}'

#添加 Chunk
python ragflow_process.py add-chunk \
  --dataset-id <dataset_id> \
  --document-id <doc_id> \
  --content "这是一段知识内容" \
  --keywords keyword1 keyword2 \
  --questions "问题1" "问题2"
```

## 清洗后的长文档上传

对于长文档等进行了分割、解析和目录摘要的构建后，需要指定`dataset-id`、`document-id`、`index-json`、`markdown-dir`来确认需要上传的RAGFlow的数据集、文档ID、清洗后的目录摘要index-json文件和实际文件位置。

```bash
# Step 1: 上传 entries（仅摘要）
python pdf_manual_rag_process.py \
  --dataset-id df102*** \
  --document-id 4a37c*** \
  --index-json /path/to/manual_index.json \
  --markdown-dir /path/to/manual \
  upload

# Step 2: 更新 metadata（自定义字段）
python pdf_manual_rag_process.py \
  --dataset-id df102*** \
  --document-id 4a37c*** \
  --index-json /path/to/manual_index.json \
  --markdown-dir /path/to/manual \
  update-meta --meta-fields '{"file_name": "opendrsai-docs", "file_prefix": "opendrsai-manual-0"}'

# Step 3: 检索
python pdf_manual_rag_process.py \
  --dataset-id df102*** \
  --document-id 4a37c*** \
  --index-json /path/to/manual_index.json \
  --markdown-dir /path/to/manual \
  search --question "What is the purpose of the scan command?"

# Step 3: 检索（自定义参数）
python pdf_manual_rag_process.py \
  --dataset-id df102*** \
  --document-id 4a37c*** \
  --index-json /path/to/manual_index.json \
  --markdown-dir /path/to/manual \
  search --question "How to set up diffractometer?" --page-size 20 --similarity 0.3
```