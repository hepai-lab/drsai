# Open-WebUI

Link: https://github.com/open-webui/open-webui

## 1.OpenWebUI Pipeline接入

### 1.1.启动包含OpenWebUI Pipeline的OpenDrSai服务

代码启动：
```python
asyncio.run(run_backend(agent_factory=create_agent, enable_openwebui_pipeline=True))
```
命令行启动：
```shell
drsai backend --agent-config agent_config.yaml
```

后端默认启动在```http://localhost:42801/apiv2```, 通过```port```参数可自定义端口；OpenWebUI Pipeline默认启动在```http://localhost:42801/pipelines```

### 1.2.安装OpenWebUI

```shell
pip install open-webui
```

**设置HuggingFace镜像：**
将HuggingFace镜像：'HF_ENDPOINT '= 'https://hf-mirror.com'加入到本地的环境。对于Linux系统，可以将其加入到~/.bashrc文件中：
```export HF_ENDPOINT=https://hf-mirror.com```

在命令行中运行：```open-webui serve --port 8088```启动OpenWebUI服务。

### 1.3.配置OpenWebUI Pipeline

pipeline的密钥在```drsai/backend/pipelines/config.py```中，默认为：```0p3n-w3bu!```，将密钥和pipeline后端服务的地址：```http://localhost:42801/pipelines```加入OpenWebUI的```管理员面板-设置-外部连接-管理OpenAI API连接```中。

### 1.4.自定义Pipeline

将OpenDrSai项目中的```drsai/backend/owebui_pipeline/pipelines/pipelines/drsai_pipeline.py```复制到在自定义文件夹下，进行自定义修改，设置环境变量```PIPELINES_DIR```，或者启动参数pipelines_dir=指定文件夹，让OpenWebUI Pipeline加载自定义的pipeline文件

## 一些问题

- 1.open-webui重复打印：需要注释open-webui源码```utils/middleware.py```中的```post_response_handler```函数中的```tag_content_handler```函数中的：

```python
# if before_tag:
#     content_blocks[-1]["content"] = before_tag
```
- 2.前端的chat_id通过"chat_id"传递给了后端。