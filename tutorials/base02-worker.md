# HepAI 远程worker服务开发指南

## 1.HepAI 远程worker简介

远程模型（Remote Model）是高能AI框架的特色功能之一，通过将模型等任意软件程序搭载到Worker中部署到云端服务器，搭配高能AI客户端实现远程模型等低延迟、分布式调用。
![](https://note.ihep.ac.cn/uploads/da196242-57c3-45cc-af98-3465bb48aea7.png)

**主要的作用：**

- 1.远程部署工具/服务等，并通过[DDF](https://aiapi.ihep.ac.cn/mkdocs/workers/)和统一认证，利用HEPAI_API_KEY进行统一鉴权。
- 2.远程部署的工具/服务可以直接作为智能体工具使用。

具体见：https://aiapi.ihep.ac.cn/mkdocs/workers/

## 2.开发和使用示例

### 2.1.一个完整的示例

```python
from typing import Dict, Union, Literal
from dataclasses import dataclass, field
import json
import hepai as hai
from hepai import HRModel, HModelConfig, HWorkerConfig, HWorkerAPP

@dataclass
class CustomModelConfig(HModelConfig):
    name: str = field(default="hepai/custom-model", metadata={"help": "Model's name"})

@dataclass
class CustomWorkerConfig(HWorkerConfig):
    host: str = field(default="0.0.0.0", metadata={"help": "Worker's address, enable to access from outside if set to `0.0.0.0`, otherwise only localhost can access"})
    port: int = field(default=4260, metadata={"help": "Worker's port, default is None, which means auto start from `auto_start_port`"})
    # controller_address: str = field(default="http://localhost:42601", metadata={"help": "Controller's address"})
    controller_address: str = field(default="https://aiapi.ihep.ac.cn", metadata={"help": "Controller's address"})
    no_register: bool = field(default=False, metadata={"help": "Do not register to controller"})
    permissions: str = field(default='users: admin;groups: payg', metadata={"help": "Model's permissions, separated by ;, e.g., 'groups: default; users: a, b; owner: c'"})
    
class CustomWorkerModel(HRModel):  # Define a custom worker model inheriting from HRModel.
    def __init__(self, config: HModelConfig):
        super().__init__(config=config)

    @HRModel.remote_callable  # Decorate the function to enable remote call.
    def custom_method(self, a: int = 1, b: int = 2) -> int:
        """Define your custom method here."""
        return a + b
    
    @HRModel.remote_callable
    def get_stream(self):
        for x in range(10):
            yield f"data: {json.dumps(x)}\n\n"
            
            
    @HRModel.remote_callable
    def get_info(self) -> Dict[str, Union[str, int]]:
        """Get model info."""
        return {
            "name": self.name,
        }

if __name__ == "__main__":

    import uvicorn
    from fastapi import FastAPI
    model_config, worker_config = hai.parse_args((CustomModelConfig, CustomWorkerConfig))
    model = CustomWorkerModel(model_config)  # Instantiate the custom worker model.
    app: FastAPI = HWorkerAPP(model, worker_config=worker_config)  # Instantiate the APP, which is a FastAPI application.
    
    print(app.worker.get_worker_info(), flush=True)
    # 启动服务
    uvicorn.run(app, host=app.host, port=app.port)

```

**详情解析：**

- 1. CustomModelConfig类：

    - name：别人访问你worker的名字，必填

- 2. CustomWorkerConfig（用于控制你worker的访问途径）：
    - host：你worker启动的方式，"0.0.0.0"表示内外网都可以访问，"127.0.0.1"表示只能本地访问
    - port：你worker启动的网络端口号
    - controller_address：你worker启动的注册的网站，如果需要在别的网络或需要被其他人访问，建议注册到"https://aiapi.ihep.ac.cn"
    - no_register：是否注册到controller_address，即是否把你worker注册到controller_address，以便在别的网络或给其他人访问
    - permissions：设置权限，如果'groups: default; users: a@ihep.ac.cn, b@ihep.ac.cn; owner: c@ihep.ac.cn'，则表示只能高能所统一认证平台default组，用户为users和owner中的账号才可以使用。

- 3.在CustomWorkerModel中定义你自己的功能函数

以上代码中，除了worker的基本信息，你只需要在CustomWorkerModel中写你的自己的功能函数，然后在函数开头加一个@HRModel.remote_callable，这样这个函数就可以在远程被使用。正如：custom_method、get_stream和get_info三个函数。

**启动：**

保存以上文件，在命令行中直接：```python xx.py```

### 2.2.远程使用本地部署worker的方法

通过get_worker_sync_functions和get_worker_async_functions，可以将以上@HRModel.remote_callable修饰的函数转化直接可执行的同步或者异步函数。

```python
from hepai import HRModel
import os
from hepai.tools.get_woker_functions import get_worker_sync_functions, get_worker_async_functions

api_key = os.environ.get("HEPAI_API_KEY")
funcs_decs = get_worker_sync_functions(name="hepai/web_search", api_key=api_key, base_url="https://aiapi.ihep.ac.cn/apiv2")
print([f.__name__ for f in funcs_decs])

print(funcs_decs[2]())
```

**注意：** 如果你在CustomWorkerConfig中no_register设置为True，表示你不会注册到HepAI平台开放使用，则base_url="http://localhost:42601"。
