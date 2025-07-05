高能AI智能体教程01-快速定制你的专业智能体和Web应用(智能体工具使用和MCP协议)
==
Link: https://code.ihep.ac.cn/xdb/openagents

# 1.什么是智能体（Agent）
## 1.1.Agent简介

目前，单纯的大模型只能根据你输入的文字、图像，输出对应的文字或者图像，对比人类，只相当于一个思考过程。但是人类不仅能思考，还能学习知识，根据思考的内容使用工具作出反应。工具的使用成为人类和其它动物最大的分水岭之一。因此，对比大模型，智能体（Agent）便需要拥有这样的能力。智能体思想最早由Gamma等人提出，Russell等人进一步进行了解释：智能体的本质定义为具有环境感知、自主决策与目标导向能力的智能实体，核心要素包括感知（Sensors）、决策（Decisions）和执行(Actuators)。在目前的智能体设计中，通常以大模型为决策者，历史消息记录作为感知来源，Function Call等工具调用作为执行操作。

**那我们究竟什么时候需要构建智能体（Agent）呢？**

- 需要进行智能判断的工作流：智能体可跟任务需要做出相应的决策，调用用工具的进行智能化的任务执行，如行政审核、智能客服等等。
- 非结构化数据处理：面对语言、代码等一些非结构化数据的处理、语义提取、总结等工作，可以使用智能体帮助你进行处理和后续的管理。
- 其它你觉得需要使用智能的使用工具的过程或者工作流...

## 1.2.高能AI智能体和多智能体协作框架简介

