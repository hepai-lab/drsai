# OpenDrSai 

由高能物理研究所Dr.Sai团队开发的智能体与多智能体协同系统快速开发框架，可快速地开发和部署自己的智能体与多智能体协作系统后端服务。

<div align="center">
  <p>
      <img width="30%" src="assets/drsai.png" alt="适配逻辑图">
  </p>
</div>

## 1.特色

- 1.可基于[HepAI平台](https://ai.ihep.ac.cn/)进行智能体基座模型的灵活切换。
- 2.为智能体设计了感知、思考、记忆、执行等行为功能，并进行了插件化设计，可灵活扩展，满足多种应用场景。
- 3.为智能体和多智能体协作系统交互提供了兼容OpenAI Chat和Magenti-UI的标准后端接口，可与兼容OpenAI输出的前端和Magenti-UI人机交互前端进行无缝对接，从而可将智能体和多智能体协作系统作为模型或智能体服务进行部署。

## 2.快速开始

### 2.1.安装OpenDrSai

#### pip 安装

```shell
conda create -n drsai python=>3.11
conda activate drsai
pip install drsai -U
```

#### 从源码安装和配置OpenDrSai运行环境

创建[code.ihep.ac.cn](https://code.ihep.ac.cn/)账号，克隆OpenDrSai仓库到本地：
```shell
git clone https://code.ihep.ac.cn/hepai/drsai.git drsai
cd drsai
```

配置conda环境，安装依赖包：
```shell
conda create -n drsai python>=3.11
conda activate drsai
pip install -e .  # 以开发者模式安装，任何仓库内的修改会直接生效 ，无需重新安装。
```

#### 配置HepAI平台的API访问密钥

配置[HepAI](https://ai.ihep.ac.cn)DDF2平台的API访问密钥等环境变量(Based on bash)：

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

### 2.2.命令行启动OpenDrSai服务

```shell
pip install drsai_ui -U 
drsai console --agent-config agent_config.yaml # 启动命令行模式的智能体/多智能体服务
drsai backend --agent-config agent_config.yaml # 将智能体/多智能体部署为OpenAI格式的后端模型服务
drsai ui # 启动Magenti-UI人机交互前端
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
见docs目录：
```
docs/develop.md: 智能体/多智能体系统开发指南
docs/agent_factory.md: 智能体/多智能体开放和社区开发指南
docs/drsai_ui.md: 人机交互前端使用指南
docs/open-webui.md：OpenAI格式的前端访问，以及OpenWebui的Pipeline插件的使用指南
```

## 7.联系我们

- 邮箱：hepai@ihep.ac.cn/xiongdb@ihep.ac.cn
- 微信：xiongdongbo_12138