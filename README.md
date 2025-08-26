#### [English](README_en.md) | 简体中文

# OpenDrSai 

由中国科学院高能物理研究所[HepAI](https://ai.ihep.ac.cn/)团队开发的智能体与多智能体系统快速开发和部署一体化框架，可快速地开发和部署自己的智能体与多智能体协作系统前后端服务。

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

## 2.快速开始

### 2.1.安装OpenDrSai

#### 源码安装(推荐)
```shell
conda create -n drsai python=>3.11
conda activate drsai
git clone https://code.ihep.ac.cn/hepai/drsai drsai

cd your/path/to/drsai/python/packages/drsai && pip install -e . # for OpenDrSai backend and agent components
cd your/path/to/drsai/python/packages/drsai_ui && pip install -e . # for DrSai-UI  human-computer interaction frontend
```
#### pip 安装

```shell
conda create -n drsai python=>3.11
conda activate drsai
pip install drsai drsai_ui -U
# NOTE: if you have installed openai>=1.99.0, please keep opneai<= 1.98.0
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

#### 智能体案例测试

以[examples/oai_client/assistant_R1_oai.py](examples/oai_client/assistant_R1_oai.py)为例，展示了如何基于OpenDrSai快速开发一个智能体系统。

### 2.2.人机交互前端启动

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

# cp .env.default .env.development or .env.production # 复制.env.default文件为.env.development或.env.production
# 开发环境变量为frontend/.env.development
# 生产环境变量为frontend/.env.production

# yarn build # 打包前端静态资源
yarn run dev # 启动前端开发环境
```

### 2.3.命令行启动OpenDrSai服务

```shell
# pip install drsai_ui -U # 确保安装了drsai_ui

cp .env.example .env # 复制.env.example文件为.env
drsai ui # 启动Magenti-UI人机交互后端和静态前端

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

## 3.详细文档
详细的教程见tutorials目录（正在开发中，有问题及时联系我们）：
```
tutorials/base01-hepai.md：HepAI平台的模型配置和使用
tutorials/base02-worker.md：HEPAI Worker远程函数的配置和使用
tutorials/base03-use_claude-code.md：基HepAI平台于Claude-Code的使用
tutorials/agents：智能体/多智能体系统案例
tutorials/components：智能体组件开发案例
```

文档说明见docs目录（正在开发中，有问题及时联系我们）：
```
docs/develop.md: 智能体/多智能体系统代码开发说明
docs/agent_factory.md: 智能体/多智能体开放和社区开发指南
docs/drsai_ui.md: 人机交互前端使用指南
docs/open-webui.md：OpenAI格式的前端访问，以及OpenWebui的Pipeline插件的使用指南
```

## 4.参与贡献

欢迎参与OpenDrSai的开发，贡献代码、文档、问题、建议等。我们社区欢迎各种形式的贡献，包括但不限于：

- 代码贡献：包括智能体/多智能体系统组件开发、智能体/多智能体系统案例、前端UI开发等。
- 文档贡献：包括智能体/多智能体系统文档、教程、FAQ等。
- 问题反馈：包括Bug反馈、功能建议、使用问题等。
- 社区活动：包括线下活动、线上沙龙、线上分享等。 

## 5.联系我们

- 邮箱：hepai@ihep.ac.cn/xiongdb@ihep.ac.cn
- 微信：xiongdongbo_12138
- 微信群聊：HepAI大模型技术交流3群：
![alt text](assets/微信三群.jpg)