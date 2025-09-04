#### [English](README_en.md) | 简体中文

# OpenDrSai

An integrated framework for rapid development and deployment of agents and multi-agent systems, developed by the [HepAI](https://ai.ihep.ac.cn/) team at the Institute of High Energy Physics, Chinese Academy of Sciences. It enables fast creation and deployment of backend and frontend services for custom agent and multi-agent collaboration systems.

<div align="center">
  <p>
      <img width="30%" src="assets/drsai.png" alt="Adaptation Logic Diagram">
  </p>
</div>

This framework is built upon Microsoft’s open-source project [AutoGen](https://github.com/microsoft/autogen) (current version 0.5.7). While maintaining full compatibility with the structure and ecosystem of AutoGen, it redesigns the components and development logic of agent and multi-agent systems, making it more suitable for **professional scientific agents and multi-agent systems 🤖: such as complex multi-task execution 💡, state management and human-computer interaction 🙋‍♂️🙋‍♀️, professional scientific tool management and execution 🛠️, long-duration task execution ⏰, and both short-term and long-term memory management 🧠**.

It ensures strong compatibility with mainstream MCP and A2A protocols, the [HepAI](https://ai.ihep.ac.cn/) ecosystem, and RAGFlow as a representative RAG architecture. Moreover, it integrates both development and deployment: agent or multi-agent system code can be launched with a single command, registered as an OpenAI ChatCompletions format service or a HepAI Worker service, and directly exposed as an API. Together with the bundled human-computer interaction frontend, developers can directly build and deploy complete end-to-end applications.

## 1. Features

* 1. Flexible switching of base models for agents via the [HepAI platform](https://aiapi.ihep.ac.cn/), along with dynamic configuration of tools, knowledge bases, and other agent components. Supports integration of OpenAI ChatCompletions, Ollama, and other model formats.
* 2. Provides pre-defined components for perception, reasoning, memory, execution, and state management in agent and multi-agent systems. These are plugin-based and extensible, meeting diverse professional use cases.
* 3. Offers a one-click launch for human-computer interaction frontends and backends, enabling “development-as-deployment.” Compatible backend interfaces (OpenAI ChatCompletions, OpenWebUI-Pipeline) allow the system to serve as a third-party model or agent API.

## 2. Quick Start

### 2.1 Install OpenDrSai

#### From source (recommended)

```shell
conda create -n drsai python=>3.11
conda activate drsai
git clone https://code.ihep.ac.cn/hepai/drsai drsai

cd your/path/to/drsai/python/packages/drsai && pip install -e . # for OpenDrSai backend and agent components
cd your/path/to/drsai/python/packages/drsai_ui && pip install -e . # for DrSai-UI human-computer interaction frontend
```

#### Install via pip

```shell
conda create -n drsai python=>3.11
conda activate drsai
pip install drsai drsai_ui -U
# NOTE: if you have installed openai>=1.99.0, please keep openai<=1.98.0
```

#### Configure HepAI Platform API Key

Set environment variables for the [HepAI](https://aiapi.ihep.ac.cn) DDF2 platform API key (based on bash):

Linux/macOS:

```shell
vi ~/.bashrc
export HEPAI_API_KEY=your_api_key
source ~/.bashrc
```

Windows:

```shell
setx "HEPAI_API_KEY" "your_api_key"
# Note: Windows environment variables require a system restart to take effect
```

#### Agent Example Test

See [examples/agent\_groupchat/assistant\_R1\_oai.py](examples/agent_groupchat/assistant_R1_oai.py) for a demonstration of quickly developing an agent system with OpenDrSai.

### 2.2 Launch OpenDrSai Service via CLI

```shell
# pip install drsai_ui -U # ensure drsai_ui is installed

cp .env.example .env # copy .env.example to .env
drsai ui # start Magenti-UI backend and static frontend

drsai console --agent-config agent_config.yaml # start CLI-based agent/multi-agent service
drsai backend --agent-config agent_config.yaml # deploy agent/multi-agent system as an OpenAI-compatible backend service
```

**NOTE:**

* The `agent_config.yaml` file defines configuration information for agents and multi-agent systems. It allows quick prototyping or customization, enabling rapid creation of agent/multi-agent systems based on configuration files. Example:

```yaml
# Define your base agent model
model_config: &client
  provider: drsai.HepAIChatCompletionClient
  config:
    model: openai/gpt-4o
    api_key: sk-****
    base_url: "https://aiapi.ihep.ac.cn/apiv2"
    max_retries: 10
# Assemble your agent
myassistant:
  type: AssistantAgent # agent type, provided by OpenDrSai or custom-developed
  name: myassistant
  system_message: "You are a helpful assistant who responds to user requests based on your tools and knowledge."
  description: "An agent that provides assistance with ability to use tools."
  model_client: *client
```

For detailed configuration instructions, see [Configuration Documentation](docs/agent_factory.md). On our [AI platform](https://drsai.ihep.ac.cn), we provide a rich set of base models, MCP/HEPAI Worker tools, RAG memory plugins, multiple agent/multi-agent frameworks, and pre-defined working modes. You can select appropriate frameworks, tools, and knowledge bases for your use case to rapidly build your own agent/multi-agent collaboration system. Detailed instructions for configuration-based system construction are available in `docs/agent_factory.md`.

**NOTE:**

* The DrSai-General feature requires compiling Docker images for the Python execution sandbox and browser VNC. Please ensure Docker is installed. For details on images and installation, see [docker](docker/README.md).

### 2.3 Human-Computer Interaction Frontend

#### Configure npm environment

Install Node.js

```shell
# install nvm to install node
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
nvm install node # recommended node version ~ 22
```

Install frontend dependencies

```shell
cd your/path/to/drsai/frontend
npm install -g gatsby-cli
npm install --global yarn
yarn install

# cp .env.default .env.development or .env.production # copy .env.default to .env.development or .env.production
# Development environment variables: frontend/.env.development
# Production environment variables: frontend/.env.production

# yarn build # build frontend static resources
yarn run dev # start frontend development environment
```

## 3. Documentation

Tutorials (in development, contact us for issues):

```
tutorials/base01-hepai.md: Model configuration and usage on the HepAI platform
tutorials/base02-worker.md: Configuration and usage of HEPAI Worker remote functions
tutorials/base03-use_claude-code.md: Using Claude-Code via the HepAI platform
tutorials/agents: Agent and multi-agent system examples
tutorials/components: Agent component development examples
tutorials/request: Client request examples
```

Documentation (in development, contact us for issues):

```
docs/develop.md: Agent/multi-agent system development guide
docs/agent_factory.md: Agent/multi-agent open development and community contribution guide
docs/drsai_ui.md: Human-computer interaction frontend user guide
docs/open-webui.md: OpenAI-compatible frontend access and OpenWebUI Pipeline plugin usage
```

## 4. Contribution

We welcome contributions to OpenDrSai, including code, documentation, issues, and suggestions. Contributions can take many forms, including but not limited to:

* Code contributions: agent/multi-agent system components, system examples, frontend UI development.
* Documentation contributions: system documentation, tutorials, FAQs.
* Issue reporting: bug reports, feature suggestions, usage problems.
* Community activities: offline events, online workshops, and knowledge sharing.

## 5. Contact

* Email: [hepai@ihep.ac.cn](mailto:hepai@ihep.ac.cn) / [zdzhang@ihep.ac.cn](mailto:zdzhang@ihep.ac.cn) / [xiongdb@ihep.ac.cn](mailto:xiongdb@ihep.ac.cn)
* WeChat: xiongdongbo\_12138
* WeChat Group: HepAI LLM Tech Exchange Group 3:
  ![alt text](assets/微信三群.jpg)