![图1 高能AI智能体框架图](https://note.ihep.ac.cn/uploads/050c63b7-3d62-47f4-bf83-b94acf5f5673.png)


高能所计算中HepAI小组基于aotugen开发高能AI智能体和多智能体协作框架：[hepai / DrSai · GitLab](https://code.ihep.ac.cn/hepai/drsai)，并集成到了hepai平台：[hepai / hepai · GitLab](https://code.ihep.ac.cn/hepai/hepai)。我们进一步优化了智能体的设计理念，包括：感知层、执行层、处理中枢、记忆层和持续学习系统。感知层主动感知外部知识、处理中枢以大模型为基座进行决策、记忆层储存着外部矢量数据库或者知识图谱中的专业知识和长期记忆，学习系统通过记忆反馈等方式对大模型进行持续优化。

同时，我们还设计了符合OpenAI格式访问后端和兼容OpenWebui前端的启动方式，在本地调试后可以快速启动为后端模型服务。

下面展示了如何使用高能AI智能体和多智能体协作框架开发一个可调用自定义函数的智能体：

- 要求：python>3.10，然后pip install drsai -U

```python
from drsai import AssistantAgent, HepAIChatCompletionClient, run_console, run_backend
import os, json
import asyncio

# 创建一个工厂函数，用于并发访问时确保后端使用的Agent实例是隔离的。
def create_agent() -> AssistantAgent:
    
    # 定义一个大模型的访问client
    model_client = HepAIChatCompletionClient(
        model="openai/gpt-4o",
        api_key=os.environ.get("HEPAI_API_KEY"),
        base_url = "https://aiapi.ihep.ac.cn/apiv2"
    )

    # 设置一个你需要的功能函数，记得养成良好的函数注释习惯，以便大模型更理解的你的函数
    async def get_weather(city: str) -> str:
        """Get the weather for a given city."""
        return f"The weather in {city} is 73 degrees and Sunny."

    # 定义一个智能体，将大模型访问client和工具赋给智能体
    return AssistantAgent(
        name="weather_agent",
        model_client=model_client,
        tools=[get_weather],
        system_message="You are a helpful assistant.",
        model_client_stream=True,  # Enable streaming tokens from the model client.
    )
if __name__ == "__main__":
     # 命令行界面
     asyncio.run(run_console(agent_factory=create_agent, task="What is the weather in New York?"))
     # 符合OpenAI格式访问后端和兼容OpenWebui前端的启动方式，这将会启动在42801端口，访问url为http://0.0.0.0:42801/apiv2
     # 你可以直接使用OpenAI进行访问
     # asyncio.run(run_backend(agent_factory=create_agent, enable_openwebui_pipeline=True, port=42801))
```

主要的过程包括:
- 大模型访问的client
- 自定义的工具函数
- 智能体，将大模型client和工具函数放入指定变量

为了启动异步的后端服务，智能体将使用一个工厂函数包装。
- 注意：

关于免费的大模型账号，你可以在HepAI Platform中申请统一认证账号，记得尽可能使用单位邮箱申请，担保邮箱填写为：hepai@ihep.ac.cn，模型名称在HaiChat中看到。当然，任何OpenAI格式的API都是兼容的。

记得把api_key保存为环境变量，变量名为 HEPAI_API_KEY 。当然你也可以直接替换，但是切记保密。

# 2.什么是MCP

[MCP (Model Context Protocol)](https://mcpcn.com/docs/introduction/) 是一个开放协议，用于标准化应用程序如何向 LLM 提供上下文。可以将 MCP 想象成 AI 应用程序的 USB-C 接口。就像 USB-C 为设备连接各种外设和配件提供标准化方式一样，MCP 为 AI 模型连接不同的数据源和工具提供了标准化的方式。

**为什么要使用MCP?**

有了MCP协议，不同程序语言开发的服务都可以通过传参等方式进行本地指定环境调用或者远程调用。下面将以arXiv检索和高德地图开放的远程MCP接口为例，演示本地的函数工具和远程的MCP工具如何快速接入高能AI智能体和多智能体协作框架。

![](https://note.ihep.ac.cn/uploads/2cb6a045-a050-4de5-88f5-58fa6780f46c.png)

# 3.如何基于MCP、高能AI智能体框架、OpenWebUI构建一个智能体Web应用

具体见：[xdb@mail.ustc.edu.cn / OpenAgents · GitLab](https://code.ihep.ac.cn/xdb/openagents)

## 3.1.构建一个本地不同环境运行的arXiv MCP工具，构建一个arXiv搜索智能体

**第一步**，使用conda配置分别配置arXiv的MCP工具环境和智能体运行的python环境：

- arXiv的MCP工具环境

```bash
conda create -n mcps python=3.11
pip install requests
pip install mcp
```

- 智能体运行的python环境

```bash
conda create -n drsai python=3.11
pip install drsai -U
```

对应特殊的工具，需要特殊的环境，都可以使用独立的环境进行MCP工具部署。

**第二步**，写你的arXiv MCP工具，可以直接让AI跟你写，如[HaiChat](https://haichatv3.ihep.ac.cn/)。具体代码见：

[arxiv/arxiv_mcp_tool.py · main · xdb@mail.ustc.edu.cn / OpenAgents · GitLab](https://code.ihep.ac.cn/xdb/openagents/-/blob/main/arxiv/arxiv_mcp_tool.py?ref_type=heads)

```python
# -*- coding: utf-8 -*-
# 访问arXiv所需要的包
import requests
import re
# 构建MCP对象
from mcp.server.fastmcp import FastMCP
mcp=FastMCP(
    name="tools",
    instructions="A collection example of tools for MCP.",
    )

async def async_requests_arxiv_home(url: str) -> list[dict]:
    """
    请求arxiv home页面
    """
    for _ in range(5):
        try:
  
            # 发送请求
            response = requests.get(
                url, 
                timeout=30)
            # 检查响应状态码
            if response.status_code!=200:
                continue
            # 解析响应内容
            result=response.content.decode('utf-8')
            # 正则匹配
            result=re.findall("<entry>.*?<id>(.*?)</id>.*?<summary>(.*?)</summary>.*?<title>(.*?)</title>.*?</entry>",result,re.S|re.M|re.DOTALL)
            results=[]
            for i in result:
                results.append({
                    'base_url':i[0],
                    "title":i[2],
                    'abstract':i[1]
                })
            return results
            
        except Exception as e:
            # 如果是超时，则重试
            if isinstance(e, requests.exceptions.Timeout):
                continue

            return "请求失败"

# 注册MCP工具
@mcp.tool()
async def get_arxiv_home(
    search_key: str,
    max_results: int = 10,
    ) -> str:
    """
    根据关键字获取arxiv首页
    params:
        search_key: ArXiv搜索逻辑词，只接受英文字符，如果是中文也需要翻译成英文再搜索

    search_key构造规则：​
        - 字段前缀：​在查询中，使用字段前缀来指定搜索的字段。例如，ti: 表示标题，au: 表示作者，abs: 表示摘要。​
        - 逻辑运算符：​使用布尔运算符（AND、OR、ANDNOT）来构建逻辑关系。请注意，AND 和 OR 是大小写敏感的，必须使用大写字母。​
        - URL 编码：​在构造查询字符串时，确保对特殊字符进行 URL 编码。例如，空格编码为 +，冒号编码为 %3A，括号编码为 %28（左括号）和 %29（右括号）。​
        - 括号使用：​在使用多个逻辑运算符时，使用括号来明确运算顺序。
    例如：​用户需要搜索标题包含"AI Agent"和"material"的论文: search_key = "ti%3AI+Agent+AND+ti%3Amaterial"​

    """
    
    key=search_key.replace(' ','+')
    base_url=f"https://export.arxiv.org/api/query?search_query={key}&start=0&max_results={max_results}"
    results: list[dict] = await async_requests_arxiv_home(base_url)
    result='\n'.join([f"**Title:{i['title']}**\n------------\n**Abstract**:{i['abstract']}\n**URL**:{i['base_url']}\n" for i in results])
    return result


if __name__ == "__main__":
    mcp.run(transport="stdio")
    # 也可以直接运行
    # import asyncio
    # asyncio.run(get_arxiv_home(search_key="ti%3AAI+Agent+AND+ti%3Amaterial"))
```

**第三步**，将arXiv MCP工具接入高能AI智能体

可以看到，直接通过command命令来激活特定的环境，运行不同环境下的工具函数。也可以使用Node、Javad等语言编写你的工具，具体见：[服务器开发 – MCP 中文站（Model Context Protocol 中文）](https://mcpcn.com/docs/quickstart/server/)

```python

# -*- coding: utf-8 -*-
import os, asyncio

# Agent framework
from drsai import AssistantAgent

# Model client
from drsai import HepAIChatCompletionClient 

# MCP tools
from autogen_ext.tools.mcp import StdioServerParams, mcp_server_tools, SseServerParams

# backend thread 
from drsai import run_console, run_backend

# get path
there = os.path.dirname(os.path.abspath(__file__))

# 创建一个工厂函数，用于并发访问时确保后端使用的Agent实例是隔离的。
async def create_agent() -> AssistantAgent:

    # 定义一个大模型的访问client
    model_client = HepAIChatCompletionClient(
        model=os.environ.get("HEPAI_MODEL", "openai/gpt-4o"),
        api_key=os.environ.get("HEPAI_API_KEY"),
        base_url=os.environ.get("HEPAI_API_URL", "https://aiapi.ihep.ac.cn/apiv2"),
        )

    # 获取MCP工具
    MCP_tools=[]
    MCP_tools.extend(await mcp_server_tools(
                StdioServerParams(
                command="conda",
                args=["run", "-n", "mcps", "--live-stream", "python", f"{there}/arxiv_mcp_tool.py"],
                env=None,
                )))

    # 定义一个智能体，将大模型访问client和工具赋给智能体
    return AssistantAgent(
        name="ArXiv_agent",
        model_client=model_client,
        tools=MCP_tools,
        system_message=f"""你是一个可调用arXiv的AI助手。""",
        model_client_stream=True,  # Enable streaming tokens from the model client.
    )

if __name__ == "__main__":
    # 启动一个控制台，你可以输入指令进行交互
    asyncio.run(run_console(agent_factory=create_agent, task="我需要调研关于AI Agent在材料领域的应用?"))
    # 符合OpenAI格式访问后端和兼容OpenWebui前端的启动方式，这将会启动在42701端口，访问url为http://0.0.0.0:42701/apiv2
    # 你可以直接使用OpenAI进行访问
    # asyncio.run(run_backend(
    #     agent_factory=create_agent, 
    #    enable_openwebui_pipeline=True,
    #    port = 42701,
    #    ))

```

## 3.2.构建OpenWebUI前端

```pip install open-webui ```

你还需要：

- 设置HuggingFace镜像：

将HuggingFace镜像：HF-Mirror 加入到本地的环境。对于Linux系统，可以将其加入到~/.bashrc文件中：
```export HF_ENDPOINT=https://hf-mirror.com```

- 启动OpenWebUI前端：
```open-webui serve --port 8088```

## 3.3.将基于智能体与OpenWebUI前端结合

**第一步**，启动智能体后端：

将3.1的代码的命令行运行改成：

```python

...
if __name__ =="__main__":
    # 命令行界面     
    # asyncio.run(run_console(agent_factory=create_agent, task="我需要调研关于AI Agent在材料领域的应用"))
    # 符合OpenAI格式访问后端和兼容OpenWebui前端的启动方式，这将会启动在42701端口，访问url为http://0.0.0.0:42701/apiv2
    # 你可以直接使用OpenAI进行访问
    asyncio.run(run_backend(
        agent_factory=create_agent, 
        port = 42701, 
        enable_openwebui_pipeline=True, 
        agnet_name = "ArXiv",
        history_mode = "backend",
        use_api_key_mode = "backend"
    ))
```

代码启动后示意图如下：

![](https://note.ihep.ac.cn/uploads/a034b62c-036a-424e-be9e-977c9caf42ad.png)

**第三步**，OpenWebUI配置，将密钥0p3n-w3bu!和pipeline后端服务的地址：http://localhost:42701/pipelines 加入OpenWebUI的管理员面板-设置-外部连接-管理OpenAI API连接中。

完成以上的步骤，你就可以在OpenWebUI的前端中看到名字为ArXiv的智能体

![](https://note.ihep.ac.cn/uploads/d5cd6f79-f6a6-4705-818b-33f9ea99fe9e.png)

## 3.4.基于高德地图的远程MCP工具构建智能体

除了自己开发的工具，还可以使用各大厂商开发的远程MCP工具，如：[魔搭社区的MCP工具](https://modelscope.cn/mcp)，接入更为方便，下面以高德地图的远程MCP工具接入为例。

首先，你需要获取高德地图的MCP工具和API KEY/高德地图MCP链接： https://lbs.amap.com/api/mcp-server/summary 。APIKEY在高德地图开放平台申请，申请地址：https://console.amap.com/dev/key ，加入当前文件夹的.env文件中：```AMAP_MAPS_API_KEY="YOUR_API_KEY"``` 。

**第一步**，确定安装好了高能AI智能体和多智能体协作框：

- 要求：python>3.10，然后pip install drsai -U 

**第二步**，将高德地图的MCP工具接入高能AI智能体：

可以看到，直接使用url便可以访问到远程部署的MCP工具服务。

```python

# -*- coding: utf-8 -*-
import os, asyncio
# Agent framework
from drsai import AssistantAgent

# Model client
from drsai import HepAIChatCompletionClient 

# MCP tools
from autogen_ext.tools.mcp import StdioServerParams, mcp_server_tools, SseServerParams

# backend thread 
from drsai import run_console, run_backend

# Load .env file
from dotenv import load_dotenv
load_dotenv()

# 创建一个工厂函数，用于并发访问时确保后端使用的Agent实例是隔离的。
async def create_agent() -> AssistantAgent:

    # 定义一个大模型的访问client
    model_client = HepAIChatCompletionClient(
        model=os.environ.get("HEPAI_MODEL", "openai/gpt-4o"),
        api_key=os.environ.get("HEPAI_API_KEY"),
        base_url=os.environ.get("HEPAI_API_URL", "https://aiapi.ihep.ac.cn/apiv2"),
        )

    # 获取高德地图的MCP工具
    MCP_tools=[]
    amap_api_key = os.getenv("AMAP_MAPS_API_KEY")
    MCP_tools.extend(await mcp_server_tools(SseServerParams(
                                url=f"https://mcp.amap.com/sse?key={amap_api_key}",
                                env=None)
                        ) )

    # 定义一个智能体，将大模型访问client和工具赋给智能体
    return AssistantAgent(
        name="Amap_agent",
        model_client=model_client,
        tools=MCP_tools,
        system_message=f"""你是一个可调用工具进行出游规划的助手，你需要根据用户的要求，依次调用相应的工具进行任务规划。""",
    )



if __name__ == "__main__":
    # 命令行界面
    asyncio.run(run_console(agent_factory=create_agent, task="北京今天的天气如何?"))
    # 符合OpenAI格式访问后端和兼容OpenWebui前端的启动方式，这将会启动在42701端口，访问url为http://0.0.0.0:42701/apiv2
    # 你可以直接使用OpenAI进行访问
    # asyncio.run(run_backend(agent_factory=create_agent, enable_openwebui_pipeline=True, port = 42701))
```
    
**第三步**，启动智能体后端，并接入OpenWebUI前端，具体同3.2节

完成以上的步骤，你就可以在OpenWebUI的前端中看到名字为AMAP的智能体：

![](https://note.ihep.ac.cn/uploads/49b5ae59-c953-471b-8ea8-e40989ad3da2.png)

## 4.写在最后

AMAP输出将是json形式，这就需要对MCP的输出内容进行进一步的优化，这将在下一集继续讲解。