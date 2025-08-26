# OpenDrSai

An integrated framework for rapid development and deployment of agents and multi-agent systems, developed by the [HepAI](https://ai.ihep.ac.cn/) team at the Institute of High Energy Physics, Chinese Academy of Sciences. It enables the fast creation and deployment of backend and frontend services for customized agent and multi-agent collaboration systems.

<div align="center">
  <p>
      <img width="30%" src="assets/drsai.png" alt="Adaptation Logic Diagram">
  </p>
</div>

This framework is built upon Microsoft’s open-source project [AutoGen](https://github.com/microsoft/autogen) (current version 0.5.7). While maintaining compatibility with the complete structure and ecosystem of AutoGen, it redesigns the components and development logic of agent and multi-agent systems, making it more suitable for building **professional scientific agents and multi-agent systems 🤖: such as complex multi-task execution 💡, state management and human-computer interaction 🙋‍♂️🙋‍♀️, professional scientific tool management and execution 🛠️, long-duration task execution ⏰, and memory management 🧠**.

It ensures strong compatibility with mainstream MCP and A2A protocols, the [HepAI](https://ai.ihep.ac.cn/) ecosystem, and RAGFlow as a representative RAG architecture. Furthermore, it provides integrated capabilities for both development and deployment: agent or multi-agent system code can be launched with a single command, registered as an OpenAI ChatCompletions format service or HepAI Worker service, and directly exposed as an API. Together with the bundled human-computer interaction frontend, developers can rapidly build and deploy complete end-to-end applications.

## 1. Features

* Flexible switching of base models for agents via the [HepAI platform](https://aiapi.ihep.ac.cn/), along with dynamic configuration of components such as tools and knowledge bases. Supports integration of OpenAI ChatCompletions, Ollama, and other model formats.
* Provides pre-defined components for perception, reasoning, memory, execution, and state management in agent and multi-agent systems. These are plugin-based and extensible, supporting a wide variety of professional agent design use cases.
* Offers a one-click launch for human-computer interaction frontends and backends, enabling immediate application deployment. Compatible backend interfaces (OpenAI ChatCompletions, OpenWebUI-Pipeline) allow the system to be served as a third-party model or agent API.

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
```

#### Configure HepAI Platform API Key

Set the environment variables for the [HepAI](https://aiapi.ihep.ac.cn) DDF2 platform API key (based on bash):

Linux/macOS:

```shell
vi ~/.bashrc
export HEPAI_API_KEY=your_api_key
source ~/.bashrc
```

Windows:

```shell
setx "HEPAI_API_KEY" "your_api_key"
# Note: Windows environment variables require a restart to take effect
```

#### Agent Example Test

See [examples/oai\_client/assistant\_R1\_oai.py](examples/oai_client/assistant_R1_oai.py) for a demonstration of quickly developing an agent system with OpenDrSai.

### 2.2 Launch Human-Computer Interaction Frontend

#### Configure npm environment

Install Node.js

```shell
# install nvm to install node
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
nvm install node
```

Install frontend dependencies

```shell
cd your/path/to/drsai/frontend
npm install -g gatsby-cli
npm install --global yarn
yarn install

# cp .env.default .env.development or .env.production # copy .env.default to .env.development or .env.production
# Development variables: frontend/.env.development
# Production variables: frontend/.env.production

# yarn build # build frontend static resources
yarn run dev # start frontend development environment
```

### 2.3 Start OpenDrSai Service via CLI

```shell
# pip install drsai_ui -U # ensure drsai_ui is installed

cp .env.example .env # copy .env.example to .env
drsai ui # start Magenti-UI backend and static frontend

drsai console --agent-config agent_config.yaml # start CLI-based agent/multi-agent service
drsai backend --agent-config agent_config.yaml # deploy agent/multi-agent as OpenAI-compatible backend service
```

**NOTE:**

* The `agent_config.yaml` file defines configuration information for agents and multi-agent systems. It allows quick setup for testing, or for frontend users to customize their agents. Example:

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
  type: AssistantAgent # agent type, provided by OpenDrSai or user-developed
  name: myassistant
  system_message: "You are a helpful assistant who responds to user requests based on your tools and knowledge."
  description: "An agent that provides assistance with ability to use tools."
  model_client: *client
```

For detailed configuration, see [Configuration Documentation](docs/agent_factory.md). On our [AI platform](https://drsai.ihep.ac.cn), we provide a wide selection of base models, MCP/HEPAI Worker tools, RAG memory plugins, various agent and multi-agent frameworks, and pre-defined workflows. You can combine these in the frontend or backend to rapidly construct your own agent or multi-agent collaboration system. For detailed instructions on configuration-based construction, see: `docs/agent_factory.md`.

## 3. Documentation

Tutorials (in development, contact us for issues):

```
tutorials/base01-hepai.md: Model configuration and usage on the HepAI platform
tutorials/base02-worker.md: Configuration and usage of HEPAI Worker remote functions
tutorials/base03-use_claude-code.md: Using Claude-Code via the HepAI platform
tutorials/agents: Agent and multi-agent system examples
tutorials/components: Agent component development examples
```

Documentation (in development, contact us for issues):

```
docs/develop.md: Agent/multi-agent system development guide
docs/agent_factory.md: Agent/multi-agent open development and community contribution guide
docs/drsai_ui.md: Human-computer interaction frontend user guide
docs/open-webui.md: Using OpenAI-compatible frontend and OpenWebUI Pipeline plugin
```

## 4. Contribution

We welcome contributions to OpenDrSai, including code, documentation, issues, and suggestions. Contributions can take many forms, such as:

* Code contributions: agent/multi-agent system components, system examples, frontend UI development.
* Documentation contributions: system guides, tutorials, FAQs.
* Issue reporting: bug reports, feature suggestions, usage problems.
* Community activities: offline events, online meetups, knowledge sharing.

## 5. Contact

* Email: [hepai@ihep.ac.cn](mailto:hepai@ihep.ac.cn) / [xiongdb@ihep.ac.cn](mailto:xiongdb@ihep.ac.cn)
* WeChat: xiongdongbo\_12138
* WeChat Group: HepAI LLM Tech Exchange Group 3:
  ![alt text](assets/微信三群.jpg)
