# 高能万悟(Wanwu)智能体平台-OpenDrSai科学智能体开发框架

## [English](README_en.md) | 简体中文

由中国科学院高能物理研究所[HepAI](https://ai.ihep.ac.cn/)团队开发的智能体、多智能体协同系统快速开发和部署一体化框架，可快速地开发和部署自己的智能体、多智能体协同系统前后端服务。

<div align="center">
  <p>
      <img width="30%" src="assets/drsai.png" alt="适配逻辑图">
  </p>
</div>

该开发框架基于Microsoft开源框架[AutoGen](https://github.com/microsoft/autogen)（当前0.5.7版本），在兼容AutoGen完整结构和生态的基础上，重新设计了智能体、多智能体系统的组件和开发逻辑，使其更适合于开发**专业科学智能体和多智能体系统🤖：如复杂多任务执行💡、状态管理和人机交互🙋‍♂️🙋‍♀️、专业科学工具管理和执行🛠️、长任务执行管理⏰、长短记忆管理等🧠**。与主流MCP、A2A协议、[HepAI](https://ai.ihep.ac.cn/)的相关生态、RAGFlow等主流RAG架构具有很好的兼容性。而且具备开发部署一体化能力，智能体或多智能体系统代码可一键启动，注册为openai ChatCompletions格式、HepAI Worker格式，作为API调用。并配套相应的人机交互前端，可以直接开发部署完整的前后端应用。

## 1.特色

- 1.可基于[HepAI平台](https://aiapi.ihep.ac.cn/)进行智能体基座模型的灵活切换，以及工具、知识库等智能体组件的灵活配置。同时兼容OpenAI ChatCompletions，Ollama等模型格式接入。
- 2.为智能体和多智能体系统设计了感知、思考、记忆、执行、状态管理等预定义组件，并进行了插件化设计，可灵活扩展，满足多种专业智能体设计应用场景。
- 3.提供了一键启动的人机交互前后端，实现了开发即应用。并为智能体和多智能体协作系统交互提供了兼容OpenAI ChatCompletions、OpenWebui-Pipeline的标准后端接口，可将智能体和多智能体协作系统作为第三方的模型或智能体API服务。

### &#x1F4E2; 功能比较

|      功能       | 高能万悟(Wanwu)-OpenDrSai智能体开发框架 |    AutoGen     |    Camel AI    |    LangChain   |    AutoGPT     | Dify.AI |
| :-------------: | :------------: | :------------: | :------------: | :------------: | :------------: | :------------: |
| 框架特征 | ✅基于AutoGen，针对科学任务优化，扩展性和人机交互能力强，能可视化和低代码构建专业科学智能体和多智能体系统 | 以对话驱动的多智能体协同架构，模块化和通用性强，生态较好，但只提供基本框架功能 | 基于角色扮演+启示式提示的协作架构，生态较好 | 模块式组装开发  | 集成度较高的智能体和多智能体架构  | 低代码平台，可拖拽构建，扩展性较差 |
| 模型接入 | ✅支持专业科学模型的接入及开发策略 | 目前只支持通用的大模型格式接入 | 目前只支持通用的大模型格式接入 | 目前只支持通用的大模型格式接入  | 目前只支持通用的大模型格式接入  | 目前只支持通用的大模型格式接入  |
| 专业科学数据接入 | ✅开发了感知器等专业科学数据接入策略 | 需要开发 | 暂无 | 暂无 | 暂无 | 暂无 |
| 记忆与知识 | ✅模块化的专业知识接入、长期智能记忆管理 | 需要开发 | ✅具有长期智能记忆 | 需要开发 | ✅具有长短期记忆机制 | ✅内置知识库和消息存储功能 |
| 科学工具| ✅支持MCP/OpenAPI/HepAI Worker等多种工具、资源接入方式 | 只支持MCP Tool格式和本地函数，其它需要进一步开发 | ✅预设了多种通用工具和多种接入方式 | 需要开发 | 需要开发 | 内置有限工具，专业工具需要开发 |
| 学习反思 | ✅模块化的反思和学习 | 需要开发 | ✅内置反思过程和学习步骤 | 需要开发 | ✅内置反思过程和学习步骤 | 反思能力有限，主要依赖 RAG |
| 状态管理与人机交互 | ✅支持前后端人机交互 | 基础的userproxy模式，需要进一步开发 | 基础的userproxy模式，需要进一步开发 | 需要开发 | 需要开发 | 暂无 |
| 长时间任务执行管理 | ✅支持超长时间科学任务监控与守护 | 暂无 | 暂无 | 暂无 | 暂无 | 暂无 |
| 框架模块化和扩展性 | ✅模块化、扩展性强 | ✅模块化、扩展性强 | ✅模块化、扩展性强 | 具有较强的模块化、扩展性 | 扩展性较差 | 扩展性较差 |
| 交互式应用开发 | ✅具有开发即应用的特性，构建的智能体可直接转化为人机交互的web应用 | 在AutoGen Studio中可进行拖拽构建多智能体系统 | 在CAMEL Web App进行前端应用 | 需要与其他开源界面集成 | 需要与其他开源界面集成 | 前端可拖拽构建智能体应用 |

> 截止时间：2025年11月25日

------

## 2.快速开始

### 2.1.安装OpenDrSai

#### pip 安装

```shell
conda create -n drsai python=>3.11
conda activate drsai
pip install drsai drsai_ui -U
# NOTE: if you have installed hepai<=1.40.0, please keep opneai<= 1.98.0
```

#### 源码安装

```shell
conda create -n drsai python=>3.11
conda activate drsai
git clone https://code.ihep.ac.cn/hepai/drsai drsai

cd your/path/to/drsai/python/packages/drsai && pip install -e . # for OpenDrSai backend and agent components
cd your/path/to/drsai/python/packages/drsai_ui && pip install -e . # for DrSai-UI  human-computer interaction frontend
```

#### 配置HepAI平台的API访问密钥

配置[HepAI](https://aiapi.ihep.ac.cn)DDF2平台的API访问密钥等环境变量(Based on bash)：

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

**NOTE:** 所有OpenAI格式的模型都可以使用以上方式接入。其他格式的模型接入见：tutorials/components/ModelClient01.md

### 2.2.快速启动一个大模型智能体

以[examples/agent_groupchat/assistant_base_R1_oai.py](examples/agent_groupchat/assistant_base_R1_oai.py)为例，展示了如何基于OpenDrSai快速启动一个智能体系统。

```shell
conda activate drsai
python examples/agent_groupchat/assistant_base_R1_oai.py
```

**NOTE**: 请根据自己的测试需要更改```if __name__ == "__main__":```中的智能体启动方式。

**NOTE**: examples/agent_groupchat中还包括了其他智能体和多智能体系统的案例，包括MCP等工具接入、RAG接入、多智能体协作系统的设计、多任务执行的设计等。

### 2.3.命令行启动OpenDrSai人机交互后端服务

```shell
# pip install drsai_ui -U # 确保安装了drsai_ui

cp .env.example .env # 复制.env.example文件为.env, 可用于高能所部署统一认证
drsai ui # 启动Dr.Sai-UI人机交互后端和静态前端
```

后端和静态前端默认启动在8081端口，```drsai --help```获取更多的启动参数，连接2.2启动的R1_test智能体并在前端进行交互的视频如下：

<video width="80%" controls>
  <source src="assets/video/drsai_ui.mp4" type="video/mp4">
</video>

[下载演示视频](assets/video/drsai_ui.mp4)

**NOTE:**

- DrSai-General 功能需要编译python执行沙盒和浏览器VNC的Docker镜像，请确保安装了docker环境。具体docker镜像及安装配置见[docker](docker/README.md)


### 2.4.人机交互前端

#### 配置npm环境

安装node

```shell
# install nvm to install node
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
nvm install node # recommended node version ~ 22
```

安装前端依赖

```shell
cd your/path/to/drsai/frontend
npm install -g gatsby-cli
npm install --global yarn
yarn install

# *********NOTE：*********
# cp .env.default .env.development or .env.production # 复制.env.default文件为.env.development或.env.production
# 开发环境变量为frontend/.env.development
# 生产环境变量为frontend/.env.production
# ************************

# yarn build # 打包前端静态资源
yarn run dev # 启动前端开发环境
```

### 2.5.通过配置文件运行智能体/多智能体服务（可选的）

```shell
# pip install drsai_ui -U # 确保安装了drsai_ui
drsai console --agent-config agent_config.yaml # 启动命令行模式的智能体/多智能体服务
drsai backend --agent-config agent_config.yaml # 将智能体/多智能体部署为OpenAI格式的后端模型服务
```

**NOTE:**

- agent_config.yaml文件展示了智能体和多智能体的配置信息，进行智能体尝鲜，或者前端用户自定义配置智能体时可以根据配置文件进行智能体/多智能体系统的快速创建，一个案例如下：

```yaml
# 定义你的智能体基座模型
model_config: &client
  provider: drsai.HepAIChatCompletionClient
  config:
    model: openai/gpt-4o
    api_key: sk-****
    base_url: "https://aiapi.ihep.ac.cn/apiv2"
    max_retries: 10
# 组装你的智能体
myassistant:
  type: AssistantAgent # 定义智能体类型，由OpenDrSai提供或者自己代码开发
  name: myassistant
  system_message: "You are a helpful assistant who responds to user requests based on your tools and knowledge."
  description: "An agent that provides assistance with ability to use tools."
  model_client: *client
```

具体的配置项说明见[配置文件说明文档](docs/agent_factory.md)。在我们[AI平台](https://drsai.ihep.ac.cn)上，提供了丰富的智能体的基座模型、MCP/HEPAI Worker工具、RAG记忆插件；多种逻辑的智能体和多智能体框架；一些预设的智能体/多智能体工作模式供你选择。你可以在前后端选择适合你的智能体/多智能体框架和工具、知识库等，快速搭建自己的智能体/多智能体协作系统。通过配置快速构建智能体/多智能体系统详细的说明见：```docs/agent_factory.md```.


## 3.开发计划(TODO)

### 3.1.智能体组件开发

- [ ] 模型层：正在开发支持特殊格式数据的小模型的接入，定制相应的消息类型和事件类型

~~-支持HepAI平台的模型接入，具体见examples/components/model_client01.py~~

- [ ] 感知层：正在开发默认支持可UTF-8编码的文本附件的解析和聊天上下文注入。

- [ ] 记忆层：正在进一步开发DrSaiChatCompletionContext中长期记忆通过与RAGFlow进行关联并进行长期记忆的查询

~~-开发基于提示词的进行长记忆压缩的ChatCompletionContext类，具体见examples/components/model_context01.py~~

- [ ] 知识库层：正在开发兼容Llama_index的知识库组件

~~-基于组件化开发兼容HepAI RAGFlow的知识库组件，具体见examples/components/memory_ragflow01.py~~-

- [ ] 执行层: 1.正在进一步开发针对MCP工具调用，开发可进行流式输出的调用方式，并与前端联动;2.本地函数的长任务调用

- [ ] 状态管理系统：暂无进一步开发计划，欢迎提出需求。

~~进一步支持长任务的状态管理，但是用户进一步开发智能体工具端、智能体长任务查询逻辑等，具体见python/packages/drsai/src/drsai/modules/baseagent/drsaiagent.py的_process_long_task_query函数~~

- [ ] 文件管理系统：正在进一步开发文件缓存和注入系统

- [x] 智能体配置管理系统：暂无开发计划，欢迎提出需求。

~~进一步优化智能体配置和基于组件化和快照回复的智能体配置管理，具体见python/packages/drsai/src/drsai/modules/baseagent/drsaiagent.py的_to_config、_from_config与save_state、load_state函数。~~

- [ ] 智能体学习系统: 正在进一步开发智能体学习系统，在智能体回复结束后异步记录智能体根据聊天上下文任务回复的内容和策略，存入智能体知识库

- [x] 智能体的事件与通知：暂无进一步开发计划，欢迎提出需求。

~~构建智能体与Dr.Sai UI的前端前后消息联动：ModelClientStreamingChunkEvent输出流式事件；AgentLogEvent输出智能体对外展示的log事件；TaskEvent发送后端任务执行进度事件，具体见examples/agent_groupchat/assistant_custom_log_event-interaction.py~~

### 3.2.专业智能体

- [ ] 长任务处理智能体及开发教程: 开发支持自我规划和多工具调用的组件调度器，作为通用的规划执行智能体

- [ ] 深度检索智能体及开发教程：开发基于长记忆和自我规划的深度检索智能体

- [ ] 包含长任务处理的多智能体系统及开发教程

### 3.3.多智能体系统开发

- [ ] 进一步开发基于长任务守护的多智能体协同架构案例，保证长任务可在后台持续运行，人机可随时交互

~~可进行长任务查询的智能体多智能体系统相互协同的长任务管理系统，具体案例见：examples/agent_groupchat/groupchat_task_LongTask~~

- [ ] 多智能体系统层面的学习反思系统

- [ ] 基于任务分发机制多智能体系统协同调度器

- [ ] 可进行多远程智能体协同的多智能体系统案例

### 3.4.人机交互前后端开发

- [ ] 后端数据库的自动生成id设计为UUID，以代替现在使用整数id进行自动排序的设计

- [ ] drsai后端的智能体实例在长时间不运行时自动pop, 节约资源。

~~- [x] 前端UI的任务管理系统展示交互~~

~~- [x] 前端UI的执行文件、log等信息的展示交互~~

- [ ] 前端UI的长任务的展示交互

- [ ] 默认登录系统开发

- [ ] drsai hub展示与缓存机制

- [ ] 非文本文件和大文件的上传与智能体接收机制开发，计划通过文件系统进行前后端大文件交互

- [ ] 开放可链接RAGFlow知识库/记忆知识库和MCP远程函数的智能体调用，数据格式符合python/packages/drsai_ui/src/drsai_ui/configs/agent_config.yaml（尽快）


## 4.详细文档

培训教程可见：[OpenDrSai-tutorials-v3.pdf](tutorials/OpenDrSai-tutorials-v3.pdf)

详细的教程见tutorials目录（正在开发中，有问题及时联系我们）：

```text
tutorials/base01-hepai.md：HepAI平台的模型配置和使用
tutorials/base02-worker.md：HEPAI Worker远程函数的配置和使用
tutorials/base03-use_claude-code.md：基HepAI平台于Claude-Code的使用
tutorials/agents：智能体/多智能体系统案例
tutorials/components：智能体组件开发案例
tutorials/request: 客户端请求案例
```

文档说明见docs目录（正在开发中，有问题及时联系我们）：

```text
docs/develop.md: 智能体/多智能体系统代码开发说明
docs/agent_factory.md: 智能体/多智能体开放和社区开发指南
docs/drsai_ui.md: 人机交互前端使用指南
docs/open-webui.md：OpenAI格式的前端访问，以及OpenWebui的Pipeline插件的使用指南
```

## 5.参与贡献

欢迎参与OpenDrSai的开发，贡献代码、文档、问题、建议等。我们社区欢迎各种形式的贡献，包括但不限于：

- 代码贡献：包括智能体/多智能体系统组件开发、智能体/多智能体系统案例、前端UI开发等。
- 文档贡献：包括智能体/多智能体系统文档、教程、FAQ等。
- 问题反馈：包括Bug反馈、功能建议、使用问题等。
- 社区活动：包括线下活动、线上沙龙、线上分享等。 

## 6.联系我们

- 邮箱：<hepai@ihep.ac.cn> / <zdzhang@ihep.ac.cn> / <xiongdb@ihep.ac.cn>
- 微信：xiongdongbo_12138
- 微信群聊：HepAI大模型技术交流3群：

<img src="assets/微信三群.jpg" alt="微信三群" style="max-width:20%; height:auto;">